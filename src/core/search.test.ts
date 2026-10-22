import { describe, expect, it } from 'vitest'
import { fuzzy, search } from './search'
import { fillPrompt, promptBody, promptVariables } from './prompts'
import type { Item } from './types'

let n = 0
const mk = (title: string, content = '', over: Partial<Item> = {}): Item => ({
  id: `s${++n}`, type: 'note', title, content, folder: '', tags: [], status: 'organized', createdAt: n, updatedAt: n, ...over,
})

describe('search', () => {
  const items = [
    mk('Graph theory basics', 'nodes and edges'),
    mk('Cooking', 'a graph of flavours', { tags: ['food'] }),
    mk('Old', 'graph', { deleted: true }),
    mk('Vault tips', 'something else'),
  ]
  it('ranks title matches above body matches and skips deleted', () => {
    const r = search(items, 'graph')
    expect(r.map((h) => h.item.title)).toEqual(['Graph theory basics', 'Cooking'])
  })
  it('requires all terms but matches tags', () => {
    expect(search(items, 'graph food').map((h) => h.item.title)).toEqual(['Cooking'])
  })
  it('falls back to fuzzy title match', () => {
    expect(search(items, 'vts').map((h) => h.item.title)).toEqual(['Vault tips'])
    expect(fuzzy('vault tips', 'vts')).toBe(true)
  })
  it('returns nothing for empty query', () => {
    expect(search(items, '  ')).toEqual([])
  })
})

describe('prompts', () => {
  it('lists unique variables and fills them', () => {
    const t = 'Translate {{text}} to {{ language }}. Again {{text}}.'
    expect(promptVariables(t)).toEqual(['text', 'language'])
    expect(fillPrompt(t, { text: 'hi', language: 'PT' })).toBe('Translate hi to PT. Again hi.')
    expect(fillPrompt(t, { text: 'hi' })).toContain('{{ language }}')
  })
  it('strips frontmatter', () => {
    expect(promptBody('---\ntype: prompt\n---\nDo it')).toBe('Do it')
  })
})
