import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import https from 'https'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile, execFileSync } from 'child_process'
import { promisify } from 'util'
import type { AddressInfo } from 'net'
import { describeKeycloakError, keycloakRequest } from '@/lib/keycloakHttp'

// A Keycloak stand-in on https://localhost with a self-signed certificate,
// like an internal CA the pod does not know.
let dir: string
let server: https.Server
let url: string

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keycloak-tls-'))
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
  ], { stdio: 'ignore' })
  server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, (req, res) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ method: req.method, body, auth: req.headers.authorization ?? null }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, 'localhost', resolve))
  url = `https://localhost:${(server.address() as AddressInfo).port}/realms/test/protocol/openid-connect/token`
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('keycloakRequest', () => {
  it('rejects an untrusted certificate with a readable reason', async () => {
    const error = await keycloakRequest(url).catch(e => e)
    expect(error.message).toMatch(/^TLS certificate of localhost:\d+ not trusted \(DEPTH_ZERO_SELF_SIGNED_CERT\)/)
    expect(error.message).toContain('NODE_EXTRA_CA_CERTS')
  })

  it('accepts it when insecure TLS is allowed, and sends method, headers and body', async () => {
    const response = await keycloakRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer x' },
      body: 'grant_type=authorization_code&code=abc',
      allowInsecureTls: true,
    })
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ method: 'POST', body: 'grant_type=authorization_code&code=abc', auth: 'Bearer x' })
  })

  it('trusts the certificate through NODE_EXTRA_CA_CERTS', async () => {
    // NODE_EXTRA_CA_CERTS is read at startup, so check it in a fresh Node process.
    // Async: the server runs in this process and must keep answering.
    const script = `require('https').get(${JSON.stringify(url)}, { agent: false }, r => { console.log(r.statusCode); r.resume() }).on('error', e => console.log(e.code))`
    const run = async (env: Record<string, string>) =>
      (await promisify(execFile)(process.execPath, ['-e', script], { env: { ...process.env, ...env }, timeout: 10_000 })).stdout.trim()
    expect(await run({ NODE_EXTRA_CA_CERTS: '' })).toBe('DEPTH_ZERO_SELF_SIGNED_CERT')
    expect(await run({ NODE_EXTRA_CA_CERTS: path.join(dir, 'cert.pem') })).toBe('200')
  })
})

describe('describeKeycloakError', () => {
  it('explains DNS and connection errors', () => {
    expect(describeKeycloakError({ code: 'ENOTFOUND' }, 'https://keycloak.example.com/x').message).toBe('Keycloak host keycloak.example.com not found (DNS)')
    expect(describeKeycloakError({ code: 'ECONNREFUSED' }, 'https://kc:8443/x').message).toBe('Connection to Keycloak at kc:8443 refused')
    expect(describeKeycloakError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, 'https://kc/x').message).toContain('(UNABLE_TO_VERIFY_LEAF_SIGNATURE)')
  })
})
