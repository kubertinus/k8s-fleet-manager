import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { getPool, initializeDatabase } from '@/lib/database'
import { loadHarborMirrorSettings, mirrorImage } from '@/lib/images/harbor'

const MAX_IMAGES = 200

// Pull the newer version of each selected image into Harbor, one at a time.
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
    let settings
    try {
      settings = await loadHarborMirrorSettings()
    } catch (error: any) {
      return NextResponse.json({ error: error?.message || 'Harbor is not configured' }, { status: 400 })
    }

    const unique = Array.from(new Set(images))
    const versions = await getPool().query(
      'SELECT image, registry, repository, status, latest_version FROM image_versions WHERE image = ANY($1)',
      [unique]
    )
    const byImage = new Map(versions.rows.map((row: any) => [row.image, row]))

    const failed: { image: string; error: string }[] = []
    let mirrored = 0
    for (const image of unique) {
      const row = byImage.get(image)
      if (!row || row.status !== 'update' || !row.latest_version) continue
      const tagged = `${row.registry}/${row.repository}:${row.latest_version}`
      try {
        const result = await mirrorImage(settings, tagged)
        mirrored++
        console.log(`[image-mirror] ${tagged} -> ${result.target}`)
      } catch (error: any) {
        failed.push({ image, error: error?.message || 'Mirror failed' })
        console.error(`[image-mirror] ${tagged} failed:`, error?.message || error)
      }
    }

    return NextResponse.json({ mirrored, failed })
  } catch (error) {
    console.error('Error mirroring images:', error)
    return NextResponse.json({ error: 'Failed to pull images to Harbor' }, { status: 500 })
  }
}
