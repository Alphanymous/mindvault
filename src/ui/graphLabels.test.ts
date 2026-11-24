import { describe, expect, it } from 'vitest'
import { placeLabels, type LabelRequest } from './graphLabels'

const measure = (text: string, size: number) => text.length * size * 0.6
const big = { w: 4000, h: 4000 }
let n = 0
const req = (o: Partial<LabelRequest> = {}): LabelRequest => ({
  id: `l${n++}`, text: 'label', x: 100, y: 100, dotRadius: 4, priority: 1, size: 10, kind: 'note', ...o,
})
const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
}

describe('placeLabels', () => {
  it('never returns two overlapping labels', () => {
    const r = rng(7)
    const reqs = Array.from({ length: 200 }, () =>
      req({ x: r() * 400, y: r() * 300, priority: r(), text: 'note ' + Math.floor(r() * 1000) }))
    const out = placeLabels(reqs, measure, { w: 400, h: 300 }, [])
    expect(out.length).toBeGreaterThan(0)
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) expect(hit(out[i].box, out[j].box)).toBe(false)
  })

  it('places higher priority first and skips what no longer fits', () => {
    const low = req({ id: 'low', priority: 1 })
    const high = req({ id: 'high', priority: 5 })
    const out = placeLabels([low, high], measure, big, [])
    expect(out.map((p) => p.id)).toEqual(['high'])
  })

  it('flips a label to the left of its dot near the right edge', () => {
    const [p] = placeLabels([req({ x: 190, y: 50 })], measure, { w: 200, h: 100 }, [])
    expect(p.side).toBe('left')
    expect(p.box.x + p.box.w).toBeLessThan(190)
    const [q] = placeLabels([req({ x: 20, y: 50 })], measure, { w: 200, h: 100 }, [])
    expect(q.side).toBe('right')
    expect(q.box.x).toBeGreaterThan(20)
  })

  it('skips labels that would cover an obstacle (a panel)', () => {
    const out = placeLabels([req({ x: 100, y: 100 })], measure, big, [{ x: 90, y: 80, w: 200, h: 50 }])
    expect(out).toEqual([])
  })

  it('truncates long text with an ellipsis at maxChars', () => {
    const [p] = placeLabels([req({ text: 'x'.repeat(80) })], measure, big, [])
    expect(p.text).toHaveLength(44)
    expect(p.text.endsWith('…')).toBe(true)
  })

  it('keeps every placed box inside the bounds', () => {
    const r = rng(3)
    const reqs = Array.from({ length: 100 }, () =>
      req({ x: r() * 420 - 10, y: r() * 320 - 10, priority: r() }))
    const out = placeLabels(reqs, measure, { w: 400, h: 300 }, [])
    for (const p of out) {
      expect(p.box.x).toBeGreaterThanOrEqual(0)
      expect(p.box.y).toBeGreaterThanOrEqual(0)
      expect(p.box.x + p.box.w).toBeLessThanOrEqual(400)
      expect(p.box.y + p.box.h).toBeLessThanOrEqual(300)
    }
  })
})
