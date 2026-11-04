'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { cn } from '@/lib/utils'
import type { VersionsResponse } from '@/app/api/versions/route'
import type { ReleaseStatus } from '@/lib/platformVersions'

type ClusterRow = VersionsResponse['clusters'][number]

function StatTile({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'warn' | 'err' }) {
  const color = tone === 'warn' ? 'text-amber-400' : tone === 'err' ? 'text-rose-400' : 'text-white'
  return (
    <div className="card px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-1 font-mono text-2xl font-semibold tabular-nums', color)}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function ReleaseBadge({ status }: { status: ReleaseStatus | null }) {
  if (!status) return <span className="badge badge-muted">latest unknown</span>
  if (status.outOfSupport) {
    return (
      <span className="badge badge-err" title={`Newest: ${status.latest}`}>
        out of support · {status.minorsBehind} minors behind
      </span>
    )
  }
  if (status.minorsBehind > 0) {
    return (
      <span className="badge badge-warn" title={`Newest: ${status.latest}`}>
        {status.minorsBehind} minor{status.minorsBehind === 1 ? '' : 's'} behind
      </span>
    )
  }
  if (status.latestPatch) return <span className="badge badge-info">patch {status.latestPatch}</span>
  return <span className="badge badge-ok">up to date</span>
}

function VersionCell({ current, status, versions, extra }: { current: string | null; status: ReleaseStatus | null; versions: string[]; extra?: string }) {
  if (!current) return <span className="text-xs text-slate-500">—</span>
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-white">{current}</span>
        <ReleaseBadge status={status} />
      </div>
      {status?.minorsBehind ? (
        <div className="text-xs text-slate-500">
          newest {status.latest}
          {status.latestPatch && ` · patch ${status.latestPatch}`}
        </div>
      ) : null}
      {versions.length > 1 && (
        <div className="flex items-center gap-1 text-xs text-amber-300">
          <AlertTriangle className="h-3 w-3" /> mixed {extra}: {versions.join(', ')}
        </div>
      )}
    </div>
  )
}

const needsAttention = (c: ClusterRow) =>
  !!c.error || !!c.kubernetes?.outOfSupport || (c.kubernetes?.minorsBehind ?? 0) > 0 || (c.talos?.minorsBehind ?? 0) > 0 || c.kubeletVersions.length > 1 || c.talosVersions.length > 1

export default function VersionsPage() {
  const router = useRouter()
  const [data, setData] = useState<VersionsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true)
      try {
        const response = await fetch(`/api/versions${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
        if (response.status === 401) {
          router.push('/login')
          return
        }
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
        setData(body)
        setError(null)
      } catch (err: any) {
        setError(err.message || 'Failed to load versions')
      } finally {
        setLoading(false)
      }
    },
    [router]
  )

  useEffect(() => {
    load()
  }, [load])

  const clusters = useMemo(() => [...(data?.clusters ?? [])].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a)) || a.name.localeCompare(b.name)), [data])
  const outOfSupport = clusters.filter(c => c.kubernetes?.outOfSupport).length
  const mixed = clusters.filter(c => c.kubeletVersions.length > 1 || c.talosVersions.length > 1).length
  const toggle = (id: number) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const lookupErrors = data ? Object.entries(data.latest.errors).filter(([, e]) => e) : []

  return (
    <AppShell
      title="Versions"
      subtitle={data && `Newest releases checked ${new Date(data.latest.checkedAt).toLocaleString()}`}
      actions={
        <button onClick={() => load(true)} disabled={loading} className="btn-secondary" title="Look up the newest releases again">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      }
    >
      <div className="space-y-5">
        {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
        {lookupErrors.map(([product, message]) => (
          <div key={product} className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              Could not look up the newest {product === 'kubernetes' ? 'Kubernetes' : 'Talos'} release: {message}
            </span>
          </div>
        ))}

        {!data && !error ? (
          <div className="flex items-center justify-center py-24 text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading versions…
          </div>
        ) : (
          data && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Newest Kubernetes" value={data.latest.kubernetes ?? '—'} hint={data.latest.source.kubernetes ? `via ${data.latest.source.kubernetes}` : undefined} />
                <StatTile label="Newest Talos" value={data.latest.talos ?? '—'} hint={data.latest.source.talos ? `via ${data.latest.source.talos}` : undefined} />
                <StatTile label="Out of support" value={outOfSupport} tone={outOfSupport ? 'err' : undefined} hint="Kubernetes keeps the 3 newest minors" />
                <StatTile label="Mixed versions" value={mixed} tone={mixed ? 'warn' : undefined} hint="Nodes on different versions" />
              </div>

              <div className="card overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-2.5 font-medium">Cluster</th>
                      <th className="px-3 py-2.5 font-medium">Kubernetes</th>
                      <th className="px-3 py-2.5 font-medium">Talos</th>
                      <th className="px-4 py-2.5 font-medium">Nodes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {clusters.map(c => {
                      const open = expanded.has(c.id)
                      return (
                        <Fragment key={c.id}>
                          <tr onClick={() => c.nodes.length && toggle(c.id)} className={cn('align-top', c.nodes.length && 'cursor-pointer hover:bg-slate-800/40')}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {c.nodes.length > 0 &&
                                  (open ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />)}
                                <Link href={`/cluster/${c.id}`} onClick={e => e.stopPropagation()} className="font-medium text-white hover:underline">
                                  {c.name}
                                </Link>
                              </div>
                              {c.error && <div className="mt-1 text-xs text-rose-300">{c.error}</div>}
                            </td>
                            <td className="px-3 py-3">
                              <VersionCell current={c.apiServer} status={c.kubernetes} versions={c.kubeletVersions} extra="kubelets" />
                            </td>
                            <td className="px-3 py-3">
                              <VersionCell current={c.talosVersions[0] ?? null} status={c.talos} versions={c.talosVersions} extra="nodes" />
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-400">
                              {c.nodes.length > 0 && (
                                <>
                                  {c.nodes.length} node{c.nodes.length === 1 ? '' : 's'} · {c.nodes.filter(n => n.controlPlane).length} control plane
                                </>
                              )}
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-slate-950/50">
                              <td colSpan={4} className="px-4 pb-3 pt-1">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                                      <th className="py-1.5 pl-6 pr-3 font-medium">Node</th>
                                      <th className="px-3 py-1.5 font-medium">Kubelet</th>
                                      <th className="px-3 py-1.5 font-medium">OS</th>
                                      <th className="px-3 py-1.5 font-medium">Kernel</th>
                                      <th className="px-3 py-1.5 font-medium">Runtime</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {c.nodes.map(n => (
                                      <tr key={n.name}>
                                        <td className="py-1 pl-6 pr-3 text-slate-200">
                                          {n.name} {n.controlPlane && <span className="badge badge-muted ml-1">control plane</span>}
                                        </td>
                                        <td className={cn('px-3 py-1 font-mono', c.kubeletVersions.length > 1 && n.kubelet !== c.kubeletVersions.at(-1) ? 'text-amber-300' : 'text-slate-300')}>
                                          {n.kubelet ?? '—'}
                                        </td>
                                        <td className={cn('px-3 py-1', c.talosVersions.length > 1 && n.talos !== c.talosVersions.at(-1) ? 'text-amber-300' : 'text-slate-300')}>
                                          {n.osImage ?? '—'}
                                        </td>
                                        <td className="px-3 py-1 font-mono text-slate-400">{n.kernel ?? '—'}</td>
                                        <td className="px-3 py-1 font-mono text-slate-400">{n.containerRuntime ?? '—'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </div>
    </AppShell>
  )
}
