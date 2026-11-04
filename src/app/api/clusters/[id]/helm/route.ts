import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/database'
import { verifyToken } from '@/lib/auth'
import { listArgoHelmApplications, listHelmReleases } from '@/lib/helm'

// Helm charts deployed in a cluster, by Helm itself or by Argo CD (metadata only:
// no values or manifests). One failing source doesn't hide the other.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.cookies.get('auth-token')?.value
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { id } = await params
    const clusterResult = await query('SELECT id, kubeconfig FROM clusters WHERE id = $1 AND is_active = true', [parseInt(id)])
    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
    }

    const kubeconfig = clusterResult.rows[0].kubeconfig
    const [helm, argo] = await Promise.allSettled([listHelmReleases(kubeconfig), listArgoHelmApplications(kubeconfig)])
    const errors = [
      helm.status === 'rejected' ? `Helm releases: ${helm.reason?.message || helm.reason}` : null,
      argo.status === 'rejected' ? `Argo CD applications: ${argo.reason?.message || argo.reason}` : null,
    ].filter(Boolean)
    if (helm.status === 'rejected' && argo.status === 'rejected') {
      return NextResponse.json({ error: errors.join(' · ') }, { status: 500 })
    }

    const releases = [
      ...(helm.status === 'fulfilled' ? helm.value : []),
      ...(argo.status === 'fulfilled' ? argo.value : []),
    ].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name))
    return NextResponse.json({ releases, errors }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('Error listing Helm releases:', error)
    return NextResponse.json({ error: error?.message || 'Failed to list Helm releases' }, { status: 500 })
  }
}
