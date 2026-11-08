/**
 * 3D "galaxy" model for the knowledge graph: n-body-ish physics (repulsion, springs, central gravity pulling
 * everything into a rotating disc) and a perspective camera. Pure math, no DOM, so it is unit tested.
 */
import type { EdgeKind, GraphData, GraphNode } from './types'

export interface V3 {
  x: number
  y: number
  z: number
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z })
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const len = (a: V3) => Math.hypot(a.x, a.y, a.z)
const norm = (a: V3): V3 => {
  const l = len(a) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}

export interface Star {
  node: GraphNode
  index: number
  p: V3
  v: V3
  /** Heavier stars (hubs) pull and push harder. */
  mass: number
  /** Visual radius in world units. */
  r: number
  /** Stable random numbers for twinkle and orbit phase. */
  seed: number
  /** Orbit axis for leaf nodes circling their hub. */
  axis: V3
  pinned: boolean
  /** Region this star belongs to (or null). Regions pull their members together and push each other apart. */
  group: string | null
}

export interface Bond {
  a: number
  b: number
  kind: EdgeKind
  /** Phase of the light pulse travelling along the bond. */
  seed: number
}

export interface System {
  stars: Star[]
  bonds: Bond[]
  /** adjacency by star index */
  neighbors: number[][]
  index: Map<string, number>
}

export interface PhysicsOptions {
  /** Pull toward the galactic centre. */
  gravity: number
  /** 0 = thin disc, 1 = ball. */
  thickness: number
  /** Rotation speed of the whole galaxy (0 = still). */
  swirl: number
  /** Planets circling their hubs. */
  orbit: number
  repulsion: number
  damping: number
  /** Strength of region gravity (0 = regions mix freely). */
  cluster: number
}

export const DEFAULT_PHYSICS: PhysicsOptions = {
  gravity: 0.9,
  thickness: 0.32,
  swirl: 1,
  orbit: 1,
  repulsion: 1,
  damping: 0.965,
  cluster: 1,
}

const REST: Record<EdgeKind, number> = { link: 92, tag: 118, folder: 70 }
const STIFF: Record<EdgeKind, number> = { link: 0.9, tag: 0.22, folder: 0.3 }

/** Deterministic pseudo-random in [0,1) from a string, so layouts are reproducible. */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

export function radiusOf(n: GraphNode): number {
  if (n.kind === 'tag') return 2.4 + Math.sqrt(n.degree) * 0.9
  if (n.kind === 'folder') return 15 + Math.sqrt(n.degree) * 3
  if (n.kind === 'ghost') return 3.4
  return 3.6 + Math.sqrt(n.degree) * 1.9
}

export function massOf(n: GraphNode): number {
  if (n.kind === 'tag') return 0.55 + n.degree * 0.1
  if (n.kind === 'folder') return 3 + n.degree * 0.25
  return 1 + n.degree * 0.55
}

/** Build a system; stars that existed before keep their position and velocity so edits never "reset" the galaxy. */
export function createSystem(data: GraphData, prev?: System, groupOf?: (n: GraphNode) => string | null): System {
  const index = new Map<string, number>()
  // Each region starts in its own part of the sky so the galaxy has structure from the very first frame.
  const homeOf = (group: string): V3 => {
    const u = hash01(group, 11) * 2 - 1
    const a = hash01(group, 12) * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    return { x: Math.cos(a) * r * 330, y: u * 90, z: Math.sin(a) * r * 330 }
  }
  const stars: Star[] = data.nodes.map((node, i) => {
    index.set(node.id, i)
    const old = prev?.index.has(node.id) ? prev.stars[prev.index.get(node.id)!] : undefined
    const a = hash01(node.id, 1) * Math.PI * 2
    const rr = 60 + 260 * Math.sqrt(hash01(node.id, 2))
    const group = groupOf ? groupOf(node) : null
    const home = group ? homeOf(group) : null
    return {
      node,
      index: i,
      p: old
        ? { ...old.p }
        : home
          ? { x: home.x + (hash01(node.id, 8) - 0.5) * 130, y: home.y + (hash01(node.id, 9) - 0.5) * 50, z: home.z + (hash01(node.id, 10) - 0.5) * 130 }
          : { x: Math.cos(a) * rr, y: (hash01(node.id, 3) - 0.5) * 60, z: Math.sin(a) * rr },
      v: old ? { ...old.v } : { x: 0, y: 0, z: 0 },
      mass: massOf(node),
      r: radiusOf(node),
      seed: hash01(node.id, 4),
      axis: norm({ x: hash01(node.id, 5) - 0.5, y: hash01(node.id, 6) * 0.6 + 0.4, z: hash01(node.id, 7) - 0.5 }),
      pinned: false,
      group,
    }
  })
  const bonds: Bond[] = []
  const neighbors: number[][] = stars.map(() => [])
  for (const e of data.edges) {
    const a = index.get(e.source)
    const b = index.get(e.target)
    if (a === undefined || b === undefined || a === b) continue
    bonds.push({ a, b, kind: e.kind, seed: hash01(e.source + e.target, 8) })
    neighbors[a].push(b)
    neighbors[b].push(a)
  }
  // tags and other unassigned stars join the region most of their neighbours belong to
  for (const s of stars) {
    if (s.group || !groupOf) continue
    const votes = new Map<string, number>()
    for (const j of neighbors[s.index]) {
      const g = stars[j].group
      if (g) votes.set(g, (votes.get(g) ?? 0) + 1)
    }
    let best: string | null = null
    let top = 0
    for (const [g, n] of votes) if (n > top) ((best = g), (top = n))
    s.group = best
  }
  return { stars, bonds, neighbors, index }
}

const CELL = 140

/**
 * Advance the simulation by `dt` seconds (call with small fixed steps). Returns the total kinetic energy,
 * which callers can use to decide how often to redraw.
 */
export function stepSystem(sys: System, dt: number, opt: PhysicsOptions = DEFAULT_PHYSICS): number {
  const { stars, bonds } = sys
  const n = stars.length
  if (n === 0) return 0
  const acc: V3[] = stars.map(() => ({ x: 0, y: 0, z: 0 }))

  // repulsion via a spatial hash: only stars in neighbouring cells interact (keeps it near O(n))
  const grid = new Map<string, number[]>()
  const key = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`
  stars.forEach((s, i) => {
    const k = key(Math.floor(s.p.x / CELL), Math.floor(s.p.y / CELL), Math.floor(s.p.z / CELL))
    const cell = grid.get(k)
    if (cell) cell.push(i)
    else grid.set(k, [i])
  })
  const rep = 9500 * opt.repulsion
  for (let i = 0; i < n; i++) {
    const s = stars[i]
    const cx = Math.floor(s.p.x / CELL)
    const cy = Math.floor(s.p.y / CELL)
    const cz = Math.floor(s.p.z / CELL)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const cell = grid.get(key(cx + dx, cy + dy, cz + dz))
          if (!cell) continue
          for (const j of cell) {
            if (j <= i) continue
            const o = stars[j]
            const d = sub(o.p, s.p)
            const r2 = d.x * d.x + d.y * d.y + d.z * d.z + 90
            const f = (rep * s.mass * o.mass) / r2
            const inv = 1 / Math.sqrt(r2)
            const fx = d.x * inv * f
            const fy = d.y * inv * f
            const fz = d.z * inv * f
            acc[i].x -= fx / s.mass
            acc[i].y -= fy / s.mass
            acc[i].z -= fz / s.mass
            acc[j].x += fx / o.mass
            acc[j].y += fy / o.mass
            acc[j].z += fz / o.mass
          }
        }
  }

  // springs
  for (const b of bonds) {
    const A = stars[b.a]
    const B = stars[b.b]
    const d = sub(B.p, A.p)
    const dist = len(d) || 0.001
    const rest = REST[b.kind] + (A.r + B.r) * 0.6
    const f = STIFF[b.kind] * (dist - rest) * 6
    const ux = d.x / dist
    const uy = d.y / dist
    const uz = d.z / dist
    acc[b.a].x += (ux * f) / A.mass
    acc[b.a].y += (uy * f) / A.mass
    acc[b.a].z += (uz * f) / A.mass
    acc[b.b].x -= (ux * f) / B.mass
    acc[b.b].y -= (uy * f) / B.mass
    acc[b.b].z -= (uz * f) / B.mass
  }

  // centre gravity (a disc: much stronger vertically) + differential rotation + planets circling hubs
  const G = 0.55 * opt.gravity
  const Gy = (0.55 * opt.gravity) / Math.max(0.08, opt.thickness) / 1.1
  for (let i = 0; i < n; i++) {
    const s = stars[i]
    acc[i].x -= G * s.p.x * 0.11
    acc[i].z -= G * s.p.z * 0.11
    acc[i].y -= Gy * s.p.y

    if (opt.swirl > 0) {
      const r = Math.hypot(s.p.x, s.p.z)
      const target = 15 * opt.swirl * Math.sqrt(r / (r + 120)) // gently rising, then flat, like a rotation curve
      const tx = -s.p.z / (r + 20)
      const tz = s.p.x / (r + 20)
      const current = s.v.x * tx + s.v.z * tz
      const nudge = (target - current) * 0.9
      acc[i].x += tx * nudge
      acc[i].z += tz * nudge
    }

    if (opt.orbit > 0 && sys.neighbors[i].length === 1 && s.node.kind !== 'folder') {
      const hub = stars[sys.neighbors[i][0]]
      const rel = sub(s.p, hub.p)
      const t = norm(cross(s.axis, rel))
      const speed = 11 * opt.orbit
      const rv = sub(s.v, hub.v)
      const current = dot(rv, t)
      const nudge = (speed - current) * 2.4
      acc[i].x += t.x * nudge
      acc[i].y += t.y * nudge
      acc[i].z += t.z * nudge
    }
  }

  // region gravity: members gather around their region's centre, regions keep their distance
  if (opt.cluster > 0) {
    const sums = new Map<string, { x: number; y: number; z: number; n: number }>()
    for (const s of stars) {
      if (!s.group) continue
      const c = sums.get(s.group) ?? { x: 0, y: 0, z: 0, n: 0 }
      c.x += s.p.x
      c.y += s.p.y
      c.z += s.p.z
      c.n++
      sums.set(s.group, c)
    }
    const centres = [...sums.entries()].map(([g, c]) => ({ g, x: c.x / c.n, y: c.y / c.n, z: c.z / c.n }))
    const centreOf = new Map(centres.map((c) => [c.g, c]))
    const push = new Map<string, V3>()
    for (let a = 0; a < centres.length; a++) {
      for (let b = a + 1; b < centres.length; b++) {
        const d = { x: centres[a].x - centres[b].x, y: centres[a].y - centres[b].y, z: centres[a].z - centres[b].z }
        const dist = Math.hypot(d.x, d.y, d.z) || 1
        const f = (1500 * opt.cluster) / (dist + 120)
        const pa = push.get(centres[a].g) ?? { x: 0, y: 0, z: 0 }
        const pb = push.get(centres[b].g) ?? { x: 0, y: 0, z: 0 }
        pa.x += (d.x / dist) * f
        pa.y += (d.y / dist) * f * 0.3
        pa.z += (d.z / dist) * f
        pb.x -= (d.x / dist) * f
        pb.y -= (d.y / dist) * f * 0.3
        pb.z -= (d.z / dist) * f
        push.set(centres[a].g, pa)
        push.set(centres[b].g, pb)
      }
    }
    for (const s of stars) {
      if (!s.group) continue
      const c = centreOf.get(s.group)!
      const k = 0.55 * opt.cluster
      acc[s.index].x += (c.x - s.p.x) * k
      acc[s.index].y += (c.y - s.p.y) * k
      acc[s.index].z += (c.z - s.p.z) * k
      const p = push.get(s.group)
      if (p) {
        acc[s.index].x += p.x
        acc[s.index].y += p.y
        acc[s.index].z += p.z
      }
    }
  }

  // integrate
  let energy = 0
  const damp = Math.pow(opt.damping, dt * 60)
  const MAX_V = 160
  for (let i = 0; i < n; i++) {
    const s = stars[i]
    if (s.pinned) {
      s.v = { x: 0, y: 0, z: 0 }
      continue
    }
    s.v.x = (s.v.x + acc[i].x * dt) * damp
    s.v.y = (s.v.y + acc[i].y * dt) * damp
    s.v.z = (s.v.z + acc[i].z * dt) * damp
    const sp = len(s.v)
    if (sp > MAX_V) s.v = scale(s.v, MAX_V / sp)
    s.p.x += s.v.x * dt
    s.p.y += s.v.y * dt
    s.p.z += s.v.z * dt
    energy += 0.5 * s.mass * sp * sp
  }
  return energy
}

/** Run the system forward so the first frame is already a settled galaxy. */
export function warmUp(sys: System, steps = 160, opt: PhysicsOptions = DEFAULT_PHYSICS) {
  for (let i = 0; i < steps; i++) stepSystem(sys, 1 / 30, opt)
}

// ---------------------------------------------------------------- camera

export interface Camera {
  yaw: number
  pitch: number
  dist: number
  target: V3
  /** vertical field of view, radians */
  fov: number
}

export const DEFAULT_CAMERA: Camera = { yaw: 0.6, pitch: 0.42, dist: 620, target: v3(), fov: (58 * Math.PI) / 180 }

export interface Basis {
  pos: V3
  right: V3
  up: V3
  forward: V3
}

export function basisOf(cam: Camera): Basis {
  const cp = Math.cos(cam.pitch)
  const dir = { x: Math.sin(cam.yaw) * cp, y: Math.sin(cam.pitch), z: Math.cos(cam.yaw) * cp }
  const pos = add(cam.target, scale(dir, cam.dist))
  const forward = norm(scale(dir, -1))
  const right = norm(cross(forward, { x: 0, y: 1, z: 0 }))
  const up = cross(right, forward)
  return { pos, right, up, forward }
}

export interface Projected {
  x: number
  y: number
  /** pixels per world unit at this depth */
  scale: number
  /** camera-space distance along the view direction */
  depth: number
  visible: boolean
}

const NEAR = 8

export function focalLength(cam: Camera, h: number): number {
  return h / 2 / Math.tan(cam.fov / 2)
}

export function project(basis: Basis, cam: Camera, p: V3, w: number, h: number): Projected {
  const rel = sub(p, basis.pos)
  const zc = dot(rel, basis.forward)
  if (zc < NEAR) return { x: 0, y: 0, scale: 0, depth: zc, visible: false }
  const f = focalLength(cam, h)
  const s = f / zc
  return { x: w / 2 + dot(rel, basis.right) * s, y: h / 2 - dot(rel, basis.up) * s, scale: s, depth: zc, visible: true }
}

/** Inverse of `project` for a known depth; used to drag a star in the screen plane. */
export function unproject(basis: Basis, cam: Camera, sx: number, sy: number, depth: number, w: number, h: number): V3 {
  const f = focalLength(cam, h)
  const xc = ((sx - w / 2) * depth) / f
  const yc = (-(sy - h / 2) * depth) / f
  return add(add(add(basis.pos, scale(basis.right, xc)), scale(basis.up, yc)), scale(basis.forward, depth))
}

export interface Hit {
  star: Star
  projected: Projected
}

/** Nearest star under a screen point (front-most wins). `slop` is extra pixels of forgiveness for fingers. */
export function hitTest(sys: System, basis: Basis, cam: Camera, sx: number, sy: number, w: number, h: number, slop = 6): Hit | null {
  let best: Hit | null = null
  for (const star of sys.stars) {
    const pr = project(basis, cam, star.p, w, h)
    if (!pr.visible) continue
    const radius = Math.max(star.r * pr.scale, 3) + slop
    const dx = pr.x - sx
    const dy = pr.y - sy
    if (dx * dx + dy * dy > radius * radius) continue
    if (!best || pr.depth < best.projected.depth) best = { star, projected: pr }
  }
  return best
}

/** Camera that frames the galaxy. Far-flung stragglers (top 7%) are allowed to sit near the edge. */
export function fitCamera(sys: System, cam: Camera, aspect: number): Camera {
  if (sys.stars.length === 0) return { ...cam, target: v3(), dist: 520 }
  let c = v3()
  for (const s of sys.stars) c = add(c, s.p)
  c = scale(c, 1 / sys.stars.length)
  const dists = sys.stars.map((s) => len(sub(s.p, c)) + s.r).sort((a, b) => a - b)
  const rad = Math.max(40, dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.93))] + 12)
  const vfov = cam.fov
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * Math.max(aspect, 0.3))
  const dist = (rad * 1.06) / Math.tan(Math.min(vfov, hfov) / 2)
  return { ...cam, target: c, dist: Math.min(Math.max(dist, 120), 4000) }
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
