'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { Shield, Lock, User, Eye, EyeOff } from 'lucide-react'
import Logo from '@/components/layout/Logo'

// Force dynamic rendering to avoid static generation issues
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [keycloakEnabled, setKeycloakEnabled] = useState(false)
  const [localLoginDisabled, setLocalLoginDisabled] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  useEffect(() => {
    // Check authentication settings
    const checkAuthSettings = async () => {
      try {
        const response = await fetch('/api/auth/options')
        const data = await response.json()
        setKeycloakEnabled(data.keycloakEnabled === true)
        setLocalLoginDisabled(data.localLoginDisabled === true)
      } catch (error) {
        console.error('Failed to check authentication settings:', error)
      }
    }

    checkAuthSettings()

    // Errors from the Keycloak callback (read from location: useSearchParams needs a Suspense boundary)
    const params = new URLSearchParams(window.location.search)
    const errorParam = params.get('error')
    if (errorParam) {
      const messages: Record<string, string> = {
        keycloak_error: 'Keycloak authentication failed',
        missing_code: 'Authorization code missing',
        auth_failed: 'Authentication failed',
        callback_error: 'Authentication callback error',
      }
      setError(params.get('message') || messages[errorParam] || 'Authentication error occurred')
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      })

      const data = await response.json()

      if (data.success) {
        router.push('/dashboard')
      } else {
        setError(data.error || 'Login failed')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleKeycloakLogin = () => {
    window.location.href = '/api/auth/keycloak/login'
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="mb-4 h-11 w-11" />
          <h1 className="text-2xl font-semibold text-white">K8s Fleet Manager</h1>
          <p className="mt-1 text-sm text-slate-400">Kubernetes &amp; Talos cluster monitoring</p>
        </div>

        <div className="card p-6">
          {keycloakEnabled && (
            <div className="mb-6">
              <button type="button" className="btn-primary w-full justify-center py-2.5" onClick={handleKeycloakLogin}>
                <Shield className="h-4 w-4" />
                Sign in with Keycloak
              </button>
              {!localLoginDisabled && (
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-800" />
                  </div>
                  <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                    <span className="bg-slate-900 px-3 text-slate-500">or use a local account</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!localLoginDisabled ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="username" className="text-sm font-medium text-slate-300">
                  Username or email
                </label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    id="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="input pl-9"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium text-slate-300">
                  Password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input pl-9 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {error && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
                  {error}
                </div>
              )}
              <button
                type="submit"
                className={keycloakEnabled ? 'btn-secondary w-full justify-center py-2.5' : 'btn-primary w-full justify-center py-2.5'}
                disabled={loading}
              >
                {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            !keycloakEnabled && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                <p className="mb-1 font-medium text-rose-100">Authentication unavailable</p>
                Local login has been disabled and Keycloak authentication is not configured. Please contact your
                administrator.
              </div>
            )
          )}

          {!keycloakEnabled && !localLoginDisabled && (
            <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
              <p className="mb-2 text-slate-400">Default admin credentials</p>
              <div className="flex justify-between font-mono">
                <span className="text-slate-500">username</span>
                <span className="text-slate-200">admin</span>
              </div>
              <div className="flex justify-between font-mono">
                <span className="text-slate-500">password</span>
                <span className="text-slate-200">admin123</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
