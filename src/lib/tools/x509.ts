import { X509Certificate } from 'crypto'

// Readable summary of an X.509 certificate, used by the certificate checker and
// the kubeconfig inspector. Server-side only (node:crypto).

export interface CertificateInfo {
  subject: string
  commonName: string | null
  issuer: string
  subjectAltNames: string[]
  notBefore: string
  notAfter: string
  daysUntilExpiry: number
  expired: boolean
  selfSigned: boolean
  isCA: boolean
  serialNumber: string
  fingerprint256: string
  keyType: string | null
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g

export function splitPemChain(text: string): string[] {
  return text.match(PEM_BLOCK) ?? []
}

// "CN=foo\nO=bar" -> "CN=foo, O=bar"
function oneLine(dn: string) {
  return dn.split('\n').filter(Boolean).join(', ')
}

export function describeCertificate(input: string | Buffer | X509Certificate): CertificateInfo {
  const cert = input instanceof X509Certificate ? input : new X509Certificate(input)
  const notAfter = new Date(cert.validTo)
  const daysUntilExpiry = Math.floor((notAfter.getTime() - Date.now()) / 86_400_000)
  const commonName = cert.subject.split('\n').find(part => part.startsWith('CN='))?.slice(3) ?? null
  const subjectAltNames = (cert.subjectAltName ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)

  return {
    subject: oneLine(cert.subject),
    commonName,
    issuer: oneLine(cert.issuer),
    subjectAltNames,
    notBefore: new Date(cert.validFrom).toISOString(),
    notAfter: notAfter.toISOString(),
    daysUntilExpiry,
    expired: daysUntilExpiry < 0,
    selfSigned: cert.subject === cert.issuer && cert.verify(cert.publicKey),
    isCA: cert.ca,
    serialNumber: cert.serialNumber,
    fingerprint256: cert.fingerprint256,
    keyType: cert.publicKey.asymmetricKeyType ?? null,
  }
}

// Does a certificate cover this hostname (DNS SANs, with a single-label wildcard)?
export function matchesHostname(info: CertificateInfo, hostname: string): boolean {
  const host = hostname.toLowerCase()
  const names = info.subjectAltNames
    .filter(san => san.startsWith('DNS:') || san.startsWith('IP Address:'))
    .map(san => san.replace(/^(DNS|IP Address):/, '').toLowerCase())
  if (names.length === 0 && info.commonName) names.push(info.commonName.toLowerCase())
  return names.some(name => {
    if (name === host) return true
    if (name.startsWith('*.')) {
      const suffix = name.slice(1)
      return host.endsWith(suffix) && !host.slice(0, -suffix.length).includes('.')
    }
    return false
  })
}
