import https from 'https'
import * as k8s from '@kubernetes/client-node'
import { parseAllDocuments } from 'yaml'
import { decodeRelease } from '@/lib/helm'
import { isCustomerManaged } from '@/lib/customerManaged'

// Finds API versions in use that Kubernetes removes (or already removed), from two sources:
//  1. The API server's own metric apiserver_requested_deprecated_apis: every deprecated
//     API that clients requested since the API server started, with the release that
//     removes it. The cluster knows its own deprecations, so this needs no table.
//  2. The manifests of deployed Helm releases, checked against the table below, so a
//     chart that still ships an old API is found before an upgrade breaks it.

export interface DeprecatedApiFinding {
  group: string
  version: string
  kind: string
  removedIn: string | null
  replacement: string | null
  source: 'api-traffic' | 'helm'
  // Helm only
  release?: string
  namespace?: string
  objects?: string[]
}

export interface ClusterDeprecations {
  clusterId: number
  clusterName: string
  kubernetesVersion: string | null
  findings: DeprecatedApiFinding[]
  // So the UI can hide findings in customer-managed namespaces
  customerManagedNamespaces: string[]
  // Partial failures (e.g. no permission for /metrics); other sources still count
  warnings: string[]
}

// Deprecated APIs that charts still commonly carry: "group/version kind" -> [removed in, replacement].
// `null` = deprecated, but no removal scheduled yet.
const REMOVED_APIS: Record<string, [string | null, string]> = {
  'v1 Endpoints': [null, 'discovery.k8s.io/v1 EndpointSlice'],
  'v1 ComponentStatus': [null, 'none (use the /livez and /readyz endpoints)'],
  'extensions/v1beta1 Deployment': ['1.16', 'apps/v1'],
  'extensions/v1beta1 DaemonSet': ['1.16', 'apps/v1'],
  'extensions/v1beta1 ReplicaSet': ['1.16', 'apps/v1'],
  'apps/v1beta1 Deployment': ['1.16', 'apps/v1'],
  'apps/v1beta2 Deployment': ['1.16', 'apps/v1'],
  'apps/v1beta1 StatefulSet': ['1.16', 'apps/v1'],
  'apps/v1beta2 StatefulSet': ['1.16', 'apps/v1'],
  'apps/v1beta2 DaemonSet': ['1.16', 'apps/v1'],
  'apps/v1beta2 ReplicaSet': ['1.16', 'apps/v1'],
  'extensions/v1beta1 NetworkPolicy': ['1.16', 'networking.k8s.io/v1'],
  'extensions/v1beta1 PodSecurityPolicy': ['1.16', 'none (use Pod Security Admission)'],
  'extensions/v1beta1 Ingress': ['1.22', 'networking.k8s.io/v1'],
  'networking.k8s.io/v1beta1 Ingress': ['1.22', 'networking.k8s.io/v1'],
  'networking.k8s.io/v1beta1 IngressClass': ['1.22', 'networking.k8s.io/v1'],
  'apiextensions.k8s.io/v1beta1 CustomResourceDefinition': ['1.22', 'apiextensions.k8s.io/v1'],
  'admissionregistration.k8s.io/v1beta1 MutatingWebhookConfiguration': ['1.22', 'admissionregistration.k8s.io/v1'],
  'admissionregistration.k8s.io/v1beta1 ValidatingWebhookConfiguration': ['1.22', 'admissionregistration.k8s.io/v1'],
  'apiregistration.k8s.io/v1beta1 APIService': ['1.22', 'apiregistration.k8s.io/v1'],
  'certificates.k8s.io/v1beta1 CertificateSigningRequest': ['1.22', 'certificates.k8s.io/v1'],
  'coordination.k8s.io/v1beta1 Lease': ['1.22', 'coordination.k8s.io/v1'],
  'rbac.authorization.k8s.io/v1beta1 ClusterRole': ['1.22', 'rbac.authorization.k8s.io/v1'],
  'rbac.authorization.k8s.io/v1beta1 ClusterRoleBinding': ['1.22', 'rbac.authorization.k8s.io/v1'],
  'rbac.authorization.k8s.io/v1beta1 Role': ['1.22', 'rbac.authorization.k8s.io/v1'],
  'rbac.authorization.k8s.io/v1beta1 RoleBinding': ['1.22', 'rbac.authorization.k8s.io/v1'],
  'scheduling.k8s.io/v1beta1 PriorityClass': ['1.22', 'scheduling.k8s.io/v1'],
  'storage.k8s.io/v1beta1 StorageClass': ['1.22', 'storage.k8s.io/v1'],
  'storage.k8s.io/v1beta1 VolumeAttachment': ['1.22', 'storage.k8s.io/v1'],
  'storage.k8s.io/v1beta1 CSIDriver': ['1.22', 'storage.k8s.io/v1'],
  'storage.k8s.io/v1beta1 CSINode': ['1.22', 'storage.k8s.io/v1'],
  'batch/v1beta1 CronJob': ['1.25', 'batch/v1'],
  'discovery.k8s.io/v1beta1 EndpointSlice': ['1.25', 'discovery.k8s.io/v1'],
  'events.k8s.io/v1beta1 Event': ['1.25', 'events.k8s.io/v1'],
  'autoscaling/v2beta1 HorizontalPodAutoscaler': ['1.25', 'autoscaling/v2'],
  'policy/v1beta1 PodDisruptionBudget': ['1.25', 'policy/v1'],
  'policy/v1beta1 PodSecurityPolicy': ['1.25', 'none (use Pod Security Admission)'],
  'node.k8s.io/v1beta1 RuntimeClass': ['1.25', 'node.k8s.io/v1'],
  'autoscaling/v2beta2 HorizontalPodAutoscaler': ['1.26', 'autoscaling/v2'],
  'flowcontrol.apiserver.k8s.io/v1beta1 FlowSchema': ['1.26', 'flowcontrol.apiserver.k8s.io/v1'],
  'flowcontrol.apiserver.k8s.io/v1beta1 PriorityLevelConfiguration': ['1.26', 'flowcontrol.apiserver.k8s.io/v1'],
  'storage.k8s.io/v1beta1 CSIStorageCapacity': ['1.27', 'storage.k8s.io/v1'],
  'flowcontrol.apiserver.k8s.io/v1beta2 FlowSchema': ['1.29', 'flowcontrol.apiserver.k8s.io/v1'],
  'flowcontrol.apiserver.k8s.io/v1beta2 PriorityLevelConfiguration': ['1.29', 'flowcontrol.apiserver.k8s.io/v1'],
  'flowcontrol.apiserver.k8s.io/v1beta3 FlowSchema': ['1.32', 'flowcontrol.apiserver.k8s.io/v1'],
  'flowcontrol.apiserver.k8s.io/v1beta3 PriorityLevelConfiguration': ['1.32', 'flowcontrol.apiserver.k8s.io/v1'],
}

const TIMEOUT_MS = 20_000

async function rawGet(kc: k8s.KubeConfig, path: string): Promise<{ status: number; body: string }> {
  const server = kc.getCurrentCluster()?.server
  if (!server) throw new Error('No cluster server in kubeconfig')
  const url = new URL(path, server)
  const options: https.RequestOptions = { method: 'GET', hostname: url.hostname, port: url.port, path: url.pathname, timeout: TIMEOUT_MS }
  await kc.applyToHTTPSOptions(options)
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => (body += chunk))
      res.on('end', () => resolve({ status: res.statusCode || 0, body }))
    })
    req.on('timeout', () => req.destroy(new Error(`Timeout requesting ${path}`)))
    req.on('error', reject)
    req.end()
  })
}

// "PodSecurityPolicy" -> "podsecuritypolicies", "Ingress" -> "ingresses", "Lease" -> "leases"
function plural(kind: string) {
  const lower = kind.toLowerCase()
  if (lower.endsWith('y')) return `${lower.slice(0, -1)}ies`
  if (lower.endsWith('s')) return `${lower}es`
  return `${lower}s`
}

// Resource names in the metric are plural lower case; the table and the UI use kinds
function kindFromResource(group: string, version: string, resource: string): string {
  const gv = group ? `${group}/${version}` : version
  const match = Object.keys(REMOVED_APIS).find(key => {
    const kind = key.split(' ')[1]
    // Some kinds are already plural (Endpoints -> endpoints)
    return key.startsWith(`${gv} `) && (plural(kind) === resource || kind.toLowerCase() === resource)
  })
  return match ? match.split(' ')[1] : resource
}

async function fromApiTraffic(kc: k8s.KubeConfig): Promise<DeprecatedApiFinding[]> {
  const res = await rawGet(kc, '/metrics')
  if (res.status === 401 || res.status === 403) throw new Error(`No permission to read the API server metrics (HTTP ${res.status})`)
  if (res.status !== 200) throw new Error(`API server metrics returned HTTP ${res.status}`)
  const findings: DeprecatedApiFinding[] = []
  for (const line of res.body.split('\n')) {
    if (!line.startsWith('apiserver_requested_deprecated_apis{')) continue
    const labels = Object.fromEntries(Array.from(line.matchAll(/(\w+)="([^"]*)"/g), m => [m[1], m[2]]))
    const gv = labels.group ? `${labels.group}/${labels.version}` : labels.version
    const kind = kindFromResource(labels.group ?? '', labels.version ?? '', labels.resource ?? '')
    const known = REMOVED_APIS[`${gv} ${kind}`]
    findings.push({
      group: labels.group ?? '',
      version: labels.version ?? '',
      kind: labels.subresource ? `${kind}/${labels.subresource}` : kind,
      removedIn: labels.removed_release || known?.[0] || null,
      replacement: known?.[1] ?? null,
      source: 'api-traffic',
    })
  }
  return findings
}

// Deprecated API versions in one Helm release manifest (multi-document YAML)
export function findInManifest(manifest: string, release: { name: string; namespace: string }): DeprecatedApiFinding[] {
  const findings = new Map<string, DeprecatedApiFinding>()
  for (const doc of parseAllDocuments(manifest)) {
    const obj: any = doc.errors.length === 0 ? doc.toJS() : null
    if (!obj?.apiVersion || !obj?.kind) continue
    const known = REMOVED_APIS[`${obj.apiVersion} ${obj.kind}`]
    if (!known) continue
    const key = `${obj.apiVersion}/${obj.kind}`
    const [group, version] = obj.apiVersion.includes('/') ? obj.apiVersion.split('/') : ['', obj.apiVersion]
    const finding: DeprecatedApiFinding = findings.get(key) ?? {
      group,
      version,
      kind: obj.kind,
      removedIn: known[0],
      replacement: known[1],
      source: 'helm',
      release: `${release.namespace}/${release.name}`,
      namespace: release.namespace,
      objects: [],
    }
    finding.objects!.push(obj.metadata?.name ?? '?')
    findings.set(key, finding)
  }
  return Array.from(findings.values())
}

async function fromHelmReleases(kc: k8s.KubeConfig): Promise<DeprecatedApiFinding[]> {
  const core = kc.makeApiClient(k8s.CoreV1Api)
  const secrets = await core.listSecretForAllNamespaces({ labelSelector: 'owner=helm,status=deployed' })
  return secrets.items.flatMap(secret => {
    if (secret.type !== 'helm.sh/release.v1' || !secret.data?.release) return []
    try {
      const release = decodeRelease(secret.data.release)
      return findInManifest(release.manifest ?? '', release)
    } catch {
      return []
    }
  })
}

export async function checkDeprecatedApis(cluster: { id: number; name: string; kubeconfig: string }): Promise<ClusterDeprecations> {
  const kc = new k8s.KubeConfig()
  kc.loadFromString(cluster.kubeconfig)
  const warnings: string[] = []

  const [version, traffic, helm, namespaces] = await Promise.allSettled([
    kc.makeApiClient(k8s.VersionApi).getCode(),
    fromApiTraffic(kc),
    fromHelmReleases(kc),
    kc.makeApiClient(k8s.CoreV1Api).listNamespace(),
  ])
  if (traffic.status === 'rejected') warnings.push(`API traffic: ${traffic.reason?.message || traffic.reason}`)
  if (helm.status === 'rejected') warnings.push(`Helm releases: ${helm.reason?.message || helm.reason}`)

  return {
    clusterId: cluster.id,
    clusterName: cluster.name,
    kubernetesVersion: version.status === 'fulfilled' ? (version.value as any).gitVersion ?? null : null,
    findings: [
      ...(traffic.status === 'fulfilled' ? traffic.value : []),
      ...(helm.status === 'fulfilled' ? helm.value : []),
    ],
    customerManagedNamespaces:
      namespaces.status === 'fulfilled'
        ? namespaces.value.items.filter(ns => isCustomerManaged(ns.metadata?.labels)).map(ns => ns.metadata?.name ?? '')
        : [],
    warnings,
  }
}

// Exposed for tests
export const __internals = { REMOVED_APIS, kindFromResource }
