/**
 * Screen geometry of the graph cloud, ported from EleSync's place(): every node has a depth from its region plus
 * its own id, the flat layout turns a little to each side, and nearer nodes draw larger and further out. Also the
 * view that frames the cloud, node sizes, hit testing and the inverse mapping used to drag a node. No DOM.
 */
import type { CloudNode } from '../core/cloudLayout'
import { hash01 } from '../core/hash'

/** Radians the cloud turns to each side while swaying, and how fast. */
export const SWAY = 0.45
const SWAY_SPEED = 0.13
/** World units over which perspective scales a node by about 2x. */
const DEPTH_RANGE = 1400
/** Drift, travelling pulses and the sway only below this many nodes; plain dots above LITE_LIMIT until zoomed in. */
export const AMBIENT_LIMIT = 3000
export const LITE_LIMIT = 3500
/** Ambient drift, in pixels. */
const DRIFT = 1.6
/** Largest scale a fit may choose, so one or two notes don't fill the screen. */
const MAX_FIT_SCALE = 2.4

/** screen = world * scale + offset (before the sway). */
export interface View { x: number; y: number; scale: number }

/** What a node looks like, fixed per node: base radius, depth in [-1, 1], drift phase. */
export interface Look { radius: number; zr: number; phase: number }

export function lookOf(n: CloudNode): Look {
  const phase = hash01(n.id, 45) * Math.PI * 2
  const kind = n.node.kind
  if (kind === 'folder') return { radius: 7 + Math.min(9, Math.sqrt(n.degree) * 0.4), zr: 0, phase }
  if (kind === 'tag') return { radius: 4 + Math.min(5, Math.sqrt(n.degree) * 0.3), zr: 0, phase }
  // Most notes are small dots, some medium, a few large (70/25/5 %); links add weight.
  const u = hash01(n.id, 41)
  const radius = (u < 0.7 ? 1.5 : u < 0.95 ? 2.6 : 4.2) + Math.min(1.2, Math.sqrt(n.degree) * 0.25)
  return { radius, zr: regionDepth(n.region ?? '') + (hash01(n.id, 44) * 2 - 1) * 0.5, phase }
}

/** The share of a note's depth that comes from its region, so a lobe sways as one piece. */
export const regionDepth = (region: string) => (hash01('g' + region, 43) * 2 - 1) * 0.5

/** Centre of the cloud and its RMS radius, which scales the depth of the sway. */
export interface CloudStats { mx: number; my: number; radius: number }

export function cloudStats(nodes: CloudNode[]): CloudStats {
  if (!nodes.length) return { mx: 0, my: 0, radius: 1 }
  let mx = 0, my = 0
  for (const n of nodes) { mx += n.x; my += n.y }
  mx /= nodes.length; my /= nodes.length
  let v = 0
  for (const n of nodes) v += (n.x - mx) ** 2 + (n.y - my) ** 2
  return { mx, my, radius: Math.max(1, Math.sqrt(v / nodes.length)) }
}

/** The turn at a given time; `amp` (0..1) fades the sway in and out. */
export const swayAngle = (time: number, amp: number) => Math.sin(time * SWAY_SPEED) * SWAY * amp

/** Where a world point lands at view scale 1 and offset 0, and its perspective factor. */
function turn(x: number, y: number, zr: number, s: CloudStats, angle: number, amp: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const z = zr * s.radius * 0.9, dx = x - s.mx
  const across = dx * cos + z * sin, depth = -dx * sin + z * cos
  const k = (300 / Math.max(120, s.radius)) * 1.4 / DEPTH_RANGE
  const f = 1 + amp * (Math.max(0.6, Math.min(1.7, 1 + depth * k)) - 1)
  return { x: s.mx + across * f, y: s.my + (y - s.my) * f, f }
}

/** Screen positions and perspective factors, reused between frames. */
export interface Placed { sx: Float64Array; sy: Float64Array; f: Float64Array }
export const newPlaced = (count: number): Placed => ({ sx: new Float64Array(count), sy: new Float64Array(count), f: new Float64Array(count) })

export function place(nodes: CloudNode[], looks: Look[], s: CloudStats, view: View, angle: number, amp: number, time: number, drift: boolean, out: Placed) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i], look = looks[i]
    const p = turn(n.x, n.y, look.zr, s, angle, amp)
    let x = p.x * view.scale + view.x, y = p.y * view.scale + view.y
    if (drift && n.node.kind === 'item') {
      x += Math.sin(time * 0.35 + look.phase) * DRIFT
      y += Math.cos(time * 0.29 + look.phase * 1.3) * DRIFT
    }
    out.sx[i] = x; out.sy[i] = y; out.f[i] = p.f
  }
}

/** Project one world point (dust, a region centre) the same way as the nodes. */
export function placePoint(x: number, y: number, zr: number, s: CloudStats, view: View, angle: number, amp: number) {
  const p = turn(x, y, zr, s, angle, amp)
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y, f: p.f }
}

/** On-screen radius: grows gently with zoom and with nearness. */
export const sizeOf = (look: Look, scale: number, f: number) => look.radius * Math.pow(scale, 0.45) * f

/**
 * The view that frames every node with a 10 % margin on each side. With the sway on, the frame covers the cloud
 * at both ends of the turn, so nothing leaves the screen as it swings.
 */
export function fitView(nodes: CloudNode[], looks: Look[], s: CloudStats, w: number, h: number, swaying: boolean, margin = 0.1): View {
  if (!nodes.length || w <= 0 || h <= 0) return { x: w / 2, y: h / 2, scale: 1 }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const angle of swaying ? [-SWAY, 0, SWAY] : [0]) {
    for (let i = 0; i < nodes.length; i++) {
      const p = turn(nodes[i].x, nodes[i].y, looks[i].zr, s, angle, swaying ? 1 : 0)
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  const spanX = Math.max(40, maxX - minX), spanY = Math.max(40, maxY - minY)
  const scale = Math.min(MAX_FIT_SCALE, (w * (1 - 2 * margin)) / spanX, (h * (1 - 2 * margin)) / spanY)
  return { x: w / 2 - ((minX + maxX) / 2) * scale, y: h / 2 - ((minY + maxY) / 2) * scale, scale }
}

/** The view that brings what is now at screen point (sx, sy) to the middle of the canvas, at a given scale. */
export const centreOn = (sx: number, sy: number, view: View, w: number, h: number, scale: number): View => ({
  x: w / 2 - ((sx - view.x) / view.scale) * scale,
  y: h / 2 - ((sy - view.y) / view.scale) * scale,
  scale,
})

/** Nearest node within `slop` pixels of its edge, or -1. */
export function pick(looks: Look[], placed: Placed, scale: number, px: number, py: number, slop: number, skip?: (i: number) => boolean): number {
  let best = -1, bestGap = slop
  for (let i = 0; i < looks.length; i++) {
    if (skip?.(i)) continue
    const gap = Math.hypot(placed.sx[i] - px, placed.sy[i] - py) - sizeOf(looks[i], scale, placed.f[i])
    if (gap < bestGap) { bestGap = gap; best = i }
  }
  return best
}

/** The world position that would put a node under the pointer (the inverse of place(), drift aside). */
export function unplace(sx: number, sy: number, look: Look, f: number, s: CloudStats, view: View, angle: number) {
  const across = ((sx - view.x) / view.scale - s.mx) / f
  const z = look.zr * s.radius * 0.9
  return { x: s.mx + (across - z * Math.sin(angle)) / Math.cos(angle), y: s.my + ((sy - view.y) / view.scale - s.my) / f }
}
