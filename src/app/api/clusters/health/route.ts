import { NextRequest, NextResponse } from 'next/server'
import { query, initializeDatabase } from '@/lib/database'
import { verifyToken } from '@/lib/auth'
import { KubernetesClient } from '@/lib/kubernetes'

export async function GET(request: NextRequest) {
  try {
    // Initialize database on first request
    await initializeDatabase()
    
    // Verify authentication
    const token = request.cookies.get('auth-token')?.value
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check for cached data in database (within last 15 seconds)
    const cachedResult = await query(`
      SELECT cluster_id, status, healthy_nodes, total_nodes, cpu_usage_percent, memory_usage_percent, last_checked,
             c.name, c.endpoint
      FROM cluster_health ch
      JOIN clusters c ON c.id = ch.cluster_id
      WHERE c.is_active = true 
        AND ch.last_checked > NOW() - INTERVAL '15 seconds'
    `)

    if (cachedResult.rows.length > 0) {
      // Return cached data with appropriate headers
      const cachedClusters = cachedResult.rows.map(row => ({
        id: row.cluster_id,
        name: row.name,
        status: row.status,
        healthyNodes: row.healthy_nodes,
        totalNodes: row.total_nodes,
        avgCpuPercent: row.cpu_usage_percent,
        avgMemoryPercent: row.memory_usage_percent,
        lastChecked: row.last_checked,
        nodes: [] // Don't include full node details in health endpoint
      }))

      return NextResponse.json(
        { clusters: cachedClusters },
        {
          headers: {
            'Cache-Control': 'public, max-age=10, stale-while-revalidate=30',
            'X-Cache': 'HIT'
          }
        }
      )
    }

    // Get all active clusters
    const clustersResult = await query('SELECT * FROM clusters WHERE is_active = true')
    const clusters = clustersResult.rows

    // Create a timeout helper function
    const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ])
    }

    const healthData = await Promise.all(
      clusters.map(async (cluster) => {
        try {
          const client = new KubernetesClient(cluster.kubeconfig, cluster.talosconfig)
          
          // Add 10 second timeout to cluster health check
          const health = await withTimeout(client.getClusterHealth(), 10000)

          // Store health data in database
          await query(
            `INSERT INTO cluster_health (cluster_id, status, healthy_nodes, total_nodes, cpu_usage_percent, memory_usage_percent)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (cluster_id) DO UPDATE SET
             status = EXCLUDED.status,
             healthy_nodes = EXCLUDED.healthy_nodes,
             total_nodes = EXCLUDED.total_nodes,
             cpu_usage_percent = EXCLUDED.cpu_usage_percent,
             memory_usage_percent = EXCLUDED.memory_usage_percent,
             last_checked = CURRENT_TIMESTAMP`,
            [
              cluster.id,
              health.status || 'unknown',
              health.healthyNodes || 0,
              health.totalNodes || 0,
              health.nodes && health.nodes.length > 0 ? 
                Math.min(999.99, Math.max(0, health.nodes.reduce((sum: number, node: any) => {
                  const percentage = node.cpuCapacity > 0 ? (node.cpuUsage / node.cpuCapacity * 100) : 0;
                  return sum + (isNaN(percentage) ? 0 : percentage);
                }, 0) / health.nodes.length)) : 0,
              health.nodes && health.nodes.length > 0 ? 
                Math.min(999.99, Math.max(0, health.nodes.reduce((sum: number, node: any) => {
                  const percentage = node.memoryCapacity > 0 ? (node.memoryUsage / node.memoryCapacity * 100) : 0;
                  return sum + (isNaN(percentage) ? 0 : percentage);
                }, 0) / health.nodes.length)) : 0
            ]
          )

          return {
            id: cluster.id,
            name: cluster.name,
            ...health
          }
        } catch (error) {
          console.error(`Error checking health for cluster ${cluster.name}:`, error)
          
          // Determine if this was a timeout or other error
          const isTimeout = error instanceof Error && error.message.includes('Timeout')
          const status = isTimeout ? 'timeout' : 'unreachable'
          
          // Store error status in database
          await query(
            `INSERT INTO cluster_health (cluster_id, status, healthy_nodes, total_nodes, cpu_usage_percent, memory_usage_percent)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (cluster_id) DO UPDATE SET
             status = EXCLUDED.status,
             healthy_nodes = EXCLUDED.healthy_nodes,
             total_nodes = EXCLUDED.total_nodes,
             cpu_usage_percent = EXCLUDED.cpu_usage_percent,
             memory_usage_percent = EXCLUDED.memory_usage_percent,
             last_checked = CURRENT_TIMESTAMP`,
            [cluster.id, status, 0, 0, 0, 0]
          )
          
          return {
            id: cluster.id,
            name: cluster.name,
            status,
            healthyNodes: 0,
            totalNodes: 0,
            nodes: [],
            lastChecked: new Date(),
            error: isTimeout ? 'Connection timeout' : 'Cluster unreachable'
          }
        }
      })
    )

    return NextResponse.json(
      { clusters: healthData },
      {
        headers: {
          'Cache-Control': 'public, max-age=10, stale-while-revalidate=30',
          'X-Cache': 'MISS'
        }
      }
    )
  } catch (error) {
    console.error('Error fetching cluster health:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}