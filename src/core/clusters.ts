/** Regions of the galaxy: every top-level folder is a region with its own neon color. */
import { hash01 } from './hash'
import type { GraphNode } from './types'

/** Curated hues (degrees) from the app colors: blues, greens and a few reds. Neighbouring regions differ clearly. */
export const REGION_HUES = [214, 150, 352, 192, 128, 232, 8, 170, 200, 140, 340, 222]

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

/** A region's hue depends only on its name, so it never shifts when folders are added or the graph is filtered. Unfiled is a fixed muted blue. */
export function regionHue(name: string): number {
  if (name === UNFILED) return 214
  return REGION_HUES[Math.floor(hash01(name, 7) * REGION_HUES.length)]
}

/** Regions sorted by name; each colour comes from its name alone. */
export function buildRegions(nodes: GraphNode[]): Region[] {
  const counts = new Map<string, number>()
  for (const n of nodes) {
    const r = regionOf(n)
    if (r && n.kind !== 'folder') counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => {
      const hue = regionHue(name)
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
