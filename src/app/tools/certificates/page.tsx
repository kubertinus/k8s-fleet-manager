'use client'

import { useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import AppShell from '@/components/layout/AppShell'
import { CertificateCard, Tabs, textareaClass, type CertificateInfo } from '@/components/tools/common'

interface CheckResult {
  chain: CertificateInfo[]
  host?: string
  port?: number
  trusted?: boolean
  trustError?: string | null
  hostnameMatches?: boolean
  protocol?: string | null
}

// Warnings for one certificate in a chain (index 0 is the server's own certificate)
function warningsFor(cert: CertificateInfo, index: number, result: CheckResult): string[] {
  const warnings: string[] = []
  if (cert.expired) warnings.push('This certificate has expired.')
  else if (cert.daysUntilExpiry < 30) warnings.push(`Expires in ${cert.daysUntilExpiry} days.`)
  if (index === 0 && result.host && result.hostnameMatches === false) {
    warnings.push(`The name ${result.host} is not in this certificate's names (SANs).`)
  }
  if (index === 0 && cert.selfSigned && !cert.isCA) warnings.push('Self-signed: clients only trust it when configured explicitly.')
  return warnings
}

export default function CertificatesPage() {
  const [tab, setTab] = useState<'host' | 'pem'>('host')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('443')
  const [pem, setPem] = useState('')
  const [result, setResult] = useState<CheckResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const check = async (body: object) => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/tools/certificate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setResult(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AppShell title="Certificate checker" subtitle="Inspect the certificate a server presents, or a PEM certificate">
      <Tabs
        value={tab}
        onChange={t => {
          setTab(t)
          setResult(null)
          setError(null)
        }}
        tabs={[
          { id: 'host', label: 'Server' },
          { id: 'pem', label: 'Paste PEM' },
        ]}
      />

      {tab === 'host' ? (
        <form
          className="mb-6 flex flex-col gap-2 sm:flex-row"
          onSubmit={e => {
            e.preventDefault()
            check({ host, port: Number(port) })
          }}
        >
          <input
            value={host}
            onChange={e => setHost(e.target.value)}
            placeholder="nexus.example.local or https://…"
            className="input sm:max-w-md"
            required
          />
          <input value={port} onChange={e => setPort(e.target.value)} placeholder="443" className="input sm:w-24" inputMode="numeric" />
          <button className="btn-primary justify-center" disabled={loading || !host.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Check
          </button>
        </form>
      ) : (
        <div className="mb-6 space-y-2">
          <textarea
            value={pem}
            onChange={e => setPem(e.target.value)}
            placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
            spellCheck={false}
            className={textareaClass()}
          />
          <p className="text-xs text-slate-500">
            Paste one certificate or a whole chain. Only the certificate blocks are sent to the server; a private key in the text stays in
            your browser.
          </p>
          <button
            className="btn-primary"
            disabled={loading || !pem.trim()}
            onClick={() => {
              const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
              if (!certificates) {
                setResult(null)
                setError('No PEM certificate found (-----BEGIN CERTIFICATE-----)')
                return
              }
              check({ pem: certificates.join('\n') })
            }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Inspect
          </button>
        </div>
      )}

      {error && <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      {result && (
        <div className="space-y-3">
          {result.host && (
            <div
              className={
                result.trusted
                  ? 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200'
                  : 'rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200'
              }
            >
              {result.host}:{result.port} · {result.protocol ?? 'TLS'} ·{' '}
              {result.trusted
                ? 'trusted by K8s Fleet Manager'
                : `not trusted by K8s Fleet Manager (${result.trustError ?? 'unknown reason'}); clients without your internal CA will refuse it`}
            </div>
          )}
          {result.chain.map((cert, i) => (
            <CertificateCard
              key={cert.fingerprint256}
              cert={cert}
              title={result.chain.length > 1 ? (i === 0 ? 'Certificate' : `Issuer ${i}`) : undefined}
              warnings={warningsFor(cert, i, result)}
            />
          ))}
        </div>
      )}
    </AppShell>
  )
}
