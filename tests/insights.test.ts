import { describe, expect, it } from 'vitest'
import { buildRows } from '@/lib/hostnames'
import { __internals } from '@/lib/gatewayApi'
import { extractVersion, releaseStatus } from '@/lib/platformVersions'
import { toPeriods } from '@/lib/history/query'
import { toHistoryStatus } from '@/lib/history/sampler'

describe('releaseStatus', () => {
  const tags = ['v1.34.5', 'v1.35.2', 'v1.36.4', 'v1.37.0', 'v1.37.1', 'v1.37.3', 'v1.38.0-rc.1', 'latest']
  it('reports patches and minors behind', () => {
    expect(releaseStatus('v1.37.3', tags, 3)).toMatchObject({ latest: null, latestPatch: null, minorsBehind: 0, outOfSupport: false })
    expect(releaseStatus('v1.37.1', tags, 3)).toMatchObject({ latest: 'v1.37.3', latestPatch: 'v1.37.3', minorsBehind: 0 })
    expect(releaseStatus('v1.36.4', tags, 3)).toMatchObject({ latest: 'v1.37.3', latestPatch: null, minorsBehind: 1, outOfSupport: false })
  })
  it('marks versions outside the support window', () => {
    expect(releaseStatus('v1.34.5', tags, 3)).toMatchObject({ minorsBehind: 3, outOfSupport: true })
    expect(releaseStatus('v1.34.5', tags, null).outOfSupport).toBe(false)
  })
  it('extracts versions from version strings and OS images', () => {
    expect(extractVersion('v1.37.1+k3s1')).toBe('v1.37.1')
    expect(extractVersion('Talos (v1.14.4)')).toBe('v1.14.4')
    expect(extractVersion('1.2.3')).toBe('v1.2.3')
    expect(extractVersion('Ubuntu 24.04')).toBeNull()
  })
})

describe('health history', () => {
  it('maps health statuses', () => {
    expect(toHistoryStatus('healthy')).toBe('healthy')
    expect(toHistoryStatus('timeout')).toBe('unreachable')
    expect(toHistoryStatus('error')).toBe('unreachable')
    expect(toHistoryStatus('checking')).toBe('unknown')
  })
  it('merges samples into periods and splits on gaps', () => {
    const at = (min: number) => new Date(Date.UTC(2026, 10, 1, 0, min))
    const periods = toPeriods(
      [
        { at: at(0), status: 'healthy' },
        { at: at(5), status: 'healthy' },
        { at: at(10), status: 'unreachable' },
        { at: at(15), status: 'unreachable' },
        { at: at(20), status: 'healthy' },
        // 40 minutes without samples: a new period
        { at: at(60), status: 'healthy' },
      ],
      5
    )
    expect(periods.map(p => [p.status, p.from.slice(11, 16), p.to.slice(11, 16)])).toEqual([
      ['healthy', '00:00', '00:10'],
      ['unreachable', '00:10', '00:20'],
      ['healthy', '00:20', '00:25'],
      ['healthy', '01:00', '01:05'],
    ])
  })
})

// buildRows only needs the certificate summary, not a real certificate
const described = (names: string[], days: number) => ({
  subject: `CN=${names[0]}`,
  commonName: names[0],
  issuer: 'CN=Test CA',
  subjectAltNames: names.map(n => `DNS:${n}`),
  notBefore: new Date().toISOString(),
  notAfter: new Date(Date.now() + days * 86_400_000).toISOString(),
  daysUntilExpiry: days,
  expired: days < 0,
  selfSigned: false,
  isCA: false,
  serialNumber: '01',
  fingerprint256: '',
  keyType: 'rsa',
})

describe('buildRows (hostnames)', () => {
  const { toGateway, toRoute } = __internals
  const ok = { conditions: [{ type: 'Accepted', status: 'True' }, { type: 'ResolvedRefs', status: 'True' }] }
  const gateway = toGateway({
    metadata: { name: 'public', namespace: 'gw' },
    spec: {
      gatewayClassName: 'cilium',
      listeners: [
        { name: 'http', protocol: 'HTTP', port: 80 },
        { name: 'https', protocol: 'HTTPS', port: 443, hostname: '*.example.com', tls: { certificateRefs: [{ name: 'wild' }] } },
      ],
    },
  })
  const routes = [
    toRoute('HTTPRoute', {
      metadata: { name: 'app', namespace: 'web' },
      spec: { hostnames: ['app.example.com', 'other.org'], parentRefs: [{ name: 'public', namespace: 'gw' }], rules: [{ backendRefs: [{ name: 'app', port: 80 }] }] },
      status: { parents: [{ parentRef: { name: 'public', namespace: 'gw' }, ...ok }] },
    }),
    toRoute('HTTPRoute', {
      metadata: { name: 'catchall', namespace: 'cust' },
      spec: { parentRefs: [{ name: 'public', namespace: 'gw', sectionName: 'https' }] },
      status: { parents: [{ parentRef: { name: 'public', namespace: 'gw', sectionName: 'https' }, conditions: [{ type: 'Accepted', status: 'False', message: 'NotAllowedByListeners' }] }] },
    }),
  ]
  const ingress = {
    metadata: { name: 'legacy', namespace: 'old' },
    spec: {
      ingressClassName: 'nginx',
      tls: [{ hosts: ['legacy.test'], secretName: 'legacy-tls' }, { hosts: ['gone.test'], secretName: 'missing' }],
      rules: [{ host: 'legacy.test', http: { paths: [{ backend: { service: { name: 'web', port: { number: 80 } } } }] } }, { host: 'gone.test' }, {}],
    },
    status: { loadBalancer: { ingress: [{ ip: '10.0.0.1' }] } },
  }
  const certificates = new Map<string, any>([
    ['gw/wild', described(['*.example.com'], 20)],
    ['old/legacy-tls', described(['legacy.test'], 200)],
    ['old/missing', { error: 'Secret not found' }],
  ])
  const rows = buildRows([gateway], routes, [ingress], new Set(['cust']), certificates)
  const row = (host: string) => rows.find(r => r.hostname === host)!

  it('lists every hostname once, sorted', () => {
    expect(rows.map(r => r.hostname)).toEqual(['*.example.com', 'app.example.com', 'gone.test', 'legacy.test', 'other.org'])
  })
  it('uses the TLS listener that serves the hostname', () => {
    expect(row('app.example.com')).toMatchObject({ gateway: 'gw/public · https', status: 'ok', tls: { secret: 'gw/wild', daysUntilExpiry: 20, matches: true } })
    expect(row('other.org')).toMatchObject({ gateway: 'gw/public · http', tls: null })
  })
  it('takes the hostname from the listener when the route has none', () => {
    expect(row('*.example.com')).toMatchObject({ fromListener: true, status: 'problem', message: 'NotAllowedByListeners', customerManaged: true })
  })
  it('handles Ingress TLS secrets, including missing ones', () => {
    expect(row('legacy.test')).toMatchObject({ kind: 'Ingress', backends: ['web:80'], status: 'ok', tls: { daysUntilExpiry: 200, matches: true } })
    expect(row('gone.test').tls).toMatchObject({ error: 'Secret not found', daysUntilExpiry: null })
  })
})
