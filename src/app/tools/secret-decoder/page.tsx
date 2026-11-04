'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { parse } from 'yaml'
import AppShell from '@/components/layout/AppShell'
import { BrowserOnlyNote, CopyButton, Tabs, textareaClass } from '@/components/tools/common'

// Decodes Kubernetes Secrets and base64 in the browser. Nothing is sent anywhere.

interface DecodedValue {
  key: string
  source: 'data' | 'stringData' | 'value'
  text: string | null // null when the value isn't valid UTF-8 text
  base64: string
  bytes: number
  error?: string
}

interface DecodedSecret {
  name: string
  namespace: string | null
  type: string | null
  values: DecodedValue[]
}

function decodeBase64(value: string): { text: string | null; bytes: number; error?: string } {
  try {
    const binary = atob(value.replace(/\s+/g, ''))
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), bytes: bytes.length }
    } catch {
      return { text: null, bytes: bytes.length }
    }
  } catch {
    return { text: null, bytes: 0, error: 'Not valid base64' }
  }
}

function encodeBase64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach(b => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

function toSecret(obj: any): DecodedSecret {
  const values: DecodedValue[] = []
  for (const [key, raw] of Object.entries(obj.data ?? {})) {
    const value = String(raw ?? '')
    values.push({ key, source: 'data', base64: value, ...decodeBase64(value) })
  }
  for (const [key, raw] of Object.entries(obj.stringData ?? {})) {
    const text = String(raw ?? '')
    values.push({ key, source: 'stringData', text, base64: encodeBase64(text), bytes: new TextEncoder().encode(text).length })
  }
  return { name: obj.metadata?.name ?? '(no name)', namespace: obj.metadata?.namespace ?? null, type: obj.type ?? null, values }
}

// A Secret (YAML/JSON), a List of Secrets, or a bare base64 string
function decodeInput(input: string): { secrets: DecodedSecret[]; error: string | null } {
  const text = input.trim()
  if (!text) return { secrets: [], error: null }
  let parsed: any = undefined
  try {
    parsed = parse(text)
  } catch {
    // not YAML/JSON; try plain base64 below
  }
  const items: any[] = Array.isArray(parsed?.items) ? parsed.items : parsed && typeof parsed === 'object' ? [parsed] : []
  const secrets = items.filter(i => i && typeof i === 'object' && (i.data || i.stringData)).map(toSecret)
  if (secrets.length > 0) return { secrets, error: null }
  if (items.length > 0) return { secrets: [], error: 'No "data" or "stringData" found. Paste a Secret, e.g. from kubectl get secret <name> -o yaml.' }

  const decoded = decodeBase64(text)
  if (decoded.error) return { secrets: [], error: 'Not a Secret and not valid base64.' }
  return { secrets: [{ name: 'base64 value', namespace: null, type: null, values: [{ key: 'value', source: 'value', base64: text, ...decoded }] }], error: null }
}

function ValueRow({ value, revealed }: { value: DecodedValue; revealed: boolean }) {
  const [show, setShow] = useState(false)
  const visible = revealed || show
  const isPem = value.text?.includes('-----BEGIN ')
  const content = value.text ?? value.base64
  return (
    <div className="border-t border-slate-800 px-4 py-3 first:border-t-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-white">{value.key}</span>
        {value.source === 'stringData' && <span className="badge badge-muted">stringData</span>}
        <span className="text-xs text-slate-500">{value.bytes} bytes</span>
        {value.text === null && !value.error && <span className="badge badge-muted">binary (shown as base64)</span>}
        {value.error && <span className="badge badge-err">{value.error}</span>}
        <div className="ml-auto flex gap-1.5">
          {!revealed && (
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setShow(s => !s)}>
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {show ? 'Hide' : 'Show'}
            </button>
          )}
          <CopyButton text={content} />
        </div>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-950 p-2.5 font-mono text-xs text-slate-300">
        {visible ? content : '•'.repeat(Math.min(Math.max(content.length, 8), 40))}
      </pre>
      {isPem && visible && (
        <p className="mt-1.5 text-xs text-slate-500">
          Contains a PEM block. Inspect a certificate with the{' '}
          <Link href="/tools/certificates" className="text-orange-300 hover:underline">
            certificate checker
          </Link>
          .
        </p>
      )}
    </div>
  )
}

function DecodeTab() {
  const [input, setInput] = useState('')
  const [revealAll, setRevealAll] = useState(false)
  const { secrets, error } = useMemo(() => decodeInput(input), [input])

  return (
    <>
      <BrowserOnlyNote />
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={'Paste the output of: kubectl get secret <name> -n <namespace> -o yaml\n…or a single base64 value'}
        spellCheck={false}
        className={textareaClass('mb-4')}
      />
      {error && <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{error}</div>}
      {secrets.length > 0 && (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={revealAll} onChange={e => setRevealAll(e.target.checked)} />
            Show all values
          </label>
          {secrets.map((secret, i) => (
            <div key={i} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2.5">
                <span className="font-medium text-white">{secret.name}</span>
                {secret.namespace && <span className="text-xs text-slate-500">{secret.namespace}</span>}
                {secret.type && <span className="badge badge-muted">{secret.type}</span>}
                <span className="ml-auto text-xs text-slate-500">{secret.values.length} keys</span>
              </div>
              {secret.values.map(value => (
                <ValueRow key={`${value.source}-${value.key}`} value={value} revealed={revealAll} />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function EncodeTab() {
  const [input, setInput] = useState('')
  const encoded = input ? encodeBase64(input) : ''
  return (
    <>
      <BrowserOnlyNote />
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Text to encode as base64 (e.g. for the data field of a Secret)"
        spellCheck={false}
        className={textareaClass('mb-4 min-h-[8rem]')}
      />
      {encoded && (
        <div className="card p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm text-white">base64</span>
            <span className="text-xs text-slate-500">{new TextEncoder().encode(input).length} bytes in</span>
            <CopyButton text={encoded} className="ml-auto" />
          </div>
          <pre className="whitespace-pre-wrap break-all rounded-md bg-slate-950 p-2.5 font-mono text-xs text-slate-300">{encoded}</pre>
          {/\n$/.test(input) && <p className="mt-2 text-xs text-amber-300">Note: the text ends with a newline, which is encoded too.</p>}
        </div>
      )}
    </>
  )
}

export default function SecretDecoderPage() {
  const [tab, setTab] = useState<'decode' | 'encode'>('decode')
  return (
    <AppShell title="Secret decoder" subtitle="Decode Kubernetes Secrets and base64, or encode text">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'decode', label: 'Decode' },
          { id: 'encode', label: 'Encode' },
        ]}
      />
      {tab === 'decode' ? <DecodeTab /> : <EncodeTab />}
    </AppShell>
  )
}
