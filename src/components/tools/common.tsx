'use client'

import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

// Small building blocks shared by the tool pages.

export function ExpiryBadge({ days }: { days: number | null | undefined }) {
  if (days === null || days === undefined) return <span className="badge badge-muted">unknown</span>
  if (days < 0) return <span className="badge badge-err">expired {-days} d ago</span>
  if (days < 30) return <span className="badge badge-err">{days} d left</span>
  if (days < 90) return <span className="badge badge-warn">{days} d left</span>
  return <span className="badge badge-ok">{days} d left</span>
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={cn('btn-secondary px-2.5 py-1 text-xs', className)}
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // clipboard not available (e.g. plain http); nothing to do
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div className="mb-5 flex gap-1 border-b border-slate-800">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
            value === tab.id ? 'border-orange-500 text-white' : 'border-transparent text-slate-400 hover:text-white'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function BrowserOnlyNote({ children }: { children?: ReactNode }) {
  return (
    <p className="mb-4 text-xs text-slate-500">
      {children ?? 'Runs entirely in your browser: nothing you paste here is sent to the server.'}
    </p>
  )
}

export function textareaClass(extra?: string) {
  return cn('input min-h-[14rem] resize-y font-mono text-xs leading-5', extra)
}

export interface CertificateInfo {
  subject: string
  commonName: string | null
  issuer: string
  subjectAltNames: string[]
  notBefore: string
  notAfter: string
  daysUntilExpiry: number
  expired: boolean
  selfSigned: boolean
  isCA: boolean
  serialNumber: string
  fingerprint256: string
  keyType: string | null
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function CertificateCard({ cert, title, warnings = [] }: { cert: CertificateInfo; title?: string; warnings?: string[] }) {
  const rows: [string, ReactNode][] = [
    ['Subject', cert.subject || '—'],
    ['Issuer', cert.issuer || '—'],
    ['Valid', `${formatDate(cert.notBefore)} → ${formatDate(cert.notAfter)}`],
    ['Names', cert.subjectAltNames.length ? cert.subjectAltNames.join(', ') : '—'],
    ['Key', cert.keyType ?? '—'],
    ['Serial', <span key="s" className="font-mono">{cert.serialNumber}</span>],
    ['SHA-256', <span key="f" className="break-all font-mono">{cert.fingerprint256}</span>],
  ]
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {title && <span className="text-[11px] uppercase tracking-wider text-slate-500">{title}</span>}
        <span className="font-medium text-white">{cert.commonName ?? cert.subject}</span>
        <ExpiryBadge days={cert.daysUntilExpiry} />
        {cert.isCA && <span className="badge badge-info">CA</span>}
        {cert.selfSigned && <span className="badge badge-muted">self-signed</span>}
      </div>
      {warnings.length > 0 && (
        <ul className="mb-3 space-y-1">
          {warnings.map(w => (
            <li key={w} className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
              {w}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className="break-words text-slate-300">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
