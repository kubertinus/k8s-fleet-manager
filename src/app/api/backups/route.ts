import { NextResponse } from 'next/server'
import { query } from '@/lib/database'
import { getVelero } from '@/lib/velero'
import { toFleetCluster, type FleetBackupCluster } from '@/lib/backupsFleet'

export interface BackupsResponse {
  clusters: FleetBackupCluster[]
  generatedAt: string
}

// Velero backups of all active clusters; a cluster that can't be reached only adds an error.
export async function GET() {
  try {
    const clusters = (await query('SELECT id, name, kubeconfig FROM clusters WHERE is_active = true ORDER BY name')).rows
    const rows = await Promise.all(
      clusters.map(async cluster => {
        try {
          return toFleetCluster(cluster, await getVelero(cluster.kubeconfig), null)
        } catch (error: any) {
          return toFleetCluster(cluster, null, error?.message || 'Failed to list Velero backups')
        }
      })
    )
    const body: BackupsResponse = { clusters: rows, generatedAt: new Date().toISOString() }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('Error listing backups:', error)
    return NextResponse.json({ error: error?.message || 'Failed to list backups' }, { status: 500 })
  }
}
