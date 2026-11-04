import { NextResponse } from 'next/server'
import { initializeDatabase, query } from '@/lib/database'

// Public: which login methods the login page should offer. Nothing else.
export async function GET() {
  try {
    await initializeDatabase()
    const result = await query("SELECT key, value FROM settings WHERE key IN ('keycloak_enabled', 'disable_local_login')")
    const settings = Object.fromEntries(result.rows.map((row: any) => [row.key, row.value]))
    return NextResponse.json({
      keycloakEnabled: settings.keycloak_enabled === 'true',
      localLoginDisabled: settings.disable_local_login === 'true',
    })
  } catch (error) {
    console.error('Error fetching login options:', error)
    return NextResponse.json({ keycloakEnabled: false, localLoginDisabled: false })
  }
}
