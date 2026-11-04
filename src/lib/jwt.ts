import jwt from 'jsonwebtoken'

// Shared by lib/auth (issuing tokens) and the middleware (checking them), without
// pulling the database into the middleware.
export const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'your-jwt-secret-change-in-production'

export function verifyJwt(token: string): any {
  try {
    return jwt.verify(token, JWT_SECRET)
  } catch {
    return null
  }
}
