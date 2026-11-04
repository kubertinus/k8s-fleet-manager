import * as k8s from '@kubernetes/client-node'
import { getGatewayApi, type GatewayInfo, type RouteInfo } from './gatewayApi'
import { isCustomerManaged } from './customerManaged'
import { describeCertificate, matchesHostname, splitPemChain } from './tools/x509'

// Every hostname a cluster serves: Gateway API routes plus the Ingresses that are
// left, with the route status and the expiry of the TLS certificate behind it.

export interface HostnameTls {
  secret: string // namespace/name
  notAfter: string | null
  daysUntilExpiry: number | null
  issuer: string | null
  // Does the certificate cover this hostname?
  matches: boolean | null
  error: string | null
}

export interface HostnameRow {
  hostname: string
  // Route had no hostnames of its own: the hostname comes from the Gateway listener
  fromListener: boolean
  kind: RouteInfo['kind'] | 'Ingress'
  namespace: string
  name: string
  gateway: string | null // namespace/name · listener, or the ingress class
  backends: string[]
  status: 'ok' | 'problem' | 'pending'
  message: string | null
  tls: HostnameTls | null
  customerManaged: boolean
}

const TIMEOUT_MS = 20_000

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      // "storage is (re)initializing": retry shortly
      if ((error?.code ?? error?.statusCode) === 429 && attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        continue
      }
      throw error
    }
  }
}

// Gateway API hostname matching: a listener without hostname takes everything,
// "*.example.com" takes any subdomain
function listenerTakes(listenerHost: string | null, host: string) {
  if (!listenerHost) return true
  if (listenerHost.startsWith('*.')) return host.endsWith(listenerHost.slice(1)) || host === listenerHost
  return listenerHost === host
}

function routeStatus(route: RouteInfo): Pick<HostnameRow, 'status' | 'message'> {
  if (route.parents.length === 0) return { status: 'problem', message: 'Not attached to a Gateway' }
  const problem = route.parents.find(p => p.accepted === false || p.resolvedRefs === false)
  if (problem) return { status: 'problem', message: problem.message ?? (problem.accepted === false ? 'Not accepted' : 'Backend not resolved') }
  if (route.parents.some(p => p.accepted === null)) return { status: 'pending', message: 'No status reported yet' }
  return { status: 'ok', message: null }
}

// Only the leaf certificate's metadata leaves this module, never the key
async function readCertificates(api: k8s.CoreV1Api, refs: string[]): Promise<Map<string, ReturnType<typeof describeCertificate> | { error: string }>> {
  const result = new Map<string, ReturnType<typeof describeCertificate> | { error: string }>()
  await Promise.all(
    refs.map(async ref => {
      const [namespace, name] = ref.split('/')
      try {
        const secret = await retry(() => api.readNamespacedSecret({ name, namespace }))
        const crt = secret.data?.['tls.crt']
        const leaf = crt ? splitPemChain(Buffer.from(crt, 'base64').toString('utf8'))[0] : undefined
        result.set(ref, leaf ? describeCertificate(leaf) : { error: 'No tls.crt in Secret' })
      } catch (error: any) {
        const code = error?.code ?? error?.statusCode
        result.set(ref, { error: code === 404 ? 'Secret not found' : code === 403 ? 'No access to Secret' : error?.message || 'Unreadable' })
      }
    })
  )
  return result
}

// Pure part: rows from the listed resources, with the certificates looked up by "namespace/name"
export function buildRows(
  gateways: GatewayInfo[],
  routes: RouteInfo[],
  ingresses: any[],
  customerNamespaces: Set<string>,
  certificates: Map<string, ReturnType<typeof describeCertificate> | { error: string }>
): HostnameRow[] {
  const tlsFor = (refs: string[], host: string): HostnameTls | null => {
    if (refs.length === 0) return null
    // Prefer the certificate that covers the hostname (a listener can carry several)
    const described = refs.map(ref => ({ ref, cert: certificates.get(ref) }))
    const pick = described.find(d => d.cert && !('error' in d.cert) && matchesHostname(d.cert, host)) ?? described[0]
    const cert = pick.cert
    if (!cert || 'error' in cert) {
      return { secret: pick.ref, notAfter: null, daysUntilExpiry: null, issuer: null, matches: null, error: cert?.error ?? 'Not read' }
    }
    return {
      secret: pick.ref,
      notAfter: cert.notAfter,
      daysUntilExpiry: cert.daysUntilExpiry,
      issuer: cert.issuer,
      matches: host.includes('*') ? null : matchesHostname(cert, host),
      error: null,
    }
  }

  const gatewayByKey = new Map(gateways.map(g => [`${g.namespace}/${g.name}`, g]))
  const rows: HostnameRow[] = []

  for (const route of routes) {
    const { status, message } = routeStatus(route)
    // Listeners this route is attached to
    const listeners = route.parents.flatMap(parent => {
      const gateway = gatewayByKey.get(`${parent.namespace}/${parent.name}`)
      if (!gateway) return []
      return gateway.listeners
        .filter(l => !parent.sectionName || l.name === parent.sectionName)
        .map(listener => ({ gateway, listener }))
    })
    const hosts = route.hostnames.length
      ? route.hostnames.map(h => ({ host: h, fromListener: false }))
      : Array.from(new Set(listeners.map(l => l.listener.hostname).filter((h): h is string => !!h))).map(h => ({ host: h, fromListener: true }))

    for (const { host, fromListener } of hosts) {
      const serving = listeners.filter(l => listenerTakes(l.listener.hostname, host))
      // HTTPS/TLS listener first, so the certificate is the one clients see
      const secure = serving.find(l => l.listener.certificateRefs.length > 0)
      const shown = secure ?? serving[0]
      rows.push({
        hostname: host,
        fromListener,
        kind: route.kind,
        namespace: route.namespace,
        name: route.name,
        gateway: shown ? `${shown.gateway.namespace}/${shown.gateway.name} · ${shown.listener.name}` : route.parents.map(p => `${p.namespace}/${p.name}`).join(', ') || null,
        backends: route.backends,
        status,
        message,
        tls: secure ? tlsFor(secure.listener.certificateRefs.map(r => `${r.namespace}/${r.name}`), host) : null,
        customerManaged: customerNamespaces.has(route.namespace),
      })
    }
  }

  for (const ingress of ingresses) {
    const namespace = ingress.metadata?.namespace ?? ''
    const hasAddress = (ingress.status?.loadBalancer?.ingress ?? []).length > 0
    for (const rule of ingress.spec?.rules ?? []) {
      if (!rule.host) continue
      const backends = new Set<string>()
      for (const path of rule.http?.paths ?? []) {
        const svc = path.backend?.service
        if (svc) backends.add(`${svc.name}${svc.port?.number ? `:${svc.port.number}` : svc.port?.name ? `:${svc.port.name}` : ''}`)
      }
      const tlsEntry = (ingress.spec?.tls ?? []).find((t: any) => (t.hosts ?? []).includes(rule.host) && t.secretName)
      rows.push({
        hostname: rule.host,
        fromListener: false,
        kind: 'Ingress',
        namespace,
        name: ingress.metadata?.name ?? '',
        gateway: ingress.spec?.ingressClassName ?? null,
        backends: Array.from(backends),
        status: hasAddress ? 'ok' : 'pending',
        message: hasAddress ? null : 'No load balancer address yet',
        tls: tlsEntry ? tlsFor([`${namespace}/${tlsEntry.secretName}`], rule.host) : null,
        customerManaged: customerNamespaces.has(namespace),
      })
    }
  }

  return rows.sort((a, b) => a.hostname.localeCompare(b.hostname) || a.namespace.localeCompare(b.namespace))
}

export async function getHostnames(kubeconfig: string): Promise<{ rows: HostnameRow[]; gatewayApi: boolean }> {
  const kc = new k8s.KubeConfig()
  kc.loadFromString(kubeconfig)
  const core = kc.makeApiClient(k8s.CoreV1Api)
  const networking = kc.makeApiClient(k8s.NetworkingV1Api)

  const work = async () => {
    const [gatewayApi, ingresses, namespaces] = await Promise.all([
      getGatewayApi(kubeconfig),
      retry(() => networking.listIngressForAllNamespaces()).then(r => r.items),
      retry(() => core.listNamespace()).then(r => r.items),
    ])
    const customerNamespaces = new Set(namespaces.filter(ns => isCustomerManaged(ns.metadata?.labels)).map(ns => ns.metadata?.name ?? ''))

    const refs = new Set<string>()
    for (const g of gatewayApi.gateways) for (const l of g.listeners) for (const r of l.certificateRefs) refs.add(`${r.namespace}/${r.name}`)
    for (const i of ingresses) for (const t of i.spec?.tls ?? []) if (t.secretName) refs.add(`${i.metadata?.namespace}/${t.secretName}`)
    const certificates = await readCertificates(core, Array.from(refs))

    return { rows: buildRows(gatewayApi.gateways, gatewayApi.routes, ingresses, customerNamespaces, certificates), gatewayApi: gatewayApi.installed }
  }

  return Promise.race([work(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout listing hostnames')), TIMEOUT_MS))])
}
