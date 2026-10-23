import { bestPassage, similarToText, type PassagePart, type SimilarityIndex } from './similarity'
import { search } from './search'
import type { Item } from './types'

export interface SmartHit {
  item: Item
  score: number
  passage: PassagePart[]
  /** Why it matched: exact words, topical similarity, or meaning (embeddings). */
  via: ('words' | 'topic' | 'meaning')[]
}

const RRF_K = 30

/**
 * Fuse three rankings with reciprocal rank fusion: exact words (core/search),
 * topical similarity (core/similarity) and, when available, embedding neighbours.
 */
export function smartSearch(
  items: Item[],
  query: string,
  index: SimilarityIndex | null,
  semantic: { id: string; score: number }[] = [],
  limit = 12,
): SmartHit[] {
  const q = query.trim()
  if (!q) return []
  const byId = new Map(items.filter((i) => !i.deleted).map((i) => [i.id, i]))
  const scores = new Map<string, number>()
  const via = new Map<string, Set<SmartHit['via'][number]>>()
  const add = (id: string, rank: number, weight: number, kind: SmartHit['via'][number]) => {
    if (!byId.has(id)) return
    scores.set(id, (scores.get(id) ?? 0) + weight / (RRF_K + rank))
    const s = via.get(id) ?? new Set()
    s.add(kind)
    via.set(id, s)
  }
  search(items, q, 40).forEach((h, r) => add(h.item.id, r, 1.4, 'words'))
  if (index) similarToText(index, q, 30).forEach((h, r) => add(h.id, r, 0.8, 'topic'))
  semantic.forEach((h, r) => add(h.id, r, 1.2, 'meaning'))

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => {
      const item = byId.get(id)!
      return { item, score, passage: bestPassage(item.content || item.title, q), via: [...(via.get(id) ?? [])] }
    })
}
