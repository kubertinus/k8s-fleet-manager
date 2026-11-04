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
    
    // Get events from the last hour
    const events = await getRecentEvents(client)
    
    return NextResponse.json({ events })
  } catch (error) {
    console.error('Error fetching cluster events:', error)
    return NextResponse.json(
      { error: 'Failed to fetch cluster events' },
      { status: 500 }
    )
  }
}

async function getRecentEvents(client: KubernetesClient): Promise<any[]> {
  try {
    const eventsResponse = await client['k8sApi'].listEventForAllNamespaces()
    const events = eventsResponse.body.items
    
    // Calculate 1 hour ago
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    
    // Filter events from the last hour
    const recentEvents = events.filter((event: any) => {
      const eventTime = new Date(event.lastTimestamp || event.eventTime || 0)
      return eventTime >= oneHourAgo
    })
    
    // Sort by last timestamp, most recent first
    recentEvents.sort((a: any, b: any) => {
      const timeA = new Date(a.lastTimestamp || a.eventTime || 0).getTime()
      const timeB = new Date(b.lastTimestamp || b.eventTime || 0).getTime()
      return timeB - timeA
    })
    
    return recentEvents.map((event: any) => ({
      type: event.type || 'Normal',
      reason: event.reason || '',
      object: `${event.involvedObject?.kind || 'Unknown'}/${event.involvedObject?.name || 'Unknown'}`,
      namespace: event.namespace || 'default',
      message: event.message || '',
      firstTime: event.firstTimestamp || event.eventTime || '',
      lastTime: event.lastTimestamp || event.eventTime || '',
      count: event.count || 1
    }))
  } catch (error) {
    console.error('Error fetching events:', error)
    return []
  }
}