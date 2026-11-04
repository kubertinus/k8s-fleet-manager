import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/database'
import { checkDeprecatedApis } from '@/lib/tools/deprecatedApis'

// Deprecated / removed API versions in use, per cluster (all clusters or ?cluster=id).
export async function GET(request: NextRequest) {
  try {
    const only = request.nextUrl.searchParams.get('cluster')
    const result = only
      ? await query('SELECT id, name, kubeconfig FROM clusters WHERE is_active = true AND id = $1', [parseInt(only)])
      : await query('SELECT id, name, kubeconfig FROM clusters WHERE is_active = true ORDER BY name')

    const checks = await Promise.allSettled(result.rows.map((cluster: any) => checkDeprecatedApis(cluster)))
    const clusters = checks.map((check, i) =>
      check.status === 'fulfilled'
        ? check.value
        : {
            clusterId: result.rows[i].id,
            clusterName: result.rows[i].name,
            kubernetesVersion: null,
            findings: [],
            customerManagedNamespaces: [],
            warnings: [`Check failed: ${check.reason?.message || check.reason}`],
          }
    )
    return NextResponse.json({ clusters }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Error checking deprecated APIs:', error)
    return NextResponse.json({ error: 'Failed to check deprecated APIs' }, { status: 500 })
  }
}
