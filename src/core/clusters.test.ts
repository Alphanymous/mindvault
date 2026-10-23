import { describe, expect, it } from 'vitest'
import { REGION_HUES, UNFILED, buildRegions, hslToRgb, regionOf, regionRgb } from './clusters'
import type { GraphNode } from './types'

const item = (id: string, folder: string): GraphNode => ({ id, label: id, kind: 'item', itemType: 'note', degree: 1, folder })

describe('regions', () => {
  it('uses the top-level folder, Unfiled for none, and nothing for tags or unwritten links', () => {
    expect(regionOf(item('a', 'Dev/Code'))).toBe('Dev')
    expect(regionOf(item('b', ''))).toBe(UNFILED)
    expect(regionOf({ id: 't', label: '#x', kind: 'tag', degree: 1 })).toBeNull()
    expect(regionOf({ id: 'g', label: 'Missing', kind: 'ghost', degree: 1 })).toBeNull()
    expect(regionOf({ id: 'f', label: 'Dev/Code', kind: 'folder', degree: 3 })).toBe('Dev')
  })

  it('counts members, gives each region its own hue and keeps colors stable regardless of node order', () => {
    const nodes = [item('1', 'Work'), item('2', 'Work/Clients'), item('3', 'Life'), item('4', ''), { id: 'f', label: 'Work', kind: 'folder' as const, degree: 2 }]
    const a = buildRegions(nodes)
    const b = buildRegions([...nodes].reverse())
    expect(a).toEqual(b)
    expect(a.map((r) => [r.name, r.count])).toEqual([['Life', 1], ['Unfiled', 1], ['Work', 2]])
    expect(new Set(a.map((r) => r.hue)).size).toBe(3)
    expect(a.every((r) => REGION_HUES.includes(r.hue))).toBe(true)
  })

  it('wraps hues when there are more regions than colors', () => {
    const nodes = Array.from({ length: REGION_HUES.length + 3 }, (_, i) => item(`n${i}`, `Region${String(i).padStart(2, '0')}`))
    expect(buildRegions(nodes)).toHaveLength(REGION_HUES.length + 3)
  })

  it('converts hsl to rgb correctly', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([255, 0, 0])
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 255, 0])
    expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 255])
    expect(hslToRgb(0, 0, 1)).toEqual([255, 255, 255])
    const [r, g, b] = regionRgb(86)
    expect(g).toBeGreaterThan(r)
    expect(g).toBeGreaterThan(b)
  })
})
