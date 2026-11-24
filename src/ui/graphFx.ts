/** Visual building blocks for the graph cloud: palette, sprites, backdrop, dust, item shapes, label pills, ripple. */
import { hash01 } from '../core/hash'
import type { GraphNode } from '../core/types'
import { pillHeight, pillPadX } from './graphLabels'

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
  // The graph is always drawn on a dark sky. In light mode the item colors are too dark for that, so use the dark-theme colors.
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

/** Colour of a node that has no region (tags, unwritten links), or of an item by its kind. */
export function kindColor(pal: Palette, n: GraphNode): RGB {
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
  grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.3)`)
  grad.addColorStop(0.5, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.12)`)
  grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  hazeCache.set(key, c)
  return c
}

export interface Sky {
  /** Position as a share of the canvas, 0..1. */
  x: number
  y: number
  size: number
  tint: RGB
  alpha: number
}

/** Distant background stars, fixed on the canvas. */
export function makeSky(count: number): Sky[] {
  return Array.from({ length: count }, (_, i) => {
    const warm = hash01('sky' + i, 3)
    return {
      x: hash01('sky' + i, 1),
      y: hash01('sky' + i, 2),
      size: 0.5 + Math.pow(hash01('sky' + i, 4), 3) * 1.4,
      tint: warm < 0.18 ? [255, 205, 170] : warm > 0.82 ? [180, 210, 255] : [235, 240, 250],
      alpha: 0.1 + hash01('sky' + i, 5) * 0.3,
    }
  })
}

export interface Dust {
  /** Angle and distance from the cloud centre, in cloud radii, and a depth for the sway (like a node's). */
  angle: number
  r: number
  zr: number
  size: number
  alpha: number
}

/** Faint specks around the cloud; they sway with it, which gives the scene depth. */
export function makeDust(count: number): Dust[] {
  return Array.from({ length: count }, (_, i) => ({
    angle: hash01('dust' + i, 1) * Math.PI * 2,
    r: 0.3 + 2.1 * Math.pow(hash01('dust' + i, 2), 0.8),
    zr: hash01('dust' + i, 3) * 2 - 1,
    size: 0.6 + hash01('dust' + i, 4) * 1.1,
    alpha: 0.04 + hash01('dust' + i, 5) * 0.14,
  }))
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/**
 * The quiet backdrop behind the cloud, painted once per size and theme: near-black, a soft glow in the middle,
 * faint gas clouds and distant stars. The graph is always drawn on a dark sky, in both themes.
 */
export function paintBackdrop(w: number, h: number, dpr: number, pal: Palette, sky: Sky[], compact: boolean): HTMLCanvasElement {
  const bg = document.createElement('canvas')
  bg.width = Math.max(2, Math.round(w * dpr))
  bg.height = Math.max(2, Math.round(h * dpr))
  const g = bg.getContext('2d')!
  g.scale(dpr, dpr)
  const [ar, ag, ab] = pal.accent
  const base = g.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75)
  base.addColorStop(0, `rgb(${Math.round(ar * 0.03 + 8)},${Math.round(ag * 0.03 + 11)},${Math.round(ab * 0.03 + 15)})`)
  base.addColorStop(0.6, 'rgb(5,7,11)')
  base.addColorStop(1, 'rgb(2,3,6)')
  g.fillStyle = base
  g.fillRect(0, 0, w, h)
  const glow = g.createRadialGradient(w * 0.5, h * 0.52, 0, w * 0.5, h * 0.52, Math.max(w, h) * 0.55)
  glow.addColorStop(0, 'rgba(18,52,64,0.42)')
  glow.addColorStop(1, 'rgba(18,52,64,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, w, h)
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = 'high'
  g.globalAlpha = compact ? 0.18 : 0.26
  g.drawImage(nebula(pal.accent), 0, 0, w, h)
  for (const s of sky) {
    g.globalAlpha = s.alpha
    g.fillStyle = `rgb(${s.tint[0]},${s.tint[1]},${s.tint[2]})`
    g.fillRect(s.x * w, s.y * h, s.size, s.size)
  }
  g.globalAlpha = 1
  return bg
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
function nebula(accent: RGB): HTMLCanvasElement {
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

// ---- labels ----

/** Label on a small dark pill with a hairline in the star's color, readable over any part of the sky. */
export function drawLabelPill(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, tint: RGB, strong: boolean) {
  g.font = pillFont(size, strong)
  const tw = g.measureText(text).width
  const padX = pillPadX(size)
  const height = pillHeight(size)
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

/** Font of a label pill; label placement measures with the same font so its boxes match the drawn pills. */
export const pillFont = (size: number, strong: boolean) => `${strong ? 650 : 520} ${size}px Inter, system-ui, sans-serif`
export const regionFont = (size: number) => `700 ${size}px Inter, system-ui, sans-serif`

/** A region's name: bold capitals in its colour with a dark outline, centred on (x, y). */
export function drawRegionName(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, tint: RGB) {
  g.font = regionFont(size)
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = 3
  g.strokeStyle = 'rgba(3,5,10,0.85)'
  g.strokeText(text, x, y)
  g.fillStyle = `rgb(${Math.round(tint[0] + (255 - tint[0]) * 0.25)},${Math.round(tint[1] + (255 - tint[1]) * 0.25)},${Math.round(tint[2] + (255 - tint[2]) * 0.25)})`
  g.fillText(text, x, y)
}

/** Item kinds by shape: dot note, ring web page, double ring PDF, cross prompt, square file. */
export function drawItemShape(g: CanvasRenderingContext2D, type: GraphNode['itemType'], x: number, y: number, r: number, solid: string) {
  if (type === 'web' || type === 'pdf') {
    g.lineWidth = Math.max(1, r * 0.38)
    g.strokeStyle = solid
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.stroke()
    if (type === 'pdf') {
      g.lineWidth = Math.max(0.8, r * 0.22)
      g.beginPath()
      g.arc(x, y, r * 1.75, 0, Math.PI * 2)
      g.stroke()
    }
    return
  }
  if (type === 'file') {
    g.fillStyle = solid
    g.fillRect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7)
    return
  }
  if (type === 'prompt') {
    g.lineWidth = Math.max(1, r * 0.42)
    g.strokeStyle = solid
    g.beginPath()
    g.moveTo(x - r * 1.5, y)
    g.lineTo(x + r * 1.5, y)
    g.moveTo(x, y - r * 1.5)
    g.lineTo(x, y + r * 1.5)
    g.stroke()
    return
  }
  g.fillStyle = solid
  g.beginPath()
  g.arc(x, y, r, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = 'rgba(255,252,248,0.95)'
  g.beginPath()
  g.arc(x, y, Math.max(0.6, r * 0.42), 0, Math.PI * 2)
  g.fill()
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
