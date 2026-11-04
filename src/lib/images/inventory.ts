import * as k8s from '@kubernetes/client-node'
import { isCustomerManaged } from '@/lib/customerManaged'

// Collects the images referenced by every workload in a cluster. Images are read
// from the workload specs (not from running pods), so suspended CronJobs and
// scaled-down Deployments are included too.

export type WorkloadKind = 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'CronJob' | 'Job' | 'ReplicaSet' | 'Pod' | 'StaticPod'

export interface WorkloadImage {
  namespace: string
  kind: WorkloadKind
  name: string
  container: string
  initContainer: boolean
  image: string
  // Namespace is labelled customer_managed=yes
  customerManaged: boolean
}

const LIST_TIMEOUT_MS = 30_000

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout listing ${label}`)), LIST_TIMEOUT_MS)),
  ])
}

function fromPodSpec(
  kind: WorkloadKind,
  meta: k8s.V1ObjectMeta | undefined,
  spec: k8s.V1PodSpec | undefined
): Omit<WorkloadImage, 'customerManaged'>[] {
  if (!spec) return []
  const base = { namespace: meta?.namespace || 'default', kind, name: meta?.name || '' }
  return [
    ...(spec.initContainers || []).map(c => ({ ...base, container: c.name, initContainer: true, image: c.image || '' })),
    ...(spec.containers || []).map(c => ({ ...base, container: c.name, initContainer: false, image: c.image || '' })),
  ].filter(row => row.image)
}

const ownerKinds = (meta?: k8s.V1ObjectMeta) => (meta?.ownerReferences || []).map(ref => ref.kind)

export async function collectWorkloadImages(kubeconfig: string): Promise<WorkloadImage[]> {
  const kc = new k8s.KubeConfig()
  kc.loadFromString(kubeconfig)
  const apps = kc.makeApiClient(k8s.AppsV1Api)
  const batch = kc.makeApiClient(k8s.BatchV1Api)
  const core = kc.makeApiClient(k8s.CoreV1Api)

  const [namespaces, deployments, statefulSets, daemonSets, cronJobs, jobs, replicaSets, pods] = await Promise.all([
    withTimeout(core.listNamespace(), 'namespaces'),
    withTimeout(apps.listDeploymentForAllNamespaces(), 'deployments'),
    withTimeout(apps.listStatefulSetForAllNamespaces(), 'statefulsets'),
    withTimeout(apps.listDaemonSetForAllNamespaces(), 'daemonsets'),
    withTimeout(batch.listCronJobForAllNamespaces(), 'cronjobs'),
    withTimeout(batch.listJobForAllNamespaces(), 'jobs'),
    withTimeout(apps.listReplicaSetForAllNamespaces(), 'replicasets'),
    withTimeout(core.listPodForAllNamespaces(), 'pods'),
  ])

  const customerNamespaces = new Set(
    namespaces.items.filter(ns => isCustomerManaged(ns.metadata?.labels)).map(ns => ns.metadata?.name)
  )

  const rows = [
    ...deployments.items.flatMap(d => fromPodSpec('Deployment', d.metadata, d.spec?.template.spec)),
    ...statefulSets.items.flatMap(s => fromPodSpec('StatefulSet', s.metadata, s.spec?.template.spec)),
    ...daemonSets.items.flatMap(d => fromPodSpec('DaemonSet', d.metadata, d.spec?.template.spec)),
    ...cronJobs.items.flatMap(c => fromPodSpec('CronJob', c.metadata, c.spec?.jobTemplate.spec?.template.spec)),
    // Jobs created by a CronJob are already covered by the CronJob itself
    ...jobs.items
      .filter(j => !ownerKinds(j.metadata).includes('CronJob'))
      .flatMap(j => fromPodSpec('Job', j.metadata, j.spec?.template.spec)),
    // ReplicaSets owned by a Deployment are covered by the Deployment
    ...replicaSets.items
      .filter(r => ownerKinds(r.metadata).length === 0)
      .flatMap(r => fromPodSpec('ReplicaSet', r.metadata, r.spec?.template?.spec)),
    // Pods without a controller, and static (mirror) pods such as the control plane
    ...pods.items.flatMap(p => {
      const owners = ownerKinds(p.metadata)
      if (owners.length === 0) return fromPodSpec('Pod', p.metadata, p.spec)
      if (owners.includes('Node')) return fromPodSpec('StaticPod', p.metadata, p.spec)
      return []
    }),
  ]
  return rows.map(row => ({ ...row, customerManaged: customerNamespaces.has(row.namespace) }))
}
