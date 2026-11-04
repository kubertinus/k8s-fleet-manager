import { NextRequest, NextResponse } from 'next/server';
import { KubernetesClient } from '../../../../../lib/kubernetes';
import { query } from '../../../../../lib/database';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const clusterId = parseInt(id);
    const { searchParams } = new URL(request.url);
    const namespace = searchParams.get('namespace');
    const podName = searchParams.get('pod');
    const containerName = searchParams.get('container');
    const lines = searchParams.get('lines') || '100';

    if (!namespace || !podName) {
      return NextResponse.json(
        { error: 'Namespace and pod name are required' },
        { status: 400 }
      );
    }

    const clusterResult = await query(
      'SELECT kubeconfig FROM clusters WHERE id = $1 AND is_active = true',
      [clusterId]
    );

    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 });
    }

    const cluster = clusterResult.rows[0];
    const k8sClient = new KubernetesClient(cluster.kubeconfig);

    // Get pod logs
    const logs = await k8sClient.getPodLogs(
      namespace,
      podName,
      containerName || undefined,
      parseInt(lines)
    );

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch logs';
    return NextResponse.json(
      { error: errorMessage, details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const clusterId = parseInt(id);
    const { namespace } = await request.json();

    if (!namespace) {
      return NextResponse.json(
        { error: 'Namespace is required' },
        { status: 400 }
      );
    }

    const clusterResult = await query(
      'SELECT kubeconfig FROM clusters WHERE id = $1 AND is_active = true',
      [clusterId]
    );

    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 });
    }

    const cluster = clusterResult.rows[0];
    const k8sClient = new KubernetesClient(cluster.kubeconfig);

    // Get pods in namespace
    const pods = await k8sClient.getPodsInNamespace(namespace);

    return NextResponse.json({ pods });
  } catch (error) {
    console.error('Error fetching pods:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pods' },
      { status: 500 }
    );
  }
}