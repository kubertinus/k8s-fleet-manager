import * as k8s from '@kubernetes/client-node'
import { parse } from 'yaml'
import { PassThrough } from 'stream'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import { parseQuantity } from './quantity'
import { isCustomerManaged } from './customerManaged'
import { getVelero, toSummary, type VeleroSummary } from './velero'

const execFileAsync = promisify(execFile)

// Cross-request cache for slow-changing cluster facts, see KubernetesClient.slow().
const slowCache: Map<string, { at: number; value: Promise<unknown> }> =
  ((globalThis as any).__k8sFleetManagerSlowCache ??= new Map())

export interface ParsedKubeconfig {
  name: string
  endpoint: string
  description: string
}

export function parseKubeconfig(kubeconfigContent: string): ParsedKubeconfig {
  try {
    const kubeconfig = parse(kubeconfigContent)
    
    // Extract cluster information
    const currentContext = kubeconfig['current-context']
    const context = kubeconfig.contexts?.find((ctx: any) => ctx.name === currentContext)
    const clusterName = context?.context?.cluster || 'Unknown Cluster'
    
    // Find the cluster details
    const cluster = kubeconfig.clusters?.find((c: any) => c.name === clusterName)
    const endpoint = cluster?.cluster?.server || 'Unknown Endpoint'
    
    // Generate a description based on the cluster info
    const description = `Talos cluster: ${clusterName} (${endpoint})`
    
    return {
      name: clusterName,
      endpoint: endpoint,
      description: description
    }
  } catch (error) {
    throw new Error('Invalid kubeconfig format')
  }
}

export interface ClusterInfo {
  id: number
  name: string
  endpoint: string
  kubeconfig?: string
}

export interface NodeMetrics {
  name: string
  cpuUsage: number
  memoryUsage: number
  cpuCapacity: number
  memoryCapacity: number
  status: string
  isControlPlane: boolean
}

export interface ClusterHealth {
  clusterId: number
  status: 'healthy' | 'unhealthy' | 'warning' | 'unknown'
  healthyNodes: number
  totalNodes: number
  nodes: NodeMetrics[]
  totalPods?: number
  totalNamespaces?: number
  avgCpuPercent?: number
  avgMemoryPercent?: number
  latestBackup?: {
    name: string
    phase: string
    startTimestamp?: string
    completionTimestamp?: string
    errors: number
    warnings: number
  }
  kubernetesVersion?: string
  talosVersion?: string
  cni?: string
  storageDrivers?: string[]
  ingressControllers?: string[]
  openebsStorage?: {
    totalCapacity: string
    totalUsed: string
    totalAvailable: string
    poolCount: number
  }
  podErrors?: Array<{
    name: string
    namespace: string
    phase: string
    reason?: string
  }>
  podResourceWarnings?: Array<{
    name: string
    namespace: string
    cpuPercent?: number
    memoryPercent?: number
    cpuUsage?: string
    cpuCapacity?: string
    memoryUsage?: string
    memoryCapacity?: string
  }>
  certificateWarnings?: Array<{
    name: string
    namespace: string
    expiresAt: string
    daysUntilExpiry: number
  }>
  cordonedNodeWarnings?: Array<{
    name: string
    reason: string
    cordonedSince: string
    isReady: boolean
  }>
  cordonedNodeErrors?: Array<{
    name: string
    reason: string
    cordonedSince: string
    isReady: boolean
  }>
  lastChecked: Date
}

export class KubernetesClient {
  private kc: k8s.KubeConfig
  private k8sApi: any
  private appsApi: any
  private storageApi: any
  private networkingApi: any
  private metricsApi: any
  private talosconfig?: string
  private kubeconfigContent?: string
  private cacheId: string
  private sharedCalls = new Map<string, Promise<unknown>>()

  constructor(kubeconfig?: string, talosconfig?: string) {
    this.kc = new k8s.KubeConfig()
    this.talosconfig = talosconfig
    this.kubeconfigContent = kubeconfig
    this.cacheId = createHash('sha1').update(kubeconfig || 'default').digest('hex')
    
    // Always the stored kubeconfig: falling back to the default config would
    // silently use the pod's own ServiceAccount (the hosting cluster).
    if (!kubeconfig) {
      throw new Error('No kubeconfig configured for this cluster')
    }
    this.kc.loadFromString(kubeconfig)
    
    this.k8sApi = this.makeWrappedApiClient(k8s.CoreV1Api)
    this.appsApi = this.makeWrappedApiClient(k8s.AppsV1Api)
    this.storageApi = this.makeWrappedApiClient(k8s.StorageV1Api)
    this.networkingApi = this.makeWrappedApiClient(k8s.NetworkingV1Api)
    this.metricsApi = new k8s.Metrics(this.kc)
  }

  private makeWrappedApiClient(apiClientClass: any): any {
    const client = this.kc.makeApiClient(apiClientClass)
    this.wrapApiClientResponses(client)
    return client
  }

  private normalizeApiResponse<T>(result: T): T | { body: T } {
    if (!result || typeof result !== 'object') {
      return result
    }

    const response = result as any
    if (response.body !== undefined) {
      return result
    }

    const looksLikeKubernetesObject =
      response.apiVersion !== undefined ||
      response.kind !== undefined ||
      response.items !== undefined ||
      response.metadata !== undefined ||
      response.spec !== undefined ||
      response.status !== undefined ||
      response.data !== undefined

    if (looksLikeKubernetesObject) {
      return { body: response }
    }

    return result
  }

  private wrapApiClientResponses(client: any): void {
    const prototype = Object.getPrototypeOf(client)
    if (!prototype) return

    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      if (methodName === 'constructor') continue

      const originalMethod = client[methodName]
      if (typeof originalMethod !== 'function') continue

      client[methodName] = async (...args: any[]) => {
        const result = await originalMethod.apply(client, args)
        return this.normalizeApiResponse(result)
      }
    }
  }

  // Memoise list calls within one client instance (= one request), so the
  // health check doesn't fetch every pod or node several times.
  private shared<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.sharedCalls.has(key)) {
      const promise = load()
      // Don't keep failures around; the next caller may retry.
      promise.catch(() => this.sharedCalls.delete(key))
      this.sharedCalls.set(key, promise)
    }
    return this.sharedCalls.get(key) as Promise<T>
  }

  private listAllNodes(): Promise<any> {
    return this.shared('nodes', () => this.k8sApi.listNode())
  }

  private listAllPods(): Promise<any> {
    return this.shared('pods', () => this.k8sApi.listPodForAllNamespaces())
  }

  private listAllDeployments(): Promise<any> {
    return this.shared('deployments', () => this.appsApi.listDeploymentForAllNamespaces())
  }

  private listAllDaemonSets(): Promise<any> {
    return this.shared('daemonsets', () => this.appsApi.listDaemonSetForAllNamespaces())
  }

  // Cache across requests for data that rarely changes (versions, CNI,
  // certificates, ...), keyed by the cluster's kubeconfig.
  private slow<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const cacheKey = `${this.cacheId}:${key}`
    const hit = slowCache.get(cacheKey)
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
    const value = load()
    slowCache.set(cacheKey, { at: Date.now(), value })
    value.catch(() => slowCache.delete(cacheKey))
    return value
  }

  private buildNodeMetrics(nodes: any[], metricsItems: any[] | null): NodeMetrics[] {
    return nodes.map(node => {
      const nodeName = node.metadata?.name || ''
      const isReady = node.status?.conditions?.some((condition: any) =>
        condition.type === 'Ready' && condition.status === 'True'
      )
      // Check if node is cordoned (unschedulable)
      const isCordoned = node.spec?.unschedulable === true
      const isControlPlane = this.isControlPlaneNode(node)
      const internalIP = node.status?.addresses?.find((addr: any) => addr.type === 'InternalIP')?.address
      const labels = node.metadata?.labels || {}
      const cpuCapacity = this.parseResource(node.status?.capacity?.cpu || '0')
      const memoryCapacity = this.parseResource(node.status?.capacity?.memory || '0')

      if (metricsItems === null) {
        // Fallback to basic node info without metrics
        let nodeStatus = 'NotReady'
        if (isCordoned) {
          nodeStatus = 'Cordoned'
        } else if (isReady) {
          nodeStatus = 'Ready'
        }
        return { name: nodeName, cpuUsage: 0, memoryUsage: 0, cpuCapacity, memoryCapacity, status: nodeStatus, isControlPlane, internalIP, labels }
      }

      const nodeMetric = metricsItems.find((m: any) => m.metadata.name === nodeName)
      const cpuUsage = nodeMetric ? this.parseResource(nodeMetric.usage.cpu) : 0
      const memoryUsage = nodeMetric ? this.parseResource(nodeMetric.usage.memory) : 0

      // Determine node status; cordoned status is independent of ready status
      let nodeStatus = isReady ? 'Ready' : 'NotReady'
      if (isCordoned) {
        nodeStatus = isReady ? 'Cordoned' : 'CordonedNotReady'
      }

      return { name: nodeName, cpuUsage, memoryUsage, cpuCapacity, memoryCapacity, status: nodeStatus, isControlPlane, internalIP, labels }
    })
  }

  private async getVersions(nodes: any[]): Promise<{ kubernetesVersion: string; talosVersion: string }> {
    let kubernetesVersion = 'Unknown'
    let talosVersion = 'Unknown'

    try {
      // Get Kubernetes version
      const versionApi = this.makeWrappedApiClient(k8s.VersionApi)
      const versionResponse = await versionApi.getCode()
      const versionInfo = (versionResponse as any)?.body || versionResponse
      kubernetesVersion = (versionInfo as any)?.gitVersion || 'Unknown'

      // Get Talos version
      if (this.talosconfig) {
        try {
          const yaml = require('yaml')
          const talosConfig = yaml.parse(this.talosconfig)

          // Try to extract version from talosconfig context name
          if (talosConfig.context?.name) {
            const contextMatch = talosConfig.context.name.match(/v?(\d+\.\d+\.\d+)/)
            if (contextMatch) {
              talosVersion = `v${contextMatch[1]}`
            }
          }

          // If not found in context, try the Talos API, then node system info
          if (talosVersion === 'Unknown' && talosConfig.contexts) {
            try {
              const talosVersionFromAPI = await this.getTalosVersionFromAPI(talosConfig)
              talosVersion = talosVersionFromAPI || (await this.getTalosVersionFromNodes(nodes))
            } catch (apiError) {
              console.warn('Failed to get Talos version from API:', apiError)
              talosVersion = await this.getTalosVersionFromNodes(nodes)
            }
          }
        } catch (error) {
          console.warn('Error parsing talosconfig:', error)
          talosVersion = await this.getTalosVersionFromNodes(nodes)
        }
      }

      // Fallback: Get Talos version from node annotations/labels
      if (talosVersion === 'Unknown' && nodes.length > 0) {
        talosVersion = await this.getTalosVersionFromNodes(nodes)
      }
    } catch (error) {
      console.warn('Error fetching version information:', error)
    }

    return { kubernetesVersion, talosVersion }
  }

  private async getOpenEBSStorageSummary() {
    const openebsInfo = await this.detectOpenEBS()
    if (!openebsInfo.installed || openebsInfo.storagePools.length === 0) return undefined

    let totalCapacityBytes = 0
    let totalUsedBytes = 0
    let totalAvailableBytes = 0
    openebsInfo.storagePools.forEach((pool: any) => {
      if (pool.capacity) totalCapacityBytes += this.parseStorageSizeToBytes(pool.capacity)
      if (pool.used) totalUsedBytes += this.parseStorageSizeToBytes(pool.used)
      if (pool.available) totalAvailableBytes += this.parseStorageSizeToBytes(pool.available)
    })

    return {
      totalCapacity: this.formatBytesToStorage(totalCapacityBytes),
      totalUsed: this.formatBytesToStorage(totalUsedBytes),
      totalAvailable: this.formatBytesToStorage(totalAvailableBytes),
      poolCount: openebsInfo.storagePools.length
    }
  }

  // `lite` skips the OpenEBS storage summary, which the dashboard doesn't show.
  // All independent checks run in parallel.
  async getClusterHealth({ lite = false }: { lite?: boolean } = {}): Promise<Partial<ClusterHealth>> {
    // Run a check, log and fall back on failure, so one slow or broken API
    // group never takes the whole health check down.
    const safe = <T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> =>
      run().catch(error => {
        console.warn(`Error fetching ${label}:`, error)
        return fallback
      })

    try {
      const nodesResponse = await this.listAllNodes()
      const nodes: any[] = nodesResponse.body.items || []

      const totalNodes = nodes.length
      const healthyNodes = nodes.filter((node: any) =>
        node.status?.conditions?.some((condition: any) =>
          condition.type === 'Ready' && condition.status === 'True'
        )
      ).length

      const MINUTE = 60_000
      const [
        nodeMetrics,
        allPods,
        allNamespaces,
        velero,
        versions,
        openebsStorage,
        podErrors,
        podResourceWarnings,
        certificateWarnings,
        cordonedNodes,
        cni,
        storageDrivers,
        ingressControllers,
      ] = await Promise.all([
        this.metricsApi.getNodeMetrics()
          .then((response: any) => this.buildNodeMetrics(nodes, response.items || []))
          .catch((metricsError: any) => {
            console.warn('Failed to fetch node metrics:', metricsError)
            return this.buildNodeMetrics(nodes, null)
          }) as Promise<NodeMetrics[]>,
        safe('pods', [] as any[], async () => (await this.listAllPods()).body.items as any[]),
        safe('namespaces', [] as any[], async () => (await this.k8sApi.listNamespace()).body.items as any[]),
        safe('Velero backups', null as VeleroSummary | null, () => this.slow('velero', 5 * MINUTE, async () => toSummary(await getVelero(this.kubeconfigContent!)))),
        this.slow('versions', 10 * MINUTE, () => this.getVersions(nodes)),
        lite ? Promise.resolve(undefined) : safe('OpenEBS storage information', undefined, () => this.getOpenEBSStorageSummary()),
        safe('pod errors', [] as any[], () => this.getPodErrors()),
        safe('pod resource warnings', [] as any[], () => this.getPodResourceWarnings()),
        safe('certificate expiration warnings', [] as any[], () => this.slow('certificates', 5 * MINUTE, () => this.getCertificateExpirations())),
        safe('cordoned node warnings', [] as any[], () => this.getCordonedNodes()),
        safe('CNI', 'Unknown', () => this.slow('cni', 10 * MINUTE, () => this.detectCNI())),
        safe('storage drivers', [] as string[], () => this.slow('storageDrivers', 10 * MINUTE, () => this.getStorageDrivers())),
        safe('ingress controllers', [] as string[], () => this.slow('ingress', 10 * MINUTE, () => this.detectIngressControllers())),
      ])

      // Calculate average CPU and memory percentages
      let avgCpuPercent = 0
      let avgMemoryPercent = 0
      if (nodeMetrics.length > 0) {
        const totalCpuPercent = nodeMetrics.reduce((sum, node) => {
          const percent = node.cpuCapacity > 0 ? (node.cpuUsage / node.cpuCapacity * 100) : 0
          return sum + (isNaN(percent) ? 0 : percent)
        }, 0)
        avgCpuPercent = totalCpuPercent / nodeMetrics.length

        const totalMemoryPercent = nodeMetrics.reduce((sum, node) => {
          const percent = node.memoryCapacity > 0 ? (node.memoryUsage / node.memoryCapacity * 100) : 0
          return sum + (isNaN(percent) ? 0 : percent)
        }, 0)
        avgMemoryPercent = totalMemoryPercent / nodeMetrics.length
      }

      // Namespaces labelled customer_managed=yes, so the UI can hide what the customer runs
      const customerManagedNamespaces: string[] = allNamespaces
        .filter((ns: any) => isCustomerManaged(ns.metadata?.labels))
        .map((ns: any) => ns.metadata?.name)
        .filter(Boolean)
      const customerSet = new Set(customerManagedNamespaces)
      const customerManagedPods = allPods.filter((pod: any) => customerSet.has(pod.metadata?.namespace)).length

      const status = healthyNodes === totalNodes ? 'healthy' :
                   healthyNodes > totalNodes * 0.5 ? 'warning' : 'unhealthy'

      return {
        status,
        healthyNodes,
        totalNodes,
        nodes: nodeMetrics,
        totalPods: allPods.length,
        totalNamespaces: allNamespaces.length,
        customerManagedNamespaces,
        customerManagedPods,
        avgCpuPercent,
        avgMemoryPercent,
        velero,
        // Kept for the AI assistant and analysis, which read the latest backup
        latestBackup: velero?.lastBackup
          ? {
              name: velero.lastBackup.name,
              phase: velero.lastBackup.phase,
              startTimestamp: velero.lastBackup.startTimestamp,
              completionTimestamp: velero.lastBackup.completionTimestamp,
              errors: velero.lastBackup.errors,
              warnings: velero.lastBackup.warnings,
            }
          : null,
        kubernetesVersion: versions.kubernetesVersion,
        talosVersion: versions.talosVersion,
        cni,
        storageDrivers,
        ingressControllers,
        openebsStorage,
        podErrors,
        podResourceWarnings,
        certificateWarnings,
        // Split into errors (not ready) and warnings (ready)
        cordonedNodeWarnings: cordonedNodes.filter(node => node.isReady),
        cordonedNodeErrors: cordonedNodes.filter(node => !node.isReady),
        lastChecked: new Date()
      } as Partial<ClusterHealth>
    } catch (error) {
      console.error('Error getting cluster health:', error)
      return {
        status: 'unknown',
        healthyNodes: 0,
        totalNodes: 0,
        nodes: [],
        lastChecked: new Date()
      }
    }
  }

  private isControlPlaneNode(node: any): boolean {
    // Check for common control plane labels and taints
    const labels = node.metadata?.labels || {}
    const taints = node.spec?.taints || []

    // Check for control plane labels
    if ('node-role.kubernetes.io/control-plane' in labels || 
        'node-role.kubernetes.io/master' in labels ||
        labels['kubernetes.io/role'] === 'master' ||
        labels['kubernetes.io/hostname']?.includes('master') ||
        labels['node.kubernetes.io/instance-type']?.includes('master')) {
      return true
    }

    // Check for control plane taints
    const hasControlPlaneTaint = taints.some((taint: any) => 
      taint.key === 'node-role.kubernetes.io/control-plane' ||
      taint.key === 'node-role.kubernetes.io/master' ||
      taint.key === 'node.kubernetes.io/master'
    )

    // Check node name patterns
    const nodeName = node.metadata?.name || ''
    if (nodeName.includes('master') || nodeName.includes('control')) {
      return true
    }

    return hasControlPlaneTaint
  }

  async getPodErrors(): Promise<any[]> {
    try {
      const podErrors: any[] = []
      
      // Get all pods
      const podsResponse = await this.listAllPods()
      const pods = podsResponse.body.items
      
      for (const pod of pods) {
        const podName = pod.metadata?.name
        const namespace = pod.metadata?.namespace
        const phase = pod.status?.phase
        
        if (!podName || !namespace) continue
        
        // Check for error states
        if (phase === 'Failed' || phase === 'Pending') {
          // For failed pods, get the reason
          let reason = 'Unknown'
          if (pod.status?.reason) {
            reason = pod.status.reason
          } else if (pod.status?.containerStatuses) {
            // Check container states for more specific error info
            for (const containerStatus of pod.status.containerStatuses) {
              if (containerStatus.state?.waiting?.reason) {
                reason = containerStatus.state.waiting.reason
                break
              } else if (containerStatus.state?.terminated?.reason) {
                reason = containerStatus.state.terminated.reason
                break
              }
            }
          }
          
          podErrors.push({
            name: podName,
            namespace: namespace,
            phase: phase,
            reason: reason
          })
        } else if (phase === 'Running') {
          // For running pods, check if any containers are in error states
          if (pod.status?.containerStatuses) {
            for (const containerStatus of pod.status.containerStatuses) {
              if (!containerStatus.ready && 
                  (containerStatus.state?.waiting || containerStatus.state?.terminated)) {
                let reason = 'ContainerNotReady'
                if (containerStatus.state?.waiting?.reason) {
                  reason = containerStatus.state.waiting.reason
                } else if (containerStatus.state?.terminated?.reason) {
                  reason = containerStatus.state.terminated.reason
                }
                
                podErrors.push({
                  name: podName,
                  namespace: namespace,
                  phase: phase,
                  reason: reason
                })
                break // Only add the pod once even if multiple containers have issues
              }
            }
          }
        }
      }
      
      return podErrors
    } catch (error) {
      console.error('Error getting pod errors:', error)
      return []
    }
  }

  async getCertificateExpirations(): Promise<any[]> {
    try {
      // Use the comprehensive certificate discovery
      const allCertificates = await this.getAllCertificates()

      const isPostgresTlsSecret = (cert: any): boolean => {
        const certName = (cert?.name || '').toLowerCase()
        const certField = (cert?.certField || '').toLowerCase()
        const isCnpgSecret = certName.startsWith('cnpg') || certName.startsWith('cnpg-')
        const hasPostgresInName = certName.includes('postgres')
        const looksLikeCertificate =
          certField === 'tls.crt' ||
          certField === 'ca.crt' ||
          certField === 'cert.crt' ||
          certField === 'cert.pem' ||
          certField === 'tls.pem' ||
          certField === 'certificate' ||
          certName.endsWith('/tls.crt') ||
          certName.endsWith('/ca.crt') ||
          certName.endsWith('/cert.crt') ||
          certName.endsWith('/cert.pem') ||
          certName.endsWith('/tls.pem') ||
          certName.endsWith('/certificate')

        return (isCnpgSecret || hasPostgresInName) && looksLikeCertificate
      }
      
      // Filter certificates with custom thresholds:
      // - postgres TLS secrets: warning <= 6 days, error <= 3 days
      // - all other certificates: warning <= 30 days, error <= 10 days
      const validCertificates = allCertificates.filter(cert => 
        cert.daysUntilExpiry !== null && 
        cert.daysUntilExpiry >= 0 &&
        (
          (isPostgresTlsSecret(cert) && cert.daysUntilExpiry <= 6) ||
          (!isPostgresTlsSecret(cert) && cert.daysUntilExpiry <= 30)
        )
      )
      
      // Sort by days until expiry (earliest first) and return all within 30 days
      const certificateWarnings = validCertificates
        .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
        .map(cert => {
          const postgresTlsSecret = isPostgresTlsSecret(cert)
          const severity = postgresTlsSecret
            ? (cert.daysUntilExpiry <= 3 ? 'error' : 'warning')
            : (cert.daysUntilExpiry <= 10 ? 'error' : 'warning')

          return {
            name: cert.name,
            namespace: cert.namespace,
            expiresAt: cert.expiresAt,
            daysUntilExpiry: cert.daysUntilExpiry,
            category: cert.category,
            status: cert.status,
            severity
          }
        })
      
      return certificateWarnings
        
    } catch (error) {
      console.error('Error getting certificate expirations:', error)
      return []
    }
  }

  async getCordonedNodes(): Promise<any[]> {
    try {
      const nodesResponse = await this.listAllNodes()
      const cordonedNodes: any[] = []
      
      for (const node of nodesResponse.body.items) {
        // Check if node is cordoned (unschedulable)
        if (node.spec?.unschedulable === true) {
          // Check if node is ready
          const readyCondition = node.status?.conditions?.find(
            (condition: any) => condition.type === 'Ready'
          )
          const isReady = readyCondition?.status === 'True'
          
          // Get cordon timestamp from annotations or use creation time as fallback
          const cordonedSince = node.metadata?.annotations?.['node.alpha.kubernetes.io/ttl'] ||
                               node.metadata?.annotations?.['scheduler.alpha.kubernetes.io/critical-pod'] ||
                               node.metadata?.creationTimestamp || 
                               new Date().toISOString()
          
          cordonedNodes.push({
            name: node.metadata?.name || 'unknown',
            reason: 'Node cordoned - not scheduling new pods',
            cordonedSince: cordonedSince,
            isReady: isReady
          })
        }
      }
      
      return cordonedNodes
        
    } catch (error) {
      console.error('Error getting cordoned nodes:', error)
      return []
    }
  }

  async getAllCertificates(): Promise<any[]> {
    try {
      const certificates: any[] = []
      
      // Get all secrets across all namespaces
      const secretsResponse = await this.k8sApi.listSecretForAllNamespaces()
      const secrets: any[] = secretsResponse.body.items || []
      
      // Filter for TLS secrets and other certificate-containing secrets
      const certificateSecrets = secrets.filter(secret => 
        secret.type === 'kubernetes.io/tls' || 
        secret.type === 'Opaque' ||
        secret.type === 'kubernetes.io/service-account-token' ||
        (secret.data && (
          secret.data['tls.crt'] || 
          secret.data['ca.crt'] || 
          secret.data['cert.pem'] || 
          secret.data['server.crt'] ||
          secret.data['client.crt'] ||
          secret.data['etcd-ca'] ||
          secret.data['etcd-cert'] ||
          secret.data['kubelet-cert'] ||
          secret.data['apiserver-cert']
        ))
      )
      
      for (const secret of certificateSecrets) {
        const secretName = secret.metadata?.name
        const namespace = secret.metadata?.namespace
        const createdAt = secret.metadata?.creationTimestamp
        
        if (!secretName || !namespace || !secret.data) continue
        
      // Check for various certificate fields in the secret
        const certFields = [
          'tls.crt',
          'ca.crt', 
          'cert.pem',
          'server.crt',
          'client.crt',
          'user.crt',
          'admin.crt',
          'etcd-ca',
          'etcd-cert',
          'kubelet-cert',
          'apiserver-cert',
          'front-proxy-ca',
          'front-proxy-client',
          'sa.pub',
          'token',
          'certificate'
        ]
        
        for (const field of certFields) {
          if (secret.data[field]) {
            try {
              // Decode the certificate from base64
              const certData = Buffer.from(secret.data[field], 'base64').toString('utf8')
              
              // Skip if it's not a certificate (might be a key or other data)
              if (!certData.includes('-----BEGIN CERTIFICATE-----')) {
                continue
              }
              
              // Extract certificate expiration date using basic parsing
              const notAfterMatch = certData.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
              
              if (notAfterMatch) {
                const cert = notAfterMatch[0]
                
                // Use Node.js crypto to parse the certificate
                const crypto = require('crypto')
                try {
                  const x509 = new crypto.X509Certificate(cert)
                  const validFrom = new Date(x509.validFrom)
                  const validTo = new Date(x509.validTo)
                  const now = new Date()
                  const daysUntilExpiry = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                  
                  // Determine status based on expiry
                  let status = 'valid'
                  if (daysUntilExpiry < 0) {
                    status = 'expired'
                  } else if (daysUntilExpiry <= 10) {
                    status = 'critical'
                  } else if (daysUntilExpiry <= 30) {
                    status = 'warning'
                  }
                  
                  // Determine certificate category/source
                  let category = 'Application'
                  if (namespace === 'kube-system' || namespace === 'kube-public' || namespace === 'kube-node-lease') {
                    category = 'Kubernetes System'
                  } else if (secretName.includes('talos') || secretName.includes('etcd') || field.includes('etcd')) {
                    category = 'Talos/ETCD'
                  } else if (secretName.includes('apiserver') || secretName.includes('kubelet') || field.includes('apiserver') || field.includes('kubelet')) {
                    category = 'Kubernetes API'
                  } else if (secretName.includes('auth') || secretName.includes('token') || secretName.includes('oauth') || secretName.includes('oidc')) {
                    category = 'Authentication'
                  } else if (secretName.includes('ca') || field.includes('ca')) {
                    category = 'Certificate Authority'
                  }
                  
                  certificates.push({
                    name: field === 'tls.crt' ? secretName : `${secretName}/${field}`,
                    namespace: namespace,
                    type: secret.type || 'kubernetes.io/tls',
                    category: category,
                    issuer: x509.issuer || 'Unknown',
                    subject: x509.subject || 'Unknown',
                    serialNumber: x509.serialNumber || 'Unknown',
                    validFrom: validFrom.toISOString(),
                    validTo: validTo.toISOString(),
                    expiresAt: validTo.toISOString(),
                    daysUntilExpiry: daysUntilExpiry,
                    status: status,
                    createdAt: createdAt || null,
                    fingerprint: x509.fingerprint || 'Unknown',
                    certField: field
                  })
                } catch (certError) {
                  console.warn(`Failed to parse certificate ${secretName}/${field} in ${namespace}:`, certError)
                  // Still add the certificate with basic info
                  certificates.push({
                    name: field === 'tls.crt' ? secretName : `${secretName}/${field}`,
                    namespace: namespace,
                    type: secret.type || 'kubernetes.io/tls',
                    category: 'Unknown',
                    issuer: 'Parse Error',
                    subject: 'Parse Error',
                    serialNumber: 'Unknown',
                    validFrom: null,
                    validTo: null,
                    expiresAt: null,
                    daysUntilExpiry: null,
                    status: 'unknown',
                    createdAt: createdAt || null,
                    fingerprint: 'Unknown',
                    certField: field
                  })
                }
              }
            } catch (error) {
              console.warn(`Error processing certificate ${secretName}/${field} in ${namespace}:`, error)
            }
          }
        }
      }
      
      // Also try to get Talos certificates via configmaps and other sources
      try {
        const configMapsResponse = await this.k8sApi.listConfigMapForAllNamespaces()
        const configMaps = configMapsResponse.body.items
        
        for (const configMap of configMaps) {
          const configMapName = configMap.metadata?.name
          const namespace = configMap.metadata?.namespace
          
          if (!configMapName || !namespace || !configMap.data) continue
          
          // Look for certificate data in configmaps (common for CA certificates)
          for (const [key, value] of Object.entries(configMap.data)) {
            if (typeof value === 'string' && value.includes('-----BEGIN CERTIFICATE-----')) {
              try {
                const notAfterMatch = value.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
                
                if (notAfterMatch) {
                  const cert = notAfterMatch[0]
                  const crypto = require('crypto')
                  
                  try {
                    const x509 = new crypto.X509Certificate(cert)
                    const validFrom = new Date(x509.validFrom)
                    const validTo = new Date(x509.validTo)
                    const now = new Date()
                    const daysUntilExpiry = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                    
                    let status = 'valid'
                    if (daysUntilExpiry < 0) {
                      status = 'expired'
                    } else if (daysUntilExpiry <= 10) {
                      status = 'critical'
                    } else if (daysUntilExpiry <= 30) {
                      status = 'warning'
                    }
                    
                    let category = 'Certificate Authority'
                    if (namespace === 'kube-system') {
                      category = 'Kubernetes System'
                    }
                    
                    certificates.push({
                      name: `${configMapName}/${key}`,
                      namespace: namespace,
                      type: 'ConfigMap',
                      category: category,
                      issuer: x509.issuer || 'Unknown',
                      subject: x509.subject || 'Unknown',
                      serialNumber: x509.serialNumber || 'Unknown',
                      validFrom: validFrom.toISOString(),
                      validTo: validTo.toISOString(),
                      expiresAt: validTo.toISOString(),
                      daysUntilExpiry: daysUntilExpiry,
                      status: status,
                      createdAt: configMap.metadata?.creationTimestamp || null,
                      fingerprint: x509.fingerprint || 'Unknown',
                      certField: key
                    })
                  } catch (certError) {
                    console.warn(`Failed to parse certificate ${configMapName}/${key} in ${namespace}:`, certError)
                  }
                }
              } catch (error) {
                console.warn(`Error processing configmap certificate ${configMapName}/${key} in ${namespace}:`, error)
              }
            }
          }
        }
      } catch (error) {
        console.warn('Error getting certificates from configmaps:', error)
      }
      
      // Get CertificateSigningRequests (CSRs) for user certificates
      try {
        const csrApi = this.makeWrappedApiClient(k8s.CertificatesV1Api)
        const csrResponse = await csrApi.listCertificateSigningRequest()
        const csrs = csrResponse.body.items
        
        for (const csr of csrs) {
          const csrName = csr.metadata?.name
          const createdAt = csr.metadata?.creationTimestamp
          
          if (!csrName || !csr.status?.certificate) continue
          
          try {
            // Decode the certificate from base64
            const certData = Buffer.from(csr.status.certificate, 'base64').toString('utf8')
            
            if (certData.includes('-----BEGIN CERTIFICATE-----')) {
              const notAfterMatch = certData.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
              
              if (notAfterMatch) {
                const cert = notAfterMatch[0]
                const crypto = require('crypto')
                
                try {
                  const x509 = new crypto.X509Certificate(cert)
                  const validFrom = new Date(x509.validFrom)
                  const validTo = new Date(x509.validTo)
                  const now = new Date()
                  const daysUntilExpiry = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                  
                  let status = 'valid'
                  if (daysUntilExpiry < 0) {
                    status = 'expired'
                  } else if (daysUntilExpiry <= 10) {
                    status = 'critical'
                  } else if (daysUntilExpiry <= 30) {
                    status = 'warning'
                  }
                  
                  // CSRs are typically user certificates
                  let category = 'Authentication'
                  if (csrName.includes('kubelet') || csrName.includes('system:node:')) {
                    category = 'Kubernetes System'
                  } else if (csrName.includes('admin') || csrName.includes('system:admin')) {
                    category = 'Authentication'
                  }
                  
                  certificates.push({
                    name: `csr/${csrName}`,
                    namespace: 'cluster-wide',
                    type: 'CertificateSigningRequest',
                    category: category,
                    issuer: x509.issuer || 'Unknown',
                    subject: x509.subject || 'Unknown',
                    serialNumber: x509.serialNumber || 'Unknown',
                    validFrom: validFrom.toISOString(),
                    validTo: validTo.toISOString(),
                    expiresAt: validTo.toISOString(),
                    daysUntilExpiry: daysUntilExpiry,
                    status: status,
                    createdAt: createdAt || null,
                    fingerprint: x509.fingerprint || 'Unknown',
                    certField: 'certificate'
                  })
                } catch (certError) {
                  console.warn(`Failed to parse CSR certificate ${csrName}:`, certError)
                }
              }
            }
          } catch (error) {
            console.warn(`Error processing CSR ${csrName}:`, error)
          }
        }
      } catch (error) {
        console.warn('Error getting certificates from CSRs:', error)
      }
      
      // Get ServiceAccount tokens and look for embedded certificates
      try {
        const serviceAccountsResponse = await this.k8sApi.listServiceAccountForAllNamespaces()
        const serviceAccounts = serviceAccountsResponse.body.items
        
        for (const sa of serviceAccounts) {
          const saName = sa.metadata?.name
          const namespace = sa.metadata?.namespace
          
          if (!saName || !namespace || !sa.secrets) continue
          
          // Check each secret associated with the service account
          for (const secretRef of sa.secrets) {
            if (!secretRef.name) continue
            
            try {
              const tokenSecretResponse = await this.k8sApi.readNamespacedSecret(secretRef.name, namespace)
              const tokenSecret = tokenSecretResponse.body
              
              if (tokenSecret.data && tokenSecret.data['ca.crt']) {
                try {
                  const certData = Buffer.from(tokenSecret.data['ca.crt'], 'base64').toString('utf8')
                  
                  if (certData.includes('-----BEGIN CERTIFICATE-----')) {
                    const notAfterMatch = certData.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
                    
                    if (notAfterMatch) {
                      const cert = notAfterMatch[0]
                      const crypto = require('crypto')
                      
                      try {
                        const x509 = new crypto.X509Certificate(cert)
                        const validFrom = new Date(x509.validFrom)
                        const validTo = new Date(x509.validTo)
                        const now = new Date()
                        const daysUntilExpiry = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                        
                        let status = 'valid'
                        if (daysUntilExpiry < 0) {
                          status = 'expired'
                        } else if (daysUntilExpiry <= 10) {
                          status = 'critical'
                        } else if (daysUntilExpiry <= 30) {
                          status = 'warning'
                        }
                        
                        certificates.push({
                          name: `sa-token/${saName}`,
                          namespace: namespace,
                          type: 'ServiceAccount',
                          category: 'Authentication',
                          issuer: x509.issuer || 'Unknown',
                          subject: x509.subject || 'Unknown',
                          serialNumber: x509.serialNumber || 'Unknown',
                          validFrom: validFrom.toISOString(),
                          validTo: validTo.toISOString(),
                          expiresAt: validTo.toISOString(),
                          daysUntilExpiry: daysUntilExpiry,
                          status: status,
                          createdAt: tokenSecret.metadata?.creationTimestamp || null,
                          fingerprint: x509.fingerprint || 'Unknown',
                          certField: 'ca.crt'
                        })
                      } catch (certError) {
                        console.warn(`Failed to parse SA token certificate ${saName} in ${namespace}:`, certError)
                      }
                    }
                  }
                } catch (error) {
                  console.warn(`Error processing SA token certificate ${saName} in ${namespace}:`, error)
                }
              }
            } catch (error) {
              // Ignore individual secret access errors (might be deleted or inaccessible)
            }
          }
        }
      } catch (error) {
        console.warn('Error getting certificates from service account tokens:', error)
      }
      
      // Check for OIDC/OAuth provider certificates in known locations
      try {
        const oidcNamespaces = ['kube-system', 'oauth-system', 'auth', 'keycloak', 'dex', 'gangway']
        
        for (const ns of oidcNamespaces) {
          try {
            const namespacedSecretsResponse = await this.k8sApi.listNamespacedSecret(ns)
            const namespacedSecrets: any[] = namespacedSecretsResponse.body.items || []
            
            const authSecrets = namespacedSecrets.filter(secret => 
              secret.metadata?.name?.includes('oauth') ||
              secret.metadata?.name?.includes('oidc') ||
              secret.metadata?.name?.includes('auth') ||
              secret.metadata?.name?.includes('keycloak') ||
              secret.metadata?.name?.includes('dex') ||
              secret.metadata?.name?.includes('gangway') ||
              secret.metadata?.name?.includes('ldap')
            )
            
            for (const secret of authSecrets) {
              if (!secret.data) continue
              
              const authCertFields = ['tls.crt', 'ca.crt', 'cert.pem', 'certificate']
              
              for (const field of authCertFields) {
                if (secret.data[field]) {
                  try {
                    const certData = Buffer.from(secret.data[field], 'base64').toString('utf8')
                    
                    if (certData.includes('-----BEGIN CERTIFICATE-----')) {
                      const notAfterMatch = certData.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
                      
                      if (notAfterMatch) {
                        const cert = notAfterMatch[0]
                        const crypto = require('crypto')
                        
                        try {
                          const x509 = new crypto.X509Certificate(cert)
                          const validFrom = new Date(x509.validFrom)
                          const validTo = new Date(x509.validTo)
                          const now = new Date()
                          const daysUntilExpiry = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                          
                          let status = 'valid'
                          if (daysUntilExpiry < 0) {
                            status = 'expired'
                          } else if (daysUntilExpiry <= 10) {
                            status = 'critical'
                          } else if (daysUntilExpiry <= 30) {
                            status = 'warning'
                          }
                          
                          certificates.push({
                            name: `${secret.metadata?.name}/${field}`,
                            namespace: ns,
                            type: secret.type || 'Opaque',
                            category: 'Authentication',
                            issuer: x509.issuer || 'Unknown',
                            subject: x509.subject || 'Unknown',
                            serialNumber: x509.serialNumber || 'Unknown',
                            validFrom: validFrom.toISOString(),
                            validTo: validTo.toISOString(),
                            expiresAt: validTo.toISOString(),
                            daysUntilExpiry: daysUntilExpiry,
                            status: status,
                            createdAt: secret.metadata?.creationTimestamp || null,
                            fingerprint: x509.fingerprint || 'Unknown',
                            certField: field
                          })
                        } catch (certError) {
                          console.warn(`Failed to parse auth certificate ${secret.metadata?.name}/${field} in ${ns}:`, certError)
                        }
                      }
                    }
                  } catch (error) {
                    console.warn(`Error processing auth certificate ${secret.metadata?.name}/${field} in ${ns}:`, error)
                  }
                }
              }
            }
          } catch (error) {
            // Ignore namespace errors (might not exist)
          }
        }
      } catch (error) {
        console.warn('Error getting OIDC/OAuth certificates:', error)
      }
      
      // Extract certificates from the kubeconfig used to connect to this cluster
      try {
        if (this.kubeconfigContent) {
          const yaml = require('yaml')
          const kubeconfig = yaml.parse(this.kubeconfigContent)
          
          // Check for embedded client certificates
          if (kubeconfig.users) {
            for (const user of kubeconfig.users) {
              const userName = user.name
              const userData = user.user
              
              if (!userData) continue
              
              // Check for client-certificate-data (base64 encoded)
              if (userData['client-certificate-data']) {
                try {
                  const certData = Buffer.from(userData['client-certificate-data'], 'base64').toString('utf8')
                  
                  if (certData.includes('-----BEGIN CERTIFICATE-----')) {
                    const notAfterMatch = certData.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
                    
                    if (notAfterMatch) {
                      const cert = notAfterMatch[0]
                      const crypto = require('crypto')
                      
                      try {
                        const x509 = new crypto.X509Certificate(cert)
                        const validFrom = new Date(x509.validFrom)
                        const validTo = new Date(x509.validTo)
                        const now = new Date()
                        const daysUntilExpiry = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                        
                        let status = 'valid'
                        if (daysUntilExpiry < 0) {
                          status = 'expired'
                        } else if (daysUntilExpiry <= 10) {
                          status = 'critical'
                        } else if (daysUntilExpiry <= 30) {
                          status = 'warning'
                        }
                        
                        certificates.push({
                          name: `kubeconfig/${userName}`,
                          namespace: 'kubeconfig',
                          type: 'Kubeconfig Client Certificate',
                          category: 'Authentication',
                          issuer: x509.issuer || 'Unknown',
                          subject: x509.subject || 'Unknown',
                          serialNumber: x509.serialNumber || 'Unknown',
                          validFrom: validFrom.toISOString(),
                          validTo: validTo.toISOString(),
                          expiresAt: validTo.toISOString(),
                          daysUntilExpiry: daysUntilExpiry,
                          status: status,
                          createdAt: null,
                          fingerprint: x509.fingerprint || 'Unknown',
                          certField: 'client-certificate-data'
                        })
                      } catch (certError) {
                        console.warn(`Failed to parse kubeconfig client certificate for user ${userName}:`, certError)
                      }
                    }
                  }
                } catch (error) {
                  console.warn(`Error processing kubeconfig client certificate for user ${userName}:`, error)
                }
              }
            }
          }
          
          // Check for cluster CA certificates
          if (kubeconfig.clusters) {
            for (const cluster of kubeconfig.clusters) {
              const clusterName = cluster.name
              const clusterData = cluster.cluster
              
              if (!clusterData) continue
              
              // Check for certificate-authority-data (base64 encoded)
              if (clusterData['certificate-authority-data']) {
                try {
                  const certData = Buffer.from(clusterData['certificate-authority-data'], 'base64').toString('utf8')
                  
                  if (certData.includes('-----BEGIN CERTIFICATE-----')) {
                    const notAfterMatch = certData.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
                    
                    if (notAfterMatch) {
                      const cert = notAfterMatch[0]
                      const crypto = require('crypto')
                      
                      try {
                        const x509 = new crypto.X509Certificate(cert)
                        const validFrom = new Date(x509.validFrom)
                        const validTo = new Date(x509.validTo)
                        const now = new Date()
                        const daysUntilExpiry = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                        
                        let status = 'valid'
                        if (daysUntilExpiry < 0) {
                          status = 'expired'
                        } else if (daysUntilExpiry <= 10) {
                          status = 'critical'
                        } else if (daysUntilExpiry <= 30) {
                          status = 'warning'
                        }
                        
                        certificates.push({
                          name: `kubeconfig/${clusterName}-ca`,
                          namespace: 'kubeconfig',
                          type: 'Kubeconfig CA Certificate',
                          category: 'Certificate Authority',
                          issuer: x509.issuer || 'Unknown',
                          subject: x509.subject || 'Unknown',
                          serialNumber: x509.serialNumber || 'Unknown',
                          validFrom: validFrom.toISOString(),
                          validTo: validTo.toISOString(),
                          expiresAt: validTo.toISOString(),
                          daysUntilExpiry: daysUntilExpiry,
                          status: status,
                          createdAt: null,
                          fingerprint: x509.fingerprint || 'Unknown',
                          certField: 'certificate-authority-data'
                        })
                      } catch (certError) {
                        console.warn(`Failed to parse kubeconfig CA certificate for cluster ${clusterName}:`, certError)
                      }
                    }
                  }
                } catch (error) {
                  console.warn(`Error processing kubeconfig CA certificate for cluster ${clusterName}:`, error)
                }
              }
            }
          }
        }
      } catch (error) {
        console.warn('Error getting certificates from kubeconfig:', error)
      }
      
      // Get cert-manager Certificate custom resources
      try {
        const customObjectsApi = this.makeWrappedApiClient(k8s.CustomObjectsApi)
        
        // Try to list Certificate resources from cert-manager
        try {
          const certManagerCerts: any = await customObjectsApi.listClusterCustomObject(
            'cert-manager.io',
            'v1',
            'certificates'
          )
          
          if (certManagerCerts && certManagerCerts.body && certManagerCerts.body.items) {
            for (const certResource of certManagerCerts.body.items) {
              const certName = certResource.metadata?.name
              const namespace = certResource.metadata?.namespace
              const createdAt = certResource.metadata?.creationTimestamp
              
              if (!certName || !namespace) continue
              
              // Get certificate status from cert-manager Certificate resource
              const spec = certResource.spec
              const status = certResource.status
              
              // Check if spec exists and has secretName
              if (!spec || !spec.secretName) continue
              
              // Try to get the actual certificate from the secret
              if (status && status.conditions) {
                const readyCondition = status.conditions.find((c: any) => c.type === 'Ready')
                
                if (readyCondition && readyCondition.status === 'True') {
                  try {
                    const secretResponse = await this.k8sApi.readNamespacedSecret(spec.secretName, namespace)
                    const secret = secretResponse.body
                    
                    if (secret.data && secret.data['tls.crt']) {
                      const certData = Buffer.from(secret.data['tls.crt'], 'base64').toString('utf8')
                      
                      if (certData.includes('-----BEGIN CERTIFICATE-----')) {
                        const notAfterMatch = certData.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)
                        
                        if (notAfterMatch) {
                          const cert = notAfterMatch[0]
                          const crypto = require('crypto')
                          
                          try {
                            const x509 = new crypto.X509Certificate(cert)
                            const validFrom = new Date(x509.validFrom)
                            const validTo = new Date(x509.validTo)
                            const now = new Date()
                            const daysUntilExpiry = Math.ceil((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                            
                            let certStatus = 'valid'
                            if (daysUntilExpiry < 0) {
                              certStatus = 'expired'
                            } else if (daysUntilExpiry <= 10) {
                              certStatus = 'critical'
                            } else if (daysUntilExpiry <= 30) {
                              certStatus = 'warning'
                            }
                            
                            // Determine category based on certificate usage
                            let category = 'Application'
                            if (spec.usages && spec.usages.includes('client auth')) {
                              category = 'User Certificate'
                            } else if (spec.usages && spec.usages.includes('server auth')) {
                              category = 'Application'
                            }
                            
                            // Check if it's an ingress certificate
                            if (spec.dnsNames || spec.commonName) {
                              category = 'Ingress/TLS'
                            }
                            
                            certificates.push({
                              name: `cert-manager/${certName}`,
                              namespace: namespace,
                              type: 'cert-manager Certificate',
                              category: category,
                              issuer: x509.issuer || spec.issuerRef?.name || 'Unknown',
                              subject: x509.subject || spec.commonName || 'Unknown',
                              serialNumber: x509.serialNumber || 'Unknown',
                              validFrom: validFrom.toISOString(),
                              validTo: validTo.toISOString(),
                              expiresAt: validTo.toISOString(),
                              daysUntilExpiry: daysUntilExpiry,
                              status: certStatus,
                              createdAt: createdAt || null,
                              fingerprint: x509.fingerprint || 'Unknown',
                              certField: 'tls.crt',
                              dnsNames: spec.dnsNames || [],
                              commonName: spec.commonName || null,
                              issuerName: spec.issuerRef?.name || 'Unknown',
                              issuerKind: spec.issuerRef?.kind || 'Unknown'
                            })
                          } catch (certError) {
                            console.warn(`Failed to parse cert-manager certificate ${certName} in ${namespace}:`, certError)
                          }
                        }
                      }
                    }
                  } catch (secretError) {
                    console.warn(`Failed to read secret for cert-manager certificate ${certName} in ${namespace}:`, secretError)
                  }
                }
              }
            }
          }
        } catch (certManagerError) {
          // cert-manager might not be installed - this is expected, don't log as error
          console.debug('cert-manager not found or certificates could not be listed')
        }
      } catch (error) {
        console.warn('Error getting certificates from cert-manager:', error)
      }
      
      // Remove duplicates based on fingerprint and sort by expiry date (earliest expiring first)
      const uniqueCertificates = certificates.filter((cert, index, self) => 
        index === self.findIndex(c => c.fingerprint === cert.fingerprint && c.name === cert.name)
      )
      
      return uniqueCertificates.sort((a, b) => {
        if (a.daysUntilExpiry === null) return 1
        if (b.daysUntilExpiry === null) return -1
        return a.daysUntilExpiry - b.daysUntilExpiry
      })
        
    } catch (error) {
      console.error('Error getting all certificates:', error)
      return []
    }
  }

  async getPodResourceWarnings(): Promise<any[]> {
    try {
      const podWarnings: any[] = []
      
      // Get all pods
      const podsResponse = await this.listAllPods()
      const pods: any[] = (podsResponse.body.items || []).filter((pod: any) => 
        pod.status?.phase === 'Running' // Only check running pods
      )

      // Get pod metrics
      let podMetrics: any[] = []
      try {
        const metricsResponse = await this.metricsApi.getPodMetrics()
        podMetrics = metricsResponse.items
      } catch (error) {
        console.warn('Failed to fetch pod metrics for resource warnings:', error)
        return [] // Return empty array if metrics are not available
      }

      for (const pod of pods) {
        const podName = pod.metadata?.name
        const namespace = pod.metadata?.namespace
        
        if (!podName || !namespace) continue

        // Find matching metrics for this pod
        const podMetric = podMetrics.find(metric => 
          metric.metadata?.name === podName && 
          metric.metadata?.namespace === namespace
        )

        if (!podMetric || !podMetric.containers) continue

        // Check each container in the pod
        for (const container of pod.spec?.containers || []) {
          const containerName = container.name
          const containerMetric = podMetric.containers.find((cm: any) => cm.name === containerName)
          
          if (!containerMetric) continue

          // Get resource requests/limits for comparison
          const requests = container.resources?.requests || {}
          const limits = container.resources?.limits || {}
          
          // Prioritize limits over requests - only use limits for comparison
          const cpuLimit = limits.cpu
          const memoryLimit = limits.memory
          
          // Skip containers that don't have resource limits defined
          if (!cpuLimit && !memoryLimit) continue

          let cpuPercent = 0
          let memoryPercent = 0
          
          // Calculate CPU percentage against limits only
          if (cpuLimit && containerMetric.usage?.cpu) {
            const cpuUsage = this.parseResource(containerMetric.usage.cpu)
            const cpuLimitValue = this.parseResource(cpuLimit)
            if (cpuLimitValue > 0) {
              cpuPercent = (cpuUsage / cpuLimitValue) * 100
            }
          }

          // Calculate memory percentage against limits only
          if (memoryLimit && containerMetric.usage?.memory) {
            const memoryUsage = this.parseResource(containerMetric.usage.memory)
            const memoryLimitValue = this.parseResource(memoryLimit)
            if (memoryLimitValue > 0) {
              memoryPercent = (memoryUsage / memoryLimitValue) * 100
            }
          }

          // Check if either CPU or memory exceeds 90% of their LIMITS
          if (cpuPercent >= 90 || memoryPercent >= 90) {
            podWarnings.push({
              name: podName,
              namespace: namespace,
              cpuPercent: cpuPercent >= 90 ? cpuPercent : undefined,
              memoryPercent: memoryPercent >= 90 ? memoryPercent : undefined,
              cpuUsage: containerMetric.usage?.cpu,
              cpuCapacity: cpuLimit,
              memoryUsage: containerMetric.usage?.memory,
              memoryCapacity: memoryLimit
            })
            break // Only add the pod once, even if multiple containers exceed limits
          }
        }
      }

      return podWarnings
    } catch (error) {
      console.error('Error getting pod resource warnings:', error)
      return []
    }
  }

  private parseResource(resource: string): number {
    // Kubernetes quantity ("250m", "24081u", "512Mi", "1G") in cores or bytes
    const value = parseQuantity(resource)
    return Number.isFinite(value) ? value : 0
  }


  private async getTalosVersionFromAPI(talosConfig: any): Promise<string | null> {
    // In a real implementation, you would use the Talos API client
    // For now, we'll try to extract meaningful information from the config
    try {
      // Check if there's a machine config with version info
      if (talosConfig.machine?.talos?.version) {
        return talosConfig.machine.talos.version
      }
      
      // Check contexts for version hints
      if (talosConfig.contexts) {
        for (const contextName of Object.keys(talosConfig.contexts)) {
          const versionMatch = contextName.match(/v?(\d+\.\d+\.\d+)/)
          if (versionMatch) {
            return `v${versionMatch[1]}`
          }
        }
      }
      
      return null
    } catch (error) {
      console.warn('Error extracting Talos version from config:', error)
      return null
    }
  }

  private async getTalosVersionFromNodes(nodes: any[]): Promise<string> {
    try {
      if (nodes.length === 0) return 'Unknown'
      
      const firstNode = nodes[0]
      const nodeInfo = firstNode.status?.nodeInfo
      
      if (nodeInfo) {
        // Try to extract Talos version from kernel version or OS image
        const kernelVersion = nodeInfo.kernelVersion || ''
        const osImage = nodeInfo.osImage || ''
        
        // Talos often includes version in kernel version or OS image
        const talosMatch = kernelVersion.match(/Talos.*?v?(\d+\.\d+\.\d+)/) ||
                          osImage.match(/Talos.*?v?(\d+\.\d+\.\d+)/)
        
        if (talosMatch) {
          return `v${talosMatch[1]}`
        }
        
        // Fallback: Check if it's clearly Talos
        if (kernelVersion.includes('Talos') || osImage.includes('Talos')) {
          return 'Talos (version unknown)'
        }
        
        // Check node labels for Talos-specific information
        const labels = firstNode.metadata?.labels || {}
        const annotations = firstNode.metadata?.annotations || {}
        
        // Look for Talos-specific labels or annotations
        const talosLabel = labels['talos.dev/version'] || 
                          annotations['talos.dev/version'] ||
                          labels['node.alpha.kubernetes.io/talos-version']
        
        if (talosLabel) {
          return talosLabel.startsWith('v') ? talosLabel : `v${talosLabel}`
        }
      }
      
      return 'Unknown'
    } catch (error) {
      console.warn('Error extracting Talos version from nodes:', error)
      return 'Unknown'
    }
  }

  async getPodLogs(
    namespace: string, 
    podName: string, 
    containerName?: string, 
    tailLines: number = 1000
  ): Promise<string> {
    try {
      let logs: any

      try {
        logs = await this.k8sApi.readNamespacedPodLog({
          name: podName,
          namespace,
          container: containerName,
          previous: false,
          tailLines,
          timestamps: true
        })
      } catch {
        logs = await this.k8sApi.readNamespacedPodLog(
          podName,
          namespace,
          containerName,
          undefined,
          undefined,
          undefined,
          undefined,
          false,
          undefined,
          tailLines,
          true
        )
      }

      if (typeof logs === 'string') {
        return logs
      }

      if (typeof logs?.body === 'string') {
        return logs.body
      }

      return typeof logs?.body !== 'undefined' ? String(logs.body) : String(logs ?? '')
    } catch (error) {
      console.error('Error fetching pod logs:', error)
      throw new Error(`Failed to fetch logs for pod ${podName}`)
    }
  }

  async getPodsInNamespace(namespace: string): Promise<Array<{
    name: string
    namespace: string
    phase: string
    containers: Array<{ name: string, ready: boolean }>
  }>> {
    try {
      let podsResponse: any

      try {
        podsResponse = await this.k8sApi.listNamespacedPod({ namespace })
      } catch {
        podsResponse = await this.k8sApi.listNamespacedPod(namespace)
      }

      const podList = podsResponse?.body || podsResponse
      const pods: any[] = podList?.items || []
      
      return pods.map((pod: any) => ({
        name: pod.metadata?.name || '',
        namespace: pod.metadata?.namespace || '',
        phase: pod.status?.phase || 'Unknown',
        containers: pod.spec?.containers?.map((container: any) => ({
          name: container.name,
          ready: pod.status?.containerStatuses?.find(
            (status: any) => status.name === container.name
          )?.ready || false
        })) || []
      }))
    } catch (error) {
      console.error('Error fetching pods:', error)
      throw new Error(`Failed to fetch pods in namespace ${namespace}`)
    }
  }

  async getNamespaces(): Promise<string[]> {
    try {
      const namespacesResponse = await this.k8sApi.listNamespace()
      const namespaces: any[] = namespacesResponse.body.items || []
      return namespaces
        .map((ns: any) => ns.metadata?.name || '')
        .filter((name: string) => name !== '')
        .sort()
    } catch (error) {
      console.error('Error fetching namespaces:', error)
      throw new Error('Failed to fetch namespaces')
    }
  }

  async getClusterImages(): Promise<any[]> {
    try {
      const podsResponse = await this.k8sApi.listPodForAllNamespaces()
      const pods = podsResponse.body.items
      
      const imageMap = new Map<string, {
        name: string
        displayName?: string  // Short name for UI display
        tag: string
        fullName: string
        pods: Array<{
          name: string
          namespace: string
          nodeName: string
        }>
        createdAt: string
        pullPolicy?: string
        size?: string
      }>()

      // Process all pods to extract image information
      pods.forEach((pod: any) => {
        const namespace = pod.metadata?.namespace || 'default'
        const podName = pod.metadata?.name || 'unknown'
        const nodeName = pod.spec?.nodeName || 'unscheduled'
        const createdAt = pod.metadata?.creationTimestamp || new Date().toISOString()

        // Process all containers in the pod
        const containers = [
          ...(pod.spec?.containers || []),
          ...(pod.spec?.initContainers || []),
          ...(pod.spec?.ephemeralContainers || [])
        ]

        containers.forEach((container: any) => {
          const fullImageName = container.image || 'unknown'
          const pullPolicy = container.imagePullPolicy || 'IfNotPresent'
          
          // Parse image name and tag
          let imageName = fullImageName
          let imageTag = 'latest'
          
          if (fullImageName.includes(':')) {
            const parts = fullImageName.split(':')
            imageTag = parts.pop() || 'latest'
            imageName = parts.join(':')
          }
          
          // For the name field used in API lookups:
          // - For docker.io images: remove the registry prefix (docker.io/library/nginx -> library/nginx)
          // - For other registries: keep the full path (public.ecr.aws/docker/library/redis -> public.ecr.aws/docker/library/redis)
          let nameForAPI = imageName
          if (imageName.includes('/')) {
            const parts = imageName.split('/')
            // Only remove docker.io registry prefix
            if (parts[0] === 'docker.io') {
              nameForAPI = parts.slice(1).join('/')
            }
          }
          
          // For display, use just the image name
          const displayName = imageName.split('/').pop() || imageName

          if (imageMap.has(fullImageName)) {
            const existingImage = imageMap.get(fullImageName)!
            existingImage.pods.push({
              name: podName,
              namespace,
              nodeName
            })
            // Use the earliest creation time
            if (createdAt < existingImage.createdAt) {
              existingImage.createdAt = createdAt
            }
          } else {
            imageMap.set(fullImageName, {
              name: nameForAPI,           // Full path with registry (except docker.io)
              displayName: displayName,    // Keep short name for UI display
              tag: imageTag,
              fullName: fullImageName,
              pods: [{
                name: podName,
                namespace,
                nodeName
              }],
              createdAt,
              pullPolicy
            })
          }
        })
      })

      // Convert map to array and sort by name
      return Array.from(imageMap.values())
        .map(image => ({
          ...image,
          podCount: new Set(image.pods.map(p => `${p.namespace}/${p.name}`)).size,
          namespaces: [...new Set(image.pods.map(p => p.namespace))],
          nodes: [...new Set(image.pods.map(p => p.nodeName).filter(n => n !== 'unscheduled'))]
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch (error) {
      console.error('Error fetching cluster images:', error)
      return []
    }
  }

  async detectOpenEBS(): Promise<{
    installed: boolean
    version?: string
    namespaces: string[]
    storageClasses: any[]
    volumes: any[]
    storagePools: any[]
    nodes: any[]
  }> {
    try {
      // Check for OpenEBS namespaces
      const namespaces = await this.getNamespaces()
      const openebsNamespaces = namespaces.filter(ns => 
        ns.includes('openebs') || ns === 'mayastor'
      )

      if (openebsNamespaces.length === 0) {
        return {
          installed: false,
          namespaces: [],
          storageClasses: [],
          volumes: [],
          storagePools: [],
          nodes: []
        }
      }

      // Get OpenEBS storage classes
      const storageClasses = await this.getOpenEBSStorageClasses()
      
      // Get OpenEBS volumes (PVs and PVCs)
      const volumes = await this.getOpenEBSVolumes()
      
      // Get OpenEBS storage pools
      const storagePools = await this.getOpenEBSStoragePools()
      
      // Get OpenEBS node information
      const nodes = await this.getOpenEBSNodes()

      // Try to detect OpenEBS version
      const version = await this.getOpenEBSVersion(openebsNamespaces)

      return {
        installed: true,
        version,
        namespaces: openebsNamespaces,
        storageClasses,
        volumes,
        storagePools,
        nodes
      }
    } catch (error) {
      console.error('Error detecting OpenEBS:', error)
      return {
        installed: false,
        namespaces: [],
        storageClasses: [],
        volumes: [],
        storagePools: [],
        nodes: []
      }
    }
  }

  private async getOpenEBSStorageClasses(): Promise<any[]> {
    try {
      const storageApi = this.makeWrappedApiClient(k8s.StorageV1Api)
      const response = await storageApi.listStorageClass()
      const storageClasses: any[] = response.body.items || []
      
      return storageClasses
        .filter((sc: any) => 
          sc.provisioner?.includes('openebs') || 
          sc.provisioner?.includes('mayastor') ||
          sc.metadata?.name?.includes('openebs')
        )
        .map((sc: any) => ({
          name: sc.metadata?.name || '',
          provisioner: sc.provisioner || '',
          reclaimPolicy: sc.reclaimPolicy || '',
          volumeBindingMode: sc.volumeBindingMode || '',
          allowVolumeExpansion: sc.allowVolumeExpansion || false,
          parameters: sc.parameters || {},
          annotations: sc.metadata?.annotations || {},
          labels: sc.metadata?.labels || {},
          age: this.calculateAge(sc.metadata?.creationTimestamp)
        }))
    } catch (error) {
      console.error('Error fetching OpenEBS storage classes:', error)
      return []
    }
  }

  private async getOpenEBSVolumes(): Promise<any[]> {
    try {
      // Get PersistentVolumes
      const pvResponse = await this.k8sApi.listPersistentVolume()
      const openebsPVs: any[] = (pvResponse.body.items || [])
        .filter((pv: any) => 
          pv.spec?.storageClassName?.includes('openebs') ||
          pv.spec?.csi?.driver?.includes('openebs') ||
          pv.spec?.csi?.driver?.includes('mayastor')
        )

      // Get PersistentVolumeClaims
      const pvcResponse = await this.k8sApi.listPersistentVolumeClaimForAllNamespaces()
      const openebsPVCs: any[] = (pvcResponse.body.items || [])
        .filter((pvc: any) => 
          pvc.spec?.storageClassName?.includes('openebs') ||
          openebsPVs.some((pv: any) => pv.metadata?.name === pvc.spec?.volumeName)
        )

      // Try to get pod metrics to find volume usage
      let podMetrics: any[] = []
      try {
        const metricsResponse = await this.metricsApi.getPodMetrics()
        podMetrics = metricsResponse.items
      } catch (error) {
        console.warn('Failed to fetch pod metrics for volume usage:', error)
      }

      // Get pods to map volumes to usage
      let pods: any[] = []
      try {
        const podsResponse = await this.k8sApi.listPodForAllNamespaces()
        pods = podsResponse.body.items || []
      } catch (error) {
        console.warn('Failed to fetch pods for volume mapping:', error)
      }

      // Function to calculate volume usage
      const getVolumeUsage = (pvcName: string, namespace: string, capacityBytes: number) => {
        try {
          // Method 1: Try to get usage from pod metrics if available
          const podsUsingPVC = pods.filter(pod => 
            pod.metadata?.namespace === namespace &&
            pod.spec?.volumes?.some((vol: any) => 
              vol.persistentVolumeClaim?.claimName === pvcName
            )
          )

          if (podsUsingPVC.length === 0) {
            return { used: '0B', available: this.formatBytesToStorage(capacityBytes), usedBytes: 0 }
          }

          // Method 2: Try to use kubectl-style metrics if available
          // For now, we'll provide a placeholder that shows the volume is in use
          // but we can't determine exact usage without more sophisticated monitoring
          
          // If bound and in use, estimate some usage
          if (podsUsingPVC.length > 0) {
            // Very rough estimation - assume 10% usage for active PVCs
            const estimatedUsedBytes = Math.floor(capacityBytes * 0.1)
            const estimatedAvailableBytes = capacityBytes - estimatedUsedBytes
            
            return {
              used: this.formatBytesToStorage(estimatedUsedBytes),
              available: this.formatBytesToStorage(estimatedAvailableBytes),
              usedBytes: estimatedUsedBytes
            }
          }

          return { used: '0B', available: this.formatBytesToStorage(capacityBytes), usedBytes: 0 }
        } catch (error) {
          return { used: 'Unknown', available: 'Unknown', usedBytes: 0 }
        }
      }

      const volumes = [
        ...openebsPVs.map((pv: any) => {
          const capacity = pv.spec?.capacity?.storage || ''
          const capacityBytes = this.parseStorageSizeToBytes(capacity)
          
          return {
            type: 'PersistentVolume',
            name: pv.metadata?.name || '',
            namespace: '',
            storageClass: pv.spec?.storageClassName || '',
            capacity: capacity,
            capacityBytes: capacityBytes,
            status: pv.status?.phase || '',
            reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy || '',
            accessModes: pv.spec?.accessModes || [],
            driver: pv.spec?.csi?.driver || '',
            volumeHandle: pv.spec?.csi?.volumeHandle || '',
            claimRef: pv.spec?.claimRef ? {
              name: pv.spec.claimRef.name,
              namespace: pv.spec.claimRef.namespace
            } : null,
            used: 'Unknown',
            available: 'Unknown',
            age: this.calculateAge(pv.metadata?.creationTimestamp)
          }
        }),
        ...openebsPVCs.map((pvc: any) => {
          const capacity = pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || ''
          const capacityBytes = this.parseStorageSizeToBytes(capacity)
          const usage = getVolumeUsage(pvc.metadata?.name || '', pvc.metadata?.namespace || '', capacityBytes)
          
          return {
            type: 'PersistentVolumeClaim',
            name: pvc.metadata?.name || '',
            namespace: pvc.metadata?.namespace || '',
            storageClass: pvc.spec?.storageClassName || '',
            capacity: capacity,
            capacityBytes: capacityBytes,
            status: pvc.status?.phase || '',
            volumeName: pvc.spec?.volumeName || '',
            accessModes: pvc.spec?.accessModes || [],
            used: usage.used,
            available: usage.available,
            age: this.calculateAge(pvc.metadata?.creationTimestamp)
          }
        })
      ]

      return volumes
    } catch (error) {
      console.error('Error fetching OpenEBS volumes:', error)
      return []
    }
  }

  private parseStorageSizeToBytes(size: string): number {
    if (!size) return 0
    
    // If it's a pure number (likely bytes), return as is
    if (/^\d+$/.test(size)) {
      return parseInt(size)
    }
    
    // If it's a decimal number (likely bytes), return as is
    if (/^\d+\.\d+$/.test(size)) {
      return parseFloat(size)
    }
    
    // Handle Kubernetes storage size formats (Ki, Mi, Gi, Ti, Pi)
    const sizeRegex = /^(\d+(?:\.\d+)?)\s*([KMGTPE]?i?)$/i
    const match = size.match(sizeRegex)
    
    if (!match) {
      // If no match, try to extract just numbers and assume bytes
      const numMatch = size.match(/(\d+(?:\.\d+)?)/)
      if (numMatch) {
        return parseFloat(numMatch[1])
      }
      return 0
    }
    
    const value = parseFloat(match[1])
    const unit = match[2].toUpperCase()
    
    // Convert to bytes
    switch (unit) {
      case 'KI':
      case 'K':
        return value * 1024
      case 'MI':
      case 'M':
        return value * 1024 * 1024
      case 'GI':
      case 'G':
        return value * 1024 * 1024 * 1024
      case 'TI':
      case 'T':
        return value * 1024 * 1024 * 1024 * 1024
      case 'PI':
      case 'P':
        return value * 1024 * 1024 * 1024 * 1024 * 1024
      default:
        return value // Assume bytes if no unit
    }
  }

  private formatBytesToStorage(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  private detectPoolStatus(pool: any): string {
    let status = 'Unknown'
    
    if (pool.status) {
      // Try common status field names
      status = pool.status.phase || 
              pool.status.state || 
              pool.status.status ||
              pool.status.condition ||
              pool.status.ready ||
              pool.status.health ||
              pool.status.operationalState ||
              status
      
      // For boolean ready states
      if (typeof pool.status.ready === 'boolean') {
        status = pool.status.ready ? 'Ready' : 'NotReady'
      }
      
      // Check conditions array if present
      if (pool.status.conditions && Array.isArray(pool.status.conditions)) {
        const readyCondition = pool.status.conditions.find((c: any) => 
          c.type === 'Ready' || c.type === 'Available' || c.type === 'Online'
        )
        if (readyCondition) {
          status = readyCondition.status === 'True' ? 'Ready' : 'NotReady'
        }
      }
    }
    
    // If still unknown, check if the pool has capacity (likely means it's working)
    if (status === 'Unknown' && (pool.status?.capacity || pool.spec?.capacity)) {
      status = 'Available'
    }
    
    return status
  }

  private async getOpenEBSStoragePools(): Promise<any[]> {
    try {
      // Try to get storage pools using custom resources
      const customObjectsApi = this.makeWrappedApiClient(k8s.CustomObjectsApi)
      const storagePools: any[] = []

      // First, let's try to find the correct API for DiskPools by checking CRDs
      try {
        const apiExtensionsApi = this.makeWrappedApiClient(k8s.ApiextensionsV1Api)
        const crds = await apiExtensionsApi.listCustomResourceDefinition()
        const crdItems: any[] = crds.body.items || []
        
        // Look for DiskPool-related CRDs
        const diskPoolCRDs = crdItems.filter((crd: any) => 
          crd.metadata?.name?.includes('diskpool') || 
          crd.metadata?.name?.includes('dsp') ||
          crd.spec?.names?.shortNames?.includes('dsp') ||
          crd.spec?.names?.shortNames?.includes('diskpool') ||
          crd.spec?.names?.plural?.includes('diskpool') ||
          crd.spec?.names?.kind?.toLowerCase().includes('diskpool')
        )
        
        console.log('Found DiskPool CRDs:', diskPoolCRDs.map((crd: any) => ({
          name: crd.metadata?.name,
          group: crd.spec?.group,
          version: crd.spec?.versions?.[0]?.name,
          shortNames: crd.spec?.names?.shortNames
        })))

        // Try to query each found DiskPool CRD
        for (const crd of diskPoolCRDs) {
          const group = crd.spec?.group || ''
          const version = crd.spec?.versions?.[0]?.name || 'v1'
          const plural = crd.spec?.names?.plural || ''
          
          try {
            let pools
            if (crd.spec?.scope === 'Namespaced') {
              pools = await customObjectsApi.listNamespacedCustomObject(group, version, 'openebs', plural)
            } else {
              pools = await customObjectsApi.listClusterCustomObject(group, version, plural)
            }
            
            if (pools.body && Array.isArray((pools.body as any).items)) {
              storagePools.push(...(pools.body as any).items.map((pool: any) => {
                const status = this.detectPoolStatus(pool)
                
                // Log the pool object for debugging (remove in production)
                console.log(`Pool ${pool.metadata?.name} status fields:`, {
                  status: pool.status,
                  detectedStatus: status
                })
                
                return {
                  type: `${crd.spec?.names?.kind || 'DiskPool'}`,
                  name: pool.metadata?.name || '',
                  namespace: pool.metadata?.namespace || '',
                  node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
                  status: status,
                  capacity: pool.status?.capacity || pool.spec?.capacity || '',
                  used: pool.status?.used || '',
                  available: pool.status?.available || pool.status?.free || '',
                  disks: pool.spec?.disks || pool.spec?.blockDevices || [],
                  age: this.calculateAge(pool.metadata?.creationTimestamp)
                }
              }))
            }
          } catch (e) {
            console.log(`Failed to query ${group}/${version}/${plural}:`, e)
          }
        }
      } catch (e) {
        console.log('Failed to list CRDs, trying fallback methods')
      }

      try {
        // Try cStor pools
        const cstorPools = await customObjectsApi.listClusterCustomObject(
          'cstor.openebs.io',
          'v1',
          'cstorpools'
        )
        if (cstorPools.body && Array.isArray((cstorPools.body as any).items)) {
          storagePools.push(...(cstorPools.body as any).items.map((pool: any) => ({
            type: 'cStor Pool',
            name: pool.metadata?.name || '',
            namespace: pool.metadata?.namespace || '',
            node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
            status: this.detectPoolStatus(pool),
            capacity: pool.status?.capacity || '',
            used: pool.status?.used || '',
            free: pool.status?.free || '',
            readonly: pool.status?.readOnly || false,
            age: this.calculateAge(pool.metadata?.creationTimestamp)
          })))
        }
      } catch (e) {
        // cStor pools might not exist
      }

      try {
        // Try Jiva pools
        const jivaPools = await customObjectsApi.listClusterCustomObject(
          'openebs.io',
          'v1alpha1',
          'jivavolumes'
        )
        if (jivaPools.body && Array.isArray((jivaPools.body as any).items)) {
          storagePools.push(...(jivaPools.body as any).items.map((pool: any) => ({
            type: 'Jiva Volume',
            name: pool.metadata?.name || '',
            namespace: pool.metadata?.namespace || '',
            node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
            status: this.detectPoolStatus(pool),
            capacity: pool.spec?.capacity || '',
            replicationFactor: pool.spec?.replicationFactor || 0,
            age: this.calculateAge(pool.metadata?.creationTimestamp)
          })))
        }
      } catch (e) {
        // Jiva pools might not exist
      }

      try {
        // Try Mayastor pools
        const mayastorPools = await customObjectsApi.listClusterCustomObject(
          'mayastor.io',
          'v1',
          'diskpools'
        )
        if (mayastorPools.body && Array.isArray((mayastorPools.body as any).items)) {
          storagePools.push(...(mayastorPools.body as any).items.map((pool: any) => ({
            type: 'Mayastor Pool',
            name: pool.metadata?.name || '',
            namespace: pool.metadata?.namespace || '',
            node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
            status: this.detectPoolStatus(pool),
            capacity: pool.status?.capacity || '',
            used: pool.status?.used || '',
            available: pool.status?.available || '',
            disks: pool.spec?.disks || [],
            age: this.calculateAge(pool.metadata?.creationTimestamp)
          })))
        }
      } catch (e) {
        // Mayastor pools might not exist
      }

      try {
        // Try OpenEBS DiskPools (dsp) - newer OpenEBS versions
        const diskPools = await customObjectsApi.listNamespacedCustomObject(
          'openebs.io',
          'v1alpha1',
          'openebs',
          'diskpools'
        )
        if (diskPools.body && Array.isArray((diskPools.body as any).items)) {
          storagePools.push(...(diskPools.body as any).items.map((pool: any) => ({
            type: 'OpenEBS DiskPool',
            name: pool.metadata?.name || '',
            namespace: pool.metadata?.namespace || '',
            node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
            status: this.detectPoolStatus(pool),
            capacity: pool.status?.capacity || pool.spec?.capacity || '',
            used: pool.status?.used || '',
            available: pool.status?.available || pool.status?.free || '',
            disks: pool.spec?.disks || pool.spec?.blockDevices || [],
            age: this.calculateAge(pool.metadata?.creationTimestamp)
          })))
        }
      } catch (e) {
        console.log('OpenEBS DiskPools (v1alpha1) not found, trying other versions...')
      }

      try {
        // Try OpenEBS DiskPools with different API version
        const diskPoolsV1 = await customObjectsApi.listNamespacedCustomObject(
          'openebs.io',
          'v1',
          'openebs',
          'diskpools'
        )
        if (diskPoolsV1.body && Array.isArray((diskPoolsV1.body as any).items)) {
          storagePools.push(...(diskPoolsV1.body as any).items.map((pool: any) => ({
            type: 'OpenEBS DiskPool',
            name: pool.metadata?.name || '',
            namespace: pool.metadata?.namespace || '',
            node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
            status: this.detectPoolStatus(pool),
            capacity: pool.status?.capacity || pool.spec?.capacity || '',
            used: pool.status?.used || '',
            available: pool.status?.available || pool.status?.free || '',
            disks: pool.spec?.disks || pool.spec?.blockDevices || [],
            age: this.calculateAge(pool.metadata?.creationTimestamp)
          })))
        }
      } catch (e) {
        console.log('OpenEBS DiskPools (v1) not found')
      }

      try {
        // Try ZFS LocalPV pools
        const zfsPools = await customObjectsApi.listNamespacedCustomObject(
          'zfs.openebs.io',
          'v1',
          'openebs',
          'zfsvolumes'
        )
        if (zfsPools.body && Array.isArray((zfsPools.body as any).items)) {
          storagePools.push(...(zfsPools.body as any).items.map((pool: any) => ({
            type: 'ZFS Pool',
            name: pool.metadata?.name || '',
            namespace: pool.metadata?.namespace || '',
            node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
            status: this.detectPoolStatus(pool),
            capacity: pool.spec?.capacity || '',
            used: pool.status?.used || '',
            available: pool.status?.available || '',
            age: this.calculateAge(pool.metadata?.creationTimestamp)
          })))
        }
      } catch (e) {
        console.log('ZFS pools not found')
      }

      try {
        // Try LVM LocalPV pools
        const lvmPools = await customObjectsApi.listNamespacedCustomObject(
          'lvm.openebs.io',
          'v1alpha1',
          'openebs',
          'lvmvolumes'
        )
        if (lvmPools.body && Array.isArray((lvmPools.body as any).items)) {
          storagePools.push(...(lvmPools.body as any).items.map((pool: any) => ({
            type: 'LVM Pool',
            name: pool.metadata?.name || '',
            namespace: pool.metadata?.namespace || '',
            node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
            status: this.detectPoolStatus(pool),
            capacity: pool.spec?.capacity || '',
            used: pool.status?.used || '',
            available: pool.status?.available || '',
            age: this.calculateAge(pool.metadata?.creationTimestamp)
          })))
        }
      } catch (e) {
        console.log('LVM pools not found')
      }

      // Additional fallback attempts for common OpenEBS storage pool types
      const commonPoolTypes = [
        { group: 'openebs.io', version: 'v1alpha1', resource: 'diskpools' },
        { group: 'openebs.io', version: 'v1', resource: 'diskpools' },
        { group: 'openebs.io', version: 'v1beta1', resource: 'diskpools' },
        { group: 'cstor.openebs.io', version: 'v1', resource: 'cstorpoolclusters' },
        { group: 'cstor.openebs.io', version: 'v1', resource: 'cstorpools' },
        { group: 'mayastor.openebs.io', version: 'v1alpha1', resource: 'diskpools' },
        { group: 'localpv.openebs.io', version: 'v1alpha1', resource: 'localvolumesets' }
      ]

      for (const poolType of commonPoolTypes) {
        try {
          const pools = await customObjectsApi.listNamespacedCustomObject(
            poolType.group, 
            poolType.version, 
            'openebs', 
            poolType.resource
          )
          
          if (pools.body && Array.isArray((pools.body as any).items) && (pools.body as any).items.length > 0) {
            console.log(`Found ${(pools.body as any).items.length} pools in ${poolType.group}/${poolType.version}/${poolType.resource}`)
            storagePools.push(...(pools.body as any).items.map((pool: any) => ({
              type: `${poolType.group.split('.')[0]} Pool`,
              name: pool.metadata?.name || '',
              namespace: pool.metadata?.namespace || '',
            node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
              status: this.detectPoolStatus(pool),
              capacity: pool.status?.capacity || pool.spec?.capacity || pool.status?.totalCapacity || '',
              used: pool.status?.used || pool.status?.usedCapacity || '',
              available: pool.status?.available || pool.status?.free || pool.status?.freeCapacity || '',
              disks: pool.spec?.disks || pool.spec?.blockDevices || pool.spec?.poolSpec?.disks || [],
              readonly: pool.status?.readOnly || false,
              replicationFactor: pool.spec?.replicationFactor || 0,
              age: this.calculateAge(pool.metadata?.creationTimestamp)
            })))
          }
        } catch (e) {
          // Continue to next pool type
        }

        // Also try cluster-scoped resources
        try {
          const pools = await customObjectsApi.listClusterCustomObject(
            poolType.group, 
            poolType.version, 
            poolType.resource
          )
          
          if (pools.body && Array.isArray((pools.body as any).items) && (pools.body as any).items.length > 0) {
            console.log(`Found ${(pools.body as any).items.length} cluster pools in ${poolType.group}/${poolType.version}/${poolType.resource}`)
            storagePools.push(...(pools.body as any).items.map((pool: any) => ({
              type: `${poolType.group.split('.')[0]} Pool`,
              name: pool.metadata?.name || '',
              namespace: pool.metadata?.namespace || '',
            node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
              status: this.detectPoolStatus(pool),
              capacity: pool.status?.capacity || pool.spec?.capacity || pool.status?.totalCapacity || '',
              used: pool.status?.used || pool.status?.usedCapacity || '',
              available: pool.status?.available || pool.status?.free || pool.status?.freeCapacity || '',
              disks: pool.spec?.disks || pool.spec?.blockDevices || pool.spec?.poolSpec?.disks || [],
              readonly: pool.status?.readOnly || false,
              replicationFactor: pool.spec?.replicationFactor || 0,
              age: this.calculateAge(pool.metadata?.creationTimestamp)
            })))
          }
        } catch (e) {
          // Continue to next pool type
        }
      }

      // Specific attempt for "dsp" shortname used by kubectl get dsp -n openebs
      try {
        // Try the most common patterns for DSP resources
        const dspPatterns = [
          { group: 'openebs.io', version: 'v1alpha1', resource: 'diskstoragesets' },
          { group: 'openebs.io', version: 'v1alpha1', resource: 'diskstorageconfigs' },
          { group: 'openebs.io', version: 'v1alpha1', resource: 'diskstoragepools' },
          { group: 'mayastor.openebs.io', version: 'v1alpha1', resource: 'diskstoragepools' },
          { group: 'lvm.openebs.io', version: 'v1alpha1', resource: 'diskstoragepools' },
          { group: 'zfs.openebs.io', version: 'v1alpha1', resource: 'diskstoragepools' }
        ]

        for (const pattern of dspPatterns) {
          try {
            const dspPools = await customObjectsApi.listNamespacedCustomObject(
              pattern.group,
              pattern.version,
              'openebs',
              pattern.resource
            )
            
            if (dspPools.body && Array.isArray((dspPools.body as any).items) && (dspPools.body as any).items.length > 0) {
              console.log(`Found DSP pools in ${pattern.group}/${pattern.version}/${pattern.resource}:`, (dspPools.body as any).items.length)
              storagePools.push(...(dspPools.body as any).items.map((pool: any) => ({
                type: 'DiskStoragePool',
                name: pool.metadata?.name || '',
                namespace: pool.metadata?.namespace || '',
            node: pool.spec?.node || pool.status?.node || pool.metadata?.labels?.['kubernetes.io/hostname'] || 'Unknown',
                status: this.detectPoolStatus(pool),
                capacity: pool.status?.capacity || pool.spec?.capacity || pool.status?.totalSize || '',
                used: pool.status?.used || pool.status?.usedSize || '',
                available: pool.status?.available || pool.status?.freeSize || '',
                disks: pool.spec?.disks || pool.spec?.blockDevices || pool.spec?.devices || [],
                age: this.calculateAge(pool.metadata?.creationTimestamp)
              })))
              break // Stop after finding the first working pattern
            }
          } catch (e) {
            // Continue to next pattern
          }
        }
      } catch (e) {
        console.log('Failed to query DSP patterns')
      }

      return storagePools
    } catch (error) {
      console.error('Error fetching OpenEBS storage pools:', error)
      return []
    }
  }

  private async getOpenEBSNodes(): Promise<any[]> {
    try {
      const nodesResponse = await this.k8sApi.listNode()
      const nodes: any[] = nodesResponse.body.items || []

      return nodes.map((node: any) => {
        const labels = node.metadata?.labels || {}
        const annotations = node.metadata?.annotations || {}
        
        // Check for OpenEBS-related labels and annotations
        const openebsLabels = Object.keys(labels).filter(key => 
          key.includes('openebs') || key.includes('mayastor')
        )
        const openebsAnnotations = Object.keys(annotations).filter(key => 
          key.includes('openebs') || key.includes('mayastor')
        )

        // Get storage information
        const capacity = node.status?.capacity || {}
        const allocatable = node.status?.allocatable || {}
        
        // Raw storage values
        const rawStorageCapacity = capacity['ephemeral-storage'] || capacity.storage || '0'
        const rawStorageAllocatable = allocatable['ephemeral-storage'] || allocatable.storage || '0'
        
        // Convert to bytes for proper calculation
        const storageCapacityBytes = this.parseStorageSizeToBytes(rawStorageCapacity)
        const storageAllocatableBytes = this.parseStorageSizeToBytes(rawStorageAllocatable)
        
        // Calculate allocatable percentage (what percentage of total capacity is allocatable)
        const allocatablePercentage = storageCapacityBytes > 0 ? 
          (storageAllocatableBytes / storageCapacityBytes * 100) : 0

        return {
          name: node.metadata?.name || '',
          storageCapacity: rawStorageCapacity,
          storageAllocatable: rawStorageAllocatable,
          storageCapacityBytes,
          storageAllocatableBytes,
          allocatablePercentage: Number(allocatablePercentage.toFixed(1)),
          openebsLabels: openebsLabels.reduce((acc: any, key) => {
            acc[key] = labels[key]
            return acc
          }, {}),
          openebsAnnotations: openebsAnnotations.reduce((acc: any, key) => {
            acc[key] = annotations[key]
            return acc
          }, {}),
          conditions: node.status?.conditions?.map((condition: any) => ({
            type: condition.type,
            status: condition.status,
            reason: condition.reason || '',
            message: condition.message || ''
          })) || []
        }
      }).filter((node: any) => 
        Object.keys(node.openebsLabels).length > 0 || 
        Object.keys(node.openebsAnnotations).length > 0
      )
    } catch (error) {
      console.error('Error fetching OpenEBS nodes:', error)
      return []
    }
  }

  private async getOpenEBSVersion(namespaces: string[]): Promise<string | undefined> {
    try {
      // Try to get version from OpenEBS operator deployment
      const appsApi = this.makeWrappedApiClient(k8s.AppsV1Api)
      
      for (const namespace of namespaces) {
        try {
          const deployments = await appsApi.listNamespacedDeployment(namespace)
          const deploymentItems: any[] = deployments.body.items || []
          const openebsDeployment = deploymentItems.find((dep: any) => 
            dep.metadata?.name?.includes('openebs') || 
            dep.metadata?.name?.includes('maya') ||
            dep.metadata?.name?.includes('mayastor')
          )
          
          if (openebsDeployment) {
            // Try to extract version from image tag
            const containers = openebsDeployment.spec?.template?.spec?.containers || []
            for (const container of containers) {
              const image = container.image || ''
              const versionMatch = image.match(/:v?(\d+\.\d+\.\d+)/)
              if (versionMatch) {
                return versionMatch[1]
              }
            }
            
            // Try to get version from labels
            const labels = openebsDeployment.metadata?.labels || {}
            if (labels.version) {
              return labels.version
            }
          }
        } catch (e) {
          // Continue to next namespace
        }
      }
      
      return undefined
    } catch (error) {
      console.error('Error fetching OpenEBS version:', error)
      return undefined
    }
  }

  private calculateAge(timestamp?: string | Date): string {
    if (!timestamp) return 'Unknown'
    
    // Handle both string and Date timestamps
    let timestampStr = timestamp
    if (timestamp instanceof Date) {
      timestampStr = timestamp.toISOString()
    } else {
      timestampStr = timestamp
    }
    
    const now = new Date()
    const created = new Date(timestampStr)
    const diff = now.getTime() - created.getTime()
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    
    if (days > 0) return `${days}d`
    if (hours > 0) return `${hours}h`
    return `${minutes}m`
  }

  // Get disk usage from Talos API
  async getTalosDiskUsage(nodeIP: string): Promise<{ total: number, used: number, available: number } | null> {
    if (!this.talosconfig) {
      console.log(`[Talos] No talosconfig available for node ${nodeIP}`)
      return null
    }

    try {
      const yaml = require('yaml')
      const https = require('https')
      
      const talosConfig = yaml.parse(this.talosconfig)
      
      if (!talosConfig || !talosConfig.contexts) {
        console.log(`[Talos] Invalid talosconfig structure`)
        return null
      }

      // Get the current context
      const currentContext = talosConfig.context || Object.keys(talosConfig.contexts)[0]
      const context = talosConfig.contexts[currentContext]
      
      if (!context) {
        console.log(`[Talos] No context found`)
        return null
      }

      // Get CA certificate and client certificates from context
      const ca = context.ca
      const crt = context.crt
      const key = context.key

      if (!ca || !crt || !key) {
        console.warn(`[Talos] Missing certificates in config`)
        return null
      }

      const url = `https://${nodeIP}:50000/machine.MachineService/DiskStats`
      console.log(`[Talos] Fetching disk stats from ${url}`)

      // Use native HTTPS module to make the request
      return new Promise((resolve, reject) => {
        const postData = JSON.stringify({})
        
        // Certificates in talosconfig are base64-encoded PEM format
        // Decode them to get the actual PEM strings
        const caPem = Buffer.from(ca, 'base64').toString('utf-8')
        const certPem = Buffer.from(crt, 'base64').toString('utf-8')
        const keyPem = Buffer.from(key, 'base64').toString('utf-8')
        
        const options = {
          hostname: nodeIP,
          port: 50000,
          path: '/machine.MachineService/DiskStats',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          ca: caPem,
          cert: certPem,
          key: keyPem,
          rejectUnauthorized: false,
          timeout: 5000
        }

        const req = https.request(options, (res: any) => {
          let data = ''

          res.on('data', (chunk: any) => {
            data += chunk
          })

          res.on('end', () => {
            if (res.statusCode !== 200) {
              console.warn(`[Talos] API request failed for ${nodeIP}: ${res.statusCode}`)
              resolve(null)
              return
            }

            try {
              const responseData = JSON.parse(data)
              
              // Parse Talos disk stats response
              if (!responseData.messages || responseData.messages.length === 0) {
                console.warn(`[Talos] No messages in response for ${nodeIP}`)
                resolve(null)
                return
              }

              const diskStats = responseData.messages[0]
              if (!diskStats.disks || diskStats.disks.length === 0) {
                console.warn(`[Talos] No disks in response for ${nodeIP}`)
                resolve(null)
                return
              }

              console.log(`[Talos] Found ${diskStats.disks.length} disks for ${nodeIP}:`, 
                diskStats.disks.map((d: any) => `${d.device_name} (${d.mount_point})`).join(', '))

              // Find the system disk - in Talos this is typically /system
              let systemDisk = diskStats.disks.find((d: any) => 
                d.mount_point === '/system'
              )

              // Fallback: look for root or main disk
              if (!systemDisk) {
                systemDisk = diskStats.disks.find((d: any) => 
                  d.mount_point === '/' ||
                  d.device_name?.includes('sda1') || 
                  d.device_name?.includes('vda1') ||
                  d.device_name?.includes('nvme0n1p')
                )
              }

              // Last resort: use the largest disk
              if (!systemDisk && diskStats.disks.length > 0) {
                systemDisk = diskStats.disks.reduce((largest: any, current: any) => {
                  const largestSize = parseInt(largest.size) || 0
                  const currentSize = parseInt(current.size) || 0
                  return currentSize > largestSize ? current : largest
                })
              }

              if (systemDisk) {
                const total = parseInt(systemDisk.size) || 0
                const available = parseInt(systemDisk.available) || 0
                const used = total - available

                console.log(`[Talos] System disk for ${nodeIP}: ${systemDisk.device_name} (${systemDisk.mount_point})`)
                console.log(`[Talos]   Total: ${(total / 1024 / 1024 / 1024).toFixed(2)} GB`)
                console.log(`[Talos]   Used: ${(used / 1024 / 1024 / 1024).toFixed(2)} GB`)
                console.log(`[Talos]   Available: ${(available / 1024 / 1024 / 1024).toFixed(2)} GB`)

                resolve({
                  total,
                  used,
                  available
                })
                return
              }

              console.warn(`[Talos] Could not find system disk for ${nodeIP}`)
              resolve(null)
            } catch (parseError: any) {
              console.warn(`[Talos] Error parsing response for ${nodeIP}:`, parseError.message)
              resolve(null)
            }
          })
        })

        req.on('error', (err: any) => {
          console.warn(`[Talos] Request error for ${nodeIP}:`, err.message)
          resolve(null)
        })

        req.on('timeout', () => {
          req.destroy()
          console.warn(`[Talos] Request timeout for ${nodeIP}`)
          resolve(null)
        })

        req.write(postData)
        req.end()
      })
    } catch (error: any) {
      console.warn(`[Talos] Error fetching disk usage for ${nodeIP}:`, error.message)
      return null
    }
  }

  // Storage methods for getting all PVs and PVCs (not just OpenEBS)
  async getAllPersistentVolumes(): Promise<any[]> {
    try {
      const pvResponse = await this.k8sApi.listPersistentVolume()
      const pvs: any[] = pvResponse.body.items || []
      return pvs.map((pv: any) => ({
        name: pv.metadata?.name || '',
        capacity: pv.spec?.capacity?.storage || '0',
        accessModes: pv.spec?.accessModes || [],
        reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy || '',
        storageClass: pv.spec?.storageClassName || '',
        status: pv.status?.phase || 'Unknown',
        claimRef: pv.spec?.claimRef ? {
          name: pv.spec.claimRef.name || '',
          namespace: pv.spec.claimRef.namespace || ''
        } : null,
        volumeMode: pv.spec?.volumeMode || 'Filesystem',
        driver: pv.spec?.csi?.driver || pv.spec?.nfs?.server || pv.spec?.hostPath?.path || 'Unknown',
        age: this.calculateAge(pv.metadata?.creationTimestamp),
        labels: pv.metadata?.labels || {},
        annotations: pv.metadata?.annotations || {}
      }))
    } catch (error) {
      console.error('Error fetching persistent volumes:', error)
      return []
    }
  }

  async getAllPersistentVolumeClaims(): Promise<any[]> {
    try {
      const pvcResponse = await this.k8sApi.listPersistentVolumeClaimForAllNamespaces()
      const pvcs: any[] = pvcResponse.body.items || []

      const pvResponse = await this.k8sApi.listPersistentVolume()
      const pvs: any[] = pvResponse.body.items || []

      const smbVolumeNames = new Set(
        pvs
          .filter((pv: any) => this.isSmbPersistentVolume(pv))
          .map((pv: any) => pv.metadata?.name)
          .filter(Boolean)
      )

      const smbPvcKeys = new Set(
        pvcs
          .filter((pvc: any) => {
            const storageClass = (pvc.spec?.storageClassName || '').toLowerCase()
            const volumeName = pvc.spec?.volumeName || ''

            return this.isSmbStorageClassName(storageClass) || (volumeName && smbVolumeNames.has(volumeName))
          })
          .map((pvc: any) => `${pvc.metadata?.namespace}/${pvc.metadata?.name}`)
      )
      
      // Get storage usage metrics for all PVCs
      const pvcUsageMap = await this.getPVCUsageMetrics(smbPvcKeys)
      
      return pvcs.map((pvc: any) => {
        const pvcKey = `${pvc.metadata?.namespace}/${pvc.metadata?.name}`
        const isSmbPvc = smbPvcKeys.has(pvcKey)
        const usage = pvcUsageMap.get(pvcKey)
        const usedBytes = usage?.usedBytes ?? 0
        const allocatedBytes = this.parseStorageSizeToBytes(pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || '0')
        const freeBytes = usage?.availableBytes !== undefined ? Math.max(0, usage.availableBytes) : Math.max(0, allocatedBytes - usedBytes)
        const usageStatus = isSmbPvc ? 'Skipped for SMB volume' : (usage?.usageStatus || 'No mounted pod found')
        
        return {
          name: pvc.metadata?.name || '',
          namespace: pvc.metadata?.namespace || '',
          status: pvc.status?.phase || 'Unknown',
          capacity: pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || '0',
          requestedStorage: pvc.spec?.resources?.requests?.storage || '0',
          usedStorage: isSmbPvc ? '' : this.formatBytesToStorage(usedBytes),
          freeStorage: isSmbPvc ? '' : this.formatBytesToStorage(freeBytes),
          usagePercentage: isSmbPvc ? 0 : (allocatedBytes > 0 ? Math.round((usedBytes / allocatedBytes) * 100) : 0),
          usageStatus,
          accessModes: pvc.spec?.accessModes || [],
          storageClass: pvc.spec?.storageClassName || '',
          volumeName: pvc.spec?.volumeName || '',
          volumeMode: pvc.spec?.volumeMode || 'Filesystem',
          age: this.calculateAge(pvc.metadata?.creationTimestamp),
          labels: pvc.metadata?.labels || {},
          annotations: pvc.metadata?.annotations || {},
          conditions: pvc.status?.conditions || []
        }
      })
    } catch (error) {
      console.error('Error fetching persistent volume claims:', error)
      return []
    }
  }

  private isSmbStorageClassName(storageClassName: string): boolean {
    const normalized = (storageClassName || '').toLowerCase()
    return normalized.includes('smb') || normalized.includes('cifs')
  }

  private isSmbPersistentVolume(pv: any): boolean {
    const storageClassName = (pv.spec?.storageClassName || '').toLowerCase()
    const csiDriver = (pv.spec?.csi?.driver || '').toLowerCase()
    const flexDriver = (pv.spec?.flexVolume?.driver || '').toLowerCase()

    return (
      this.isSmbStorageClassName(storageClassName) ||
      csiDriver.includes('smb') ||
      csiDriver.includes('cifs') ||
      flexDriver.includes('smb') ||
      flexDriver.includes('cifs')
    )
  }

  async getAllStorageClasses(): Promise<any[]> {
    try {
      const scResponse = await this.storageApi.listStorageClass()
      return scResponse.body.items.map((sc: any) => ({
        name: sc.metadata?.name || '',
        provisioner: sc.provisioner || '',
        reclaimPolicy: sc.reclaimPolicy || 'Delete',
        allowVolumeExpansion: sc.allowVolumeExpansion || false,
        volumeBindingMode: sc.volumeBindingMode || 'Immediate',
        parameters: sc.parameters || {},
        isDefault: sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true',
        age: this.calculateAge(sc.metadata?.creationTimestamp),
        labels: sc.metadata?.labels || {},
        annotations: sc.metadata?.annotations || {}
      }))
    } catch (error) {
      console.error('Error fetching storage classes:', error)
      return []
    }
  }

  private async execInPod(namespace: string, podName: string, containerName: string, command: string[]): Promise<string> {
    const exec = new k8s.Exec(this.kc)
    const stdoutStream = new PassThrough()
    const stderrStream = new PassThrough()

    let stdout = ''
    let stderr = ''

    stdoutStream.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    stderrStream.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    await exec.exec(
      namespace,
      podName,
      containerName,
      command,
      stdoutStream,
      stderrStream,
      null as any,
      false,
      () => {}
    )

    const output = stdout.trim()
    const errorOutput = stderr.trim()

    if (!output && errorOutput) {
      throw new Error(errorOutput)
    }

    return output
  }

  private async execInPodViaKubectl(namespace: string, podName: string, containerName: string, command: string[]): Promise<string> {
    if (!this.kubeconfigContent) {
      throw new Error('No kubeconfig content available for kubectl fallback')
    }

    const kubeconfigPath = path.join(os.tmpdir(), `k8s-fleet-manager-kubeconfig-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`)

    try {
      await fs.writeFile(kubeconfigPath, this.kubeconfigContent, { mode: 0o600 })

      const args = [
        '--kubeconfig',
        kubeconfigPath,
        '-n',
        namespace,
        'exec',
        podName,
        '-c',
        containerName,
        '--',
        ...command
      ]

      const result = await execFileAsync('kubectl', args, { timeout: 20000, maxBuffer: 1024 * 1024 })
      const output = (result.stdout || '').trim()

      if (!output && result.stderr?.trim()) {
        throw new Error(result.stderr.trim())
      }

      return output
    } finally {
      await fs.unlink(kubeconfigPath).catch(() => {})
    }
  }

  private parseDfOutput(output: string): { usedBytes: number; availableBytes: number } | null {
    const lines = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length === 0) return null

    const dataLine = [...lines].reverse().find((line) => !line.toLowerCase().startsWith('filesystem'))
    if (!dataLine) return null

    const columns = dataLine.split(/\s+/)
    if (columns.length < 5) return null

    const usedRaw = columns[2]
    const availableRaw = columns[3]

    let usedBytes = this.parseStorageSizeToBytes(usedRaw)
    let availableBytes = this.parseStorageSizeToBytes(availableRaw)

    // For plain numeric output from df -P, values are typically in 1K blocks
    const outputIsKilobytes = lines.some((line) => line.toLowerCase().includes('1k-blocks') || line.toLowerCase().includes('1024-blocks'))
    if (outputIsKilobytes && /^\d+$/.test(usedRaw) && /^\d+$/.test(availableRaw)) {
      usedBytes *= 1024
      availableBytes *= 1024
    }

    if (usedBytes < 0 || availableBytes < 0) return null

    return { usedBytes, availableBytes }
  }

  private async getPVCUsageFromPod(namespace: string, podName: string, containerName: string, mountPath: string): Promise<{ usedBytes: number; availableBytes: number } | null> {
    const commandsToTry: string[][] = [
      ['df', '-hP', mountPath],
      ['df', '-P', mountPath]
    ]

    for (const command of commandsToTry) {
      try {
        const output = await this.execInPod(namespace, podName, containerName, command)
        const parsed = this.parseDfOutput(output)
        if (parsed) {
          return parsed
        }
      } catch {
        // Try next command
      }
    }

    for (const command of commandsToTry) {
      try {
        const output = await this.execInPodViaKubectl(namespace, podName, containerName, command)
        const parsed = this.parseDfOutput(output)
        if (parsed) {
          return parsed
        }
      } catch {
        // Try next command
      }
    }

    return null
  }

  // Get PVC usage metrics from df output in pods mounting the PVC
  private async getPVCUsageMetrics(excludedPvcKeys: Set<string> = new Set()): Promise<Map<string, { usedBytes: number; availableBytes: number; usageStatus: string }>> {
    const usageMap = new Map<string, { usedBytes: number; availableBytes: number; usageStatus: string }>()
    
    try {
      const podsResponse = await this.k8sApi.listPodForAllNamespaces()
      const pods: any[] = podsResponse.body.items || []
      const pvcPodMountMap = new Map<string, Array<{ namespace: string; podName: string; containerName: string; mountPath: string }>>()

      for (const pod of pods) {
        const namespace = pod.metadata?.namespace || ''
        const podName = pod.metadata?.name || ''
        if (!namespace || !podName) continue
        if (pod.status?.phase !== 'Running') continue

        const volumes: any[] = pod.spec?.volumes || []
        const runningContainerNames = new Set(
          (pod.status?.containerStatuses || [])
            .filter((cs: any) => cs?.state?.running)
            .map((cs: any) => cs.name)
        )
        const allContainers: any[] = (pod.spec?.containers || []).filter((container: any) => {
          return runningContainerNames.size === 0 || runningContainerNames.has(container.name)
        })

        for (const volume of volumes) {
          const claimName = volume.persistentVolumeClaim?.claimName
          if (!claimName || !volume.name) continue

          const pvcKey = `${namespace}/${claimName}`
          if (excludedPvcKeys.has(pvcKey)) {
            continue
          }

          if (!pvcPodMountMap.has(pvcKey)) {
            pvcPodMountMap.set(pvcKey, [])
          }

          for (const container of allContainers) {
            const mount = (container.volumeMounts || []).find((vm: any) => vm.name === volume.name && vm.mountPath)
            if (mount?.mountPath && container.name) {
              pvcPodMountMap.get(pvcKey)!.push({
                namespace,
                podName,
                containerName: container.name,
                mountPath: mount.mountPath
              })
            }
          }
        }
      }

      for (const [pvcKey, mountCandidates] of pvcPodMountMap.entries()) {
        let measured = false

        for (const mountInfo of mountCandidates) {
          const usage = await this.getPVCUsageFromPod(
            mountInfo.namespace,
            mountInfo.podName,
            mountInfo.containerName,
            mountInfo.mountPath
          )

          if (usage) {
            usageMap.set(pvcKey, {
              ...usage,
              usageStatus: 'Measured via df'
            })
            measured = true
            break
          }
        }

        if (!measured) {
          usageMap.set(pvcKey, {
            usedBytes: 0,
            availableBytes: 0,
            usageStatus: 'Mounted pod found, df failed'
          })
        }
      }
    } catch (error) {
      console.error('Error fetching PVC usage metrics:', error)
    }
    
    return usageMap
  }

  // Networking methods
  async getAllIngresses(): Promise<any[]> {
    try {
      const response = await this.networkingApi.listIngressForAllNamespaces()
      return response.body.items.map((ingress: any) => ({
        name: ingress.metadata?.name || '',
        namespace: ingress.metadata?.namespace || '',
        creationTimestamp: ingress.metadata?.creationTimestamp,
        rules: ingress.spec?.rules || [],
        hosts: ingress.spec?.rules?.map((rule: any) => rule.host).filter(Boolean) || [],
        ingressClass: ingress.spec?.ingressClassName || 'default',
        loadBalancer: ingress.status?.loadBalancer,
        annotations: ingress.metadata?.annotations || {},
        labels: ingress.metadata?.labels || {}
      }))
    } catch (error) {
      console.error('Error fetching ingresses:', error)
      return []
    }
  }

  async getAllNetworkPolicies(): Promise<any[]> {
    try {
      const response = await this.networkingApi.listNetworkPolicyForAllNamespaces()
      return response.body.items.map((policy: any) => ({
        name: policy.metadata?.name || '',
        namespace: policy.metadata?.namespace || '',
        creationTimestamp: policy.metadata?.creationTimestamp,
        podSelector: policy.spec?.podSelector || {},
        ingress: policy.spec?.ingress || [],
        egress: policy.spec?.egress || [],
        policyTypes: policy.spec?.policyTypes || [],
        labels: policy.metadata?.labels || {},
        annotations: policy.metadata?.annotations || {}
      }))
    } catch (error) {
      console.error('Error fetching network policies:', error)
      return []
    }
  }

  async getAllServices(): Promise<any[]> {
    try {
      const response = await this.k8sApi.listServiceForAllNamespaces()
      return response.body.items.map((service: any) => ({
        name: service.metadata?.name || '',
        namespace: service.metadata?.namespace || '',
        creationTimestamp: service.metadata?.creationTimestamp,
        type: service.spec?.type || 'ClusterIP',
        clusterIP: service.spec?.clusterIP || '',
        externalIPs: service.spec?.externalIPs || [],
        ports: service.spec?.ports || [],
        selector: service.spec?.selector || {},
        sessionAffinity: service.spec?.sessionAffinity || 'None',
        loadBalancerIP: service.spec?.loadBalancerIP || '',
        externalName: service.spec?.externalName || '',
        status: service.status,
        labels: service.metadata?.labels || {},
        annotations: service.metadata?.annotations || {}
      }))
    } catch (error) {
      console.error('Error fetching services:', error)
      return []
    }
  }

  async getAllEndpoints(): Promise<any[]> {
    try {
      const response = await this.k8sApi.listEndpointsForAllNamespaces()
      return response.body.items.map((endpoint: any) => ({
        name: endpoint.metadata?.name || '',
        namespace: endpoint.metadata?.namespace || '',
        creationTimestamp: endpoint.metadata?.creationTimestamp,
        subsets: endpoint.subsets || [],
        addresses: endpoint.subsets?.flatMap((subset: any) => 
          (subset.addresses || []).map((addr: any) => ({
            ip: addr.ip,
            hostname: addr.hostname,
            nodeName: addr.nodeName,
            targetRef: addr.targetRef,
            ready: true
          })).concat((subset.notReadyAddresses || []).map((addr: any) => ({
            ip: addr.ip,
            hostname: addr.hostname,
            nodeName: addr.nodeName,
            targetRef: addr.targetRef,
            ready: false
          })))
        ) || [],
        ports: endpoint.subsets?.flatMap((subset: any) => subset.ports || []) || [],
        labels: endpoint.metadata?.labels || {},
        annotations: endpoint.metadata?.annotations || {}
      }))
    } catch (error) {
      console.error('Error fetching endpoints:', error)
      return []
    }
  }

  // Get LoadBalancer IP pools and subnet information
  async getIPPoolsAndSubnets(): Promise<any> {
    try {
      const result = {
        ipPools: [] as any[],
        subnets: [] as any[],
        clusterCIDR: null as string | null,
        serviceCIDR: null as string | null,
        podCIDR: null as string[] | null
      }

      // Get cluster CIDR information from nodes
      const nodesResponse = await this.k8sApi.listNode()
      const nodes: any[] = nodesResponse.body.items || []

      // Extract pod CIDR from nodes
      const podCIDRs = new Set<string>()
      nodes.forEach((node: any) => {
        if (node.spec?.podCIDR) {
          podCIDRs.add(node.spec.podCIDR)
        }
        if (node.spec?.podCIDRs) {
          node.spec.podCIDRs.forEach((cidr: string) => podCIDRs.add(cidr))
        }
      })

      result.podCIDR = Array.from(podCIDRs)

      // Try to get cluster configuration information
      try {
        // Get kubeadm configmap if it exists
        const configMapResponse = await this.k8sApi.readNamespacedConfigMap('kubeadm-config', 'kube-system')
        const config = configMapResponse.body.data
        if (config?.ClusterConfiguration) {
          const clusterConfig = config.ClusterConfiguration
          // Extract networking info from kubeadm config
          const serviceSubnetMatch = clusterConfig.match(/serviceSubnet:\s*([^\s\n]+)/)
          const podSubnetMatch = clusterConfig.match(/podSubnet:\s*([^\s\n]+)/)
          
          if (serviceSubnetMatch) result.serviceCIDR = serviceSubnetMatch[1]
          if (podSubnetMatch) result.clusterCIDR = podSubnetMatch[1]
        }
      } catch (configError) {
        // Config map might not exist, continue
      }

      // Try to get kube-proxy configuration
      try {
        const kubeProxyConfig = await this.k8sApi.readNamespacedConfigMap('kube-proxy', 'kube-system')
        if (kubeProxyConfig.body.data?.config) {
          const proxyConfig = kubeProxyConfig.body.data.config
          const clusterCIDRMatch = proxyConfig.match(/clusterCIDR:\s*"?([^"\s\n]+)"?/)
          if (clusterCIDRMatch && !result.clusterCIDR) {
            result.clusterCIDR = clusterCIDRMatch[1]
          }
        }
      } catch (proxyError) {
        // Kube-proxy config might not be accessible
      }

      // Check for common CNI configurations
      try {
        // Try to get CNI configurations from various sources
        const cniConfigs = []
        const customObjectsApi = this.makeWrappedApiClient(k8s.CustomObjectsApi)

        const listClusterCustomObjectSafe = async (group: string, version: string, plural: string) => {
          try {
            return await customObjectsApi.listClusterCustomObject({ group, version, plural })
          } catch {
            return await customObjectsApi.listClusterCustomObject(group, version, plural)
          }
        }

        const listNamespacedCustomObjectSafe = async (group: string, version: string, namespace: string, plural: string) => {
          try {
            return await customObjectsApi.listNamespacedCustomObject({ group, version, namespace, plural })
          } catch {
            return await customObjectsApi.listNamespacedCustomObject(group, version, namespace, plural)
          }
        }
        
        // Check for Calico IP pools
        try {
          const calicoIPPools = await listClusterCustomObjectSafe('crd.projectcalico.org', 'v1', 'ippools')
          
          if (calicoIPPools.body && Array.isArray((calicoIPPools.body as any).items)) {
            (calicoIPPools.body as any).items.forEach((pool: any) => {
              result.ipPools.push({
                name: pool.metadata?.name || 'unknown',
                cidr: pool.spec?.cidr || 'unknown',
                type: 'Calico IP Pool',
                disabled: pool.spec?.disabled || false,
                natOutgoing: pool.spec?.natOutgoing || false
              })
            })
          }
        } catch (calicoError) {
          // Calico might not be installed
        }

        // Check for Cilium IP pools
        try {
          const ciliumPools = await listClusterCustomObjectSafe('cilium.io', 'v2alpha1', 'ciliumpodippools')
          
          if (ciliumPools.body && Array.isArray((ciliumPools.body as any).items)) {
            (ciliumPools.body as any).items.forEach((pool: any) => {
              result.ipPools.push({
                name: pool.metadata?.name || 'unknown',
                cidr: pool.spec?.ipv4?.cidrs?.[0] || pool.spec?.ipv6?.cidrs?.[0] || 'unknown',
                type: 'Cilium Pod IP Pool',
                maskSize: pool.spec?.ipv4?.maskSize || pool.spec?.ipv6?.maskSize
              })
            })
          }
        } catch (ciliumError) {
          // Cilium might not be installed
        }

        // Check for MetalLB IP address pools
        try {
          const metalLBPools = await listClusterCustomObjectSafe('metallb.io', 'v1beta1', 'ipaddresspools')
          
          if (metalLBPools.body && Array.isArray((metalLBPools.body as any).items)) {
            (metalLBPools.body as any).items.forEach((pool: any) => {
              result.ipPools.push({
                name: pool.metadata?.name || 'unknown',
                addresses: pool.spec?.addresses || [],
                type: 'MetalLB IP Pool',
                namespace: pool.metadata?.namespace || 'metallb-system'
              })
            })
          }
        } catch (metallbError) {
          // MetalLB might not be installed
        }

        // Check for Antrea ExternalIPPool / IPPool resources
        try {
          const namespacesResponse = await this.k8sApi.listNamespace()
          const namespaces: string[] = (namespacesResponse.body.items || [])
            .map((ns: any) => ns.metadata?.name)
            .filter((name: string) => !!name)

          const antreaAttempts = [
            { group: 'crd.antrea.io', version: 'v1beta1', resource: 'externalippools', type: 'Antrea External IP Pool' },
            { group: 'crd.antrea.io', version: 'v1alpha2', resource: 'externalippools', type: 'Antrea External IP Pool' },
            { group: 'crd.antrea.io', version: 'v1alpha3', resource: 'externalippools', type: 'Antrea External IP Pool' },
            { group: 'crd.antrea.io', version: 'v1beta1', resource: 'ippools', type: 'Antrea IP Pool' },
            { group: 'crd.antrea.io', version: 'v1alpha2', resource: 'ippools', type: 'Antrea IP Pool' },
            { group: 'antrea.io', version: 'v1beta1', resource: 'externalippools', type: 'Antrea External IP Pool' }
          ]

          const seenAntreaPools = new Set<string>()

          const collectAntreaPools = (items: any[], type: string, namespaceHint?: string) => {
            items.forEach((pool: any) => {
              const name = pool.metadata?.name || 'unknown'
              const poolNamespace = pool.metadata?.namespace || namespaceHint
              const dedupeKey = `${type}:${poolNamespace || 'cluster'}:${name}`
              if (seenAntreaPools.has(dedupeKey)) return
              seenAntreaPools.add(dedupeKey)

              const ipRanges = Array.isArray(pool.spec?.ipRanges) ? pool.spec.ipRanges : []
              const addresses = ipRanges
                .map((range: any) => range?.cidr || (range?.start && range?.end ? `${range.start}-${range.end}` : null))
                .filter(Boolean)

              const cidr = pool.spec?.cidr || pool.spec?.subnetInfo?.cidr || addresses.find((addr: string) => addr.includes('/')) || undefined

              result.ipPools.push({
                name,
                cidr: cidr || undefined,
                addresses,
                type,
                namespace: poolNamespace || undefined
              })
            })
          }

          for (const attempt of antreaAttempts) {
            try {
              const antreaPools = await listClusterCustomObjectSafe(
                attempt.group,
                attempt.version,
                attempt.resource
              )

              const items = (antreaPools.body as any)?.items
              if (Array.isArray(items)) {
                collectAntreaPools(items, attempt.type)
              }
            } catch {
              // Cluster scope may fail if resource is namespaced; try namespaced per namespace
              for (const namespace of namespaces) {
                try {
                  const antreaPoolsNs = await listNamespacedCustomObjectSafe(
                    attempt.group,
                    attempt.version,
                    namespace,
                    attempt.resource
                  )

                  const items = (antreaPoolsNs.body as any)?.items
                  if (Array.isArray(items)) {
                    collectAntreaPools(items, attempt.type, namespace)
                  }
                } catch {
                  // Try next namespace/resource variation
                }
              }
            }
          }
        } catch {
          // Antrea might not be installed
        }

      } catch (cniError) {
        // CNI configurations might not be accessible
      }

      // Get subnet information from services
      const servicesResponse = await this.k8sApi.listServiceForAllNamespaces()
      const services: any[] = servicesResponse.body.items || []
      
      const usedIPs = new Set<string>()
      const loadBalancerIPs = new Set<string>()
      const egressIPs = new Set<string>()
      
      services.forEach((service: any) => {
        if (service.spec?.clusterIP && service.spec.clusterIP !== 'None') {
          usedIPs.add(service.spec.clusterIP)
        }
        
        if (service.spec?.type === 'LoadBalancer' && service.status?.loadBalancer?.ingress) {
          service.status.loadBalancer.ingress.forEach((ing: any) => {
            if (ing.ip) {
              loadBalancerIPs.add(ing.ip)
            }
          })
        }
        
        if (service.spec?.externalIPs) {
          service.spec.externalIPs.forEach((ip: string) => egressIPs.add(ip))
        }

        if (service.spec?.loadBalancerIP) {
          egressIPs.add(service.spec.loadBalancerIP)
        }
      })

      result.subnets = [{
        name: 'Service Cluster IPs',
        type: 'ClusterIP',
        usedAddresses: Array.from(usedIPs),
        count: usedIPs.size
      }]

      if (loadBalancerIPs.size > 0) {
        result.subnets.push({
          name: 'LoadBalancer IPs',
          type: 'LoadBalancer',
          usedAddresses: Array.from(loadBalancerIPs),
          count: loadBalancerIPs.size
        })
      }

      if (egressIPs.size > 0) {
        result.subnets.push({
          name: 'Egress IPs',
          type: 'Egress',
          usedAddresses: Array.from(egressIPs),
          count: egressIPs.size
        })
      }

      return result
    } catch (error) {
      console.error('Error fetching IP pools and subnets:', error)
      return {
        ipPools: [],
        subnets: [],
        clusterCIDR: null,
        serviceCIDR: null,
        podCIDR: null
      }
    }
  }

  async detectCNI(): Promise<string> {
    try {
      // Check for common CNI DaemonSets and Deployments
      const daemonSets = await this.listAllDaemonSets()
      const deployments = await this.listAllDeployments()
      
      // Check for Cilium
      if (daemonSets.body.items.some((ds: any) => ds.metadata?.name?.includes('cilium')) ||
          deployments.body.items.some((d: any) => d.metadata?.name?.includes('cilium'))) {
        return 'Cilium'
      }
      
      // Check for Calico
      if (daemonSets.body.items.some((ds: any) => ds.metadata?.name?.includes('calico')) ||
          deployments.body.items.some((d: any) => d.metadata?.name?.includes('calico'))) {
        return 'Calico'
      }
      
      // Check for Flannel
      if (daemonSets.body.items.some((ds: any) => ds.metadata?.name?.includes('flannel'))) {
        return 'Flannel'
      }
      
      // Check for Weave
      if (daemonSets.body.items.some((ds: any) => ds.metadata?.name?.includes('weave'))) {
        return 'Weave Net'
      }
      
      // Check for Canal (Calico + Flannel)
      if (daemonSets.body.items.some((ds: any) => ds.metadata?.name?.includes('canal'))) {
        return 'Canal'
      }
      
      // Check for Antrea
      if (daemonSets.body.items.some((ds: any) => ds.metadata?.name?.includes('antrea'))) {
        return 'Antrea'
      }
      
      return 'Unknown'
    } catch (error) {
      console.warn('Error detecting CNI:', error)
      return 'Unknown'
    }
  }

  async getStorageDrivers(): Promise<string[]> {
    try {
      const storageClasses = await this.storageApi.listStorageClass()
      const storageClassItems: any[] = storageClasses.body.items || []
      const provisioners = new Set<string>()
      
      storageClassItems.forEach((sc: any) => {
        if (sc.provisioner) {
          // Extract friendly name from provisioner
          let driverName = sc.provisioner
          
          // Map common provisioners to friendly names
          if (driverName.includes('openebs.io')) {
            driverName = 'OpenEBS'
          } else if (driverName.includes('rook-ceph')) {
            driverName = 'Rook Ceph'
          } else if (driverName.includes('longhorn')) {
            driverName = 'Longhorn'
          } else if (driverName.includes('portworx')) {
            driverName = 'Portworx'
          } else if (driverName.includes('storageos')) {
            driverName = 'StorageOS'
          } else if (driverName.includes('ebs.csi.aws.com')) {
            driverName = 'AWS EBS'
          } else if (driverName.includes('disk.csi.azure.com')) {
            driverName = 'Azure Disk'
          } else if (driverName.includes('pd.csi.storage.gke.io')) {
            driverName = 'GCE Persistent Disk'
          } else if (driverName.includes('nfs')) {
            driverName = 'NFS'
          } else if (driverName.includes('hostpath')) {
            driverName = 'HostPath'
          } else if (driverName === 'kubernetes.io/no-provisioner') {
            driverName = 'Local Storage'
          }
          
          provisioners.add(driverName)
        }
      })
      
      return Array.from(provisioners).sort()
    } catch (error) {
      console.warn('Error getting storage drivers:', error)
      return []
    }
  }

  async detectIngressControllers(): Promise<string[]> {
    try {
      const ingressControllers = new Set<string>()
      
      // Check for Ingress resources first
      const ingresses = await this.networkingApi.listIngressForAllNamespaces()
      if (ingresses.body.items.length === 0) {
        return [] // No ingresses, so return empty array
      }
      
      // Get deployments and DaemonSets to identify controllers
      const deployments = await this.listAllDeployments()
      const daemonSets = await this.listAllDaemonSets()
      
      // Check for NGINX Ingress
      if (deployments.body.items.some((d: any) => d.metadata?.name?.includes('nginx-ingress') || d.metadata?.name?.includes('ingress-nginx')) ||
          daemonSets.body.items.some((ds: any) => ds.metadata?.name?.includes('nginx-ingress') || ds.metadata?.name?.includes('ingress-nginx'))) {
        ingressControllers.add('NGINX Ingress')
      }
      
      // Check for Traefik
      if (deployments.body.items.some((d: any) => d.metadata?.name?.includes('traefik')) ||
          daemonSets.body.items.some((ds: any) => ds.metadata?.name?.includes('traefik'))) {
        ingressControllers.add('Traefik')
      }
      
      // Check for HAProxy
      if (deployments.body.items.some((d: any) => d.metadata?.name?.includes('haproxy')) ||
          daemonSets.body.items.some((ds: any) => ds.metadata?.name?.includes('haproxy'))) {
        ingressControllers.add('HAProxy')
      }
      
      // Check for Contour
      if (deployments.body.items.some((d: any) => d.metadata?.name?.includes('contour'))) {
        ingressControllers.add('Contour')
      }
      
      // Check for Istio
      if (deployments.body.items.some((d: any) => d.metadata?.name?.includes('istio-ingressgateway'))) {
        ingressControllers.add('Istio')
      }
      
      // Check for Kong
      if (deployments.body.items.some((d: any) => d.metadata?.name?.includes('kong'))) {
        ingressControllers.add('Kong')
      }
      
      // Check for AWS ALB Ingress
      if (deployments.body.items.some((d: any) => d.metadata?.name?.includes('alb-ingress-controller') || d.metadata?.name?.includes('aws-load-balancer-controller'))) {
        ingressControllers.add('AWS ALB')
      }
      
      // Check ingress class from ingress resources
      ingresses.body.items.forEach((ing: any) => {
        const ingressClass = ing.spec?.ingressClassName || ing.metadata?.annotations?.['kubernetes.io/ingress.class']
        if (ingressClass && ingressControllers.size === 0) {
          // If we haven't detected any controller yet, use the class name
          ingressControllers.add(ingressClass.charAt(0).toUpperCase() + ingressClass.slice(1))
        }
      })
      
      return Array.from(ingressControllers).sort()
    } catch (error) {
      console.warn('Error detecting ingress controllers:', error)
      return []
    }
  }

  async getDefaultStorageClass(): Promise<string> {
    try {
      const storageClasses = await this.storageApi.listStorageClass()
      const storageClassItems: any[] = storageClasses.body.items || []
      const defaultSC = storageClassItems.find((sc: any) => 
        sc.metadata?.annotations?.['storageclass.kubernetes.io/is-default-class'] === 'true' ||
        sc.metadata?.annotations?.['storageclass.beta.kubernetes.io/is-default-class'] === 'true'
      )
      
      return defaultSC?.metadata?.name || 'None'
    } catch (error) {
      console.warn('Error getting default storage class:', error)
      return 'Unknown'
    }
  }

}

export async function testClusterConnection(kubeconfig: string, talosconfig?: string): Promise<boolean> {
  try {
    const client = new KubernetesClient(kubeconfig, talosconfig)
    await client.getClusterHealth()
    return true
  } catch (error) {
    console.error('Cluster connection test failed:', error)
    return false
  }
}