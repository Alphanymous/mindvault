import { useSyncExternalStore } from 'react'
import { buildLinkIndex, renameWikiLinks, type LinkIndex } from '../core/links'
import { classify, refineWithLlm, type ClassifyInput } from '../core/classify'
import { DEFAULT_SETTINGS, type Item, type ItemType, type Settings, type Suggestion } from '../core/types'
import { onlyNewer } from '../sync/plan'
import { blobsDb, itemsDb, metaDb } from './db'

export interface State {
  ready: boolean
  items: Item[]
  settings: Settings
  /** Derived and rebuilt on every change. */
  links: LinkIndex
  folders: string[]
  tags: Map<string, number>
}

const listeners = new Set<() => void>()
let state: State = {
  ready: false,
  items: [],
  settings: DEFAULT_SETTINGS,
  links: buildLinkIndex([]),
  folders: [],
  tags: new Map(),
}

function derive(items: Item[], settings: Settings, ready = true): State {
  const live = items.filter((i) => !i.deleted)
  const folders = new Set<string>()
  const tags = new Map<string, number>()
  for (const it of live) {
    if (it.status === 'organized' && it.folder) {
      // register every ancestor so "Dev/Code" also yields "Dev"
      const parts = it.folder.split('/')
      for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'))
    }
    for (const t of it.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
  }
  return { ready, items, settings, links: buildLinkIndex(live), folders: [...folders].sort(), tags }
}

function commit(items: Item[], settings = state.settings) {
  state = derive(items, settings)
  listeners.forEach((l) => l())
}

export function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const getState = () => state
export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state))
}
export const useAppState = () => useSyncExternalStore(subscribe, () => state)

export function newId(): string {
  // crypto.randomUUID needs a secure context; the app can also be served over plain http from a paired computer.
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function initStore() {
  const [items, settings] = await Promise.all([itemsDb.all(), metaDb.get<Settings>('settings')])
  const merged = { ...DEFAULT_SETTINGS, ...(settings ?? {}) }
  const envClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
  if (!merged.googleClientId && envClientId) merged.googleClientId = envClientId
  state = derive(items, merged)
  listeners.forEach((l) => l())
}

export function liveItems(): Item[] {
  return state.items.filter((i) => !i.deleted)
}

export async function saveSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch }
  await metaDb.set('settings', settings)
  commit(state.items, settings)
}

export interface NewItemInput extends ClassifyInput {
  type?: ItemType
  blob?: Blob
  size?: number
  /** Skip the inbox and file directly (used by the "new note" shortcut). */
  organized?: boolean
  folder?: string
  tags?: string[]
  skipLlm?: boolean
}

/** Create an item, classify it and place it in the inbox (or straight into the library). */
export async function createItem(input: NewItemInput): Promise<Item> {
  const now = Date.now()
  const id = newId()
  const existing = state.items
  let suggestion: Suggestion = classify({ ...input, forcedType: input.type ?? input.forcedType }, { items: existing })
  const s = state.settings
  if (s.llmEndpoint && !input.skipLlm && !input.organized) {
    suggestion = await refineWithLlm(
      suggestion,
      { ...input, forcedType: input.type ?? input.forcedType },
      state.folders,
      { endpoint: s.llmEndpoint, model: s.llmModel, apiKey: s.llmApiKey },
    )
  }
  const title = (input.title?.trim() || firstLine(input.content) || input.fileName || 'Untitled').slice(0, 140)
  let blobId: string | undefined
  if (input.blob) {
    blobId = id
    await blobsDb.put({ id, mime: input.mime ?? input.blob.type ?? 'application/octet-stream', data: input.blob, updatedAt: now })
  }
  // Captures file themselves: the suggested folder and tags are applied straight away.
  const item: Item = {
    id,
    type: suggestion.type,
    title,
    content: input.content,
    url: input.url,
    folder: input.organized ? (input.folder ?? '') : suggestion.folder,
    tags: input.organized ? (input.tags ?? []) : suggestion.tags,
    status: 'organized',
    blobId,
    mime: input.mime,
    fileName: input.fileName,
    size: input.size,
    createdAt: now,
    updatedAt: now,
  }
  await itemsDb.put(item)
  commit([...state.items, item])
  return item
}

function firstLine(s: string): string {
  const line = (s.split('\n').find((l) => l.trim()) ?? '').replace(/^#+\s*/, '').trim()
  if (line.length <= 70) return line
  const cut = line.slice(0, 70)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[\s,;:.-]+$/, '') + '…'
}

export async function updateItem(id: string, patch: Partial<Item>) {
  const prev = state.items.find((i) => i.id === id)
  if (!prev) return
  const next: Item = { ...prev, ...patch, updatedAt: Date.now() }
  const writes: Item[] = [next]
  let items = state.items.map((i) => (i.id === id ? next : i))

  // Renaming keeps incoming [[links]] working.
  if (patch.title !== undefined && patch.title !== prev.title && prev.title) {
    items = items.map((i) => {
      if (i.id === id || i.deleted) return i
      const content = renameWikiLinks(i.content, prev.title, next.title)
      if (content === i.content) return i
      const edited = { ...i, content, updatedAt: next.updatedAt }
      writes.push(edited)
      return edited
    })
  }
  await itemsDb.putMany(writes)
  commit(items)
}

export async function acceptSuggestion(id: string, override: Partial<Pick<Item, 'folder' | 'tags' | 'type'>> = {}) {
  const it = state.items.find((i) => i.id === id)
  if (!it?.suggestion) return
  const s = it.suggestion
  await updateItem(id, {
    status: 'organized',
    type: override.type ?? s.type,
    folder: override.folder ?? s.folder,
    tags: override.tags ?? s.tags,
    suggestion: undefined,
  })
}

/** Files items still waiting in the old inbox (from earlier versions or older synced devices). */
export async function fileWaitingItems() {
  const pending = state.items.filter((i) => !i.deleted && i.status === 'inbox')
  for (const it of pending) {
    if (it.suggestion) await acceptSuggestion(it.id)
    else await updateItem(it.id, { status: 'organized' })
  }
  return pending.length
}

/** Soft delete (tombstone) so removal syncs across devices. */
export async function deleteItem(id: string) {
  const it = state.items.find((i) => i.id === id)
  if (!it) return
  if (it.blobId) await blobsDb.delete(it.blobId)
  await updateItem(id, { deleted: true, content: '', blobId: undefined })
}

/** Apply items downloaded by a sync. Copies older than what is stored now (edited during the sync) are dropped. */
export async function replaceItemsFromSync(incoming: Item[]) {
  const before = new Map(state.items.map((i) => [i.id, i]))
  const items = onlyNewer(before, incoming)
  if (!items.length) return
  // An edit made during this write queues its own write after this one, so the database keeps the edit.
  await itemsDb.putMany(items)
  // Re-read state: it may have changed while the write was awaited.
  const map = new Map(state.items.map((i) => [i.id, i]))
  for (const i of onlyNewer(map, items)) map.set(i.id, i)
  commit([...map.values()])
  // A deletion from another device also frees the original file stored here.
  for (const i of items) {
    const old = before.get(i.id)?.blobId
    if (i.deleted && old) await blobsDb.delete(old)
  }
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return (await blobsDb.get(id))?.data
}
