import { NextRequest, NextResponse } from 'next/server'
import { initializeDatabase, query } from '../../../../../../lib/database'

interface PersistedImageUpdateState {
  imagesWithUpdates: string[]
  imageUpdateDetails: Record<string, { newerVersion?: string; checkedVia?: 'nexus' | 'current-repo' }>
  lastImageUpdateCheckAt: string | null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeDatabase()

    const resolvedParams = await params
    const clusterId = parseInt(resolvedParams.id)

    if (Number.isNaN(clusterId)) {
      return NextResponse.json({ error: 'Invalid cluster id' }, { status: 400 })
    }

    const result = await query(
      `SELECT images_with_updates, update_details, last_checked_at
       FROM cluster_image_update_checks
       WHERE cluster_id = $1`,
      [clusterId]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({
        imagesWithUpdates: [],
        imageUpdateDetails: {},
        lastImageUpdateCheckAt: null
      })
    }

    const row = result.rows[0]
    return NextResponse.json({
      imagesWithUpdates: Array.isArray(row.images_with_updates) ? row.images_with_updates : [],
      imageUpdateDetails: row.update_details && typeof row.update_details === 'object' ? row.update_details : {},
      lastImageUpdateCheckAt: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null
    })
  } catch (error) {
    console.error('Error loading image update state:', error)
    return NextResponse.json(
      { error: 'Failed to load image update state' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeDatabase()

    const resolvedParams = await params
    const clusterId = parseInt(resolvedParams.id)

    if (Number.isNaN(clusterId)) {
      return NextResponse.json({ error: 'Invalid cluster id' }, { status: 400 })
    }

    const body = await request.json() as PersistedImageUpdateState

    const imagesWithUpdates = Array.isArray(body.imagesWithUpdates) ? body.imagesWithUpdates : []
    const imageUpdateDetails = body.imageUpdateDetails && typeof body.imageUpdateDetails === 'object'
      ? body.imageUpdateDetails
      : {}
    const lastImageUpdateCheckAt = body.lastImageUpdateCheckAt || null

    await query(
      `INSERT INTO cluster_image_update_checks (
         cluster_id,
         images_with_updates,
         update_details,
         last_checked_at,
         updated_at
       )
       VALUES ($1, $2::jsonb, $3::jsonb, $4::timestamptz, CURRENT_TIMESTAMP)
       ON CONFLICT (cluster_id)
       DO UPDATE SET
         images_with_updates = EXCLUDED.images_with_updates,
         update_details = EXCLUDED.update_details,
         last_checked_at = EXCLUDED.last_checked_at,
         updated_at = CURRENT_TIMESTAMP`,
      [
        clusterId,
        JSON.stringify(imagesWithUpdates),
        JSON.stringify(imageUpdateDetails),
        lastImageUpdateCheckAt
      ]
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error saving image update state:', error)
    return NextResponse.json(
      { error: 'Failed to save image update state' },
      { status: 500 }
    )
  }
}
