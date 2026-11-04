import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser, generateToken } from '@/lib/auth'
import { initializeDatabase, query } from '@/lib/database'

export async function POST(request: NextRequest) {
  try {
    // Initialize database on first request
    await initializeDatabase()
    
    // Check if local login is disabled via environment variable
    const isLocalLoginDisabled = process.env.DISABLE_LOCAL_LOGIN === 'true'
    
    if (isLocalLoginDisabled) {
      return NextResponse.json(
        { error: 'Local login is disabled. Please use Keycloak authentication.' },
        { status: 403 }
      )
    }
    
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Username and password are required' },
        { status: 400 }
      )
    }

    const authResult = await authenticateUser(username, password)

    if (!authResult.success) {
      return NextResponse.json(
        { error: authResult.error },
        { status: 401 }
      )
    }

    const token = generateToken(authResult.user!)
    
    const response = NextResponse.json({
      success: true,
      user: authResult.user,
      token
    })

    // Set HTTP-only cookie for token
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 // 24 hours
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}