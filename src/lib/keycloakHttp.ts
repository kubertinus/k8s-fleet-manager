import https from 'https'
import http from 'http'

// Server-side requests to Keycloak (token exchange, userinfo). Uses node:https so
// an untrusted certificate can be accepted when the admin explicitly allows it;
// an internal CA is better trusted through NODE_EXTRA_CA_CERTS (see DEPLOYMENT.md).

const TIMEOUT_MS = 15_000

const TLS_ERRORS = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

export class KeycloakRequestError extends Error {}

export interface KeycloakResponse {
  ok: boolean
  status: number
  text(): Promise<string>
  json(): Promise<any>
}

// Turn low-level network errors into a short reason an admin can act on
export function describeKeycloakError(error: any, url: string): KeycloakRequestError {
  if (error instanceof KeycloakRequestError) return error
  const host = new URL(url).host
  const code: string | undefined = error?.code
  if (code && TLS_ERRORS.has(code)) {
    return new KeycloakRequestError(
      `TLS certificate of ${host} not trusted (${code}): add its CA to the app (NODE_EXTRA_CA_CERTS, see DEPLOYMENT.md) or enable "Allow insecure TLS for Keycloak"`
    )
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new KeycloakRequestError(`Keycloak host ${host} not found (DNS)`)
  if (code === 'ECONNREFUSED') return new KeycloakRequestError(`Connection to Keycloak at ${host} refused`)
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET') return new KeycloakRequestError(`No response from Keycloak at ${host}`)
  return new KeycloakRequestError(error?.message || `Request to Keycloak at ${host} failed`)
}

export function keycloakRequest(
  url: string,
  { method = 'GET', headers = {}, body, allowInsecureTls = false }: { method?: string; headers?: Record<string, string>; body?: string; allowInsecureTls?: boolean } = {}
): Promise<KeycloakResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const lib = target.protocol === 'http:' ? http : https
    const req = lib.request(
      target,
      {
        method,
        headers: { ...headers, ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}) },
        rejectUnauthorized: !allowInsecureTls,
        timeout: TIMEOUT_MS,
      },
      res => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (data += chunk))
        res.on('end', () => {
          const status = res.statusCode || 0
          resolve({ ok: status >= 200 && status < 300, status, text: async () => data, json: async () => JSON.parse(data) })
        })
      }
    )
    req.on('timeout', () => req.destroy(new KeycloakRequestError(`No response from Keycloak at ${target.host} within ${TIMEOUT_MS / 1000}s`)))
    req.on('error', error => reject(describeKeycloakError(error, url)))
    if (body !== undefined) req.write(body)
    req.end()
  })
}
