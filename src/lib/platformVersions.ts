import * as k8s from '@kubernetes/client-node'
import { parseImageReference } from './images/reference'
import { compareVersions } from './images/versions'
import { createDefaultTagLookup } from './images/scan'

// Kubernetes and Talos versions of a cluster compared with the newest releases.
// Newest releases come from the image tags of kube-apiserver and talosctl, so they
// resolve through Nexus where there is no internet. Insight only, no upgrades.

export const KUBERNETES_IMAGE = 'registry.k8s.io/kube-apiserver'
// Tagged on every Talos release (ghcr.io/siderolabs/installer stopped at v1.13)
export const TALOS_IMAGE = 'ghcr.io/siderolabs/talosctl'
// Upstream Kubernetes maintains the three newest minor releases
export const KUBERNETES_SUPPORTED_MINORS = 3

export interface ReleaseStatus {
  current: string
  // Newest patch of the current minor, when newer than current
  latestPatch: string | null
  // Newest release overall, when newer than current
  latest: string | null
  minorsBehind: number
  outOfSupport: boolean
}

export interface NodeVersions {
  name: string
  controlPlane: boolean
  kubelet: string | null
  talos: string | null
  osImage: string | null
  kernel: string | null
  containerRuntime: string | null
}

export interface ClusterVersions {
  apiServer: string | null
  nodes: NodeVersions[]
}

export interface LatestReleases {
  kubernetes: string[] | null
  talos: string[] | null
  source: { kubernetes: string | null; talos: string | null }
  errors: { kubernetes: string | null; talos: string | null }
  checkedAt: string
}

const STABLE = /^v?\d+\.\d+\.\d+$/
const SEMVER = /v?\d+\.\d+\.\d+/
const TIMEOUT_MS = 15_000
const LATEST_TTL_MS = 60 * 60 * 1000

// "v1.37.1+k3s1" -> "v1.37.1"; "Talos (v1.14.4)" -> "v1.14.4"
export function extractVersion(text: string | null | undefined): string | null {
  const match = text?.match(SEMVER)?.[0]
  return match ? (match.startsWith('v') ? match : `v${match}`) : null
}

const minorOf = (version: string) => version.replace(/^v/, '').split('.').slice(0, 2).map(Number)

// Pure: where `current` stands among the release tags
export function releaseStatus(current: string, tags: string[], supportedMinors: number | null): ReleaseStatus {
  const stable = tags.filter(t => STABLE.test(t)).map(t => (t.startsWith('v') ? t : `v${t}`))
  const newest = (list: string[]) => (list.length ? list.reduce((best, t) => (compareVersions(t, best) > 0 ? t : best)) : null)
  const [major, minor] = minorOf(current)
  const latest = newest(stable)
  const latestPatch = newest(stable.filter(t => minorOf(t)[0] === major && minorOf(t)[1] === minor))
  const [latestMajor, latestMinor] = latest ? minorOf(latest) : [major, minor]
  // Across a major bump the minor distance is unknown; count it as out of reach
  const minorsBehind = latestMajor === major ? Math.max(0, latestMinor - minor) : 99
  return {
    current,
    latestPatch: latestPatch && compareVersions(latestPatch, current) > 0 ? latestPatch : null,
    latest: latest && compareVersions(latest, current) > 0 ? latest : null,
    minorsBehind,
    outOfSupport: supportedMinors !== null && minorsBehind >= supportedMinors,
  }
}

let latestCache: { value: LatestReleases; expires: number } | null = null

// Stable release tags of Kubernetes and Talos, cached for an hour
export async function getLatestReleases(force = false): Promise<LatestReleases> {
  if (!force && latestCache && latestCache.expires > Date.now()) return latestCache.value
  const lookup = await createDefaultTagLookup()
  const fetchTags = async (image: string) => {
    try {
      const { tags, source } = await lookup(parseImageReference(image))
      return { tags: tags.filter(t => STABLE.test(t)), source, error: null }
    } catch (error: any) {
      return { tags: null, source: null, error: error?.message || String(error) }
    }
  }
  const [kubernetes, talos] = await Promise.all([fetchTags(KUBERNETES_IMAGE), fetchTags(TALOS_IMAGE)])
  const value: LatestReleases = {
    kubernetes: kubernetes.tags,
    talos: talos.tags,
    source: { kubernetes: kubernetes.source, talos: talos.source },
    errors: { kubernetes: kubernetes.error, talos: talos.error },
    checkedAt: new Date().toISOString(),
  }
  // Don't keep a failed lookup for an hour
  if (!kubernetes.error && !talos.error) latestCache = { value, expires: Date.now() + LATEST_TTL_MS }
  return value
}

export async function getClusterVersions(kubeconfig: string): Promise<ClusterVersions> {
  const kc = new k8s.KubeConfig()
  kc.loadFromString(kubeconfig)
  const work = Promise.all([
    kc.makeApiClient(k8s.VersionApi).getCode(),
    kc.makeApiClient(k8s.CoreV1Api).listNode(),
  ]).then(([code, nodes]) => ({
    apiServer: extractVersion(code.gitVersion),
    nodes: nodes.items
      .map(node => {
        const info = node.status?.nodeInfo
        const labels = node.metadata?.labels ?? {}
        return {
          name: node.metadata?.name ?? '',
          controlPlane: 'node-role.kubernetes.io/control-plane' in labels || 'node-role.kubernetes.io/master' in labels,
          kubelet: extractVersion(info?.kubeletVersion),
          talos: info?.osImage?.startsWith('Talos') ? extractVersion(info.osImage) : null,
          osImage: info?.osImage ?? null,
          kernel: info?.kernelVersion ?? null,
          containerRuntime: info?.containerRuntimeVersion ?? null,
        }
      })
      .sort((a, b) => Number(b.controlPlane) - Number(a.controlPlane) || a.name.localeCompare(b.name)),
  }))
  return Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout reading cluster versions')), TIMEOUT_MS))])
}
