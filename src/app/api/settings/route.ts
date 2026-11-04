import { NextRequest, NextResponse } from 'next/server'
import { initializeDatabase, query } from '@/lib/database'
import { verifyToken } from '@/lib/auth'

// Settings hold credentials (Nexus, Harbor, Keycloak, Antrea), so reading and
// changing them is for admins only. Secret values never leave the server: the
// API returns a placeholder for them, and saving that placeholder keeps the
// stored value. The login page uses /api/auth/options instead.

const SECRET_PLACEHOLDER = '********'
const SECRET_KEY = /(_password|_secret|_api_token|_api_key)$/

function requireAdmin(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  const user = token ? verifyToken(token) : null
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ success: false, error: 'Admin access required' }, { status: 403 })
  return null
}

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request)
  if (denied) return denied

  try {
    await initializeDatabase()
    
    const result = await query('SELECT key, value, description FROM settings ORDER BY key')
    const settings = result.rows.map((row: any) =>
      SECRET_KEY.test(row.key) ? { ...row, value: row.value ? SECRET_PLACEHOLDER : '' } : row
    )
    
    return NextResponse.json({ 
      success: true, 
      settings
    })
  } catch (error) {
    console.error('Error fetching settings:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const denied = requireAdmin(request)
  if (denied) return denied

  try {
    await initializeDatabase()
    
    const { settings } = await request.json()
    
    if (!settings || !Array.isArray(settings)) {
      return NextResponse.json(
        { success: false, error: 'Invalid settings format' },
        { status: 400 }
      )
    }

    for (const setting of settings) {
      // The placeholder means "unchanged": keep the stored secret
      if (SECRET_KEY.test(setting.key) && setting.value === SECRET_PLACEHOLDER) continue
      await query(
        'UPDATE settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2',
        [setting.value, setting.key]
      )
    }
    
    return NextResponse.json({ 
      success: true, 
      message: 'Settings updated successfully' 
    })
  } catch (error) {
    console.error('Error updating settings:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update settings' },
      { status: 500 }
    )
  }
}
