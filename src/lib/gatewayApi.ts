import * as k8s from '@kubernetes/client-node'

// Gateway API resources of a cluster (gateway.networking.k8s.io): GatewayClasses,
// Gateways and the routes attached to them. Every kind is optional: a missing CRD
// (or version) just yields an empty list.

export interface GatewayListener {
  name: string
  protocol: string
  port: number
  hostname: string | null
  tlsMode: string | null
  // TLS certificate Secrets of the listener (other kinds are left out)
  certificateRefs: { name: string; namespace: string }[]
  attachedRoutes: number | null
}

export interface GatewayInfo {
  name: string
  namespace: string
  gatewayClassName: string
  listeners: GatewayListener[]
  addresses: string[]
  accepted: boolean | null
  programmed: boolean | null
  message: string | null
  creationTimestamp: string | null
}

export interface RouteParent {
  name: string
  namespace: string
  sectionName: string | null
  accepted: boolean | null
  resolvedRefs: boolean | null
  message: string | null
}

export interface RouteInfo {
  kind: 'HTTPRoute' | 'GRPCRoute' | 'TLSRoute' | 'TCPRoute' | 'UDPRoute'
  name: string
  namespace: string
  hostnames: string[]
  parents: RouteParent[]
  backends: string[]
  rules: number
  creationTimestamp: string | null
}

export interface GatewayClassInfo {
  name: string
  controllerName: string
  accepted: boolean | null
  description: string | null
}

export interface GatewayApiData {
  installed: boolean
  gatewayClasses: GatewayClassInfo[]
  gateways: GatewayInfo[]
  routes: RouteInfo[]
}

const GROUP = 'gateway.networking.k8s.io'
const TIMEOUT_MS = 20_000

// Served versions differ per installation (standard vs experimental channel, age)
const KINDS: { plural: string; versions: string[] }[] = [
  { plural: 'gatewayclasses', versions: ['v1', 'v1beta1'] },
  { plural: 'gateways', versions: ['v1', 'v1beta1'] },
  { plural: 'httproutes', versions: ['v1', 'v1beta1'] },
  { plural: 'grpcroutes', versions: ['v1', 'v1alpha2'] },
  { plural: 'tlsroutes', versions: ['v1alpha3', 'v1alpha2'] },
  { plural: 'tcproutes', versions: ['v1alpha2'] },
  { plural: 'udproutes', versions: ['v1alpha2'] },
]

function condition(conditions: any[] | undefined, type: string): { status: boolean | null; message: string | null } {
  const c = conditions?.find(x => x.type === type)
  if (!c) return { status: null, message: null }
  return { status: c.status === 'True', message: c.status === 'True' ? null : c.message || c.reason || null }
}

// null when the kind is not served (CRD not installed)
async function listKind(api: k8s.CustomObjectsApi, plural: string, versions: string[]): Promise<any[] | null> {
  for (const version of versions) {
    for (let attempt = 1; ; attempt++) {
      try {
        const res: any = await api.listClusterCustomObject({ group: GROUP, version, plural })
        return res.items || []
      } catch (error: any) {
        const code = error?.code ?? error?.statusCode
        if (code === 404) break // try the next version
        // "storage is (re)initializing": retry shortly
        if (code === 429 && attempt < 4) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
          continue
        }
        throw error
      }
    }
  }
  return null
}

function toGateway(g: any): GatewayInfo {
  const listenerStatus = new Map((g.status?.listeners ?? []).map((l: any) => [l.name, l]))
  const accepted = condition(g.status?.conditions, 'Accepted')
  const programmed = condition(g.status?.conditions, 'Programmed')
  return {
    name: g.metadata?.name ?? '',
    namespace: g.metadata?.namespace ?? '',
    gatewayClassName: g.spec?.gatewayClassName ?? '',
    listeners: (g.spec?.listeners ?? []).map((l: any) => ({
      name: l.name,
      protocol: l.protocol,
      port: l.port,
      hostname: l.hostname ?? null,
      tlsMode: l.tls?.mode ?? null,
      certificateRefs: (l.tls?.certificateRefs ?? [])
        .filter((ref: any) => (ref.kind ?? 'Secret') === 'Secret' && !ref.group)
        .map((ref: any) => ({ name: ref.name, namespace: ref.namespace ?? g.metadata?.namespace ?? '' })),
      attachedRoutes: (listenerStatus.get(l.name) as any)?.attachedRoutes ?? null,
    })),
    addresses: (g.status?.addresses ?? []).map((a: any) => a.value).filter(Boolean),
    accepted: accepted.status,
    programmed: programmed.status,
    message: accepted.message ?? programmed.message,
    creationTimestamp: g.metadata?.creationTimestamp ?? null,
  }
}

function toRoute(kind: RouteInfo['kind'], r: any): RouteInfo {
  const namespace = r.metadata?.namespace ?? ''
  const statusByParent = new Map(
    (r.status?.parents ?? []).map((p: any) => [`${p.parentRef?.namespace ?? namespace}/${p.parentRef?.name}/${p.parentRef?.sectionName ?? ''}`, p])
  )
  const backends = new Set<string>()
  for (const rule of r.spec?.rules ?? []) {
    for (const b of rule.backendRefs ?? []) {
      const ns = b.namespace && b.namespace !== namespace ? `${b.namespace}/` : ''
      const kindPrefix = b.kind && b.kind !== 'Service' ? `${b.kind}:` : ''
      backends.add(`${kindPrefix}${ns}${b.name}${b.port ? `:${b.port}` : ''}${b.weight !== undefined && b.weight !== 1 ? ` (${b.weight})` : ''}`)
    }
  }
  return {
    kind,
    name: r.metadata?.name ?? '',
    namespace,
    hostnames: r.spec?.hostnames ?? [],
    parents: (r.spec?.parentRefs ?? []).map((p: any) => {
      const parentNs = p.namespace ?? namespace
      const status: any = statusByParent.get(`${parentNs}/${p.name}/${p.sectionName ?? ''}`)
      const accepted = condition(status?.conditions, 'Accepted')
      const resolved = condition(status?.conditions, 'ResolvedRefs')
      return {
        name: p.name,
        namespace: parentNs,
        sectionName: p.sectionName ?? null,
        accepted: accepted.status,
        resolvedRefs: resolved.status,
        message: accepted.message ?? resolved.message,
      }
    }),
    backends: Array.from(backends),
    rules: (r.spec?.rules ?? []).length,
    creationTimestamp: r.metadata?.creationTimestamp ?? null,
  }
}

const ROUTE_KINDS: Record<string, RouteInfo['kind']> = {
  httproutes: 'HTTPRoute',
  grpcroutes: 'GRPCRoute',
  tlsroutes: 'TLSRoute',
  tcproutes: 'TCPRoute',
  udproutes: 'UDPRoute',
}

export async function getGatewayApi(kubeconfig: string): Promise<GatewayApiData> {
  const kc = new k8s.KubeConfig()
  kc.loadFromString(kubeconfig)
  const api = kc.makeApiClient(k8s.CustomObjectsApi)

  const lists = await Promise.race([
    Promise.all(KINDS.map(k => listKind(api, k.plural, k.versions).catch(() => null))),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout listing Gateway API resources')), TIMEOUT_MS)),
  ])
  const byPlural = new Map(KINDS.map((k, i) => [k.plural, lists[i]]))

  return {
    installed: byPlural.get('gateways') !== null || byPlural.get('gatewayclasses') !== null,
    gatewayClasses: (byPlural.get('gatewayclasses') ?? []).map((c: any) => {
      const accepted = condition(c.status?.conditions, 'Accepted')
      return { name: c.metadata?.name ?? '', controllerName: c.spec?.controllerName ?? '', accepted: accepted.status, description: c.spec?.description ?? null }
    }),
    gateways: (byPlural.get('gateways') ?? []).map(toGateway),
    routes: Object.entries(ROUTE_KINDS).flatMap(([plural, kind]) => (byPlural.get(plural) ?? []).map((r: any) => toRoute(kind, r))),
  }
}

export const __internals = { toGateway, toRoute }
