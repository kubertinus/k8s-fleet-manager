'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, History, Loader2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ClusterHistory, HistoryBucket, HistoryRange } from '@/lib/history/query'
import type { HistoryStatus } from '@/lib/history/sampler'

// Availability, status timeline, CPU/memory trend and incidents of a cluster,
// from the samples the background sampler writes.

const RANGES: HistoryRange[] = ['24h', '7d', '30d']

// Status palette (fixed) and two categorical series validated against the dark card surface
const STATUS: Record<HistoryStatus, { color: string; label: string; icon: typeof CheckCircle2 }> = {
  healthy: { color: '#0ca30c', label: 'Healthy', icon: CheckCircle2 },
  warning: { color: '#fab219', label: 'Warning', icon: AlertTriangle },
  unhealthy: { color: '#ec835a', label: 'Unhealthy', icon: AlertTriangle },
  unreachable: { color: '#d03b3b', label: 'Unreachable', icon: XCircle },
  unknown: { color: '#475569', label: 'Unknown', icon: CircleSlash },
}
const SERIES = [
  { key: 'cpu' as const, label: 'CPU', color: '#3987e5' },
  { key: 'memory' as const, label: 'Memory', color: '#d95926' },
]

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function formatTime(iso: string, range: HistoryRange) {
  const d = new Date(iso)
  return range === '24h'
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} d ${hours % 24} h`
}

function formatPercent(value: number | null) {
  if (value === null) return '—'
  return value >= 99.995 ? '100%' : `${value.toFixed(value >= 99 ? 2 : 1)}%`
}

function Tooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  // Keep the tooltip inside the chart
  const left = Math.min(Math.max(x, 90), width - 90)
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-xs text-slate-200 shadow-lg"
      style={{ left }}
    >
      {children}
    </div>
  )
}

// One cell per bucket, positioned on the time axis so gaps (no samples) stay visible
function StatusTimeline({ history, start, end }: { history: ClusterHistory; start: number; end: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<HistoryBucket | null>(null)
  const span = end - start
  const bucketMs = history.bucketMinutes * 60_000
  const x = (t: number) => ((t - start) / span) * width

  return (
    <div ref={ref} className="relative pt-1">
      <svg width={width} height={28} className="block" role="img" aria-label="Status timeline">
        <rect x={0} y={0} width={width} height={28} rx={4} fill="#1e293b" />
        {width > 0 &&
          history.buckets.map(b => {
            const t = new Date(b.at).getTime()
            const x0 = Math.max(0, x(t))
            const x1 = Math.min(width, x(t + bucketMs))
            // 1px surface gap between cells when they are wide enough
            const w = Math.max(1, x1 - x0 - (x1 - x0 > 4 ? 1 : 0))
            return (
              <rect
                key={b.at}
                x={x0}
                y={0}
                width={w}
                height={28}
                fill={STATUS[b.status].color}
                opacity={hover && hover.at !== b.at ? 0.55 : 1}
                onMouseEnter={() => setHover(b)}
                onMouseLeave={() => setHover(null)}
              />
            )
          })}
      </svg>
      {hover && (
        <Tooltip x={x(new Date(hover.at).getTime() + bucketMs / 2)} width={width}>
          <div className="text-slate-400">
            {formatTime(hover.at, history.range)} – {formatTime(new Date(new Date(hover.at).getTime() + bucketMs).toISOString(), history.range)}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS[hover.status].color }} />
            {STATUS[hover.status].label}
            <span className="text-slate-500">· {hover.samples} samples</span>
          </div>
          {(hover.critical > 0 || hover.warning > 0) && (
            <div className="text-slate-400">
              up to {hover.critical} critical · {hover.warning} warning{hover.warning === 1 ? '' : 's'}
            </div>
          )}
        </Tooltip>
      )}
    </div>
  )
}

// CPU and memory share one axis (both percent of capacity)
function UsageChart({ history, start, end }: { history: ClusterHistory; start: number; end: number }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const height = 180
  const pad = { top: 10, right: 92, bottom: 22, left: 36 }
  const plotW = Math.max(0, width - pad.left - pad.right)
  const plotH = height - pad.top - pad.bottom
  const bucketMs = history.bucketMinutes * 60_000
  const points = history.buckets.map(b => ({ ...b, t: new Date(b.at).getTime() + bucketMs / 2 }))
  const x = (t: number) => pad.left + ((t - start) / (end - start)) * plotW
  const y = (v: number) => pad.top + plotH - (Math.min(100, Math.max(0, v)) / 100) * plotH

  // Break the line where buckets are missing or have no value
  const path = (key: 'cpu' | 'memory') => {
    let d = ''
    let prevT: number | null = null
    for (const p of points) {
      const v = p[key]
      if (v === null) {
        prevT = null
        continue
      }
      const gap = prevT === null || p.t - prevT > bucketMs * 1.5
      d += `${gap ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(v).toFixed(1)}`
      prevT = p.t
    }
    return d
  }

  const ticks = useMemo(() => {
    const count = Math.max(2, Math.min(6, Math.floor(plotW / 120)))
    return Array.from({ length: count + 1 }, (_, i) => start + ((end - start) * i) / count)
  }, [start, end, plotW])

  const last = (key: 'cpu' | 'memory') => [...points].reverse().find(p => p[key] !== null)
  const hover = hoverIndex !== null ? points[hoverIndex] : null

  const onMove = (event: React.MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const t = start + ((event.clientX - rect.left) / rect.width) * (end - start)
    let best: number | null = null
    points.forEach((p, i) => {
      if (best === null || Math.abs(p.t - t) < Math.abs(points[best].t - t)) best = i
    })
    // Only snap to a bucket that is near the pointer
    setHoverIndex(best !== null && Math.abs(points[best].t - t) < bucketMs ? best : null)
  }

  // Direct labels at the line ends, nudged apart when they collide
  const labels = SERIES.map(s => ({ ...s, point: last(s.key) }))
    .filter(l => l.point)
    .map(l => ({ ...l, ly: y(l.point![l.key]!) }))
  if (labels.length === 2 && Math.abs(labels[0].ly - labels[1].ly) < 14) {
    const mid = (labels[0].ly + labels[1].ly) / 2
    const [upper, lower] = labels[0].ly <= labels[1].ly ? [labels[0], labels[1]] : [labels[1], labels[0]]
    upper.ly = mid - 7
    lower.ly = mid + 7
  }

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} className="block" role="img" aria-label="CPU and memory usage over time">
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={pad.left} x2={pad.left + plotW} y1={y(v)} y2={y(v)} stroke="#1e293b" strokeWidth={1} />
              <text x={pad.left - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
                {v}%
              </text>
            </g>
          ))}
          {ticks.map(t => (
            <text key={t} x={x(t)} y={height - 6} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {formatTime(new Date(t).toISOString(), history.range)}
            </text>
          ))}
          {SERIES.map(s => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {labels.map(l => (
            <g key={l.key}>
              <circle cx={x(l.point!.t)} cy={y(l.point![l.key]!)} r={3} fill={l.color} stroke="#0f172a" strokeWidth={2} />
              <text x={pad.left + plotW + 8} y={l.ly} dy="0.32em" className="fill-slate-300 text-[11px] tabular-nums">
                {l.label} {Math.round(l.point![l.key]!)}%
              </text>
            </g>
          ))}
          {hover && (
            <g>
              <line x1={x(hover.t)} x2={x(hover.t)} y1={pad.top} y2={pad.top + plotH} stroke="#64748b" strokeWidth={1} />
              {SERIES.map(s =>
                hover[s.key] !== null ? <circle key={s.key} cx={x(hover.t)} cy={y(hover[s.key]!)} r={4} fill={s.color} stroke="#0f172a" strokeWidth={2} /> : null
              )}
            </g>
          )}
          <rect
            x={pad.left}
            y={pad.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHoverIndex(null)}
          />
        </svg>
      )}
      {hover && (
        <Tooltip x={x(hover.t)} width={width}>
          <div className="text-slate-400">{formatTime(hover.at, history.range)}</div>
          {SERIES.map(s => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
              {s.label} <span className="ml-auto pl-3 tabular-nums">{hover[s.key] === null ? '—' : `${hover[s.key]!.toFixed(1)}%`}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  )
}

export default function HealthHistory({ clusterId }: { clusterId: string }) {
  const [range, setRange] = useState<HistoryRange>('24h')
  const [history, setHistory] = useState<ClusterHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadedAt, setLoadedAt] = useState(Date.now())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/clusters/${clusterId}/history?range=${range}`, { cache: 'no-store' })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
      setHistory(body)
      setLoadedAt(Date.now())
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [clusterId, range])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5 * 60_000)
    return () => clearInterval(interval)
  }, [load])

  const end = loadedAt
  const start = end - { '24h': 24, '7d': 168, '30d': 720 }[range] * 3_600_000
  const present = useMemo(() => new Set(history?.buckets.map(b => b.status)), [history])

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <History className="h-5 w-5 text-orange-400" />
        <h3 className="font-semibold text-white">History</h3>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />}
        <div className="ml-auto flex rounded-lg border border-slate-800 p-0.5">
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn('rounded-md px-2.5 py-1 text-xs', r === range ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{error}</div>}

      {history && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {RANGES.map(r => (
              <div key={r} className={cn('rounded-lg border px-3 py-2.5', r === range ? 'border-slate-700 bg-slate-800/40' : 'border-slate-800')}>
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Available {r}</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-white">{formatPercent(history.availability[r])}</p>
              </div>
            ))}
          </div>

          {history.buckets.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No samples in this period yet. A sample is taken every {history.intervalMinutes} minutes.
            </p>
          ) : (
            <>
              <div>
                <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span className="font-medium text-slate-300">Status</span>
                  {(Object.keys(STATUS) as HistoryStatus[])
                    .filter(s => present.has(s))
                    .map(s => {
                      const Icon = STATUS[s].icon
                      return (
                        <span key={s} className="inline-flex items-center gap-1">
                          <Icon className="h-3 w-3" style={{ color: STATUS[s].color }} /> {STATUS[s].label}
                        </span>
                      )
                    })}
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2.5 w-2.5 rounded-sm bg-slate-800" /> No data
                  </span>
                </div>
                <StatusTimeline history={history} start={start} end={end} />
              </div>

              <div>
                <div className="mb-1.5 flex items-center gap-4 text-xs text-slate-400">
                  <span className="font-medium text-slate-300">Usage</span>
                  {SERIES.map(s => (
                    <span key={s.key} className="inline-flex items-center gap-1.5">
                      <span className="h-0.5 w-3 rounded" style={{ background: s.color }} /> {s.label}
                    </span>
                  ))}
                  <span className="text-slate-500">average per {history.bucketMinutes >= 60 ? `${history.bucketMinutes / 60} h` : `${history.bucketMinutes} min`}</span>
                </div>
                <UsageChart history={history} start={start} end={end} />
              </div>
            </>
          )}

          {history.incidents.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-300">Not healthy</p>
              <ul className="divide-y divide-slate-800/70 rounded-lg border border-slate-800 text-sm">
                {history.incidents.slice(0, 10).map(p => {
                  const Icon = STATUS[p.status].icon
                  return (
                    <li key={p.from} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                      <span className="inline-flex w-28 items-center gap-1.5 text-slate-200">
                        <Icon className="h-3.5 w-3.5" style={{ color: STATUS[p.status].color }} /> {STATUS[p.status].label}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatTime(p.from, '7d')} – {formatTime(p.to, '7d')}
                      </span>
                      <span className="ml-auto text-xs tabular-nums text-slate-500">{formatDuration(new Date(p.to).getTime() - new Date(p.from).getTime())}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {history.firstSample && (
            <p className="text-[11px] text-slate-500">
              Collecting since {new Date(history.firstSample).toLocaleString()} · sample every {history.intervalMinutes} min
            </p>
          )}
        </>
      )}
    </div>
  )
}
