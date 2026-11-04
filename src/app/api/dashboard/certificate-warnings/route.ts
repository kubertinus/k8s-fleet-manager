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

    const certificateWarnings = await Promise.all(
      clusters.map(async (cluster) => {
        try {
          const client = new KubernetesClient(cluster.kubeconfig, cluster.talosconfig)
          
          // Add 15 second timeout to certificate check
          const warnings = await withTimeout(client.getCertificateExpirations(), 15000)

          return {
            clusterId: cluster.id,
            clusterName: cluster.name,
            certificateWarnings: warnings.slice(0, 3) // Limit to 3 per cluster
          }
        } catch (error) {
          console.error(`Error checking certificates for cluster ${cluster.name}:`, error)
          
          return {
            clusterId: cluster.id,
            clusterName: cluster.name,
            certificateWarnings: [],
            error: error instanceof Error && error.message.includes('Timeout') ? 'timeout' : 'error'
          }
        }
      })
    )

    return NextResponse.json({ clusters: certificateWarnings })
  } catch (error) {
    console.error('Error fetching certificate warnings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}