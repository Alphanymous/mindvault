/** Read-only statistics for the Clusters & Tags page: regions, tag usage, orphans and the most linked items. */
import { UNFILED } from './clusters'
import type { LinkIndex } from './links'
import type { Item } from './types'

export interface RegionStat {
  name: string
  count: number
  /** Share (0..1) of the region's items that link or are linked. */
  linkedShare: number
  /** Item in the region with the most backlinks, if any has one. */
  top?: Item
}

const regionName = (i: Item) => i.folder.split('/')[0].trim() || UNFILED
const backlinkCount = (links: LinkIndex, id: string) => links.backlinks.get(id)?.length ?? 0
const isLinked = (links: LinkIndex, id: string) => backlinkCount(links, id) > 0 || (links.outgoing.get(id)?.length ?? 0) > 0

/** Regions (top-level folders), largest first; Unfiled always last. */
export function regionStats(items: Item[], links: LinkIndex): RegionStat[] {
  const groups = new Map<string, Item[]>()
  for (const i of items) {
    const name = regionName(i)
    groups.set(name, [...(groups.get(name) ?? []), i])
  }
  return [...groups.entries()]
    .map(([name, members]) => {
      const ranked = [...members].sort((a, b) => backlinkCount(links, b.id) - backlinkCount(links, a.id))
      const top = ranked[0] && backlinkCount(links, ranked[0].id) > 0 ? ranked[0] : undefined
      return { name, count: members.length, linkedShare: members.filter((m) => isLinked(links, m.id)).length / members.length, top }
    })
    .sort((a, b) => Number(a.name === UNFILED) - Number(b.name === UNFILED) || b.count - a.count || a.name.localeCompare(b.name))
}

export interface TagStat {
  tag: string
  count: number
  /** Wikilinks written in items carrying this tag. */
  links: number
}

export function tagStats(items: Item[], links: LinkIndex): TagStat[] {
  const byTag = new Map<string, Item[]>()
  for (const i of items) for (const t of i.tags) byTag.set(t, [...(byTag.get(t) ?? []), i])
  return [...byTag.entries()]
    .map(([tag, members]) => ({
      tag,
      count: members.length,
      links: members.reduce((sum, m) => sum + (links.outgoing.get(m.id)?.length ?? 0), 0),
    }))
    .sort((a, b) => b.count - a.count || b.links - a.links || a.tag.localeCompare(b.tag))
}

/** Tags used by exactly one item. */
export function orphanTags(items: Item[]): string[] {
  const counts = new Map<string, number>()
  for (const i of items) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()].filter(([, c]) => c === 1).map(([t]) => t).sort()
}

export interface TagPair {
  a: string
  b: string
  together: number
}

/** The two tags that share the most items. */
export function strongestTagPair(items: Item[]): TagPair | null {
  const pairs = new Map<string, number>()
  for (const i of items) {
    const tags = [...new Set(i.tags)].sort()
    for (let x = 0; x < tags.length; x++) {
      for (let y = x + 1; y < tags.length; y++) {
        const key = `${tags[x]}\u0000${tags[y]}`
        pairs.set(key, (pairs.get(key) ?? 0) + 1)
      }
    }
  }
  let best: TagPair | null = null
  for (const [key, together] of pairs) {
    if (!best || together > best.together) {
      const [a, b] = key.split('\u0000')
      best = { a, b, together }
    }
  }
  return best
}

export interface Ranked {
  item: Item
  backlinks: number
}

/** Items with the most backlinks. */
export function leaderboard(items: Item[], links: LinkIndex, limit: number): Ranked[] {
  return items
    .map((item) => ({ item, backlinks: backlinkCount(links, item.id) }))
    .filter((r) => r.backlinks > 0)
    .sort((a, b) => b.backlinks - a.backlinks || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
}
