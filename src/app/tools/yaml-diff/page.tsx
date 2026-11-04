'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { BrowserOnlyNote, textareaClass } from '@/components/tools/common'
import { diffLines, diffYaml, type DiffChange } from '@/lib/tools/yamlDiff'
import { cn } from '@/lib/utils'

// Semantic YAML diff in the browser.

function show(value: unknown) {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

const changeStyle: Record<DiffChange['type'], string> = {
  added: 'text-emerald-300',
  removed: 'text-rose-300',
  changed: 'text-amber-200',
}

function ChangeRow({ change }: { change: DiffChange }) {
  return (
    <tr className="align-top">
      <td className="py-1 pr-4">
        <span className={cn('badge', change.type === 'added' ? 'badge-ok' : change.type === 'removed' ? 'badge-err' : 'badge-warn')}>{change.type}</span>
      </td>
      <td className={cn('break-all py-1 pr-4 font-mono', changeStyle[change.type])}>{change.path}</td>
      <td className="break-all py-1 pr-4 font-mono text-slate-400">{show(change.before)}</td>
      <td className="break-all py-1 font-mono text-slate-200">{show(change.after)}</td>
    </tr>
  )
}

export default function YamlDiffPage() {
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [ignoreNoise, setIgnoreNoise] = useState(true)
  const [sideBySide, setSideBySide] = useState(false)

  const result = useMemo(
    () => (left.trim() && right.trim() ? diffYaml(left, right, { ignoreClusterNoise: ignoreNoise }) : null),
    [left, right, ignoreNoise]
  )
  const rows = useMemo(
    () => (result && sideBySide ? diffLines(result.normalizedLeft, result.normalizedRight) : null),
    [result, sideBySide]
  )
  const changed = result?.documents.filter(d => d.status !== 'same') ?? []

  return (
    <AppShell title="YAML diff" subtitle="Compare manifests or Helm values, ignoring key order and formatting">
      <BrowserOnlyNote />
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-slate-300">
        <label className="flex items-center gap-2" title="status, managedFields, resourceVersion, uid, generation, creationTimestamp, last-applied-configuration">
          <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={ignoreNoise} onChange={e => setIgnoreNoise(e.target.checked)} />
          Ignore fields set by the cluster
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={sideBySide} onChange={e => setSideBySide(e.target.checked)} />
          Show side by side
        </label>
      </div>
      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <textarea value={left} onChange={e => setLeft(e.target.value)} placeholder="Left (e.g. before, or cluster A)" spellCheck={false} className={textareaClass()} />
        <textarea value={right} onChange={e => setRight(e.target.value)} placeholder="Right (e.g. after, or cluster B)" spellCheck={false} className={textareaClass()} />
      </div>

      {result && (
        <div className="space-y-4">
          {result.errors.map((e, i) => (
            <div key={i} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {e.side === 'left' ? 'Left' : 'Right'}: {e.message}
            </div>
          ))}

          {result.errors.length === 0 && changed.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              <CheckCircle2 className="h-4 w-4" /> No differences
              {ignoreNoise && <span className="text-emerald-300/70">(ignoring fields set by the cluster)</span>}
            </div>
          )}

          {result.documents.map(doc => (
            <div key={doc.key} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2.5">
                <span className="font-medium text-white">{doc.label}</span>
                {doc.status === 'same' && <span className="badge badge-ok">identical</span>}
                {doc.status === 'changed' && <span className="badge badge-warn">{doc.changes.length} change{doc.changes.length === 1 ? '' : 's'}</span>}
                {doc.status === 'onlyLeft' && <span className="badge badge-err">only left</span>}
                {doc.status === 'onlyRight' && <span className="badge badge-ok">only right</span>}
              </div>
              {doc.changes.length > 0 && (
                <div className="overflow-x-auto px-4 py-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-slate-600">
                        <th className="w-20 py-1 pr-4 font-medium">Change</th>
                        <th className="py-1 pr-4 font-medium">Path</th>
                        <th className="py-1 pr-4 font-medium">Left</th>
                        <th className="py-1 font-medium">Right</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doc.changes.map((change, i) => (
                        <ChangeRow key={i} change={change} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {sideBySide && result.errors.length === 0 && (
            <div className="card overflow-x-auto">
              {rows === null ? (
                <p className="p-4 text-sm text-slate-400">Too large for the side-by-side view; the list of changes above is complete.</p>
              ) : (
                <table className="w-full font-mono text-xs leading-5">
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i}>
                        <td className={cn('w-1/2 whitespace-pre px-3', row.type === 'removed' ? 'bg-rose-500/15 text-rose-200' : 'text-slate-400')}>
                          {row.left ?? ''}
                        </td>
                        <td
                          className={cn(
                            'w-1/2 whitespace-pre border-l border-slate-800 px-3',
                            row.type === 'added' ? 'bg-emerald-500/15 text-emerald-200' : 'text-slate-400'
                          )}
                        >
                          {row.right ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </AppShell>
  )
}
