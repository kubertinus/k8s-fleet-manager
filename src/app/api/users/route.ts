import { NextRequest, NextResponse } from 'next/server'
import { getAllUsers, createUser, verifyToken } from '@/lib/auth'
import { initializeDatabase } from '@/lib/database'

export async function GET(request: NextRequest) {
  try {
    // Initialize database on first request
    await initializeDatabase()
    
    // Verify authentication and admin role
    const token = request.cookies.get('auth-token')?.value
    const user = token ? verifyToken(token) : null
    
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const users = await getAllUsers()
    return NextResponse.json({ users })
  } catch (error) {
    console.error('Error fetching users:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Initialize database on first request
    await initializeDatabase()
    
    // Verify authentication and admin role
    const token = request.cookies.get('auth-token')?.value
    const user = token ? verifyToken(token) : null
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { username, email, password, role } = await request.json()

    if (!username || !email || !password) {
      return NextResponse.json(
        { error: 'Username, email, and password are required' },
        { status: 400 }
      )
    }

    const result = await createUser(username, email, password, role)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ user: result.user })
  } catch (error) {
    console.error('Error creating user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}