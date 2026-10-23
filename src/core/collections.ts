import type { Item, ItemType } from './types'

/** A saved filter that stays up to date by itself. */
export interface CollectionQuery {
  types?: ItemType[]
  tags?: string[]
  folder?: string
  text?: string
  /** Updated within the last N days. */
  days?: number
  /** Never opened on this device. */
  unread?: boolean
  pinned?: boolean
}

export interface Collection {
  id: string
  name: string
  icon: string
  query: CollectionQuery
  builtin?: boolean
}

export const BUILTIN_COLLECTIONS: Collection[] = [
  { id: 'pinned', name: 'Pinned', icon: 'sparkle', builtin: true, query: { pinned: true } },
  { id: 'unread-web', name: 'Unread web clips', icon: 'web', builtin: true, query: { types: ['web'], unread: true } },
  { id: 'this-week', name: 'This week', icon: 'refresh', builtin: true, query: { days: 7 } },
  { id: 'pdfs', name: 'PDFs', icon: 'pdf', builtin: true, query: { types: ['pdf'] } },
  { id: 'all-prompts', name: 'All prompts', icon: 'prompt', builtin: true, query: { types: ['prompt'] } },
]

export interface CollectionContext {
  seen: ReadonlySet<string>
  now: number
}

const DAY = 86_400_000

export function matchesQuery(item: Item, q: CollectionQuery, ctx: CollectionContext): boolean {
  if (item.deleted || item.status !== 'organized') return false
  if (q.types?.length && !q.types.includes(item.type)) return false
  if (q.tags?.length && !q.tags.every((t) => item.tags.includes(t))) return false
  if (q.folder && item.folder !== q.folder && !item.folder.startsWith(q.folder + '/')) return false
  if (q.pinned && !item.pinned) return false
  if (q.unread && ctx.seen.has(item.id)) return false
  if (q.days && ctx.now - item.updatedAt > q.days * DAY) return false
  if (q.text) {
    const hay = `${item.title} ${item.tags.join(' ')} ${item.content}`.toLowerCase()
    if (!hay.includes(q.text.toLowerCase())) return false
  }
  return true
}

export function applyCollection(items: Item[], q: CollectionQuery, ctx: CollectionContext): Item[] {
  return items.filter((i) => matchesQuery(i, q, ctx)).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function isEmptyQuery(q: CollectionQuery): boolean {
  return !q.types?.length && !q.tags?.length && !q.folder && !q.text && !q.days && !q.unread && !q.pinned
}

export function newCollectionId(name: string, now = Date.now()): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return `c-${slug || 'collection'}-${now.toString(36)}`
}
