'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ExternalLink, Loader2, Lock, RefreshCw, Unlock, Search } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { cn } from '@/lib/utils'
import { useHideCustomerManaged } from '@/lib/useHideCustomerManaged'
import type { HostnamesResponse } from '@/app/api/hostnames/route'

type Row = HostnamesResponse['hostnames'][number]
type Filter = 'all' | 'problems' | 'expiring' | 'insecure'

// Same thresholds as the kubeconfig warnings on the dashboard
const CERT_WARNING_DAYS = 30
const CERT_CRITICAL_DAYS = 7

function StatTile({ label, value, tone, active, onClick }: { label: string; value: number; tone?: 'warn' | 'err'; active?: boolean; onClick?: () => void }) {
  const color = tone === 'warn' && value > 0 ? 'text-amber-400' : tone === 'err' && value > 0 ? 'text-rose-400' : 'text-white'
  return (
    <button onClick={onClick} className={cn('card px-4 py-3.5 text-left transition-colors hover:border-slate-600', active && 'border-orange-500/60')}>
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', color)}>{value}</p>
    </button>
  )
}

function certTone(row: Row): 'ok' | 'warn' | 'err' | null {
  const tls = row.tls
  if (!tls) return null
  if (tls.error || tls.matches === false) return 'err'
  if (tls.daysUntilExpiry === null) return null
  if (tls.daysUntilExpiry < CERT_CRITICAL_DAYS) return 'err'
  if (tls.daysUntilExpiry < CERT_WARNING_DAYS) return 'warn'
  return 'ok'
}

function CertCell({ row }: { row: Row }) {
  const tls = row.tls
  if (!tls) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
        <Unlock className="h-3.5 w-3.5" /> no TLS
      </span>
    )
  }
  const tone = certTone(row)
  const color = tone === 'err' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : 'text-emerald-400'
  const label = tls.error
    ? tls.error
    : tls.matches === false
      ? 'does not cover host'
      : tls.daysUntilExpiry! < 0
        ? 'expired'
        : `${tls.daysUntilExpiry} d`
  const title = [`Secret ${tls.secret}`, tls.issuer && `Issuer: ${tls.issuer}`, tls.notAfter && `Expires ${new Date(tls.notAfter).toLocaleString()}`]
    .filter(Boolean)
    .join('\n')
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs', color)} title={title}>
      <Lock className="h-3.5 w-3.5" /> {label}
    </span>
  )
}

export default function HostnamesPage() {
  const router = useRouter()
  const hideCustomerManaged = useHideCustomerManaged()
  const [data, setData] = useState<HostnamesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [cluster, setCluster] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/hostnames', { cache: 'no-store' })
      if (response.status === 401) {
        router.push('/login')
        return
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      setData(body)
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load hostnames')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  const all = useMemo(() => (data?.hostnames ?? []).filter(r => !hideCustomerManaged || !r.customerManaged), [data, hideCustomerManaged])
  const counts = useMemo(
    () => ({
      problems: all.filter(r => r.status === 'problem').length,
      expiring: all.filter(r => certTone(r) === 'warn' || certTone(r) === 'err').length,
      insecure: all.filter(r => !r.tls).length,
    }),
    [all]
  )
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return all
      .filter(r => !cluster || r.cluster === cluster)
      .filter(r => {
        if (filter === 'problems') return r.status === 'problem'
        if (filter === 'expiring') return certTone(r) === 'warn' || certTone(r) === 'err'
        if (filter === 'insecure') return !r.tls
        return true
      })
      .filter(r => !needle || `${r.hostname} ${r.cluster} ${r.namespace} ${r.name} ${r.backends.join(' ')} ${r.gateway ?? ''}`.toLowerCase().includes(needle))
  }, [all, cluster, filter, search])

  const failed = (data?.clusters ?? []).filter(c => c.error)
  const toggle = (next: Filter) => setFilter(f => (f === next ? 'all' : next))

  return (
    <AppShell
      customerFilter
      title="Hostnames"
      subtitle={data && `${data.clusters.length} cluster${data.clusters.length === 1 ? '' : 's'} · updated ${new Date(data.generatedAt).toLocaleTimeString()}`}
      actions={
        <button onClick={load} disabled={loading} className="btn-secondary">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      }
    >
      <div className="space-y-5">
        {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
        {failed.map(c => (
          <div key={c.id} className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {c.name}: {c.error}
          </div>
        ))}

        {!data && !error ? (
          <div className="flex items-center justify-center py-24 text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Collecting hostnames from all clusters…
          </div>
        ) : (
          data && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Hostnames" value={all.length} active={filter === 'all'} onClick={() => setFilter('all')} />
                <StatTile label="Route problems" value={counts.problems} tone="err" active={filter === 'problems'} onClick={() => toggle('problems')} />
                <StatTile label="Certificate issues" value={counts.expiring} tone="warn" active={filter === 'expiring'} onClick={() => toggle('expiring')} />
                <StatTile label="Without TLS" value={counts.insecure} active={filter === 'insecure'} onClick={() => toggle('insecure')} />
              </div>

              <div className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
                  <span className="badge badge-muted">{rows.length}</span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    {data.clusters.length > 1 && (
                      <select value={cluster} onChange={e => setCluster(e.target.value)} className="input h-8 w-44 py-0 pr-8 text-xs" aria-label="Cluster">
                        <option value="">Cluster: all</option>
                        {data.clusters.map(c => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="relative w-64">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Hostname, route, backend…" className="input h-8 pl-8 text-xs" />
                    </div>
                  </div>
                </div>

                {rows.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">
                    {all.length === 0 ? 'No HTTPRoutes, GRPCRoutes, TLSRoutes or Ingresses with a hostname found.' : 'No hostnames match.'}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1080px] text-sm">
                      <thead>
                        <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                          <th className="px-4 py-2.5 font-medium">Hostname</th>
                          <th className="px-3 py-2.5 font-medium">Cluster</th>
                          <th className="px-3 py-2.5 font-medium">Route</th>
                          <th className="px-3 py-2.5 font-medium">Gateway · listener</th>
                          <th className="px-3 py-2.5 font-medium">Backends</th>
                          <th className="px-3 py-2.5 font-medium">Certificate</th>
                          <th className="px-4 py-2.5 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {rows.map(r => (
                          <tr key={`${r.clusterId}/${r.kind}/${r.namespace}/${r.name}/${r.hostname}`} className="align-top">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1.5 font-mono text-xs text-slate-100">
                                {r.hostname}
                                {!r.hostname.includes('*') && (
                                  <a href={`${r.tls ? 'https' : 'http'}://${r.hostname}`} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-orange-400" title="Open">
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                              {r.fromListener && <div className="text-[11px] text-slate-500">from listener (route has no hostnames)</div>}
                            </td>
                            <td className="px-3 py-2.5">
                              <Link href={`/cluster/${r.clusterId}?tab=networking`} className="text-slate-300 hover:text-white hover:underline">
                                {r.cluster}
                              </Link>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className={cn('badge', r.kind === 'Ingress' ? 'badge-muted' : 'badge-info')}>{r.kind}</span>
                                <span className="text-slate-200">{r.name}</span>
                              </div>
                              <div className="text-xs text-slate-500">{r.namespace}</div>
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-300">{r.gateway ?? <span className="text-slate-500">—</span>}</td>
                            <td className="px-3 py-2.5 font-mono text-xs text-slate-300">
                              {r.backends.length ? r.backends.map(b => <div key={b}>{b}</div>) : <span className="text-slate-500">—</span>}
                            </td>
                            <td className="px-3 py-2.5">
                              <CertCell row={r} />
                            </td>
                            <td className="px-4 py-2.5">
                              <span className={cn('badge', r.status === 'ok' ? 'badge-ok' : r.status === 'problem' ? 'badge-err' : 'badge-muted')}>
                                {r.status === 'ok' ? 'OK' : r.status === 'problem' ? 'Problem' : 'Pending'}
                              </span>
                              {r.message && r.status !== 'ok' && <div className="mt-1 max-w-[16rem] text-xs text-slate-400">{r.message}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )
        )}
      </div>
    </AppShell>
  )
}
