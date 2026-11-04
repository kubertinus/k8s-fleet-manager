'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { cn } from '@/lib/utils'
import { dailyBuckets, outcomeCounts, outcomeOf, successRate, type DayBucket, type DayOutcome, type FleetBackupCluster, type FleetBackupStatus } from '@/lib/backupsFleet'
import type { BackupsResponse } from '@/app/api/backups/route'

type Filter = 'all' | 'attention' | 'not-installed'

// Status palette (validated on the dark surface); a day always carries a label in the tooltip and legend
const OUTCOME_STYLE: Record<DayOutcome, { color: string; label: string }> = {
  completed: { color: '#0ca30c', label: 'Completed' },
  partial: { color: '#fab219', label: 'Partially failed' },
  failed: { color: '#d03b3b', label: 'Failed' },
  running: { color: '#3987e5', label: 'In progress' },
  none: { color: '#1e293b', label: 'No backup' },
}

const STATUS_BADGE: Record<FleetBackupStatus, { className: string; label: string }> = {
  ok: { className: 'badge-ok', label: 'OK' },
  warning: { className: 'badge-warn', label: 'Warning' },
  critical: { className: 'badge-err', label: 'Critical' },
  'not-installed': { className: 'badge-muted', label: 'No Velero' },
  unreachable: { className: 'badge-err', label: 'Unreachable' },
}

const STATUS_ORDER: FleetBackupStatus[] = ['critical', 'unreachable', 'warning', 'ok', 'not-installed']

function StatTile({ label, value, hint, tone, active, onClick }: { label: string; value: string | number; hint?: string; tone?: 'warn' | 'err' | 'ok'; active?: boolean; onClick?: () => void }) {
  const color = tone === 'warn' ? 'text-amber-400' : tone === 'err' ? 'text-rose-400' : tone === 'ok' ? 'text-emerald-400' : 'text-white'
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={cn('card px-4 py-3.5 text-left', onClick && 'transition-colors hover:border-slate-600', active && 'border-orange-500/60')}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', color)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Tag>
  )
}

function ago(iso: string | null) {
  if (!iso) return 'never'
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`
  if (hours < 48) return `${Math.round(hours)} h ago`
  return `${Math.round(hours / 24)} d ago`
}

const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`)
const dayLabel = (date: Date) => date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

interface Hover {
  cluster: string
  bucket: DayBucket
  x: number
  y: number
}

// One row per cluster, one cell per day; the worst outcome of the day colors the cell
function OutcomeGrid({ clusters }: { clusters: FleetBackupCluster[] }) {
  const [hover, setHover] = useState<Hover | null>(null)
  const rows = useMemo(() => clusters.map(c => ({ cluster: c, buckets: dailyBuckets(c.recent) })), [clusters])
  const days = rows[0]?.buckets ?? dailyBuckets([])

  return (
    <div className="card relative p-4" onMouseLeave={() => setHover(null)}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-sm font-semibold text-white">Backup outcome per day</h2>
        <span className="text-xs text-slate-500">last {days.length} days, worst result of the day</span>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-slate-400">
          {(['completed', 'partial', 'failed', 'running', 'none'] as DayOutcome[]).map(o => (
            <span key={o} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OUTCOME_STYLE[o].color, outline: o === 'none' ? '1px solid #334155' : undefined }} />
              {OUTCOME_STYLE[o].label}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid items-center gap-[2px]" style={{ gridTemplateColumns: `minmax(8rem, 12rem) repeat(${days.length}, minmax(0, 1fr))` }}>
            <div />
            {days.map((d, i) => (
              <div key={i} className="pb-1 text-center text-[10px] tabular-nums text-slate-500">
                {i % 2 === (days.length - 1) % 2 ? d.date.getDate() : ''}
              </div>
            ))}
            {rows.map(({ cluster, buckets }) => (
              <div key={cluster.id} className="contents">
                <Link href={`/cluster/${cluster.id}?tab=backups`} className="truncate pr-3 text-xs text-slate-300 hover:text-white hover:underline">
                  {cluster.name}
                </Link>
                {cluster.status === 'not-installed' || cluster.status === 'unreachable' ? (
                  <div className="flex h-6 items-center rounded-sm bg-slate-900/60 px-2 text-[11px] text-slate-500" style={{ gridColumn: `span ${buckets.length}` }}>
                    {cluster.status === 'not-installed' ? 'Velero not installed' : 'Cluster unreachable'}
                  </div>
                ) : (
                  buckets.map((bucket, i) => (
                    <div
                      key={i}
                      className="h-6 cursor-default rounded-sm"
                      style={{ background: OUTCOME_STYLE[bucket.outcome].color }}
                      onMouseEnter={e => {
                        const cell = e.currentTarget.getBoundingClientRect()
                        const card = e.currentTarget.closest('.card')!.getBoundingClientRect()
                        setHover({ cluster: cluster.name, bucket, x: cell.left - card.left + cell.width / 2, y: cell.top - card.top })
                      }}
                    />
                  ))
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-52 -translate-x-1/2 -translate-y-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg"
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          <div className="font-medium text-white">{hover.cluster}</div>
          <div className="mb-1 text-slate-400">{dayLabel(hover.bucket.date)}</div>
          {hover.bucket.outcome === 'none' ? (
            <div className="text-slate-400">No backup started</div>
          ) : (
            (['completed', 'partial', 'failed', 'running'] as const)
              .filter(o => hover.bucket[o] > 0)
              .map(o => (
                <div key={o} className="flex items-center gap-1.5 text-slate-200">
                  <span className="h-2 w-2 rounded-sm" style={{ background: OUTCOME_STYLE[o].color }} />
                  <span className="flex-1">{OUTCOME_STYLE[o].label}</span>
                  <span className="tabular-nums">{hover.bucket[o]}</span>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  )
}

export default function BackupsPage() {
  const router = useRouter()
  const [data, setData] = useState<BackupsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/backups', { cache: 'no-store' })
      if (response.status === 401) {
        router.push('/login')
        return
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      setData(body)
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load backups')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  const clusters = useMemo(
    () => [...(data?.clusters ?? [])].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name)),
    [data]
  )
  const withVelero = clusters.filter(c => c.status !== 'not-installed' && c.status !== 'unreachable')
  const attention = clusters.filter(c => c.status === 'critical' || c.status === 'warning' || c.status === 'unreachable')
  const fleet7d = useMemo(() => {
    const all = withVelero.flatMap(c => c.recent)
    return outcomeCounts(all, 7)
  }, [withVelero])
  const fleetRate = successRate(fleet7d)
  const failures = useMemo(
    () =>
      withVelero
        .flatMap(c => c.recent.filter(b => ['Failed', 'FailedValidation', 'PartiallyFailed'].includes(b.phase)).map(b => ({ cluster: c, backup: b })))
        .sort((a, b) => Date.parse(b.backup.startTimestamp ?? '') - Date.parse(a.backup.startTimestamp ?? ''))
        .slice(0, 20),
    [withVelero]
  )

  const visible = clusters.filter(c => {
    if (filter === 'attention') return attention.includes(c)
    if (filter === 'not-installed') return c.status === 'not-installed'
    return true
  })
  const toggle = (next: Filter) => setFilter(f => (f === next ? 'all' : next))

  return (
    <AppShell
      title="Backups"
      subtitle={data && `Velero · ${clusters.length} cluster${clusters.length === 1 ? '' : 's'} · updated ${new Date(data.generatedAt).toLocaleTimeString()}`}
      actions={
        <button onClick={load} disabled={loading} className="btn-secondary">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      }
    >
      <div className="space-y-5">
        {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

        {!data && !error ? (
          <div className="flex items-center justify-center py-24 text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Collecting backups from all clusters…
          </div>
        ) : (
          data && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile
                  label="Protected clusters"
                  value={`${withVelero.filter(c => c.status === 'ok').length} / ${clusters.length}`}
                  hint="Velero installed, no warnings"
                  active={filter === 'all'}
                  onClick={() => setFilter('all')}
                />
                <StatTile
                  label="Need attention"
                  value={attention.length}
                  hint="failed, stale or unreachable"
                  tone={attention.some(c => c.status !== 'warning') ? 'err' : attention.length ? 'warn' : undefined}
                  active={filter === 'attention'}
                  onClick={() => toggle('attention')}
                />
                <StatTile
                  label="Success rate 7d"
                  value={percent(fleetRate)}
                  hint={`${fleet7d.completed} of ${fleet7d.completed + fleet7d.partial + fleet7d.failed} backups completed`}
                  tone={fleetRate === null ? undefined : fleetRate >= 0.95 ? 'ok' : fleetRate >= 0.8 ? 'warn' : 'err'}
                />
                <StatTile
                  label="Without Velero"
                  value={clusters.filter(c => c.status === 'not-installed').length}
                  hint="no backups at all"
                  tone={clusters.some(c => c.status === 'not-installed') ? 'warn' : undefined}
                  active={filter === 'not-installed'}
                  onClick={() => toggle('not-installed')}
                />
              </div>

              {visible.length > 0 && <OutcomeGrid clusters={visible} />}

              <div className="card overflow-hidden">
                <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
                  <h2 className="text-sm font-semibold text-white">Clusters</h2>
                  <span className="badge badge-muted">{visible.length}</span>
                </div>
                {visible.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">No clusters match.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[980px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                          <th className="px-4 py-2.5 font-medium">Cluster</th>
                          <th className="px-3 py-2.5 font-medium">Status</th>
                          <th className="px-3 py-2.5 font-medium">Last successful</th>
                          <th className="px-3 py-2.5 font-medium">Last backup</th>
                          <th className="px-3 py-2.5 text-right font-medium">Success 7d</th>
                          <th className="px-3 py-2.5 font-medium">Schedules</th>
                          <th className="px-3 py-2.5 font-medium">Storage</th>
                          <th className="px-4 py-2.5 font-medium">Findings</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {visible.map(c => {
                          const counts = outcomeCounts(c.recent, 7)
                          const rate = successRate(counts)
                          const badge = STATUS_BADGE[c.status]
                          const hasVelero = c.status !== 'not-installed' && c.status !== 'unreachable'
                          return (
                            <tr key={c.id} className="align-top">
                              <td className="px-4 py-2.5">
                                <Link href={`/cluster/${c.id}?tab=backups`} className="font-medium text-slate-100 hover:text-white hover:underline">
                                  {c.name}
                                </Link>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={cn('badge', badge.className)}>{badge.label}</span>
                              </td>
                              <td className="px-3 py-2.5 text-xs">
                                {hasVelero ? (
                                  <>
                                    <div className="text-slate-200">{ago(c.lastSuccessful?.startTimestamp ?? null)}</div>
                                    {c.lastSuccessful?.itemsBackedUp != null && <div className="text-slate-500">{c.lastSuccessful.itemsBackedUp} items</div>}
                                  </>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-xs">
                                {c.lastBackup ? (
                                  <>
                                    <div className="text-slate-200">{ago(c.lastBackup.startTimestamp)}</div>
                                    <div
                                      className={cn(
                                        { completed: 'text-slate-500', running: 'text-sky-300', partial: 'text-amber-300', failed: 'text-rose-300', none: 'text-slate-500' }[outcomeOf(c.lastBackup.phase)]
                                      )}
                                    >
                                      {c.lastBackup.phase}
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                                {hasVelero ? (
                                  <>
                                    <div className="text-slate-200">{percent(rate)}</div>
                                    <div className="text-slate-500">
                                      {counts.completed}/{counts.completed + counts.partial + counts.failed}
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-xs text-slate-300">
                                {hasVelero ? (
                                  <>
                                    {c.schedules.active} active
                                    {c.schedules.total > c.schedules.active && <span className="text-amber-300"> · {c.schedules.total - c.schedules.active} paused</span>}
                                  </>
                                ) : (
                                  <span className="text-slate-500">—</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-xs">
                                {c.locations.length === 0 ? (
                                  <span className="text-slate-500">—</span>
                                ) : (
                                  c.locations.map(l => (
                                    <div key={l.name} className="flex items-center gap-1">
                                      {l.phase === 'Available' ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                                      ) : (
                                        <XCircle className="h-3.5 w-3.5 text-rose-400" />
                                      )}
                                      <span className="text-slate-300">{l.name}</span>
                                    </div>
                                  ))
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-xs">
                                {c.error ? (
                                  <span className="text-rose-300 [overflow-wrap:anywhere]">{c.error}</span>
                                ) : c.warnings.length === 0 ? (
                                  <span className="text-slate-500">{hasVelero ? 'None' : 'Install Velero to back up this cluster'}</span>
                                ) : (
                                  <ul className="max-w-md space-y-1">
                                    {c.warnings.map((w, i) => (
                                      <li key={i} className="flex gap-1.5">
                                        <AlertTriangle className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0', w.severity === 'critical' ? 'text-rose-400' : 'text-amber-400')} />
                                        <span className="text-slate-300 [overflow-wrap:anywhere]">{w.message}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {failures.length > 0 && (
                <div className="card overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
                    <h2 className="text-sm font-semibold text-white">Failed backups</h2>
                    <span className="text-xs text-slate-500">last 14 days</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <tbody className="divide-y divide-slate-800/70">
                        {failures.map(({ cluster, backup }) => (
                          <tr key={`${cluster.id}/${backup.namespace}/${backup.name}`}>
                            <td className="px-4 py-2 text-xs text-slate-400">{backup.startTimestamp ? new Date(backup.startTimestamp).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                            <td className="px-3 py-2">
                              <Link href={`/cluster/${cluster.id}?tab=backups`} className="text-slate-300 hover:text-white hover:underline">
                                {cluster.name}
                              </Link>
                            </td>
                            <td className="px-3 py-2 font-mono text-xs text-slate-200">{backup.name}</td>
                            <td className="px-3 py-2">
                              <span className={cn('badge', backup.phase === 'PartiallyFailed' ? 'badge-warn' : 'badge-err')}>{backup.phase}</span>
                            </td>
                            <td className="px-4 py-2 text-xs tabular-nums text-slate-400">
                              {backup.errors} errors · {backup.warnings} warnings
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )
        )}
      </div>
    </AppShell>
  )
}
