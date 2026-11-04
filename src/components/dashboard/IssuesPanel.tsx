'use client'

import { useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { CheckCircle2, ExternalLink, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusBadge } from './ClusterCard'
import { credentialSeverity, issueCounts, type ClusterHealth } from './types'

type Tone = 'err' | 'warn'

function Section({ title, tone, count, children }: { title: string; tone: Tone; count: number; children: ReactNode }) {
  if (count === 0) return null
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-200">
        <span className={cn('status-dot', tone === 'err' ? 'status-dot-err' : 'status-dot-warn')} />
        {title}
        <span className="text-slate-500">{count}</span>
      </h3>
      <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/40">{children}</div>
    </section>
  )
}

function Row({ title, meta, aside, children }: { title: ReactNode; meta?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-3.5 py-2.5 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-100 [overflow-wrap:anywhere]">{title}</p>
          {meta && <p className="mt-0.5 text-slate-500">{meta}</p>}
        </div>
        {aside && <div className="flex flex-shrink-0 flex-col items-end gap-1">{aside}</div>}
      </div>
      {children}
    </div>
  )
}

function UsageBar({ label, percent }: { label: string; percent?: number }) {
  if (percent === undefined) return null
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="w-12 text-slate-500">{label}</span>
      <div className="meter flex-1">
        <span className="bg-amber-500" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <span className="w-12 text-right tabular-nums text-amber-300">{percent.toFixed(1)}%</span>
    </div>
  )
}

export default function IssuesPanel({ cluster, onClose }: { cluster: ClusterHealth; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { critical, warning } = issueCounts(cluster)
  const len = (list?: unknown[]) => list?.length || 0

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-slate-950/70" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">{cluster.name}</h2>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
              <StatusBadge status={cluster.status} />
              {critical > 0 && <span className="badge badge-err">{critical} critical</span>}
              {warning > 0 && <span className="badge badge-warn">{warning} warning</span>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Link href={`/cluster/${cluster.id}`} className="btn-ghost px-2" title="Open cluster">
              <ExternalLink className="h-4 w-4" />
            </Link>
            <button onClick={onClose} className="btn-ghost px-2" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {credentialSeverity(cluster) && (
            <Section title="Kubeconfig credentials" tone={credentialSeverity(cluster) === 'critical' ? 'err' : 'warn'} count={1}>
              <Row
                title={(cluster.credentialExpiresInDays ?? 0) < 0 ? 'The client certificate has expired' : `The client certificate expires in ${cluster.credentialExpiresInDays} days`}
                meta="Once expired, this cluster can no longer be reached. Replace the kubeconfig in Settings."
                aside={<Link href="/tools/kubeconfigs" className="text-orange-300 hover:underline">Kubeconfigs</Link>}
              />
            </Section>
          )}

          <Section title="Backups (Velero)" tone={cluster.velero?.warnings.some(w => w.severity === 'critical') ? 'err' : 'warn'} count={cluster.velero?.warnings.length ?? 0}>
            {cluster.velero?.warnings.map((w, i) => (
              <Row key={i} title={w.message} aside={<span className={cn('badge', w.severity === 'critical' ? 'badge-err' : 'badge-warn')}>{w.severity}</span>} />
            ))}
          </Section>

          <Section title="Pod errors" tone="err" count={len(cluster.podErrors)}>
            {cluster.podErrors?.map((pod, i) => (
              <Row
                key={i}
                title={pod.name}
                meta={`${pod.namespace}${pod.reason ? ` · ${pod.reason}` : ''}`}
                aside={<span className="badge badge-err">{pod.phase}</span>}
              />
            ))}
          </Section>

          <Section title="Certificates expiring (≤ 10 days)" tone="err" count={len(cluster.certificateErrors)}>
            {cluster.certificateErrors?.map((cert, i) => (
              <Row
                key={i}
                title={cert.name}
                meta={`${cert.namespace} · expires ${new Date(cert.expiresAt).toLocaleDateString()}`}
                aside={<span className="badge badge-err">{cert.daysUntilExpiry} days</span>}
              />
            ))}
          </Section>

          <Section title="Cordoned nodes, not ready" tone="err" count={len(cluster.cordonedNodeErrors)}>
            {cluster.cordonedNodeErrors?.map((node, i) => (
              <Row
                key={i}
                title={node.name}
                meta={`${node.reason} · since ${new Date(node.cordonedSince).toLocaleString()}`}
                aside={<span className="badge badge-err">Not ready</span>}
              />
            ))}
          </Section>

          <Section title="Recent error events" tone="err" count={len(cluster.recentEventErrors)}>
            {cluster.recentEventErrors?.map((event, i) => (
              <Row
                key={i}
                title={`${event.involvedObject.kind}/${event.involvedObject.name}`}
                meta={[event.involvedObject.namespace, event.reason].filter(Boolean).join(' · ')}
                aside={
                  <>
                    <span className="badge badge-err">{event.type}</span>
                    <span className="text-slate-500">×{event.count}</span>
                  </>
                }
              >
                <p className="mt-1.5 text-slate-300">{event.message}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  first {new Date(event.firstTime).toLocaleString()} · last {new Date(event.lastTime).toLocaleString()}
                </p>
              </Row>
            ))}
          </Section>

          <Section title="Resource pressure" tone="warn" count={len(cluster.podResourceWarnings)}>
            {cluster.podResourceWarnings?.map((pod, i) => (
              <Row
                key={i}
                title={pod.name}
                meta={pod.namespace}
                aside={
                  <span className="font-mono text-[11px] text-slate-500">
                    {pod.cpuUsage && pod.cpuCapacity && `cpu ${pod.cpuUsage}/${pod.cpuCapacity}`}
                    {pod.memoryUsage && pod.memoryCapacity && ` mem ${pod.memoryUsage}/${pod.memoryCapacity}`}
                  </span>
                }
              >
                <UsageBar label="CPU" percent={pod.cpuPercent} />
                <UsageBar label="Memory" percent={pod.memoryPercent} />
              </Row>
            ))}
          </Section>

          <Section title="Certificates expiring (11–30 days)" tone="warn" count={len(cluster.certificateWarnings)}>
            {cluster.certificateWarnings?.map((cert, i) => (
              <Row
                key={i}
                title={cert.name}
                meta={`${cert.namespace} · expires ${new Date(cert.expiresAt).toLocaleDateString()}`}
                aside={<span className="badge badge-warn">{cert.daysUntilExpiry} days</span>}
              />
            ))}
          </Section>

          <Section title="Cordoned nodes" tone="warn" count={len(cluster.cordonedNodeWarnings)}>
            {cluster.cordonedNodeWarnings?.map((node, i) => (
              <Row
                key={i}
                title={node.name}
                meta={`${node.reason} · since ${new Date(node.cordonedSince).toLocaleString()}`}
                aside={<span className={cn('badge', node.isReady ? 'badge-ok' : 'badge-err')}>{node.isReady ? 'Ready' : 'Not ready'}</span>}
              />
            ))}
          </Section>

          {critical + warning === 0 && (
            <div className="py-16 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
              <p className="mt-3 text-sm text-slate-300">No issues found</p>
              <p className="mt-1 text-xs text-slate-500">This cluster appears to be running smoothly.</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
