import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/database'
import { verifyToken } from '@/lib/auth'
import { getClusterHealthCached } from '@/lib/healthCache'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Verify authentication
    const token = request.cookies.get('auth-token')?.value
    if (!token || !verifyToken(token)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await params
    const clusterId = parseInt(resolvedParams.id)

    // Get cluster from database
    const clusterResult = await query(
      'SELECT id, name, kubeconfig, talosconfig FROM clusters WHERE id = $1 AND is_active = true',
      [clusterId]
    )

    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
    }

    // ?refresh=1 (manual refresh) skips the fresh-cache shortcut; concurrent checks are still shared.
    const force = request.nextUrl.searchParams.get('refresh') === '1'
    const { data, ageMs } = await getClusterHealthCached(clusterResult.rows[0], { force })

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Health-Age': String(Math.round(ageMs / 1000)),
      },
    })
  } catch (error) {
    console.error('Error in individual cluster health API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
