import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/database'
import { compareVersions } from '@/lib/images/versions'
import {
  getClusterVersions,
  getLatestReleases,
  releaseStatus,
  KUBERNETES_SUPPORTED_MINORS,
  type NodeVersions,
  type ReleaseStatus,
} from '@/lib/platformVersions'

export interface VersionsResponse {
  latest: {
    kubernetes: string | null
    talos: string | null
    source: { kubernetes: string | null; talos: string | null }
    errors: { kubernetes: string | null; talos: string | null }
    checkedAt: string
  }
  clusters: {
    id: number
    name: string
    error: string | null
    apiServer: string | null
    nodes: NodeVersions[]
    // null: current version or release list unknown
    kubernetes: ReleaseStatus | null
    talos: ReleaseStatus | null
    kubeletVersions: string[]
    talosVersions: string[]
  }[]
}

const newest = (tags: string[] | null) => (tags?.length ? tags.reduce((best, t) => (compareVersions(t, best) > 0 ? t : best)) : null)
const distinct = (values: (string | null)[]) => Array.from(new Set(values.filter((v): v is string => !!v))).sort(compareVersions)

// Kubernetes and Talos versions of every active cluster against the newest releases.
// ?refresh=1 bypasses the one-hour cache of the release lists.
export async function GET(request: NextRequest) {
  try {
    const clusters = (await query('SELECT id, name, kubeconfig FROM clusters WHERE is_active = true ORDER BY name')).rows
    const [latest, versions] = await Promise.all([
      getLatestReleases(request.nextUrl.searchParams.get('refresh') === '1'),
      Promise.all(clusters.map(c => getClusterVersions(c.kubeconfig).then(v => ({ ...v, error: null as string | null }), (error: any) => ({ apiServer: null, nodes: [], error: error?.message || 'Unreachable' })))),
    ])

    const body: VersionsResponse = {
      latest: { kubernetes: newest(latest.kubernetes), talos: newest(latest.talos), source: latest.source, errors: latest.errors, checkedAt: latest.checkedAt },
      clusters: clusters.map((c, i) => {
        const v = versions[i]
        const kubeletVersions = distinct(v.nodes.map(n => n.kubelet))
        const talosVersions = distinct(v.nodes.map(n => n.talos))
        // Judge Talos by its oldest node: that is what still needs an upgrade
        const talosCurrent = talosVersions[0] ?? null
        return {
          id: c.id,
          name: c.name,
          error: v.error,
          apiServer: v.apiServer,
          nodes: v.nodes,
          kubernetes: v.apiServer && latest.kubernetes ? releaseStatus(v.apiServer, latest.kubernetes, KUBERNETES_SUPPORTED_MINORS) : null,
          talos: talosCurrent && latest.talos ? releaseStatus(talosCurrent, latest.talos, null) : null,
          kubeletVersions,
          talosVersions,
        }
      }),
    }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('Error reading versions:', error)
    return NextResponse.json({ error: error?.message || 'Failed to read versions' }, { status: 500 })
  }
}
