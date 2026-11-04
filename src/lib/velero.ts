import * as k8s from '@kubernetes/client-node'

// Velero backups of a cluster (velero.io/v1): backups, schedules and storage
// locations, plus warnings about anything that suggests backups aren't working.

export interface VeleroBackup {
  name: string
  namespace: string
  phase: string
  schedule: string | null
  startTimestamp: string | null
  completionTimestamp: string | null
  durationSeconds: number | null
  expiration: string | null
  itemsBackedUp: number | null
  totalItems: number | null
  errors: number
  warnings: number
  storageLocation: string | null
}

export interface VeleroSchedule {
  name: string
  namespace: string
  schedule: string
  paused: boolean
  phase: string | null
  lastBackup: string | null
  intervalHours: number | null
}

export interface VeleroLocation {
  name: string
  namespace: string
  phase: string | null
  default: boolean
  provider: string | null
  bucket: string | null
  lastValidated: string | null
}

export interface VeleroWarning {
  severity: 'critical' | 'warning'
  message: string
}

export interface VeleroSummary {
  installed: boolean
  lastBackup: VeleroBackup | null
  schedules: VeleroSchedule[]
  locations: VeleroLocation[]
  warnings: VeleroWarning[]
}

export interface VeleroData extends VeleroSummary {
  backups: VeleroBackup[]
}

const GROUP = 'velero.io'
const VERSION = 'v1'
const TIMEOUT_MS = 20_000
// A drop of more than this fraction in backed-up items between two runs of the same schedule
const ITEM_DROP_THRESHOLD = 0.3
// Without a schedule interval, a backup older than this is stale
const DEFAULT_MAX_AGE_HOURS = 26

async function listKind(api: k8s.CustomObjectsApi, plural: string): Promise<any[] | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res: any = await api.listClusterCustomObject({ group: GROUP, version: VERSION, plural })
      return res.items || []
    } catch (error: any) {
      const code = error?.code ?? error?.statusCode
      if (code === 404) return null // Velero not installed
      if (code === 429 && attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        continue
      }
      throw error
    }
  }
}

// Approximate interval of a cron expression or Velero's "@every 6h" in hours
export function scheduleIntervalHours(expression: string): number | null {
  const spec = expression.trim().replace(/^CRON_TZ=\S+\s+|^TZ=\S+\s+/, '')
  const every = spec.match(/^@every\s+(?:(\d+)h)?(?:(\d+)m)?/)
  if (every && (every[1] || every[2])) return Number(every[1] ?? 0) + Number(every[2] ?? 0) / 60
  const named: Record<string, number> = { '@hourly': 1, '@daily': 24, '@midnight': 24, '@weekly': 168, '@monthly': 744, '@yearly': 8760, '@annually': 8760 }
  if (named[spec]) return named[spec]
  const fields = spec.split(/\s+/)
  if (fields.length < 5) return null
  const [, hour, dom, , dow] = fields
  if (dow !== '*') return 168
  if (dom !== '*') return 744
  if (hour === '*') return 1
  const step = hour.match(/^\*\/(\d+)$/)
  if (step) return Number(step[1])
  const count = hour.split(',').length
  return count > 1 ? 24 / count : 24
}

function toBackup(b: any): VeleroBackup {
  const start = b.status?.startTimestamp ?? null
  const end = b.status?.completionTimestamp ?? null
  return {
    name: b.metadata?.name ?? '',
    namespace: b.metadata?.namespace ?? '',
    phase: b.status?.phase ?? 'Unknown',
    schedule: b.metadata?.labels?.['velero.io/schedule-name'] ?? null,
    startTimestamp: start,
    completionTimestamp: end,
    durationSeconds: start && end ? Math.round((Date.parse(end) - Date.parse(start)) / 1000) : null,
    expiration: b.status?.expiration ?? null,
    itemsBackedUp: b.status?.progress?.itemsBackedUp ?? null,
    totalItems: b.status?.progress?.totalItems ?? null,
    errors: b.status?.errors ?? 0,
    warnings: b.status?.warnings ?? 0,
    storageLocation: b.spec?.storageLocation ?? null,
  }
}

const startedAt = (b: VeleroBackup) => Date.parse(b.startTimestamp ?? '') || 0
const hoursAgo = (iso: string) => (Date.now() - Date.parse(iso)) / 3_600_000

// Everything the dashboard and the Backups tab need; pure, so it can be tested
export function summarize(rawBackups: any[], rawSchedules: any[], rawLocations: any[], installed = true): VeleroData {
  const backups = rawBackups.map(toBackup).sort((a, b) => startedAt(b) - startedAt(a))
  const schedules: VeleroSchedule[] = rawSchedules.map(s => ({
    name: s.metadata?.name ?? '',
    namespace: s.metadata?.namespace ?? '',
    schedule: s.spec?.schedule ?? '',
    paused: s.spec?.paused === true,
    phase: s.status?.phase ?? null,
    lastBackup: s.status?.lastBackup ?? null,
    intervalHours: s.spec?.schedule ? scheduleIntervalHours(s.spec.schedule) : null,
  }))
  const locations: VeleroLocation[] = rawLocations.map(l => ({
    name: l.metadata?.name ?? '',
    namespace: l.metadata?.namespace ?? '',
    phase: l.status?.phase ?? null,
    default: l.spec?.default === true,
    provider: l.spec?.provider ?? null,
    bucket: l.spec?.objectStorage?.bucket ?? null,
    lastValidated: l.status?.lastValidationTime ?? null,
  }))

  const warnings: VeleroWarning[] = []
  for (const location of locations) {
    if (location.phase === 'Unavailable') warnings.push({ severity: 'critical', message: `Backup storage location "${location.name}" is unavailable` })
  }

  for (const schedule of schedules) {
    if (schedule.paused) {
      warnings.push({ severity: 'warning', message: `Schedule "${schedule.name}" is paused` })
      continue
    }
    if (schedule.phase === 'FailedValidation') {
      warnings.push({ severity: 'critical', message: `Schedule "${schedule.name}" failed validation` })
      continue
    }
    const runs = backups.filter(b => b.schedule === schedule.name)
    const latest = runs[0]
    if (!latest) {
      warnings.push({ severity: 'warning', message: `Schedule "${schedule.name}" has no backups yet` })
      continue
    }
    if (latest.phase === 'Failed' || latest.phase === 'FailedValidation') {
      warnings.push({ severity: 'critical', message: `Last backup of "${schedule.name}" failed (${latest.name})` })
    } else if (latest.phase === 'PartiallyFailed') {
      warnings.push({ severity: 'warning', message: `Last backup of "${schedule.name}" partially failed: ${latest.errors} errors (${latest.name})` })
    }
    // Stale: no successful backup within 1.5 intervals (plus an hour of slack)
    const lastCompleted = runs.find(b => b.phase === 'Completed')
    const maxAge = (schedule.intervalHours ?? DEFAULT_MAX_AGE_HOURS) * 1.5 + 1
    if (!lastCompleted?.startTimestamp || hoursAgo(lastCompleted.startTimestamp) > maxAge) {
      const age = lastCompleted?.startTimestamp ? `${Math.round(hoursAgo(lastCompleted.startTimestamp))} h ago` : 'never'
      warnings.push({ severity: 'critical', message: `No successful backup of "${schedule.name}" within the expected interval (last: ${age})` })
    }
    // A sudden drop in items usually means something fell out of the backup
    const completed = runs.filter(b => b.phase === 'Completed' && b.itemsBackedUp !== null)
    if (completed.length >= 2) {
      const [last, previous] = completed
      if (previous.itemsBackedUp! > 0 && last.itemsBackedUp! < previous.itemsBackedUp! * (1 - ITEM_DROP_THRESHOLD)) {
        const drop = Math.round((1 - last.itemsBackedUp! / previous.itemsBackedUp!) * 100)
        warnings.push({
          severity: 'warning',
          message: `Backup ${last.name} has ${last.itemsBackedUp} items, ${drop}% fewer than the previous one (${previous.itemsBackedUp})`,
        })
      }
    }
  }

  // Backups without any schedule: only flag a failed most recent one
  if (schedules.length === 0 && backups[0] && ['Failed', 'PartiallyFailed'].includes(backups[0].phase)) {
    warnings.push({ severity: backups[0].phase === 'Failed' ? 'critical' : 'warning', message: `Last backup ${backups[0].name} ${backups[0].phase === 'Failed' ? 'failed' : 'partially failed'}` })
  }

  return { installed, lastBackup: backups[0] ?? null, schedules, locations, warnings, backups }
}

export async function getVelero(kubeconfig: string): Promise<VeleroData> {
  const kc = new k8s.KubeConfig()
  kc.loadFromString(kubeconfig)
  const api = kc.makeApiClient(k8s.CustomObjectsApi)
  const [backups, schedules, locations] = await Promise.race([
    Promise.all([listKind(api, 'backups'), listKind(api, 'schedules'), listKind(api, 'backupstoragelocations')]),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout listing Velero resources')), TIMEOUT_MS)),
  ])
  if (backups === null && schedules === null) return summarize([], [], [], false)
  return summarize(backups ?? [], schedules ?? [], locations ?? [])
}

// The dashboard only needs the summary, not every backup
export function toSummary(data: VeleroData): VeleroSummary {
  const { backups: _backups, ...summary } = data
  return summary
}
