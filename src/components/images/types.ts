export type ImageStatus = 'update' | 'current' | 'unversioned' | 'pinned' | 'error' | 'pending'
export type UpdateType = 'major' | 'minor' | 'patch'
export type CveSeverity = 'None' | 'Unknown' | 'Low' | 'Medium' | 'High' | 'Critical'

export interface ImageUsage {
  clusterId: number
  clusterName: string
  namespace: string
  kind: string
  workload: string
  container: string
  initContainer: boolean
  customerManaged: boolean
}

export interface ReportImage {
  image: string
  registry: string
  repository: string
  name: string
  tag: string | null
  digest: string | null
  status: ImageStatus
  latestVersion: string | null
  updateType: UpdateType | null
  latestInMajor: string | null
  source: 'nexus' | 'online' | null
  error: string | null
  checkedAt: string | null
  cveSeverity: CveSeverity | null
  cveCritical: number | null
  cveHigh: number | null
  cveMedium: number | null
  cveLow: number | null
  cveTotal: number | null
  cveFixable: number | null
  cveScannedAt: string | null
  cveError: string | null
  usages: ImageUsage[]
}

export interface ScanRun {
  id: number
  trigger: 'scheduled' | 'manual'
  status: 'running' | 'completed' | 'failed'
  started_at: string
  finished_at: string | null
  clusters_total: number
  clusters_failed: number
  images_total: number
  updates_found: number
  error: string | null
}

export interface ClusterScan {
  id: number
  name: string
  scannedAt: string | null
  attemptedAt: string | null
  error: string | null
}

export interface Schedule {
  enabled: boolean
  time: string
  timezone: string
  nextRunAt: string | null
}

export interface ImageReportData {
  images: ReportImage[]
  clusters: ClusterScan[]
  running: ScanRun | null
  lastRun: ScanRun | null
  schedule: Schedule
  canEditSchedule: boolean
}

export type StatusFilter = 'all' | 'update' | 'current' | 'other' | 'error'

// Display order: what needs action first.
export function statusRank(image: ReportImage) {
  if (image.status === 'update') return image.updateType === 'major' ? 0 : image.updateType === 'minor' ? 1 : 2
  return { error: 3, pending: 4, unversioned: 5, pinned: 6, current: 7, update: 0 }[image.status]
}

export function matchesStatus(image: ReportImage, filter: StatusFilter) {
  switch (filter) {
    case 'update':
      return image.status === 'update'
    case 'current':
      return image.status === 'current'
    case 'other':
      return image.status === 'unversioned' || image.status === 'pinned' || image.status === 'pending'
    case 'error':
      return image.status === 'error'
    default:
      return true
  }
}

// "2C · 5H": only the severities that actually occur.
export function cveCountLabel(image: Pick<ReportImage, 'cveCritical' | 'cveHigh' | 'cveMedium' | 'cveLow'>) {
  const parts: [number | null, string][] = [
    [image.cveCritical, 'C'],
    [image.cveHigh, 'H'],
    [image.cveMedium, 'M'],
    [image.cveLow, 'L'],
  ]
  return parts
    .filter((part): part is [number, string] => typeof part[0] === 'number' && part[0] > 0)
    .map(([count, letter]) => `${count}${letter}`)
    .join(' · ')
}

export function relativeTime(iso: string | null | undefined) {
  if (!iso) return 'never'
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
