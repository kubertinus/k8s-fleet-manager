import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query } from './database'
import { KeycloakRequestError, keycloakRequest } from './keycloakHttp'

export interface User {
  id: number
  username: string
  email: string
  role: string
  auth_provider?: string
}

export interface AuthResult {
  success: boolean
  user?: User
  error?: string
}

export interface KeycloakSettings {
  enabled: boolean
  serverUrl: string
  realm: string
  clientId: string
  clientSecret: string
  scope: string
  hostname: string
  accessGroup: string
  // Accept an untrusted Keycloak certificate (emergency option; prefer trusting the CA)
  allowInsecureTls: boolean
}

import { JWT_SECRET } from './jwt'

export async function getKeycloakSettings(): Promise<KeycloakSettings> {
  try {
    const result = await query(
      'SELECT key, value FROM settings WHERE key LIKE $1 OR key = $2',
      ['keycloak_%', 'app_hostname']
    )

    const settings: any = {}
    result.rows.forEach(row => {
      if (row.key === 'app_hostname') {
        settings.hostname = row.value
      } else {
        const key = row.key.replace('keycloak_', '')
        settings[key] = row.value
      }
    })

    return {
      enabled: settings.enabled === 'true',
      serverUrl: settings.server_url || '',
      realm: settings.realm || '',
      clientId: settings.client_id || '',
      clientSecret: settings.client_secret || '',
      scope: settings.scope || 'openid profile email',
      hostname: settings.hostname || process.env.NEXTAUTH_URL || 'http://localhost:3000',
      accessGroup: settings.access_group || '',
      allowInsecureTls: settings.allow_insecure_tls === 'true'
    }
  } catch (error) {
    console.error('Error fetching Keycloak settings:', error)
    return {
      enabled: false,
      serverUrl: '',
      realm: '',
      clientId: '',
      clientSecret: '',
      scope: 'openid profile email',
      hostname: process.env.NEXTAUTH_URL || 'http://localhost:3000',
      accessGroup: '',
      allowInsecureTls: false
    }
  }
}

export async function authenticateWithKeycloak(code: string): Promise<AuthResult> {
  try {
    const settings = await getKeycloakSettings()
    
    if (!settings.enabled) {
      return { success: false, error: 'Keycloak authentication is disabled' }
    }

    // Exchange authorization code for tokens
    const tokenUrl = `${settings.serverUrl}/realms/${settings.realm}/protocol/openid-connect/token`
    const redirectUri = `${settings.hostname}/api/auth/keycloak/callback`

    const tokenResponse = await keycloakRequest(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        code: code,
        redirect_uri: redirectUri,
      }).toString(),
      allowInsecureTls: settings.allowInsecureTls,
    })

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text()
      console.error('Token exchange failed:', error)
      return { success: false, error: 'Failed to exchange authorization code' }
    }

    const tokens = await tokenResponse.json()

    // Get user info from Keycloak
    const userInfoUrl = `${settings.serverUrl}/realms/${settings.realm}/protocol/openid-connect/userinfo`
    const userInfoResponse = await keycloakRequest(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
      allowInsecureTls: settings.allowInsecureTls,
    })

    if (!userInfoResponse.ok) {
      return { success: false, error: 'Failed to fetch user information' }
    }

    const userInfo = await userInfoResponse.json()
    console.log('Keycloak user info:', userInfo)

    // Check access group restriction first
    if (settings.accessGroup && settings.accessGroup.trim() !== '') {
      const hasAccess = userInfo.groups?.includes(settings.accessGroup.trim())
      if (!hasAccess) {
        console.log(`User ${userInfo.email} denied access - not in required group: ${settings.accessGroup}`)
        return { success: false, error: `Access denied. You must be a member of the '${settings.accessGroup}' group to access this application.` }
      }
    }

    // Get admin role/group settings
    const adminRolesResult = await query('SELECT value FROM settings WHERE key = $1', ['keycloak_admin_roles'])
    const adminGroupsResult = await query('SELECT value FROM settings WHERE key = $1', ['keycloak_admin_groups'])
    const adminGroupResult = await query('SELECT value FROM settings WHERE key = $1', ['keycloak_admin_group'])
    
    const adminRoles = adminRolesResult.rows[0]?.value?.split(',').map((r: string) => r.trim()) || ['admin']
    const adminGroups = adminGroupsResult.rows[0]?.value?.split(',').map((g: string) => g.trim()) || ['admin']
    const adminGroup = adminGroupResult.rows[0]?.value?.trim() || ''

    // Determine user role from Keycloak
    let userRole = 'user' // Default role
    
    // Check for admin role in various Keycloak fields
    // Priority: specific admin group > admin roles > admin groups list
    const hasAdminRole = (adminGroup && userInfo.groups?.includes(adminGroup)) ||
                        userInfo.realm_access?.roles?.some((role: string) => adminRoles.includes(role)) ||
                        // Client roles of the configured Keycloak client (the old "kubertinus-app" still counts)
                        [settings.clientId, 'kubertinus-app'].some(client =>
                          userInfo.resource_access?.[client]?.roles?.some((role: string) => adminRoles.includes(role))
                        ) ||
                        userInfo.groups?.some((group: string) => adminGroups.includes(group))
    
    if (hasAdminRole) {
      userRole = 'admin'
    }

    // Check if user exists in database or create them
    const existingUser = await query(
      'SELECT id, username, email, role FROM users WHERE email = $1',
      [userInfo.email]
    )

    let user
    if (existingUser.rows.length > 0) {
      // Update existing user's role if it changed
      const currentUser = existingUser.rows[0]
      if (currentUser.role !== userRole) {
        await query(
          'UPDATE users SET role = $1 WHERE email = $2',
          [userRole, userInfo.email]
        )
        currentUser.role = userRole
      }
      user = currentUser
    } else {
      // Create new user from Keycloak info
      const newUser = await query(
        `INSERT INTO users (username, email, password_hash, role, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         RETURNING id, username, email, role`,
        [
          userInfo.preferred_username || userInfo.email,
          userInfo.email,
          '', // No password for Keycloak users
          userRole // Use determined role
        ]
      )
      user = newUser.rows[0]
    }

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        auth_provider: 'keycloak'
      }
    }
  } catch (error) {
    console.error('Keycloak authentication error:', error)
    // Connection problems (TLS, DNS, ...) are explained; anything else stays generic
    return { success: false, error: error instanceof KeycloakRequestError ? error.message : 'Keycloak authentication failed' }
  }
}

export async function authenticateUser(username: string, password: string): Promise<AuthResult> {
  try {
    const result = await query(
      'SELECT id, username, email, password_hash, role FROM users WHERE username = $1 OR email = $1',
      [username]
    )

    if (result.rows.length === 0) {
      return { success: false, error: 'User not found' }
    }

    const user = result.rows[0]
    const isValid = await bcrypt.compare(password, user.password_hash)

    if (!isValid) {
      return { success: false, error: 'Invalid password' }
    }

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    }
  } catch (error) {
    console.error('Authentication error:', error)
    return { success: false, error: 'Authentication failed' }
  }
}

export async function createUser(username: string, email: string, password: string, role: string = 'user'): Promise<AuthResult> {
  try {
    // Check if user already exists
    const existingUser = await query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    )

    if (existingUser.rows.length > 0) {
      return { success: false, error: 'User already exists' }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    // Create user
    const result = await query(
      'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
      [username, email, passwordHash, role]
    )

    const user = result.rows[0]
    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    }
  } catch (error) {
    console.error('User creation error:', error)
    return { success: false, error: 'Failed to create user' }
  }
}

export function generateToken(user: User): string {
  return jwt.sign(
    { 
      userId: user.id, 
      username: user.username, 
      role: user.role 
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  )
}

export function verifyToken(token: string): any {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any
    return decoded
  } catch (error: any) {
    console.log('Token verification failed:', error.message)
    return null
  }
}

export async function getAllUsers(): Promise<User[]> {
  try {
    const result = await query(
      'SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC'
    )
    return result.rows
  } catch (error) {
    console.error('Error fetching users:', error)
    return []
  }
}

export async function deleteUser(userId: number): Promise<boolean> {
  try {
    const result = await query('DELETE FROM users WHERE id = $1', [userId])
    return (result.rowCount || 0) > 0
  } catch (error) {
    console.error('Error deleting user:', error)
    return false
  }
}

export async function updateExistingKeycloakUsersRoles(): Promise<{ updated: number, errors: string[] }> {
  try {
    // Get all users who don't have password (Keycloak users)
    const keycloakUsers = await query(
      'SELECT id, email FROM users WHERE password_hash = $1',
      ['']
    )

    if (keycloakUsers.rows.length === 0) {
      return { updated: 0, errors: [] }
    }

    // Get admin group settings
    const adminGroupResult = await query('SELECT value FROM settings WHERE key = $1', ['keycloak_admin_group'])
    const adminRolesResult = await query('SELECT value FROM settings WHERE key = $1', ['keycloak_admin_roles'])
    const adminGroupsResult = await query('SELECT value FROM settings WHERE key = $1', ['keycloak_admin_groups'])
    
    const adminGroup = adminGroupResult.rows[0]?.value?.trim() || ''
    const adminRoles = adminRolesResult.rows[0]?.value?.split(',').map((r: string) => r.trim()) || ['admin']
    const adminGroups = adminGroupsResult.rows[0]?.value?.split(',').map((g: string) => g.trim()) || ['admin']

    if (!adminGroup && adminRoles.length === 1 && adminRoles[0] === 'admin' && adminGroups.length === 1 && adminGroups[0] === 'admin') {
      // No specific admin settings configured
      return { updated: 0, errors: ['No admin group/role settings configured'] }
    }

    let updated = 0
    const errors: string[] = []

    for (const user of keycloakUsers.rows) {
      try {
        // For now, we can't re-fetch user info from Keycloak without their session
        // This function is primarily for future use or when we have admin access to Keycloak
        // For now, just log that the user exists
        console.log(`Keycloak user found: ${user.email} (ID: ${user.id})`)
        // In a production environment, you would:
        // 1. Use admin credentials to fetch user info from Keycloak
        // 2. Check their group membership
        // 3. Update their role accordingly
      } catch (error) {
        errors.push(`Failed to update user ${user.email}: ${error}`)
      }
    }

    return { updated, errors }
  } catch (error) {
    console.error('Error updating Keycloak users roles:', error)
    return { updated: 0, errors: [error instanceof Error ? error.message : 'Unknown error'] }
  }
}