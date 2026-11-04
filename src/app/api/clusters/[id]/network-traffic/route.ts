import { NextRequest, NextResponse } from 'next/server'
import { initializeDatabase, query } from '@/lib/database'
import { KubernetesClient } from '@/lib/kubernetes'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeDatabase()
    
    const { id } = await params
    const clusterId = parseInt(id)
    if (isNaN(clusterId)) {
      return NextResponse.json({ error: 'Invalid cluster ID' }, { status: 400 })
    }

    // Get optional namespace filter from query params
    const url = new URL(request.url)
    const namespace = url.searchParams.get('namespace')

    // Get cluster from database
    const clusterResult = await query(
      'SELECT * FROM clusters WHERE id = $1 AND is_active = true',
      [clusterId]
    )

    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
    }

    const cluster = clusterResult.rows[0]
    const k8sClient = new KubernetesClient(cluster.kubeconfig, cluster.talosconfig)

    // Fetch network traffic data
    const [pods, services, endpoints, networkPolicies, namespaces] = await Promise.all([
      k8sClient['k8sApi'].listPodForAllNamespaces(),
      k8sClient.getAllServices(),
      k8sClient.getAllEndpoints(),
      k8sClient.getAllNetworkPolicies(),
      k8sClient['k8sApi'].listNamespace()
    ])

    // Process pods to extract network information
    const processedPods = pods.body.items.map((pod: any) => {
      const podName = pod.metadata?.name || ''
      const podNamespace = pod.metadata?.namespace || ''
      
      // Skip pods not in the requested namespace if filter is applied
      if (namespace && podNamespace !== namespace) {
        return null
      }

      return {
        id: `pod-${podNamespace}-${podName}`,
        name: podName,
        namespace: podNamespace,
        type: 'pod',
        phase: pod.status?.phase || 'Unknown',
        podIP: pod.status?.podIP || null,
        hostIP: pod.status?.hostIP || null,
        nodeName: pod.spec?.nodeName || null,
        labels: pod.metadata?.labels || {},
        annotations: pod.metadata?.annotations || {},
        ownerReferences: pod.metadata?.ownerReferences || [],
        containers: pod.spec?.containers?.map((container: any) => ({
          name: container.name,
          image: container.image,
          ports: container.ports || []
        })) || [],
        // Calculate workload owner (deployment, daemonset, etc.)
        workloadOwner: getWorkloadOwner(pod.metadata?.ownerReferences || [])
      }
    }).filter((pod): pod is NonNullable<typeof pod> => pod !== null)

    // Process services to extract service mesh information
    const processedServices = services.filter((service: any) => {
      // Skip services not in the requested namespace if filter is applied
      if (namespace && service.namespace !== namespace) {
        return false
      }
      return true
    }).map((service: any) => ({
      id: `service-${service.namespace}-${service.name}`,
      name: service.name,
      namespace: service.namespace,
      type: 'service',
      serviceType: service.type,
      clusterIP: service.clusterIP,
      externalIPs: service.externalIPs || [],
      ports: service.ports || [],
      selector: service.selector || {},
      labels: service.labels || {},
      annotations: service.annotations || {}
    }))

    // Process endpoints to map service-to-pod connections
    const processedEndpoints = endpoints.filter((endpoint: any) => {
      // Skip endpoints not in the requested namespace if filter is applied
      if (namespace && endpoint.namespace !== namespace) {
        return false
      }
      return true
    }).map((endpoint: any) => ({
      id: `endpoint-${endpoint.namespace}-${endpoint.name}`,
      name: endpoint.name,
      namespace: endpoint.namespace,
      type: 'endpoint',
      addresses: endpoint.addresses || [],
      ports: endpoint.ports || [],
      subsets: endpoint.subsets || []
    }))

    // Build traffic relationships
    const connections = []
    
    // Service-to-Pod connections via endpoints
    for (const endpoint of processedEndpoints) {
      const matchingService = processedServices.find(s => 
        s.name === endpoint.name && s.namespace === endpoint.namespace
      )
      
      if (matchingService) {
        for (const address of endpoint.addresses) {
          if (address.targetRef?.kind === 'Pod') {
            const targetNamespace = address.targetRef.namespace || endpoint.namespace
            let targetPod = processedPods.find(p => 
              p && p.name === address.targetRef.name && 
              p.namespace === targetNamespace
            )

            if (!targetPod && address.ip) {
              targetPod = processedPods.find(p => 
                p && p.namespace === endpoint.namespace && p.podIP === address.ip
              )
            }
            
            if (targetPod) {
              connections.push({
                id: `${matchingService.id}-to-${targetPod.id}`,
                source: matchingService.id,
                target: targetPod.id,
                type: 'service-to-pod',
                protocol: 'TCP', // Default, could be enhanced
                ports: endpoint.ports.map((p: any) => p.port)
              })
            }
          }
        }
      }
    }

    // Helper functions for pod and service type detection
    const isPostgreSQLService = (service: any) => {
      if (!service?.name && !service?.labels) return false
      
      // Check service name patterns
      const nameMatch = service.name && (
        service.name.toLowerCase().includes('postgres') ||
        service.name.toLowerCase().includes('postgresql') ||
        service.name.toLowerCase().includes('db') ||
        service.name.toLowerCase().includes('database')
      )
      
      // Check service labels
      const labelMatch = service.labels && (
        service.labels?.app?.toLowerCase().includes('postgres') ||
        service.labels?.component?.toLowerCase().includes('database') ||
        service.labels?.['app.kubernetes.io/name']?.toLowerCase().includes('postgres')
      )
      
      // Check if service targets PostgreSQL ports
      const portMatch = service.ports && service.ports.some((p: any) => p.port === 5432)
      
      return nameMatch || labelMatch || portMatch
    }

    const isPostgreSQLPod = (pod: any) => {
      if (!pod?.labels && !pod?.name) return false
      
      // Check labels
      const labelMatch = pod.labels && (
        pod.labels?.app?.toLowerCase().includes('postgres') ||
        pod.labels?.app?.toLowerCase().includes('postgresql') ||
        pod.labels?.component?.toLowerCase().includes('postgres') ||
        pod.labels?.component?.toLowerCase().includes('database') ||
        pod.labels?.['app.kubernetes.io/name']?.toLowerCase().includes('postgres') ||
        pod.labels?.['app.kubernetes.io/component']?.toLowerCase().includes('database') ||
        // Keycloak specific patterns
        (pod.labels?.app === 'keycloak-postgresql' || 
         pod.labels?.component === 'keycloak-postgresql' ||
         pod.labels?.tier === 'database')
      )
      
      // Check pod name
      const nameMatch = pod.name && (
        pod.name.toLowerCase().includes('postgres') ||
        pod.name.toLowerCase().includes('postgresql') ||
        pod.name.toLowerCase().includes('db-') ||
        pod.name.toLowerCase().includes('-db')
      )
      
      // Check container images
      const imageMatch = pod.containers && pod.containers.some((c: any) => 
        c.image?.toLowerCase().includes('postgres') || 
        c.image?.toLowerCase().includes('postgresql')
      )
      
      return labelMatch || nameMatch || imageMatch
    }

    const isDatabasePod = (pod: any) => {
      if (!pod?.labels) return false
      return (
        isPostgreSQLPod(pod) ||
        pod.labels?.app?.includes('mysql') ||
        pod.labels?.app?.includes('mongodb') ||
        pod.labels?.app?.includes('redis') ||
        pod.labels?.component?.includes('database') ||
        pod.labels?.tier === 'database' ||
        pod.labels?.role === 'database'
      )
    }

    const isAppPod = (pod: any) => {
      if (!pod?.labels) return false
      return (
        pod.labels?.app && !isDatabasePod(pod) ||
        pod.labels?.tier === 'frontend' ||
        pod.labels?.tier === 'backend' ||
        pod.labels?.component === 'app' ||
        pod.labels?.component === 'api'
      )
    }

    // Service-to-Pod connections based on service selectors
    for (const service of processedServices) {
      if (service.selector && Object.keys(service.selector).length > 0) {
        for (const pod of processedPods) {
          if (pod && matchesSelector(pod.labels, service.selector)) {
            const existingConnection = connections.find(c => 
              c.source === service.id && c.target === pod.id
            )
            
            if (!existingConnection) {
              connections.push({
                id: `${service.id}-selects-${pod.id}`,
                source: service.id,
                target: pod.id,
                type: 'service-selects-pod',
                protocol: 'TCP',
                ports: service.ports.map((p: any) => p.port)
              })
            }
          }
        }
      }
    }

    // Pod-to-Service connections (applications connecting to services)
    // This captures the pattern: Keycloak pod -> PostgreSQL RW service
    for (const service of processedServices) {
      for (const pod of processedPods) {
        if (!pod || !service) continue
        
        // Skip if they're not in the same namespace
        if (pod.namespace !== service.namespace) continue
        
        const shouldConnectToService = (
          // Only show most important connections to reduce visual clutter
          // Keycloak specific pattern - main use case
          (pod.labels?.app?.includes('keycloak') && service.name?.includes('postgres')) ||
          // RW (read-write) database services - important connections
          (service.name?.includes('-rw') && isAppPod(pod))
        )
        
        if (shouldConnectToService) {
          const existingConnection = connections.find(c => 
            c.source === pod.id && c.target === service.id
          )
          
          if (!existingConnection) {
            connections.push({
              id: `${pod.id}-connects-${service.id}`,
              source: pod.id,
              target: service.id,
              type: 'pod-connects-service',
              protocol: 'TCP',
              ports: service.ports.map((p: any) => p.port)
            })
          }
        }
      }
    }

    // Generate Pod-to-Pod connections based on network patterns
    // This simulates potential pod-to-pod communication based on:
    // 1. Pods in the same namespace with complementary roles
    // 2. Pods with matching app/component labels
    // 3. Database/cache patterns (e.g., app pods connecting to db pods)
    // 4. PostgreSQL specific patterns including replication and clustering
    
    const podsByNamespace = processedPods.reduce((acc: any, pod: any) => {
      if (!pod) return acc
      if (!acc[pod.namespace]) acc[pod.namespace] = []
      acc[pod.namespace].push(pod)
      return acc
    }, {})

    for (const [ns, pods] of Object.entries(podsByNamespace) as [string, any[]][]) {
      for (let i = 0; i < pods.length; i++) {
        for (let j = i + 1; j < pods.length; j++) {
          const pod1 = pods[i]
          const pod2 = pods[j]
          
          if (!pod1 || !pod2) continue
          
          // Generate only the most important pod-to-pod connections to reduce clutter
          const shouldConnect = (
            // PostgreSQL clustering - only show if they're actually related
            (isPostgreSQLPod(pod1) && isPostgreSQLPod(pod2) && 
             pod1.workloadName === pod2.workloadName) ||
            // Primary-replica database relationships - important for DB clusters
            (pod1.labels?.role === 'primary' && pod2.labels?.role === 'replica') ||
            (pod1.labels?.role === 'master' && pod2.labels?.role === 'slave') ||
            // StatefulSet database clustering - only same StatefulSet
            (pod1.workloadOwner === 'StatefulSet' && pod2.workloadOwner === 'StatefulSet' && 
             pod1.workloadName === pod2.workloadName && pod1.id !== pod2.id && 
             isDatabasePod(pod1) && isDatabasePod(pod2))
          )
          
          if (shouldConnect) {
            // Determine appropriate ports based on pod types
            let connectionPorts = [8080, 3000, 80] // Default app ports
            
            if (isPostgreSQLPod(pod1) || isPostgreSQLPod(pod2)) {
              connectionPorts = [5432] // PostgreSQL port
            } else if (isDatabasePod(pod1) || isDatabasePod(pod2)) {
              connectionPorts = [3306, 5432, 27017, 6379] // Various DB ports
            }

            // Bidirectional connections for pod-to-pod communication
            connections.push({
              id: `p2p-${pod1.id}-to-${pod2.id}`,
              source: pod1.id,
              target: pod2.id,
              type: 'pod-to-pod',
              protocol: 'TCP',
              ports: connectionPorts
            })
            
            connections.push({
              id: `p2p-${pod2.id}-to-${pod1.id}`,
              source: pod2.id,
              target: pod1.id,
              type: 'pod-to-pod',
              protocol: 'TCP',
              ports: connectionPorts
            })
          }
        }
      }
    }

    // Process network policies for traffic restrictions
    const trafficPolicies = networkPolicies.filter((policy: any) => {
      // Skip policies not in the requested namespace if filter is applied
      if (namespace && policy.namespace !== namespace) {
        return false
      }
      return true
    }).map((policy: any) => ({
      id: `policy-${policy.namespace}-${policy.name}`,
      name: policy.name,
      namespace: policy.namespace,
      type: 'network-policy',
      podSelector: policy.podSelector || {},
      policyTypes: policy.policyTypes || [],
      ingress: policy.ingress || [],
      egress: policy.egress || []
    }))

    // Get available namespaces for the filter dropdown
    const availableNamespaces = namespaces.body.items.map((ns: any) => ({
      name: ns.metadata?.name || '',
      status: ns.status?.phase || 'Unknown',
      labels: ns.metadata?.labels || {}
    })).filter((ns: any) => {
      // Filter out system namespaces unless specifically requested
      const systemNamespaces = ['kube-system', 'kube-public', 'kube-node-lease']
      return !systemNamespaces.includes(ns.name) || namespace === ns.name
    })

    // Calculate network statistics for the filtered namespace
    const stats = {
      totalPods: processedPods.length,
      totalServices: processedServices.length,
      totalEndpoints: processedEndpoints.length,
      totalConnections: connections.length,
      totalNetworkPolicies: trafficPolicies.length,
      podsWithNetworkPolicies: 0, // Will calculate based on policy selectors
      exposedServices: processedServices.filter(s => 
        s.serviceType === 'LoadBalancer' || s.serviceType === 'NodePort'
      ).length
    }

    // Debug information for PostgreSQL detection
    if (namespace === 'keycloak' || !namespace) {
      const postgresqlPods = processedPods.filter(pod => isPostgreSQLPod(pod))
      const podToPodConnections = connections.filter(c => c.type === 'pod-to-pod')
      
      console.log(`[DEBUG] Namespace: ${namespace || 'all'}`)
      console.log(`[DEBUG] Total pods: ${processedPods.length}`)
      console.log(`[DEBUG] PostgreSQL pods found: ${postgresqlPods.length}`)
      postgresqlPods.forEach(pod => {
        console.log(`[DEBUG] PostgreSQL pod: ${pod.name} in ${pod.namespace} with labels:`, pod.labels)
      })
      console.log(`[DEBUG] Pod-to-pod connections: ${podToPodConnections.length}`)
      podToPodConnections.forEach(conn => {
        const sourcePod = processedPods.find(p => p.id === conn.source)
        const targetPod = processedPods.find(p => p.id === conn.target)
        console.log(`[DEBUG] P2P: ${sourcePod?.name} -> ${targetPod?.name} (ports: ${conn.ports.join(',')})`)
      })
      
      const podToServiceConnections = connections.filter(c => c.type === 'pod-connects-service')
      const serviceToParadigm = connections.filter(c => c.type === 'service-selects-pod')
      console.log(`[DEBUG] Pod-to-service connections: ${podToServiceConnections.length}`)
      podToServiceConnections.forEach(conn => {
        const sourcePod = [...processedPods, ...processedServices].find(p => p.id === conn.source)
        const targetService = [...processedPods, ...processedServices].find(p => p.id === conn.target)
        console.log(`[DEBUG] APP: ${sourcePod?.name} -> ${targetService?.name} (ports: ${conn.ports.join(',')})`)
      })
      
      console.log(`[DEBUG] Service-to-pod connections: ${serviceToParadigm.length}`)
      serviceToParadigm.forEach(conn => {
        const sourceService = [...processedPods, ...processedServices].find(p => p.id === conn.source)
        const targetPod = [...processedPods, ...processedServices].find(p => p.id === conn.target)
        console.log(`[DEBUG] SEL: ${sourceService?.name} -> ${targetPod?.name} (ports: ${conn.ports.join(',')})`)
      })
    }

    return NextResponse.json({
      namespace: namespace || 'all',
      pods: processedPods,
      services: processedServices,
      endpoints: processedEndpoints,
      connections,
      networkPolicies: trafficPolicies,
      availableNamespaces,
      statistics: stats
    })

  } catch (error) {
    console.error('Error fetching network traffic data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch network traffic data' },
      { status: 500 }
    )
  }
}

// Helper function to determine workload owner from owner references
function getWorkloadOwner(ownerReferences: any[]): string | null {
  for (const owner of ownerReferences) {
    if (['ReplicaSet', 'Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(owner.kind)) {
      return owner.kind === 'ReplicaSet' ? 'Deployment' : owner.kind
    }
  }
  return null
}

// Helper function to check if pod labels match service selector
function matchesSelector(podLabels: Record<string, string>, selector: Record<string, string>): boolean {
  if (!selector || Object.keys(selector).length === 0) {
    return true
  }
  
  for (const [key, value] of Object.entries(selector)) {
    if (podLabels[key] !== value) {
      return false
    }
  }
  
  return true
}