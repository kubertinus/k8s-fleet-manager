import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithKeycloak, generateToken, getKeycloakSettings } from '@/lib/auth'
import { initializeDatabase } from '@/lib/database'

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase()
    
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const error = searchParams.get('error')

    // Get settings to determine the correct hostname for redirects
    const settings = await getKeycloakSettings()

    if (error) {
      console.error('Keycloak auth error:', error)
      return NextResponse.redirect(new URL('/login?error=keycloak_error', settings.hostname))
    }

    if (!code) {
      return NextResponse.redirect(new URL('/login?error=missing_code', settings.hostname))
    }

    const authResult = await authenticateWithKeycloak(code)

    if (!authResult.success || !authResult.user) {
      console.error('Keycloak authentication failed:', authResult.error)
      const target = new URL('/login?error=auth_failed', settings.hostname)
      if (authResult.error) target.searchParams.set('message', authResult.error)
      return NextResponse.redirect(target)
    }

    // Generate JWT token
    const token = generateToken(authResult.user)

    // Create response and set cookie - use hostname from settings for redirect
    const response = NextResponse.redirect(new URL('/dashboard', settings.hostname))
        response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 // 24 hours
    })

    return response
  } catch (error) {
    console.error('Keycloak callback error:', error)
    // Fallback to request.url if we can't get settings
    return NextResponse.redirect(new URL('/login?error=callback_error', request.url))
  }
}