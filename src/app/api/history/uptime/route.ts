import { NextResponse } from 'next/server'
import { availabilityByCluster } from '@/lib/history/query'

// Availability per cluster over the last 7 days, for the dashboard list
export async function GET() {
  try {
    const availability = await availabilityByCluster(7 * 24)
    return NextResponse.json(Object.fromEntries(availability), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('Error reading uptime:', error)
    return NextResponse.json({ error: error?.message || 'Failed to read uptime' }, { status: 500 })
  }
}
