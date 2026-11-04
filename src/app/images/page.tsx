'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarClock, Layers, Loader2, Package, RotateCw, ScanSearch, Search } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import ImageTable, { type ImageRow } from '@/components/images/ImageTable'
import WorkloadTable, { type WorkloadRow } from '@/components/images/WorkloadTable'
import SchedulePanel from '@/components/images/SchedulePanel'
import {
  formatDateTime,
  matchesStatus,
  relativeTime,
  statusRank,
  type ImageReportData,
  type ImageUsage,
  type StatusFilter,
} from '@/components/images/types'
import { cn } from '@/lib/utils'
import { useHideCustomerManaged } from '@/lib/useHideCustomerManaged'

type View = 'images' | 'workloads'

const VIEW_KEY = 'k8s-fleet-manager.imagesView'
const POLL_WHILE_RUNNING_MS = 5000

function StatTile({ label, value, hint, tone }: { label: string; value: number; hint?: string; tone?: 'ok' | 'warn' | 'err' }) {
  const color = tone === 'ok' ? 'text-emerald-400' : tone === 'warn' ? 'text-amber-400' : tone === 'err' ? 'text-rose-400' : 'text-white'
  return (
    <div className="card px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', color)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: string[]; label: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="input h-9 w-44 truncate py-0 pr-8" aria-label={label}>
      <option value="">{label}: all</option>
      {options.map(o => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

export default function ImagesPage() {
  const router = useRouter()
  const [data, setData] = useState<ImageReportData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rechecking, setRechecking] = useState(false)
  const [starting, setStarting] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)

  const [status, setStatus] = useState<StatusFilter>('all')
  const [cluster, setCluster] = useState('')
  const [namespace, setNamespace] = useState('')
  const [kind, setKind] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('images')

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/images', { cache: 'no-store' })
      if (response.status === 401) {
        router.push('/login')
        return
      }
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      setData(body)
      setError(null)
    } catch (err: any) {
      setError(err.message || 'Failed to load the image report')
    }
  }, [router])

  useEffect(() => {
    load()
    try {
      const saved = localStorage.getItem(VIEW_KEY)
      if (saved === 'images' || saved === 'workloads') setView(saved)
    } catch {
      // keep default
    }
  }, [load])

  // Follow a running scan until it finishes
  const running = !!data?.running
  useEffect(() => {
    if (!running) return
    const interval = setInterval(load, POLL_WHILE_RUNNING_MS)
    return () => clearInterval(interval)
  }, [running, load])

  const changeView = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // not persisted, fine
    }
  }

  const startScan = async () => {
    setStarting(true)
    setNotice(null)
    try {
      const response = await fetch('/api/images/scan', { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok && response.status !== 409) throw new Error(body.error || 'Failed to start the scan')
      if (response.status === 409) setNotice('A scan is already running.')
      await load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setStarting(false)
    }
  }

  const recheck = async () => {
    setRechecking(true)
    setNotice(null)
    try {
      const response = await fetch('/api/images/recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: Array.from(selected) }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Re-check failed')
      setNotice(`Re-checked ${body.checked} image${body.checked === 1 ? '' : 's'}: ${body.updates} with an update.`)
      setSelected(new Set())
      await load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setRechecking(false)
    }
  }

  const hideCustomer = useHideCustomerManaged()
  const visibleUsage = useCallback((u: ImageUsage) => !(hideCustomer && u.customerManaged), [hideCustomer])

  // Filter options, narrowed by the cluster choice
  const options = useMemo(() => {
    const usages = (data?.images ?? []).flatMap(i => i.usages).filter(visibleUsage)
    const inCluster = usages.filter(u => !cluster || u.clusterName === cluster)
    const uniq = (values: string[]) => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
    return {
      clusters: uniq(usages.map(u => u.clusterName)),
      namespaces: uniq(inCluster.map(u => u.namespace)),
      kinds: uniq(inCluster.map(u => u.kind)),
    }
  }, [data, cluster, visibleUsage])

  const usageMatches = useCallback(
    (u: ImageUsage) =>
      visibleUsage(u) && (!cluster || u.clusterName === cluster) && (!namespace || u.namespace === namespace) && (!kind || u.kind === kind),
    [visibleUsage, cluster, namespace, kind]
  )

  // Images that have at least one usage matching the cluster/namespace/kind filters
  const scoped = useMemo(() => {
    return (data?.images ?? [])
      .map(image => ({ image, usages: image.usages.filter(usageMatches) }))
      .filter(row => row.usages.length > 0)
  }, [data, usageMatches])

  const imageRows: ImageRow[] = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return scoped
      .filter(({ image }) => matchesStatus(image, status))
      .map(row => {
        if (!needle) return row
        const imageHit = `${row.image.image} ${row.image.latestVersion ?? ''}`.toLowerCase().includes(needle)
        const usages = imageHit
          ? row.usages
          : row.usages.filter(u => `${u.workload} ${u.container} ${u.namespace}`.toLowerCase().includes(needle))
        return { ...row, usages }
      })
      .filter(row => row.usages.length > 0)
      .sort((a, b) => statusRank(a.image) - statusRank(b.image) || a.image.name.localeCompare(b.image.name))
  }, [scoped, status, search])

  const workloadRows: WorkloadRow[] = useMemo(
    () =>
      imageRows
        .flatMap(({ image, usages }) => usages.map(usage => ({ usage, image })))
        .sort(
          (a, b) =>
            a.usage.clusterName.localeCompare(b.usage.clusterName) ||
            a.usage.namespace.localeCompare(b.usage.namespace) ||
            a.usage.workload.localeCompare(b.usage.workload) ||
            a.usage.container.localeCompare(b.usage.container)
        ),
    [imageRows]
  )

  // Tiles reflect the cluster/namespace/kind scope, not the status filter
  const stats = useMemo(() => {
    const images = scoped.map(r => r.image)
    const updates = images.filter(i => i.status === 'update')
    return {
      total: images.length,
      updates: updates.length,
      major: updates.filter(i => i.updateType === 'major').length,
      current: images.filter(i => i.status === 'current').length,
      other: images.filter(i => matchesStatus(i, 'other')).length,
      errors: images.filter(i => i.status === 'error').length,
      workloads: new Set(scoped.flatMap(r => r.usages.map(u => `${u.clusterId}/${u.namespace}/${u.kind}/${u.workload}`))).size,
    }
  }, [scoped])

  const toggle = (image: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(image)) next.delete(image)
      else next.add(image)
      return next
    })

  const visibleImages = imageRows.map(r => r.image.image)
  const toggleAll = () =>
    setSelected(prev => {
      const allSelected = visibleImages.length > 0 && visibleImages.every(i => prev.has(i))
      const next = new Set(prev)
      visibleImages.forEach(i => (allSelected ? next.delete(i) : next.add(i)))
      return next
    })

  const failedClusters = (data?.clusters ?? []).filter(c => c.error)
  const neverScanned = data && data.images.length === 0 && !data.lastRun && !data.running

  const statusFilters: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: stats.total },
    { id: 'update', label: 'Updates', count: stats.updates },
    { id: 'current', label: 'Up to date', count: stats.current },
    { id: 'other', label: 'Not comparable', count: stats.other },
    { id: 'error', label: 'Check failed', count: stats.errors },
  ]

  return (
    <AppShell
      customerFilter
      title="Images"
      subtitle={
        data && (
          <>
            {data.lastRun ? <>Last scan {formatDateTime(data.lastRun.finished_at ?? data.lastRun.started_at)}</> : 'No scan yet'}
            {data.schedule.enabled && data.schedule.nextRunAt && <> · next {formatDateTime(data.schedule.nextRunAt)}</>}
            {!data.schedule.enabled && <> · nightly scan off</>}
          </>
        )
      }
      actions={
        <>
          {selected.size > 0 && (
            <button onClick={recheck} disabled={rechecking} className="btn-secondary">
              <RotateCw className={cn('h-4 w-4', rechecking && 'animate-spin')} />
              <span className="hidden sm:inline">{rechecking ? 'Checking…' : `Re-check ${selected.size} selected`}</span>
            </button>
          )}
          <button onClick={() => setShowSchedule(true)} className="btn-ghost" title="Nightly scan schedule">
            <CalendarClock className="h-4 w-4" />
            <span className="hidden md:inline">Schedule</span>
          </button>
          <button onClick={startScan} disabled={running || starting} className="btn-primary">
            {running || starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            <span className="hidden sm:inline">{running ? 'Scanning…' : 'Scan now'}</span>
          </button>
        </>
      }
    >
      {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-300">{notice}</div>}

      {data?.running && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
          <Loader2 className="h-4 w-4 animate-spin" />
          Scan running since {formatDateTime(data.running.started_at)} ({data.running.trigger}). The report updates automatically.
        </div>
      )}
      {data?.lastRun?.status === 'failed' && !data.running && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          The last scan ({formatDateTime(data.lastRun.started_at)}) failed: {data.lastRun.error}
        </div>
      )}
      {failedClusters.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Inventory failed for {failedClusters.length} cluster{failedClusters.length === 1 ? '' : 's'}
          </div>
          <ul className="space-y-0.5 text-xs text-amber-200/80">
            {failedClusters.map(c => (
              <li key={c.id}>
                <span className="font-medium text-amber-100">{c.name}</span>: {c.error} — showing data from{' '}
                {c.scannedAt ? formatDateTime(c.scannedAt) : 'no earlier scan'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!data && !error ? (
        <div className="flex items-center justify-center py-24 text-sm text-slate-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading image report…
        </div>
      ) : neverScanned ? (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <Package className="h-10 w-10 text-slate-600" />
          <h3 className="mt-3 text-sm font-medium text-white">No image report yet</h3>
          <p className="mt-1 max-w-md text-sm text-slate-400">
            The nightly scan collects the images of all workloads in every cluster and checks for newer versions. Run it now to get the
            first report.
          </p>
          <button onClick={startScan} disabled={starting} className="btn-primary mt-5">
            <ScanSearch className="h-4 w-4" /> Scan now
          </button>
        </div>
      ) : (
        data && (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <StatTile label="Images" value={stats.total} hint={`in ${stats.workloads} workloads`} />
              <StatTile label="Updates" value={stats.updates} tone={stats.updates > 0 ? 'warn' : undefined} hint={stats.major > 0 ? `${stats.major} major` : undefined} />
              <StatTile label="Up to date" value={stats.current} tone="ok" />
              <StatTile label="Not comparable" value={stats.other} hint="latest, digest or no version" />
              <StatTile label="Check failed" value={stats.errors} tone={stats.errors > 0 ? 'err' : undefined} />
            </div>

            <div className="mb-3 flex flex-wrap gap-1">
              {statusFilters.map(f => (
                <button
                  key={f.id}
                  onClick={() => setStatus(f.id)}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-sm transition-colors',
                    status === f.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
                  )}
                >
                  {f.label}
                  <span className={cn('ml-1.5 tabular-nums', status === f.id ? 'text-slate-400' : 'text-slate-600')}>{f.count}</span>
                </button>
              ))}
            </div>

            <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="flex flex-wrap gap-2">
                <Select
                  label="Cluster"
                  value={cluster}
                  options={options.clusters}
                  onChange={v => {
                    setCluster(v)
                    setNamespace('')
                  }}
                />
                <Select label="Namespace" value={namespace} options={options.namespaces} onChange={setNamespace} />
                <Select label="Kind" value={kind} options={options.kinds} onChange={setKind} />
              </div>
              <div className="flex items-center gap-2 lg:ml-auto">
                <div className="relative w-full lg:w-72">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search image, workload, container…" className="input h-9 pl-9" />
                </div>
                <div className="flex flex-shrink-0 rounded-lg border border-slate-800 p-0.5 text-sm">
                  <button
                    onClick={() => changeView('images')}
                    className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1', view === 'images' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white')}
                  >
                    <Package className="h-3.5 w-3.5" /> By image
                  </button>
                  <button
                    onClick={() => changeView('workloads')}
                    className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1', view === 'workloads' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white')}
                  >
                    <Layers className="h-3.5 w-3.5" /> By workload
                  </button>
                </div>
              </div>
            </div>

            {imageRows.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">No images match these filters.</p>
            ) : view === 'images' ? (
              <ImageTable rows={imageRows} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
            ) : (
              <WorkloadTable rows={workloadRows} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
            )}

            <p className="mt-3 text-xs text-slate-500">
              {view === 'images' ? `${imageRows.length} images` : `${workloadRows.length} containers`}
              {data.lastRun && <> · inventory from {relativeTime(data.lastRun.finished_at ?? data.lastRun.started_at)}</>}
              {selected.size > 0 && <> · {selected.size} selected</>}
            </p>
          </>
        )
      )}

      {showSchedule && data && (
        <SchedulePanel
          schedule={data.schedule}
          canEdit={data.canEditSchedule}
          onClose={() => setShowSchedule(false)}
          onSaved={schedule => {
            setData(prev => (prev ? { ...prev, schedule } : prev))
            setShowSchedule(false)
          }}
        />
      )}
    </AppShell>
  )
}
