'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Search, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { statusLabel, statusTone, useClusterSummaries } from '@/lib/clusterStatus'

// Searchable cluster picker in the top bar; also opens with Cmd/Ctrl+K.
// On a cluster page it is the page title and keeps the current tab when switching.

function Dot({ status }: { status: string }) {
  return <span className={cn('status-dot', `status-dot-${statusTone(status)}`)} aria-hidden />
}

export default function ClusterSwitcher({
  currentId,
  currentTab,
  variant,
}: {
  currentId?: number
  currentTab?: string
  variant: 'title' | 'compact'
}) {
  const router = useRouter()
  const clusters = useClusterSummaries()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const current = clusters.find(c => c.id === currentId)

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return [...clusters]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter(c => !needle || c.name.toLowerCase().includes(needle))
  }, [clusters, query])

  // Cmd/Ctrl+K anywhere opens the switcher
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close on a click outside
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(Math.max(0, [...clusters].sort((a, b) => a.name.localeCompare(b.name)).findIndex(c => c.id === currentId)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    listRef.current?.children[highlight]?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const go = (id: number) => {
    setOpen(false)
    if (id === currentId) return
    router.push(`/cluster/${id}${currentTab ? `?tab=${encodeURIComponent(currentTab)}` : ''}`)
  }

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && matches[highlight]) {
      e.preventDefault()
      go(matches[highlight].id)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  if (clusters.length === 0 && variant === 'compact') return null

  return (
    <div ref={rootRef} className="relative">
      {variant === 'title' ? (
        <button
          onClick={() => setOpen(o => !o)}
          className="-ml-2 flex max-w-full items-center gap-2 rounded-md px-2 py-0.5 text-base font-semibold text-white hover:bg-slate-800"
          title="Switch cluster (Ctrl/⌘ K)"
        >
          {current && <Dot status={current.status} />}
          <span className="truncate">{current?.name ?? 'Cluster'}</span>
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
        </button>
      ) : (
        <button onClick={() => setOpen(o => !o)} className="btn-secondary" title="Go to a cluster (Ctrl/⌘ K)">
          <Server className="h-4 w-4" />
          <span className="hidden md:inline">Clusters</span>
          <kbd className="hidden rounded border border-slate-600 px-1 font-sans text-[10px] text-slate-400 xl:inline">⌘K</kbd>
        </button>
      )}

      {open && (
        <div
          className={cn(
            'absolute top-full z-40 mt-2 w-80 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl',
            variant === 'title' ? 'left-0' : 'right-0'
          )}
        >
          <div className="relative border-b border-slate-800 p-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              value={query}
              onChange={e => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              onKeyDown={onInputKey}
              placeholder={`Search ${clusters.length} clusters…`}
              className="input h-9 pl-9"
            />
          </div>
          <ul ref={listRef} className="max-h-80 overflow-y-auto p-1" role="listbox">
            {matches.map((cluster, i) => (
              <li key={cluster.id} role="option" aria-selected={i === highlight}>
                <button
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => go(cluster.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm',
                    i === highlight ? 'bg-slate-800 text-white' : 'text-slate-300'
                  )}
                >
                  <Dot status={cluster.status} />
                  <span className="flex-1 truncate">{cluster.name}</span>
                  {cluster.id === currentId ? (
                    <span className="badge badge-muted">current</span>
                  ) : (
                    <span className="text-[11px] text-slate-500">{statusLabel(cluster.status)}</span>
                  )}
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No cluster matches “{query}”</li>}
          </ul>
          <div className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">↑↓ to move · Enter to open · Esc to close</div>
        </div>
      )}
    </div>
  )
}
