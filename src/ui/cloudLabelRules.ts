/**
 * Which labels the graph cloud asks for, and how important each is; placeLabels() then drops whatever would
 * collide. Budgets for labels other than the selected note (which always asks for one):
 * - default: the 5 busiest notes (and region names);
 * - hover or selection: the focused note and up to 14 of its neighbours;
 * - zoomed in: up to 60 in all, the focus and its neighbours first, then the busiest visible notes and hubs;
 * - compact (Home preview): no region names, at most 6 in all.
 * Nothing here allocates per node: the busiest-first order and the sorted neighbour lists come from the layout.
 */
import type { CloudNode } from '../core/cloudLayout'
import { pillHeight, pillPadX, type LabelRequest } from './graphLabels'

/** Label sizes; each maps to one font (see fontForSize), so placement measures exactly what is drawn. */
export const LABEL_SIZE = { strong: 12.5, note: 11, hub: 11.5, region: 10.5 } as const

export const BUSIEST = 5
export const NEIGHBOURS = 14
export const ZOOMED = 60
export const COMPACT_OTHERS = 6
/** Zoom (view scale over the whole-cloud fit) from which visible notes and hubs get labels. */
export const NOTE_ZOOM = 1.8

export interface LabelScene {
  nodes: CloudNode[]
  sx: ArrayLike<number>
  sy: ArrayLike<number>
  /** On-screen dot radius of node i. */
  radius(i: number): number
  w: number
  h: number
  /** Hovered or selected node, or -1. */
  focus: number
  selected: number
  /** Each node's neighbours, busiest first. */
  neighbours: number[][]
  /** Every node index, busiest first. */
  ranked: ArrayLike<number>
  /** Indices matching the search, or null when not searching. */
  highlight: Set<number> | null
  zoom: number
  compact: boolean
  /** Screen centre of each region that has notes on screen. */
  regions: { name: string; x: number; y: number }[]
  /** Floating panels, so the focused note's label can move to the side of its dot that is clear. */
  obstacles: { x: number; y: number; w: number; h: number }[]
}

const onScreen = (s: LabelScene, i: number) => s.sx[i] >= 0 && s.sx[i] <= s.w && s.sy[i] >= 0 && s.sy[i] <= s.h

/** How many labels besides the selected note's. */
export function labelBudget(s: Pick<LabelScene, 'compact' | 'zoom' | 'focus'>): number {
  if (s.compact) return COMPACT_OTHERS
  if (s.zoom >= NOTE_ZOOM) return ZOOMED
  return s.focus >= 0 ? 1 + NEIGHBOURS : BUSIEST
}

export function labelRequests(s: LabelScene, measure: (text: string, size: number) => number): LabelRequest[] {
  const out: LabelRequest[] = []
  const taken = new Set<number>()
  let left = labelBudget(s)
  const isHub = (i: number) => s.nodes[i].node.kind === 'tag' || s.nodes[i].node.kind === 'folder'
  const note = (i: number, priority: number, size: number, counted = true) => {
    if (i < 0 || taken.has(i) || !onScreen(s, i) || (counted && left <= 0)) return false
    taken.add(i)
    if (counted) left--
    const n = s.nodes[i]
    out.push({ id: n.id, text: n.node.label, x: s.sx[i], y: s.sy[i], dotRadius: s.radius(i), priority, size, kind: isHub(i) ? 'hub' : 'note' })
    return true
  }
  /**
   * The selected or hovered note must keep its label: if a panel covers the right of its dot, ask for the left.
   * placeLabels puts a box gap + dotRadius right of x, so moving x left by 2 gaps + the width puts it there.
   */
  const mustShow = (i: number, priority: number, counted: boolean) => {
    if (!note(i, priority, LABEL_SIZE.strong, counted)) return
    const r = out[out.length - 1]
    const w = measure(r.text.length > 44 ? r.text.slice(0, 43) + '…' : r.text, r.size) + 2 * pillPadX(r.size), h = pillHeight(r.size)
    const gap = r.dotRadius * 1.2 + 6, x = r.x + gap, y = r.y - h / 2
    const blocked = x + w > s.w - 6 || s.obstacles.some((o) => x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h)
    if (blocked) r.x -= 2 * gap + w
  }

  mustShow(s.selected, 1000, false)
  if (s.focus >= 0) {
    mustShow(s.focus, 990, true)
    let shown = 0
    for (const i of s.neighbours[s.focus]) {
      if (shown >= NEIGHBOURS || left <= 0) break
      if (note(i, 800 - shown, isHub(i) ? LABEL_SIZE.hub : LABEL_SIZE.note)) shown++
    }
  }

  if (!s.compact) {
    for (const r of s.regions) {
      const text = r.name.toUpperCase()
      // A region label is centred on its lobe: placeLabels puts a box gap + dotRadius right of x, so start left by half its width.
      const half = measure(text, LABEL_SIZE.region) / 2 + pillPadX(LABEL_SIZE.region)
      out.push({ id: 'region:' + r.name, text, x: r.x - half - 6, y: r.y, dotRadius: 0, priority: 600, size: LABEL_SIZE.region, kind: 'region' })
    }
  }

  // The busiest notes; zoomed in, every visible note and hub, busiest first, until the budget is spent.
  const zoomed = !s.compact && s.zoom >= NOTE_ZOOM
  if (s.focus < 0 || zoomed) {
    let rank = 0
    for (let k = 0; k < s.ranked.length && left > 0; k++) {
      const i = s.ranked[k]
      const kind = s.nodes[i].node.kind
      if (zoomed ? kind === 'ghost' : kind !== 'item' || s.nodes[i].degree < 2) continue
      if (s.highlight && !s.highlight.has(i)) continue
      if (note(i, 400 - rank / 1000, isHub(i) ? LABEL_SIZE.hub : LABEL_SIZE.note)) rank++
    }
  }
  return out
}
