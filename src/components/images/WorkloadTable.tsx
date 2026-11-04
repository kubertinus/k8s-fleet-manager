'use client'

import { cn } from '@/lib/utils'
import ImageStatusBadge from './ImageStatusBadge'
import { AvailableVersion, Checkbox, CurrentVersion } from './ImageTable'
import type { ImageUsage, ReportImage } from './types'

export interface WorkloadRow {
  usage: ImageUsage
  image: ReportImage
}

// One row per workload container. Selecting a row selects its image.
export default function WorkloadTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
}: {
  rows: WorkloadRow[]
  selected: Set<string>
  onToggle: (image: string) => void
  onToggleAll: () => void
}) {
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.image.image))
  const someSelected = rows.some(r => selected.has(r.image.image))

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <th className="w-10 px-4 py-2.5">
              <Checkbox checked={allSelected} indeterminate={someSelected} onChange={onToggleAll} label="Select all visible images" />
            </th>
            <th className="px-3 py-2.5 font-medium">Cluster</th>
            <th className="px-3 py-2.5 font-medium">Namespace</th>
            <th className="px-3 py-2.5 font-medium">Kind</th>
            <th className="px-3 py-2.5 font-medium">Workload / container</th>
            <th className="px-3 py-2.5 font-medium">Image</th>
            <th className="px-3 py-2.5 font-medium">Current</th>
            <th className="px-3 py-2.5 font-medium">Available</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.map(({ usage, image }, i) => (
            <tr
              key={i}
              onClick={() => onToggle(image.image)}
              className={cn('cursor-pointer transition-colors hover:bg-slate-800/40', selected.has(image.image) && 'bg-orange-500/5')}
            >
              <td className="px-4 py-2">
                <Checkbox checked={selected.has(image.image)} onChange={() => onToggle(image.image)} label={`Select ${image.name}`} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-300">{usage.clusterName}</td>
              <td className="whitespace-nowrap px-3 py-2 text-slate-400">{usage.namespace}</td>
              <td className="px-3 py-2">
                <span className="badge badge-muted">{usage.kind}</span>
              </td>
              <td className="px-3 py-2">
                <div className="font-medium text-white">{usage.workload}</div>
                <div className="text-xs text-slate-500">
                  {usage.container}
                  {usage.initContainer && <span className="badge badge-muted ml-1.5">init</span>}
                </div>
              </td>
              <td className="max-w-[16rem] truncate px-3 py-2 text-slate-300" title={image.image}>
                {image.name}
              </td>
              <td className="px-3 py-2">
                <CurrentVersion image={image} />
              </td>
              <td className="px-3 py-2">
                <AvailableVersion image={image} />
              </td>
              <td className="px-4 py-2">
                <ImageStatusBadge image={image} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
