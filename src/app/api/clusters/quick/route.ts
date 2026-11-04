import { NextRequest, NextResponse } from 'next/server'
import { query, initializeDatabase } from '@/lib/database'
import { verifyToken } from '@/lib/auth'
import { summarizeKubeconfig } from '@/lib/tools/kubeconfigInfo'

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
    const clustersResult = await query('SELECT id, name, endpoint, is_active, kubeconfig FROM clusters WHERE is_active = true')
    const clusters = clustersResult.rows

    // Return basic cluster info without heavy API calls
    const quickData = clusters.map(cluster => ({
      id: cluster.id,
      name: cluster.name,
      status: 'checking',
      healthyNodes: 0,
      totalNodes: 0,
      lastChecked: new Date().toISOString(),
      // Days until the kubeconfig's client certificate expires (null: no certificate)
      credentialExpiresInDays: summarizeKubeconfig(cluster).clientCertificate?.daysUntilExpiry ?? null,
    }))

    return NextResponse.json(
      { 
        clusters: quickData,
        timestamp: new Date().toISOString()
      },
      { 
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    )
  } catch (error) {
    console.error('Error in quick clusters API:', error)
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    )
  }
}