'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Archive, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VeleroData } from '@/lib/velero'

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds} s`
  const m = Math.floor(seconds / 60)
  return m < 60 ? `${m} min ${seconds % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`
}

function phaseBadge(phase: string | null) {
  if (phase === 'Completed' || phase === 'Available' || phase === 'Enabled') return 'badge-ok'
  if (phase === 'Failed' || phase === 'FailedValidation' || phase === 'Unavailable') return 'badge-err'
  if (phase === 'PartiallyFailed') return 'badge-warn'
  if (phase === 'InProgress' || phase === 'New' || phase === 'WaitingForPluginOperations' || phase === 'Finalizing') return 'badge-info'
  return 'badge-muted'
}

// Velero backups, schedules and storage locations of a cluster.
export default function VeleroBackups({ clusterId }: { clusterId: string }) {
  const [data, setData] = useState<VeleroData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/clusters/${clusterId}/velero`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      setData(body)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [clusterId])

  useEffect(() => {
    load()
  }, [load])

  const backups = data?.backups ?? []
  const visible = showAll ? backups : backups.slice(0, 15)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Archive className="h-5 w-5 text-orange-400" />
        <h2 className="text-lg font-semibold text-white">Backups</h2>
        <span className="text-sm text-slate-500">Velero</span>
        <button onClick={load} disabled={loading} className="btn-secondary ml-auto" title="Reload">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      {!data && !error ? (
        <div className="flex items-center justify-center py-16 text-sm text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading backups…
        </div>
      ) : data && !data.installed ? (
        <div className="card px-6 py-10 text-center text-sm text-slate-400">Velero is not installed in this cluster.</div>
      ) : (
        data && (
          <>
            {data.warnings.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                <CheckCircle2 className="h-4 w-4" /> Backups look healthy
                {data.lastBackup?.startTimestamp && <span className="text-emerald-300/70">· last {formatDate(data.lastBackup.startTimestamp)}</span>}
              </div>
            ) : (
              <div className="space-y-1.5">
                {data.warnings.map((w, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex items-start gap-2 rounded-lg border px-4 py-2.5 text-sm',
                      w.severity === 'critical' ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    )}
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    {w.message}
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="card overflow-hidden">
                <div className="border-b border-slate-800 px-4 py-2.5 text-sm font-semibold text-white">Schedules</div>
                {data.schedules.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-slate-500">No schedules: backups are only made by hand.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-800/70">
                      {data.schedules.map(s => (
                        <tr key={`${s.namespace}/${s.name}`}>
                          <td className="px-4 py-2">
                            <div className="font-medium text-white">{s.name}</div>
                            <div className="font-mono text-xs text-slate-500">{s.schedule}</div>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400">last {formatDate(s.lastBackup)}</td>
                          <td className="px-4 py-2 text-right">
                            <span className={cn('badge', s.paused ? 'badge-warn' : phaseBadge(s.phase))}>{s.paused ? 'Paused' : s.phase ?? 'Unknown'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card overflow-hidden">
                <div className="border-b border-slate-800 px-4 py-2.5 text-sm font-semibold text-white">Storage locations</div>
                {data.locations.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-slate-500">No backup storage locations.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-800/70">
                      {data.locations.map(l => (
                        <tr key={`${l.namespace}/${l.name}`}>
                          <td className="px-4 py-2">
                            <div className="font-medium text-white">
                              {l.name} {l.default && <span className="badge badge-muted ml-1">default</span>}
                            </div>
                            <div className="font-mono text-xs text-slate-500">
                              {l.provider}
                              {l.bucket && ` · ${l.bucket}`}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-400">validated {formatDate(l.lastValidated)}</td>
                          <td className="px-4 py-2 text-right">
                            <span className={cn('badge', phaseBadge(l.phase))}>{l.phase ?? 'Unknown'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="card overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-2.5 font-medium">Backup</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Started</th>
                    <th className="px-3 py-2.5 font-medium">Duration</th>
                    <th className="px-3 py-2.5 text-right font-medium">Items</th>
                    <th className="px-3 py-2.5 text-right font-medium">Errors / warnings</th>
                    <th className="px-4 py-2.5 font-medium">Expires</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {visible.map((b, i) => {
                    // Compare with the previous backup of the same schedule
                    const previous = backups.slice(i + 1).find(x => x.schedule === b.schedule && x.phase === 'Completed')
                    const drop =
                      b.itemsBackedUp !== null && previous?.itemsBackedUp ? 1 - b.itemsBackedUp / previous.itemsBackedUp : null
                    return (
                      <tr key={`${b.namespace}/${b.name}`}>
                        <td className="px-4 py-2">
                          <div className="font-medium text-white">{b.name}</div>
                          {b.schedule && <div className="text-xs text-slate-500">{b.schedule}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn('badge', phaseBadge(b.phase))}>{b.phase}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-300">{formatDate(b.startTimestamp)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-400">{formatDuration(b.durationSeconds)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-300">
                          {b.itemsBackedUp ?? '—'}
                          {drop !== null && drop > 0.3 && (
                            <span className="badge badge-warn ml-1.5" title={`Previous backup: ${previous?.itemsBackedUp} items`}>
                              −{Math.round(drop * 100)}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs">
                          <span className={b.errors ? 'text-rose-300' : 'text-slate-500'}>{b.errors}</span>
                          <span className="text-slate-600"> / </span>
                          <span className={b.warnings ? 'text-amber-300' : 'text-slate-500'}>{b.warnings}</span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400">{formatDate(b.expiration)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {backups.length > 15 && (
                <button onClick={() => setShowAll(s => !s)} className="w-full border-t border-slate-800 py-2 text-xs text-slate-400 hover:text-white">
                  {showAll ? 'Show fewer' : `Show all ${backups.length} backups`}
                </button>
              )}
            </div>
          </>
        )
      )}
    </div>
  )
}
