import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  text: string
  kind: 'ok' | 'warn' | 'error'
  action?: { label: string; href: string }
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

export function toast(text: string, kind: Toast['kind'] = 'ok', action?: Toast['action']) {
  const t: Toast = { id: nextId++, text, kind, action }
  toasts = [...toasts, t].slice(-4)
  listeners.forEach((l) => l())
  setTimeout(() => dismiss(t.id), kind === 'ok' ? 3200 : 6000)
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  listeners.forEach((l) => l())
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => toasts,
  )
}
