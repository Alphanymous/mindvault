import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import {
  DEFAULT_CAMERA,
  DEFAULT_PHYSICS,
  basisOf,
  clamp,
  createSystem,
  fitCamera,
  focalLength,
  hash01,
  hitTest,
  project,
  stepSystem,
  unproject,
  warmUp,
  type Camera,
  type Projected,
  type Star,
  type System,
  type V3,
} from '../core/galaxy'
import { buildRegions, regionOf, regionRgb, type Region } from '../core/clusters'
import type { GraphData, GraphNode } from '../core/types'

export interface GraphHandle {
  zoomBy(factor: number): void
  fit(): void
  focusSelected(): void
  /** Turn the slow galactic rotation of the camera on or off; returns the new state. */
  toggleSpin(): boolean
  /** Fly the camera to a region (top-level folder). */
  focusRegion(name: string): void
}

/** Small previews of a big graph sit closer: the outer stars may leave the frame, the core fills it. */
const compactZoom = (stars: number) => (stars > 25 ? 0.62 : 1)

interface Props {
  data: GraphData
  selectedId: string | null
  onSelect(id: string | null): void
  onOpen(node: GraphNode): void
  compact?: boolean
}

type RGB = [number, number, number]

interface Palette {
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
function toRgb(css: string, fallback: RGB): RGB {
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

function readPalette(): Palette {
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

function starColor(pal: Palette, s: Star): RGB {
  const n = s.node
  if (n.kind === 'tag') return pal.tag
  if (n.kind === 'folder') return pal.folder
  if (n.kind === 'ghost') return pal.file
  return pal[n.itemType ?? 'note'] ?? pal.note
}

const glowCache = new Map<string, HTMLCanvasElement>()
/** A soft round star: white-hot core fading through the color into nothing. Drawn once, stamped many times. */
function glowSprite(rgb: RGB, size = 128): HTMLCanvasElement {
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
function hazeSprite(rgb: RGB, size = 128): HTMLCanvasElement {
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

interface Sky {
  dir: V3
  size: number
  seed: number
  tint: RGB
}

function makeSky(count: number): Sky[] {
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

interface Dust {
  r: number
  a0: number
  y: number
  size: number
  alpha: number
}

/** Decorative spiral-arm dust in world space; it orbits the centre with differential rotation. */
function makeDust(count: number): Dust[] {
  return Array.from({ length: count }, (_, i) => {
    const arm = i % 3
    const r = 30 + 520 * Math.pow(hash01('dust' + i, 1), 0.7)
    const a = r * 0.011 + (arm * Math.PI * 2) / 3 + (hash01('dust' + i, 2) - 0.5) * (0.9 + r * 0.0012)
    return { r, a0: a, y: (hash01('dust' + i, 3) - 0.5) * 22 * (1 + r / 300), size: 0.6 + hash01('dust' + i, 4) * 1.2, alpha: 0.06 + hash01('dust' + i, 5) * 0.2 }
  })
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

interface Fly {
  from: { target: V3; dist: number }
  to: { target: V3; dist: number }
  t0: number
  dur: number
}

export const GraphCanvas = forwardRef<GraphHandle, Props>(function GraphCanvas({ data, selectedId, onSelect, onOpen, compact }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sysRef = useRef<System>(createSystem({ nodes: [], edges: [] }))
  const camRef = useRef<Camera>({ ...DEFAULT_CAMERA })
  const sizeRef = useRef({ w: 300, h: 300, dpr: 1 })
  const paletteRef = useRef<Palette | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const skyRef = useRef<Sky[]>(makeSky(compact ? 70 : 420))
  const dustRef = useRef<Dust[]>(makeDust(compact ? 140 : 720))
  const hoverRef = useRef<number>(-1)
  const regionsRef = useRef<Region[]>([])
  const regionColors = useRef(new Map<string, RGB>())
  const selectedRef = useRef<number>(-1)
  const followRef = useRef<number>(-1)
  const flyRef = useRef<Fly | null>(null)
  const spinRef = useRef(true)
  const idleSince = useRef(performance.now())
  const motion = useRef({ yawV: 0, pitchV: 0 })
  const lowQuality = useRef(false)
  const propsRef = useRef({ onSelect, onOpen, compact: !!compact })
  propsRef.current = { onSelect, onOpen, compact: !!compact }
  const introRef = useRef<{ t0: number; from: number } | null>(null)
  const calm = useRef(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

  const touch = useCallback(() => {
    idleSince.current = performance.now()
  }, [])

  const flyTo = useCallback((target: V3, dist: number, dur = 750) => {
    const cam = camRef.current
    flyRef.current = { from: { target: { ...cam.target }, dist: cam.dist }, to: { target: { ...target }, dist }, t0: performance.now(), dur }
  }, [])

  const fitView = useCallback(
    (animate = true) => {
      const { w, h } = sizeRef.current
      followRef.current = -1
      const fit = fitCamera(sysRef.current, camRef.current, w / h)
      if (propsRef.current.compact) fit.dist *= compactZoom(sysRef.current.stars.length)
      if (animate) flyTo(fit.target, fit.dist, 900)
      else camRef.current = { ...camRef.current, target: fit.target, dist: fit.dist }
    },
    [flyTo],
  )

  useImperativeHandle(ref, () => ({
    zoomBy: (f) => {
      touch()
      flyRef.current = null
      camRef.current = { ...camRef.current, dist: clamp(camRef.current.dist / f, 60, 3600) }
    },
    fit: () => fitView(true),
    focusSelected: () => {
      const s = sysRef.current.stars[selectedRef.current]
      if (s) {
        followRef.current = s.index
        flyTo(s.p, Math.min(camRef.current.dist, 300))
      }
    },
    toggleSpin: () => {
      spinRef.current = !spinRef.current
      return spinRef.current
    },
    focusRegion: (name) => {
      const members = sysRef.current.stars.filter((st) => st.node.kind === 'item' && regionOf(st.node) === name)
      if (!members.length) return
      const c = members.reduce((acc, st) => ({ x: acc.x + st.p.x / members.length, y: acc.y + st.p.y / members.length, z: acc.z + st.p.z / members.length }), { x: 0, y: 0, z: 0 })
      const spread = Math.max(...members.map((st) => Math.hypot(st.p.x - c.x, st.p.y - c.y, st.p.z - c.z)))
      followRef.current = -1
      flyTo(c, clamp(spread * 3.2 + 120, 160, 900))
    },
  }))

  // (Re)build the system when the data changes, keeping every surviving star where it was.
  useEffect(() => {
    regionsRef.current = buildRegions(data.nodes)
    regionColors.current = new Map(regionsRef.current.map((r) => [r.name, regionRgb(r.hue)]))
    const first = sysRef.current.stars.length === 0
    const sys = createSystem(data, sysRef.current, regionOf)
    if (first) warmUp(sys, 260)
    sysRef.current = sys
    const sel = selectedId ? (sys.index.get(selectedId) ?? -1) : -1
    selectedRef.current = sel
    if (first && sys.stars.length) {
      fitView(false)
      introRef.current = { t0: performance.now(), from: camRef.current.dist * 2.1 }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Selecting something (here or from outside) swoops the camera to it and keeps it in view.
  useEffect(() => {
    const idx = selectedId ? (sysRef.current.index.get(selectedId) ?? -1) : -1
    selectedRef.current = idx
    if (idx >= 0) {
      const s = sysRef.current.stars[idx]
      followRef.current = idx
      flyTo(s.p, clamp(camRef.current.dist, 160, propsRef.current.compact ? 420 : 380))
    } else {
      followRef.current = -1
    }
  }, [selectedId, flyTo])

  // Canvas size, background, palette, and the render loop.
  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let last = performance.now()
    let acc = 0
    let visible = true
    let alive = true
    const quality = { frame: 16 }

    const paintBackground = () => {
      const { w, h } = sizeRef.current
      const pal = (paletteRef.current ??= readPalette())
      const pad = 160
      const bg = document.createElement('canvas')
      bg.width = Math.max(2, Math.round(w) + pad)
      bg.height = Math.max(2, Math.round(h) + pad)
      const g = bg.getContext('2d')!
      const [ar, ag, ab] = pal.accent
      const base = g.createRadialGradient(bg.width * 0.5, bg.height * 0.46, 0, bg.width * 0.5, bg.height * 0.5, Math.max(bg.width, bg.height) * 0.75)
      base.addColorStop(0, `rgb(${Math.round(ar * 0.04 + 9)},${Math.round(ag * 0.04 + 12)},${Math.round(ab * 0.04 + 16)})`)
      base.addColorStop(0.6, 'rgb(5,8,11)')
      base.addColorStop(1, 'rgb(2,4,6)')
      g.fillStyle = base
      g.fillRect(0, 0, bg.width, bg.height)
      // soft dust clouds, tinted by the palette and a cool counterpoint
      const clouds: [number, number, number, RGB, number][] = [
        [0.3, 0.38, 0.5, [60, 110, 140], 0.07],
        [0.72, 0.6, 0.55, pal.accent, 0.04],
      ]
      for (const [fx, fy, fr, col, a] of clouds) {
        const cg = g.createRadialGradient(bg.width * fx, bg.height * fy, 0, bg.width * fx, bg.height * fy, Math.max(bg.width, bg.height) * fr)
        cg.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`)
        cg.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`)
        g.fillStyle = cg
        g.fillRect(0, 0, bg.width, bg.height)
      }
      bgRef.current = bg
    }

    const resize = () => {
      const r = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      sizeRef.current = { w: Math.max(40, r.width), h: Math.max(40, r.height), dpr }
      canvas.width = Math.round(sizeRef.current.w * dpr)
      canvas.height = Math.round(sizeRef.current.h * dpr)
      paintBackground()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    const mo = new MutationObserver(() => {
      paletteRef.current = readPalette()
      paintBackground()
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] })
    paletteRef.current = readPalette()
    paintBackground()
    const io = new IntersectionObserver((e) => (visible = e.some((x) => x.isIntersecting)))
    io.observe(wrap)

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (!alive || !visible || document.visibilityState === 'hidden') {
        last = now
        return
      }
      const compactMode = propsRef.current.compact
      if (compactMode && now - last < 30) return // the little graph is drawn at ~30 fps
      const started = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const sys = sysRef.current
      const cam = camRef.current

      // physics in fixed steps
      acc += dt
      let steps = 0
      while (acc >= 1 / 60 && steps < 3) {
        stepSystem(sys, 1 / 60, calm.current ? { ...DEFAULT_PHYSICS, swirl: 0.25, orbit: 0.3 } : DEFAULT_PHYSICS)
        acc -= 1 / 60
        steps++
      }
      if (steps === 3) acc = 0

      // camera: fly-to, follow, inertia, idle spin, intro
      if (introRef.current) {
        const t = Math.min(1, (now - introRef.current.t0) / 1800)
        const target = flyRef.current ? flyRef.current.to.dist : fitCamera(sys, cam, sizeRef.current.w / sizeRef.current.h).dist * (propsRef.current.compact ? compactZoom(sys.stars.length) : 1)
        if (!flyRef.current) cam.dist = introRef.current.from + (target - introRef.current.from) * easeInOut(t)
        if (t >= 1 || flyRef.current) introRef.current = null
      }
      const fly = flyRef.current
      if (fly) {
        const t = Math.min(1, (now - fly.t0) / fly.dur)
        const e = easeInOut(t)
        cam.target = { x: fly.from.target.x + (fly.to.target.x - fly.from.target.x) * e, y: fly.from.target.y + (fly.to.target.y - fly.from.target.y) * e, z: fly.from.target.z + (fly.to.target.z - fly.from.target.z) * e }
        cam.dist = fly.from.dist + (fly.to.dist - fly.from.dist) * e
        if (t >= 1) flyRef.current = null
      } else if (followRef.current >= 0 && sys.stars[followRef.current]) {
        const p = sys.stars[followRef.current].p
        const k = 1 - Math.pow(0.001, dt)
        cam.target = { x: cam.target.x + (p.x - cam.target.x) * k, y: cam.target.y + (p.y - cam.target.y) * k, z: cam.target.z + (p.z - cam.target.z) * k }
      }
      const m = motion.current
      cam.yaw += m.yawV * dt * 60
      cam.pitch = clamp(cam.pitch + m.pitchV * dt * 60, -1.45, 1.45)
      m.yawV *= Math.pow(0.9, dt * 60)
      m.pitchV *= Math.pow(0.9, dt * 60)
      const idle = now - idleSince.current > (propsRef.current.compact ? 800 : 5000)
      if (spinRef.current && idle && !calm.current) cam.yaw += dt * (propsRef.current.compact ? 0.22 : 0.07)

      draw(ctx, now)
      quality.frame = quality.frame * 0.9 + (performance.now() - started) * 0.1
      lowQuality.current = quality.frame > 22
    }

    const draw = (g: CanvasRenderingContext2D, now: number) => {
      const { w, h, dpr } = sizeRef.current
      const pal = paletteRef.current!
      const cam = camRef.current
      const sys = sysRef.current
      const basis = basisOf(cam)
      const compactMode = propsRef.current.compact
      const t = now / 1000
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.globalCompositeOperation = 'source-over'
      g.globalAlpha = 1
      if (bgRef.current) g.drawImage(bgRef.current, -80 + Math.sin(cam.yaw) * 26, -80 + cam.pitch * 30)

      // distant stars: rotate with the camera but never move closer
      const f = focalLength(cam, h)
      g.globalCompositeOperation = 'lighter'
      const sky = skyRef.current
      const skyCount = lowQuality.current ? sky.length >> 1 : sky.length
      for (let i = 0; i < skyCount; i++) {
        const s = sky[i]
        const zc = s.dir.x * basis.forward.x + s.dir.y * basis.forward.y + s.dir.z * basis.forward.z
        if (zc < 0.05) continue
        const xc = s.dir.x * basis.right.x + s.dir.y * basis.right.y + s.dir.z * basis.right.z
        const yc = s.dir.x * basis.up.x + s.dir.y * basis.up.y + s.dir.z * basis.up.z
        const sx = w / 2 + (xc / zc) * f
        const sy = h / 2 - (yc / zc) * f
        if (sx < -4 || sx > w + 4 || sy < -4 || sy > h + 4) continue
        const tw = calm.current ? 0.8 : 0.55 + 0.45 * Math.sin(t * (0.8 + s.seed * 0.5) + s.seed * 9)
        g.fillStyle = `rgba(${s.tint[0]},${s.tint[1]},${s.tint[2]},${(0.22 + s.size * 0.22) * tw})`
        g.fillRect(sx, sy, s.size, s.size)
      }

      // project every star once, then paint far to near
      const proj: Projected[] = sys.stars.map((s) => project(basis, cam, s.p, w, h))
      const order = sys.stars.map((_, i) => i).filter((i) => proj[i].visible).sort((a, b) => proj[b].depth - proj[a].depth)
      const focus = hoverRef.current >= 0 ? hoverRef.current : selectedRef.current
      const near = new Set<number>(focus >= 0 ? [focus, ...sys.neighbors[focus]] : [])
      const fade = (depth: number) => clamp(1.35 - depth / (cam.dist * 2.3), 0.22, 1)
      const colorOf = (s: Star): RGB => {
        const region = regionOf(s.node)
        return (region && regionColors.current.get(region)) || starColor(pal, s)
      }

      // regions: where each one sits on screen, how spread out it is
      const agg = new Map<string, { x: number; y: number; n: number; x2: number; y2: number }>()
      for (const i of order) {
        const s = sys.stars[i]
        if (s.node.kind !== 'item') continue
        const region = regionOf(s.node)
        if (!region) continue
        const a = agg.get(region) ?? { x: 0, y: 0, n: 0, x2: 0, y2: 0 }
        a.x += proj[i].x
        a.y += proj[i].y
        a.x2 += proj[i].x * proj[i].x
        a.y2 += proj[i].y * proj[i].y
        a.n++
        agg.set(region, a)
      }
      g.globalCompositeOperation = 'lighter'
      if (!compactMode) {
        for (const [name, a] of agg) {
          if (a.n < 2) continue
          const cx = a.x / a.n
          const cy = a.y / a.n
          const spread = Math.sqrt(Math.max(0, a.x2 / a.n - cx * cx + (a.y2 / a.n - cy * cy)))
          const rad = clamp(spread * 2.1 + 50, 70, 520)
          const col = regionColors.current.get(name)
          if (!col) continue
          g.globalAlpha = focus >= 0 ? 0.3 : 0.6
          g.drawImage(hazeSprite(col), cx - rad, cy - rad, rad * 2, rad * 2)
        }
      }

      // spiral dust
      const dust = dustRef.current
      const dustCount = lowQuality.current ? dust.length >> 1 : dust.length
      g.globalAlpha = 1
      for (let i = 0; i < dustCount; i++) {
        const d = dust[i]
        const ang = d.a0 + (calm.current ? 0 : t * 0.045 * (110 / (d.r + 70)))
        const pr = project(basis, cam, { x: Math.cos(ang) * d.r, y: d.y, z: Math.sin(ang) * d.r }, w, h)
        if (!pr.visible || pr.x < -4 || pr.x > w + 4 || pr.y < -4 || pr.y > h + 4) continue
        const k = fade(pr.depth) * d.alpha
        g.fillStyle = `rgba(190,205,225,${k})`
        const sz = d.size * clamp(pr.scale * 1.7, 0.6, 2.2)
        g.fillRect(pr.x, pr.y, sz, sz)
      }

      // bonds: thin lines in the color of the region they leave from, so hubs throw colored fans
      g.lineCap = 'round'
      for (const b of sys.bonds) {
        const A = proj[b.a]
        const B = proj[b.b]
        if (!A.visible || !B.visible) continue
        const lit = focus >= 0 && (b.a === focus || b.b === focus)
        const dim = focus >= 0 && !lit
        const depth = (A.depth + B.depth) / 2
        const base = b.kind === 'link' ? 0.2 : b.kind === 'tag' ? 0.045 : 0.02
        const alpha = (lit ? 0.9 : dim ? base * 0.2 : base) * fade(depth)
        const ca = colorOf(sys.stars[b.a])
        const cb = colorOf(sys.stars[b.b])
        const mixc = (k: number) => [Math.round(ca[0] + (cb[0] - ca[0]) * k), Math.round(ca[1] + (cb[1] - ca[1]) * k), Math.round(ca[2] + (cb[2] - ca[2]) * k)]
        const [r, gg, bb] = b.kind === 'link' ? mixc(0.5) : b.kind === 'tag' ? [190, 185, 180] : ca
        const k = lit ? 0.45 : 0
        g.strokeStyle = `rgba(${Math.round(r + (255 - r) * k)},${Math.round(gg + (255 - gg) * k)},${Math.round(bb + (255 - bb) * k)},${alpha})`
        g.lineWidth = (lit ? 1.5 : 0.85) * clamp(Math.min(A.scale, B.scale) * 4.5, 0.55, 1.35)
        g.beginPath()
        g.moveTo(A.x, A.y)
        g.lineTo(B.x, B.y)
        g.stroke()
        if (lit && !calm.current && !lowQuality.current) {
          const p = (t * 0.42 + b.seed) % 1
          const dir = b.a === focus ? p : 1 - p
          g.globalAlpha = 1
          g.drawImage(glowSprite([r, gg, bb] as RGB, 64), A.x + (B.x - A.x) * dir - 9, A.y + (B.y - A.y) * dir - 9, 18, 18)
        }
      }

      // stars: color = region, shape = kind of item (dot note, ring web page, double ring PDF, sparkle prompt, square file)
      for (const i of order) {
        const s = sys.stars[i]
        const p = proj[i]
        const col = colorOf(s)
        const a = fade(p.depth) * (focus >= 0 && !near.has(i) ? 0.3 : 1)
        const rad = Math.max(s.r * p.scale, 1.1)
        const kind = s.node.kind
        if (kind === 'folder') {
          g.globalAlpha = a * 0.4
          const size = rad * 9
          g.drawImage(hazeSprite(col), p.x - size, p.y - size, size * 2, size * 2)
          continue
        }
        if (kind === 'ghost') {
          g.globalAlpha = a * 0.7
          g.setLineDash([2.5, 3])
          g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.8)`
          g.lineWidth = 1
          g.beginPath()
          g.arc(p.x, p.y, rad * 1.5, 0, Math.PI * 2)
          g.stroke()
          g.setLineDash([])
          continue
        }
        const pulse = calm.current ? 1 : 0.92 + 0.08 * Math.sin(t * (1.1 + s.seed) + s.seed * 12)
        const halo = (kind === 'tag' ? 2 : 2.3 + Math.min(1.1, s.node.degree * 0.09)) * rad * pulse * (i === focus ? 1.6 : 1)
        g.globalAlpha = a * (kind === 'tag' ? 0.45 : 0.72)
        g.drawImage(glowSprite(col), p.x - halo, p.y - halo, halo * 2, halo * 2)
        g.globalAlpha = a
        if (kind === 'item') {
          const type = s.node.itemType ?? 'note'
          g.lineWidth = Math.max(1, rad * 0.22)
          g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.95)`
          if (type === 'web' || type === 'pdf') {
            g.fillStyle = 'rgba(4,7,10,0.72)'
            g.beginPath()
            g.arc(p.x, p.y, rad * 0.95, 0, Math.PI * 2)
            g.fill()
            g.beginPath()
            g.arc(p.x, p.y, rad * 1.05, 0, Math.PI * 2)
            g.stroke()
            if (type === 'pdf') {
              g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.55)`
              g.beginPath()
              g.arc(p.x, p.y, rad * 1.65, 0, Math.PI * 2)
              g.stroke()
            }
          }
          if (type === 'prompt') {
            g.lineWidth = Math.max(0.8, rad * 0.14)
            g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.85)`
            g.beginPath()
            g.moveTo(p.x - rad * 2, p.y)
            g.lineTo(p.x + rad * 2, p.y)
            g.moveTo(p.x, p.y - rad * 2)
            g.lineTo(p.x, p.y + rad * 2)
            g.stroke()
          }
          g.fillStyle = type === 'file' ? `rgba(${col[0]},${col[1]},${col[2]},1)` : 'rgba(255,250,245,0.92)'
          if (type === 'file') g.fillRect(p.x - rad * 0.5, p.y - rad * 0.5, rad, rad)
          else if (type !== 'web' && type !== 'pdf') {
            g.beginPath()
            g.arc(p.x, p.y, Math.max(0.8, rad * 0.32), 0, Math.PI * 2)
            g.fill()
          } else {
            g.beginPath()
            g.arc(p.x, p.y, Math.max(0.7, rad * 0.22), 0, Math.PI * 2)
            g.fill()
          }
        }
        if (i === selectedRef.current) {
          g.globalAlpha = 1
          const ring = rad * (2.4 + (calm.current ? 0 : 0.35 * Math.sin(t * 3)))
          g.strokeStyle = `rgba(255,255,255,0.9)`
          g.lineWidth = 1.5
          g.beginPath()
          g.arc(p.x, p.y, ring, 0, Math.PI * 2)
          g.stroke()
          g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.45)`
          g.beginPath()
          g.moveTo(p.x - ring * 2.4, p.y)
          g.lineTo(p.x + ring * 2.4, p.y)
          g.moveTo(p.x, p.y - ring * 2.4)
          g.lineTo(p.x, p.y + ring * 2.4)
          g.stroke()
        }
      }

      // region captions with leader lines, like labelled areas of a brain scan
      g.globalCompositeOperation = 'source-over'
      if (!compactMode) {
        g.textAlign = 'left'
        g.textBaseline = 'alphabetic'
        let slot = 0
        for (const reg of regionsRef.current) {
          const a = agg.get(reg.name)
          if (!a || a.n < 3) continue
          const cx = a.x / a.n
          const cy = a.y / a.n
          if (cx < -40 || cx > w + 40 || cy < -40 || cy > h + 40) continue
          const col = regionColors.current.get(reg.name) ?? pal.accent
          const lx = cx + 22
          const ly = cy - 30 - (slot++ % 3) * 6
          g.globalAlpha = focus >= 0 ? 0.2 : 0.75
          g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.55)`
          g.lineWidth = 1
          g.beginPath()
          g.moveTo(cx, cy)
          g.lineTo(lx - 4, ly + 3)
          g.lineTo(lx + 40, ly + 3)
          g.stroke()
          g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`
          g.beginPath()
          g.arc(cx, cy, 2.2, 0, Math.PI * 2)
          g.fill()
          g.font = '700 11.5px Inter, system-ui, sans-serif'
          ;(g as unknown as { letterSpacing: string }).letterSpacing = '1.2px'
          g.fillText(reg.name.toUpperCase().slice(0, 18), lx, ly)
          ;(g as unknown as { letterSpacing: string }).letterSpacing = '0px'
        }
        g.globalAlpha = 1
      }

      // labels: a small budget, most important first, never overlapping
      g.globalCompositeOperation = 'source-over'
      g.textAlign = 'center'
      g.textBaseline = 'top'
      g.lineJoin = 'round'
      const wanted: { i: number; priority: number }[] = []
      for (const i of order) {
        const s = sys.stars[i]
        const p = proj[i]
        let priority = 0
        if (i === selectedRef.current) priority = 100
        else if (i === hoverRef.current) priority = 95
        else if (near.has(i)) priority = 70
        else if (focus < 0 && s.node.kind === 'item' && s.node.degree >= 5 && p.depth < cam.dist * 1.1) priority = 20 + s.node.degree
        else if (focus < 0 && cam.dist < 260 && s.r * p.scale > 7) priority = 10
        else if (focus < 0 && compactMode && s.node.kind === 'item') priority = 5
        if (priority) wanted.push({ i, priority })
      }
      wanted.sort((a, b) => b.priority - a.priority)
      const budget = compactMode ? 5 : cam.dist < 260 ? 18 : 5
      const taken: { x0: number; x1: number; y0: number; y1: number }[] = []
      let shown = 0
      for (const { i, priority } of wanted) {
        if (shown >= budget && priority < 90) break
        const s = sys.stars[i]
        const p = proj[i]
        const size = clamp(12 * Math.sqrt(p.scale * 4.2), 10.5, 15)
        const label = s.node.label.length > 26 ? s.node.label.slice(0, 25) + '…' : s.node.label
        const width = label.length * size * 0.54
        const y = p.y + Math.max(s.r * p.scale * 1.5, 6) + 4
        const box = { x0: p.x - width / 2, x1: p.x + width / 2, y0: y, y1: y + size + 2 }
        if (priority < 90 && taken.some((t) => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0)) continue
        taken.push(box)
        shown++
        g.font = `${priority >= 90 ? 650 : 500} ${size}px Inter, system-ui, sans-serif`
        g.globalAlpha = priority >= 70 ? 1 : fade(p.depth) * 0.85
        g.lineWidth = 3.5
        g.strokeStyle = 'rgba(4,4,6,0.88)'
        g.strokeText(label, p.x, y)
        g.fillStyle = priority >= 70 ? pal.text : 'rgba(225,218,208,0.92)'
        g.fillText(label, p.x, y)
      }
      g.globalAlpha = 1
      g.globalCompositeOperation = 'source-over'
    }

    if (import.meta.env.DEV) {
      // test hook: screen positions of every star, so automated checks can click real nodes
      ;(window as unknown as { __galaxy?: () => unknown }).__galaxy = () => {
        const { w, h } = sizeRef.current
        const cam = camRef.current
        const basis = basisOf(cam)
        return sysRef.current.stars.map((s) => ({ id: s.node.id, label: s.node.label, ...project(basis, cam, s.p, w, h) }))
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      ro.disconnect()
      mo.disconnect()
      io.disconnect()
    }
  }, [])

  // pointer interaction: orbit, pan, pinch, drag a star, click, double-click, wheel
  useEffect(() => {
    const canvas = canvasRef.current!
    const pointers = new Map<number, { x: number; y: number }>()
    type Mode = 'none' | 'orbit' | 'pan' | 'node' | 'pinch'
    let mode: Mode = 'none'
    let dragStar: Star | null = null
    let dragDepth = 0
    let moved = 0
    let pinchDist = 0
    let lastTap = 0
    let lastTapId = -1

    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const pick = (x: number, y: number, slop = 6) => {
      const { w, h } = sizeRef.current
      const cam = camRef.current
      return hitTest(sysRef.current, basisOf(cam), cam, x, y, w, h, slop)
    }

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      const p = local(e)
      pointers.set(e.pointerId, p)
      moved = 0
      touch()
      flyRef.current = null
      motion.current = { yawV: 0, pitchV: 0 }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
        if (dragStar) dragStar.pinned = false
        dragStar = null
        mode = 'pinch'
        return
      }
      const hit = e.button === 0 && !e.shiftKey ? pick(p.x, p.y, e.pointerType === 'touch' ? 14 : 6) : null
      if (hit) {
        mode = 'node'
        dragStar = hit.star
        dragDepth = hit.projected.depth
        hit.star.pinned = true
      } else {
        mode = e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'orbit'
      }
    }

    const move = (e: PointerEvent) => {
      const p = local(e)
      const prev = pointers.get(e.pointerId)
      const { w, h } = sizeRef.current
      const cam = camRef.current
      if (!prev) {
        const hit = pick(p.x, p.y)
        const idx = hit?.star.index ?? -1
        if (idx !== hoverRef.current) {
          hoverRef.current = idx
          canvas.style.cursor = idx >= 0 ? 'pointer' : 'grab'
        }
        return
      }
      pointers.set(e.pointerId, p)
      touch()
      const dx = p.x - prev.x
      const dy = p.y - prev.y
      moved += Math.abs(dx) + Math.abs(dy)
      if (mode === 'pinch' && pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0) camRef.current = { ...cam, dist: clamp(cam.dist * (pinchDist / d), 60, 3600) }
        pinchDist = d
        return
      }
      if (mode === 'node' && dragStar) {
        const world = unproject(basisOf(cam), cam, p.x, p.y, dragDepth, w, h)
        dragStar.p = world
        return
      }
      if (mode === 'orbit') {
        const yawD = -dx * 0.0052
        const pitchD = dy * 0.0052
        camRef.current = { ...cam, yaw: cam.yaw + yawD, pitch: clamp(cam.pitch + pitchD, -1.45, 1.45) }
        motion.current = { yawV: yawD / 4, pitchV: pitchD / 4 }
        canvas.style.cursor = 'grabbing'
      } else if (mode === 'pan') {
        const k = cam.dist / focalLength(cam, h)
        const b = basisOf(cam)
        followRef.current = -1
        camRef.current = {
          ...cam,
          target: {
            x: cam.target.x + (-b.right.x * dx + b.up.x * dy) * k,
            y: cam.target.y + (-b.right.y * dx + b.up.y * dy) * k,
            z: cam.target.z + (-b.right.z * dx + b.up.z * dy) * k,
          },
        }
        canvas.style.cursor = 'move'
      }
    }

    const up = (e: PointerEvent) => {
      const p = local(e)
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      const click = moved < 6
      if (mode === 'node' && dragStar) {
        const star = dragStar
        star.pinned = false
        dragStar = null
        if (click) {
          const now = Date.now()
          if (now - lastTap < 380 && lastTapId === star.index) propsRef.current.onOpen(star.node)
          else {
            selectedRef.current = star.index
            propsRef.current.onSelect(star.node.id)
          }
          lastTap = now
          lastTapId = star.index
        }
      } else if ((mode === 'orbit' || mode === 'pan') && click && !pick(p.x, p.y)) {
        const now = Date.now()
        if (now - lastTap < 380 && lastTapId === -2) fitView(true)
        else if (selectedRef.current >= 0) propsRef.current.onSelect(null)
        lastTap = now
        lastTapId = -2
      }
      if (pointers.size === 0) mode = 'none'
      canvas.style.cursor = hoverRef.current >= 0 ? 'pointer' : 'grab'
    }

    const leave = () => {
      hoverRef.current = -1
    }

    const wheel = (e: WheelEvent) => {
      if (propsRef.current.compact && !e.ctrlKey) return // let the page scroll past the small graph
      e.preventDefault()
      touch()
      flyRef.current = null
      const cam = camRef.current
      camRef.current = { ...cam, dist: clamp(cam.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0013)), 60, 3600) }
    }

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('wheel', wheel, { passive: false })
    const noMenu = (e: Event) => e.preventDefault()
    canvas.addEventListener('contextmenu', noMenu)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('contextmenu', noMenu)
    }
  }, [fitView, touch])

  return (
    <div ref={wrapRef} className="graph-wrap">
      <canvas ref={canvasRef} className="graph-canvas" style={{ touchAction: 'none', cursor: 'grab' }} />
    </div>
  )
})
