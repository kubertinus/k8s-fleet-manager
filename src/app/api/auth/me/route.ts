import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    // Get token from cookie
    const token = request.cookies.get('auth-token')?.value
    
    if (!token) {
      return NextResponse.json({ 
        authenticated: false, 
        role: null 
      }, { status: 401 })
    }

    // Verify token and get user info
    const user = await verifyToken(token)
    
    if (!user) {
      return NextResponse.json({ 
        authenticated: false, 
        role: null 
      }, { status: 401 })
    }

    return NextResponse.json({
      authenticated: true,
      role: user.role,
      username: user.username,
      email: user.email
    })

  } catch (error) {
    console.error('Auth check error:', error)
    return NextResponse.json({ 
      error: 'Failed to check authentication status',
      authenticated: false,
      role: null 
    }, { status: 500 })
  }
}