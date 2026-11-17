import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'
import { fetchManifest, listTags, manifestRefs, RegistryError, retryTiming } from '@/lib/images/registry'

// A tiny registry: two pages of tags, a Link header pointing at another host
// (as Nexus does behind a proxy) and a bearer-token protected repository.
let server: http.Server
let base: string
// Requests per path, and how many times a flaky path still fails
const calls = new Map<string, number>()
const failures = new Map<string, number>()

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost')
    calls.set(url.pathname, (calls.get(url.pathname) ?? 0) + 1)
    const left = failures.get(url.pathname) ?? 0
    if (left > 0) {
      failures.set(url.pathname, left - 1)
      if (url.pathname.includes('/dropped/')) {
        req.socket.destroy()
        return
      }
      res.statusCode = url.pathname.includes('/limited/') ? 429 : 503
      if (res.statusCode === 429) res.setHeader('Retry-After', '1')
      res.end()
      return
    }
    if (/\/v2\/(flaky|limited|dropped)\/tags\/list/.test(url.pathname)) {
      res.end(JSON.stringify({ tags: ['ok'] }))
      return
    }
    if (url.pathname === '/token') {
      res.end(JSON.stringify({ token: 'secret-token' }))
      return
    }
    if (url.pathname === '/v2/paged/tags/list') {
      if (!url.searchParams.get('last')) {
        res.setHeader('Link', '<http://nexus.internal:8081/v2/paged/tags/list?last=b&n=1000>; rel="next"')
        res.end(JSON.stringify({ tags: ['a', 'b'] }))
      } else {
        res.end(JSON.stringify({ tags: ['c'] }))
      }
      return
    }
    if (url.pathname === '/v2/private/tags/list') {
      if (req.headers.authorization !== 'Bearer secret-token') {
        res.statusCode = 401
        res.setHeader('WWW-Authenticate', `Bearer realm="${base}/token",service="test"`)
        res.end()
        return
      }
      res.end(JSON.stringify({ tags: ['1.0'] }))
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>(resolve => server.close(() => resolve())))

beforeEach(() => {
  calls.clear()
  failures.clear()
})

describe('listTags', () => {
  it('follows pagination on our own endpoint, whatever host the Link names', async () => {
    expect(await listTags({ baseUrl: base }, 'paged')).toEqual(['a', 'b', 'c'])
  })
  it('handles a bearer token challenge', async () => {
    expect(await listTags({ baseUrl: base }, 'private')).toEqual(['1.0'])
  })
  it('throws a 404 RegistryError for unknown repositories', async () => {
    const error = await listTags({ baseUrl: base }, 'missing').catch(e => e)
    expect(error).toBeInstanceOf(RegistryError)
    expect(error.status).toBe(404)
  })
})

describe('listTags retries', () => {
  // No real waiting in tests; remember the pauses that were asked for
  const pauses: number[] = []
  beforeEach(() => {
    pauses.length = 0
    vi.spyOn(retryTiming, 'sleep').mockImplementation(async ms => {
      pauses.push(ms)
    })
  })

  it('retries 5xx answers until the registry recovers', async () => {
    failures.set('/v2/flaky/tags/list', 2)
    expect(await listTags({ baseUrl: base }, 'flaky')).toEqual(['ok'])
    expect(calls.get('/v2/flaky/tags/list')).toBe(3)
    expect(pauses).toHaveLength(2)
    expect(pauses[1]).toBeGreaterThan(pauses[0])
  })

  it('honours Retry-After on rate limits', async () => {
    failures.set('/v2/limited/tags/list', 1)
    expect(await listTags({ baseUrl: base }, 'limited')).toEqual(['ok'])
    expect(pauses).toEqual([1000])
  })

  it('retries dropped connections', async () => {
    failures.set('/v2/dropped/tags/list', 1)
    expect(await listTags({ baseUrl: base }, 'dropped')).toEqual(['ok'])
    expect(calls.get('/v2/dropped/tags/list')).toBe(2)
  })

  it('gives up after three retries with a transient error', async () => {
    failures.set('/v2/flaky/tags/list', 10)
    const error = await listTags({ baseUrl: base }, 'flaky').catch(e => e)
    expect(error).toBeInstanceOf(RegistryError)
    expect(error).toMatchObject({ status: 503, transient: true })
    expect(calls.get('/v2/flaky/tags/list')).toBe(4)
  })

  it('does not retry permanent answers or when retries are off', async () => {
    const missing = await listTags({ baseUrl: base }, 'missing').catch(e => e)
    expect(missing).toMatchObject({ status: 404, transient: false })
    expect(calls.get('/v2/missing/tags/list')).toBe(1)

    failures.set('/v2/flaky/tags/list', 1)
    await expect(listTags({ baseUrl: base }, 'flaky', { retries: 0 })).rejects.toMatchObject({ status: 503 })
    expect(calls.get('/v2/flaky/tags/list')).toBe(1)
  })
})

const CHILD = `sha256:${'a'.repeat(64)}`
const CONFIG = `sha256:${'b'.repeat(64)}`
const LAYER = `sha256:${'c'.repeat(64)}`

describe('manifestRefs', () => {
  it('reads an index, an image manifest and a schema 1 manifest', () => {
    expect(manifestRefs(JSON.stringify({ manifests: [{ digest: CHILD }, { digest: 'not-a-digest' }] }))).toEqual({
      manifests: [CHILD],
      blobs: [],
    })
    expect(manifestRefs(JSON.stringify({ config: { digest: CONFIG }, layers: [{ digest: LAYER }, { digest: LAYER }] }))).toEqual({
      manifests: [],
      blobs: [CONFIG, LAYER],
    })
    expect(manifestRefs(JSON.stringify({ fsLayers: [{ blobSum: LAYER }] }))).toEqual({ manifests: [], blobs: [LAYER] })
  })

  it('rejects a manifest that is not JSON', () => {
    expect(() => manifestRefs('<!DOCTYPE html>')).toThrow(RegistryError)
  })
})

describe('fetchManifest', () => {
  let pullServer: http.Server
  let pullBase: string
  const hits: string[] = []

  beforeAll(async () => {
    pullServer = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost')
      const pathname = decodeURIComponent(url.pathname)
      hits.push(`${req.method} ${pathname}`)
      if (req.method === 'HEAD' && pathname === '/v2/library/nginx/manifests/1.27') {
        res.setHeader('Docker-Content-Digest', CHILD)
        res.end()
        return
      }
      if (pathname === `/v2/library/nginx/manifests/1.27`) {
        res.end(JSON.stringify({ manifests: [{ digest: CHILD }] }))
        return
      }
      if (pathname === `/v2/library/nginx/manifests/${CHILD}`) {
        res.end(JSON.stringify({ config: { digest: CONFIG }, layers: [{ digest: LAYER }] }))
        return
      }
      if (pathname.startsWith('/v2/library/nginx/blobs/')) {
        res.end('layer')
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>(resolve => pullServer.listen(0, '127.0.0.1', resolve))
    pullBase = `http://127.0.0.1:${(pullServer.address() as AddressInfo).port}`
  })

  afterAll(() => new Promise<void>(resolve => pullServer.close(() => resolve())))

  beforeEach(() => {
    hits.length = 0
  })

  it('fetches every platform manifest and blob, then the tag again', async () => {
    await fetchManifest({ baseUrl: pullBase }, 'library/nginx', '1.27', { timeoutMs: 5000 })
    expect(hits).toEqual([
      'HEAD /v2/library/nginx/manifests/1.27',
      'GET /v2/library/nginx/manifests/1.27',
      `GET /v2/library/nginx/manifests/${CHILD}`,
      `GET /v2/library/nginx/blobs/${CONFIG}`,
      `GET /v2/library/nginx/blobs/${LAYER}`,
      'HEAD /v2/library/nginx/manifests/1.27',
    ])
  })
})
