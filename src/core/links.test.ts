import { describe, expect, it } from 'vitest'
import { buildGraph, buildLinkIndex, renameWikiLinks, slugify } from './links'
import type { Item } from './types'

let n = 0
function mk(title: string, content = '', over: Partial<Item> = {}): Item {
  n++
  return {
    id: `id${n}`,
    type: 'note',
    title,
    content,
    folder: '',
    tags: [],
    status: 'organized',
    createdAt: n,
    updatedAt: n,
    ...over,
  }
}

describe('link index', () => {
  it('resolves by title case-insensitively and by slug', () => {
    const a = mk('Project Alpha')
    const b = mk('Notes', 'see [[project alpha]] and [[Project-Alpha]]')
    const idx = buildLinkIndex([a, b])
    expect(idx.outgoing.get(b.id)).toEqual([a.id])
    expect(idx.backlinks.get(a.id)).toEqual([b.id])
  })

  it('collects unresolved targets and ignores self links', () => {
    const a = mk('A', '[[A]] [[Missing]]')
    const idx = buildLinkIndex([a])
    expect(idx.outgoing.get(a.id)).toEqual([])
    expect(idx.unresolved.get(a.id)).toEqual(['Missing'])
  })

  it('ignores deleted items', () => {
    const a = mk('A')
    const b = mk('B', '[[A]]')
    a.deleted = true
    const idx = buildLinkIndex([a, b])
    expect(idx.unresolved.get(b.id)).toEqual(['A'])
  })
})

describe('buildGraph', () => {
  const a = mk('A', '[[B]] [[Ghosty]]', { tags: ['x'], folder: 'F' })
  const b = mk('B', '', { tags: ['x'] })
  const c = mk('C', '', { tags: [] })

  it('creates link, ghost and tag edges with degrees', () => {
    const g = buildGraph([a, b, c], { showTags: true, showFolders: false, showGhosts: true, hideOrphans: false })
    const kinds = g.edges.map((e) => e.kind).sort()
    expect(kinds).toEqual(['link', 'link', 'tag', 'tag'])
    expect(g.nodes.find((x) => x.id === a.id)!.degree).toBe(3)
    expect(g.nodes.find((x) => x.kind === 'ghost')!.label).toBe('Ghosty')
    expect(g.nodes.find((x) => x.id === c.id)!.degree).toBe(0)
  })

  it('hides orphans, ghosts and tags on request', () => {
    const g = buildGraph([a, b, c], { showTags: false, showFolders: false, showGhosts: false, hideOrphans: true })
    expect(g.nodes.map((x) => x.label).sort()).toEqual(['A', 'B'])
  })

  it('adds folder nodes', () => {
    const g = buildGraph([a], { showTags: false, showFolders: true, showGhosts: false, hideOrphans: false })
    expect(g.nodes.some((x) => x.kind === 'folder' && x.label === 'F')).toBe(true)
  })

  it('filter keeps matches and neighbours', () => {
    const g = buildGraph([a, b, c], { showTags: false, showFolders: false, showGhosts: false, hideOrphans: false, filter: 'A' })
    expect(g.nodes.map((x) => x.label).sort()).toEqual(['A', 'B'])
  })
})

describe('renameWikiLinks', () => {
  it('rewrites links keeping heading and alias', () => {
    expect(renameWikiLinks('[[Old]] [[old#H]] [[Old|x]] [[Other]]', 'Old', 'New')).toBe('[[New]] [[New#H]] [[New|x]] [[Other]]')
  })
})

describe('slugify', () => {
  it('normalizes accents and punctuation', () => {
    expect(slugify('  Olá, Mundo! ')).toBe('ola-mundo')
  })
})
