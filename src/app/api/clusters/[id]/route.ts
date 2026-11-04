import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/database';
import { verifyToken } from '@/lib/auth';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authentication
    const token = request.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { id: clusterId } = await params;
    const { name, description } = await request.json();

    // Validate input
    if (!name || name.trim() === '') {
      return NextResponse.json({ error: 'Cluster name is required' }, { status: 400 });
    }

    // Check if cluster exists
    const clusterResult = await query(
      'SELECT id FROM clusters WHERE id = $1',
      [clusterId]
    );

    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 });
    }

    // Update the cluster
    await query(
      'UPDATE clusters SET name = $1, description = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [name.trim(), description || null, clusterId]
    );

    return NextResponse.json({ message: 'Cluster updated successfully' });
  } catch (error) {
    console.error('Error updating cluster:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify authentication
    const token = request.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { id: clusterId } = await params;

    // Check if cluster exists
    const clusterResult = await query(
      'SELECT id FROM clusters WHERE id = $1',
      [clusterId]
    );

    if (clusterResult.rows.length === 0) {
      return NextResponse.json({ error: 'Cluster not found' }, { status: 404 });
    }

    // Delete related records first (to maintain referential integrity)
    await query('DELETE FROM backup_jobs WHERE cluster_id = $1', [clusterId]);
    await query('DELETE FROM cluster_health WHERE cluster_id = $1', [clusterId]);
    
    // Delete the cluster
    await query('DELETE FROM clusters WHERE id = $1', [clusterId]);

    return NextResponse.json({ message: 'Cluster deleted successfully' });
  } catch (error) {
    console.error('Error deleting cluster:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}