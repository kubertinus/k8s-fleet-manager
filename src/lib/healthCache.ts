import { KubernetesClient } from '@/lib/kubernetes'

// Server-side cache for per-cluster health checks.
//
// A health check fans out to a dozen Kubernetes API calls, so we never want two
// running for the same cluster at the same time (several browser tabs, the
// dashboard and the cluster page all poll). Results are served from memory while
// fresh, and while merely stale they are served immediately and refreshed in the
// background (stale-while-revalidate). The cost of a dashboard refresh therefore
// no longer grows with the number of open tabs, and the browser never waits on
// a slow cluster when an older answer is available.

const FRESH_MS = 20_000
const STALE_MS = 5 * 60_000
const CHECK_TIMEOUT_MS = 15_000

export interface ClusterRow {
  id: number
  name: string
  kubeconfig: string
  talosconfig?: string
}

export interface ClusterHealthResult {
  id: number
  name: string
  status: string
  healthyNodes: number
  totalNodes: number
  lastChecked: string
  error?: string
  [key: string]: unknown
}

interface Entry {
  data?: ClusterHealthResult
  at: number
  inflight?: Promise<ClusterHealthResult>
}

// Kept on globalThis so dev-mode hot reloads don't drop the cache.
const store: Map<number, Entry> = ((globalThis as any).__k8sFleetManagerHealthCache ??= new Map())

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)),
  ])
}

async function runCheck(cluster: ClusterRow): Promise<ClusterHealthResult> {
  try {
    const client = new KubernetesClient(cluster.kubeconfig, cluster.talosconfig)
    const health: any = await withTimeout(client.getClusterHealth({ lite: true }), CHECK_TIMEOUT_MS)

    return {
      id: cluster.id,
      name: cluster.name,
      status: health.status || 'unknown',
      healthyNodes: health.healthyNodes || 0,
      totalNodes: health.totalNodes || 0,
      totalPods: health.totalPods || 0,
      totalNamespaces: health.totalNamespaces || 0,
      customerManagedNamespaces: health.customerManagedNamespaces || [],
      customerManagedPods: health.customerManagedPods || 0,
      avgCpuPercent: health.avgCpuPercent || 0,
      avgMemoryPercent: health.avgMemoryPercent || 0,
      kubernetesVersion: health.kubernetesVersion,
      talosVersion: health.talosVersion,
      cni: health.cni,
      storageDrivers: health.storageDrivers,
      ingressControllers: health.ingressControllers,
      lastChecked: new Date().toISOString(),
      nodes: health.nodes || [],
      podErrors: health.podErrors || [],
      podResourceWarnings: health.podResourceWarnings || [],
      certificateWarnings: (health.certificateWarnings || []).filter((cert: any) => cert.severity === 'warning'),
      certificateErrors: (health.certificateWarnings || []).filter((cert: any) => cert.severity === 'error'),
      cordonedNodeWarnings: health.cordonedNodeWarnings || [],
      cordonedNodeErrors: health.cordonedNodeErrors || [],
      recentEventErrors: health.recentEventErrors || [],
      velero: health.velero ?? null,
    }
  } catch (error: any) {
    console.error(`Error getting health for cluster ${cluster.name}:`, error.message)
    return {
      id: cluster.id,
      name: cluster.name,
      status: error.message?.includes('Timeout') ? 'timeout' : 'error',
      healthyNodes: 0,
      totalNodes: 0,
      lastChecked: new Date().toISOString(),
      error: error.message,
    }
  }
}

function startCheck(cluster: ClusterRow, entry: Entry): Promise<ClusterHealthResult> {
  if (!entry.inflight) {
    entry.inflight = runCheck(cluster)
      .then(data => {
        entry.data = data
        entry.at = Date.now()
        return data
      })
      .finally(() => {
        entry.inflight = undefined
      })
  }
  return entry.inflight
}

export async function getClusterHealthCached(
  cluster: ClusterRow,
  { force = false }: { force?: boolean } = {}
): Promise<{ data: ClusterHealthResult; ageMs: number }> {
  let entry = store.get(cluster.id)
  if (!entry) {
    entry = { at: 0 }
    store.set(cluster.id, entry)
  }

  const age = Date.now() - entry.at

  if (entry.data && !force) {
    if (age < FRESH_MS) return { data: entry.data, ageMs: age }
    if (age < STALE_MS) {
      startCheck(cluster, entry).catch(() => {})
      return { data: entry.data, ageMs: age }
    }
  }

  const data = await startCheck(cluster, entry)
  return { data, ageMs: 0 }
}

export function invalidateClusterHealth(clusterId: number) {
  store.delete(clusterId)
}
