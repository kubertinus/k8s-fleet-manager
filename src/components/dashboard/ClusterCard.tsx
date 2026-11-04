'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { statusLabel, statusTone } from '@/lib/clusterStatus'
import { credentialSeverity, issueCounts, isUnreachable, type ClusterHealth, type ClusterNode } from './types'

const badgeClass = { ok: 'badge-ok', warn: 'badge-warn', err: 'badge-err', info: 'badge-info', muted: 'badge-muted' }

export function StatusBadge({ status }: { status: string }) {
  return <span className={cn('badge', badgeClass[statusTone(status)])}>{statusLabel(status)}</span>
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-700 border-t-orange-400', className)} />
}

function ageLabel(iso: string) {
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`
  if (hours < 48) return `${Math.round(hours)} h ago`
  return `${Math.round(hours / 24)} d ago`
}

// Last Velero backup and how healthy backups are, for the card and the list
export function backupState(cluster: ClusterHealth): { label: string; tone: 'ok' | 'warn' | 'err' | 'muted'; title?: string } | null {
  const velero = cluster.velero
  if (!velero) return null
  if (!velero.installed) return { label: 'no Velero', tone: 'muted' }
  const worst = velero.warnings.some(w => w.severity === 'critical') ? 'err' : velero.warnings.length ? 'warn' : 'ok'
  const title = velero.warnings.map(w => w.message).join('\n') || undefined
  if (!velero.lastBackup?.startTimestamp) return { label: 'no backups', tone: worst === 'ok' ? 'warn' : worst, title }
  return { label: ageLabel(velero.lastBackup.startTimestamp), tone: worst, title }
}

export function meterColor(percent: number) {
  if (percent >= 90) return 'bg-rose-500'
  if (percent >= 75) return 'bg-amber-500'
  return 'bg-emerald-500'
}

// Node status from the health API: Ready, NotReady, Cordoned or CordonedNotReady.
function isNodeReady(node: ClusterNode) {
  return node.status === 'Ready' || node.status === 'Cordoned'
}

function isNodeCordoned(node: ClusterNode, cordoned: Set<string>) {
  return node.status.startsWith('Cordoned') || cordoned.has(node.name)
}

function nodeTone(node: ClusterNode, cordoned: Set<string>) {
  if (!isNodeReady(node)) return 'bg-rose-500'
  if (isNodeCordoned(node, cordoned)) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function NodeGroup({ label, nodes, cordoned, href }: { label: string; nodes: ClusterNode[]; cordoned: Set<string>; href: string }) {
  if (nodes.length === 0) return null
  const notReady = nodes.filter(n => !isNodeReady(n)).length
  const ready = nodes.length - notReady
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-slate-300">
          {label} <span className="text-slate-500">· {nodes.length}</span>
        </span>
        <span>
          <span className="text-emerald-400">{ready} ready</span>
          {notReady > 0 && <span className="text-rose-400"> · {notReady} down</span>}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {nodes.map(node => (
          <Link
            key={node.name}
            href={href}
            className={cn('node-dot', nodeTone(node, cordoned))}
            title={`${node.name}${node.internalIP ? ` (${node.internalIP})` : ''} — ${isNodeReady(node) ? 'Ready' : 'NotReady'}${isNodeCordoned(node, cordoned) ? ', cordoned' : ''}`}
          />
        ))}
      </div>
    </div>
  )
}

function Meter({ label, percent }: { label: string; percent?: number }) {
  if (percent === undefined || percent === null || Number.isNaN(percent)) return null
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="tabular-nums text-slate-300">{percent.toFixed(0)}%</span>
      </div>
      <div className="meter">
        <span className={meterColor(percent)} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  )
}

export default function ClusterCard({ cluster, onShowIssues }: { cluster: ClusterHealth; onShowIssues: () => void }) {
  const tone = statusTone(cluster.status)
  const { critical, warning } = issueCounts(cluster)
  const href = `/cluster/${cluster.id}`
  const cordoned = new Set([...(cluster.cordonedNodeWarnings || []), ...(cluster.cordonedNodeErrors || [])].map(n => n.name))
  const nodes = cluster.nodes || []
  const controlPlanes = nodes.filter(n => n.isControlPlane)
  const workers = nodes.filter(n => !n.isControlPlane)
  const versions = [
    cluster.kubernetesVersion && `k8s ${cluster.kubernetesVersion}`,
    cluster.talosVersion && `talos ${cluster.talosVersion}`,
    cluster.cni,
  ].filter(Boolean)
  const checked = cluster.status !== 'checking'

  return (
    <div className={cn('card tone-top flex flex-col transition hover:-translate-y-px hover:bg-slate-800/40', `tone-top-${tone}`)}>
      <Link href={href} className="block px-5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-white">{cluster.name}</h3>
            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
              {versions.length > 0 ? versions.join(' · ') : checked ? '—' : 'loading…'}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {cluster.isLoading && <Spinner />}
            <StatusBadge status={cluster.status} />
          </div>
        </div>
      </Link>

      <div className="flex-1 space-y-3 px-5 py-4">
        {isUnreachable(cluster) ? (
          <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{cluster.error || 'Cluster could not be reached.'}</p>
        ) : nodes.length > 0 ? (
          <>
            <NodeGroup label="Control planes" nodes={controlPlanes} cordoned={cordoned} href={`${href}?tab=nodes`} />
            <NodeGroup label="Workers" nodes={workers} cordoned={cordoned} href={`${href}?tab=nodes`} />
          </>
        ) : (
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Nodes</span>
            <span className="text-slate-300">{checked ? `${cluster.healthyNodes}/${cluster.totalNodes} ready` : '…'}</span>
          </div>
        )}

        {!isUnreachable(cluster) && (cluster.avgCpuPercent !== undefined || cluster.avgMemoryPercent !== undefined) && (
          <div className="grid grid-cols-2 gap-4 pt-1">
            <Meter label="CPU" percent={cluster.avgCpuPercent} />
            <Meter label="Memory" percent={cluster.avgMemoryPercent} />
          </div>
        )}

        {(() => {
          const backup = backupState(cluster)
          const credential = credentialSeverity(cluster)
          if (!backup && !credential) return null
          const toneClass = { ok: 'text-emerald-400', warn: 'text-amber-300', err: 'text-rose-300', muted: 'text-slate-500' }
          return (
            <div className="space-y-1 pt-1 text-xs">
              {backup && (
                <Link href={`${href}?tab=backups`} className="flex justify-between hover:underline" title={backup.title}>
                  <span className="text-slate-400">Last backup</span>
                  <span className={toneClass[backup.tone]}>{backup.label}</span>
                </Link>
              )}
              {credential && (
                <Link href="/tools/kubeconfigs" className="flex justify-between hover:underline">
                  <span className="text-slate-400">Kubeconfig</span>
                  <span className={credential === 'critical' ? 'text-rose-300' : 'text-amber-300'}>
                    {(cluster.credentialExpiresInDays ?? 0) < 0 ? 'expired' : `expires in ${cluster.credentialExpiresInDays} d`}
                  </span>
                </Link>
              )}
            </div>
          )
        })()}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-5 py-2.5 text-xs">
        <Link
          href={`${href}?tab=workloads`}
          className="truncate whitespace-nowrap text-slate-400 hover:text-white"
          title={cluster.totalNamespaces !== undefined ? `${cluster.totalPods} pods in ${cluster.totalNamespaces} namespaces` : undefined}
        >
          {cluster.totalPods !== undefined ? (
            <>
              <span className="tabular-nums text-slate-200">{cluster.totalPods}</span> pods
              {cluster.totalNamespaces !== undefined && (
                <>
                  {' · '}
                  <span className="tabular-nums text-slate-200">{cluster.totalNamespaces}</span> ns
                </>
              )}
            </>
          ) : (
            'Workloads'
          )}
        </Link>
        {critical + warning > 0 ? (
          <button onClick={onShowIssues} className="flex flex-shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-slate-800">
            <AlertTriangle className={cn('h-3.5 w-3.5', critical > 0 ? 'text-rose-400' : 'text-amber-400')} />
            {critical > 0 && <span className="badge badge-err">{critical} critical</span>}
            {warning > 0 && <span className="badge badge-warn">{warning} warning</span>}
            <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
          </button>
        ) : (
          checked &&
          !cluster.isLoading &&
          !isUnreachable(cluster) && (
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> No issues
            </span>
          )
        )}
      </div>
    </div>
  )
}

export function ClusterCardSkeleton() {
  return (
    <div className="card tone-top tone-top-muted animate-pulse p-5">
      <div className="mb-2 h-4 w-32 rounded bg-slate-800" />
      <div className="mb-6 h-3 w-48 rounded bg-slate-800" />
      <div className="mb-2 h-3 w-24 rounded bg-slate-800" />
      <div className="flex gap-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-3.5 w-3.5 rounded bg-slate-800" />
        ))}
      </div>
    </div>
  )
}
