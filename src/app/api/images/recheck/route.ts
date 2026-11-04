import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { recheckImages } from '@/lib/images/scan'

const MAX_IMAGES = 200

// Re-run the version check for selected images.
export async function POST(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { images } = await request.json()
    if (!Array.isArray(images) || images.length === 0 || !images.every(i => typeof i === 'string')) {
      return NextResponse.json({ error: 'Expected a non-empty list of images' }, { status: 400 })
    }
    if (images.length > MAX_IMAGES) {
      return NextResponse.json({ error: `At most ${MAX_IMAGES} images at once; use a full scan instead` }, { status: 400 })
    }

    const results = await recheckImages(images)
    return NextResponse.json({ checked: results.length, updates: results.filter(r => r.status === 'update').length })
  } catch (error) {
    console.error('Error re-checking images:', error)
    return NextResponse.json({ error: 'Failed to re-check images' }, { status: 500 })
  }
}
