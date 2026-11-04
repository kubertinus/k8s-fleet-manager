import type { VeleroBackup, VeleroData, VeleroWarning } from './velero'

// Fleet-wide view of Velero backups: one row per cluster plus helpers for the
// daily outcome grid. Pure and free of the Kubernetes client, so the page can use it too.

export type FleetBackupStatus = 'ok' | 'warning' | 'critical' | 'not-installed' | 'unreachable'
export type DayOutcome = 'none' | 'completed' | 'partial' | 'failed' | 'running'

export interface FleetBackupCluster {
  id: number
  name: string
  status: FleetBackupStatus
  error: string | null
  warnings: VeleroWarning[]
  schedules: { total: number; active: number }
  locations: { name: string; phase: string | null }[]
  lastBackup: VeleroBackup | null
  lastSuccessful: VeleroBackup | null
  // Backups that started within RECENT_DAYS, newest first
  recent: VeleroBackup[]
}

export const RECENT_DAYS = 14
const FAILED = new Set(['Failed', 'FailedValidation'])
const RUNNING = new Set(['New', 'InProgress', 'WaitingForPluginOperations', 'WaitingForPluginOperationsPartiallyFailed', 'Finalizing', 'FinalizingPartiallyFailed'])

export function outcomeOf(phase: string): DayOutcome {
  if (phase === 'Completed') return 'completed'
  if (phase === 'PartiallyFailed') return 'partial'
  if (FAILED.has(phase)) return 'failed'
  if (RUNNING.has(phase)) return 'running'
  return 'none'
}

export function clusterBackupStatus(data: VeleroData | null, error: string | null): FleetBackupStatus {
  if (error || !data) return 'unreachable'
  if (!data.installed) return 'not-installed'
  if (data.warnings.some(w => w.severity === 'critical')) return 'critical'
  if (data.warnings.length > 0) return 'warning'
  return 'ok'
}

const startedAt = (b: VeleroBackup) => Date.parse(b.startTimestamp ?? '') || 0

export function toFleetCluster(cluster: { id: number; name: string }, data: VeleroData | null, error: string | null, now = Date.now()): FleetBackupCluster {
  const since = now - RECENT_DAYS * 86_400_000
  const backups = data?.backups ?? []
  return {
    id: cluster.id,
    name: cluster.name,
    status: clusterBackupStatus(data, error),
    error,
    warnings: data?.warnings ?? [],
    schedules: { total: data?.schedules.length ?? 0, active: data?.schedules.filter(s => !s.paused).length ?? 0 },
    locations: (data?.locations ?? []).map(l => ({ name: l.name, phase: l.phase })),
    lastBackup: backups[0] ?? null,
    lastSuccessful: backups.find(b => b.phase === 'Completed') ?? null,
    recent: backups.filter(b => startedAt(b) >= since),
  }
}

export interface OutcomeCounts {
  completed: number
  partial: number
  failed: number
  running: number
}

const emptyCounts = (): OutcomeCounts => ({ completed: 0, partial: 0, failed: 0, running: 0 })

function count(into: OutcomeCounts, backup: VeleroBackup) {
  const outcome = outcomeOf(backup.phase)
  if (outcome !== 'none') into[outcome]++
}

// Outcomes of the backups started within the last `days` days
export function outcomeCounts(backups: VeleroBackup[], days: number, now = Date.now()): OutcomeCounts {
  const since = now - days * 86_400_000
  const counts = emptyCounts()
  for (const b of backups) if (startedAt(b) >= since) count(counts, b)
  return counts
}

// Share of finished backups that completed without errors; null when nothing finished
export function successRate(counts: OutcomeCounts): number | null {
  const finished = counts.completed + counts.partial + counts.failed
  return finished === 0 ? null : counts.completed / finished
}

export interface DayBucket extends OutcomeCounts {
  // Local midnight of the day
  date: Date
  outcome: DayOutcome
}

// The worst outcome wins: one failed backup makes the day red
export function worstOutcome(counts: OutcomeCounts): DayOutcome {
  if (counts.failed) return 'failed'
  if (counts.partial) return 'partial'
  if (counts.completed) return 'completed'
  if (counts.running) return 'running'
  return 'none'
}

// One bucket per local calendar day, oldest first, ending today
export function dailyBuckets(backups: VeleroBackup[], days = RECENT_DAYS, now = new Date()): DayBucket[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const buckets: DayBucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    buckets.push({ date: new Date(today.getFullYear(), today.getMonth(), today.getDate() - i), outcome: 'none', ...emptyCounts() })
  }
  for (const b of backups) {
    const start = startedAt(b)
    if (!start) continue
    const d = new Date(start)
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const bucket = buckets.find(x => x.date.getTime() === day)
    if (bucket) count(bucket, b)
  }
  for (const bucket of buckets) bucket.outcome = worstOutcome(bucket)
  return buckets
}
