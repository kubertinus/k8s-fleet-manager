import { NextResponse } from 'next/server'
import { query } from '@/lib/database'
import { summarizeKubeconfig } from '@/lib/tools/kubeconfigInfo'

// Expiry of the credentials in the stored cluster kubeconfigs. Only metadata is
// returned; the kubeconfig (keys, tokens) never leaves the server.

export async function GET() {
  try {
    const result = await query('SELECT id, name, kubeconfig FROM clusters WHERE is_active = true ORDER BY name')
    return NextResponse.json({ clusters: result.rows.map(summarizeKubeconfig) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Error reading kubeconfigs:', error)
    return NextResponse.json({ error: 'Failed to read kubeconfigs' }, { status: 500 })
  }
}
