import type { GraphData, GraphEdge, GraphNode, Item } from './types'
import { parseWikiLinks } from './markdown'

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

export interface LinkIndex {
  /** Resolve a wikilink target to an item id, or null when unresolved. */
  resolve(target: string): string | null
  /** Outgoing resolved links per item id (deduplicated). */
  outgoing: Map<string, string[]>
  /** Incoming links per item id (deduplicated). */
  backlinks: Map<string, string[]>
  /** Unresolved targets per item id. */
  unresolved: Map<string, string[]>
}

/** Build the title/slug lookup and link maps for a set of live items. */
export function buildLinkIndex(items: Item[]): LinkIndex {
  const live = items.filter((i) => !i.deleted)
  const byKey = new Map<string, string>()
  for (const it of live) {
    // First item wins for duplicate titles; newest-created last so earliest keeps the name.
    const keys = [it.title.toLowerCase(), slugify(it.title), it.id.toLowerCase()]
    if (it.fileName) keys.push(it.fileName.toLowerCase().replace(/\.md$/, ''))
    for (const k of keys) if (k && !byKey.has(k)) byKey.set(k, it.id)
  }
  const resolve = (target: string): string | null =>
    byKey.get(target.trim().toLowerCase()) ?? byKey.get(slugify(target)) ?? null

  const outgoing = new Map<string, string[]>()
  const backlinks = new Map<string, string[]>()
  const unresolved = new Map<string, string[]>()

  for (const it of live) {
    const out = new Set<string>()
    const miss = new Set<string>()
    for (const link of parseWikiLinks(it.content)) {
      const id = resolve(link.target)
      if (id && id !== it.id) out.add(id)
      else if (!id) miss.add(link.target)
    }
    outgoing.set(it.id, [...out])
    unresolved.set(it.id, [...miss])
    for (const to of out) {
      const list = backlinks.get(to) ?? []
      list.push(it.id)
      backlinks.set(to, list)
    }
  }
  return { resolve, outgoing, backlinks, unresolved }
}

export interface GraphOptions {
  showTags: boolean
  showFolders: boolean
  showGhosts: boolean
  /** Hide nodes with no connections. */
  hideOrphans: boolean
  /** Only items whose title/tags/folder include this text (plus their neighbours). */
  filter?: string
  types?: Set<Item['type']>
}

export const DEFAULT_GRAPH_OPTIONS: GraphOptions = {
  showTags: true,
  showFolders: false,
  showGhosts: true,
  hideOrphans: false,
}

export function buildGraph(items: Item[], opts: GraphOptions = DEFAULT_GRAPH_OPTIONS): GraphData {
  const live = items.filter((i) => !i.deleted && (!opts.types || opts.types.has(i.type)))
  const index = buildLinkIndex(items)
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  const seen = new Set<string>()

  const addEdge = (source: string, target: string, kind: GraphEdge['kind']) => {
    const key = `${kind}:${source}>${target}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ source, target, kind })
  }

  for (const it of live) {
    nodes.set(it.id, { id: it.id, label: it.title, kind: 'item', itemType: it.type, degree: 0, folder: it.folder })
  }

  for (const it of live) {
    for (const to of index.outgoing.get(it.id) ?? []) {
      if (nodes.has(to)) addEdge(it.id, to, 'link')
    }
    if (opts.showGhosts) {
      for (const miss of index.unresolved.get(it.id) ?? []) {
        const gid = `ghost:${slugify(miss)}`
        if (!nodes.has(gid)) nodes.set(gid, { id: gid, label: miss, kind: 'ghost', degree: 0 })
        addEdge(it.id, gid, 'link')
      }
    }
    if (opts.showTags) {
      for (const tag of it.tags) {
        const tid = `tag:${tag}`
        if (!nodes.has(tid)) nodes.set(tid, { id: tid, label: `#${tag}`, kind: 'tag', degree: 0 })
        addEdge(it.id, tid, 'tag')
      }
    }
    if (opts.showFolders && it.folder) {
      const fid = `folder:${it.folder}`
      if (!nodes.has(fid)) nodes.set(fid, { id: fid, label: it.folder, kind: 'folder', degree: 0 })
      addEdge(it.id, fid, 'folder')
    }
  }

  for (const e of edges) {
    nodes.get(e.source)!.degree++
    nodes.get(e.target)!.degree++
  }

  let result: GraphData = { nodes: [...nodes.values()], edges }

  if (opts.filter && opts.filter.trim()) {
    result = applyGraphFilter(result, live, opts.filter)
  }
  if (opts.hideOrphans) {
    result = {
      nodes: result.nodes.filter((n) => n.degree > 0),
      edges: result.edges,
    }
  }
  return result
}

/** Keep nodes matching the filter text and their direct neighbours. */
export function applyGraphFilter(graph: GraphData, items: Item[], filter: string): GraphData {
  const q = filter.trim().toLowerCase()
  const byId = new Map(items.map((i) => [i.id, i]))
  const matches = new Set<string>()
  for (const n of graph.nodes) {
    const it = byId.get(n.id)
    const hay = it ? `${it.title} ${it.tags.join(' ')} ${it.folder}` : n.label
    if (hay.toLowerCase().includes(q)) matches.add(n.id)
  }
  const keep = new Set(matches)
  for (const e of graph.edges) {
    if (matches.has(e.source)) keep.add(e.target)
    if (matches.has(e.target)) keep.add(e.source)
  }
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
  const nodes = graph.nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n, degree: 0 }))
  const map = new Map(nodes.map((n) => [n.id, n]))
  for (const e of edges) {
    map.get(e.source)!.degree++
    map.get(e.target)!.degree++
  }
  return { nodes, edges }
}

/** Rewrite [[old]] links to [[new]] after an item is renamed. */
export function renameWikiLinks(content: string, oldTitle: string, newTitle: string): string {
  const esc = oldTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return content.replace(new RegExp(`\\[\\[\\s*${esc}\\s*((?:[#|][^\\]]*)?)\\]\\]`, 'gi'), `[[${newTitle}$1]]`)
}

/** Node plus its direct neighbours (the "local graph" shown next to a note). */
export function neighborhood(graph: GraphData, id: string): GraphData {
  const keep = new Set([id])
  for (const e of graph.edges) {
    if (e.source === id) keep.add(e.target)
    if (e.target === id) keep.add(e.source)
  }
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target))
  const nodes = graph.nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n, degree: 0 }))
  const map = new Map(nodes.map((n) => [n.id, n]))
  for (const e of edges) {
    map.get(e.source)!.degree++
    map.get(e.target)!.degree++
  }
  return { nodes, edges }
}
