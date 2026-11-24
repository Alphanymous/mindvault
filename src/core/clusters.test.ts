import { describe, expect, it } from 'vitest'
import { MIN_HUE_GAP, REGION_HUES, UNFILED, buildRegions, hslToRgb, regionHue, regionHues, regionOf, regionRgb } from './clusters'
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

  it('counts members, gives each region a palette hue and keeps colors stable regardless of node order', () => {
    const nodes = [item('1', 'Work'), item('2', 'Work/Clients'), item('3', 'Life'), item('4', ''), { id: 'f', label: 'Work', kind: 'folder' as const, degree: 2 }]
    const a = buildRegions(nodes)
    const b = buildRegions([...nodes].reverse())
    expect(a).toEqual(b)
    expect(a.map((r) => [r.name, r.count])).toEqual([['Life', 1], ['Unfiled', 1], ['Work', 2]])
    expect(a.every((r) => REGION_HUES.includes(r.hue))).toBe(true)
  })

  it('gives regions shown together clearly different hues', () => {
    const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
    for (const names of [['Research', 'Projects', 'Journal', 'Reading', 'Ideas'], ['Work', 'Personal', 'Archive', 'Recipes', 'Travel'], ['Dev', 'Music', 'Health', 'Money', UNFILED]]) {
      const hues = [...regionHues(names).values()]
      for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++) expect(gap(hues[i], hues[j])).toBeGreaterThanOrEqual(MIN_HUE_GAP)
    }
    // and buildRegions (graph, Atlas, Clusters) uses exactly these hues
    const regions = buildRegions(['Research', 'Projects', 'Journal', 'Reading', 'Ideas'].map((f) => item(f, f)))
    const hues = regionHues(regions.map((r) => r.name))
    expect(regions.every((r) => r.hue === hues.get(r.name))).toBe(true)
  })

  it('keeps existing hues when a folder that collides with none of them is added', () => {
    const base = ['Research', 'Projects', 'Journal', 'Reading', 'Ideas']
    const before = regionHues(base)
    const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))
    // a newcomer whose own hue is clear of every hue in use
    const newcomer = ['Archive', 'Recipes', 'Travel', 'Music', 'Health', 'Money', 'Work', 'Clients', 'Garden', 'Books']
      .find((n) => [...before.values()].every((h) => gap(h, regionHue(n)) >= MIN_HUE_GAP))!
    expect(newcomer).toBeDefined()
    const after = regionHues([...base, newcomer])
    for (const name of base) expect(after.get(name)).toBe(before.get(name))
    expect(after.get(newcomer)).toBe(regionHue(newcomer))
  })

  it('assigns hues deterministically, whatever order the names come in', () => {
    const names = ['Research', 'Projects', 'Journal', 'Reading', 'Ideas', 'Work', 'Archive']
    const a = regionHues(names), b = regionHues([...names].reverse())
    expect([...a].sort()).toEqual([...b].sort())
    expect(regionHues(names)).toEqual(a)
    expect([...a.values()].every((h) => REGION_HUES.includes(h))).toBe(true)
  })

  it('derives hues from the palette, deterministically', () => {
    expect(REGION_HUES).toContain(regionHue('Projects'))
    expect(regionHue('Projects')).toBe(regionHue('Projects'))
  })

  it('keeps Unfiled on a fixed muted hue', () => {
    expect(regionHue(UNFILED)).toBe(214)
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
