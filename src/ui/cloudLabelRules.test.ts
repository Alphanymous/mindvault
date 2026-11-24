import { describe, expect, it } from 'vitest'
import type { CloudNode } from '../core/cloudLayout'
import { COMPACT_OTHERS, NEIGHBOURS, ZOOMED, labelRequests, type LabelScene } from './cloudLabelRules'

/** n nodes on a grid inside an 1000x800 canvas; the last `hubs` are folder hubs; degree falls with the index. */
function scene(n: number, o: Partial<LabelScene> = {}, hubs = 0): LabelScene {
  const nodes: CloudNode[] = Array.from({ length: n }, (_, i) => {
    const hub = i >= n - hubs
    return {
      id: `n${i}`,
      node: { id: `n${i}`, label: `Note ${i}`, kind: hub ? 'folder' : 'item', itemType: hub ? undefined : 'note', degree: n - i + 2 },
      region: 'R', x: 0, y: 0, vx: 0, vy: 0, charge: 1, mass: 1, degree: n - i + 2, pinned: false,
    }
  })
  const sx = nodes.map((_, i) => 20 + (i % 30) * 32), sy = nodes.map((_, i) => 20 + Math.floor(i / 30) * 24)
  const ranked = nodes.map((_, i) => i).sort((a, b) => nodes[b].degree - nodes[a].degree)
  const neighbours = nodes.map(() => [] as number[])
  return {
    nodes, sx, sy, radius: () => 2, w: 1000, h: 800, focus: -1, selected: -1, neighbours, ranked, highlight: null, zoom: 1, compact: false,
    regions: [{ name: 'Research', x: 500, y: 400 }], obstacles: [], ...o,
  }
}
/** Node 0 linked to nodes 1..k (busiest first). */
function withNeighbours(s: LabelScene, k: number): LabelScene {
  s.neighbours[0] = Array.from({ length: k }, (_, j) => j + 1)
  for (let j = 1; j <= k; j++) s.neighbours[j] = [0]
  return s
}
const measure = (t: string, size: number) => t.length * size * 0.6
const notes = (s: LabelScene) => labelRequests(s, measure).filter((r) => r.kind !== 'region')

describe('label budgets', () => {
  it('default: region names and the 5 busiest notes', () => {
    const reqs = labelRequests(scene(100), measure)
    expect(reqs.filter((r) => r.kind === 'region').map((r) => r.text)).toEqual(['RESEARCH'])
    expect(reqs.filter((r) => r.kind !== 'region').map((r) => r.id)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4'])
  })

  it('focus: the focused note and up to 14 neighbours', () => {
    const s = withNeighbours(scene(100, { focus: 0 }), 30)
    const ids = notes(s).map((r) => r.id)
    expect(ids).toHaveLength(1 + NEIGHBOURS)
    expect(ids[0]).toBe('n0')
  })

  it('compact: no region names, at most 6 labels besides the selected note, even while hovering', () => {
    const hover = withNeighbours(scene(100, { compact: true, focus: 0 }), 10)
    expect(labelRequests(hover, measure).some((r) => r.kind === 'region')).toBe(false)
    expect(notes(hover).length).toBeLessThanOrEqual(COMPACT_OTHERS)
    // a selected note plus a different hovered one: the selected label is extra, the rest stay within 6
    const both = withNeighbours(scene(100, { compact: true, focus: 0, selected: 50 }), 10)
    const ids = notes(both).map((r) => r.id)
    expect(ids).toContain('n50')
    expect(ids.filter((id) => id !== 'n50').length).toBeLessThanOrEqual(COMPACT_OTHERS)
    // and without hovering: the 6 busiest
    expect(notes(scene(100, { compact: true }))).toHaveLength(COMPACT_OTHERS)
  })

  it('zoomed in: at most 60 labels in all, hubs included', () => {
    const s = scene(300, { zoom: 3 }, 30)
    expect(notes(s).length).toBeLessThanOrEqual(ZOOMED)
    expect(notes(s).length).toBe(ZOOMED)
    const focused = withNeighbours(scene(300, { zoom: 3, focus: 0 }, 30), 40)
    expect(notes(focused).length).toBeLessThanOrEqual(ZOOMED)
    expect(notes(focused)[0].id).toBe('n0')
  })

  it('always labels the selected note, on the clear side of a panel', () => {
    const s = scene(10, { selected: 9 })
    ;(s.sx as number[])[9] = 900
    s.obstacles = [{ x: 905, y: 0, w: 95, h: 800 }]
    const sel = notes(s).find((r) => r.id === 'n9')!
    expect(sel.priority).toBe(1000)
    expect(sel.x).toBeLessThan(900) // asks for the left of its dot
  })

  it('while searching, the busiest labels go to matches', () => {
    const ids = notes(scene(100, { highlight: new Set([40, 41, 42]) })).map((r) => r.id)
    expect(ids).toEqual(['n40', 'n41', 'n42'])
  })
})
