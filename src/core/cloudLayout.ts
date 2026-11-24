/**
 * Force layout for the 2D graph cloud, ported from EleSync's dashboard-graph-layout.js. Pure computation, no
 * DOM. Repulsion uses a Barnes-Hut quadtree (O(n log n)) with a 1/distance falloff, springs run along edges,
 * a soft gravity keeps the cloud together. Beyond EleSync, each region (top-level folder) is a lobe: seeded in
 * its own patch around a name-fixed anchor, moved as a block toward that anchor and toward the other lobes, kept
 * from overlapping its neighbours, and held in one piece by pulling back only the notes that stray beyond its
 * share of the cloud. Lobes are as dense as the cloud around them, so they press together into one round
 * cloud instead of floating apart; a shape force keeps the whole round.
 */
import { regionOf } from './clusters'
import { hash01 } from './hash'
import type { EdgeKind, GraphData, GraphNode } from './types'

export interface CloudNode { id: string; node: GraphNode; region: string | null; x: number; y: number; vx: number; vy: number; charge: number; mass: number; degree: number; pinned: boolean }
export interface CloudLayout {
  nodes: CloudNode[]
  index: Map<string, number>
  edges: { a: number; b: number; kind: EdgeKind }[]
  tick(): boolean            // false once settled
  reheat(level: number): void
  readonly settled: boolean
  /** Centre of each region's lobe, for labels and focusRegion. */
  regionCentres(): Map<string, { x: number; y: number; radius: number }>
}

const REPEL_BASE = 30
const THETA_SQUARED = 0.81
const ALPHA_MIN = 0.002
const MAX_SPEED = 40
const MAX_DEPTH = 40
const GOLDEN_ANGLE = 2.39996
/**
 * EleSync's defaults, plus the region forces: `anchor` moves a lobe toward its name-fixed anchor (where it sits),
 * `pack` toward the middle of the cloud (so lobes touch), `separate` pushes overlapping lobes apart, `cohesion`
 * pulls back notes beyond `lobe` x the lobe's share of the cloud radius (one piece, no squeeze), `folderPull`
 * weakens folder-hub springs (the region forces already hold a folder together; full springs squeeze a lobe
 * into a dense star), and `round` squeezes the cloud along whichever axis it is stretched.
 */
const PARAMS = { center: 0.4, repel: 1.6, link: 1, distance: 40, anchor: 0.02, pack: 0.08, separate: 1, cohesion: 0.3, lobe: 0.8, folderPull: 0.1, round: 0.2 }
/** Ring scale of the anchor spiral (EleSync seed(): 38 * sqrt(i + 0.5) * sqrt(groups)). */
const ANCHOR_RING = 38
/** A warm start only nudges the old cloud, so existing nodes stay where the reader last saw them. */
const WARM_ALPHA = 0.1

/**
 * Where a region's lobe sits: a point on EleSync's golden-angle seed spiral whose step and spiral index come from
 * hashes of the name. The angle depends on the name alone; the ring grows with the number of regions.
 */
export function regionAnchor(name: string, regionCount: number): { x: number; y: number } {
  const groups = Math.max(1, regionCount)
  const angle = Math.floor(hash01(name, 31) * 1024) * GOLDEN_ANGLE
  const ring = ANCHOR_RING * Math.sqrt(hash01(name, 32) * groups + 0.5) * Math.sqrt(groups)
  return { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring }
}

/** Folder hubs weigh like EleSync's projects, tags like its tags, everything else like a memory. */
function weight(node: GraphNode): { charge: number; mass: number } {
  if (node.kind === 'folder') return { charge: 4, mass: 3 }
  if (node.kind === 'tag') return { charge: 2.5, mass: 2 }
  return { charge: 1, mass: 1 }
}

export function createCloudLayout(data: GraphData, prev?: CloudLayout): CloudLayout {
  const index = new Map<string, number>()
  data.nodes.forEach((node, i) => index.set(node.id, i))
  const count = data.nodes.length

  const edges: CloudLayout['edges'] = []
  const degree = new Float64Array(count)
  for (const e of data.edges) {
    const a = index.get(e.source), b = index.get(e.target)
    if (a === undefined || b === undefined || a === b) continue
    edges.push({ a, b, kind: e.kind })
    degree[a]++; degree[b]++
  }

  const regionSize = new Map<string, number>()
  const regions = data.nodes.map((node) => {
    const r = regionOf(node)
    if (r) regionSize.set(r, (regionSize.get(r) ?? 0) + 1)
    return r
  })
  const anchors = new Map([...regionSize.keys()].map((r) => [r, regionAnchor(r, regionSize.size)]))

  // Warm start: a node keeps its old spot unless it moved to another region, then it starts in its new patch.
  const kept = data.nodes.map((node, i) => {
    const old = prev?.index.has(node.id) ? prev.nodes[prev.index.get(node.id)!] : undefined
    return old && old.region === regions[i] ? old : undefined
  })
  const nodes: CloudNode[] = data.nodes.map((node, i) => {
    const region = regions[i], old = kept[i]
    let x: number, y: number
    if (old) ({ x, y } = old)
    else {
      // Start each region in its own patch around its anchor, so the layout begins close to its answer.
      const c = (region && anchors.get(region)) || { x: 0, y: 0 }
      const size = (region && regionSize.get(region)) || 20
      const angle = hash01(node.id, 1) * Math.PI * 2, radius = (6 + 5 * Math.sqrt(size)) * Math.sqrt(hash01(node.id, 2))
      x = c.x + Math.cos(angle) * radius; y = c.y + Math.sin(angle) * radius
    }
    return { id: node.id, node, region, x, y, vx: 0, vy: 0, ...weight(node), degree: degree[i], pinned: false }
  })
  // A new node with a kept neighbour in its own region (or with no region, like a tag) starts beside it.
  const placed: number[] = kept.map((old) => (old ? 1 : 0))
  if (prev) for (const e of edges) {
    const [fresh, near] = placed[e.a] ? [e.b, e.a] : [e.a, e.b]
    const n = nodes[fresh]
    if (placed[fresh] || placed[near] !== 1 || (n.region && n.region !== nodes[near].region)) continue
    const angle = hash01(n.id, 1) * Math.PI * 2, radius = PARAMS.distance * (0.5 + 0.5 * hash01(n.id, 2))
    n.x = nodes[near].x + Math.cos(angle) * radius; n.y = nodes[near].y + Math.sin(angle) * radius
    placed[fresh] = 2
  }
  /* Each node's region as a small integer, so a tick can find every region's live centroid without allocating. */
  const regionNames = [...regionSize.keys()]
  const regionId = Int32Array.from(nodes, (n) => (n.region ? regionNames.indexOf(n.region) : -1))
  const members = Float64Array.from(regionNames, (r) => regionSize.get(r)!)
  const centreX = new Float64Array(regionNames.length), centreY = new Float64Array(regionNames.length)
  const regionCount = regionNames.length, regionAnchors = regionNames.map((r) => anchors.get(r)!)
  const lobeRadius = new Float64Array(regionCount), blockX = new Float64Array(regionCount), blockY = new Float64Array(regionCount)

  const bias = edges.map((e) => degree[e.a] / (degree[e.a] + degree[e.b]))
  const pull = edges.map((e) => 1 / Math.min(degree[e.a], degree[e.b]))
  const spread = edges.map((e) => 2 * Math.sqrt(Math.max(degree[e.a], degree[e.b])))

  /* Quadtree pools, reused every tick so a tick allocates nothing. */
  const capacity = count * 8 + 64
  const cx = new Float64Array(capacity), cy = new Float64Array(capacity), half = new Float64Array(capacity)
  const mass = new Float64Array(capacity), sumX = new Float64Array(capacity), sumY = new Float64Array(capacity)
  const leaf = new Int32Array(capacity), kids = new Int32Array(capacity * 4)
  const stack = new Int32Array(512)
  let used = 0
  // A warm start runs only as hot as its share of new or moved nodes needs: one new note barely stirs the
  // cloud, while a layout whose prev had none of these nodes (say, the vault was still loading) starts cold.
  const fresh = count - kept.filter(Boolean).length
  let alpha = count === 0 ? 0 : Math.max(WARM_ALPHA, fresh / count)
  const decay = count > 5000 ? 0.95 : 0.9772

  function newCell(x: number, y: number, h: number): number {
    const cell = used++
    cx[cell] = x; cy[cell] = y; half[cell] = h
    mass[cell] = sumX[cell] = sumY[cell] = 0
    leaf[cell] = -1
    kids.fill(-1, cell * 4, cell * 4 + 4)
    return cell
  }
  function descend(cell: number, i: number, depth: number) {
    const n = nodes[i], quadrant = (n.x > cx[cell] ? 1 : 0) + (n.y > cy[cell] ? 2 : 0)
    let child = kids[cell * 4 + quadrant]
    if (child < 0) {
      const h = half[cell] / 2
      child = newCell(cx[cell] + (quadrant & 1 ? h : -h), cy[cell] + (quadrant & 2 ? h : -h), h)
      kids[cell * 4 + quadrant] = child
    }
    insert(child, i, depth + 1)
  }
  function insert(cell: number, i: number, depth: number) {
    const n = nodes[i], c = n.charge
    mass[cell] += c; sumX[cell] += n.x * c; sumY[cell] += n.y * c
    if (leaf[cell] === -1) { leaf[cell] = i; return }
    if (leaf[cell] >= 0) {
      // Coincident points or a full pool stay aggregated in one cell rather than splitting forever.
      if (depth >= MAX_DEPTH || used + 8 > capacity) return
      const other = leaf[cell]
      leaf[cell] = -2
      descend(cell, other, depth)
    }
    descend(cell, i, depth)
  }
  function build() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of nodes) {
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    }
    used = 0
    newCell((minX + maxX) / 2, (minY + maxY) / 2, Math.max(maxX - minX, maxY - minY) / 2 + 1)
    for (let i = 0; i < count; i++) insert(0, i, 0)
  }
  function repel(i: number, strength: number) {
    const n = nodes[i]
    let sp = 0, fx = 0, fy = 0
    stack[sp++] = 0
    while (sp > 0) {
      const cell = stack[--sp], m = mass[cell]
      if (m === 0) continue
      let dx = n.x - sumX[cell] / m, dy = n.y - sumY[cell] / m, d2 = dx * dx + dy * dy
      const owner = leaf[cell]
      if (owner === i) continue
      if (owner < 0 && half[cell] * half[cell] * 4 >= THETA_SQUARED * d2) {
        for (let q = 0; q < 4; q++) if (kids[cell * 4 + q] >= 0) stack[sp++] = kids[cell * 4 + q]
        continue
      }
      if (d2 < 1) { dx = i % 2 ? 0.5 : -0.5; dy = 0.5; d2 = 1 }
      const w = strength * m / d2
      fx += dx * w; fy += dy * w
    }
    n.vx += fx / n.mass; n.vy += fy / n.mass
  }

  function tick(): boolean {
    if (alpha < ALPHA_MIN) return false
    build()
    const strength = REPEL_BASE * PARAMS.repel * alpha
    for (let i = 0; i < count; i++) repel(i, strength)
    for (let k = 0; k < edges.length; k++) {
      const e = edges[k], a = nodes[e.a], b = nodes[e.b]
      const dx = b.x + b.vx - a.x - a.vx, dy = b.y + b.vy - a.y - a.vy
      const d = Math.hypot(dx, dy) || 1e-6
      const rest = (PARAMS.distance + spread[k]) * (e.kind === 'link' ? 0.8 : 1)
      const f = (d - rest) / d * alpha * pull[k] * PARAMS.link * (e.kind === 'folder' ? PARAMS.folderPull : 1)
      b.vx -= dx * f * bias[k]; b.vy -= dy * f * bias[k]
      a.vx += dx * f * (1 - bias[k]); a.vy += dy * f * (1 - bias[k])
    }
    centreX.fill(0); centreY.fill(0)
    let mx = 0, my = 0
    for (let i = 0; i < count; i++) {
      const n = nodes[i], r = regionId[i]
      mx += n.x / count; my += n.y / count
      if (r >= 0) { centreX[r] += n.x / members[r]; centreY[r] += n.y / members[r] }
    }
    // Shape: the cloud's covariance normalised to trace 1, less a round cloud's. Pulling along that excess
    // squeezes the long axis and widens the short one; a round cloud feels nothing.
    let sxx = 0, syy = 0, sxy = 0
    for (const n of nodes) { sxx += (n.x - mx) ** 2; syy += (n.y - my) ** 2; sxy += (n.x - mx) * (n.y - my) }
    const k = (PARAMS.round * alpha) / (sxx + syy || 1), squeeze = (k * (sxx - syy)) / 2, shear = k * sxy
    // Radius of the whole cloud as a uniform disc; each region's lobe fills its share of that area.
    const cloudRadius = Math.sqrt((2 * (sxx + syy)) / (count || 1))
    // Lobes move as blocks: toward their anchor, toward the middle (so they pack), and apart where two overlap.
    for (let r = 0; r < regionCount; r++) {
      lobeRadius[r] = PARAMS.lobe * cloudRadius * Math.sqrt(members[r] / count)
      const a = regionAnchors[r]
      blockX[r] = (a.x - centreX[r]) * PARAMS.anchor + (mx - centreX[r]) * PARAMS.pack
      blockY[r] = (a.y - centreY[r]) * PARAMS.anchor + (my - centreY[r]) * PARAMS.pack
    }
    for (let r = 0; r < regionCount; r++) for (let q = r + 1; q < regionCount; q++) {
      const dx = centreX[q] - centreX[r], dy = centreY[q] - centreY[r], d = Math.hypot(dx, dy) || 1
      const overlap = lobeRadius[r] + lobeRadius[q] - d
      if (overlap <= 0) continue
      const push = (overlap / d) * PARAMS.separate, share = members[q] / (members[r] + members[q])
      blockX[r] -= dx * push * share; blockY[r] -= dy * push * share
      blockX[q] += dx * push * (1 - share); blockY[q] += dy * push * (1 - share)
    }
    for (let i = 0; i < count; i++) {
      const n = nodes[i], gravity = PARAMS.center * (degree[i] ? 0.02 : 0.06) * alpha, r = regionId[i]
      n.vx -= n.x * gravity + squeeze * (n.x - mx) + shear * (n.y - my)
      n.vy -= n.y * gravity - squeeze * (n.y - my) + shear * (n.x - mx)
      if (r >= 0) {
        // Block forces move the lobe without squeezing it; cohesion pulls back only notes beyond its radius.
        n.vx += blockX[r] * alpha
        n.vy += blockY[r] * alpha
        const dx = centreX[r] - n.x, dy = centreY[r] - n.y, d = Math.hypot(dx, dy) || 1
        const excess = d - lobeRadius[r]
        if (excess > 0) {
          n.vx += (dx / d) * excess * PARAMS.cohesion * alpha
          n.vy += (dy / d) * excess * PARAMS.cohesion * alpha
        }
      }
      n.vx *= 0.6; n.vy *= 0.6
      if (n.pinned) { n.vx = n.vy = 0; continue }
      const speed = Math.hypot(n.vx, n.vy)
      if (speed > MAX_SPEED) { n.vx *= MAX_SPEED / speed; n.vy *= MAX_SPEED / speed }
      n.x += n.vx; n.y += n.vy
    }
    alpha *= decay
    return true
  }

  function regionCentres() {
    const sums = new Map<string, { x: number; y: number; k: number }>()
    for (const n of nodes) {
      if (!n.region) continue
      const s = sums.get(n.region) ?? { x: 0, y: 0, k: 0 }
      s.x += n.x; s.y += n.y; s.k++
      sums.set(n.region, s)
    }
    const spread2 = new Map<string, number>()
    for (const n of nodes) {
      if (!n.region) continue
      const s = sums.get(n.region)!
      spread2.set(n.region, (spread2.get(n.region) ?? 0) + (n.x - s.x / s.k) ** 2 + (n.y - s.y / s.k) ** 2)
    }
    // Radius of a uniform disc with the same spread: sqrt(2) * RMS distance from the centre.
    return new Map([...sums].map(([r, s]) => [r, { x: s.x / s.k, y: s.y / s.k, radius: Math.sqrt((2 * spread2.get(r)!) / s.k) }]))
  }

  return {
    nodes,
    index,
    edges,
    tick,
    reheat(level: number) { if (count) alpha = Math.max(alpha, level) },
    get settled() { return alpha < ALPHA_MIN },
    regionCentres,
  }
}
