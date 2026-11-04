import { NextRequest, NextResponse } from 'next/server'
import { query } from '../../../lib/database'
import { KubernetesClient } from '../../../lib/kubernetes'

export async function GET(request: NextRequest) {
  try {
    // Get first cluster to test with
    const clusterResult = await query(
      'SELECT * FROM clusters WHERE is_active = true LIMIT 1'
    )
    
    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'No clusters found' }, { status: 404 })
    }
    
    const cluster = clusterResult.rows[0]
    const client = new KubernetesClient(cluster.kubeconfig, cluster.talosconfig)
    
    // Get nodes
    const nodesResponse = await client['k8sApi'].listNode()
    const nodes = nodesResponse.body.items
    
    const results = []
    
    for (const node of nodes.slice(0, 2)) { // Test first 2 nodes only
      const nodeName = node.metadata?.name || ''
      const addresses = (node.status?.addresses || [])
      const internalIP = addresses.find((addr: any) => addr.type === 'InternalIP')?.address
      
      if (internalIP) {
        console.log(`\n=== Testing Talos API for ${nodeName} (${internalIP}) ===`)
        
        const startTime = Date.now()
        try {
          const diskInfo = await client.getTalosDiskUsage(internalIP)
          const duration = Date.now() - startTime
          results.push({
            node: nodeName,
            ip: internalIP,
            success: !!diskInfo,
            duration: `${duration}ms`,
            diskInfo: diskInfo ? {
              totalGB: (diskInfo.total / 1024 / 1024 / 1024).toFixed(2),
              usedGB: (diskInfo.used / 1024 / 1024 / 1024).toFixed(2),
              availableGB: (diskInfo.available / 1024 / 1024 / 1024).toFixed(2),
              usedPercent: ((diskInfo.used / diskInfo.total) * 100).toFixed(1)
            } : null,
            rawDiskInfo: diskInfo
          })
        } catch (error: any) {
          const duration = Date.now() - startTime
          results.push({
            node: nodeName,
            ip: internalIP,
            success: false,
            duration: `${duration}ms`,
            error: error.message,
            errorStack: error.stack
          })
        }
      } else {
        results.push({
          node: nodeName,
          ip: 'NO_INTERNAL_IP',
          success: false,
          error: 'No internal IP found'
        })
      }
    }
    
    return NextResponse.json({
      cluster: cluster.name,
      results
    })
  } catch (error: any) {
    console.error('Test failed:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
