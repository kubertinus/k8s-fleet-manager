'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const checkAuthAndRedirect = async () => {
      try {
        // Check if user is authenticated
        const response = await fetch('/api/auth/me')
        
        if (response.ok) {
          // User is authenticated, redirect to dashboard
          router.replace('/dashboard')
        } else {
          // User is not authenticated, redirect to login
          router.replace('/login')
        }
      } catch (error) {
        // If there's an error checking auth, redirect to login
        router.replace('/login')
      }
    }

    checkAuthAndRedirect()
  }, [router])

  // Show a loading spinner while checking authentication
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <div className="text-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-700 border-t-orange-500 mx-auto mb-4"></div>
        <p className="text-sm text-slate-400">Loading...</p>
      </div>
    </div>
  )
}