'use client'

import { Fragment, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import ImageStatusBadge from './ImageStatusBadge'
import { cveCountLabel, formatDateTime, relativeTime, type ImageUsage, type ReportImage } from './types'

export interface ImageRow {
  image: ReportImage
  // Usages that match the current filters
  usages: ImageUsage[]
}

export function CurrentVersion({ image }: { image: ReportImage }) {
  if (image.tag)
    return (
      <span className="inline-block max-w-[9rem] truncate whitespace-nowrap align-middle font-mono text-xs text-slate-200" title={image.tag}>
        {image.tag}
      </span>
    )
  return (
    <span className="font-mono text-xs text-slate-400" title={image.digest ?? undefined}>
      {image.digest?.slice(0, 19)}…
    </span>
  )
}

const cveBadge: Record<string, string> = {
  Critical: 'badge-err',
  High: 'bg-orange-500/15 text-orange-300',
  Medium: 'badge-warn',
  Low: 'badge-muted',
  None: 'badge-ok',
  Unknown: 'badge-muted',
}

export function CveScore({ image }: { image: ReportImage }) {
  if (image.cveError) {
    return (
      <span className="badge badge-err" title={image.cveError}>
        CVE failed
      </span>
    )
  }
  if (!image.cveSeverity) return <span className="text-slate-600">—</span>
  const counts = cveCountLabel(image)
  const scanned = image.cveScannedAt ? `scanned ${formatDateTime(image.cveScannedAt)}` : null
  const tip = [`${image.cveTotal ?? 0} vulnerabilities, ${image.cveFixable ?? 0} fixable`, scanned].filter(Boolean).join(' · ')
  return (
    <span className="inline-flex items-center gap-1.5" title={tip}>
      <span className={cn('badge', cveBadge[image.cveSeverity] ?? 'badge-muted')}>{image.cveSeverity}</span>
      {counts && <span className="whitespace-nowrap font-mono text-[11px] text-slate-400">{counts}</span>}
    </span>
  )
}

export function AvailableVersion({ image }: { image: ReportImage }) {
  if (image.status !== 'update' || !image.latestVersion) return <span className="text-slate-600">—</span>
  const major = image.tag?.replace(/^v/, '').split('.')[0]
  return (
    <span className="inline-flex max-w-[11rem] flex-col">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-xs text-white" title={image.latestVersion}>
        <ArrowRight className="h-3 w-3 flex-shrink-0 text-slate-500" />
        <span className="truncate">{image.latestVersion}</span>
      </span>
      {image.latestInMajor && (
        <span
          className="truncate whitespace-nowrap pl-[1.125rem] font-mono text-[11px] text-slate-400"
          title={`Newest version without changing major version: ${image.latestInMajor}`}
        >
          {major}.x: {image.latestInMajor}
        </span>
      )}
    </span>
  )
}

export function Checkbox({ checked, indeterminate, onChange, label }: { checked: boolean; indeterminate?: boolean; onChange: () => void; label: string }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="h-4 w-4 cursor-pointer rounded border-slate-600 bg-slate-950 accent-orange-600"
      checked={checked}
      ref={el => {
        if (el) el.indeterminate = !!indeterminate && !checked
      }}
      onChange={onChange}
      onClick={e => e.stopPropagation()}
    />
  )
}

function usageSummary(usages: ImageUsage[]) {
  const workloads = new Set(usages.map(u => `${u.clusterId}/${u.namespace}/${u.kind}/${u.workload}`)).size
  const clusters = new Set(usages.map(u => u.clusterId)).size
  // The cluster count only adds information when the image runs in more than one
  return `${workloads} workload${workloads === 1 ? '' : 's'}${clusters > 1 ? ` · ${clusters} clusters` : ''}`
}

// One row per unique image, expandable to show where it is used.
export default function ImageTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
}: {
  rows: ImageRow[]
  selected: Set<string>
  onToggle: (image: string) => void
  onToggleAll: () => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (image: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(image)) next.delete(image)
      else next.add(image)
      return next
    })

  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.image.image))
  const someSelected = rows.some(r => selected.has(r.image.image))

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="w-10 px-4 py-2.5">
              <Checkbox checked={allSelected} indeterminate={someSelected} onChange={onToggleAll} label="Select all visible images" />
            </th>
            <th className="px-3 py-2.5 font-medium">Image</th>
            <th className="px-3 py-2.5 font-medium">Current</th>
            <th className="px-3 py-2.5 font-medium">Available</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 font-medium">CVE</th>
            <th className="px-3 py-2.5 font-medium">Source</th>
            <th className="px-3 py-2.5 font-medium">Used by</th>
            <th className="px-4 py-2.5 text-right font-medium">Checked</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.map(({ image, usages }) => {
            const isOpen = expanded.has(image.image)
            return (
              <Fragment key={image.image}>
                <tr
                  onClick={() => toggleExpanded(image.image)}
                  className={cn('cursor-pointer transition-colors hover:bg-slate-800/40', selected.has(image.image) && 'bg-orange-500/5')}
                >
                  <td className="px-4 py-2.5">
                    <Checkbox checked={selected.has(image.image)} onChange={() => onToggle(image.image)} label={`Select ${image.name}`} />
                  </td>
                  <td className="max-w-[18rem] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />}
                      <span className="truncate font-medium text-white" title={image.image}>
                        {image.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <CurrentVersion image={image} />
                  </td>
                  <td className="px-3 py-2.5">
                    <AvailableVersion image={image} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ImageStatusBadge image={image} />
                  </td>
                  <td className="px-3 py-2.5">
                    <CveScore image={image} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-400">{image.source === 'nexus' ? 'Nexus' : image.source === 'online' ? 'Online' : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-300" title={Array.from(new Set(usages.map(u => u.clusterName))).join(', ')}>
                    {usageSummary(usages)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right text-xs text-slate-500" title={image.checkedAt ?? undefined}>
                    {relativeTime(image.checkedAt)}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-slate-950/50">
                    <td />
                    <td colSpan={8} className="px-3 pb-3 pt-1">
                      {image.error && <p className="mb-2 text-xs text-rose-300">Check failed: {image.error}</p>}
                      {image.cveError && <p className="mb-2 text-xs text-rose-300">CVE check failed: {image.cveError}</p>}
                      <p className="mb-2 break-all font-mono text-[11px] text-slate-500">{image.image}</p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-600">
                            <th className="py-1 pr-4 font-medium">Cluster</th>
                            <th className="py-1 pr-4 font-medium">Namespace</th>
                            <th className="py-1 pr-4 font-medium">Kind</th>
                            <th className="py-1 pr-4 font-medium">Workload</th>
                            <th className="py-1 font-medium">Container</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usages.map((u, i) => (
                            <tr key={i} className="text-slate-300">
                              <td className="py-1 pr-4">{u.clusterName}</td>
                              <td className="py-1 pr-4 text-slate-400">{u.namespace}</td>
                              <td className="py-1 pr-4">
                                <span className="badge badge-muted">{u.kind}</span>
                              </td>
                              <td className="py-1 pr-4 text-white">{u.workload}</td>
                              <td className="py-1 text-slate-400">
                                {u.container}
                                {u.initContainer && <span className="badge badge-muted ml-1.5">init</span>}
                              </td>
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
}
