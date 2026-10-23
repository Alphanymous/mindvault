import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAMERA, DEFAULT_PHYSICS, basisOf, createSystem, fitCamera, hash01, hitTest, project, stepSystem, unproject, warmUp, type Camera,
} from './galaxy'
import type { GraphData } from './types'

const node = (id: string, degree = 0, kind: 'item' | 'tag' | 'ghost' | 'folder' = 'item') => ({ id, label: id, kind, degree, itemType: 'note' as const })
const ring = (n: number): GraphData => ({
  nodes: Array.from({ length: n }, (_, i) => node(`n${i}`, 2)),
  edges: Array.from({ length: n }, (_, i) => ({ source: `n${i}`, target: `n${(i + 1) % n}`, kind: 'link' as const })),
})
const hubAndLeaves = (leaves: number): GraphData => ({
  nodes: [node('hub', leaves), ...Array.from({ length: leaves }, (_, i) => node(`leaf${i}`, 1))],
  edges: Array.from({ length: leaves }, (_, i) => ({ source: 'hub', target: `leaf${i}`, kind: 'link' as const })),
})
const finite = (sys: ReturnType<typeof createSystem>) => sys.stars.every((s) => [s.p.x, s.p.y, s.p.z, s.v.x, s.v.y, s.v.z].every(Number.isFinite))

describe('galaxy physics', () => {
  it('is deterministic and keeps positions of surviving stars when the data changes', () => {
    const a = createSystem(ring(6))
    const b = createSystem(ring(6))
    expect(a.stars.map((s) => s.p)).toEqual(b.stars.map((s) => s.p))
    warmUp(a, 40)
    const grown = createSystem(ring(8), a)
    expect(grown.stars[0].p).toEqual(a.stars[0].p)
    expect(hash01('x')).toBe(hash01('x'))
    expect(hash01('x')).not.toBe(hash01('y'))
  })

  it('stays finite and settles into a bounded system', () => {
    const sys = createSystem(ring(40))
    for (let i = 0; i < 600; i++) stepSystem(sys, 1 / 60)
    expect(finite(sys)).toBe(true)
    const far = Math.max(...sys.stars.map((s) => Math.hypot(s.p.x, s.p.y, s.p.z)))
    expect(far).toBeLessThan(1200)
  })

  it('springs pull linked stars together toward their rest length', () => {
    const sys = createSystem({ nodes: [node('a', 1), node('b', 1)], edges: [{ source: 'a', target: 'b', kind: 'link' }] })
    sys.stars[0].p = { x: -400, y: 0, z: 0 }
    sys.stars[1].p = { x: 400, y: 0, z: 0 }
    const before = Math.hypot(800)
    for (let i = 0; i < 400; i++) stepSystem(sys, 1 / 60, { ...DEFAULT_PHYSICS, swirl: 0, orbit: 0 })
    const d = Math.hypot(sys.stars[0].p.x - sys.stars[1].p.x, sys.stars[0].p.y - sys.stars[1].p.y, sys.stars[0].p.z - sys.stars[1].p.z)
    expect(d).toBeLessThan(before / 3)
  })

  it('repels unrelated stars so nodes do not pile on top of each other', () => {
    const sys = createSystem({ nodes: [node('a'), node('b')], edges: [] })
    sys.stars[0].p = { x: -2, y: 0, z: 0 }
    sys.stars[1].p = { x: 2, y: 0, z: 0 }
    const opts = { ...DEFAULT_PHYSICS, gravity: 0, swirl: 0, orbit: 0 }
    for (let i = 0; i < 60; i++) stepSystem(sys, 1 / 60, opts)
    expect(Math.abs(sys.stars[1].p.x - sys.stars[0].p.x)).toBeGreaterThan(4.5)
  })

  it('flattens into a disc: spread in height is much smaller than across the plane', () => {
    const sys = createSystem(ring(60))
    warmUp(sys, 400)
    const sd = (f: (s: (typeof sys.stars)[number]) => number) => {
      const xs = sys.stars.map(f)
      const m = xs.reduce((a, b) => a + b, 0) / xs.length
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
    }
    expect(sd((s) => s.p.y)).toBeLessThan(sd((s) => s.p.x) * 0.6)
  })

  it('rotates like a galaxy: net angular momentum around the vertical axis', () => {
    const sys = createSystem(ring(50))
    warmUp(sys, 200)
    const L = sys.stars.reduce((sum, s) => sum + (s.p.z * s.v.x - s.p.x * s.v.z), 0)
    const still = createSystem(ring(50))
    warmUp(still, 200, { ...DEFAULT_PHYSICS, swirl: 0 })
    const L0 = still.stars.reduce((sum, s) => sum + (s.p.z * s.v.x - s.p.x * s.v.z), 0)
    expect(Math.abs(L)).toBeGreaterThan(Math.abs(L0) * 3 + 50)
  })

  it('leaf nodes circle their hub instead of sitting still', () => {
    const sys = createSystem(hubAndLeaves(5))
    warmUp(sys, 300, { ...DEFAULT_PHYSICS, swirl: 0 })
    const hub = sys.stars[0]
    const speeds = sys.stars.slice(1).map((s) => Math.hypot(s.v.x - hub.v.x, s.v.y - hub.v.y, s.v.z - hub.v.z))
    expect(Math.min(...speeds)).toBeGreaterThan(3)
    expect(finite(sys)).toBe(true)
  })

  it('regions gather their members and keep their distance from each other', () => {
    const regionOfNode = (n: { id: string }) => (n.id.startsWith('a') ? 'A' : 'B')
    const data: GraphData = {
      nodes: [...Array.from({ length: 12 }, (_, i) => node(`a${i}`, 1)), ...Array.from({ length: 12 }, (_, i) => node(`b${i}`, 1))],
      edges: [{ source: 'a0', target: 'b0', kind: 'link' }],
    }
    const centre = (g: string) => {
      const m = sys.stars.filter((s) => s.group === g)
      return { x: m.reduce((t, s) => t + s.p.x, 0) / m.length, y: m.reduce((t, s) => t + s.p.y, 0) / m.length, z: m.reduce((t, s) => t + s.p.z, 0) / m.length, m }
    }
    const spread = (g: string) => {
      const c = centre(g)
      return c.m.reduce((t, s) => t + Math.hypot(s.p.x - c.x, s.p.y - c.y, s.p.z - c.z), 0) / c.m.length
    }
    const sys = createSystem(data, undefined, regionOfNode)
    warmUp(sys, 400)
    const together = Math.hypot(centre('A').x - centre('B').x, centre('A').z - centre('B').z)
    const mixed = createSystem(data)
    warmUp(mixed, 400)
    const m = (g: string) => mixed.stars.filter((s) => (s.node.id.startsWith('a') ? 'A' : 'B') === g)
    const avg = (arr: typeof mixed.stars, f: (s: (typeof mixed.stars)[number]) => number) => arr.reduce((t, s) => t + f(s), 0) / arr.length
    const mixedGap = Math.hypot(avg(m('A'), (s) => s.p.x) - avg(m('B'), (s) => s.p.x), avg(m('A'), (s) => s.p.z) - avg(m('B'), (s) => s.p.z))
    expect(together).toBeGreaterThan(mixedGap + 40)
    expect(spread('A')).toBeLessThan(together)
    expect(sys.stars.every((s) => s.group)).toBe(true)
  })

  it('tags join the region most of their neighbours belong to', () => {
    const data: GraphData = {
      nodes: [node('a1', 1), node('a2', 1), node('b1', 1), { id: 'tag:x', label: '#x', kind: 'tag', degree: 3 }],
      edges: [{ source: 'a1', target: 'tag:x', kind: 'tag' }, { source: 'a2', target: 'tag:x', kind: 'tag' }, { source: 'b1', target: 'tag:x', kind: 'tag' }],
    }
    const sys = createSystem(data, undefined, (n) => (n.kind === 'tag' ? null : n.id.startsWith('a') ? 'A' : 'B'))
    expect(sys.stars[3].group).toBe('A')
  })

  it('pinned stars do not move (used while dragging)', () => {
    const sys = createSystem(ring(10))
    sys.stars[3].pinned = true
    const before = { ...sys.stars[3].p }
    for (let i = 0; i < 100; i++) stepSystem(sys, 1 / 60)
    expect(sys.stars[3].p).toEqual(before)
  })

  it('handles an empty graph', () => {
    const sys = createSystem({ nodes: [], edges: [] })
    expect(stepSystem(sys, 1 / 60)).toBe(0)
    expect(fitCamera(sys, DEFAULT_CAMERA, 1.5).dist).toBeGreaterThan(100)
  })
})

describe('camera', () => {
  const W = 900
  const H = 600
  const cam: Camera = { ...DEFAULT_CAMERA, yaw: 0.9, pitch: 0.3, dist: 500 }

  it('projects the target to the screen centre', () => {
    const p = project(basisOf(cam), cam, cam.target, W, H)
    expect(p.visible).toBe(true)
    expect(p.x).toBeCloseTo(W / 2, 3)
    expect(p.y).toBeCloseTo(H / 2, 3)
    expect(p.depth).toBeCloseTo(cam.dist, 3)
  })

  it('unproject inverts project at the same depth', () => {
    const basis = basisOf(cam)
    const world = { x: 80, y: -35, z: 120 }
    const pr = project(basis, cam, world, W, H)
    const back = unproject(basis, cam, pr.x, pr.y, pr.depth, W, H)
    expect(back.x).toBeCloseTo(world.x, 3)
    expect(back.y).toBeCloseTo(world.y, 3)
    expect(back.z).toBeCloseTo(world.z, 3)
  })

  it('things nearer the camera look bigger, and points behind it are not visible', () => {
    const basis = basisOf(cam)
    const near = project(basis, cam, { x: basis.pos.x + basis.forward.x * 100, y: basis.pos.y + basis.forward.y * 100, z: basis.pos.z + basis.forward.z * 100 }, W, H)
    const far = project(basis, cam, cam.target, W, H)
    expect(near.scale).toBeGreaterThan(far.scale)
    const behind = project(basis, cam, { x: basis.pos.x - basis.forward.x * 50, y: basis.pos.y - basis.forward.y * 50, z: basis.pos.z - basis.forward.z * 50 }, W, H)
    expect(behind.visible).toBe(false)
  })

  it('hit test picks the star in front when two overlap', () => {
    const sys = createSystem({ nodes: [node('front', 3), node('back', 3)], edges: [] })
    const basis = basisOf(cam)
    sys.stars[0].p = { x: 0, y: 0, z: 0 }
    sys.stars[1].p = { x: -basis.forward.x * 0 + basis.forward.x * 60, y: basis.forward.y * 60, z: basis.forward.z * 60 }
    const centre = project(basis, cam, sys.stars[0].p, W, H)
    const hit = hitTest(sys, basis, cam, centre.x, centre.y, W, H)
    expect(hit?.star.node.id).toBe('front')
    expect(hitTest(sys, basis, cam, 5, 5, W, H)).toBeNull()
  })

  it('fitCamera frames the whole galaxy', () => {
    const sys = createSystem(ring(30))
    warmUp(sys, 200)
    const fit = fitCamera(sys, DEFAULT_CAMERA, W / H)
    const basis = basisOf(fit)
    const inside = sys.stars.filter((s) => {
      const p = project(basis, fit, s.p, W, H)
      return p.visible && p.x > -20 && p.x < W + 20 && p.y > -20 && p.y < H + 20
    })
    expect(inside.length / sys.stars.length).toBeGreaterThanOrEqual(0.9)
  })
})
