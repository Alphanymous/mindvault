/**
 * Which labels the graph cloud asks for, and how important each is; placeLabels() then drops whatever would
 * collide. Default: region names and the 5 busiest notes. Hover or selection: the focused note and up to 14 of
 * its neighbours. Zoomed in: up to 60 visible notes. Compact (Home preview): no region names, the selected note
 * always, at most 6 others.
 */
import type { CloudNode } from '../core/cloudLayout'
import { pillHeight, pillPadX, type LabelRequest } from './graphLabels'

/** Label sizes; each maps to one font (see fontForSize), so placement measures exactly what is drawn. */
export const LABEL_SIZE = { strong: 12.5, note: 11, hub: 11.5, region: 10.5 } as const

export const BUSIEST = 5
export const NEIGHBOURS = 14
export const ZOOMED = 60
export const COMPACT_OTHERS = 6
/** Zoom (view scale over the whole-cloud fit) from which hubs, then every visible note, get labels. */
export const HUB_ZOOM = 1.4
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
  neighbours: number[][]
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
const byDegree = (s: LabelScene) => (a: number, b: number) => s.nodes[b].degree - s.nodes[a].degree

export function labelRequests(s: LabelScene, measure: (text: string, size: number) => number): LabelRequest[] {
  const out: LabelRequest[] = []
  const taken = new Set<number>()
  const note = (i: number, priority: number, size: number, kind: LabelRequest['kind'] = 'note') => {
    if (i < 0 || taken.has(i) || !onScreen(s, i)) return
    taken.add(i)
    const n = s.nodes[i]
    out.push({ id: n.id, text: n.node.label, x: s.sx[i], y: s.sy[i], dotRadius: s.radius(i), priority, size, kind })
  }
  /**
   * The selected or hovered note must keep its label: if a panel covers the right of its dot, ask for the left.
   * placeLabels puts a box gap + dotRadius right of x, so moving x left by 2 gaps + the width puts it there.
   */
  const mustShow = (i: number, priority: number) => {
    if (i < 0 || taken.has(i) || !onScreen(s, i)) return
    note(i, priority, LABEL_SIZE.strong)
    const r = out[out.length - 1]
    const w = measure(r.text.length > 44 ? r.text.slice(0, 43) + '…' : r.text, r.size) + 2 * pillPadX(r.size), h = pillHeight(r.size)
    const gap = r.dotRadius * 1.2 + 6, x = r.x + gap, y = r.y - h / 2
    const blocked = x + w > s.w - 6 || s.obstacles.some((o) => x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h)
    if (blocked) r.x -= 2 * gap + w
  }
  const isHub = (i: number) => s.nodes[i].node.kind === 'tag' || s.nodes[i].node.kind === 'folder'

  mustShow(s.selected, 1000)
  if (s.focus >= 0) {
    mustShow(s.focus, 990)
    const near = s.neighbours[s.focus].filter((i) => i !== s.selected).sort(byDegree(s)).slice(0, s.compact ? COMPACT_OTHERS : NEIGHBOURS)
    near.forEach((i, rank) => note(i, 800 - rank, isHub(i) ? LABEL_SIZE.hub : LABEL_SIZE.note, isHub(i) ? 'hub' : 'note'))
  }

  if (!s.compact) {
    for (const r of s.regions) {
      const text = r.name.toUpperCase()
      // A region label is centred on its lobe: placeLabels puts a box gap + dotRadius right of x, so start left by half its width.
      const half = measure(text, LABEL_SIZE.region) / 2 + pillPadX(LABEL_SIZE.region)
      out.push({ id: 'region:' + r.name, text, x: r.x - half - 6, y: r.y, dotRadius: 0, priority: 600, size: LABEL_SIZE.region, kind: 'region' })
    }
  }

  if (s.focus < 0) {
    const pool = s.nodes.map((_, i) => i).filter((i) => s.nodes[i].node.kind === 'item' && s.nodes[i].degree >= 2 && (!s.highlight || s.highlight.has(i)))
    pool.sort(byDegree(s))
    const busiest = s.compact ? COMPACT_OTHERS : BUSIEST
    pool.filter((i) => onScreen(s, i)).slice(0, busiest).forEach((i, rank) => note(i, 400 - rank, LABEL_SIZE.note))
  }

  if (!s.compact && s.zoom >= HUB_ZOOM) {
    s.nodes.forEach((_, i) => { if (isHub(i)) note(i, 300 + Math.min(90, s.nodes[i].degree), LABEL_SIZE.hub, 'hub') })
  }
  if (!s.compact && s.zoom >= NOTE_ZOOM) {
    const visible = s.nodes.map((_, i) => i).filter((i) => s.nodes[i].node.kind === 'item' && onScreen(s, i) && !taken.has(i))
    visible.sort(byDegree(s)).slice(0, ZOOMED).forEach((i, rank) => note(i, 200 - rank / 100, LABEL_SIZE.note))
  }
  return out
}
