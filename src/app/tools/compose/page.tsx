'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Download } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { BrowserOnlyNote, CopyButton, textareaClass } from '@/components/tools/common'
import { convertCompose, DEFAULT_OPTIONS, type ComposeOptions } from '@/lib/tools/composeToKube'

const EXAMPLE = `services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: example
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
  app:
    image: ghcr.io/example/app:1.4.0
    depends_on: [db]
    ports: ["8080:3000"]
    environment:
      - DATABASE_URL=postgres://postgres:example@db:5432/postgres
    deploy:
      replicas: 2
      resources:
        limits: { cpus: "0.5", memory: 256m }
volumes:
  db_data:
`

export default function ComposePage() {
  const [text, setText] = useState('')
  const [options, setOptions] = useState<ComposeOptions>(DEFAULT_OPTIONS)
  const result = useMemo(() => (text.trim() ? convertCompose(text, options) : null), [text, options])
  const set = <K extends keyof ComposeOptions>(key: K, value: ComposeOptions[K]) => setOptions(prev => ({ ...prev, [key]: value }))

  const download = () => {
    if (!result?.yaml) return
    const url = URL.createObjectURL(new Blob([result.yaml], { type: 'application/yaml' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'kubernetes.yaml'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell title="Compose → Kubernetes" subtitle="Convert a docker-compose.yml into Kubernetes manifests">
      <BrowserOnlyNote />

      <div className="card mb-4 grid gap-3 p-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1">
          <span className="text-xs text-slate-400">Namespace (optional)</span>
          <input value={options.namespace} onChange={e => set('namespace', e.target.value)} placeholder="default" className="input h-9" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-slate-400">Service type</span>
          <select value={options.serviceType} onChange={e => set('serviceType', e.target.value as ComposeOptions['serviceType'])} className="input h-9 py-0">
            <option value="ClusterIP">ClusterIP (inside the cluster)</option>
            <option value="NodePort">NodePort</option>
            <option value="LoadBalancer">LoadBalancer</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-xs text-slate-400">Volume size</span>
          <input value={options.storageSize} onChange={e => set('storageSize', e.target.value)} placeholder="1Gi" className="input h-9" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-slate-400">Storage class (optional)</span>
          <input value={options.storageClass} onChange={e => set('storageClass', e.target.value)} placeholder="cluster default" className="input h-9" />
        </label>
        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="checkbox"
            className="h-4 w-4 accent-orange-600"
            checked={options.createNamespace}
            disabled={!options.namespace.trim()}
            onChange={e => set('createNamespace', e.target.checked)}
          />
          Create the namespace
        </label>
        <label className="flex items-center gap-2 text-slate-300 sm:col-span-1 xl:col-span-3" title="allowPrivilegeEscalation: false, drop ALL capabilities, runAsNonRoot, seccomp RuntimeDefault">
          <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={options.restrictedSecurity} onChange={e => set('restrictedSecurity', e.target.checked)} />
          Restricted security defaults (Pod Security &quot;restricted&quot;; the image must run as non-root)
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-white">docker-compose.yml</span>
            <button className="btn-ghost ml-auto px-2 py-1 text-xs" onClick={() => setText(EXAMPLE)}>
              Load example
            </button>
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Paste a docker-compose.yml"
            spellCheck={false}
            className={textareaClass('min-h-[32rem]')}
          />
        </div>

        <div className="space-y-3">
          {!result ? (
            <p className="pt-10 text-center text-sm text-slate-500">Paste a Compose file on the left, or load the example.</p>
          ) : result.error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{result.error}</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {result.objects.map((o, i) => (
                  <span key={i} className="badge badge-muted">
                    {o.kind}/{o.name}
                  </span>
                ))}
              </div>

              {result.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  <div className="mb-1.5 flex items-center gap-2 font-medium">
                    <AlertTriangle className="h-4 w-4" /> Check before applying ({result.warnings.length})
                  </div>
                  <ul className="space-y-1 text-xs text-amber-100/90">
                    {result.warnings.map((w, i) => (
                      <li key={i}>
                        {w.service && <span className="font-mono text-amber-200">{w.service}: </span>}
                        {w.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="card p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium text-white">Kubernetes manifests</span>
                  <div className="ml-auto flex gap-2">
                    <CopyButton text={result.yaml} />
                    <button className="btn-primary px-2.5 py-1 text-xs" onClick={download}>
                      <Download className="h-3.5 w-3.5" /> Download
                    </button>
                  </div>
                </div>
                <pre className="max-h-[36rem] overflow-auto rounded-md bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-300">{result.yaml}</pre>
                <p className="mt-2 text-xs text-slate-500">
                  Check with <code className="text-slate-300">kubectl apply --dry-run=server -f kubernetes.yaml</code> before applying.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  )
}
