import { withoutNamespaces } from '@/lib/customerManaged'
import type { VeleroSummary } from '@/lib/velero'

export interface ClusterNode {
  name: string
  status: string
  cpuUsage: string | number
  cpuCapacity: string | number
  memoryUsage: string | number
  memoryCapacity: string | number
  isControlPlane: boolean
  internalIP?: string
  labels?: Record<string, string>
}

export interface PodError {
  name: string
  namespace: string
  phase: string
  reason?: string
}

export interface PodResourceWarning {
  name: string
  namespace: string
  cpuPercent?: number
  memoryPercent?: number
  cpuUsage?: string
  cpuCapacity?: string
  memoryUsage?: string
  memoryCapacity?: string
}

export interface CertificateWarning {
  name: string
  namespace: string
  expiresAt: string
  daysUntilExpiry: number
  severity?: 'error' | 'warning'
}

export interface EventError {
  type: string
  reason: string
  message: string
  involvedObject: {
    kind: string
    name: string
    namespace?: string
  }
  firstTime: string
  lastTime: string
  count: number
}

export interface CordonedNodeWarning {
  name: string
  reason: string
  cordonedSince: string
  isReady: boolean
}

export interface ClusterHealth {
  id: number
  name: string
  status: string
  healthyNodes: number
  totalNodes: number
  totalPods?: number
  totalNamespaces?: number
  // Namespaces labelled customer_managed=yes, and how many pods run in them
  customerManagedNamespaces?: string[]
  customerManagedPods?: number
  avgCpuPercent?: number
  avgMemoryPercent?: number
  kubernetesVersion?: string
  talosVersion?: string
  cni?: string
  storageDrivers?: string[]
  ingressControllers?: string[]
  lastChecked: string
  nodes?: ClusterNode[]
  podErrors?: PodError[]
  podResourceWarnings?: PodResourceWarning[]
  certificateWarnings?: CertificateWarning[]
  certificateErrors?: CertificateWarning[]
  cordonedNodeWarnings?: CordonedNodeWarning[]
  cordonedNodeErrors?: CordonedNodeWarning[]
  recentEventErrors?: EventError[]
  velero?: VeleroSummary | null
  // Days until the stored kubeconfig's client certificate expires (from /api/clusters/quick)
  credentialExpiresInDays?: number | null
  error?: string
  isLoading?: boolean
}

// The cluster as shown with "hide customer managed" on: warnings from customer-managed
// namespaces removed and pod/namespace counts adjusted. Node-level data stays.
export function withoutCustomerManaged(cluster: ClusterHealth): ClusterHealth {
  const hidden = new Set(cluster.customerManagedNamespaces || [])
  if (hidden.size === 0) return cluster
  const issues = withoutNamespaces(
    {
      podErrors: cluster.podErrors,
      podResourceWarnings: cluster.podResourceWarnings,
      certificateWarnings: cluster.certificateWarnings,
      certificateErrors: cluster.certificateErrors,
      recentEventErrors: cluster.recentEventErrors,
    },
    hidden
  )
  return {
    ...cluster,
    ...issues,
    totalPods: cluster.totalPods !== undefined ? cluster.totalPods - (cluster.customerManagedPods || 0) : undefined,
    totalNamespaces: cluster.totalNamespaces !== undefined ? cluster.totalNamespaces - hidden.size : undefined,
  }
}

export interface IssueCounts {
  critical: number
  warning: number
}

// Expiry of the kubeconfig credentials: critical under a week, warning under a month
export const CREDENTIAL_CRITICAL_DAYS = 7
export const CREDENTIAL_WARNING_DAYS = 30

export function credentialSeverity(cluster: ClusterHealth): 'critical' | 'warning' | null {
  const days = cluster.credentialExpiresInDays
  if (days === null || days === undefined) return null
  if (days < CREDENTIAL_CRITICAL_DAYS) return 'critical'
  if (days < CREDENTIAL_WARNING_DAYS) return 'warning'
  return null
}

export function issueCounts(cluster: ClusterHealth): IssueCounts {
  const velero = cluster.velero?.warnings ?? []
  const credential = credentialSeverity(cluster)
  return {
    critical:
      (cluster.podErrors?.length || 0) +
      (cluster.certificateErrors?.length || 0) +
      (cluster.cordonedNodeErrors?.length || 0) +
      (cluster.recentEventErrors?.length || 0) +
      velero.filter(w => w.severity === 'critical').length +
      (credential === 'critical' ? 1 : 0),
    warning:
      (cluster.podResourceWarnings?.length || 0) +
      (cluster.certificateWarnings?.length || 0) +
      (cluster.cordonedNodeWarnings?.length || 0) +
      velero.filter(w => w.severity === 'warning').length +
      (credential === 'warning' ? 1 : 0),
  }
}

export function isUnreachable(cluster: ClusterHealth) {
  return ['error', 'timeout', 'unreachable'].includes(cluster.status)
}

// Sort weight: broken clusters first, then the ones with issues, then healthy.
export function attentionRank(cluster: ClusterHealth) {
  if (isUnreachable(cluster)) return 0
  const { critical, warning } = issueCounts(cluster)
  if (critical > 0) return 1
  if (warning > 0 || cluster.status === 'warning') return 2
  if (cluster.status === 'healthy') return 4
  return 3
}
