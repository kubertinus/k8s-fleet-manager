'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { parseAllDocuments } from 'yaml'
import AppShell from '@/components/layout/AppShell'
import { BrowserOnlyNote, CopyButton, textareaClass } from '@/components/tools/common'
import { cn } from '@/lib/utils'

// YAML validator and formatter, in the browser. Comments are kept when formatting.

interface Problem {
  severity: 'error' | 'warning'
  message: string
  line: number | null
  col: number | null
}

function analyse(text: string, kubernetes: boolean, indentSeq: boolean) {
  const problems: Problem[] = []
  const lines = text.split('\n')

  // Tabs are not allowed for indentation; point at every such line, not just the first
  lines.forEach((line, i) => {
    const indent = line.match(/^[ \t]*/)?.[0] ?? ''
    if (indent.includes('\t')) problems.push({ severity: 'error', message: 'Tab used for indentation (use spaces)', line: i + 1, col: indent.indexOf('\t') + 1 })
  })

  const docs = parseAllDocuments(text)
  for (const doc of docs) {
    for (const issue of [...doc.errors, ...doc.warnings]) {
      const pos = issue.linePos?.[0]
      const message = issue.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '').replace(/:$/, '')
      // The tab check above already reports these
      if (/tab/i.test(message) && problems.some(p => p.line === pos?.line)) continue
      problems.push({ severity: doc.errors.includes(issue as any) ? 'error' : 'warning', message, line: pos?.line ?? null, col: pos?.col ?? null })
    }
  }

  const hasErrors = problems.some(p => p.severity === 'error')
  if (kubernetes && !hasErrors) {
    docs.forEach((doc, i) => {
      const obj: any = doc.toJS()
      if (obj === null || obj === undefined) return
      const missing = ['apiVersion', 'kind'].filter(k => !obj?.[k])
      if (!obj?.metadata?.name && !obj?.metadata?.generateName) missing.push('metadata.name')
      if (missing.length > 0) {
        const line = doc.range ? text.slice(0, doc.range[0]).split('\n').length : null
        problems.push({ severity: 'warning', message: `Document ${i + 1}: missing ${missing.join(', ')}`, line, col: null })
      }
    })
  }

  const formatted = hasErrors
    ? ''
    : docs
        .map(doc => doc.toString({ indent: 2, indentSeq, lineWidth: 0 }))
        .join('---\n')
  problems.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity))
  return { problems, formatted, documents: docs.filter(d => d.contents !== null).length, lines }
}

function Excerpt({ lines, line, col }: { lines: string[]; line: number; col: number | null }) {
  const from = Math.max(1, line - 2)
  const to = Math.min(lines.length, line + 1)
  return (
    <pre className="mt-1.5 overflow-x-auto rounded-md bg-slate-950 p-2 font-mono text-xs leading-5">
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map(n => (
        <div key={n} className={cn(n === line ? 'bg-rose-500/15 text-rose-100' : 'text-slate-400')}>
          <span className="mr-3 inline-block w-8 select-none text-right text-slate-600">{n}</span>
          {lines[n - 1].replace(/\t/g, '→   ') || ' '}
          {n === line && col !== null && (
            <div>
              <span className="mr-3 inline-block w-8" />
              {/* Tabs are shown 4 wide, so measure the caret on the displayed text */}
              <span className="text-rose-400">{' '.repeat(lines[n - 1].slice(0, Math.max(0, col - 1)).replace(/\t/g, '→   ').length)}^</span>
            </div>
          )}
        </div>
      ))}
    </pre>
  )
}

export default function YamlPage() {
  const [text, setText] = useState('')
  const [kubernetes, setKubernetes] = useState(true)
  const [indentSeq, setIndentSeq] = useState(true)
  const result = useMemo(() => (text.trim() ? analyse(text, kubernetes, indentSeq) : null), [text, kubernetes, indentSeq])
  const errors = result?.problems.filter(p => p.severity === 'error') ?? []

  return (
    <AppShell title="YAML" subtitle="Validate indentation and syntax, and format YAML">
      <BrowserOnlyNote />
      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-4 text-sm text-slate-300">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={kubernetes} onChange={e => setKubernetes(e.target.checked)} />
              Kubernetes check (apiVersion, kind, name)
            </label>
            <label className="flex items-center gap-2" title="Indent list items under their key (off = kubectl style)">
              <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={indentSeq} onChange={e => setIndentSeq(e.target.checked)} />
              Indent lists
            </label>
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'Paste YAML here, one or more documents separated by ---'}
            spellCheck={false}
            className={textareaClass('min-h-[28rem]')}
          />
        </div>

        <div className="space-y-3">
          {!result ? (
            <p className="pt-8 text-center text-sm text-slate-500">Paste YAML on the left to check it.</p>
          ) : (
            <>
              {result.problems.length === 0 ? (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" /> Valid YAML · {result.documents} document{result.documents === 1 ? '' : 's'}
                </div>
              ) : (
                <div className="space-y-2">
                  {result.problems.map((p, i) => (
                    <div
                      key={i}
                      className={cn(
                        'rounded-lg border px-3 py-2 text-sm',
                        p.severity === 'error' ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                      )}
                    >
                      {p.line !== null && (
                        <span className="mr-2 font-mono text-xs opacity-80">
                          line {p.line}
                          {p.col !== null && `:${p.col}`}
                        </span>
                      )}
                      {p.message}
                      {p.line !== null && p.line <= result.lines.length && <Excerpt lines={result.lines} line={p.line} col={p.col} />}
                    </div>
                  ))}
                </div>
              )}

              {errors.length === 0 && (
                <div className="card p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-medium text-white">Formatted</span>
                    <span className="text-xs text-slate-500">2-space indentation, comments kept</span>
                    <div className="ml-auto flex gap-2">
                      <button className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setText(result.formatted)} disabled={result.formatted === text}>
                        Use
                      </button>
                      <CopyButton text={result.formatted} />
                    </div>
                  </div>
                  <pre className="max-h-[24rem] overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-300">{result.formatted}</pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  )
}
