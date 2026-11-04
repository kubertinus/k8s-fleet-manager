import { getPool, initializeDatabase } from '@/lib/database'
import { getClusterHealthCached } from '@/lib/healthCache'
import { issueCounts, type ClusterHealth } from '@/components/dashboard/types'

// Writes a health sample per active cluster every few minutes, so availability
// and trends exist even when nobody has the dashboard open. Started from
// instrumentation.ts. Old samples are removed after the retention period.

export type HistoryStatus = 'healthy' | 'warning' | 'unhealthy' | 'unreachable' | 'unknown'

export interface HistorySettings {
  intervalMinutes: number
  retentionDays: number
}

const TICK_MS = 60_000
const PRUNE_EVERY_MS = 60 * 60_000
// Arbitrary, fixed key for pg_try_advisory_lock: with several replicas only one samples
const SAMPLE_LOCK_KEY = 74_201_117

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = { intervalMinutes: 5, retentionDays: 30 }

export async function getHistorySettings(): Promise<HistorySettings> {
  const result = await getPool().query('SELECT key, value FROM settings WHERE key = ANY($1)', [['history_interval_minutes', 'history_retention_days']])
  const settings = Object.fromEntries(result.rows.map((row: any) => [row.key, Number(row.value)]))
  const valid = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max
  return {
    intervalMinutes: valid(settings.history_interval_minutes, 1, 60) ? settings.history_interval_minutes : DEFAULT_HISTORY_SETTINGS.intervalMinutes,
    retentionDays: valid(settings.history_retention_days, 1, 365) ? settings.history_retention_days : DEFAULT_HISTORY_SETTINGS.retentionDays,
  }
}

export function toHistoryStatus(status: string): HistoryStatus {
  if (status === 'healthy' || status === 'warning' || status === 'unhealthy') return status
  if (status === 'error' || status === 'timeout' || status === 'unreachable') return 'unreachable'
  return 'unknown'
}

async function sample(intervalMinutes: number) {
  const pool = getPool()
  // Skip clusters sampled within this interval (restart, second replica)
  const clusters = (
    await pool.query(
      `SELECT c.id, c.name, c.kubeconfig, c.talosconfig FROM clusters c
       WHERE c.is_active = true AND NOT EXISTS (
         SELECT 1 FROM cluster_health_history h
         WHERE h.cluster_id = c.id AND h.checked_at > NOW() - make_interval(secs => $1)
       )`,
      [intervalMinutes * 60 - 30]
    )
  ).rows

  await Promise.all(
    clusters.map(async cluster => {
      try {
        const { data } = await getClusterHealthCached(cluster)
        const health = data as unknown as ClusterHealth
        const counts = health.error ? { critical: 0, warning: 0 } : issueCounts(health)
        await pool.query(
          `INSERT INTO cluster_health_history
             (cluster_id, status, healthy_nodes, total_nodes, cpu_percent, memory_percent, critical, warning)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            cluster.id,
            toHistoryStatus(data.status),
            data.healthyNodes,
            data.totalNodes,
            health.error ? null : (health.avgCpuPercent ?? null),
            health.error ? null : (health.avgMemoryPercent ?? null),
            counts.critical,
            counts.warning,
          ]
        )
      } catch (error) {
        console.error(`[history] sample of ${cluster.name} failed:`, error)
      }
    })
  )
}

let lastPrune = 0

async function tick() {
  await initializeDatabase()
  const settings = await getHistorySettings()
  const lockClient = await getPool().connect()
  try {
    const lock = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [SAMPLE_LOCK_KEY])
    if (!lock.rows[0].locked) return
    try {
      await sample(settings.intervalMinutes)
      if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
        await getPool().query('DELETE FROM cluster_health_history WHERE checked_at < NOW() - make_interval(days => $1)', [settings.retentionDays])
        lastPrune = Date.now()
      }
    } finally {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [SAMPLE_LOCK_KEY]).catch(() => {})
    }
  } finally {
    lockClient.release()
  }
}

export function startHealthHistorySampler() {
  const g = globalThis as any
  if (g.__k8sFleetManagerHistorySampler) return
  g.__k8sFleetManagerHistorySampler = true

  let running = false
  const guardedTick = async () => {
    if (running) return
    running = true
    try {
      await tick()
    } catch (error) {
      console.error('[history] sampler tick failed:', error)
    } finally {
      running = false
    }
  }

  // First sample shortly after boot, then check every minute whether one is due.
  setTimeout(guardedTick, 20_000)
  setInterval(guardedTick, TICK_MS)
  console.log('[history] health sampler started')
}
