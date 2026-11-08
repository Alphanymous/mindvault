import { describe, expect, it } from 'vitest'
import { buildLinkIndex } from './links'
import type { Item } from './types'
import { leaderboard, orphanTags, regionStats, strongestTagPair, tagStats } from './vaultStats'

let n = 0
const item = (title: string, folder: string, tags: string[], content = ''): Item =>
  ({
    id: `i${++n}`, title, folder, tags, content, type: 'note', status: 'organized', createdAt: 0, updatedAt: 0,
  }) as unknown as Item

const items = [
  item('Hub', 'Mind/Core', ['science', 'systems'], 'Links to [[Leaf]] and [[Side]]'),
  item('Leaf', 'Mind', ['science', 'systems'], 'Back to [[Hub]]'),
  item('Side', 'Life', ['science'], 'Back to [[Hub]]'),
  item('Lonely', '', ['rare']),
]
const links = buildLinkIndex(items)

describe('regionStats', () => {
  it('groups by top-level folder with counts, linked share and the most linked note', () => {
    const r = regionStats(items, links)
    expect(r.map((x) => x.name)).toEqual(['Mind', 'Life', 'Unfiled'])
    const mind = r[0]
    expect(mind.count).toBe(2)
    expect(mind.linkedShare).toBe(1)
    expect(mind.top?.title).toBe('Hub')
    expect(r[2].linkedShare).toBe(0)
    expect(r[2].top).toBeUndefined()
  })
})

describe('tagStats', () => {
  it('ranks tags by how many items use them and counts links between those items', () => {
    const t = tagStats(items, links)
    expect(t[0]).toMatchObject({ tag: 'science', count: 3 })
    expect(t[0].links).toBe(4)
    expect(t.find((x) => x.tag === 'rare')).toMatchObject({ count: 1, links: 0 })
  })
})

describe('orphanTags', () => {
  it('lists tags used by a single item', () => {
    expect(orphanTags(items)).toEqual(['rare'])
  })
})

describe('strongestTagPair', () => {
  it('finds the two tags that appear together most often', () => {
    expect(strongestTagPair(items)).toEqual({ a: 'science', b: 'systems', together: 2 })
  })

  it('returns null without any pair', () => {
    expect(strongestTagPair([item('x', '', ['one'])])).toBeNull()
  })
})

describe('leaderboard', () => {
  it('orders items by backlinks and skips items nobody links to', () => {
    const top = leaderboard(items, links, 5)
    expect(top.map((x) => [x.item.title, x.backlinks])).toEqual([['Hub', 2], ['Leaf', 1], ['Side', 1]])
  })
})
