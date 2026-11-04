'use client'

import { useSyncExternalStore } from 'react'

// Lightweight client-side store so the sidebar can show the cluster list with the
// latest known health status without doing its own (expensive) health checks.
// The dashboard and the cluster detail page push results into it.

export interface ClusterSummary {
  id: number
  name: string
  status: string
}

const STORAGE_KEY = 'k8s-fleet-manager.clusterSummaries'

let clusters: ClusterSummary[] = []
let loaded = false
let fetching = false
const listeners = new Set<() => void>()

function emit() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(clusters))
  } catch {
    // storage unavailable; the in-memory copy is enough
  }
  listeners.forEach(listener => listener())
}

function hydrate() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) clusters = JSON.parse(raw)
  } catch {
    clusters = []
  }
}

export function setClusterList(list: ClusterSummary[]) {
  const previous = new Map(clusters.map(c => [c.id, c.status]))
  clusters = list.map(c => ({
    ...c,
    // keep the last known status while a fresh check is still running
    status: c.status === 'checking' && previous.has(c.id) ? previous.get(c.id)! : c.status,
  }))
  emit()
}

export function setClusterStatus(id: number, status: string, name?: string) {
  const existing = clusters.find(c => c.id === id)
  if (existing) {
    if (existing.status === status && (!name || existing.name === name)) return
    clusters = clusters.map(c => (c.id === id ? { ...c, status, name: name ?? c.name } : c))
  } else if (name) {
    clusters = [...clusters, { id, name, status }]
  } else {
    return
  }
  emit()
}

// Fetch the (cheap) cluster list once if nothing is known yet, e.g. when the
// user lands directly on a cluster or settings page.
export async function ensureClusterList() {
  hydrate()
  if (clusters.length > 0 || fetching) return
  fetching = true
  try {
    const response = await fetch('/api/clusters/quick', { headers: { 'Cache-Control': 'no-cache' } })
    if (!response.ok) return
    const data = await response.json()
    setClusterList(
      (data.clusters || []).map((c: ClusterSummary) => ({ id: c.id, name: c.name, status: 'unknown' }))
    )
  } catch {
    // sidebar simply stays empty
  } finally {
    fetching = false
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const EMPTY: ClusterSummary[] = []

export function useClusterSummaries(): ClusterSummary[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      hydrate()
      return clusters
    },
    () => EMPTY
  )
}

// Shared status helpers so every page uses the same colours and wording.
export type StatusTone = 'ok' | 'warn' | 'err' | 'muted' | 'info'

export function statusTone(status: string): StatusTone {
  switch (status) {
    case 'healthy':
      return 'ok'
    case 'warning':
      return 'warn'
    case 'error':
    case 'unhealthy':
    case 'timeout':
    case 'unreachable':
      return 'err'
    case 'checking':
      return 'info'
    default:
      return 'muted'
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'healthy':
      return 'Healthy'
    case 'warning':
      return 'Warning'
    case 'error':
    case 'unhealthy':
      return 'Critical'
    case 'timeout':
      return 'Timeout'
    case 'unreachable':
      return 'Unreachable'
    case 'checking':
      return 'Checking'
    default:
      return 'Unknown'
  }
}
