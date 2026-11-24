import { describe, expect, it } from 'vitest'
import type { CloudNode } from '../core/cloudLayout'
import { hash01 } from '../core/hash'
import { SWAY, cloudStats, fitView, lookOf, newPlaced, pick, place, sizeOf, unplace, type Frame } from './cloudGeometry'

function cloud(count: number, spreadX = 300, spreadY = 200): CloudNode[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    node: { id: `n${i}`, label: `N${i}`, kind: 'item', itemType: 'note', degree: i % 4, folder: ['A', 'B', 'C'][i % 3] },
    region: ['A', 'B', 'C'][i % 3],
    x: (hash01(`n${i}`, 1) - 0.3) * spreadX,
    y: (hash01(`n${i}`, 2) - 0.6) * spreadY,
    vx: 0, vy: 0, charge: 1, mass: 1, degree: i % 4, pinned: false,
  }))
}

function screenBox(nodes: CloudNode[], frame: Frame, angle: number, swaying: boolean) {
  const looks = nodes.map(lookOf), s = cloudStats(nodes)
  const view = fitView(nodes, looks, s, frame, swaying)
  const out = newPlaced(nodes.length)
  place(nodes, looks, s, view, angle, swaying ? 1 : 0, 0, false, out)
  return { minX: Math.min(...out.sx), maxX: Math.max(...out.sx), minY: Math.min(...out.sy), maxY: Math.max(...out.sy), view }
}

describe('fitView', () => {
  it('centres the cloud in the frame with a 10 % margin on the tighter side', () => {
    const nodes = cloud(80, 3000, 2000) // big enough that the fit is not capped at its largest scale
    for (const frame of [{ x: 0, y: 0, w: 1150, h: 900 }, { x: 0, y: 57, w: 390, h: 717 }]) {
      const b = screenBox(nodes, frame, 0, false)
      expect((b.minX + b.maxX) / 2).toBeCloseTo(frame.x + frame.w / 2, 6)
      expect((b.minY + b.maxY) / 2).toBeCloseTo(frame.y + frame.h / 2, 6)
      const sx = (b.maxX - b.minX) / frame.w, sy = (b.maxY - b.minY) / frame.h
      expect(Math.max(sx, sy)).toBeCloseTo(0.8, 6)
      expect(Math.min(sx, sy)).toBeLessThanOrEqual(0.8 + 1e-9)
    }
  })

  it('keeps the swaying cloud inside the margins at both ends of the turn', () => {
    const nodes = cloud(120, 3000, 2000)
    const frame = { x: 0, y: 0, w: 1000, h: 800 }
    for (const angle of [-SWAY, 0, SWAY]) {
      const b = screenBox(nodes, frame, angle, true)
      expect(b.minX).toBeGreaterThanOrEqual(frame.w * 0.1 - 1e-6)
      expect(b.maxX).toBeLessThanOrEqual(frame.w * 0.9 + 1e-6)
      expect(b.minY).toBeGreaterThanOrEqual(frame.h * 0.1 - 1e-6)
      expect(b.maxY).toBeLessThanOrEqual(frame.h * 0.9 + 1e-6)
    }
  })
})

describe('projection', () => {
  it('unplace inverts place, sway and depth included', () => {
    const nodes = cloud(40), looks = nodes.map(lookOf), s = cloudStats(nodes)
    const view = { x: 120, y: -40, scale: 1.7 }, angle = 0.3, out = newPlaced(nodes.length)
    place(nodes, looks, s, view, angle, 1, 0, false, out)
    nodes.forEach((n, i) => {
      const back = unplace(out.sx[i], out.sy[i], looks[i], out.f[i], s, view, angle)
      expect(back.x).toBeCloseTo(n.x, 6)
      expect(back.y).toBeCloseTo(n.y, 6)
    })
  })

  it('sizes notes 70 / 25 / 5 % small, medium, large', () => {
    const nodes = cloud(3000).map((n) => ({ ...n, degree: 0 }))
    const radii = nodes.map((n) => lookOf(n).radius)
    const share = (r: number) => radii.filter((x) => x === r).length / radii.length
    expect(share(1.5)).toBeGreaterThan(0.66)
    expect(share(1.5)).toBeLessThan(0.74)
    expect(share(2.6)).toBeGreaterThan(0.21)
    expect(share(2.6)).toBeLessThan(0.29)
    expect(share(4.2)).toBeGreaterThan(0.03)
    expect(share(4.2)).toBeLessThan(0.07)
  })

  it('picks the nearest node within the slop, and nothing farther away', () => {
    const nodes = cloud(30), looks = nodes.map(lookOf), s = cloudStats(nodes), out = newPlaced(nodes.length)
    place(nodes, looks, s, { x: 0, y: 0, scale: 1 }, 0, 0, 0, false, out)
    const r = sizeOf(looks[7], 1, out.f[7])
    expect(pick(looks, out, 1, out.sx[7] + r + 2, out.sy[7], 4)).toBe(7)
    expect(pick(looks, out, 1, -10_000, -10_000, 8)).toBe(-1)
  })
})
