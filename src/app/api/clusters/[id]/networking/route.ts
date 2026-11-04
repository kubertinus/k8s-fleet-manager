import { NextRequest, NextResponse } from 'next/server'
import { initializeDatabase, query } from '@/lib/database'
import { KubernetesClient } from '@/lib/kubernetes'
import { getGatewayApi, type GatewayApiData } from '@/lib/gatewayApi'

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

    // Fetch networking data (in parallel). Gateway API is optional: a failure there
    // shouldn't hide the rest.
    const emptyGatewayApi: GatewayApiData = { installed: false, gatewayClasses: [], gateways: [], routes: [] }
    const [ingresses, networkPolicies, services, endpoints, ipPoolsAndSubnets, gatewayApi] = await Promise.all([
      k8sClient.getAllIngresses(),
      k8sClient.getAllNetworkPolicies(),
      k8sClient.getAllServices(),
      k8sClient.getAllEndpoints(),
      k8sClient.getIPPoolsAndSubnets(),
      getGatewayApi(cluster.kubeconfig).catch(error => {
        console.warn('Failed to list Gateway API resources:', error?.message || error)
        return emptyGatewayApi
      }),
    ])

    // Calculate networking statistics
    const totalIngresses = ingresses.length
    const totalNetworkPolicies = networkPolicies.length
    const totalServices = services.length
    const totalEndpoints = endpoints.length

    // Categorize services by type
    const servicesByType = {
      ClusterIP: services.filter((s: any) => s.type === 'ClusterIP').length,
      NodePort: services.filter((s: any) => s.type === 'NodePort').length,
      LoadBalancer: services.filter((s: any) => s.type === 'LoadBalancer').length,
      ExternalName: services.filter((s: any) => s.type === 'ExternalName').length
    }

    // Get load balancer services with external IPs
    const loadBalancers = services.filter((s: any) => 
      s.type === 'LoadBalancer' && (s.externalIPs?.length > 0 || s.loadBalancerIngress?.length > 0)
    )

    // Get ingress with external addresses
    const ingressWithExternal = ingresses.filter((ing: any) => 
      ing.loadBalancerIngress?.length > 0
    )

    const statistics = {
      totalIngresses,
      totalGateways: gatewayApi.gateways.length,
      totalRoutes: gatewayApi.routes.length,
      totalNetworkPolicies,
      totalEndpoints,
      totalIPPools: ipPoolsAndSubnets.ipPools.length,
      totalSubnets: ipPoolsAndSubnets.subnets.length,
      servicesByType,
      loadBalancersWithExternalIP: loadBalancers.length,
      ingressesWithExternalIP: ingressWithExternal.length
    }

    return NextResponse.json({
      ingresses,
      networkPolicies,
      services,
      endpoints,
      loadBalancers,
      statistics,
      ipPoolsAndSubnets,
      gatewayApi
    })

  } catch (error) {
    console.error('Error fetching networking data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch networking data' },
      { status: 500 }
    )
  }
}