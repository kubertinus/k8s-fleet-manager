import { NextRequest, NextResponse } from 'next/server'
import { verifyJwt } from '@/lib/jwt'

// Every API route requires a logged-in user, except the few needed to log in and
// the liveness probe. Routes still do their own role checks (admin-only etc.);
// this makes sure a route can't be exposed by forgetting the login check.

const PUBLIC_API = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/options',
  '/api/auth/keycloak/login',
  '/api/auth/keycloak/callback',
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_API.includes(pathname)) return NextResponse.next()

  const token = request.cookies.get('auth-token')?.value
  if (!token || !verifyJwt(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
  // jsonwebtoken needs Node.js crypto
  runtime: 'nodejs',
}
