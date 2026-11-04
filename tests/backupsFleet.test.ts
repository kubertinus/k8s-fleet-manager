import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { summarize } from '@/lib/velero'
import { dailyBuckets, outcomeCounts, outcomeOf, successRate, toFleetCluster } from '@/lib/backupsFleet'

const NOW = new Date(2026, 10, 3, 12, 0, 0) // local time, so day buckets are predictable
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const backup = (name: string, startedHoursAgo: number, phase = 'Completed') => ({
  metadata: { name, namespace: 'velero', labels: { 'velero.io/schedule-name': 'daily' } },
  spec: { storageLocation: 'default' },
  status: { phase, startTimestamp: hoursAgo(startedHoursAgo), completionTimestamp: hoursAgo(startedHoursAgo - 0.1), progress: { itemsBackedUp: 800, totalItems: 800 } },
})
const schedule = { metadata: { name: 'daily', namespace: 'velero' }, spec: { schedule: '0 2 * * *' }, status: { phase: 'Enabled' } }
const location = { metadata: { name: 'default', namespace: 'velero' }, spec: { default: true }, status: { phase: 'Available' } }
const cluster = { id: 1, name: 'prod' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('toFleetCluster', () => {
  it('is ok with recent, complete backups', () => {
    const row = toFleetCluster(cluster, summarize([backup('b2', 10), backup('b1', 34)], [schedule], [location]), null)
    expect(row.status).toBe('ok')
    expect(row.lastSuccessful?.name).toBe('b2')
    expect(row.schedules).toEqual({ total: 1, active: 1 })
    expect(row.locations).toEqual([{ name: 'default', phase: 'Available' }])
  })

  it('is critical when the last backup failed, and finds the last successful one', () => {
    const row = toFleetCluster(cluster, summarize([backup('b3', 5, 'Failed'), backup('b2', 29)], [schedule], [location]), null)
    expect(row.status).toBe('critical')
    expect(row.lastBackup?.name).toBe('b3')
    expect(row.lastSuccessful?.name).toBe('b2')
  })

  it('keeps only backups of the last 14 days', () => {
    const row = toFleetCluster(cluster, summarize([backup('new', 10), backup('old', 24 * 20)], [], [location]), null)
    expect(row.recent.map(b => b.name)).toEqual(['new'])
  })

  it('tells "not installed" and "unreachable" apart', () => {
    expect(toFleetCluster(cluster, summarize([], [], [], false), null).status).toBe('not-installed')
    const unreachable = toFleetCluster(cluster, null, 'connect ECONNREFUSED')
    expect(unreachable.status).toBe('unreachable')
    expect(unreachable.error).toBe('connect ECONNREFUSED')
  })
})

describe('outcomes', () => {
  const data = summarize(
    [backup('a', 2), backup('b', 26, 'PartiallyFailed'), backup('c', 50, 'Failed'), backup('d', 1, 'InProgress'), backup('e', 24 * 9)],
    [],
    []
  )

  it('maps phases to outcomes', () => {
    expect(outcomeOf('Completed')).toBe('completed')
    expect(outcomeOf('FailedValidation')).toBe('failed')
    expect(outcomeOf('WaitingForPluginOperations')).toBe('running')
    expect(outcomeOf('Deleting')).toBe('none')
  })

  it('counts outcomes within the window and computes the success rate over finished backups', () => {
    const counts = outcomeCounts(data.backups, 7)
    expect(counts).toEqual({ completed: 1, partial: 1, failed: 1, running: 1 })
    expect(successRate(counts)).toBeCloseTo(1 / 3)
    expect(successRate({ completed: 0, partial: 0, failed: 0, running: 2 })).toBeNull()
  })

  it('buckets per local day with the worst outcome winning', () => {
    const buckets = dailyBuckets(data.backups, 14, NOW)
    expect(buckets).toHaveLength(14)
    const today = buckets[13]
    expect(today.date.getDate()).toBe(3)
    expect(today.completed).toBe(1)
    expect(today.running).toBe(1)
    expect(today.outcome).toBe('completed')
    expect(buckets[12].outcome).toBe('partial') // 26 h ago: 2 Nov
    expect(buckets[11].outcome).toBe('failed') // 50 h ago: 1 Nov
    expect(buckets[4].outcome).toBe('completed') // 9 days ago
    expect(buckets[0].outcome).toBe('none')
  })
})
