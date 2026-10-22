import type { Item } from './types'
import { excerpt, words } from './markdown'

export interface SearchHit {
  item: Item
  score: number
  /** Short snippet around the first content match. */
  snippet: string
}

/** Lightweight in-memory ranking: title > tags/folder > body, prefix and subsequence friendly. */
export function search(items: Item[], query: string, limit = 30): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const terms = words(q)
  if (!terms.length) return []
  const hits: SearchHit[] = []

  for (const item of items) {
    if (item.deleted) continue
    const title = item.title.toLowerCase()
    const body = item.content.toLowerCase()
    const tags = item.tags.join(' ')
    const folder = item.folder.toLowerCase()
    let score = 0
    let allMatched = true

    for (const t of terms) {
      let s = 0
      if (title === t) s += 60
      else if (title.startsWith(t)) s += 40
      else if (wordPrefix(title, t)) s += 30
      else if (title.includes(t)) s += 20
      if (tags.includes(t)) s += 14
      if (folder.includes(t)) s += 8
      if (item.url?.toLowerCase().includes(t)) s += 6
      const bodyHits = countOccurrences(body, t, 6)
      if (bodyHits) s += 3 + Math.log2(bodyHits + 1) * 3
      if (!s) allMatched = false
      score += s
    }
    if (!allMatched && !fuzzy(title, q)) continue
    if (!allMatched) score = 5
    if (item.pinned) score += 2
    hits.push({ item, score, snippet: snippetFor(item, terms[0]) })
  }
  return hits.sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt).slice(0, limit)
}

function wordPrefix(hay: string, t: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t)}`, 'u').test(hay)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countOccurrences(hay: string, needle: string, cap: number): number {
  let n = 0
  let i = hay.indexOf(needle)
  while (i !== -1 && n < cap) {
    n++
    i = hay.indexOf(needle, i + needle.length)
  }
  return n
}

/** Subsequence match: "mvt" matches "my vault tips". */
export function fuzzy(hay: string, needle: string): boolean {
  if (needle.length < 3) return false
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

function snippetFor(item: Item, term: string): string {
  const lower = item.content.toLowerCase()
  const idx = lower.indexOf(term)
  if (idx < 0) return excerpt(item.content, 120)
  const start = Math.max(0, idx - 40)
  const slice = item.content.slice(start, idx + 100)
  return (start > 0 ? '…' : '') + excerpt(slice, 140)
}
