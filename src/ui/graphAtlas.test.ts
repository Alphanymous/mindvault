import { describe, expect, it } from 'vitest'
import type { GraphData, GraphNode } from '../core/types'
import { buildAtlasOrbs, createAtlasScene, fanOut } from './graphAtlas'

const note = (id: string, folder: string, createdAt: number): GraphNode => ({ id, label: id, kind: 'item', itemType: 'note', degree: 0, folder, createdAt })
const data = (nodes: GraphNode[]): GraphData => ({ nodes, edges: [] })
const many = (region: string, n: number, t0 = 0) => Array.from({ length: n }, (_, i) => note(`${region}-${i}`, region, t0 + i))

describe('buildAtlasOrbs', () => {
  it('makes one orb per region, largest first, at most 12 with "Everything else"', () => {
    const nodes = Array.from({ length: 15 }, (_, r) => many(`R${r}`, 20 - r)).flat()
    const orbs = buildAtlasOrbs(data(nodes))
    expect(orbs).toHaveLength(12)
    expect(orbs[0].region).toBe('R0')
    expect(orbs[0].count).toBe(20)
    expect(orbs[11].label).toBe('Everything else')
    expect(orbs[11].count).toBe(nodes.length - orbs.slice(0, 11).reduce((s, o) => s + o.count, 0))
    expect(orbs.reduce((s, o) => s + o.count, 0)).toBe(nodes.length)
    for (let i = 1; i < 11; i++) expect(orbs[i - 1].count).toBeGreaterThanOrEqual(orbs[i].count)
  })

  it('spreads orbs evenly on the ring starting at the top', () => {
    const nodes = ['a', 'b', 'c', 'd'].flatMap((r) => many(r, 3))
    const orbs = buildAtlasOrbs(data(nodes), 300)
    expect(orbs[0].angle).toBeCloseTo(-Math.PI / 2)
    for (let i = 1; i < orbs.length; i++) expect(orbs[i].angle - orbs[i - 1].angle).toBeCloseTo(Math.PI / 2)
    for (const o of orbs) {
      const reach = Math.hypot(o.x, o.y)
      expect(reach).toBeGreaterThanOrEqual(300 * 0.92 - 1e-6)
      expect(reach).toBeLessThanOrEqual(300 * 1.08 + 1e-6)
    }
  })

  it('sizes orbs by note count', () => {
    const orbs = buildAtlasOrbs(data([...many('big', 16), ...many('small', 4)]))
    expect(orbs[0].radius).toBeCloseTo(32)
    expect(orbs[1].radius).toBeCloseTo(12 + 20 * Math.sqrt(4 / 16))
  })

  it('gives a region the same hue the cloud gives it', () => {
    const orbs = buildAtlasOrbs(data([...many('x', 3), ...many('y', 2)]), 300, new Map([['x', 118], ['y', 278]]))
    expect(orbs.find((o) => o.region === 'x')!.hue).toBe(118)
    expect(orbs.find((o) => o.region === 'y')!.hue).toBe(278)
  })

  it('works with a single region and with no notes', () => {
    const one = buildAtlasOrbs(data(many('solo', 3)))
    expect(one).toHaveLength(1)
    expect(one[0].angle).toBeCloseTo(-Math.PI / 2)
    expect(buildAtlasOrbs(data([]))).toEqual([])
    expect(buildAtlasOrbs(data([{ id: 't', label: '#t', kind: 'tag', degree: 1 }]))).toEqual([])
  })
})

describe('fanOut', () => {
  const nodesOf = (list: GraphNode[]) => new Map(list.map((n) => [n.id, n]))

  it('fans out the newest notes first, at most 150', () => {
    const list = many('r', 200)
    const [orb] = buildAtlasOrbs(data(list))
    const fan = fanOut(orb, nodesOf(list))
    expect(fan).toHaveLength(150)
    expect(fan[0].id).toBe('r-199')
    expect(fan[149].id).toBe('r-50')
    expect(fanOut(orb, nodesOf(list), 5).map((f) => f.id)).toEqual(['r-199', 'r-198', 'r-197', 'r-196', 'r-195'])
  })

  it('keeps fanned notes clear of the orb and of each other', () => {
    const list = many('r', 60)
    const [orb] = buildAtlasOrbs(data(list))
    const fan = fanOut(orb, nodesOf(list))
    for (const f of fan) expect(Math.hypot(f.x - orb.x, f.y - orb.y)).toBeGreaterThan(orb.radius)
    for (let i = 0; i < fan.length; i++) for (let j = i + 1; j < fan.length; j++) expect(Math.hypot(fan[i].x - fan[j].x, fan[i].y - fan[j].y)).toBeGreaterThan(4)
  })
})

describe('createAtlasScene (reduced motion: jumps, no animation)', () => {
  const vault = () => data(['a', 'b', 'c'].flatMap((r, i) => many(r, 12 - i * 3)))

  it('picks orbs on the ring and fanned notes after focusing, and goes back', () => {
    const scene = createAtlasScene(vault(), { reducedMotion: true, compact: false })
    scene.resize(1000, 800, 1)
    const orb = scene.positions().find((p) => p.id === 'orb:b')!
    expect(scene.pick(orb.x, orb.y)).toEqual({ kind: 'orb', region: 'b' })
    expect(scene.pick(2, 2)).toBeNull()
    scene.focus('b')
    expect(scene.focused()).toBe('b')
    const fanned = scene.positions().filter((p) => !p.id.startsWith('orb:'))
    expect(fanned).toHaveLength(9)
    expect(scene.pick(fanned[0].x, fanned[0].y)).toEqual({ kind: 'note', id: 'b-8' })
    scene.focus('')
    expect(scene.focused()).toBeNull()
    expect(scene.positions().some((p) => !p.id.startsWith('orb:'))).toBe(false)
  })

  it('focuses the orb of a selected note that is not in view, and keeps the focus when it is', () => {
    const scene = createAtlasScene(vault(), { reducedMotion: true, compact: false })
    scene.resize(1000, 800, 1)
    scene.setSelected('c-2')
    expect(scene.focused()).toBe('c')
    scene.setSelected('c-3')
    expect(scene.focused()).toBe('c')
  })
})
