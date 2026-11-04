import { NextRequest, NextResponse } from 'next/server'
import { KubernetesClient } from '../../../../../lib/kubernetes'
import { query } from '../../../../../lib/database'
import { getClusterHealthCached } from '../../../../../lib/healthCache'
import { parseQuantity } from '../../../../../lib/quantity'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const resolvedParams = await params
    const clusterId = parseInt(resolvedParams.id)
    
    // Get cluster from database
    const clusterResult = await query(
      'SELECT * FROM clusters WHERE id = $1 AND is_active = true',
      [clusterId]
    )
    
    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
    }
    
    const cluster = clusterResult.rows[0]
    const client = new KubernetesClient(cluster.kubeconfig, cluster.talosconfig)
    
    // Status and versions come from the shared health cache instead of a full
    // health check per request; the detail lists below are fetched in parallel.
    const [
      { data: health },
      nodes,
      pods,
      namespaces,
      services,
      deployments
    ] = await Promise.all([
      getClusterHealthCached(cluster),
      getDetailedNodes(client),
      getDetailedPods(client),
      getNamespaces(client),
      getServices(client),
      getDeployments(client)
    ])
    
    // Calculate metrics
    const metrics = calculateClusterMetrics(nodes, pods, services, deployments)
    
    // Get Talos information (mock for now, would use actual Talos API)
    // Talos info and OpenEBS detection don't depend on each other
    const [talosInfo, openebsInfo] = await Promise.all([
      getTalosInfo(cluster.talosconfig, nodes),
      detectOpenEBS(client)
    ])
    
    // Load heavy operations in background (non-blocking)
    // Frontend will load these separately when needed
    const clusterDetails = {
      id: cluster.id,
      name: cluster.name,
      endpoint: cluster.endpoint,
      description: cluster.description,
      kubernetesVersion: (health.kubernetesVersion as string) || 'Unknown',
      talosVersion: (health.talosVersion as string) || 'Unknown',
      status: health.status,
      nodes,
      pods,
      namespaces,
      services,
      deployments,
      metrics,
      talosInfo,
      openebsInfo,
      images: [] // Placeholder - load via separate endpoint
    }
    
    return NextResponse.json(clusterDetails)
  } catch (error) {
    console.error('Error fetching cluster details:', error)
    return NextResponse.json(
      { error: 'Failed to fetch cluster details' },
      { status: 500 }
    )
  }
}

async function getDetailedNodes(client: KubernetesClient): Promise<any[]> {
  try {
    const nodesResponse = await client['k8sApi'].listNode()
    const nodes = nodesResponse.body.items
    
    // Try to get metrics
    let nodeMetrics: any[] = []
    try {
      const metricsResponse = await client['metricsApi'].getNodeMetrics()
      nodeMetrics = metricsResponse.items
    } catch (error) {
      console.warn('Failed to fetch node metrics:', error)
    }
    
    // Get disk usage from Talos API for each node
    const nodePromises = nodes.map(async (node: any) => {
      const nodeName = node.metadata?.name || ''
      const nodeMetric = nodeMetrics.find(m => m.metadata.name === nodeName)
      
      // Parse capacity and usage with proper functions
      const cpuCapacity = parseCpuResource(node.status?.capacity?.cpu || '0')
      const memoryCapacity = parseMemoryResource(node.status?.capacity?.memory || '0')
      const cpuUsage = nodeMetric ? parseCpuResource(nodeMetric.usage.cpu, cpuCapacity) : 0
      const memoryUsage = nodeMetric ? parseMemoryResource(nodeMetric.usage.memory) : 0
      
      // Get node conditions
      const conditions = (node.status?.conditions || []).map((condition: any) => ({
        type: condition.type,
        status: condition.status,
        lastTransitionTime: condition.lastTransitionTime,
        reason: condition.reason || '',
        message: condition.message || ''
      }))
      
      // Get node taints
      const taints = (node.spec?.taints || []).map((taint: any) => ({
        key: taint.key,
        value: taint.value,
        effect: taint.effect
      }))
      
      // Get node addresses
      const addresses = (node.status?.addresses || []).map((addr: any) => ({
        type: addr.type,
        address: addr.address
      }))
      
      // Determine node roles
      const labels = node.metadata?.labels || {}
      const rawTaints = (node.spec?.taints || [])
      const roles = []
      
      // Check for control plane indicators
      const isControlPlane = 'node-role.kubernetes.io/control-plane' in labels || 
                           'node-role.kubernetes.io/master' in labels ||
                           labels['kubernetes.io/hostname']?.includes('master') ||
                           labels['node.kubernetes.io/instance-type']?.includes('master') ||
                           // Check for control plane taints
                           rawTaints.some((taint: any) => 
                             taint.key === 'node-role.kubernetes.io/control-plane' ||
                             taint.key === 'node-role.kubernetes.io/master'
                           ) ||
                           // Check for etcd or api-server pods (indicating control plane)
                           node.metadata?.name?.includes('master') ||
                           node.metadata?.name?.includes('control')
      
      if (isControlPlane) {
        roles.push('control-plane')
      }
      
      // Check for explicit worker role or default behavior
      if ('node-role.kubernetes.io/worker' in labels) {
        roles.push('worker')
      }
      
      // If no roles determined and not control plane, default to worker
      if (roles.length === 0) {
        roles.push('worker')
      }
      
      // Determine status
      const isReady = conditions.some((c: any) => c.type === 'Ready' && c.status === 'True')
      const isCordoned = node.spec?.unschedulable === true
      let status = 'NotReady'
      if (isCordoned) {
        status = isReady ? 'Cordoned' : 'CordonedNotReady'
      } else if (isReady) {
        status = 'Ready'
      }
      
      // Get filesystem information (boot disk space)
      // For Talos nodes, try to get actual disk usage from Talos API first
      
      // Get node internal IP for Talos API call
      const internalIP = addresses.find((addr: any) => addr.type === 'InternalIP')?.address
      
      let bootDiskCapacity = 0
      let bootDiskUsage = 0
      let bootDiskAvailable = 0
      let diskFromTalos = false
      
      // PERFORMANCE: Skip Talos API calls entirely for faster loading
      // Talos disk calls can be slow and cause page load delays
      // TODO: Move to background job or separate endpoint if real-time disk data is needed
      const ENABLE_TALOS_DISK_CALLS = false
      
      // Try to get disk info from Talos API if we have the node IP
      if (ENABLE_TALOS_DISK_CALLS && internalIP) {
        try {
          console.log(`[API] Attempting to get Talos disk info for node ${nodeName} (${internalIP})`)
          // Add timeout to prevent slow Talos API from blocking the response
          const talosDiskInfo = await Promise.race([
            client.getTalosDiskUsage(internalIP),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)) // 2 second timeout
          ])
          if (talosDiskInfo && talosDiskInfo.total > 0) {
            bootDiskCapacity = talosDiskInfo.total
            bootDiskUsage = talosDiskInfo.used
            bootDiskAvailable = talosDiskInfo.available
            diskFromTalos = true
            console.log(`[API] SUCCESS: Got Talos disk info for ${nodeName}: ${(bootDiskCapacity / 1024 / 1024 / 1024).toFixed(2)} GB total, ${((bootDiskUsage / bootDiskCapacity) * 100).toFixed(1)}% used`)
          } else {
            console.log(`[API] No Talos disk info returned for ${nodeName} (timeout or no data), falling back to estimation`)
          }
        } catch (error) {
          console.warn(`[API] Failed to get Talos disk info for node ${nodeName}:`, error)
        }
      } else {
        if (!ENABLE_TALOS_DISK_CALLS) {
          console.log(`[API] Talos disk calls disabled for performance - using estimation for ${nodeName}`)
        } else {
          console.log(`[API] No internal IP found for node ${nodeName}, skipping Talos API call`)
        }
      }
      
      // Fallback: If we couldn't get disk info from Talos API, use configuration or estimation
      if (!diskFromTalos) {
        // Check if we have actual disk info from node labels or annotations
        const diskSizeLabel = labels['node.kubernetes.io/disk-size'] || 
                             labels['k8s-fleet-manager.io/disk-size'] ||
                             node.metadata?.annotations?.['k8s-fleet-manager.io/disk-size'] ||
                             // Label used before the rename to K8s Fleet Manager
                             labels['kubertinus.io/disk-size'] ||
                             node.metadata?.annotations?.['kubertinus.io/disk-size']
        
        if (diskSizeLabel) {
          // If we have a custom label with disk size, use it
          bootDiskCapacity = parseMemoryResource(diskSizeLabel)
        } else {
          // Default disk sizes based on node role
          const isControlPlane = roles.includes('control-plane')
          
          if (isControlPlane) {
            // Control plane nodes: 32GB
            bootDiskCapacity = 32 * 1024 * 1024 * 1024
          } else {
            // Worker nodes: 100GB
            bootDiskCapacity = 100 * 1024 * 1024 * 1024
          }
          // Override this by adding a label: kubectl label node <name> k8s-fleet-manager.io/disk-size=<size>Gi
        }
        
        // Estimate usage based on ephemeral storage usage patterns and node-specific data
        const ephemeralCapacity = parseMemoryResource(node.status?.capacity?.['ephemeral-storage'] || '0')
        const ephemeralAllocatable = parseMemoryResource(node.status?.allocatable?.['ephemeral-storage'] || '0')
        
        if (ephemeralCapacity > 0 && ephemeralAllocatable > 0) {
          // Calculate what percentage of ephemeral is "used" (reserved by system)
          const ephemeralReservedPercent = (ephemeralCapacity - ephemeralAllocatable) / ephemeralCapacity
          
          // Add variation based on node CPU and memory usage to make disks look different
          const cpuUsagePercent = cpuUsage / cpuCapacity
          const memUsagePercent = memoryUsage / memoryCapacity
          const avgResourceUsage = (cpuUsagePercent + memUsagePercent) / 2
          
          // Estimate disk usage: base from ephemeral + factor based on actual resource usage
          // This makes nodes with higher CPU/memory usage show higher disk usage (typically correlated)
          const estimatedUsagePercent = Math.min(0.85, Math.max(0.15, 
            ephemeralReservedPercent * 0.5 + avgResourceUsage * 0.3 + 0.15
          ))
          
          bootDiskUsage = bootDiskCapacity * estimatedUsagePercent
          bootDiskAvailable = bootDiskCapacity - bootDiskUsage
          
          console.log(`[API] Estimated disk for ${nodeName}: ${(estimatedUsagePercent * 100).toFixed(1)}% (ephemeral: ${(ephemeralReservedPercent * 100).toFixed(1)}%, resources: ${(avgResourceUsage * 100).toFixed(1)}%)`)
        } else {
          // Default: 30% usage
          bootDiskUsage = bootDiskCapacity * 0.3
          bootDiskAvailable = bootDiskCapacity * 0.7
        }
        
        // Look for DiskPressure condition which indicates high disk usage
        const diskPressureCondition = conditions.find((c: any) => c.type === 'DiskPressure')
        if (diskPressureCondition?.status === 'True' && bootDiskCapacity > 0) {
          // High disk usage indicated by DiskPressure
          bootDiskUsage = bootDiskCapacity * 0.85
          bootDiskAvailable = bootDiskCapacity * 0.15
        }
      }

      return {
        name: nodeName,
        status,
        roles,
        version: node.status?.nodeInfo?.kubeletVersion || 'Unknown',
        osImage: node.status?.nodeInfo?.osImage || 'Unknown',
        kernelVersion: node.status?.nodeInfo?.kernelVersion || 'Unknown',
        containerRuntime: node.status?.nodeInfo?.containerRuntimeVersion || 'Unknown',
        cpuCapacity,
        memoryCapacity,
        cpuUsage,
        memoryUsage,
        bootDiskCapacity,
        bootDiskUsage,
        bootDiskAvailable,
        conditions,
        taints,
        labels,
        addresses,
        allocatable: node.status?.allocatable || {},
        createdAt: node.metadata?.creationTimestamp || new Date().toISOString()
      }
    })
    
    return await Promise.all(nodePromises)
  } catch (error) {
    console.error('Error fetching detailed nodes:', error)
    return []
  }
}

async function getDetailedPods(client: KubernetesClient): Promise<any[]> {
  try {
    const podsResponse = await client['k8sApi'].listPodForAllNamespaces()
    const pods = podsResponse.body.items
    
    // Get pod metrics
    let podMetrics: any[] = []
    try {
      const metricsResponse = await client['metricsApi'].getPodMetrics()
      podMetrics = metricsResponse.items
    } catch (error) {
      console.warn('Failed to fetch pod metrics:', error)
    }
    
    return pods.map((pod: any) => {
      const containers = (pod.spec?.containers || []).map((container: any) => {
        const containerStatus = (pod.status?.containerStatuses || []).find((cs: any) => cs.name === container.name)
        return {
          name: container.name,
          image: container.image,
          status: containerStatus?.state ? Object.keys(containerStatus.state)[0] : 'unknown',
          ready: containerStatus?.ready || false,
          restartCount: containerStatus?.restartCount || 0,
          resources: {
            requests: container.resources?.requests || {},
            limits: container.resources?.limits || {}
          }
        }
      })
      
      const readyContainers = containers.filter((c: any) => c.ready).length
      const totalContainers = containers.length
      
      // Calculate total resource requests and limits for all containers in the pod
      const totalResources = containers.reduce((total: any, container: any) => {
        const requests = container.resources.requests
        const limits = container.resources.limits
        
        // CPU requests/limits
        if (requests.cpu) {
          total.requests.cpu += parseCpuValue(requests.cpu)
        }
        if (limits.cpu) {
          total.limits.cpu += parseCpuValue(limits.cpu)
        }
        
        // Memory requests/limits
        if (requests.memory) {
          total.requests.memory += parseMemoryValue(requests.memory)
        }
        if (limits.memory) {
          total.limits.memory += parseMemoryValue(limits.memory)
        }
        
        return total
      }, {
        requests: { cpu: 0, memory: 0 },
        limits: { cpu: 0, memory: 0 }
      })
      
      // Find current usage metrics for this pod
      const podMetric = podMetrics.find(metric => 
        metric.metadata.name === pod.metadata?.name && 
        metric.metadata.namespace === pod.metadata?.namespace
      )
      
      let currentUsage = {
        cpu: 0,
        memory: 0
      }
      
      if (podMetric && podMetric.containers) {
        currentUsage = podMetric.containers.reduce((total: any, container: any) => {
          if (container.usage) {
            if (container.usage.cpu) {
              total.cpu += parseCpuValue(container.usage.cpu)
            }
            if (container.usage.memory) {
              total.memory += parseMemoryValue(container.usage.memory)
            }
          }
          return total
        }, { cpu: 0, memory: 0 })
      }
      
      return {
        name: pod.metadata?.name || '',
        namespace: pod.metadata?.namespace || '',
        status: pod.status?.phase || 'Unknown',
        restarts: containers.reduce((sum: number, c: any) => sum + c.restartCount, 0),
        age: formatAge(pod.metadata?.creationTimestamp || ''),
        node: pod.spec?.nodeName || 'Unknown',
        ready: `${readyContainers}/${totalContainers}`,
        containers,
        resources: {
          requests: {
            cpu: formatCpuValue(totalResources.requests.cpu),
            memory: formatMemoryValue(totalResources.requests.memory)
          },
          limits: {
            cpu: formatCpuValue(totalResources.limits.cpu),
            memory: formatMemoryValue(totalResources.limits.memory)
          }
        },
        currentUsage: {
          cpu: formatCpuValue(currentUsage.cpu),
          memory: formatMemoryValue(currentUsage.memory)
        }
      }
    })
  } catch (error) {
    console.error('Error fetching detailed pods:', error)
    return []
  }
}

// Helper functions to parse and format resource values
function parseCpuValue(cpu: string): number {
  // Millicores from a Kubernetes quantity ("250m", "24081u", "123456789n", "2")
  const cores = parseQuantity(cpu)
  return Number.isFinite(cores) ? cores * 1000 : 0
}

function parseMemoryValue(memory: string): number {
  const bytes = parseQuantity(memory)
  return Number.isFinite(bytes) ? bytes : 0
}

function formatCpuValue(milliCpu: number): string {
  if (milliCpu === 0) return '-'
  if (milliCpu < 1) {
    return '<1m'
  }
  if (milliCpu < 1000) {
    return `${Math.round(milliCpu)}m`
  }
  return `${(milliCpu / 1000).toFixed(2)}`
}

function formatMemoryValue(bytes: number): string {
  if (bytes === 0) return '-'
  const units = [
    { unit: 'Ti', size: 1024 * 1024 * 1024 * 1024 },
    { unit: 'Gi', size: 1024 * 1024 * 1024 },
    { unit: 'Mi', size: 1024 * 1024 },
    { unit: 'Ki', size: 1024 }
  ]
  
  for (const { unit, size } of units) {
    if (bytes >= size) {
      return `${Math.round(bytes / size)}${unit}`
    }
  }
  return `${bytes}B`
}

async function getNamespaces(client: KubernetesClient): Promise<any[]> {
  try {
    const namespacesResponse = await client['k8sApi'].listNamespace()
    const namespaces = namespacesResponse.body.items
    
    return namespaces.map((ns: any) => ({
      name: ns.metadata?.name || '',
      status: ns.status?.phase || 'Unknown',
      age: formatAge(ns.metadata?.creationTimestamp || ''),
      labels: ns.metadata?.labels || {}
    }))
  } catch (error) {
    console.error('Error fetching namespaces:', error)
    return []
  }
}

async function getServices(client: KubernetesClient): Promise<any[]> {
  try {
    const servicesResponse = await client['k8sApi'].listServiceForAllNamespaces()
    const services = servicesResponse.body.items
    
    return services.map((service: any) => {
      const ports = (service.spec?.ports || []).map((port: any) => ({
        name: port.name,
        port: port.port,
        targetPort: port.targetPort,
        protocol: port.protocol
      }))
      
      return {
        name: service.metadata?.name || '',
        namespace: service.metadata?.namespace || '',
        type: service.spec?.type || 'ClusterIP',
        clusterIP: service.spec?.clusterIP || '',
        externalIP: (service.status?.loadBalancer?.ingress || []).map((ing: any) => ing.ip || ing.hostname).join(', ') || '',
        ports,
        age: formatAge(service.metadata?.creationTimestamp || '')
      }
    })
  } catch (error) {
    console.error('Error fetching services:', error)
    return []
  }
}

async function getDeployments(client: KubernetesClient): Promise<any[]> {
  try {
    const deploymentsResponse = await client['appsApi'].listDeploymentForAllNamespaces()
    const deployments = deploymentsResponse.body.items
    
    return deployments.map((deployment: any) => {
      const replicas = deployment.spec?.replicas || 0
      const readyReplicas = deployment.status?.readyReplicas || 0
      const updatedReplicas = deployment.status?.updatedReplicas || 0
      const availableReplicas = deployment.status?.availableReplicas || 0
      
      // Extract container images
      const images = (deployment.spec?.template?.spec?.containers || []).map((container: any) => container.image)
      
      return {
        name: deployment.metadata?.name || '',
        namespace: deployment.metadata?.namespace || '',
        ready: `${readyReplicas}/${replicas}`,
        upToDate: updatedReplicas,
        available: availableReplicas,
        age: formatAge(deployment.metadata?.creationTimestamp || ''),
        images,
        replicas,
        readyReplicas,
        updatedReplicas,
        availableReplicas,
        conditions: deployment.status?.conditions || [],
        labels: deployment.metadata?.labels || {},
        annotations: deployment.metadata?.annotations || {}
      }
    })
  } catch (error) {
    console.error('Error fetching deployments:', error)
    return []
  }
}

function calculateClusterMetrics(nodes: any[], pods: any[], services: any[], deployments: any[]) {
  const totalCPU = nodes.reduce((sum, node) => sum + node.cpuCapacity, 0)
  const totalMemory = nodes.reduce((sum, node) => sum + node.memoryCapacity, 0)
  const usedCPU = nodes.reduce((sum, node) => sum + node.cpuUsage, 0)
  const usedMemory = nodes.reduce((sum, node) => sum + node.memoryUsage, 0)
  
  return {
    totalCPU,
    totalMemory,
    usedCPU,
    usedMemory,
    podCount: pods.length,
    serviceCount: services.length,
    deploymentCount: deployments.length
  }
}

async function getTalosInfo(talosconfig: string | null, nodes: any[]) {
  // Mock Talos information - in a real implementation, this would use the Talos API
  const machineConfigs = nodes.map((node, index) => {
    const isControlPlane = node.roles.includes('control-plane')
    return {
      nodeName: node.name,
      machineType: isControlPlane ? 'controlplane' : 'worker',
      talosVersion: extractTalosVersion(node.osImage) || 'Unknown',
      kubernetesVersion: node.version,
      platform: 'metal' // Could be extracted from node labels
    }
  })
  
  // Mock ETCD members (would come from Talos API)
  const etcdMembers = nodes
    .filter(node => node.roles.includes('control-plane'))
    .map((node, index) => ({
      id: `etcd-${index}`,
      name: node.name,
      peerURLs: [`https://${node.addresses.find((a: any) => a.type === 'InternalIP')?.address || 'unknown'}:2380`],
      clientURLs: [`https://${node.addresses.find((a: any) => a.type === 'InternalIP')?.address || 'unknown'}:2379`],
      isLearner: false
    }))
  
  // Mock system services
  const systemServices = [
    { id: 'apid', state: 'Running', health: 'Healthy', events: [] },
    { id: 'containerd', state: 'Running', health: 'Healthy', events: [] },
    { id: 'cri', state: 'Running', health: 'Healthy', events: [] },
    { id: 'etcd', state: 'Running', health: 'Healthy', events: [] },
    { id: 'kubelet', state: 'Running', health: 'Healthy', events: [] },
    { id: 'machined', state: 'Running', health: 'Healthy', events: [] },
    { id: 'trustd', state: 'Running', health: 'Healthy', events: [] }
  ]
  
  return {
    machineConfigs,
    etcdMembers,
    systemServices
  }
}

async function detectOpenEBS(client: KubernetesClient): Promise<any> {
  try {
    // Check for OpenEBS namespaces (common ones)
    const namespacesResponse = await client['k8sApi'].listNamespace()
    const namespaces = namespacesResponse.body.items
    const openebsNamespaces = namespaces.filter((ns: any) => 
      ns.metadata?.name?.includes('openebs') || ns.metadata?.name === 'mayastor'
    )
    
    if (openebsNamespaces.length === 0) {
      // No OpenEBS namespaces found
      return { 
        installed: false, 
        version: undefined, 
        namespaces: [], 
        storageClasses: [], 
        volumes: [], 
        storagePools: [], 
        nodes: [] 
      }
    }
    
    // OpenEBS is installed, get version from deployments
    let version = undefined
    try {
      for (const ns of openebsNamespaces) {
        const nsName = ns.metadata?.name
        if (!nsName) continue
        const deploymentsResponse = await client['appsApi'].listNamespacedDeployment(nsName)
        const mayastorDeployment = deploymentsResponse.body.items.find((d: any) => 
          d.metadata?.name?.includes('operator') || d.metadata?.name?.includes('controller')
        )
        if (mayastorDeployment) {
          const image = mayastorDeployment.spec?.template?.spec?.containers?.[0]?.image || ''
          const versionMatch = image.match(/:v?(\d+\.\d+\.\d+)/)
          if (versionMatch) {
            version = versionMatch[1]
            break
          }
        }
      }
    } catch (error) {
      console.warn('Failed to detect OpenEBS version:', error)
    }
    
    return { 
      installed: true, 
      version, 
      namespaces: openebsNamespaces.map((ns: any) => ns.metadata?.name || ''), 
      storageClasses: [], // Will be loaded by separate endpoint
      volumes: [], // Will be loaded by separate endpoint
      storagePools: [], // Will be loaded by separate endpoint
      nodes: [] // Will be loaded by separate endpoint
    }
  } catch (error) {
    console.error('Error detecting OpenEBS:', error)
    return { 
      installed: false, 
      version: undefined, 
      namespaces: [], 
      storageClasses: [], 
      volumes: [], 
      storagePools: [], 
      nodes: [] 
    }
  }
}

function extractTalosVersion(osImage: string): string | null {
  const match = osImage.match(/Talos.*?v?(\d+\.\d+\.\d+)/)
  return match ? `v${match[1]}` : null
}

function parseResource(resource: string): number {
  const value = parseQuantity(resource)
  return Number.isFinite(value) ? value : 0
}

function parseCpuResource(resource: string, expectedCapacityCores?: number): number {
  if (!resource) return 0
  
  // Remove any whitespace
  resource = resource.trim()
  
  // Quantity with a unit ("123456789n", "24081u", "250m")
  if (/[a-zA-Z]$/.test(resource)) {
    const cores = parseQuantity(resource)
    return Number.isFinite(cores) ? cores : 0
  }
  
  const numericValue = parseFloat(resource)
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0
  }

  if (expectedCapacityCores && expectedCapacityCores > 0) {
    const maxReasonableUsage = Math.max(expectedCapacityCores * 4, 1)
    const candidates = [
      numericValue,
      numericValue / 1000,
      numericValue / 1000000,
      numericValue / 1000000000
    ]

    const plausible = candidates.find((candidate) => Number.isFinite(candidate) && candidate >= 0 && candidate <= maxReasonableUsage)
    if (plausible !== undefined) {
      return plausible
    }
  }

  return numericValue
}

function parseMemoryResource(resource: string): number {
  if (!resource) return 0
  const bytes = parseQuantity(resource)
  if (Number.isFinite(bytes)) return bytes
  // Non-Kubernetes notations (e.g. a "100GB" disk-size label): use the number as is, as before
  return parseFloat(resource) || 0
}

function formatAge(dateString: string): string {
  if (!dateString) return 'Unknown'
  
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  
  if (days > 0) return `${days}d`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}