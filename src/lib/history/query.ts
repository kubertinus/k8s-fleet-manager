import { getPool } from '@/lib/database'
import type { HistoryStatus } from './sampler'

// Reading the health history: bucketed series for charts, availability per
// period and the periods a cluster was not healthy.

export type HistoryRange = '24h' | '7d' | '30d'

export const HISTORY_RANGES: Record<HistoryRange, { hours: number; bucketMinutes: number }> = {
  '24h': { hours: 24, bucketMinutes: 10 },
  '7d': { hours: 7 * 24, bucketMinutes: 60 },
  '30d': { hours: 30 * 24, bucketMinutes: 240 },
}

export interface HistoryBucket {
  at: string
  // Worst status seen in the bucket
  status: HistoryStatus
  cpu: number | null
  memory: number | null
  samples: number
  critical: number
  warning: number
}

export interface HistoryPeriod {
  status: HistoryStatus
  from: string
  to: string
}

export interface ClusterHistory {
  range: HistoryRange
  bucketMinutes: number
  intervalMinutes: number
  buckets: HistoryBucket[]
  // Share of samples in which the cluster answered, per period (null: no samples)
  availability: Record<HistoryRange, number | null>
  // Status periods other than healthy, newest first
  incidents: HistoryPeriod[]
  firstSample: string | null
}

const SEVERITY: HistoryStatus[] = ['unknown', 'healthy', 'warning', 'unhealthy', 'unreachable']
const worst = (a: HistoryStatus, b: HistoryStatus) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a)

// Pure: merge consecutive samples with the same status into periods. A gap of more
// than three intervals ends a period (no data is not the same as unchanged).
export function toPeriods(samples: { at: Date; status: HistoryStatus }[], intervalMinutes: number): HistoryPeriod[] {
  const step = intervalMinutes * 60_000
  const periods: { status: HistoryStatus; from: number; to: number }[] = []
  for (const s of samples) {
    const t = s.at.getTime()
    const last = periods[periods.length - 1]
    if (last && last.status === s.status && t - last.to <= 3 * step) last.to = t
    else periods.push({ status: s.status, from: t, to: t })
  }
  // A sample stands for the interval that follows it
  return periods.map(p => ({ status: p.status, from: new Date(p.from).toISOString(), to: new Date(p.to + step).toISOString() }))
}

export async function availabilityByCluster(hours: number): Promise<Map<number, { percent: number; samples: number }>> {
  const result = await getPool().query(
    `SELECT cluster_id,
            COUNT(*) FILTER (WHERE status <> 'unknown') AS samples,
            COUNT(*) FILTER (WHERE status IN ('healthy', 'warning', 'unhealthy')) AS reachable
       FROM cluster_health_history
      WHERE checked_at > NOW() - make_interval(hours => $1)
      GROUP BY cluster_id`,
    [hours]
  )
  return new Map(
    result.rows
      .filter((r: any) => Number(r.samples) > 0)
      .map((r: any) => [r.cluster_id, { percent: (Number(r.reachable) / Number(r.samples)) * 100, samples: Number(r.samples) }])
  )
}

export async function getClusterHistory(clusterId: number, range: HistoryRange, intervalMinutes: number): Promise<ClusterHistory> {
  const pool = getPool()
  const { hours, bucketMinutes } = HISTORY_RANGES[range]

  const [buckets, availability, raw, first] = await Promise.all([
    pool.query(
      `SELECT to_timestamp(floor(extract(epoch FROM checked_at) / $2) * $2) AS at,
              array_agg(DISTINCT status) AS statuses,
              AVG(cpu_percent) AS cpu,
              AVG(memory_percent) AS memory,
              COUNT(*) AS samples,
              MAX(critical) AS critical,
              MAX(warning) AS warning
         FROM cluster_health_history
        WHERE cluster_id = $1 AND checked_at > NOW() - make_interval(hours => $3)
        GROUP BY 1 ORDER BY 1`,
      [clusterId, bucketMinutes * 60, hours]
    ),
    pool.query(
      `SELECT ${(Object.keys(HISTORY_RANGES) as HistoryRange[])
        .map(
          (r, i) => `COUNT(*) FILTER (WHERE status <> 'unknown' AND checked_at > NOW() - make_interval(hours => ${HISTORY_RANGES[r].hours})) AS samples_${i},
                     COUNT(*) FILTER (WHERE status IN ('healthy', 'warning', 'unhealthy') AND checked_at > NOW() - make_interval(hours => ${HISTORY_RANGES[r].hours})) AS reachable_${i}`
        )
        .join(',')}
         FROM cluster_health_history WHERE cluster_id = $1`,
      [clusterId]
    ),
    pool.query(
      `SELECT checked_at, status FROM cluster_health_history
        WHERE cluster_id = $1 AND checked_at > NOW() - make_interval(hours => $2)
        ORDER BY checked_at`,
      [clusterId, hours]
    ),
    pool.query('SELECT MIN(checked_at) AS first FROM cluster_health_history WHERE cluster_id = $1', [clusterId]),
  ])

  const counts = availability.rows[0] ?? {}
  const percent = (i: number) => {
    const samples = Number(counts[`samples_${i}`] ?? 0)
    return samples > 0 ? (Number(counts[`reachable_${i}`]) / samples) * 100 : null
  }

  return {
    range,
    bucketMinutes,
    intervalMinutes,
    buckets: buckets.rows.map((r: any) => ({
      at: new Date(r.at).toISOString(),
      status: (r.statuses as HistoryStatus[]).reduce(worst, 'unknown'),
      cpu: r.cpu === null ? null : Number(r.cpu),
      memory: r.memory === null ? null : Number(r.memory),
      samples: Number(r.samples),
      critical: Number(r.critical),
      warning: Number(r.warning),
    })),
    availability: { '24h': percent(0), '7d': percent(1), '30d': percent(2) },
    incidents: toPeriods(
      raw.rows.map((r: any) => ({ at: new Date(r.checked_at), status: r.status })),
      intervalMinutes
    )
      .filter(p => p.status !== 'healthy')
      .reverse()
      .slice(0, 50),
    firstSample: first.rows[0]?.first ? new Date(first.rows[0].first).toISOString() : null,
  }
}
