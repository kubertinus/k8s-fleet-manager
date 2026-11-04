'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LayoutGrid, List, RefreshCw, Search, Server } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import AIChatbot from '@/components/AIChatbot'
import ClusterCard, { ClusterCardSkeleton } from '@/components/dashboard/ClusterCard'
import ClusterTable, { type UptimeMap } from '@/components/dashboard/ClusterTable'
import IssuesPanel from '@/components/dashboard/IssuesPanel'
import { attentionRank, issueCounts, isUnreachable, withoutCustomerManaged, type ClusterHealth } from '@/components/dashboard/types'
import { setClusterList, setClusterStatus } from '@/lib/clusterStatus'
import { useHideCustomerManaged } from '@/lib/useHideCustomerManaged'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'attention' | 'healthy' | 'unreachable'
type View = 'grid' | 'list'

const VIEW_KEY = 'k8s-fleet-manager.dashboardView'
const REFRESH_INTERVAL_MS = 30000
// How many cluster health checks the browser runs at once. The server caches and
// de-duplicates checks, so this only bounds the burst when many clusters refresh.
const MAX_PARALLEL_CHECKS = 4

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items]
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      await worker(queue.shift()!)
    }
  })
  await Promise.all(runners)
}

function needsAttention(cluster: ClusterHealth) {
  const { critical, warning } = issueCounts(cluster)
  return isUnreachable(cluster) || cluster.status === 'warning' || critical + warning > 0
}

function StatTile({ label, value, total, tone }: { label: string; value: number | string; total?: number; tone?: 'ok' | 'warn' | 'err' }) {
  const color = tone === 'ok' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : tone === 'err' ? 'text-rose-400' : 'text-white'
  return (
    <div className="card px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', color)}>
        {value}
        {total !== undefined && <span className="text-base font-normal text-slate-500">/{total}</span>}
      </p>
    </div>
  )
}

export default function Dashboard() {
  const router = useRouter()
  const [rawClusters, setClusters] = useState<ClusterHealth[]>([])
  const [issuesFor, setIssuesFor] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isInitialLoading, setIsInitialLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('grid')
  const [uptime, setUptime] = useState<UptimeMap>({})
  const clustersRef = useRef<ClusterHealth[]>([])

  // Uptime only changes with new samples (every few minutes); load it with the list view
  useEffect(() => {
    if (view !== 'list') return
    const load = () =>
      fetch('/api/history/uptime', { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : {}))
        .then(setUptime)
        .catch(() => {})
    load()
    const interval = setInterval(load, 5 * 60_000)
    return () => clearInterval(interval)
  }, [view])

  useEffect(() => {
    clustersRef.current = rawClusters
  }, [rawClusters])

  // What the page shows: with "hide customer managed" on, without customer-managed warnings
  const hideCustomer = useHideCustomerManaged()
  const clusters = useMemo(
    () => (hideCustomer ? rawClusters.map(withoutCustomerManaged) : rawClusters),
    [rawClusters, hideCustomer]
  )

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY)
      if (saved === 'grid' || saved === 'list') setView(saved)
    } catch {
      // keep default
    }
  }, [])

  const changeView = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // not persisted, fine
    }
  }

  // Fetch basic cluster info quickly
  const fetchBasicClusters = useCallback(async (): Promise<ClusterHealth[] | undefined> => {
    try {
      const response = await fetch('/api/clusters/quick', { headers: { 'Cache-Control': 'no-cache' } })

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      const basicClusters: ClusterHealth[] = data.clusters.map((cluster: ClusterHealth) => ({ ...cluster, isLoading: true }))

      setClusters(basicClusters)
      setClusterList(basicClusters.map(c => ({ id: c.id, name: c.name, status: c.status })))
      setLastUpdated(new Date())
      setIsInitialLoading(false)

      return basicClusters
    } catch (err: any) {
      console.error('Error fetching basic clusters:', err)
      setError(err.message || 'Failed to fetch cluster data')
      setIsInitialLoading(false)
    }
  }, [router])

  // Fetch individual cluster health data. `force` bypasses the server's fresh cache.
  const fetchClusterHealth = useCallback(async (clusterId: number, force = false) => {
    setClusters(prev => prev.map(cluster => (cluster.id === clusterId ? { ...cluster, isLoading: true } : cluster)))
    try {
      const response = await fetch(`/api/clusters/${clusterId}/health${force ? '?refresh=1' : ''}`, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const clusterData = await response.json()
      setClusters(prev => prev.map(cluster => (cluster.id === clusterId ? { ...cluster, ...clusterData, error: clusterData.error, isLoading: false } : cluster)))
      setClusterStatus(clusterId, clusterData.status)
    } catch (err: any) {
      console.error(`Error fetching cluster ${clusterId} health:`, err)
      setClusters(prev =>
        prev.map(cluster => (cluster.id === clusterId ? { ...cluster, status: 'error', error: err.message, isLoading: false } : cluster))
      )
      setClusterStatus(clusterId, 'error')
    }
  }, [])

  const refreshing = useRef(false)
  const lastRefresh = useRef(0)

  // Check every cluster with a bounded number of requests in flight; rounds never overlap.
  const checkAll = useCallback(
    async (list: ClusterHealth[], force = false) => {
      if (refreshing.current) return
      refreshing.current = true
      try {
        await runPool(list, MAX_PARALLEL_CHECKS, cluster => fetchClusterHealth(cluster.id, force))
      } finally {
        refreshing.current = false
        lastRefresh.current = Date.now()
        setLastUpdated(new Date())
      }
    },
    [fetchClusterHealth]
  )

  const refreshAll = useCallback(
    async (force = false) => {
      setError(null)
      const current = clustersRef.current
      if (current.length === 0) {
        const basic = await fetchBasicClusters()
        if (basic) await checkAll(basic, force)
        return
      }
      await checkAll(current, force)
    },
    [fetchBasicClusters, checkAll]
  )

  useEffect(() => {
    fetchBasicClusters().then(basic => basic && checkAll(basic))

    // Background refresh: only while the tab is visible, and catch up when it becomes visible again.
    const tick = () => {
      if (!document.hidden) refreshAll()
    }
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastRefresh.current > REFRESH_INTERVAL_MS) refreshAll()
    }
    const interval = setInterval(tick, REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stats = useMemo(() => {
    let critical = 0
    let warning = 0
    for (const c of clusters) {
      const counts = issueCounts(c)
      critical += counts.critical + (c.status === 'error' || c.status === 'timeout' ? 1 : 0)
      warning += counts.warning
    }
    return {
      healthy: clusters.filter(c => c.status === 'healthy').length,
      nodesReady: clusters.reduce((sum, c) => sum + (c.healthyNodes || 0), 0),
      nodesTotal: clusters.reduce((sum, c) => sum + (c.totalNodes || 0), 0),
      pods: clusters.reduce((sum, c) => sum + (c.totalPods || 0), 0),
      critical,
      warning,
      attention: clusters.filter(needsAttention).length,
      unreachable: clusters.filter(isUnreachable).length,
    }
  }, [clusters])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return clusters
      .filter(c => !needle || c.name.toLowerCase().includes(needle))
      .filter(c => {
        switch (filter) {
          case 'attention':
            return needsAttention(c)
          case 'healthy':
            return c.status === 'healthy' && !needsAttention(c)
          case 'unreachable':
            return isUnreachable(c)
          default:
            return true
        }
      })
      .sort((a, b) => attentionRank(a) - attentionRank(b) || a.name.localeCompare(b.name))
  }, [clusters, filter, search])

  const issuesCluster = clusters.find(c => c.id === issuesFor) || null
  const anyLoading = clusters.some(c => c.isLoading)

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: clusters.length },
    { id: 'attention', label: 'Needs attention', count: stats.attention },
    { id: 'healthy', label: 'Healthy', count: clusters.filter(c => c.status === 'healthy' && !needsAttention(c)).length },
    { id: 'unreachable', label: 'Unreachable', count: stats.unreachable },
  ]

  return (
    <AppShell
      customerFilter
      title="Overview"
      subtitle={
        clusters.length > 0 && (
          <>
            {clusters.length} clusters · {stats.nodesTotal} nodes
            {lastUpdated && <> · updated {lastUpdated.toLocaleTimeString()}</>}
          </>
        )
      }
      actions={
        <button onClick={() => refreshAll(true)} disabled={anyLoading} className="btn-primary">
          <RefreshCw className={cn('h-4 w-4', anyLoading && 'animate-spin')} />
          <span className="hidden sm:inline">{anyLoading ? 'Refreshing…' : 'Refresh all'}</span>
        </button>
      }
    >
      {error && (
        <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <span>Error: {error}</span>
          <button onClick={() => refreshAll(true)} className="btn-secondary">
            Retry
          </button>
        </div>
      )}

      {/* Fleet summary */}
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Healthy clusters" value={stats.healthy} total={clusters.length} />
        <StatTile label="Nodes ready" value={stats.nodesReady} total={stats.nodesTotal} tone={stats.nodesReady < stats.nodesTotal ? 'warn' : 'ok'} />
        <StatTile label="Pods" value={stats.pods} />
        <StatTile label="Warnings" value={stats.warning} tone={stats.warning > 0 ? 'warn' : undefined} />
        <StatTile label="Critical" value={stats.critical} tone={stats.critical > 0 ? 'err' : undefined} />
      </div>

      {/* Toolbar */}
      {clusters.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex flex-wrap gap-1">
            {filters.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  filter === f.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                )}
              >
                {f.label}
                <span className={cn('ml-1.5 tabular-nums', filter === f.id ? 'text-slate-400' : 'text-slate-600')}>{f.count}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 md:ml-auto">
            <div className="relative w-full md:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clusters…" className="input h-9 pl-9" />
            </div>
            <div className="flex rounded-lg border border-slate-800 p-0.5">
              <button
                onClick={() => changeView('grid')}
                className={cn('rounded-md p-1.5', view === 'grid' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white')}
                title="Card view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => changeView('list')}
                className={cn('rounded-md p-1.5', view === 'list' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white')}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clusters */}
      {isInitialLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <ClusterCardSkeleton key={i} />
          ))}
        </div>
      ) : clusters.length === 0 && !error ? (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <Server className="h-10 w-10 text-slate-600" />
          <h3 className="mt-3 text-sm font-medium text-white">No clusters configured</h3>
          <p className="mt-1 text-sm text-slate-400">Add your first cluster to start monitoring.</p>
          <Link href="/settings#cluster-settings" className="btn-primary mt-5">
            Add cluster
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">No clusters match this filter.</p>
      ) : view === 'list' ? (
        <ClusterTable clusters={visible} uptime={uptime} onShowIssues={c => setIssuesFor(c.id)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 min-[1800px]:grid-cols-4">
          {visible.map(cluster => (
            <ClusterCard key={cluster.id} cluster={cluster} onShowIssues={() => setIssuesFor(cluster.id)} />
          ))}
        </div>
      )}

      {issuesCluster && <IssuesPanel cluster={issuesCluster} onClose={() => setIssuesFor(null)} />}

      <div className="theme-compat">
        <AIChatbot />
      </div>
    </AppShell>
  )
}
