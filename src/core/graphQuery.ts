/** Questions the graph page asks about the graph: who is connected, what matches a search, what a note says. */
import type { GraphData, GraphNode } from './types'

/** The star and everything within `hops` connections of it, with the connections between them. */
export function neighbourhood(data: GraphData, id: string, hops: number): GraphData {
  if (!data.nodes.some((n) => n.id === id)) return data
  const adj = adjacency(data)
  const keep = new Set([id])
  let frontier = [id]
  for (let h = 0; h < hops; h++) {
    const next: string[] = []
    for (const f of frontier) for (const n of adj.get(f) ?? []) if (!keep.has(n)) { keep.add(n); next.push(n) }
    frontier = next
  }
  return {
    nodes: data.nodes.filter((n) => keep.has(n.id)),
    edges: data.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  }
}

/** Stars directly connected to this one, best connected first. */
export function connectionsOf(data: GraphData, id: string): GraphNode[] {
  const ids = adjacency(data).get(id) ?? new Set<string>()
  return data.nodes.filter((n) => ids.has(n.id)).sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label))
}

function adjacency(data: GraphData): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  const add = (a: string, b: string) => (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b)
  for (const e of data.edges) {
    add(e.source, e.target)
    add(e.target, e.source)
  }
  return adj
}

/**
 * Stars matching a search: titles that start with it first, then titles containing it, then matches in the
 * extra text (tags, folder). Best connected first within each group.
 */
export function searchGraph(nodes: GraphNode[], query: string, extra?: Map<string, string>): GraphNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const scored: { n: GraphNode; score: number }[] = []
  for (const n of nodes) {
    const label = n.label.toLowerCase()
    const score = label.startsWith(q) ? 3 : label.includes(q) ? 2 : extra?.get(n.id)?.toLowerCase().includes(q) ? 1 : 0
    if (score) scored.push({ n, score })
  }
  return scored.sort((a, b) => b.score - a.score || b.n.degree - a.n.degree).map((s) => s.n)
}

/** A note's first words as plain text: no headings, markup or link brackets. */
export function previewText(markdown: string, max = 160): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[![\w-]+\][+-]?/g, ' ')
    .replace(/^(\s*[-*+]\s+)\[[ xX]\]\s+/gm, '$1')
    .split('\n')
    .filter((l) => !/^\s*#{1,6}\s/.test(l))
    .join(' ')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>~]+/g, '')
    .replace(/(^|\s)[-+]\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= max) return plain
  const cut = plain.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ') > max * 0.5 ? cut.lastIndexOf(' ') : max) + '…'
}
