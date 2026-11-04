import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { runImageScan } from '@/lib/images/scan'

// Start a full scan now. Responds as soon as the run has started; the report page polls for progress.
export async function POST(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const started = await new Promise<number | null>((resolve, reject) => {
      runImageScan('manual', { onStarted: resolve })
        .then(runId => {
          // null: another scan holds the lock (otherwise onStarted already resolved)
          if (runId === null) resolve(null)
        })
        .catch(reject)
    })

    if (started === null) {
      return NextResponse.json({ error: 'A scan is already running' }, { status: 409 })
    }
    return NextResponse.json({ runId: started }, { status: 202 })
  } catch (error) {
    console.error('Error starting image scan:', error)
    return NextResponse.json({ error: 'Failed to start image scan' }, { status: 500 })
  }
}
