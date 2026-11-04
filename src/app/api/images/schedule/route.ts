import { NextRequest, NextResponse } from 'next/server'
import { getPool, initializeDatabase } from '@/lib/database'
import { verifyToken } from '@/lib/auth'
import { getSchedule, isValidTime, isValidTimezone, nextRunAt } from '@/lib/images/scheduler'

// Update the nightly scan schedule (admins only).
export async function PUT(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
  const user = token ? verifyToken(token) : null
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const { enabled, time, timezone } = await request.json()
    if (typeof enabled !== 'boolean' || typeof time !== 'string' || !isValidTime(time)) {
      return NextResponse.json({ error: 'Invalid schedule: time must be HH:MM' }, { status: 400 })
    }
    if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
      return NextResponse.json({ error: `Unknown timezone "${timezone}"` }, { status: 400 })
    }

    await initializeDatabase()
    const pool = getPool()
    for (const [key, value] of [
      ['image_scan_enabled', String(enabled)],
      ['image_scan_time', time],
      ['image_scan_timezone', timezone],
    ]) {
      await pool.query('UPDATE settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2', [value, key])
    }

    const schedule = await getSchedule()
    return NextResponse.json({ ...schedule, nextRunAt: nextRunAt(schedule)?.toISOString() ?? null })
  } catch (error) {
    console.error('Error updating image scan schedule:', error)
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 })
  }
}
