import { useEffect, useState } from 'react'
import type { Item, ItemType } from '../core/types'

export const TYPE_META: Record<ItemType, { label: string; icon: string; plural: string }> = {
  note: { label: 'Note', icon: 'note', plural: 'Notes' },
  pdf: { label: 'PDF', icon: 'pdf', plural: 'PDFs' },
  web: { label: 'Web page', icon: 'web', plural: 'Web pages' },
  prompt: { label: 'Prompt', icon: 'prompt', plural: 'Prompts' },
  file: { label: 'File', icon: 'file', plural: 'Files' },
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 330 ? 'numeric' : undefined })
}

export function formatBytes(n?: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function hostOf(url?: string): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function sortByRecent(items: Item[]): Item[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Copy text; falls back to a hidden textarea where the async clipboard API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}
