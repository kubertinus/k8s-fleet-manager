'use client'

import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Network, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { withoutNamespaces } from '@/lib/customerManaged'
import type { GatewayApiData, RouteInfo } from '@/lib/gatewayApi'

// Gateway API part of the Networking tab: Gateways, their routes and the GatewayClasses.

function statusBadge(ok: boolean | null, okLabel: string, badLabel: string, unknownLabel = 'unknown') {
  if (ok === true) return <span className="badge badge-ok">{okLabel}</span>
  if (ok === false) return <span className="badge badge-err">{badLabel}</span>
  return <span className="badge badge-muted">{unknownLabel}</span>
}

// A route is fine when every parent accepted it and all its backends resolve
function routeHealth(route: RouteInfo): { ok: boolean | null; message: string | null } {
  if (route.parents.length === 0) return { ok: false, message: 'Not attached to a Gateway' }
  const problem = route.parents.find(p => p.accepted === false || p.resolvedRefs === false)
  if (problem) return { ok: false, message: problem.message ?? (problem.accepted === false ? 'Not accepted' : 'Backend not resolved') }
  if (route.parents.some(p => p.accepted === null)) return { ok: null, message: 'No status reported yet' }
  return { ok: true, message: null }
}

const kindBadge: Record<RouteInfo['kind'], string> = {
  HTTPRoute: 'badge-info',
  GRPCRoute: 'badge-info',
  TLSRoute: 'badge-muted',
  TCPRoute: 'badge-muted',
  UDPRoute: 'badge-muted',
}

export default function GatewayApiSection({
  data,
  hiddenNamespaces,
  namespace,
}: {
  data: GatewayApiData | undefined
  hiddenNamespaces: Set<string>
  // Namespace filter of the Networking tab ('all' or a name)
  namespace: string
}) {
  const [search, setSearch] = useState('')
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const gateways = useMemo(
    () => withoutNamespaces(data?.gateways ?? [], hiddenNamespaces).filter(g => namespace === 'all' || g.namespace === namespace),
    [data, hiddenNamespaces, namespace]
  )
  const routes = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return withoutNamespaces(data?.routes ?? [], hiddenNamespaces)
      .filter(r => namespace === 'all' || r.namespace === namespace)
      .filter(r => !onlyProblems || routeHealth(r).ok === false)
      .filter(r => !needle || `${r.name} ${r.namespace} ${r.hostnames.join(' ')} ${r.backends.join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name))
  }, [data, hiddenNamespaces, namespace, search, onlyProblems])
  const problems = withoutNamespaces(data?.routes ?? [], hiddenNamespaces).filter(r => routeHealth(r).ok === false).length

  if (!data?.installed) {
    return (
      <div className="card p-5 text-sm text-slate-400">
        <div className="mb-1 flex items-center gap-2 font-medium text-white">
          <Network className="h-4 w-4 text-orange-400" /> Gateway API
        </div>
        The Gateway API (gateway.networking.k8s.io) is not installed in this cluster.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Gateways */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <Network className="h-5 w-5 text-orange-400" />
          <h3 className="font-semibold text-white">Gateways</h3>
          <span className="badge badge-muted">{gateways.length}</span>
        </div>
        {gateways.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">No Gateways{namespace !== 'all' ? ` in ${namespace}` : ''}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Gateway</th>
                  <th className="px-3 py-2.5 font-medium">Class</th>
                  <th className="px-3 py-2.5 font-medium">Listeners</th>
                  <th className="px-3 py-2.5 font-medium">Address</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {gateways.map(g => (
                  <tr key={`${g.namespace}/${g.name}`} className="align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-white">{g.name}</div>
                      <div className="text-xs text-slate-500">{g.namespace}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-300">{g.gatewayClassName}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {g.listeners.map(l => (
                          <span key={l.name} className="badge badge-muted" title={`Listener "${l.name}"${l.tlsMode ? `, TLS ${l.tlsMode}` : ''}`}>
                            {l.protocol} {l.port}
                            {l.hostname ? ` · ${l.hostname}` : ''}
                            {l.attachedRoutes !== null ? ` · ${l.attachedRoutes} route${l.attachedRoutes === 1 ? '' : 's'}` : ''}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{g.addresses.join(', ') || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {statusBadge(g.programmed, 'Programmed', 'Not programmed')}
                        {g.accepted === false && <span className="badge badge-err">Not accepted</span>}
                      </div>
                      {g.message && <div className="mt-1 max-w-xs text-xs text-rose-300">{g.message}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Routes */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
          <h3 className="font-semibold text-white">Routes</h3>
          <span className="badge badge-muted">{routes.length}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => setOnlyProblems(p => !p)}
              className={cn('rounded-md px-2.5 py-1 text-sm', onlyProblems ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}
            >
              Needs attention {problems > 0 && <span className="badge badge-warn ml-1">{problems}</span>}
            </button>
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Host, route, backend…" className="input h-8 pl-8 text-xs" />
            </div>
          </div>
        </div>
        {routes.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">No routes match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Route</th>
                  <th className="px-3 py-2.5 font-medium">Hostnames</th>
                  <th className="px-3 py-2.5 font-medium">Gateway</th>
                  <th className="px-3 py-2.5 font-medium">Backends</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {routes.map(r => {
                  const key = `${r.kind}/${r.namespace}/${r.name}`
                  const health = routeHealth(r)
                  const isOpen = expanded === key
                  return (
                    <Fragment key={key}>
                      <tr onClick={() => setExpanded(isOpen ? null : key)} className="cursor-pointer align-top transition-colors hover:bg-slate-800/40">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
                            <span className="font-medium text-white">{r.name}</span>
                            <span className={cn('badge', kindBadge[r.kind])}>{r.kind}</span>
                          </div>
                          <div className="pl-[1.375rem] text-xs text-slate-500">{r.namespace}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          {r.hostnames.length ? (
                            <div className="flex flex-col gap-0.5 font-mono text-xs text-slate-200">
                              {r.hostnames.map(h => (
                                <span key={h}>{h}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">any (from listener)</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-300">
                          {r.parents.map(p => (
                            <div key={`${p.namespace}/${p.name}/${p.sectionName}`}>
                              {p.namespace !== r.namespace ? `${p.namespace}/` : ''}
                              {p.name}
                              {p.sectionName && <span className="text-slate-500"> · {p.sectionName}</span>}
                            </div>
                          ))}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-300">
                          {r.backends.length ? r.backends.map(b => <div key={b}>{b}</div>) : <span className="text-slate-500">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {statusBadge(health.ok, 'Accepted', 'Problem', 'Pending')}
                          {health.message && health.ok !== true && <div className="mt-1 max-w-xs text-xs text-rose-300">{health.message}</div>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-950/50">
                          <td colSpan={5} className="px-4 pb-3 pt-1 text-xs text-slate-400">
                            {r.rules} rule{r.rules === 1 ? '' : 's'} ·{' '}
                            {r.parents
                              .map(
                                p =>
                                  `${p.namespace}/${p.name}${p.sectionName ? `/${p.sectionName}` : ''}: accepted ${p.accepted ?? '?'}, references resolved ${p.resolvedRefs ?? '?'}`
                              )
                              .join(' · ')}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* GatewayClasses */}
      {(data.gatewayClasses.length ?? 0) > 0 && (
        <div className="card px-4 py-3 text-sm">
          <span className="mr-2 text-[11px] uppercase tracking-wider text-slate-500">GatewayClasses</span>
          {data.gatewayClasses.map(c => (
            <span key={c.name} className="mr-3 inline-flex items-center gap-1.5 text-slate-300" title={c.description ?? undefined}>
              {c.name} <span className="font-mono text-xs text-slate-500">{c.controllerName}</span>
              {c.accepted === false && <span className="badge badge-err">not accepted</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
