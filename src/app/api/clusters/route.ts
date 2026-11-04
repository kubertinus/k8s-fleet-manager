import { NextRequest, NextResponse } from 'next/server'
import { query, initializeDatabase } from '@/lib/database'
import { verifyToken } from '@/lib/auth'
import { KubernetesClient, parseKubeconfig } from '@/lib/kubernetes'

export async function GET(request: NextRequest) {
  try {
    // Initialize database on first request
    await initializeDatabase()
    
    // Verify authentication
    const token = request.cookies.get('auth-token')?.value
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const result = await query('SELECT id, name, endpoint, description, is_active FROM clusters WHERE is_active = true')
    return NextResponse.json({ clusters: result.rows })
  } catch (error) {
    console.error('Error fetching clusters:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Initialize database on first request
    await initializeDatabase()
    
    // Verify authentication and admin role
    const token = request.cookies.get('auth-token')?.value
    const user = token ? verifyToken(token) : null
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { kubeconfig, talosconfig } = await request.json()

    if (!kubeconfig) {
      return NextResponse.json(
        { error: 'Kubeconfig is required' },
        { status: 400 }
      )
    }

    // Parse kubeconfig to extract cluster information
    let clusterInfo
    try {
      clusterInfo = parseKubeconfig(kubeconfig)
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid kubeconfig format' },
        { status: 400 }
      )
    }

    // Test connection with the kubeconfig
    try {
      const client = new KubernetesClient(kubeconfig, talosconfig)
      await client.getClusterHealth()
    } catch (error) {
      return NextResponse.json(
        { error: 'Failed to connect to cluster with provided kubeconfig' },
        { status: 400 }
      )
    }

    const result = await query(
      'INSERT INTO clusters (name, endpoint, kubeconfig, talosconfig, description) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [clusterInfo.name, clusterInfo.endpoint, kubeconfig, talosconfig || null, clusterInfo.description]
    )

    return NextResponse.json({ cluster: result.rows[0] })
  } catch (error) {
    console.error('Error creating cluster:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}