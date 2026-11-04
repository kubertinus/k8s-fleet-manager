import { getPool, initializeDatabase } from '@/lib/database'
import { runImageScan } from './scan'

// Runs the image scan once a day at the configured time. Started from
// instrumentation.ts when the server boots. If the server was down at the
// scheduled time, the missed run is done as soon as it is up again (same day).

export interface ScanSchedule {
  enabled: boolean
  time: string // HH:MM
  timezone: string
}

const CHECK_INTERVAL_MS = 60_000
const MAX_ATTEMPTS = 3

export const DEFAULT_SCHEDULE: ScanSchedule = { enabled: true, time: '02:00', timezone: 'Europe/Amsterdam' }

export function isValidTime(time: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
}

export function isValidTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export async function getSchedule(): Promise<ScanSchedule> {
  const result = await getPool().query('SELECT key, value FROM settings WHERE key = ANY($1)', [
    ['image_scan_enabled', 'image_scan_time', 'image_scan_timezone'],
  ])
  const settings = Object.fromEntries(result.rows.map((row: any) => [row.key, row.value]))
  const time = settings.image_scan_time
  const timezone = settings.image_scan_timezone
  return {
    enabled: (settings.image_scan_enabled ?? 'true') === 'true',
    time: time && isValidTime(time) ? time : DEFAULT_SCHEDULE.time,
    timezone: timezone && isValidTimezone(timezone) ? timezone : DEFAULT_SCHEDULE.timezone,
  }
}

// Wall-clock date (YYYY-MM-DD) and time (HH:MM) in a timezone.
function localNow(timezone: string, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map(p => [p.type, p.value])
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Next scheduled moment as a Date (searches minute by minute over the next 48h,
// which also handles DST changes without date maths).
export function nextRunAt(schedule: ScanSchedule, from = new Date()): Date | null {
  if (!schedule.enabled) return null
  const start = new Date(Math.ceil(from.getTime() / 60_000) * 60_000)
  for (let i = 0; i < 48 * 60; i++) {
    const candidate = new Date(start.getTime() + i * 60_000)
    if (localNow(schedule.timezone, candidate).time === schedule.time) return candidate
  }
  return null
}

async function tick() {
  try {
    await initializeDatabase()
    const schedule = await getSchedule()
    if (!schedule.enabled) return

    const now = localNow(schedule.timezone)
    if (now.time < schedule.time) return

    // Done for today once a scan (scheduled or manual) succeeded or is running since
    // the scheduled time; a failed scheduled run is retried at most MAX_ATTEMPTS times a day.
    const minutesSinceScheduled = toMinutes(now.time) - toMinutes(schedule.time)
    const today = await getPool().query(
      `SELECT
         COUNT(*) FILTER (WHERE status <> 'failed' AND started_at >= NOW() - make_interval(mins => $2)) AS ok,
         COUNT(*) FILTER (WHERE trigger = 'scheduled' AND scheduled_for = $1) AS attempts
       FROM image_scan_runs`,
      [now.date, minutesSinceScheduled]
    )
    if (Number(today.rows[0].ok) > 0 || Number(today.rows[0].attempts) >= MAX_ATTEMPTS) return

    await runImageScan('scheduled', { scheduledFor: now.date })
  } catch (error) {
    console.error('[image-scan] scheduler tick failed:', error)
  }
}

export function startImageScanScheduler() {
  const g = globalThis as any
  if (g.__k8sFleetManagerImageScheduler) return
  g.__k8sFleetManagerImageScheduler = true

  let running = false
  const guardedTick = async () => {
    if (running) return
    running = true
    try {
      await tick()
    } finally {
      running = false
    }
  }

  // First check shortly after boot, then every minute.
  setTimeout(guardedTick, 30_000)
  setInterval(guardedTick, CHECK_INTERVAL_MS)
  console.log('[image-scan] scheduler started')
}
