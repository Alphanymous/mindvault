/** Regions of the graph: every top-level folder is a region with its own colour. */
import { hash01 } from './hash'
import type { GraphNode } from './types'

/**
 * Region hues (degrees) in Mindvault's green / blue / violet / red family, in order round the colour wheel and
 * 32 degrees apart (skipping orange and yellow), so up to 9 regions shown together all differ clearly.
 */
export const REGION_HUES = [118, 150, 182, 214, 246, 278, 310, 342, 14]
/** Hues of regions shown together are never closer than this. */
export const MIN_HUE_GAP = 25

export const UNFILED = 'Unfiled'

/** Region of a node: first folder segment for notes and folders; null for tags and unwritten links. */
export function regionOf(node: GraphNode): string | null {
  if (node.kind === 'tag' || node.kind === 'ghost') return null
  return regionOfFolder(node.kind === 'folder' ? node.label : (node.folder ?? ''))
}

/** Region of a folder path: its first segment, or Unfiled. */
export function regionOfFolder(folder: string): string {
  return folder.split('/')[0].trim() || UNFILED
}

export interface Region {
  name: string
  hue: number
  count: number
  /** CSS color for legends. */
  css: string
}

/** The hue a region asks for, from its name alone. Unfiled asks for a fixed muted blue. */
export function regionHue(name: string): number {
  if (name === UNFILED) return 214
  return REGION_HUES[Math.floor(hash01(name, 7) * REGION_HUES.length)]
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

/**
 * Hues for regions shown together. Each region starts from the hue its name asks for; if a region placed earlier
 * already holds it (or sits within MIN_HUE_GAP), it probes onward round the palette to the next free hue. Regions
 * are placed in name-hash order, Unfiled first, so a new folder whose hue is free moves no other region, and one
 * that takes a hue moves only the regions that would have probed to it; the order names come in never matters.
 * Beyond 9 regions hues repeat.
 */
export function regionHues(names: Iterable<string>): Map<string, number> {
  const order = [...new Set(names)].sort((a, b) => (a === UNFILED ? -1 : b === UNFILED ? 1 : hash01(a, 11) - hash01(b, 11) || (a < b ? -1 : 1)))
  const out = new Map<string, number>()
  const n = REGION_HUES.length
  for (const name of order) {
    const start = REGION_HUES.indexOf(regionHue(name))
    let hue = REGION_HUES[start]
    for (let k = 0; k < n; k++) {
      const h = REGION_HUES[(start + k) % n]
      if ([...out.values()].every((taken) => hueGap(taken, h) >= MIN_HUE_GAP)) {
        hue = h
        break
      }
    }
    out.set(name, hue)
  }
  return out
}

/** Regions sorted by name; colours from regionHues over all of them, so the graph, Atlas and Clusters agree. */
export function buildRegions(nodes: GraphNode[]): Region[] {
  const counts = new Map<string, number>()
  for (const n of nodes) {
    const r = regionOf(n)
    if (r && n.kind !== 'folder') counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  const hues = regionHues(counts.keys())
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => {
      const hue = hues.get(name)!
      return { name, hue, count, css: `hsl(${hue} 88% 62%)` }
    })
}

/** hsl -> rgb (0..255) for canvas sprites. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

export function regionRgb(hue: number): [number, number, number] {
  return hslToRgb(hue, 0.9, 0.62)
}
