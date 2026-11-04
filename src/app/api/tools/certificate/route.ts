import tls from 'tls'
import { X509Certificate } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { describeCertificate, matchesHostname, splitPemChain, type CertificateInfo } from '@/lib/tools/x509'

// Certificate checker: describe a pasted PEM (chain), or fetch the chain a TLS
// server presents. Only a TLS handshake is done; nothing is sent after it.

const HANDSHAKE_TIMEOUT_MS = 5000

interface RemoteResult {
  chain: CertificateInfo[]
  trusted: boolean
  trustError: string | null
  hostnameMatches: boolean
  protocol: string | null
}

function fetchChain(host: string, port: number): Promise<RemoteResult> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout: HANDSHAKE_TIMEOUT_MS }, () => {
      const chain: CertificateInfo[] = []
      const seen = new Set<string>()
      let cert: any = socket.getPeerCertificate(true)
      while (cert?.raw && !seen.has(cert.fingerprint256)) {
        seen.add(cert.fingerprint256)
        chain.push(describeCertificate(new X509Certificate(cert.raw)))
        cert = cert.issuerCertificate
      }
      const leaf = chain[0]
      resolve({
        chain,
        trusted: socket.authorized,
        trustError: socket.authorizationError ? String(socket.authorizationError) : null,
        hostnameMatches: leaf ? matchesHostname(leaf, host) : false,
        protocol: socket.getProtocol(),
      })
      socket.end()
    })
    socket.on('timeout', () => socket.destroy(new Error(`No TLS handshake with ${host}:${port} within ${HANDSHAKE_TIMEOUT_MS / 1000}s`)))
    socket.on('error', error => reject(error))
  })
}

function readableError(error: any, host: string) {
  if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') return `Host ${host} not found (DNS)`
  if (error?.code === 'ECONNREFUSED') return `Connection to ${host} refused`
  if (error?.code === 'ECONNRESET') return `${host} closed the connection (no TLS on this port?)`
  return error?.message || 'TLS connection failed'
}

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (typeof body.pem === 'string') {
    const blocks = splitPemChain(body.pem)
    if (blocks.length === 0) return NextResponse.json({ error: 'No PEM certificate found (-----BEGIN CERTIFICATE-----)' }, { status: 400 })
    try {
      return NextResponse.json({ chain: blocks.map(block => describeCertificate(block)) })
    } catch (error: any) {
      return NextResponse.json({ error: `Could not parse certificate: ${error.message}` }, { status: 400 })
    }
  }

  const host = typeof body.host === 'string' ? body.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : ''
  const port = Number(body.port ?? 443)
  if (!host || !/^[a-zA-Z0-9.\-:\[\]]+$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: 'Give a host name and a port between 1 and 65535' }, { status: 400 })
  }
  try {
    return NextResponse.json({ host, port, ...(await fetchChain(host, port)) })
  } catch (error: any) {
    return NextResponse.json({ error: readableError(error, host) }, { status: 502 })
  }
}
