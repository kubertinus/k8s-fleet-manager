import { NextRequest, NextResponse } from 'next/server'
import { initializeDatabase, query } from '@/lib/database'
import { verifyToken } from '@/lib/auth'
import { KubernetesClient } from '@/lib/kubernetes'

type FlowAction = 'Allow' | 'Drop' | 'Reject' | 'Unknown'

interface NormalizedFlow {
  sourceId: string
  targetId: string
  sourcePort?: number
  targetPort?: number
  ports?: number[]
  action: FlowAction
  packets: number
  bytes: number
  lastSeen?: string
}

const sanitizeK8sName = (value: string) => value.replace(/[^a-zA-Z0-9-]/g, '-')

const toNodeId = (kind: string | undefined, namespace: string, name: string) => {
  const ns = sanitizeK8sName(namespace)
  const resourceName = sanitizeK8sName(name)
  const normalizedKind = (kind || '').toLowerCase()

  if (normalizedKind.includes('service') || normalizedKind === 'svc') {
    return `service-${ns}-${resourceName}`
  }

  return `pod-${ns}-${resourceName}`
}

const parseAction = (raw: unknown): FlowAction => {
  const value = String(raw || '').toLowerCase()
  if (value.includes('drop') || value.includes('deny')) return 'Drop'
  if (value.includes('reject')) return 'Reject'
  if (value.includes('allow') || value.includes('accept') || value.includes('pass')) return 'Allow'
  return 'Unknown'
}

const parsePort = (value: unknown): number | undefined => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return undefined
  const port = Math.trunc(numeric)
  if (port < 1 || port > 65535) return undefined
  return port
}

const extractPorts = (flow: any): number[] => {
  const candidateValues: unknown[] = [
    ...(Array.isArray(flow?.ports) ? flow.ports : []),
    flow?.targetPort,
    flow?.destinationPort,
    flow?.destinationTransportPort,
    flow?.destinationServicePort,
    flow?.sourcePort,
    flow?.sourceTransportPort
  ]

  const ports = candidateValues
    .map((value) => parsePort(value))
    .filter((port): port is number => port !== undefined)

  return Array.from(new Set(ports))
}

const normalizeFlow = (flow: any): NormalizedFlow | null => {
  if (flow?.sourceId && flow?.targetId) {
    const ports = extractPorts(flow)
    return {
      sourceId: String(flow.sourceId),
      targetId: String(flow.targetId),
      sourcePort: parsePort(flow.sourcePort || flow.sourceTransportPort),
      targetPort: parsePort(flow.targetPort || flow.destinationPort || flow.destinationTransportPort || flow.destinationServicePort),
      ports,
      action: parseAction(flow.action || flow.verdict || flow.disposition),
      packets: Number(flow.packets || flow.packetCount || flow.totalPackets || 0),
      bytes: Number(flow.bytes || flow.byteCount || flow.totalBytes || 0),
      lastSeen: flow.lastSeen || flow.endTime || flow.timestamp
    }
  }

  const source = flow?.source || flow?.src || {}
  const destination = flow?.destination || flow?.dst || {}

  const sourceNamespace = source.namespace || flow.sourceNamespace || flow.srcNamespace
  const sourceName = source.pod || source.name || flow.sourcePod || flow.srcPod

  const destinationNamespace = destination.namespace || flow.destinationNamespace || flow.dstNamespace
  const destinationPod = destination.pod || flow.destinationPod || flow.dstPod
  const destinationService = destination.service || flow.destinationService || flow.dstService

  if (!sourceNamespace || !sourceName || !destinationNamespace || (!destinationPod && !destinationService)) {
    return null
  }

  const sourceId = toNodeId(source.kind || flow.sourceType, sourceNamespace, sourceName)
  const targetId = destinationService
    ? toNodeId('service', destinationNamespace, destinationService)
    : toNodeId(destination.kind || flow.destinationType, destinationNamespace, destinationPod)

  const sourcePort = parsePort(source.port || flow.sourcePort || flow.sourceTransportPort)
  const targetPort = parsePort(
    destination.port ||
    flow.targetPort ||
    flow.destinationPort ||
    flow.destinationTransportPort ||
    flow.destinationServicePort
  )
  const ports = Array.from(new Set([targetPort, sourcePort].filter((port): port is number => port !== undefined)))

  return {
    sourceId,
    targetId,
    sourcePort,
    targetPort,
    ports,
    action: parseAction(flow.action || flow.verdict || flow.disposition),
    packets: Number(flow.packets || flow.packetCount || flow.totalPackets || 0),
    bytes: Number(flow.bytes || flow.byteCount || flow.totalBytes || 0),
    lastSeen: flow.lastSeen || flow.endTime || flow.timestamp
  }
}

const aggregateFlows = (flows: NormalizedFlow[]) => {
  const map = new Map<string, NormalizedFlow>()

  for (const flow of flows) {
    const key = `${flow.sourceId}->${flow.targetId}`
    const existing = map.get(key)

    if (!existing) {
      map.set(key, { ...flow })
      continue
    }

    const mergedAction: FlowAction =
      existing.action === 'Drop' || flow.action === 'Drop'
        ? 'Drop'
        : existing.action === 'Reject' || flow.action === 'Reject'
          ? 'Reject'
          : existing.action === 'Allow' || flow.action === 'Allow'
            ? 'Allow'
            : 'Unknown'

    map.set(key, {
      ...existing,
      action: mergedAction,
      sourcePort: flow.sourcePort ?? existing.sourcePort,
      targetPort: flow.targetPort ?? existing.targetPort,
      ports: Array.from(new Set([...(existing.ports || []), ...(flow.ports || [])])),
      packets: existing.packets + flow.packets,
      bytes: existing.bytes + flow.bytes,
      lastSeen: flow.lastSeen || existing.lastSeen
    })
  }

  return Array.from(map.values())
}

const ensureHttpProtocol = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  return `http://${trimmed}`
}

const buildSourceUrl = (template: string, clusterId: string, namespace: string | null, window: string) => {
  const replaced = ensureHttpProtocol(template).replace('{clusterId}', clusterId)
  const url = new URL(replaced)

  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/flows'
  }

  if (namespace) {
    url.searchParams.set('namespace', namespace)
  }

  url.searchParams.set('window', window)
  return url.toString()
}

const externalNodeIdToIp = (nodeId: string) => {
  if (!nodeId.startsWith('external-')) return null
  const ip = nodeId.replace(/^external-/, '').replace(/-/g, '.')
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null
  return ip
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let hasConfiguredSource = false

  try {
    const token = request.cookies.get('auth-token')?.value
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    await initializeDatabase()

    const { id } = await params
    const clusterId = parseInt(id, 10)
    if (isNaN(clusterId)) {
      return NextResponse.json({ error: 'Invalid cluster ID' }, { status: 400 })
    }

    const url = new URL(request.url)
    const namespace = url.searchParams.get('namespace')
    const window = url.searchParams.get('window') || '24h'

    const clusterResult = await query(
      'SELECT id, kubeconfig, talosconfig FROM clusters WHERE id = $1 AND is_active = true',
      [clusterId]
    )

    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
    }

    const cluster = clusterResult.rows[0]

    const settingsResult = await query(
      `SELECT key, value FROM settings WHERE key IN ('antrea_flow_api_url', 'antrea_flow_api_token')`
    )

    const settings: Record<string, string> = {}
    for (const row of settingsResult.rows) {
      settings[row.key] = row.value
    }

    const flowApiUrl = settings.antrea_flow_api_url || process.env.ANTREA_FLOW_API_URL || ''
    const flowApiToken = settings.antrea_flow_api_token || process.env.ANTREA_FLOW_API_TOKEN || ''
    hasConfiguredSource = Boolean(flowApiUrl)

    if (!flowApiUrl) {
      return NextResponse.json({
        configured: false,
        namespace: namespace || 'all',
        window,
        flows: []
      })
    }

    const sourceUrl = buildSourceUrl(flowApiUrl, String(clusterId), namespace, window)
    const headers: HeadersInit = { Accept: 'application/json' }
    if (flowApiToken) {
      headers.Authorization = `Bearer ${flowApiToken}`
    }

    const response = await fetch(sourceUrl, { headers, cache: 'no-store' })
    if (!response.ok) {
      const body = await response.text()
      return NextResponse.json(
        {
          configured: true,
          namespace: namespace || 'all',
          window,
          flows: [],
          error: `Flow source returned HTTP ${response.status}`,
          details: body.slice(0, 400)
        },
        { status: 502 }
      )
    }

    const payload = await response.json()
    const rawFlows = Array.isArray(payload) ? payload : (payload?.flows || [])

    let podIpToNodeId = new Map<string, string>()
    try {
      const k8sClient = new KubernetesClient(cluster.kubeconfig, cluster.talosconfig)
      const pods = await k8sClient['k8sApi'].listPodForAllNamespaces()
      podIpToNodeId = new Map(
        (pods.body.items || [])
          .map((pod: any) => {
            const podIp = pod?.status?.podIP
            const podNamespace = pod?.metadata?.namespace
            const podName = pod?.metadata?.name
            if (!podIp || !podNamespace || !podName) {
              return null
            }
            return [String(podIp), `pod-${sanitizeK8sName(String(podNamespace))}-${sanitizeK8sName(String(podName))}`] as const
          })
          .filter((entry): entry is readonly [string, string] => entry !== null)
      )
    } catch (mappingError) {
      console.warn('Failed to build pod IP mapping for network flows:', mappingError)
    }

    const normalized = rawFlows
      .map(normalizeFlow)
      .filter((flow: NormalizedFlow | null): flow is NormalizedFlow => flow !== null)
      .map((flow) => {
        const sourceIp = externalNodeIdToIp(flow.sourceId)
        const targetIp = externalNodeIdToIp(flow.targetId)
        return {
          ...flow,
          sourceId: sourceIp ? (podIpToNodeId.get(sourceIp) || flow.sourceId) : flow.sourceId,
          targetId: targetIp ? (podIpToNodeId.get(targetIp) || flow.targetId) : flow.targetId
        }
      })

    return NextResponse.json({
      configured: true,
      namespace: namespace || 'all',
      window,
      source: sourceUrl,
      flows: aggregateFlows(normalized)
    })
  } catch (error) {
    console.error('Error fetching Antrea network flows:', error)
    return NextResponse.json(
      {
        configured: hasConfiguredSource,
        namespace: 'all',
        window: '24h',
        flows: [],
        error: error instanceof Error ? error.message : 'Failed to fetch Antrea flow data'
      },
      { status: hasConfiguredSource ? 502 : 500 }
    )
  }
}
