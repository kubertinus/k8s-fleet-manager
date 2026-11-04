import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleIntervalHours, summarize } from '@/lib/velero'

const NOW = new Date('2026-11-01T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const backup = (name: string, startedHoursAgo: number, phase = 'Completed', items = 800, schedule = 'daily') => ({
  metadata: { name, namespace: 'velero', labels: { 'velero.io/schedule-name': schedule } },
  spec: { storageLocation: 'default' },
  status: { phase, startTimestamp: hoursAgo(startedHoursAgo), completionTimestamp: hoursAgo(startedHoursAgo - 0.1), progress: { itemsBackedUp: items, totalItems: items }, errors: phase === 'PartiallyFailed' ? 3 : 0 },
})
const schedule = (spec: object = {}) => ({ metadata: { name: 'daily', namespace: 'velero' }, spec: { schedule: '0 2 * * *', ...spec }, status: { phase: 'Enabled' } })
const location = (phase = 'Available') => ({ metadata: { name: 'default', namespace: 'velero' }, spec: { default: true, provider: 'aws', objectStorage: { bucket: 'b' } }, status: { phase } })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('scheduleIntervalHours', () => {
  it('understands cron, @every and named schedules', () => {
    expect(scheduleIntervalHours('0 2 * * *')).toBe(24)
    expect(scheduleIntervalHours('CRON_TZ=Europe/Amsterdam 0 */6 * * *')).toBe(6)
    expect(scheduleIntervalHours('0 1,13 * * *')).toBe(12)
    expect(scheduleIntervalHours('0 3 * * 0')).toBe(168)
    expect(scheduleIntervalHours('@every 1h30m')).toBe(1.5)
    expect(scheduleIntervalHours('@daily')).toBe(24)
    expect(scheduleIntervalHours('nonsense')).toBeNull()
  })
})

describe('summarize', () => {
  it('has no warnings for recent, complete backups', () => {
    const data = summarize([backup('b2', 10), backup('b1', 34)], [schedule()], [location()])
    expect(data.warnings).toEqual([])
    expect(data.lastBackup?.name).toBe('b2')
    expect(data.schedules[0].intervalHours).toBe(24)
  })
  it('flags a large drop in backed-up items', () => {
    const data = summarize([backup('b2', 10, 'Completed', 406), backup('b1', 34, 'Completed', 831)], [schedule()], [location()])
    expect(data.warnings).toEqual([{ severity: 'warning', message: 'Backup b2 has 406 items, 51% fewer than the previous one (831)' }])
  })
  it('flags failed, stale and paused schedules and unavailable storage', () => {
    expect(summarize([backup('b1', 10, 'Failed')], [schedule()], [location()]).warnings.map(w => w.severity)).toEqual(['critical', 'critical'])
    expect(summarize([backup('b1', 10, 'PartiallyFailed')], [schedule()], [location()]).warnings[0]).toMatchObject({ severity: 'warning' })
    expect(summarize([backup('b1', 40)], [schedule()], [location()]).warnings[0].message).toContain('No successful backup of "daily"')
    expect(summarize([], [schedule({ paused: true })], [location()]).warnings).toEqual([{ severity: 'warning', message: 'Schedule "daily" is paused' }])
    expect(summarize([backup('b1', 10)], [schedule()], [location('Unavailable')]).warnings[0]).toMatchObject({ severity: 'critical' })
  })
  it('sorts backups newest first and computes durations', () => {
    const data = summarize([backup('old', 50), backup('new', 2)], [], [])
    expect(data.backups.map(b => b.name)).toEqual(['new', 'old'])
    expect(data.backups[0].durationSeconds).toBe(360)
  })
})
