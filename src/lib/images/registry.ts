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

function request(url: string, headers: Record<string, string>, insecureTls = false): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const lib = target.protocol === 'http:' ? http : https
    const req = lib.request(
      target,
      { method: 'GET', headers: { 'User-Agent': 'k8s-fleet-manager', ...headers }, rejectUnauthorized: !insecureTls, timeout: REQUEST_TIMEOUT_MS },
      res => {
        // Follow redirects (some registries redirect token or tag requests)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          request(new URL(res.headers.location, target).toString(), headers, insecureTls).then(resolve, reject)
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }))
      }
    )
    req.on('timeout', () => req.destroy(new RegistryError(`Timeout after ${REQUEST_TIMEOUT_MS / 1000}s`, undefined, true)))
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
async function requestWithRetry(url: string, headers: Record<string, string>, insecureTls: boolean | undefined, retries: number): Promise<RawResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await request(url, headers, insecureTls)
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

// Public endpoint for an image's own registry.
export function publicEndpoint(registry: string): RegistryEndpoint {
  if (registry === DOCKER_HUB) return { baseUrl: 'https://registry-1.docker.io' }
  const insecureHost = registry.startsWith('localhost') || registry.startsWith('127.')
  return { baseUrl: `${insecureHost ? 'http' : 'https'}://${registry}` }
}
