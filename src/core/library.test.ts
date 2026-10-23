import { describe, expect, it } from 'vitest'
import { applyCollection, BUILTIN_COLLECTIONS, isEmptyQuery, newCollectionId } from './collections'
import { addCollection, normalizeUsage, openItem, rememberVars, removeCollection, topModels, usePrompt, EMPTY_USAGE } from './usage'
import { createSequencer, SHORTCUTS } from './keys'
import { runPrompt } from './promptRun'
import type { Item } from './types'

let n = 0
const mk = (title: string, over: Partial<Item> = {}): Item => ({
  id: `it${String(++n).padStart(5, '0')}`, type: 'note', title, content: `${title} body`, folder: '', tags: [], status: 'organized', createdAt: 1, updatedAt: 1000, ...over,
})
const DAY = 86_400_000

describe('collections', () => {
  const now = 100 * DAY
  const items = [
    mk('clip a', { type: 'web', updatedAt: now - DAY }),
    mk('clip b', { type: 'web', updatedAt: now - 30 * DAY }),
    mk('pinned note', { pinned: true, updatedAt: now - 40 * DAY }),
    mk('tagged', { tags: ['ai', 'work'], folder: 'Dev/Code', updatedAt: now }),
    mk('in inbox', { status: 'inbox', type: 'web' }),
    mk('gone', { deleted: true, type: 'web' }),
  ]
  const ctx = (seen: string[] = []) => ({ seen: new Set(seen), now })
  const by = (id: string) => BUILTIN_COLLECTIONS.find((c) => c.id === id)!.query

  it('built-ins filter by type, pin, recency and read state', () => {
    expect(applyCollection(items, by('unread-web'), ctx()).map((i) => i.title)).toEqual(['clip a', 'clip b'])
    expect(applyCollection(items, by('unread-web'), ctx([items[0].id])).map((i) => i.title)).toEqual(['clip b'])
    expect(applyCollection(items, by('pinned'), ctx()).map((i) => i.title)).toEqual(['pinned note'])
    expect(applyCollection(items, by('this-week'), ctx()).map((i) => i.title)).toEqual(['tagged', 'clip a'])
  })
  it('combines tags, folder prefix and text; never returns inbox or deleted items', () => {
    expect(applyCollection(items, { tags: ['ai', 'work'], folder: 'Dev', text: 'TAGGED' }, ctx())).toHaveLength(1)
    expect(applyCollection(items, { types: ['web'] }, ctx()).map((i) => i.title)).not.toContain('in inbox')
    expect(applyCollection(items, { types: ['web'] }, ctx()).map((i) => i.title)).not.toContain('gone')
  })
  it('detects empty queries and creates distinct ids', () => {
    expect(isEmptyQuery({})).toBe(true)
    expect(isEmptyQuery({ tags: ['x'] })).toBe(false)
    expect(newCollectionId('My Reading!', 1)).toMatch(/^c-my-reading-/)
    expect(newCollectionId('A', 1)).not.toBe(newCollectionId('A', 2))
  })
})

describe('usage', () => {
  it('tracks recent and seen without duplicates', () => {
    let u = openItem(EMPTY_USAGE, 'a')
    u = openItem(u, 'b')
    u = openItem(u, 'a')
    expect(u.recent).toEqual(['a', 'b'])
    expect(u.seen).toEqual(['a', 'b'])
    const many = Array.from({ length: 60 }, (_, i) => `i${i}`).reduce(openItem, EMPTY_USAGE)
    expect(many.recent).toHaveLength(40)
    expect(many.recent[0]).toBe('i59')
  })
  it('counts prompt uses per model', () => {
    let u = usePrompt(EMPTY_USAGE, 'p', 'Claude', 5)
    u = usePrompt(u, 'p', 'Claude', 6)
    u = usePrompt(u, 'p', 'ChatGPT', 7)
    expect(u.prompts.p.count).toBe(3)
    expect(topModels(u.prompts.p)).toEqual([['Claude', 2], ['ChatGPT', 1]])
    expect(topModels(undefined)).toEqual([])
  })
  it('remembers non-empty variable answers and the newest wins', () => {
    const u = rememberVars(rememberVars(EMPTY_USAGE, { language: 'PT', text: '' }), { language: 'ES' })
    expect(u.vars).toEqual({ language: 'ES' })
  })
  it('stores and removes collections; normalizes junk input', () => {
    const c = { id: 'c1', name: 'x', icon: 'tag', query: {} }
    expect(addCollection(EMPTY_USAGE, c).collections).toEqual([c])
    expect(removeCollection(addCollection(EMPTY_USAGE, c), 'c1').collections).toEqual([])
    expect(normalizeUsage('garbage')).toEqual(EMPTY_USAGE)
    expect(normalizeUsage({ recent: ['a', 5, null] }).recent).toEqual(['a'])
  })
})

describe('key sequences', () => {
  it('completes "g i" within the timeout and resets after it', () => {
    const s = createSequencer(SHORTCUTS)
    expect(s.feed('g', 0)).toBeNull()
    expect(s.feed('i', 100)).toBe('inbox')
    expect(s.feed('g', 200)).toBeNull()
    expect(s.feed('i', 5000)).toBeNull() // too slow: "i" alone is nothing
  })
  it('fires single keys and recovers from a wrong second key', () => {
    const s = createSequencer(SHORTCUTS)
    expect(s.feed('c', 0)).toBe('capture')
    expect(s.feed('g', 10)).toBeNull()
    expect(s.feed('c', 20)).toBe('capture')
    expect(s.feed('?', 30)).toBe('help')
  })
})

describe('runPrompt', () => {
  const ok = (text: string) => (async () => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }))) as typeof fetch
  it('returns the model text', async () => {
    expect(await runPrompt({ endpoint: 'http://x', model: 'm', apiKey: 'k' }, 'hi', ok('  hello '))).toBe('hello')
  })
  it('explains missing endpoint and surfaces http errors', async () => {
    await expect(runPrompt({ endpoint: '', model: 'm', apiKey: '' }, 'hi')).rejects.toThrow('Settings')
    const bad = (async () => new Response('no', { status: 429 })) as typeof fetch
    await expect(runPrompt({ endpoint: 'http://x', model: 'm', apiKey: '' }, 'hi', bad)).rejects.toThrow('429')
    await expect(runPrompt({ endpoint: 'http://x', model: 'm', apiKey: '' }, 'hi', ok(' '))).rejects.toThrow('no text')
  })
})
