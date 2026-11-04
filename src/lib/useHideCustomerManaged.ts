'use client'

import { useSyncExternalStore } from 'react'

// Global "hide customer managed" switch, shared by every page and kept per browser.

const STORAGE_KEY = 'k8s-fleet-manager.hideCustomerManaged'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setHideCustomerManaged(hide: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(hide))
  } catch {
    // not persisted; still applies until reload
  }
  memory = hide
  listeners.forEach(listener => listener())
}

let memory: boolean | null = null

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Follow changes made in other tabs
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      memory = e.newValue === 'true'
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useHideCustomerManaged(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (memory ??= read()),
    () => false
  )
}
