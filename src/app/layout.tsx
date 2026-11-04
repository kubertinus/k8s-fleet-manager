import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import './theme-compat.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'K8s Fleet Manager - Kubernetes Monitoring',
  description: 'Comprehensive Kubernetes cluster monitoring for Talos-based clusters',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
