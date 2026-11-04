import { NextRequest, NextResponse } from 'next/server'
import { getKeycloakSettings } from '@/lib/auth'
import { initializeDatabase } from '@/lib/database'

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase()
    
    const settings = await getKeycloakSettings()

    if (!settings.enabled) {
      return NextResponse.json(
        { error: 'Keycloak authentication is disabled' },
        { status: 400 }
      )
    }

    const redirectUri = `${settings.hostname}/api/auth/keycloak/callback`
    const state = Math.random().toString(36).substring(2, 15)

    const authUrl = new URL(`${settings.serverUrl}/realms/${settings.realm}/protocol/openid-connect/auth`)
    authUrl.searchParams.set('client_id', settings.clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', settings.scope)
    authUrl.searchParams.set('state', state)

    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    console.error('Keycloak login error:', error)
    return NextResponse.json(
      { error: 'Failed to initiate Keycloak login' },
      { status: 500 }
    )
  }
}