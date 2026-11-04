import { NextRequest, NextResponse } from 'next/server'
import { deleteUser, verifyToken } from '@/lib/auth'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params
    // Verify authentication and admin role
    const token = request.cookies.get('auth-token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await verifyToken(token)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const userId = parseInt(params.id)
    if (isNaN(userId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
    }

    const success = await deleteUser(userId)
    
    if (success) {
      return NextResponse.json({ message: 'User deleted successfully' })
    } else {
      return NextResponse.json({ error: 'User not found or could not be deleted' }, { status: 404 })
    }

  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json({ 
      error: 'Failed to delete user',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}