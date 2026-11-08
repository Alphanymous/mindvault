/** Visual building blocks for the galaxy graph: palette, sprites, background sky and dust. */
import { hash01, type Star, type V3 } from '../core/galaxy'

export type RGB = [number, number, number]

export interface Palette {
  accent: RGB
  note: RGB
  pdf: RGB
  web: RGB
  prompt: RGB
  file: RGB
  tag: RGB
  folder: RGB
  text: string
}

let colorProbe: CanvasRenderingContext2D | null = null
/** Any CSS color (hsl(), color-mix(), hex…) to RGB, by letting the browser paint one pixel. */
export function toRgb(css: string, fallback: RGB): RGB {
  try {
    colorProbe ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })
    if (!colorProbe) return fallback
    colorProbe.clearRect(0, 0, 1, 1)
    colorProbe.fillStyle = '#000'
    colorProbe.fillStyle = css
    colorProbe.fillRect(0, 0, 1, 1)
    const d = colorProbe.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  } catch {
    return fallback
  }
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  const dark = document.documentElement.getAttribute('data-theme') !== 'light'
  // The galaxy is always drawn on a dark sky. In light mode the item colors are too dark for that, so use the dark-theme star colors.
  const star = (name: string, fb: RGB, darkCss: string): RGB => toRgb(dark ? v(name) : darkCss, fb)
  return {
    accent: toRgb(dark ? v('--accent') : 'hsl(var(--h) 80% 62%)'.replace('var(--h)', v('--h') || '14'), [224, 100, 58]),
    note: star('--c-note', [238, 230, 218], 'hsl(36 30% 90%)'),
    pdf: star('--c-pdf', [255, 130, 80], 'hsl(18 92% 63%)'),
    web: star('--c-web', [130, 190, 245], 'hsl(208 82% 71%)'),
    prompt: star('--c-prompt', [250, 225, 110], 'hsl(48 92% 68%)'),
    file: star('--c-file', [170, 160, 150], 'hsl(30 10% 64%)'),
    tag: star('--c-tag', [150, 140, 130], 'hsl(30 10% 62%)'),
    folder: toRgb(dark ? v('--c-folder') : 'hsl(var(--h) 55% 64%)'.replace('var(--h)', v('--h') || '14'), [220, 140, 110]),
    text: 'rgb(244 238 230)',
  }
}

export function starColor(pal: Palette, s: Star): RGB {
  const n = s.node
  if (n.kind === 'tag') return pal.tag
  if (n.kind === 'folder') return pal.folder
  if (n.kind === 'ghost') return pal.file
  return pal[n.itemType ?? 'note'] ?? pal.note
}

const glowCache = new Map<string, HTMLCanvasElement>()
/** A soft round star: white-hot core fading through the color into nothing. Drawn once, stamped many times. */
export function glowSprite(rgb: RGB, size = 128): HTMLCanvasElement {
  const key = `${rgb.join(',')}:${size}`
  const hit = glowCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const h = size / 2
  const grad = g.createRadialGradient(h, h, 0, h, h, h)
  const [r, gr, b] = rgb
  const mix = (k: number) => `${Math.round(r + (255 - r) * k)},${Math.round(gr + (255 - gr) * k)},${Math.round(b + (255 - b) * k)}`
  grad.addColorStop(0, `rgba(${mix(0.55)},0.95)`)
  grad.addColorStop(0.08, `rgba(${mix(0.3)},0.8)`)
  grad.addColorStop(0.25, `rgba(${r},${gr},${b},0.38)`)
  grad.addColorStop(0.55, `rgba(${r},${gr},${b},0.09)`)
  grad.addColorStop(1, `rgba(${r},${gr},${b},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  glowCache.set(key, c)
  return c
}

const hazeCache = new Map<string, HTMLCanvasElement>()
/** A very soft colored cloud (no hot core) used behind each region. */
export function hazeSprite(rgb: RGB, size = 128): HTMLCanvasElement {
  const key = rgb.join(',')
  const hit = hazeCache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const h = size / 2
  const grad = g.createRadialGradient(h, h, 0, h, h, h)
  grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.2)`)
  grad.addColorStop(0.45, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.08)`)
  grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  hazeCache.set(key, c)
  return c
}

export interface Sky {
  dir: V3
  size: number
  seed: number
  tint: RGB
}

export function makeSky(count: number): Sky[] {
  return Array.from({ length: count }, (_, i) => {
    const u = hash01('sky' + i, 1) * 2 - 1
    const a = hash01('sky' + i, 2) * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    const warm = hash01('sky' + i, 3)
    return {
      dir: { x: r * Math.cos(a), y: u, z: r * Math.sin(a) },
      size: 0.5 + Math.pow(hash01('sky' + i, 4), 3) * 1.6,
      seed: hash01('sky' + i, 5) * 10,
      tint: warm < 0.18 ? [255, 205, 170] : warm > 0.82 ? [180, 210, 255] : [245, 245, 250],
    }
  })
}

export interface Dust {
  r: number
  a0: number
  y: number
  size: number
  alpha: number
}

/** Decorative spiral-arm dust in world space; it orbits the centre with differential rotation. */
export function makeDust(count: number): Dust[] {
  return Array.from({ length: count }, (_, i) => {
    const arm = i % 3
    const r = 30 + 520 * Math.pow(hash01('dust' + i, 1), 0.7)
    const a = r * 0.011 + (arm * Math.PI * 2) / 3 + (hash01('dust' + i, 2) - 0.5) * (0.9 + r * 0.0012)
    return { r, a0: a, y: (hash01('dust' + i, 3) - 0.5) * 22 * (1 + r / 300), size: 0.6 + hash01('dust' + i, 4) * 1.2, alpha: 0.06 + hash01('dust' + i, 5) * 0.2 }
  })
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export interface Fly {
  from: { target: V3; dist: number }
  to: { target: V3; dist: number }
  t0: number
  dur: number
}


// ---- nebula background ----

/** Smooth 2D value noise in [0, 1], seeded and cheap enough to paint one small canvas. */
function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const corner = (cx: number, cy: number) => hash01(`${cx},${cy}`, seed)
  const s = (t: number) => t * t * (3 - 2 * t)
  const top = corner(xi, yi) + (corner(xi + 1, yi) - corner(xi, yi)) * s(xf)
  const bottom = corner(xi, yi + 1) + (corner(xi + 1, yi + 1) - corner(xi, yi + 1)) * s(xf)
  return top + (bottom - top) * s(yf)
}

function fbm(x: number, y: number, seed: number): number {
  let sum = 0
  let amp = 0.5
  let f = 1
  for (let o = 0; o < 4; o++) {
    sum += valueNoise(x * f, y * f, seed + o) * amp
    f *= 2.03
    amp *= 0.5
  }
  return sum
}

const NEBULA_RES = 96
let nebulaCache: { key: string; canvas: HTMLCanvasElement } | null = null

/**
 * Faint gas clouds behind the stars, in two cool tones and the accent. Painted once at low resolution and
 * scaled up, so the browser's smoothing turns the pixels into soft clouds for free.
 */
export function nebula(accent: RGB): HTMLCanvasElement {
  const key = accent.join(',')
  if (nebulaCache?.key === key) return nebulaCache.canvas
  const c = document.createElement('canvas')
  c.width = c.height = NEBULA_RES
  const g = c.getContext('2d')!
  const img = g.createImageData(NEBULA_RES, NEBULA_RES)
  const tones: RGB[] = [[40, 120, 170], [90, 60, 170], accent]
  for (let y = 0; y < NEBULA_RES; y++) {
    for (let x = 0; x < NEBULA_RES; x++) {
      const u = x / NEBULA_RES
      const v = y / NEBULA_RES
      // fade towards the edges so the scaled image never shows a border
      const edge = Math.min(u, v, 1 - u, 1 - v) * 4
      const vignette = Math.min(1, edge)
      let r = 0
      let gg = 0
      let b = 0
      let a = 0
      tones.forEach((tone, t) => {
        const n = fbm(u * 3.2 + t * 7.1, v * 3.2 - t * 3.7, 11 + t * 5)
        const k = Math.max(0, n - 0.47) * 2.4 * vignette
        r += tone[0] * k
        gg += tone[1] * k
        b += tone[2] * k
        a += k
      })
      const i = (y * NEBULA_RES + x) * 4
      const m = a > 0 ? 1 / a : 0
      img.data[i] = r * m
      img.data[i + 1] = gg * m
      img.data[i + 2] = b * m
      img.data[i + 3] = Math.min(255, a * 70)
    }
  }
  g.putImageData(img, 0, 0)
  nebulaCache = { key, canvas: c }
  return c
}

// ---- bloom ----

const BLOOM_SCALE = 0.25

/**
 * Soft glow around everything bright: shrink the frame drawn so far to a quarter, then lay it back over itself,
 * enlarged and added. Shrinking and enlarging blurs it; adding makes bright spots bleed light.
 */
export function bloom(g: CanvasRenderingContext2D, source: HTMLCanvasElement, scratch: HTMLCanvasElement, w: number, h: number, strength: number) {
  const sw = Math.max(2, Math.round(w * BLOOM_SCALE))
  const sh = Math.max(2, Math.round(h * BLOOM_SCALE))
  if (scratch.width !== sw || scratch.height !== sh) {
    scratch.width = sw
    scratch.height = sh
  }
  const s = scratch.getContext('2d')!
  s.globalCompositeOperation = 'copy'
  s.imageSmoothingEnabled = true
  s.imageSmoothingQuality = 'low'
  s.drawImage(source, 0, 0, sw, sh)
  g.save()
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.globalCompositeOperation = 'lighter'
  g.globalAlpha = strength
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.drawImage(scratch, 0, 0, source.width, source.height)
  g.restore()
}

// ---- bonds and labels ----

/** Control point for a gently curved bond: bends sideways by a share of its length, direction from its seed. */
export function bendPoint(ax: number, ay: number, bx: number, by: number, seed: number): { x: number; y: number } {
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  const dx = bx - ax
  const dy = by - ay
  const bend = (seed < 0.5 ? -1 : 1) * (0.08 + seed * 0.06)
  return { x: mx - dy * bend, y: my + dx * bend }
}

/** Label on a small dark pill with a hairline in the star's color, readable over any part of the sky. */
export function drawLabelPill(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, tint: RGB, strong: boolean) {
  g.font = `${strong ? 650 : 520} ${size}px Inter, system-ui, sans-serif`
  const tw = g.measureText(text).width
  const padX = size * 0.62
  const height = size + size * 0.62
  const left = x - tw / 2 - padX
  g.fillStyle = strong ? 'rgba(6,10,16,0.86)' : 'rgba(6,10,16,0.66)'
  g.strokeStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${strong ? 0.75 : 0.32})`
  g.lineWidth = 1
  g.beginPath()
  g.roundRect(left, y, tw + padX * 2, height, height / 2)
  g.fill()
  g.stroke()
  g.fillStyle = strong ? 'rgba(248,250,252,1)' : 'rgba(226,232,240,0.92)'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, x, y + height / 2 + 0.5)
  return { x0: left, x1: left + tw + padX * 2, y0: y, y1: y + height }
}

// ---- selection ripple ----

const RIPPLE_REACH = 98

/**
 * Two rings spread out from a newly selected star, and its connections flash as the wave passes them.
 * `age` runs from 0 to 1 over the ripple's life.
 */
export function drawRipple(g: CanvasRenderingContext2D, at: { x: number; y: number }, col: RGB, age: number, neighbours: { x: number; y: number; halo: number; col: RGB }[]) {
  const ease = 1 - Math.pow(1 - age, 3)
  g.globalCompositeOperation = 'lighter'
  for (const [delay, reach] of [[0, 1], [0.18, 0.7]] as const) {
    const t = Math.min(1, Math.max(0, (age - delay) / (1 - delay)))
    if (t <= 0) continue
    const e = 1 - Math.pow(1 - t, 3)
    g.globalAlpha = (1 - t) * 0.85
    g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},1)`
    g.lineWidth = 2 * (1 - t) + 0.5
    g.beginPath()
    g.arc(at.x, at.y, 8 + e * (RIPPLE_REACH - 8) * reach, 0, Math.PI * 2)
    g.stroke()
  }
  for (const n of neighbours) {
    const reached = Math.hypot(n.x - at.x, n.y - at.y) / RIPPLE_REACH
    const k = Math.min(1, Math.max(0, 1 - Math.abs(ease - reached) * 3))
    if (k <= 0) continue
    g.globalAlpha = k * 0.9
    g.drawImage(glowSprite(n.col), n.x - n.halo, n.y - n.halo, n.halo * 2, n.halo * 2)
  }
  g.globalAlpha = 1
}
