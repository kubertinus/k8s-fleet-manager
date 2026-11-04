import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, updateExistingKeycloakUsersRoles } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    // Verify admin token
    const token = request.cookies.get('auth-token')?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await verifyToken(token)
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Update existing Keycloak users' roles
    const result = await updateExistingKeycloakUsersRoles()

    return NextResponse.json({
      message: 'Keycloak user roles update completed',
      updated: result.updated,
      errors: result.errors
    })

  } catch (error) {
    console.error('Update Keycloak roles error:', error)
    return NextResponse.json({ 
      error: 'Failed to update Keycloak user roles',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}