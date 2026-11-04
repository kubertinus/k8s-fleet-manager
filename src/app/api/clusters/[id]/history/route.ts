import { NextRequest, NextResponse } from 'next/server'
import { getClusterHistory, HISTORY_RANGES, type HistoryRange } from '@/lib/history/query'
import { getHistorySettings } from '@/lib/history/sampler'

// Health history of a cluster: ?range=24h|7d|30d
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const requested = request.nextUrl.searchParams.get('range') ?? '24h'
    const range: HistoryRange = requested in HISTORY_RANGES ? (requested as HistoryRange) : '24h'
    const { intervalMinutes } = await getHistorySettings()
    const history = await getClusterHistory(parseInt(id), range, intervalMinutes)
    return NextResponse.json(history, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    console.error('Error reading cluster history:', error)
    return NextResponse.json({ error: error?.message || 'Failed to read history' }, { status: 500 })
  }
}
