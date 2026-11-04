import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/database'
import { getVelero } from '@/lib/velero'

// Velero backups, schedules and storage locations of a cluster.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const result = await query('SELECT kubeconfig FROM clusters WHERE id = $1 AND is_active = true', [parseInt(id)])
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
    }
    const data = await getVelero(result.rows[0].kubeconfig)
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('Error listing Velero backups:', error)
    return NextResponse.json({ error: error?.message || 'Failed to list Velero backups' }, { status: 500 })
  }
}
