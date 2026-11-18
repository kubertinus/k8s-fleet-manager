import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { initializeDatabase } from '@/lib/database'
import { loadHarborMirrorSettings } from '@/lib/images/harbor'
import { startImageMirror } from '@/lib/images/mirror-run'

const MAX_IMAGES = 200

// Start a pull. The copy continues on the server after this response, so a closed
// browser tab does not stop it. The report page polls image_mirror_runs for the result.
export async function POST(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { images } = await request.json()
    if (!Array.isArray(images) || images.length === 0 || !images.every(image => typeof image === 'string')) {
      return NextResponse.json({ error: 'Expected a non-empty list of images' }, { status: 400 })
    }
    if (images.length > MAX_IMAGES) {
      return NextResponse.json({ error: `At most ${MAX_IMAGES} images at once` }, { status: 400 })
    }

    await initializeDatabase()
    try {
      await loadHarborMirrorSettings()
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'Harbor is not configured' }, { status: 400 })
    }

    const runId = await startImageMirror(images)
    if (runId === null) {
      return NextResponse.json({ error: 'A pull is already running' }, { status: 409 })
    }
    return NextResponse.json({ runId }, { status: 202 })
  } catch (error) {
    console.error('Error starting image mirror:', error)
    return NextResponse.json({ error: 'Failed to pull images to Harbor' }, { status: 500 })
  }
}
