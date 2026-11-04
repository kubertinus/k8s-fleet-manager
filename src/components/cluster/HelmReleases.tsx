'use client'

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RefreshCw, Search, Ship } from 'lucide-react'
import { cn } from '@/lib/utils'
import { withoutNamespaces } from '@/lib/customerManaged'

interface HelmRevision {
  revision: number
  status: string
  chartVersion: string
  appVersion: string | null
  updated: string | null
  description: string | null
}

interface ChartDeployment {
  managedBy: 'helm' | 'argocd'
  name: string
  namespace: string
  chart: string
  chartVersion: string
  appVersion: string | null
  status: string
  revision: number
  updated: string | null
  firstDeployed: string | null
  description: string | null
  chartDescription: string | null
  history: HelmRevision[]
  repoUrl?: string | null
  syncStatus?: string | null
  healthStatus?: string | null
  argoApp?: string
}

type SourceFilter = 'all' | 'helm' | 'argocd'

// Helm: deployed is fine, failed is broken, pending-* is stuck mid-operation.
// Argo CD: Healthy is fine, Degraded/Missing is broken, Progressing/Suspended is in between.
function statusBadge(status: string) {
  if (status === 'deployed' || status === 'Healthy' || status === 'Synced') return 'badge-ok'
  if (status === 'failed' || status === 'Degraded' || status === 'Missing') return 'badge-err'
  if (status.startsWith('pending') || status === 'Progressing' || status === 'OutOfSync' || status === 'Suspended') return 'badge-warn'
  return 'badge-muted'
}

function hasProblem(d: ChartDeployment) {
  if (d.managedBy === 'argocd') return d.healthStatus !== 'Healthy' || d.syncStatus !== 'Synced'
  return d.status !== 'deployed'
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: React.ReactNode }[] }) {
  return (
    <div className="flex rounded-lg border border-slate-800 p-0.5 text-sm">
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn('rounded-md px-2.5 py-1', value === o.id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Helm charts in a cluster, installed by Helm itself or by Argo CD.
export default function HelmReleases({ clusterId, hiddenNamespaces }: { clusterId: string; hiddenNamespaces: Set<string> }) {
  const [deployments, setDeployments] = useState<ChartDeployment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [partialErrors, setPartialErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [onlyProblems, setOnlyProblems] = useState<'all' | 'problems'>('all')
  const [source, setSource] = useState<SourceFilter>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/clusters/${clusterId}/helm`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setDeployments(data.releases)
      setPartialErrors(data.errors ?? [])
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load Helm charts')
    } finally {
      setLoading(false)
    }
  }, [clusterId])

  useEffect(() => {
    load()
  }, [load])

  const scoped = useMemo(() => withoutNamespaces(deployments ?? [], hiddenNamespaces), [deployments, hiddenNamespaces])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return scoped.filter(d => {
      if (source !== 'all' && d.managedBy !== source) return false
      if (onlyProblems === 'problems' && !hasProblem(d)) return false
      if (!needle) return true
      return `${d.name} ${d.namespace} ${d.chart} ${d.chartVersion} ${d.appVersion ?? ''} ${d.repoUrl ?? ''}`.toLowerCase().includes(needle)
    })
  }, [scoped, search, source, onlyProblems])

  const count = (filter: SourceFilter) => scoped.filter(d => filter === 'all' || d.managedBy === filter).length
  const problems = scoped.filter(d => (source === 'all' || d.managedBy === source) && hasProblem(d)).length

  const toggle = (key: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex items-center gap-2">
          <Ship className="h-5 w-5 text-orange-400" />
          <h2 className="text-lg font-semibold text-white">Helm charts</h2>
          {deployments && <span className="badge badge-muted">{visible.length}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 xl:ml-auto">
          <Segmented
            value={source}
            onChange={setSource}
            options={[
              { id: 'all', label: <>All <span className="text-slate-500">{count('all')}</span></> },
              { id: 'helm', label: <>Helm <span className="text-slate-500">{count('helm')}</span></> },
              { id: 'argocd', label: <>Argo CD <span className="text-slate-500">{count('argocd')}</span></> },
            ]}
          />
          <Segmented
            value={onlyProblems}
            onChange={setOnlyProblems}
            options={[
              { id: 'all', label: 'Any status' },
              { id: 'problems', label: <>Needs attention {problems > 0 && <span className="badge badge-warn ml-1">{problems}</span>}</> },
            ]}
          />
          <div className="relative w-full md:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chart, release, namespace…" className="input h-9 pl-9" />
          </div>
          <button onClick={load} disabled={loading} className="btn-secondary" title="Reload">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {partialErrors.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Partly loaded: {partialErrors.join(' · ')}
        </div>
      )}

      {!deployments && !error ? (
        <div className="flex items-center justify-center py-16 text-sm text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading Helm charts…
        </div>
      ) : deployments && deployments.length === 0 ? (
        <div className="card px-6 py-12 text-center text-sm text-slate-400">No Helm releases or Argo CD Helm applications found.</div>
      ) : deployments && visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No charts match these filters.</p>
      ) : (
        deployments && (
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-3 py-2.5 font-medium">Namespace</th>
                  <th className="px-3 py-2.5 font-medium">Chart</th>
                  <th className="px-3 py-2.5 font-medium">Chart version</th>
                  <th className="px-3 py-2.5 font-medium">App version</th>
                  <th className="px-3 py-2.5 font-medium">Managed by</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {visible.map(d => {
                  const key = `${d.managedBy}/${d.namespace}/${d.name}`
                  const isOpen = expanded.has(key)
                  const isArgo = d.managedBy === 'argocd'
                  return (
                    <Fragment key={key}>
                      <tr onClick={() => toggle(key)} className="cursor-pointer transition-colors hover:bg-slate-800/40">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                            <span className="font-medium text-white">{d.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-300">{d.namespace}</td>
                        <td className="px-3 py-2.5 text-slate-300">{d.chart}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-200">{d.chartVersion || '—'}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{d.appVersion ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className="badge badge-muted">{isArgo ? 'Argo CD' : 'Helm'}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-nowrap gap-1">
                            <span className={cn('badge', statusBadge(d.status))}>{d.status}</span>
                            {isArgo && d.syncStatus && <span className={cn('badge', statusBadge(d.syncStatus))}>{d.syncStatus}</span>}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-slate-400">{formatDate(d.updated)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-950/50">
                          <td colSpan={8} className="px-4 pb-4 pt-2">
                            <div className="mb-3 space-y-0.5 text-xs text-slate-400">
                              {d.chartDescription && <p>{d.chartDescription}</p>}
                              {isArgo && (
                                <p>
                                  Argo CD application <span className="text-slate-200">{d.argoApp}</span>
                                  {d.repoUrl && (
                                    <>
                                      {' · '}repository <span className="break-all font-mono text-slate-300">{d.repoUrl}</span>
                                    </>
                                  )}
                                </p>
                              )}
                              {!isArgo && <p>Helm release revision {d.revision}</p>}
                              <p className="text-slate-500">
                                {isArgo ? 'Oldest deployment in history' : 'First deployed'} {formatDate(d.firstDeployed)}
                              </p>
                            </div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-600">
                                  <th className="py-1 pr-4 font-medium">{isArgo ? 'Sync' : 'Revision'}</th>
                                  {!isArgo && <th className="py-1 pr-4 font-medium">Status</th>}
                                  <th className="py-1 pr-4 font-medium">Chart version</th>
                                  {!isArgo && <th className="py-1 pr-4 font-medium">App</th>}
                                  <th className="py-1 pr-4 font-medium">{isArgo ? 'Deployed' : 'Updated'}</th>
                                  <th className="py-1 font-medium">{isArgo ? 'Initiated by' : 'Description'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.history.map(rev => (
                                  <tr key={rev.revision} className="text-slate-300">
                                    <td className="py-1 pr-4 tabular-nums">{rev.revision}</td>
                                    {!isArgo && (
                                      <td className="py-1 pr-4">
                                        <span className={cn('badge', statusBadge(rev.status))}>{rev.status}</span>
                                      </td>
                                    )}
                                    <td className="py-1 pr-4 font-mono">{rev.chartVersion || '—'}</td>
                                    {!isArgo && <td className="py-1 pr-4 font-mono">{rev.appVersion ?? '—'}</td>}
                                    <td className="whitespace-nowrap py-1 pr-4 text-slate-400">{formatDate(rev.updated)}</td>
                                    <td className="py-1 text-slate-400">{rev.description ?? ''}</td>
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
        )
      )}
    </div>
  )
}
