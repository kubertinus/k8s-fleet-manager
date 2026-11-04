import { NextResponse } from 'next/server'
import { query } from '@/lib/database'
import { getHostnames, type HostnameRow } from '@/lib/hostnames'

export interface HostnamesResponse {
  clusters: { id: number; name: string; gatewayApi: boolean; error: string | null }[]
  hostnames: (HostnameRow & { clusterId: number; cluster: string })[]
  generatedAt: string
}

// All hostnames of all active clusters; a cluster that can't be reached only adds an error.
export async function GET() {
  try {
    const clusters = (await query('SELECT id, name, kubeconfig FROM clusters WHERE is_active = true ORDER BY name')).rows
    const results = await Promise.all(
      clusters.map(async cluster => {
        try {
          const { rows, gatewayApi } = await getHostnames(cluster.kubeconfig)
          return { cluster, rows, gatewayApi, error: null as string | null }
        } catch (error: any) {
          return { cluster, rows: [] as HostnameRow[], gatewayApi: false, error: error?.message || 'Failed to list hostnames' }
        }
      })
    )

    const body: HostnamesResponse = {
      clusters: results.map(r => ({ id: r.cluster.id, name: r.cluster.name, gatewayApi: r.gatewayApi, error: r.error })),
      hostnames: results.flatMap(r => r.rows.map(row => ({ ...row, clusterId: r.cluster.id, cluster: r.cluster.name }))),
      generatedAt: new Date().toISOString(),
    }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('Error listing hostnames:', error)
    return NextResponse.json({ error: error?.message || 'Failed to list hostnames' }, { status: 500 })
  }
}
