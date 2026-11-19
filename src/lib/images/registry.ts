import http from 'http'
import https from 'https'
import { DOCKER_HUB } from './reference'

// Minimal OCI distribution (Docker Registry v2) client for listing tags.
// Works with Docker Hub, ghcr.io, quay.io, registry.k8s.io, gcr.io, public ECR,
// Nexus and other v2 registries: anonymous bearer tokens are fetched from the
// realm in the WWW-Authenticate challenge, credentials are used when given.

export interface RegistryEndpoint {
  baseUrl: string
  username?: string
  password?: string
  insecureTls?: boolean
}

export class RegistryError extends Error {
  // transient: a timeout, dropped connection, rate limit or 5xx; worth trying again later
  constructor(message: string, readonly status?: number, readonly transient = false) {
    super(message)
  }
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_PAGES = 20
// Transient failures (timeouts, dropped connections, rate limits, 5xx) are retried
// with a growing pause: 1s, 2s, 4s (plus jitter), or what Retry-After asks, up to 10s.
const RETRIES = 3
const RETRY_BASE_MS = 1000
const MAX_RETRY_AFTER_MS = 10_000
const RETRY_STATUS = new Set([429, 500, 502, 503, 504])
const RETRY_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'EPIPE', 'ESOCKETTIMEDOUT', 'UND_ERR_SOCKET'])
const TOKEN_TTL_MS = 4 * 60_000

interface RawResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

function request(url: string, headers: Record<string, string>, insecureTls = false, timeoutMs = REQUEST_TIMEOUT_MS, method: 'GET' | 'HEAD' = 'GET'): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const lib = target.protocol === 'http:' ? http : https
    const req = lib.request(
      target,
      { method, headers: { 'User-Agent': 'k8s-fleet-manager', ...headers }, rejectUnauthorized: !insecureTls, timeout: timeoutMs },
      res => {
        // Follow redirects (some registries redirect token or tag requests)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          request(new URL(res.headers.location, target).toString(), headers, insecureTls, timeoutMs, method).then(resolve, reject)
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }))
      }
    )
    req.on('timeout', () => req.destroy(new RegistryError(`Timeout after ${timeoutMs / 1000}s`, undefined, true)))
    req.on('error', reject)
    req.end()
  })
}

// Exported for tests
export const retryTiming = { sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)) }

function retryDelay(attempt: number, retryAfter?: string | string[]) {
  const seconds = Number(Array.isArray(retryAfter) ? retryAfter[0] : retryAfter)
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
  return RETRY_BASE_MS * 2 ** attempt + Math.random() * 250
}

// request() with retries for transient failures. Permanent answers (404, 401, ...)
// and unknown hosts come back at once.
async function requestWithRetry(url: string, headers: Record<string, string>, insecureTls: boolean | undefined, retries: number, timeoutMs = REQUEST_TIMEOUT_MS, method: 'GET' | 'HEAD' = 'GET'): Promise<RawResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await request(url, headers, insecureTls, timeoutMs, method)
      if (!RETRY_STATUS.has(res.status) || attempt >= retries) return res
      await retryTiming.sleep(retryDelay(attempt, res.headers['retry-after']))
    } catch (error: any) {
      const transient = RETRY_CODES.has(error?.code) || (error instanceof RegistryError && error.transient)
      if (!transient || attempt >= retries) throw error
      await retryTiming.sleep(retryDelay(attempt))
    }
  }
}

function basicAuth(endpoint: RegistryEndpoint) {
  if (!endpoint.username || !endpoint.password) return undefined
  return `Basic ${Buffer.from(`${endpoint.username}:${endpoint.password}`).toString('base64')}`
}

function parseChallenge(header: string | undefined): { scheme: string; params: Record<string, string> } | null {
  if (!header) return null
  const [scheme, ...rest] = header.split(' ')
  const params: Record<string, string> = {}
  for (const match of rest.join(' ').matchAll(/(\w+)="([^"]*)"/g)) params[match[1]] = match[2]
  return { scheme: scheme.toLowerCase(), params }
}

const tokenCache = new Map<string, { token: string; at: number }>()

async function bearerToken(endpoint: RegistryEndpoint, challenge: Record<string, string>, repository: string, retries: number) {
  const scope = challenge.scope || `repository:${repository}:pull`
  const cacheKey = `${challenge.realm}|${challenge.service}|${scope}|${endpoint.username || ''}`
  const cached = tokenCache.get(cacheKey)
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token

  const url = new URL(challenge.realm)
  if (challenge.service) url.searchParams.set('service', challenge.service)
  url.searchParams.set('scope', scope)
  const auth = basicAuth(endpoint)
  const res = await requestWithRetry(url.toString(), auth ? { Authorization: auth } : {}, endpoint.insecureTls, retries)
  if (res.status < 200 || res.status >= 300) throw new RegistryError(`Token request failed (HTTP ${res.status})`, res.status, RETRY_STATUS.has(res.status))
  const data = JSON.parse(res.body)
  const token = data.token || data.access_token
  if (!token) throw new RegistryError('Token response without token')
  tokenCache.set(cacheKey, { token, at: Date.now() })
  return token as string
}

// Only the query of the Link header (last=..., n=...) is used; the path is always our
// own tags URL. Registries behind a proxy or group report paths we must not follow:
// a root-relative /v2/... without the /repository/docker prefix, or (Nexus groups)
// the path of the member repository that answered, which the user may not be allowed to read.
// (Most registries page with `last`, quay.io with `next_page`.)
function nextPage(link: string | string[] | undefined, tagsUrl: string, current: string): string | null {
  const value = Array.isArray(link) ? link[0] : link
  const match = value?.match(/<([^>]+)>;\s*rel="?next"?/)
  if (!match) return null
  const next = new URL(tagsUrl)
  new URL(match[1], tagsUrl).searchParams.forEach((v, k) => next.searchParams.set(k, v))
  // A link without new paging parameters would loop forever
  return next.toString() === current ? null : next.toString()
}

const TLS_ERRORS = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

// Turn low-level network errors into a short, readable reason.
function describeNetworkError(error: any, url: string): RegistryError {
  if (error instanceof RegistryError) return error
  const host = new URL(url).host
  const code: string | undefined = error?.code
  if (code === 'ENOTFOUND') return new RegistryError(`Host ${host} not found (DNS)`)
  if (code === 'EAI_AGAIN') return new RegistryError(`Host ${host} not found (DNS)`, undefined, true)
  if (code === 'ECONNREFUSED') return new RegistryError(`Connection to ${host} refused`, undefined, true)
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET') return new RegistryError(`No response from ${host}`, undefined, true)
  if (code && TLS_ERRORS.has(code)) {
    return new RegistryError(`TLS certificate of ${host} not trusted (${code}); enable "Allow insecure TLS" or trust the CA`)
  }
  return new RegistryError(error?.message || `Request to ${host} failed`, undefined, RETRY_CODES.has(code ?? ''))
}

// Returns every tag of a repository. Throws RegistryError (status 404 when the repository is unknown).
// `retries`: extra attempts per request on transient failures.
export async function listTags(endpoint: RegistryEndpoint, repository: string, { retries = RETRIES }: { retries?: number } = {}): Promise<string[]> {
  const base = endpoint.baseUrl.replace(/\/$/, '')
  const tagsUrl = `${base}/v2/${repository}/tags/list?n=1000`
  let url: string | null = tagsUrl
  let authorization = basicAuth(endpoint)
  const tags: string[] = []

  for (let page = 0; url && page < MAX_PAGES; page++) {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (authorization) headers.Authorization = authorization
    const where = new URL(url).pathname
    let res: RawResponse
    try {
      res = await requestWithRetry(url, headers, endpoint.insecureTls, retries)

      if (res.status === 401) {
        const challenge = parseChallenge(res.headers['www-authenticate'] as string | undefined)
        if (challenge?.scheme === 'bearer' && challenge.params.realm) {
          authorization = `Bearer ${await bearerToken(endpoint, challenge.params, repository, retries)}`
          res = await requestWithRetry(url, { ...headers, Authorization: authorization }, endpoint.insecureTls, retries)
        }
      }
    } catch (error) {
      throw describeNetworkError(error, url)
    }

    if (res.status === 404) throw new RegistryError(`Not found: ${where}`, 404)
    if (res.status === 401 || res.status === 403) throw new RegistryError(`Access denied (HTTP ${res.status}) for ${where}`, res.status)
    if (res.status < 200 || res.status >= 300) throw new RegistryError(`HTTP ${res.status} for ${where}`, res.status, RETRY_STATUS.has(res.status))

    let data: { tags?: string[] | null }
    try {
      data = JSON.parse(res.body)
    } catch {
      throw new RegistryError('Registry returned invalid JSON')
    }
    tags.push(...(data.tags || []))
    url = nextPage(res.headers.link, tagsUrl, url)
  }

  return tags
}

const MANIFEST_ACCEPT = [
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v1+prettyjws',
].join(', ')

const DIGEST = /^sha256:[a-f0-9]{64}$/i
const MAX_MANIFESTS = 64
const MAX_REDIRECTS = 5

// Digests a manifest points at. `manifests` are child indexes (one per platform);
// `blobs` are the config and layers Harbor must store before the artifact exists.
export function manifestRefs(body: string): { manifests: string[]; blobs: string[] } {
  let data: any
  try {
    data = JSON.parse(body)
  } catch {
    throw new RegistryError('Registry returned invalid JSON')
  }
  const manifests: string[] = []
  const blobs: string[] = []
  const add = (list: string[], value: unknown) => {
    if (typeof value !== 'string' || !DIGEST.test(value) || list.includes(value)) return
    list.push(value)
  }
  if (Array.isArray(data?.manifests)) {
    for (const item of data.manifests) add(manifests, item?.digest)
  }
  add(blobs, data?.config?.digest)
  if (Array.isArray(data?.layers)) {
    for (const layer of data.layers) add(blobs, layer?.digest)
  }
  if (Array.isArray(data?.fsLayers)) {
    for (const layer of data.fsLayers) add(blobs, layer?.blobSum)
  }
  return { manifests, blobs }
}

function withoutAuthorization(headers: Record<string, string>) {
  const copy = { ...headers }
  delete copy.Authorization
  delete copy.authorization
  return copy
}

// Read a body and discard it. Blob downloads must not be buffered: a layer can be
// hundreds of megabytes. Redirects to another host drop Authorization.
function drain(url: string, headers: Record<string, string>, insecureTls = false, timeoutMs = REQUEST_TIMEOUT_MS, redirects = 0): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const lib = target.protocol === 'http:' ? http : https
    const req = lib.request(
      target,
      { method: 'GET', headers: { 'User-Agent': 'k8s-fleet-manager', ...headers }, rejectUnauthorized: !insecureTls, timeout: timeoutMs },
      res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          if (redirects >= MAX_REDIRECTS) {
            reject(new RegistryError(`Too many redirects for ${target.pathname}`))
            return
          }
          const next = new URL(res.headers.location, target)
          const nextHeaders = next.host === target.host ? headers : withoutAuthorization(headers)
          drain(next.toString(), nextHeaders, insecureTls, timeoutMs, redirects + 1).then(resolve, reject)
          return
        }
        res.resume()
        res.on('error', reject)
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers }))
      }
    )
    req.on('timeout', () => req.destroy(new RegistryError(`Timeout after ${timeoutMs / 1000}s`, undefined, true)))
    req.on('error', reject)
    req.end()
  })
}

async function drainWithRetry(url: string, headers: Record<string, string>, insecureTls: boolean | undefined, retries: number, timeoutMs: number) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await drain(url, headers, insecureTls, timeoutMs)
      if (!RETRY_STATUS.has(res.status) || attempt >= retries) return res
      await retryTiming.sleep(retryDelay(attempt, res.headers['retry-after']))
    } catch (error: any) {
      const transient = RETRY_CODES.has(error?.code) || (error instanceof RegistryError && error.transient)
      if (!transient || attempt >= retries) throw error
      await retryTiming.sleep(retryDelay(attempt))
    }
  }
}

function ensureOk(status: number, where: string) {
  if (status === 404) throw new RegistryError(`Not found: ${where}`, 404)
  if (status === 401 || status === 403) throw new RegistryError(`Access denied (HTTP ${status}) for ${where}`, status)
  if (status < 200 || status >= 300) throw new RegistryError(`HTTP ${status} for ${where}`, status, RETRY_STATUS.has(status))
}

// What a proxy-cache pull left behind. Harbor tags an artifact from a HEAD by tag, and
// the digest it stores for a manifest list can differ from the upstream digest.
export interface PulledImage {
  digest?: string
  manifests: string[]
}

// Pull an image through a registry, including a Harbor proxy-cache project.
// Harbor only keeps a tag when the client HEADs the manifest by tag (as docker pull
// does) and every referenced blob has been fetched. A GET alone stores untagged layers.
// Throws RegistryError.
export async function fetchManifest(
  endpoint: RegistryEndpoint,
  repository: string,
  reference: string,
  { timeoutMs = 180_000, retries = 0 }: { timeoutMs?: number; retries?: number } = {}
): Promise<PulledImage> {
  const base = endpoint.baseUrl.replace(/\/$/, '')
  const name = repository.split('/').map(part => encodeURIComponent(part)).join('/')
  let authorization = basicAuth(endpoint)

  async function call(url: string, accept: string | undefined, stream: boolean, method: 'GET' | 'HEAD' = 'GET') {
    const headers: Record<string, string> = {}
    if (accept) headers.Accept = accept
    if (authorization) headers.Authorization = authorization
    try {
      const load = () => {
        if (method === 'HEAD') return requestWithRetry(url, headers, endpoint.insecureTls, retries, timeoutMs, 'HEAD')
        return stream
          ? drainWithRetry(url, headers, endpoint.insecureTls, retries, timeoutMs)
          : requestWithRetry(url, headers, endpoint.insecureTls, retries, timeoutMs)
      }
      let res = await load()
      if (res.status === 401) {
        const challenge = parseChallenge(res.headers['www-authenticate'] as string | undefined)
        if (challenge?.scheme === 'bearer' && challenge.params.realm) {
          authorization = `Bearer ${await bearerToken(endpoint, challenge.params, repository, retries)}`
          headers.Authorization = authorization
          res = await load()
        }
      }
      return res
    } catch (error) {
      throw describeNetworkError(error, url)
    }
  }

  function digestHeader(headers: http.IncomingHttpHeaders) {
    const raw = headers['docker-content-digest']
    const digest = Array.isArray(raw) ? raw[0] : raw
    return digest && DIGEST.test(digest) ? digest : undefined
  }

  // HEAD by tag is what makes Harbor remember the tag. A miss is fine: the GET below
  // still pulls the manifest, and a registry that has no HEAD must not fail the pull.
  async function headManifest(ref: string) {
    const url = `${base}/v2/${name}/manifests/${encodeURIComponent(ref)}`
    const res = await call(url, MANIFEST_ACCEPT, false, 'HEAD')
    if (res.status === 404 || res.status === 405 || res.status === 400 || res.status === 501) return undefined
    ensureOk(res.status, `${repository}:${ref}`)
    return digestHeader(res.headers)
  }

  async function manifest(ref: string) {
    const url = `${base}/v2/${name}/manifests/${encodeURIComponent(ref)}`
    const res = await call(url, MANIFEST_ACCEPT, false)
    ensureOk(res.status, `${repository}:${ref}`)
    if (!('body' in res) || typeof res.body !== 'string') throw new RegistryError('Registry returned an empty manifest')
    return { body: res.body, digest: digestHeader(res.headers) }
  }

  let rootDigest = DIGEST.test(reference) ? reference : await headManifest(reference)

  const seen = new Set<string>()
  const manifests: string[] = []
  const blobs = new Set<string>()
  const queue = [reference]
  while (queue.length > 0) {
    const ref = queue.shift()!
    if (seen.has(ref)) continue
    if (seen.size >= MAX_MANIFESTS) throw new RegistryError(`Too many manifests for ${repository}:${reference}`)
    seen.add(ref)
    const loaded = await manifest(ref)
    if (DIGEST.test(ref) && !manifests.includes(ref)) manifests.push(ref)
    if (loaded.digest) {
      if (ref === reference) rootDigest = loaded.digest
      if (!manifests.includes(loaded.digest)) manifests.push(loaded.digest)
    }
    const refs = manifestRefs(loaded.body)
    for (const digest of refs.blobs) blobs.add(digest)
    for (const digest of refs.manifests) {
      if (!seen.has(digest)) queue.push(digest)
    }
  }

  for (const digest of blobs) {
    const url = `${base}/v2/${name}/blobs/${encodeURIComponent(digest)}`
    const res = await call(url, undefined, true)
    ensureOk(res.status, `${repository}@${digest}`)
  }

  // Blobs exist now. HEAD the tag again so Harbor can attach it to the cached manifest.
  if (!DIGEST.test(reference) && blobs.size > 0) {
    const again = await headManifest(reference)
    if (again) rootDigest = again
  }

  return { digest: rootDigest, manifests }
}

// Public endpoint for an image's own registry.
export function publicEndpoint(registry: string): RegistryEndpoint {
  if (registry === DOCKER_HUB) return { baseUrl: 'https://registry-1.docker.io' }
  const insecureHost = registry.startsWith('localhost') || registry.startsWith('127.')
  return { baseUrl: `${insecureHost ? 'http' : 'https'}://${registry}` }
}
