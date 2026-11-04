import { NextRequest, NextResponse } from 'next/server'
import { initializeDatabase, query } from '@/lib/database'
import { KubernetesClient } from '@/lib/kubernetes'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeDatabase()
    
    const { id } = await params
    const clusterId = parseInt(id)
    if (isNaN(clusterId)) {
      return NextResponse.json({ error: 'Invalid cluster ID' }, { status: 400 })
    }

    // Get cluster from database
    const clusterResult = await query(
      'SELECT * FROM clusters WHERE id = $1 AND is_active = true',
      [clusterId]
    )
    
    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
    }

    const cluster = clusterResult.rows[0]
    const k8sClient = new KubernetesClient(cluster.kubeconfig, cluster.talosconfig)

    // Fetch Storage Classes
    const storageClasses = await k8sClient.getAllStorageClasses()
    
    // Fetch Persistent Volumes
    const persistentVolumes = await k8sClient.getAllPersistentVolumes()
    
    // Fetch Persistent Volume Claims
    const persistentVolumeClaims = await k8sClient.getAllPersistentVolumeClaims()

    // Calculate storage statistics
    const totalCapacityBytes = persistentVolumes.reduce((total: number, pv: any) => {
      const capacity = pv.capacity || '0'
      return total + parseStorageSize(capacity)
    }, 0)
    
    const boundPVs = persistentVolumes.filter((pv: any) => pv.status === 'Bound').length

    const statistics = {
      totalPVs: persistentVolumes.length,
      totalPVCs: persistentVolumeClaims.length,
      totalStorageClasses: storageClasses.length,
      totalCapacity: formatBytes(totalCapacityBytes),
      boundPVs: boundPVs
    }

    return NextResponse.json({
      storageClasses,
      persistentVolumes,
      persistentVolumeClaims,
      statistics
    })
  } catch (error) {
    console.error('Storage details error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch storage details' },
      { status: 500 }
    )
  }
}

// Helper function to format bytes to human readable format
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// Helper function to parse storage sizes like "10Gi", "500Mi", etc.
function parseStorageSize(sizeStr: string): number {
  if (!sizeStr) return 0
  
  const units: { [key: string]: number } = {
    'Ki': 1024,
    'Mi': 1024 * 1024,
    'Gi': 1024 * 1024 * 1024,
    'Ti': 1024 * 1024 * 1024 * 1024,
    'K': 1000,
    'M': 1000 * 1000,
    'G': 1000 * 1000 * 1000,
    'T': 1000 * 1000 * 1000 * 1000
  }

  const match = sizeStr.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/)
  if (!match) return 0

  const [, value, unit] = match
  const numValue = parseFloat(value)
  const multiplier = unit ? units[unit] : 1

  return numValue * multiplier
}