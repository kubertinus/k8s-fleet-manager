import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { initializeDatabase } from '@/lib/database'
import { loadHarborMirrorSettings } from '@/lib/images/harbor'
import { startImageMirror, type MirrorPull } from '@/lib/images/mirror-run'
import { isVersionTag } from '@/lib/images/versions'

const MAX_PULLS = 400

function parsePulls(body: unknown): MirrorPull[] | null {
  const pulls = (body as { pulls?: unknown })?.pulls
  if (!Array.isArray(pulls) || pulls.length === 0) return null
  const parsed: MirrorPull[] = []
  for (const item of pulls) {
    const image = (item as { image?: unknown })?.image
    const tag = (item as { tag?: unknown })?.tag
    if (typeof image !== 'string' || !image || image.length > 500) return null
    if (typeof tag !== 'string' || !isVersionTag(tag)) return null
    parsed.push({ image, tag })
  }
  return parsed
}

// Start a pull. The copy continues on the server after this response, so a closed
// browser tab does not stop it. The report page polls image_mirror_runs for the result.
export async function POST(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const pulls = parsePulls(await request.json())
    if (!pulls) {
      return NextResponse.json({ error: 'Expected a non-empty list of image versions' }, { status: 400 })
    }
    if (pulls.length > MAX_PULLS) {
      return NextResponse.json({ error: `At most ${MAX_PULLS} versions at once` }, { status: 400 })
    }

    await initializeDatabase()
    try {
      await loadHarborMirrorSettings()
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'Harbor is not configured' }, { status: 400 })
    }

    const runId = await startImageMirror(pulls)
    if (runId === null) {
      return NextResponse.json({ error: 'A pull is already running' }, { status: 409 })
    }
    return NextResponse.json({ runId }, { status: 202 })
  } catch (error) {
    console.error('Error starting image mirror:', error)
    return NextResponse.json({ error: 'Failed to pull images to Harbor' }, { status: 500 })
  }
}
