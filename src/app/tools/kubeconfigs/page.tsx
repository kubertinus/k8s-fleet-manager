'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { BrowserOnlyNote, CopyButton, ExpiryBadge, Tabs, formatDate, textareaClass, type CertificateInfo } from '@/components/tools/common'
import { mergeKubeconfigs, type KubeconfigInput } from '@/lib/tools/kubeconfigMerge'

interface KubeconfigSummary {
  id: number
  name: string
  endpoint: string | null
  context: string | null
  user: string | null
  authType: string
  clientCertificate: CertificateInfo | null
  certificateAuthority: CertificateInfo | null
  error: string | null
}

const authLabel: Record<string, string> = {
  'client-certificate': 'Client certificate',
  token: 'Token',
  exec: 'Exec plugin',
  'auth-provider': 'Auth provider',
  basic: 'Username/password',
  unknown: 'Unknown',
}

function ExpiryTab() {
  const [clusters, setClusters] = useState<KubeconfigSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/tools/kubeconfigs', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        setClusters(data.clusters)
      })
      .catch(err => setError(err.message))
  }, [])

  // Soonest expiry first; clusters without a certificate last
  const sorted = useMemo(
    () =>
      [...(clusters ?? [])].sort(
        (a, b) => (a.clientCertificate?.daysUntilExpiry ?? Infinity) - (b.clientCertificate?.daysUntilExpiry ?? Infinity)
      ),
    [clusters]
  )

  if (error) return <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
  if (!clusters)
    return (
      <div className="flex items-center justify-center py-16 text-sm text-slate-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading kubeconfigs…
      </div>
    )

  return (
    <>
      <p className="mb-4 text-sm text-slate-400">
        Credentials of the kubeconfigs stored in K8s Fleet Manager. Talos issues admin client certificates for one year: once expired, the
        cluster becomes unreachable for K8s Fleet Manager. Only these details are shown; keys and tokens stay on the server.
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2.5 font-medium">Cluster</th>
              <th className="px-3 py-2.5 font-medium">Endpoint</th>
              <th className="px-3 py-2.5 font-medium">Authentication</th>
              <th className="px-3 py-2.5 font-medium">Client certificate</th>
              <th className="px-4 py-2.5 font-medium">Cluster CA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {sorted.map(c => (
              <tr key={c.id}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-white">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.context ?? '—'}</div>
                </td>
                <td className="px-3 py-2.5 font-mono text-xs text-slate-300">{c.endpoint ?? '—'}</td>
                <td className="px-3 py-2.5 text-slate-300">
                  {authLabel[c.authType] ?? c.authType}
                  {c.user && <div className="text-xs text-slate-500">{c.user}</div>}
                </td>
                <td className="px-3 py-2.5">
                  {c.error ? (
                    <span className="text-xs text-rose-300">{c.error}</span>
                  ) : c.clientCertificate ? (
                    <>
                      <ExpiryBadge days={c.clientCertificate.daysUntilExpiry} />
                      <div className="mt-0.5 text-xs text-slate-500">until {formatDate(c.clientCertificate.notAfter)}</div>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">no certificate (no expiry known)</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {c.certificateAuthority ? (
                    <>
                      <ExpiryBadge days={c.certificateAuthority.daysUntilExpiry} />
                      <div className="mt-0.5 text-xs text-slate-500">until {formatDate(c.certificateAuthority.notAfter)}</div>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

let inputId = 0
const newInput = (label = ''): KubeconfigInput & { id: number } => ({ id: ++inputId, label, text: '' })

function MergeTab() {
  const [inputs, setInputs] = useState(() => [newInput('kubeconfig 1'), newInput('kubeconfig 2')])
  const [contextNames, setContextNames] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const result = useMemo(() => mergeKubeconfigs(inputs, contextNames), [inputs, contextNames])
  const filled = inputs.filter(i => i.text.trim()).length
  const duplicateNames = new Set(
    result.contexts.map(c => c.name).filter((name, i, all) => all.indexOf(name) !== i)
  )

  const update = (id: number, patch: Partial<KubeconfigInput>) => setInputs(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)))

  const addFiles = async (files: FileList | null) => {
    if (!files) return
    const read = await Promise.all(
      Array.from(files).map(file => file.text().then(text => ({ ...newInput(file.name), text })))
    )
    // Replace empty boxes first, then append
    setInputs(prev => {
      const kept = prev.filter(i => i.text.trim())
      return [...kept, ...read]
    })
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([result.yaml], { type: 'application/yaml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'kubeconfig'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <BrowserOnlyNote>
        Combine kubeconfigs into one file to manage several clusters with kubectl. Runs entirely in your browser: the files (which contain
        keys) are not sent to the server.
      </BrowserOnlyNote>

      <div className="mb-3 flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" /> Choose files
        </button>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
        <button className="btn-ghost" onClick={() => setInputs(prev => [...prev, newInput(`kubeconfig ${prev.length + 1}`)])}>
          <Plus className="h-4 w-4" /> Add box
        </button>
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        {inputs.map(input => {
          const error = result.errors.find(e => e.label === input.label)
          return (
            <div key={input.id} className="card p-3">
              <div className="mb-2 flex items-center gap-2">
                <input
                  value={input.label}
                  onChange={e => update(input.id, { label: e.target.value })}
                  className="input h-8 flex-1 py-0 text-xs"
                  aria-label="Name of this kubeconfig"
                />
                {inputs.length > 1 && (
                  <button className="btn-ghost px-2 py-1" title="Remove" onClick={() => setInputs(prev => prev.filter(i => i.id !== input.id))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <textarea
                value={input.text}
                onChange={e => update(input.id, { text: e.target.value })}
                placeholder="Paste a kubeconfig (apiVersion: v1, kind: Config, …)"
                spellCheck={false}
                className={textareaClass('min-h-[10rem]')}
              />
              {error && <p className="mt-2 text-xs text-rose-300">{error.message}</p>}
            </div>
          )
        })}
      </div>

      {result.contexts.length > 0 && (
        <div className="space-y-4">
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Context name (editable)</th>
                  <th className="px-3 py-2.5 font-medium">From</th>
                  <th className="px-3 py-2.5 font-medium">Cluster / user</th>
                  <th className="px-4 py-2.5 font-medium">Server</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {result.contexts.map(ctx => {
                  const generated = ctx.mergedName
                  return (
                    <tr key={generated}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            value={contextNames[generated] ?? ctx.name}
                            onChange={e => setContextNames(prev => ({ ...prev, [generated]: e.target.value }))}
                            className="input h-8 max-w-[16rem] py-0 font-mono text-xs"
                          />
                          {ctx.current && <span className="badge badge-info">current</span>}
                          {ctx.renamed && <span className="badge badge-warn" title={`Was "${ctx.originalName}"`}>renamed</span>}
                          {duplicateNames.has(ctx.name) && <span className="badge badge-err">duplicate</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">{ctx.source}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">
                        {ctx.cluster} / {ctx.user}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-400">{ctx.server ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {result.renames.length > 0 && (
            <p className="text-xs text-slate-400">
              Renamed to avoid clashes:{' '}
              {result.renames.map(r => `${r.kind} "${r.from}" → "${r.to}" (${r.source})`).join(' · ')}
            </p>
          )}

          <div className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-white">Merged kubeconfig</span>
              <span className="text-xs text-slate-500">
                {result.contexts.length} contexts from {filled} files
              </span>
              <div className="ml-auto flex gap-2">
                <CopyButton text={result.yaml} />
                <button className="btn-primary px-2.5 py-1 text-xs" onClick={download} disabled={duplicateNames.size > 0}>
                  <Download className="h-3.5 w-3.5" /> Download
                </button>
              </div>
            </div>
            <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">{result.yaml}</pre>
            <p className="mt-2 text-xs text-slate-500">
              Use it with <code className="text-slate-300">KUBECONFIG=~/Downloads/kubeconfig kubectl config get-contexts</code>, then{' '}
              <code className="text-slate-300">kubectl config use-context &lt;name&gt;</code>.
            </p>
          </div>
        </div>
      )}
    </>
  )
}

export default function KubeconfigsPage() {
  const [tab, setTab] = useState<'expiry' | 'merge'>('expiry')
  return (
    <AppShell title="Kubeconfigs" subtitle="Credential expiry of the stored clusters, and merging kubeconfig files">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'expiry', label: 'Expiry' },
          { id: 'merge', label: 'Merge' },
        ]}
      />
      {tab === 'expiry' ? <ExpiryTab /> : <MergeTab />}
    </AppShell>
  )
}
