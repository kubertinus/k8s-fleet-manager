'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { formatDateTime, type Schedule } from './types'

const COMMON_TIMEZONES = ['Europe/Amsterdam', 'Europe/London', 'UTC', 'America/New_York', 'Asia/Singapore']

export default function SchedulePanel({
  schedule,
  canEdit,
  onClose,
  onSaved,
}: {
  schedule: Schedule
  canEdit: boolean
  onClose: () => void
  onSaved: (schedule: Schedule) => void
}) {
  const [enabled, setEnabled] = useState(schedule.enabled)
  const [time, setTime] = useState(schedule.time)
  const [timezone, setTimezone] = useState(schedule.timezone)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/images/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, time, timezone }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to save schedule')
      onSaved(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-24">
      <div className="absolute inset-0 bg-slate-950/70" onClick={onClose} />
      <div className="card relative w-full max-w-sm bg-slate-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Nightly scan</h2>
          <button onClick={onClose} className="btn-ghost px-1.5 py-1" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-400">
          Collects the images of all workloads in every cluster and checks for newer versions on Nexus (when configured) or online.
        </p>

        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={enabled} disabled={!canEdit} onChange={e => setEnabled(e.target.checked)} />
            Run every night
          </label>
          <div className="grid grid-cols-[7rem_1fr] gap-3">
            <label className="space-y-1.5 text-sm text-slate-300">
              <span>Time</span>
              <input type="time" className="input" value={time} disabled={!canEdit || !enabled} onChange={e => setTime(e.target.value)} />
            </label>
            <label className="space-y-1.5 text-sm text-slate-300">
              <span>Timezone</span>
              <input
                className="input"
                list="image-scan-timezones"
                value={timezone}
                disabled={!canEdit || !enabled}
                onChange={e => setTimezone(e.target.value)}
              />
              <datalist id="image-scan-timezones">
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </label>
          </div>
          {schedule.enabled && schedule.nextRunAt && <p className="text-xs text-slate-500">Next run: {formatDateTime(schedule.nextRunAt)}</p>}
          {error && <p className="text-sm text-rose-300">{error}</p>}
          {canEdit ? (
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Only administrators can change the schedule.</p>
          )}
        </div>
      </div>
    </div>
  )
}
