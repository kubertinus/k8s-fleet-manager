'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { withoutNamespaces } from '@/lib/customerManaged'
import { useHideCustomerManaged } from '@/lib/useHideCustomerManaged'
import { cn } from '@/lib/utils'

interface Finding {
  group: string
  version: string
  kind: string
  removedIn: string | null
  replacement: string | null
  source: 'api-traffic' | 'helm'
  release?: string
  namespace?: string
  objects?: string[]
}

interface ClusterResult {
  clusterId: number
  clusterName: string
  kubernetesVersion: string | null
  findings: Finding[]
  customerManagedNamespaces: string[]
  warnings: string[]
}

type Urgency = 'removed' | 'next' | 'later' | 'unscheduled'

const minorOf = (version: string | null) => {
  const match = version?.match(/^v?1\.(\d+)/)
  return match ? Number(match[1]) : null
}

// How urgent a finding is, relative to the cluster's current version
function urgency(finding: Finding, currentMinor: number | null): Urgency {
  const removed = minorOf(finding.removedIn)
  if (removed === null) return 'unscheduled'
  if (currentMinor === null) return 'later'
  if (removed <= currentMinor) return 'removed'
  if (removed === currentMinor + 1) return 'next'
  return 'later'
}

const urgencyBadge: Record<Urgency, [string, string]> = {
  removed: ['badge-err', 'already removed'],
  next: ['badge-err', 'removed in next version'],
  later: ['badge-warn', 'removal planned'],
  unscheduled: ['badge-muted', 'deprecated, no removal planned'],
}
const urgencyOrder: Record<Urgency, number> = { removed: 0, next: 1, later: 2, unscheduled: 3 }

function ClusterCard({ result, hideCustomer }: { result: ClusterResult; hideCustomer: boolean }) {
  const currentMinor = minorOf(result.kubernetesVersion)
  const findings = useMemo(() => {
    const visible = hideCustomer ? withoutNamespaces(result.findings, new Set(result.customerManagedNamespaces)) : result.findings
    return [...visible].sort((a, b) => urgencyOrder[urgency(a, currentMinor)] - urgencyOrder[urgency(b, currentMinor)])
  }, [result, hideCustomer, currentMinor])

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-3">
        <span className="font-semibold text-white">{result.clusterName}</span>
        <span className="font-mono text-xs text-slate-500">{result.kubernetesVersion ?? 'version unknown'}</span>
        <span className="ml-auto text-xs text-slate-400">
          {findings.length} finding{findings.length === 1 ? '' : 's'}
        </span>
      </div>
      {result.warnings.map(w => (
        <p key={w} className="border-b border-slate-800 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          {w}
        </p>
      ))}
      {findings.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> No deprecated APIs found
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-4 py-2.5 font-medium">API</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Use instead</th>
                <th className="px-4 py-2.5 font-medium">Found in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {findings.map((f, i) => {
                const u = urgency(f, currentMinor)
                const [badge, label] = urgencyBadge[u]
                return (
                  <tr key={i} className="align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-white">{f.kind}</div>
                      <div className="font-mono text-xs text-slate-500">{f.group ? `${f.group}/${f.version}` : f.version}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={cn('badge', badge)}>{label}</span>
                      {f.removedIn && <div className="mt-0.5 text-xs text-slate-500">removed in {f.removedIn}</div>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{f.replacement ?? '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-300">
                      {f.source === 'helm' ? (
                        <>
                          Helm release <span className="text-white">{f.release}</span>
                          {f.objects && f.objects.length > 0 && <div className="text-slate-500">{f.objects.join(', ')}</div>}
                        </>
                      ) : (
                        <span title="Requested from the API server since its last restart (by any client, e.g. a controller or kubectl)">API traffic</span>
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
  )
}

export default function DeprecatedApisPage() {
  const [clusters, setClusters] = useState<ClusterResult[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const hideCustomer = useHideCustomerManaged()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/tools/deprecated-apis', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setClusters(data.clusters)
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <AppShell
      customerFilter
      title="Deprecated APIs"
      subtitle="API versions in use that Kubernetes removes in a later release"
      actions={
        <button onClick={load} disabled={loading} className="btn-secondary">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          <span className="hidden sm:inline">Check again</span>
        </button>
      }
    >
      <p className="mb-5 max-w-3xl text-sm text-slate-400">
        Two sources per cluster: what the API server itself reports as deprecated in its traffic since its last restart (any client:
        controllers, operators, kubectl), and the manifests of deployed Helm releases. Charts rendered by Argo CD are only seen through
        API traffic.
      </p>
      {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {!clusters && !error ? (
        <div className="flex items-center justify-center py-16 text-sm text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking clusters…
        </div>
      ) : (
        <div className="space-y-4">
          {clusters?.map(c => (
            <ClusterCard key={c.clusterId} result={c} hideCustomer={hideCustomer} />
          ))}
        </div>
      )}
    </AppShell>
  )
}
