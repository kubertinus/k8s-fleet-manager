'use client'

import { useRouter } from 'next/navigation'
import { StatusDot } from '@/components/layout/AppShell'
import { cn } from '@/lib/utils'
import { backupState, meterColor, Spinner, StatusBadge } from './ClusterCard'
import { issueCounts, isUnreachable, type ClusterHealth } from './types'

function Percent({ value }: { value?: number }) {
  if (value === undefined || value === null || Number.isNaN(value)) return <span className="text-slate-600">—</span>
  return (
    <div className="flex items-center gap-2">
      <div className="meter w-16">
        <span className={meterColor(value)} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="w-9 text-right tabular-nums text-slate-300">{value.toFixed(0)}%</span>
    </div>
  )
}

// Compact one-row-per-cluster view; scales to many clusters better than cards.
// Availability over 7 days per cluster id, from the health history (absent: no samples yet)
export type UptimeMap = Record<number, { percent: number; samples: number }>

function uptimeTone(percent: number) {
  if (percent >= 99.9) return 'text-emerald-400'
  if (percent >= 99) return 'text-amber-300'
  return 'text-rose-300'
}

export default function ClusterTable({
  clusters,
  uptime,
  onShowIssues,
}: {
  clusters: ClusterHealth[]
  uptime: UptimeMap
  onShowIssues: (c: ClusterHealth) => void
}) {
  const router = useRouter()

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[1020px] text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="px-4 py-2.5 font-medium">Cluster</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">Nodes</th>
            <th className="px-3 py-2.5 font-medium">CPU</th>
            <th className="px-3 py-2.5 font-medium">Memory</th>
            <th className="px-3 py-2.5 font-medium">Pods</th>
            <th className="px-3 py-2.5 font-medium">Kubernetes</th>
            <th className="px-3 py-2.5 font-medium">Talos</th>
            <th className="px-3 py-2.5 font-medium">Backup</th>
            <th className="px-3 py-2.5 font-medium">Uptime 7d</th>
            <th className="px-4 py-2.5 text-right font-medium">Issues</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {clusters.map(cluster => {
            const { critical, warning } = issueCounts(cluster)
            const down = isUnreachable(cluster)
            return (
              <tr
                key={cluster.id}
                onClick={() => router.push(`/cluster/${cluster.id}`)}
                className="cursor-pointer transition-colors hover:bg-slate-800/40"
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <StatusDot status={cluster.status} />
                    <span className="font-medium text-white">{cluster.name}</span>
                    {cluster.isLoading && <Spinner className="h-3 w-3" />}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={cluster.status} />
                </td>
                <td className="px-3 py-2.5 tabular-nums">
                  {down ? (
                    <span className="text-slate-600">—</span>
                  ) : (
                    <span className={cn(cluster.healthyNodes < cluster.totalNodes ? 'text-amber-300' : 'text-slate-300')}>
                      {cluster.healthyNodes}/{cluster.totalNodes}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5">{down ? <span className="text-slate-600">—</span> : <Percent value={cluster.avgCpuPercent} />}</td>
                <td className="px-3 py-2.5">{down ? <span className="text-slate-600">—</span> : <Percent value={cluster.avgMemoryPercent} />}</td>
                <td className="px-3 py-2.5 tabular-nums text-slate-300">{cluster.totalPods ?? <span className="text-slate-600">—</span>}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{cluster.kubernetesVersion || '—'}</td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-400">{cluster.talosVersion || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                  {(() => {
                    const backup = backupState(cluster)
                    if (!backup) return <span className="text-slate-600">—</span>
                    const tone = { ok: 'text-emerald-400', warn: 'text-amber-300', err: 'text-rose-300', muted: 'text-slate-500' }[backup.tone]
                    return <span className={tone} title={backup.title}>{backup.label}</span>
                  })()}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs tabular-nums">
                  {uptime[cluster.id] ? (
                    <span className={uptimeTone(uptime[cluster.id].percent)} title={`${uptime[cluster.id].samples} samples`}>
                      {uptime[cluster.id].percent >= 99.995 ? '100' : uptime[cluster.id].percent.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {critical + warning > 0 ? (
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        onShowIssues(cluster)
                      }}
                      className="inline-flex gap-1 rounded-md px-1 py-0.5 hover:bg-slate-800"
                    >
                      {critical > 0 && <span className="badge badge-err">{critical}</span>}
                      {warning > 0 && <span className="badge badge-warn">{warning}</span>}
                    </button>
                  ) : down ? (
                    <span className="text-xs text-rose-400">unreachable</span>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
