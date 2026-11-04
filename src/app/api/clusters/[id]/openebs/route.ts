import { NextRequest, NextResponse } from 'next/server'
import { KubernetesClient } from '../../../../../lib/kubernetes'
import { query } from '../../../../../lib/database'

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
    
    // Get OpenEBS info (this is the slow operation)
    const openebsInfo = await client.detectOpenEBS()
    
    return NextResponse.json(openebsInfo)
  } catch (error) {
    console.error('Error fetching OpenEBS info:', error)
    return NextResponse.json(
      { error: 'Failed to fetch OpenEBS info' },
      { status: 500 }
    )
  }
}
