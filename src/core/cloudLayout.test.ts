import { describe, expect, it } from 'vitest'
import { createCloudLayout, regionAnchor, type CloudLayout, type CloudNode } from './cloudLayout'
import { regionOf } from './clusters'
import { hash01 } from './hash'
import type { GraphData, GraphEdge, GraphNode } from './types'

const FOLDERS = ['Research', 'Projects', 'Reading', 'Journal/2026', 'Recipes', 'Work/Clients', 'Ideas']

const F5 = ['Research', 'Projects', 'Reading', 'Recipes', '']

/**
 * n notes spread round-robin over the given folders ('' = unfiled), plus `links` pseudo-random [[links]];
 * a `local` share of them stays inside the source note's folder, as in a real vault.
 */
function graph(n: number, folders: string[], links: number, seed = 1, local = 0): GraphData {
  const nodes: GraphNode[] = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`, label: `Note ${i}`, kind: 'item', itemType: 'note', degree: 0, folder: folders[i % folders.length],
  }))
  let s = seed
  const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  const edges: GraphEdge[] = []
  while (edges.length < links) {
    const a = Math.floor(rand() * n)
    let b = Math.floor(rand() * n)
    if (rand() < local) b = b - (b % folders.length) + (a % folders.length)
    if (b < n && a !== b) edges.push({ source: `n${a}`, target: `n${b}`, kind: 'link' })
  }
  return { nodes, edges }
}

/** Unlinked notes plus `tags` tag hubs, each on `per` notes picked across all regions. */
function tagged(n: number, folders: string[], tags: number, per: number): GraphData {
  const g = graph(n, folders, 0)
  for (let t = 0; t < tags; t++) {
    g.nodes.push({ id: `tag:t${t}`, label: `#t${t}`, kind: 'tag', degree: 0 })
    for (let k = 0; k < per; k++) g.edges.push({ source: `n${Math.floor(hash01(`e${t}_${k}`, 5) * n)}`, target: `tag:t${t}`, kind: 'tag' })
  }
  return g
}

/** Add a folder hub per folder with an edge from each of its notes, as the graph page shows by default. */
function withFolderHubs(g: GraphData): GraphData {
  for (const folder of new Set(g.nodes.map((n) => n.folder).filter((f): f is string => !!f))) {
    g.nodes.push({ id: `folder:${folder}`, label: folder, kind: 'folder', degree: 0 })
    for (const n of g.nodes) if (n.kind === 'item' && n.folder === folder) g.edges.push({ source: n.id, target: `folder:${folder}`, kind: 'folder' })
  }
  return g
}

/** Throw every node somewhere in a disc, so regions start fully mixed. */
function scramble(l: CloudLayout): CloudLayout {
  for (const n of l.nodes) {
    const a = hash01(n.id, 77) * Math.PI * 2, r = 300 * Math.sqrt(hash01(n.id, 78))
    n.x = Math.cos(a) * r; n.y = Math.sin(a) * r
  }
  return l
}

/** Mean distance to a node's own region centre over mean distance to the other region centres (lower = tighter lobes). */
function lobeRatio(l: CloudLayout): number {
  const centres = new Map<string, { x: number; y: number; k: number }>()
  const inRegion = l.nodes.filter((n) => n.region)
  for (const n of inRegion) {
    const c = centres.get(n.region!) ?? { x: 0, y: 0, k: 0 }
    c.x += n.x; c.y += n.y; c.k++
    centres.set(n.region!, c)
  }
  for (const c of centres.values()) { c.x /= c.k; c.y /= c.k }
  let own = 0, other = 0, otherCount = 0
  for (const n of inRegion) {
    for (const [name, c] of centres) {
      const d = Math.hypot(n.x - c.x, n.y - c.y)
      if (name === n.region) own += d
      else { other += d; otherCount++ }
    }
  }
  return own / inRegion.length / (other / otherCount)
}

function settle(l: CloudLayout, max = 2000): CloudLayout {
  for (let i = 0; i < max && l.tick(); i++);
  return l
}

/** 5th–95th percentile spread on x and y. */
function extent(nodes: CloudNode[]): { w: number; h: number } {
  const span = (v: number[]) => {
    v.sort((a, b) => a - b)
    return v[Math.floor(v.length * 0.95)] - v[Math.floor(v.length * 0.05)]
  }
  return { w: span(nodes.map((n) => n.x)), h: span(nodes.map((n) => n.y)) }
}

function expectRound(l: CloudLayout) {
  const { w, h } = extent(l.nodes)
  expect(w / h).toBeGreaterThan(0.75)
  expect(w / h).toBeLessThan(1.33)
}

const finite = (l: CloudLayout) => l.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.vx) && Number.isFinite(n.vy))

describe('cloud layout', () => {
  it('settles into a round cloud', () => {
    const l = settle(createCloudLayout(graph(200, FOLDERS.slice(0, 5), 150)))
    expect(l.settled).toBe(true)
    expectRound(l)
  })

  it('stays round with only three regions, whose anchors may line up', () => {
    for (const names of [['Work', 'Travel', 'Music'], ['Reading', 'Ideas', 'Archive']]) {
      expectRound(settle(createCloudLayout(graph(150, names, 100, 7, 0.7))))
    }
  })

  it('never produces NaN or infinite positions, even for 0, 1 and 2 nodes', () => {
    for (const n of [0, 1, 2]) {
      const l = settle(createCloudLayout(graph(n, [''], n === 2 ? 1 : 0)))
      expect(l.nodes).toHaveLength(n)
      expect(l.settled).toBe(true)
      expect(finite(l)).toBe(true)
    }
    // Two notes on exactly the same spot (same id hash cannot happen, so force it) still separate cleanly.
    const l = createCloudLayout(graph(2, ['A'], 0))
    l.nodes[1].x = l.nodes[0].x; l.nodes[1].y = l.nodes[0].y
    settle(l)
    expect(finite(l)).toBe(true)
    expect(Math.hypot(l.nodes[0].x - l.nodes[1].x, l.nodes[0].y - l.nodes[1].y)).toBeGreaterThan(1)
  })

  it('is deterministic for the same data', () => {
    const a = settle(createCloudLayout(graph(150, FOLDERS, 120)))
    const b = settle(createCloudLayout(graph(150, FOLDERS, 120)))
    a.nodes.forEach((n, i) => {
      expect(Math.abs(n.x - b.nodes[i].x)).toBeLessThan(1e-6)
      expect(Math.abs(n.y - b.nodes[i].y)).toBeLessThan(1e-6)
    })
  })

  it('keeps each region together as a lobe without any links', () => {
    const g = graph(120, F5, 0)
    const seeded = settle(createCloudLayout(g))
    expect(new Set(seeded.nodes.map((n) => n.region)).size).toBe(5)
    expect(lobeRatio(seeded)).toBeLessThan(0.5)
    expectRound(seeded)
    // Even from a fully mixed start the regions sort themselves back into lobes.
    const mixed = settle(scramble(createCloudLayout(g)))
    expect(lobeRatio(mixed)).toBeLessThan(0.5)
    expectRound(mixed)
  })

  it('packs the lobes into one filled cloud: no hollow middle, no lobe floating apart', () => {
    for (const g of [graph(300, F5, 260, 3, 0.8), graph(120, F5, 0), withFolderHubs(graph(200, F5, 160, 5, 0.8))]) {
      const l = settle(createCloudLayout(g))
      const items = l.nodes.filter((n) => n.node.kind === 'item')
      const mx = items.reduce((s, n) => s + n.x, 0) / items.length, my = items.reduce((s, n) => s + n.y, 0) / items.length
      const r = items.map((n) => Math.hypot(n.x - mx, n.y - my)).sort((a, b) => a - b)
      // A uniform disc has a quarter of its notes inside half its radius; a ring of separate lobes has few.
      expect(r.filter((d) => d < r[Math.floor(r.length * 0.95)] / 2).length / r.length).toBeGreaterThan(0.15)
      // Every lobe touches another: its closest foreign note is about as near as notes are to each other.
      const nearest = (n: CloudNode, ok: (m: CloudNode) => boolean) => Math.min(...items.filter((m) => m !== n && ok(m)).map((m) => Math.hypot(m.x - n.x, m.y - n.y)))
      const spacing = items.map((n) => nearest(n, () => true)).sort((a, b) => a - b)[Math.floor(items.length / 2)]
      for (const region of new Set(items.map((n) => n.region))) {
        const gap = Math.min(...items.filter((n) => n.region === region).map((n) => nearest(n, (m) => m.region !== region)))
        expect(gap).toBeLessThan(spacing * 2)
      }
    }
  })

  it('keeps regions as lobes when tags connect notes across regions', () => {
    const l = settle(createCloudLayout(tagged(120, F5, 5, 20)))
    expect(lobeRatio(l)).toBeLessThan(0.5)
    expectRound(l)
  })

  it('keeps existing positions when a node is added (warm start)', () => {
    const g = graph(100, FOLDERS.slice(0, 4), 80)
    const prev = settle(createCloudLayout(g))
    const g2: GraphData = {
      nodes: [...g.nodes, { id: 'new', label: 'New', kind: 'item', itemType: 'note', degree: 1, folder: 'Research' }],
      edges: [...g.edges, { source: 'new', target: 'n0', kind: 'link' }],
    }
    const next = createCloudLayout(g2, prev)
    for (const old of prev.nodes) {
      const n = next.nodes[next.index.get(old.id)!]
      expect(Math.hypot(n.x - old.x, n.y - old.y)).toBeLessThan(5)
    }
    // The new note starts beside the note it links to, not somewhere across the cloud.
    const fresh = next.nodes[next.index.get('new')!], n0 = next.nodes[next.index.get('n0')!]
    expect(Math.hypot(fresh.x - n0.x, fresh.y - n0.y)).toBeLessThanOrEqual(40)
    // A gentle restart: after settling again the old cloud has barely moved (median under 3% of its width).
    settle(next)
    const moved = prev.nodes.map((old) => {
      const n = next.nodes[next.index.get(old.id)!]
      return Math.hypot(n.x - old.x, n.y - old.y)
    }).sort((a, b) => a - b)
    expect(moved[Math.floor(moved.length / 2)]).toBeLessThan(extent(prev.nodes).w * 0.03)
  })

  it('starts cold when prev has none of the nodes (e.g. built while the vault was loading)', () => {
    const g = graph(200, FOLDERS.slice(0, 5), 150)
    const cold = settle(createCloudLayout(g))
    const other = { nodes: graph(20, ['Research'], 0).nodes.map((n) => ({ ...n, id: `old-${n.id}` })), edges: [] }
    for (const prev of [createCloudLayout({ nodes: [], edges: [] }), settle(createCloudLayout(other))]) {
      const l = settle(createCloudLayout(g, prev))
      expectRound(l)
      l.nodes.forEach((n, i) => {
        expect(Math.abs(n.x - cold.nodes[i].x)).toBeLessThan(1e-6)
        expect(Math.abs(n.y - cold.nodes[i].y)).toBeLessThan(1e-6)
      })
    }
  })

  it('restarts a note in its new region when it moves folder (warm start)', () => {
    const g = graph(100, ['Research', 'Projects', 'Reading', 'Recipes'], 0)
    const prev = settle(createCloudLayout(g))
    const moved: GraphData = { nodes: g.nodes.map((n) => (n.id === 'n0' ? { ...n, folder: 'Projects' } : n)), edges: [] }
    const next = createCloudLayout(moved, prev)
    const centres = prev.regionCentres(), n0 = next.nodes[next.index.get('n0')!]
    const d = (name: string) => Math.hypot(n0.x - centres.get(name)!.x, n0.y - centres.get(name)!.y)
    expect(n0.region).toBe('Projects')
    expect(d('Projects')).toBeLessThan(d('Research'))
  })

  it('pulls a lone note toward its region anchor rather than the dead centre', () => {
    const l = settle(createCloudLayout(graph(1, ['Research'], 0)))
    const a = regionAnchor('Research', 1), n = l.nodes[0]
    // Gravity alone sinks it to about a sixth of the way out; the anchor holds it nearer a third.
    expect((n.x * a.x + n.y * a.y) / (a.x * a.x + a.y * a.y)).toBeGreaterThan(0.25)
  })

  it('places a region on the same anchor whatever other regions exist', () => {
    expect(regionAnchor('Research', 5)).toEqual(regionAnchor('Research', 5))
    const a5 = regionAnchor('Research', 5), a6 = regionAnchor('Research', 6)
    expect(Math.atan2(a6.y, a6.x)).toBeCloseTo(Math.atan2(a5.y, a5.x), 12)
  })

  it('gives hubs more charge and mass than notes, and counts degree from edges', () => {
    const g: GraphData = {
      nodes: [
        { id: 'a', label: 'A', kind: 'item', itemType: 'note', degree: 2, folder: 'Dev' },
        { id: 'folder:Dev', label: 'Dev', kind: 'folder', degree: 1 },
        { id: 'tag:x', label: '#x', kind: 'tag', degree: 1 },
      ],
      edges: [{ source: 'a', target: 'folder:Dev', kind: 'folder' }, { source: 'a', target: 'tag:x', kind: 'tag' }, { source: 'a', target: 'gone', kind: 'link' }],
    }
    const l = createCloudLayout(g)
    const by = (id: string) => l.nodes[l.index.get(id)!]
    expect([by('a').charge, by('a').mass]).toEqual([1, 1])
    expect([by('folder:Dev').charge, by('folder:Dev').mass]).toEqual([4, 3])
    expect([by('tag:x').charge, by('tag:x').mass]).toEqual([2.5, 2])
    expect(by('a').degree).toBe(2) // the edge to a missing node is dropped
    expect(l.edges).toHaveLength(2)
    expect(by('folder:Dev').region).toBe(regionOf(g.nodes[1]))
    expect(by('tag:x').region).toBeNull()
  })

  it('reports each region centre at the middle of its notes', () => {
    const l = settle(createCloudLayout(graph(60, ['Research', 'Projects', ''], 20)))
    const centres = l.regionCentres()
    expect([...centres.keys()].sort()).toEqual(['Projects', 'Research', 'Unfiled'])
    const members = l.nodes.filter((n) => n.region === 'Research')
    const c = centres.get('Research')!
    expect(c.x).toBeCloseTo(members.reduce((s, n) => s + n.x, 0) / members.length, 6)
    expect(c.y).toBeCloseTo(members.reduce((s, n) => s + n.y, 0) / members.length, 6)
    expect(c.radius).toBeGreaterThan(0)
    expect(members.filter((n) => Math.hypot(n.x - c.x, n.y - c.y) <= c.radius).length / members.length).toBeGreaterThan(0.8)
  })

  it('wakes up again on reheat', () => {
    const l = settle(createCloudLayout(graph(30, ['A', 'B'], 10)))
    expect(l.tick()).toBe(false)
    l.reheat(0.3)
    expect(l.settled).toBe(false)
    expect(l.tick()).toBe(true)
  })
})
