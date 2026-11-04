import { gunzipSync } from 'zlib'
import * as k8s from '@kubernetes/client-node'

// Reads the Helm 3 releases of a cluster. Helm stores every revision as a Secret
// of type helm.sh/release.v1 (labels owner=helm, name, version, status); its
// `release` field is base64(gzip(JSON)) on top of the usual Secret encoding.
//
// The release JSON also contains the user-supplied values and rendered manifests,
// which often hold credentials. Only metadata is returned from here.

export interface HelmRevision {
  revision: number
  status: string
  chartVersion: string
  appVersion: string | null
  updated: string | null
  description: string | null
}

export interface HelmRelease {
  // Installed by Helm itself, or rendered and applied by an Argo CD Application
  managedBy: 'helm' | 'argocd'
  name: string
  namespace: string
  chart: string
  chartVersion: string
  appVersion: string | null
  status: string
  revision: number
  updated: string | null
  firstDeployed: string | null
  description: string | null
  chartDescription: string | null
  history: HelmRevision[]
  // Argo CD only
  repoUrl?: string | null
  syncStatus?: string | null
  healthStatus?: string | null
  argoApp?: string
}

const LIST_TIMEOUT_MS = 30_000

export function decodeRelease(encoded: string): any {
  // Secret data is base64; Helm's payload inside is base64 again, usually gzipped
  const helmPayload = Buffer.from(Buffer.from(encoded, 'base64').toString('utf8'), 'base64')
  const isGzip = helmPayload[0] === 0x1f && helmPayload[1] === 0x8b
  return JSON.parse((isGzip ? gunzipSync(helmPayload) : helmPayload).toString('utf8'))
}

export async function listHelmReleases(kubeconfig: string): Promise<HelmRelease[]> {
  const kc = new k8s.KubeConfig()
  kc.loadFromString(kubeconfig)
  const core = kc.makeApiClient(k8s.CoreV1Api)

  const secrets = await Promise.race([
    core.listSecretForAllNamespaces({ labelSelector: 'owner=helm' }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout listing Helm releases')), LIST_TIMEOUT_MS)),
  ])

  // One entry per revision, grouped per release (namespace + name)
  const byRelease = new Map<string, { revision: HelmRevision; release: any }[]>()
  for (const secret of secrets.items) {
    if (secret.type !== 'helm.sh/release.v1' || !secret.data?.release) continue
    let release: any
    try {
      release = decodeRelease(secret.data.release)
    } catch (error) {
      console.warn(`Could not decode Helm release secret ${secret.metadata?.namespace}/${secret.metadata?.name}:`, error)
      continue
    }
    const key = `${release.namespace}/${release.name}`
    const revision: HelmRevision = {
      revision: release.version,
      status: release.info?.status ?? 'unknown',
      chartVersion: release.chart?.metadata?.version ?? '',
      appVersion: release.chart?.metadata?.appVersion ?? null,
      updated: release.info?.last_deployed ?? null,
      description: release.info?.description ?? null,
    }
    if (!byRelease.has(key)) byRelease.set(key, [])
    // Keep only metadata; values and manifests are dropped here
    byRelease.get(key)!.push({
      revision,
      release: {
        name: release.name,
        namespace: release.namespace,
        chart: release.chart?.metadata?.name ?? '',
        chartDescription: release.chart?.metadata?.description ?? null,
        firstDeployed: release.info?.first_deployed ?? null,
      },
    })
  }

  return Array.from(byRelease.values())
    .map(entries => {
      entries.sort((a, b) => b.revision.revision - a.revision.revision)
      const latest = entries[0]
      return {
        managedBy: 'helm' as const,
        ...latest.release,
        chartVersion: latest.revision.chartVersion,
        appVersion: latest.revision.appVersion,
        status: latest.revision.status,
        revision: latest.revision.revision,
        updated: latest.revision.updated,
        description: latest.revision.description,
        history: entries.map(e => e.revision),
      }
    })
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name))
}

// --- Argo CD ---------------------------------------------------------------
//
// Argo CD renders Helm charts itself, so they don't show up as Helm releases.
// Its Application resources say which chart and version are deployed. Only
// Applications with a Helm source are returned (not plain manifests/Kustomize).

const ARGO_GROUP = { group: 'argoproj.io', version: 'v1alpha1', plural: 'applications' }

async function listArgoApplications(api: k8s.CustomObjectsApi): Promise<any[]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res: any = await api.listClusterCustomObject(ARGO_GROUP)
      return res.items || []
    } catch (error: any) {
      const code = error?.code ?? error?.statusCode
      // Argo CD not installed
      if (code === 404) return []
      // "storage is (re)initializing": the API server asks to retry shortly
      if (code === 429 && attempt < 4) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
        continue
      }
      throw error
    }
  }
}

function helmSourceOf(app: any): any | null {
  const sources: any[] = app.spec?.sources ?? (app.spec?.source ? [app.spec.source] : [])
  const types: string[] = app.status?.sourceTypes ?? (app.status?.sourceType ? [app.status.sourceType] : [])
  const index = sources.findIndex((source, i) => source?.chart || types[i] === 'Helm')
  return index === -1 ? null : sources[index]
}

export async function listArgoHelmApplications(kubeconfig: string): Promise<HelmRelease[]> {
  const kc = new k8s.KubeConfig()
  kc.loadFromString(kubeconfig)
  const api = kc.makeApiClient(k8s.CustomObjectsApi)

  const apps = await Promise.race([
    listArgoApplications(api),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout listing Argo CD applications')), LIST_TIMEOUT_MS)),
  ])

  return apps
    .map((app): HelmRelease | null => {
      const source = helmSourceOf(app)
      if (!source) return null

      // A chart from a Helm repository has a chart name and version; a chart from
      // Git is a path at a commit.
      const fromRepo = Boolean(source.chart)
      const syncRevision: string | undefined = app.status?.sync?.revision ?? app.status?.sync?.revisions?.[0]
      const version = fromRepo ? source.targetRevision : (syncRevision ?? source.targetRevision ?? '').slice(0, 12)
      const history: HelmRevision[] = [...(app.status?.history ?? [])].reverse().map((h: any) => {
        const hSource = h.source ?? h.sources?.find((x: any) => x?.chart) ?? h.sources?.[0]
        const hVersion = hSource?.chart ? hSource.targetRevision : (h.revision ?? h.revisions?.[0] ?? '').slice(0, 12)
        const by = h.initiatedBy?.automated ? 'Auto-sync' : h.initiatedBy?.username ? `Sync by ${h.initiatedBy.username}` : null
        return { revision: h.id, status: '', chartVersion: hVersion ?? '', appVersion: null, updated: h.deployedAt ?? null, description: by }
      })

      const health: string | null = app.status?.health?.status ?? null
      const sync: string | null = app.status?.sync?.status ?? null
      return {
        managedBy: 'argocd',
        name: app.metadata?.name ?? '',
        namespace: app.spec?.destination?.namespace ?? app.metadata?.namespace ?? '',
        chart: source.chart ?? (source.path ? source.path.split('/').filter(Boolean).pop() ?? source.path : ''),
        chartVersion: version ?? '',
        appVersion: null,
        status: health ?? 'Unknown',
        revision: history.length,
        updated: app.status?.operationState?.finishedAt ?? history[0]?.updated ?? null,
        firstDeployed: history[history.length - 1]?.updated ?? null,
        description: null,
        chartDescription: null,
        history,
        repoUrl: source.repoURL ?? null,
        syncStatus: sync,
        healthStatus: health,
        argoApp: `${app.metadata?.namespace}/${app.metadata?.name}`,
      }
    })
    .filter((release): release is HelmRelease => release !== null)
    .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name))
}
