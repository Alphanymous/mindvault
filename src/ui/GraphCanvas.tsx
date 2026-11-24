import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { createCloudLayout, type CloudLayout } from '../core/cloudLayout'
import { regionHues, regionOf, regionOfFolder, regionRgb } from '../core/clusters'
import { hash01 } from '../core/hash'
import type { GraphData, GraphNode } from '../core/types'
import { useAppState } from '../data/store'
import {
  AMBIENT_LIMIT,
  LITE_LIMIT,
  centreOn,
  cloudStats,
  fitView,
  lookOf,
  newPlaced,
  pick,
  place,
  placePoint,
  regionDepth,
  sizeOf,
  swayAngle,
  unplace,
  type CloudStats,
  type Frame,
  type Point,
  type Look,
  type Placed,
  type View,
} from './cloudGeometry'
import { LABEL_SIZE, labelRequests } from './cloudLabelRules'
import { createAtlasScene, type AtlasScene } from './graphAtlas'
import { placeLabels, type PlacedLabel } from './graphLabels'
import {
  drawItemShape,
  drawLabelPill,
  drawRegionName,
  drawRipple,
  easeInOut,
  glowSprite,
  hazeSprite,
  kindColor,
  makeDust,
  makeSky,
  paintBackdrop,
  pillFont,
  readPalette,
  regionFont,
  type Dust,
  type Palette,
  type RGB,
} from './graphFx'

export interface GraphHandle {
  zoomBy(factor: number): void
  fit(): void
  focusSelected(): void
  /** Turn the slow sway of the cloud on or off; returns the new state. */
  toggleSpin(): boolean
  /** Fly to a region's patch of the cloud (top-level folder). */
  focusRegion(name: string): void
}

interface Props {
  data: GraphData
  selectedId: string | null
  onSelect(id: string | null): void
  onOpen(node: GraphNode): void
  compact?: boolean
  /** Ids that match the search: they stay bright, everything else dims. Null when not searching. */
  highlight?: Set<string> | null
  /** Cloud (default) or Atlas: orbs per region on a ring around a golden cloud. */
  view?: 'cloud' | 'atlas'
}

const RIPPLE_MS = 1100
const TAP_MS = 380
const SIGNALS = 24
/** Floating panels a label must never sit under, looked up in the page around the canvas. */
const PANELS = '.graph-search-wrap, .atlas, .graph-settings, .graph-panel, .graph-card, .graph-zoom, .graph-options-btn, .galaxy-cta'
/** The phone's bottom tab bar, a panel only where it lies over the canvas. */
const TAB_BAR = '.tabbar'
/** Clearance around panels; also covers the card's 8 px pop-in offset while it animates. */
const PANEL_PAD = 8
/** Each label size has one font, so placement measures what drawLabelPill / drawRegionName draw. */
const fontForSize = (size: number) =>
  size === LABEL_SIZE.region ? regionFont(size) : pillFont(size, size === LABEL_SIZE.strong || size === LABEL_SIZE.hub)

interface EdgeGroup { css: string; link: boolean; pairs: number[] }
interface Box { x: number; y: number; w: number; h: number }

/** Everything the frame loop reads and writes, kept outside React state so frames never re-render. */
interface Scene {
  layout: CloudLayout
  looks: Look[]
  colors: RGB[]
  /** Per node, worked out once per data or theme change: its colour as CSS and its glow sprite. */
  css: string[]
  sprites: HTMLCanvasElement[]
  /** Every node, busiest first (neighbour lists are sorted the same way). */
  ranked: Int32Array
  regionOfNode: Int32Array
  regionNames: string[]
  regionColors: RGB[]
  neighbours: number[][]
  edgeGroups: EdgeGroup[]
  placed: Placed
  order: number[]
  stats: CloudStats
  angle: number
  highlight: Set<number> | null
  /** Id last seen in props (undefined before the first), and its index. */
  selectedId: string | null | undefined
  selected: number
  hover: number
  view: View
  fitScale: number
  autoFit: boolean
  fitted: boolean
  flight: { from: View; to: View; t0: number; dur: number } | null
  spin: boolean
  amp: number
  reveal: { zoom: boolean } | null
  ripple: { idx: number; t0: number } | null
  signals: { edge: number; t: number; speed: number; cycle: number }[]
  settledReported: boolean
  /** Screen positions are current for this layout (false until its first frame is drawn). */
  drawn: boolean
}

type DevWindow = Window & { __graphSettledAt?: number; __graphLabels?: PlacedLabel[]; __graphNodes?: () => { id: string; label: string; x: number; y: number; r: number }[] }

function emptyScene(): Scene {
  return {
    layout: createCloudLayout({ nodes: [], edges: [] }),
    looks: [], colors: [], css: [], sprites: [], ranked: new Int32Array(0), regionOfNode: new Int32Array(0), regionNames: [], regionColors: [], neighbours: [], edgeGroups: [],
    placed: newPlaced(0), order: [], stats: { mx: 0, my: 0, radius: 1 }, angle: 0,
    highlight: null, selectedId: undefined, selected: -1, hover: -1,
    view: { x: 0, y: 0, scale: 1 }, fitScale: 1, autoFit: true, fitted: false, flight: null,
    spin: true, amp: 0, reveal: null, ripple: null, signals: [], settledReported: false, drawn: false,
  }
}

export const GraphCanvas = forwardRef<GraphHandle, Props>(function GraphCanvas({ data, selectedId, onSelect, onOpen, compact, highlight, view = 'cloud' }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<Scene>(emptyScene())
  const sizeRef = useRef({ w: 300, h: 300, dpr: 1 })
  const paletteRef = useRef<Palette | null>(null)
  const propsRef = useRef({ onSelect, onOpen, compact: !!compact, selectedId, highlight, view })
  propsRef.current = { onSelect, onOpen, compact: !!compact, selectedId, highlight, view }
  /** The Atlas scene while view is 'atlas'; the frame loop and pointer input hand over to it. */
  const atlasRef = useRef<AtlasScene | null>(null)
  const calm = useRef(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches).current
  /** Ask for a redraw; restarts the frame loop if it had stopped. Set by the render-loop effect. */
  const kickRef = useRef<(stale?: boolean) => void>(() => {})
  /** Floating panels over the canvas, in canvas coordinates; read by the frame loop when the page changes. */
  const obstaclesRef = useRef<Box[]>([])
  /** Hands the current panels and free frame to the Atlas scene (set by the render-loop effect). */
  /** Notes by id of the current data, read by pointer input. */
  const nodeByIdRef = useRef(new Map<string, GraphNode>())
  nodeByIdRef.current = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data])
  const syncAtlasRef = useRef<() => void>(() => {})
  // Region colours come from every live note, never the filtered graph, so they match the Atlas list and Clusters.
  const { items } = useAppState()
  const liveRegions = useMemo(() => [...new Set(items.filter((i) => !i.deleted).map((i) => regionOfFolder(i.folder)))].sort().join('\n'), [items])
  const liveRegionsRef = useRef(liveRegions)
  liveRegionsRef.current = liveRegions

  /** Colours and edge groups depend on the data and on the theme (tags and unwritten links use theme colours). */
  const restyle = () => {
    const sc = sceneRef.current
    const pal = (paletteRef.current ??= readPalette())
    const names = new Map<string, number>()
    sc.regionOfNode = Int32Array.from(sc.layout.nodes, (n) => {
      if (!n.region) return -1
      if (!names.has(n.region)) names.set(n.region, names.size)
      return names.get(n.region)!
    })
    sc.regionNames = [...names.keys()]
    const hues = regionHues([...sc.regionNames, ...liveRegionsRef.current.split('\n').filter(Boolean)])
    sc.regionColors = sc.regionNames.map((r) => regionRgb(hues.get(r)!))
    sc.colors = sc.layout.nodes.map((n, i) => (sc.regionOfNode[i] >= 0 ? sc.regionColors[sc.regionOfNode[i]] : kindColor(pal, n.node)))
    sc.css = sc.colors.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`)
    sc.sprites = sc.colors.map((c) => glowSprite(c))
    // Lines take the colour of the node they leave from; direct [[links]] a little brighter.
    const groups = new Map<string, EdgeGroup>()
    for (const e of sc.layout.edges) {
      const c = sc.colors[e.a], link = e.kind === 'link', k = link ? 0.3 : 0
      const css = `rgb(${Math.round(c[0] + (255 - c[0]) * k)},${Math.round(c[1] + (255 - c[1]) * k)},${Math.round(c[2] + (255 - c[2]) * k)})`
      const key = css + link
      let group = groups.get(key)
      if (!group) groups.set(key, (group = { css, link, pairs: [] }))
      group.pairs.push(e.a, e.b)
    }
    sc.edgeGroups = [...groups.values()]
  }

  const syncHighlight = () => {
    const sc = sceneRef.current
    const ids = propsRef.current.highlight
    sc.highlight = ids ? new Set([...ids].map((id) => sc.layout.index.get(id) ?? -1).filter((i) => i >= 0)) : null
  }

  const ambientOn = () => !calm && sceneRef.current.layout.nodes.length <= AMBIENT_LIMIT

  /** Frame the cloud; on a wide canvas, beside tall side panels (the open Atlas list, the selected note's card). */
  const fitFrame = (): Frame => {
    const { w, h } = sizeRef.current
    let left = 0, right = 0, top = 0, bottom = 0
    for (const o of obstaclesRef.current) {
      if (o.w >= w * 0.6) {
        // a strip across the canvas (the search bar on a phone, a tab bar over the canvas)
        if (o.y + o.h / 2 < h / 2) top = Math.max(top, o.y + o.h)
        else bottom = Math.max(bottom, h - o.y)
      } else if (o.h >= h * 0.25) {
        if (o.x + o.w / 2 < w / 2) left = Math.max(left, o.x + o.w)
        else right = Math.max(right, w - o.x)
      }
    }
    if (w - left - right < Math.max(420, w * 0.55)) left = right = 0
    if (h - top - bottom < h * 0.6) top = bottom = 0
    return { x: left, y: top, w: w - left - right, h: h - top - bottom }
  }

  const fitTarget = (): View => {
    const sc = sceneRef.current
    const frame = fitFrame()
    const v = fitView(sc.layout.nodes, sc.looks, cloudStats(sc.layout.nodes), frame, sc.spin && ambientOn())
    if (sc.layout.nodes.length) sc.fitScale = v.scale
    return v
  }

  const flyTo = (to: View) => {
    const sc = sceneRef.current
    sc.autoFit = false
    if (calm) sc.view = to
    else sc.flight = { from: { ...sc.view }, to, t0: -1, dur: 650 }
    kickRef.current()
  }

  const scaleLimits = () => {
    const f = sceneRef.current.fitScale || 1
    return { min: f * 0.3, max: f * 14 }
  }

  const zoomAt = (factor: number, px: number, py: number) => {
    const sc = sceneRef.current
    const { min, max } = scaleLimits()
    const scale = Math.max(min, Math.min(max, sc.view.scale * factor)), ratio = scale / sc.view.scale
    sc.view = { x: px - (px - sc.view.x) * ratio, y: py - (py - sc.view.y) * ratio, scale }
    sc.autoFit = false
    sc.flight = null
    kickRef.current()
  }

  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => {
      const atlas = atlasRef.current
      if (atlas) {
        const f = fitFrame()
        atlas.zoomAt(factor, f.x + f.w / 2, f.y + f.h / 2)
        kickRef.current()
      } else zoomAt(factor, sizeRef.current.w / 2, sizeRef.current.h / 2)
    },
    fit: () => {
      if (atlasRef.current) {
        atlasRef.current.fit()
        kickRef.current()
        return
      }
      const sc = sceneRef.current
      sc.flight = null
      sc.autoFit = true
      sc.fitted = false
      kickRef.current()
    },
    focusSelected: () => {
      const sc = sceneRef.current
      if (atlasRef.current) {
        atlasRef.current.setSelected(propsRef.current.selectedId, true)
        kickRef.current()
        return
      }
      if (sc.selected < 0) return
      const { w, h } = sizeRef.current
      const scale = Math.min(scaleLimits().max, Math.max(sc.view.scale, sc.fitScale * 2))
      flyTo(centreOn(sc.placed.sx[sc.selected], sc.placed.sy[sc.selected], sc.view, w, h, scale))
    },
    toggleSpin: () => {
      const sc = sceneRef.current
      sc.spin = !sc.spin
      atlasRef.current?.setSpin(sc.spin)
      kickRef.current()
      return sc.spin
    },
    focusRegion: (name) => {
      if (atlasRef.current) {
        atlasRef.current.focus(name || null)
        kickRef.current()
        return
      }
      const sc = sceneRef.current
      const c = sc.layout.regionCentres().get(name)
      if (!c) return
      const { w, h } = sizeRef.current
      const at = placePoint(c.x, c.y, regionDepth(name), sc.stats, sc.view, sc.angle, sc.amp)
      const { max } = scaleLimits()
      const scale = Math.max(sc.fitScale, Math.min(max, (Math.min(w, h) * 0.8) / (2.4 * Math.max(20, c.radius))))
      flyTo(centreOn(at.x, at.y, sc.view, w, h, scale))
    },
  }))

  // Canvas size, backdrop, palette, the frame loop and pointer input. Declared first, so the size is known
  // before the first layout is framed.
  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const isCompact = () => propsRef.current.compact
    const sky = makeSky(isCompact() ? 60 : 260)
    const dust: Dust[] = makeDust(isCompact() ? 70 : 240)
    let backdrop: HTMLCanvasElement | null = null
    let raf = 0
    let alive = true
    let visible = true
    let dirty = true
    let lastDraw = -Infinity
    let lastFrame = 0
    let slowFrames = 0
    let drawMs = 0
    let obstaclesStale = true
    let atlasMoving = false
    const widths = new Map<string, number>()
    const nodeById = { get: (id: string) => nodeByIdRef.current.get(id) }
    const dustPoint: Point = { x: 0, y: 0, f: 1 }

    const kick = (stale = false) => {
      dirty = true
      if (stale) obstaclesStale = true
      if (!raf && alive) raf = requestAnimationFrame(frame)
    }
    kickRef.current = kick

    const repaint = () => {
      const { w, h, dpr } = sizeRef.current
      backdrop = paintBackdrop(w, h, dpr, (paletteRef.current ??= readPalette()), sky, isCompact())
    }
    const resize = () => {
      const r = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      sizeRef.current = { w: Math.max(40, r.width), h: Math.max(40, r.height), dpr }
      canvas.width = Math.round(sizeRef.current.w * dpr)
      canvas.height = Math.round(sizeRef.current.h * dpr)
      repaint()
      const sc = sceneRef.current
      if (sc.autoFit) sc.fitted = false
      atlasRef.current?.resize(sizeRef.current.w, sizeRef.current.h, dpr)
      kick(true)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    const theme = new MutationObserver(() => {
      paletteRef.current = readPalette()
      repaint()
      restyle()
      kick()
    })
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] })
    // Panels opening, closing or moving: labels must keep clear of them.
    const page = wrap.parentElement ?? wrap
    const panels = new MutationObserver(() => kick(true))
    panels.observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    const io = new IntersectionObserver((e) => {
      visible = e.some((x) => x.isIntersecting)
      if (visible) kick()
    })
    io.observe(wrap)
    const onVisibility = () => document.visibilityState === 'visible' && kick()
    document.addEventListener('visibilitychange', onVisibility)
    // Label widths are cached; a web font arriving late changes them.
    const onFonts = () => {
      widths.clear()
      kick()
    }
    document.fonts?.addEventListener('loadingdone', onFonts)

    /**
     * Panels around the canvas, padded by PANEL_PAD: getBoundingClientRect includes transforms, so a panel still
     * playing its entrance (the card pops in from 8 px lower) reads a little off until it ends, when we read again.
     * The tab bar counts only where it covers the canvas.
     */
    const readObstacles = () => {
      const cr = canvas.getBoundingClientRect()
      const els = [...page.querySelectorAll(PANELS), ...document.querySelectorAll(TAB_BAR)]
      obstaclesRef.current = els.flatMap((el) => {
        const r = el.getBoundingClientRect()
        const x = r.left - cr.left - PANEL_PAD, y = r.top - cr.top - PANEL_PAD, w = r.width + 2 * PANEL_PAD, h = r.height + 2 * PANEL_PAD
        const covers = r.width && r.height && x < cr.width && y < cr.height && x + w > 0 && y + h > 0
        return covers ? [{ x, y, w, h }] : []
      })
      obstaclesStale = false
      syncAtlas()
    }
    const syncAtlas = () => {
      const atlas = atlasRef.current
      if (!atlas) return
      atlas.setObstacles(obstaclesRef.current)
      atlas.setFrame(fitFrame())
    }
    syncAtlasRef.current = () => {
      readObstacles()
      kick()
    }
    const onSettle = () => kick(true)
    page.addEventListener('animationend', onSettle, true)
    page.addEventListener('transitionend', onSettle, true)
    const measure = (text: string, size: number) => {
      const key = size + '|' + text
      let width = widths.get(key)
      if (width === undefined) {
        if (widths.size > 4000) widths.clear()
        ctx.font = fontForSize(size)
        width = ctx.measureText(text).width
        widths.set(key, width)
      }
      return width
    }

    function frame(now: number) {
      raf = 0
      if (!alive || !visible || document.visibilityState === 'hidden') return
      const sc = sceneRef.current
      const ambient = ambientOn()
      const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000))
      lastFrame = now
      let busy = false
      if (obstaclesStale) readObstacles()

      const atlas = atlasRef.current
      if (atlas) {
        // Atlas: its own scene. Frames run only while it moves (flight, intro, satellites) or something changed.
        if (dirty || (atlasMoving && now - lastDraw >= (isCompact() ? 40 : 33) - 2)) {
          const { dpr } = sizeRef.current
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = 1
          if (backdrop) ctx.drawImage(backdrop, 0, 0)
          else ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
          atlasMoving = atlas.draw(ctx, now)
          if (import.meta.env.DEV) (window as DevWindow).__graphLabels = atlas.labels()
          dirty = false
          lastDraw = now
        }
        if (atlasMoving || dirty) raf = requestAnimationFrame(frame)
        return
      }

      if (!sc.layout.settled) {
        // While the cloud unfolds the layout gets most of each frame; more when drawing is slow (big vaults, phones).
        const stop = performance.now() + (isCompact() ? 6 : drawMs > 16 ? 14 : 9)
        do sc.layout.tick()
        while (!sc.layout.settled && performance.now() < stop)
        busy = dirty = true
      }
      if (sc.layout.settled && !sc.settledReported) {
        sc.settledReported = true
        fitTarget()
        if (import.meta.env.DEV) (window as DevWindow).__graphSettledAt = performance.now()
      }

      // The sway fades in and out instead of jumping when it is switched.
      const swayTo = sc.spin && ambient ? 1 : 0
      if (sc.amp !== swayTo) {
        sc.amp = swayTo > sc.amp ? Math.min(1, sc.amp + dt * 0.8) : Math.max(0, sc.amp - dt * 0.8)
        busy = dirty = true
      }

      if (sc.autoFit && !sc.fitted) {
        const to = fitTarget()
        const v = sc.view
        if (calm) sc.view = to
        else sc.view = { x: v.x + (to.x - v.x) * 0.2, y: v.y + (to.y - v.y) * 0.2, scale: v.scale + (to.scale - v.scale) * 0.2 }
        const close = Math.abs(to.x - sc.view.x) < 0.5 && Math.abs(to.y - sc.view.y) < 0.5 && Math.abs(to.scale - sc.view.scale) < to.scale * 0.002
        if (sc.layout.settled && close) {
          sc.view = to
          sc.fitted = true
        }
        busy = dirty = true
      }
      if (sc.flight) {
        const fl = sc.flight
        if (fl.t0 < 0) fl.t0 = now
        const t = Math.min(1, (now - fl.t0) / fl.dur), e = easeInOut(t)
        sc.view = { x: fl.from.x + (fl.to.x - fl.from.x) * e, y: fl.from.y + (fl.to.y - fl.from.y) * e, scale: fl.from.scale + (fl.to.scale - fl.from.scale) * e }
        if (t >= 1) sc.flight = null
        busy = dirty = true
      }
      if (sc.reveal && sc.layout.settled && (sc.fitted || !sc.autoFit) && !sc.flight && sc.drawn) reveal()

      // After settling only the sway, drift and pulses move, at about 30 frames a second (25 in the preview).
      const animating = ambient || (!!sc.ripple && !calm)
      const interval = isCompact() ? 40 : 33
      // Unfolding: when a frame is costly to draw, draw less often so the layout settles sooner.
      const due = sc.layout.settled || now - lastDraw >= Math.min(150, drawMs * 2)
      if (due && (dirty || (animating && now - lastDraw >= interval - 2))) {
        const started = performance.now()
        draw(now)
        const spent = performance.now() - started
        drawMs = drawMs * 0.7 + spent * 0.3
        slowFrames = spent > 22 ? Math.min(30, slowFrames + 1) : Math.max(0, slowFrames - 1)
        dirty = false
        lastDraw = now
      }
      if (busy || animating || dirty) raf = requestAnimationFrame(frame)
    }

    /** A selected note that sits off screen or under a panel is brought to the middle; "Open in graph" also zooms in. */
    function reveal() {
      const sc = sceneRef.current
      const r = sc.reveal!
      sc.reveal = null
      const i = sc.selected
      if (i < 0) return
      const { w, h } = sizeRef.current
      const x = sc.placed.sx[i], y = sc.placed.sy[i]
      const inset = 48
      const hidden = x < inset || y < inset || x > w - inset || y > h - inset || obstaclesRef.current.some((o) => x > o.x - 12 && x < o.x + o.w + 12 && y > o.y - 12 && y < o.y + o.h + 12)
      if (!r.zoom && !hidden) return
      const scale = r.zoom ? Math.min(scaleLimits().max, Math.max(sc.view.scale, sc.fitScale * 1.6)) : sc.view.scale
      flyTo(centreOn(x, y, sc.view, w, h, scale))
    }

    function draw(now: number) {
      const sc = sceneRef.current
      const { w, h, dpr } = sizeRef.current
      const g = ctx
      const t = now / 1000
      const nodes = sc.layout.nodes
      const count = nodes.length
      const compactMode = isCompact()
      const ambient = ambientOn()
      const low = slowFrames > 8
      sc.drawn = true
      sc.stats = cloudStats(nodes)
      sc.angle = swayAngle(t, sc.amp)
      if (sc.placed.sx.length !== count) sc.placed = newPlaced(count)
      place(nodes, sc.looks, sc.stats, sc.view, sc.angle, sc.amp, t, ambient, sc.placed)
      const { sx, sy, f } = sc.placed
      const scale = sc.view.scale
      const zoom = scale / (sc.fitScale || 1)
      const radius = (i: number) => sizeOf(sc.looks[i], scale, f[i])

      g.setTransform(1, 0, 0, 1, 0, 0)
      g.globalCompositeOperation = 'source-over'
      g.globalAlpha = 1
      if (backdrop) g.drawImage(backdrop, 0, 0)
      else g.clearRect(0, 0, canvas.width, canvas.height)
      g.setTransform(dpr, 0, 0, dpr, 0, 0)

      const focus = sc.hover >= 0 ? sc.hover : sc.selected
      const near = focus >= 0 ? new Set([focus, ...sc.neighbours[focus]]) : null
      const hl = sc.highlight
      const dimmed = (i: number) => (!!near && !near.has(i)) || (!!hl && !hl.has(i) && i !== focus)

      // dust: faint specks around the cloud that sway with it
      g.globalCompositeOperation = 'lighter'
      if (count && !low) {
        g.fillStyle = 'rgb(190,205,225)'
        const R = sc.stats.radius
        for (const d of dust) {
          const p = placePoint(sc.stats.mx + Math.cos(d.angle) * d.r * R, sc.stats.my + Math.sin(d.angle) * d.r * R, d.zr, sc.stats, sc.view, sc.angle, sc.amp, dustPoint)
          if (p.x < -4 || p.x > w + 4 || p.y < -4 || p.y > h + 4) continue
          g.globalAlpha = d.alpha
          const s = d.size * p.f
          g.fillRect(p.x, p.y, s, s)
        }
      }

      // regions: where each lobe sits on screen and how far it reaches; a soft glow in its colour behind it
      const rn = sc.regionNames.length
      const ax = new Float64Array(rn), ay = new Float64Array(rn), an = new Float64Array(rn), a2 = new Float64Array(rn)
      for (let i = 0; i < count; i++) {
        const r = sc.regionOfNode[i]
        if (r < 0 || nodes[i].node.kind !== 'item') continue
        ax[r] += sx[i]; ay[r] += sy[i]; an[r]++
      }
      for (let i = 0; i < count; i++) {
        const r = sc.regionOfNode[i]
        if (r < 0 || nodes[i].node.kind !== 'item') continue
        a2[r] += (sx[i] - ax[r] / an[r]) ** 2 + (sy[i] - ay[r] / an[r]) ** 2
      }
      const regionsOnScreen: { name: string; x: number; y: number }[] = []
      for (let r = 0; r < rn; r++) {
        if (!an[r]) continue
        const cx = ax[r] / an[r], cy = ay[r] / an[r]
        const reach = Math.max(28, Math.sqrt(a2[r] / an[r]) * 2.4)
        if (cx < -reach || cx > w + reach || cy < -reach || cy > h + reach) continue
        g.globalAlpha = near || hl ? 0.35 : compactMode ? 0.7 : 0.85
        g.drawImage(hazeSprite(sc.regionColors[r]), cx - reach, cy - reach, reach * 2, reach * 2)
        if (cx > 0 && cx < w && cy > 0 && cy < h) regionsOnScreen.push({ name: sc.regionNames[r], x: cx, y: cy })
      }

      // edges, one path per colour; those touching the focused node lit
      const edgeCount = sc.layout.edges.length
      const quiet = Math.max(0.07, Math.min(0.34, 6 / Math.sqrt(edgeCount + 1)))
      const width = compactMode ? 0.6 : 0.7
      const off = (a: number, b: number) =>
        (sx[a] < -20 && sx[b] < -20) || (sx[a] > w + 20 && sx[b] > w + 20) || (sy[a] < -20 && sy[b] < -20) || (sy[a] > h + 20 && sy[b] > h + 20)
      g.lineCap = 'round'
      // 0: ordinary, 1: dimmed (outside the search), 2: lit (touches the focused node)
      const classOf = (a: number, b: number) => (focus >= 0 && (a === focus || b === focus) ? 2 : hl && !hl.has(a) && !hl.has(b) ? 1 : 0)
      for (const pass of [0, 1, 2]) {
        for (const grp of sc.edgeGroups) {
          let any = false
          g.beginPath()
          for (let k = 0; k < grp.pairs.length; k += 2) {
            const a = grp.pairs[k], b = grp.pairs[k + 1]
            if (classOf(a, b) !== pass || off(a, b)) continue
            g.moveTo(sx[a], sy[a])
            g.lineTo(sx[b], sy[b])
            any = true
          }
          if (!any) continue
          g.strokeStyle = grp.css
          if (pass === 2) {
            g.globalAlpha = 0.9
            g.lineWidth = width * 2.2
          } else {
            const base = grp.link ? (focus >= 0 ? 0.15 : 0.5) : focus >= 0 ? 0.05 : quiet
            g.globalAlpha = pass === 1 ? base * 0.25 : base
            g.lineWidth = width * (grp.link ? 1.4 : 1)
          }
          g.stroke()
        }
      }

      // travelling pulses along connections, like signals passing between notes
      if (ambient && edgeCount && !compactMode && !low) {
        const step = Math.min(0.1, Math.max(0, (now - lastDraw) / 1000))
        if (sc.signals.length !== Math.min(SIGNALS, edgeCount)) {
          sc.signals = Array.from({ length: Math.min(SIGNALS, edgeCount) }, (_, k) => ({
            edge: Math.floor(hash01('signal' + k, 1) * edgeCount), t: hash01('signal' + k, 2), speed: 0.12 + hash01('signal' + k, 3) * 0.2, cycle: 0,
          }))
        }
        sc.signals.forEach((s, k) => {
          s.t += s.speed * step
          if (s.t > 1) {
            s.t = 0
            s.cycle++
            s.edge = Math.floor(hash01(`signal${k}:${s.cycle}`, 1) * edgeCount)
          }
          const e = sc.layout.edges[s.edge]
          if (!e || (near && !(near.has(e.a) && near.has(e.b))) || (hl && !hl.has(e.a) && !hl.has(e.b))) return
          const x = sx[e.a] + (sx[e.b] - sx[e.a]) * s.t, y = sy[e.a] + (sy[e.b] - sy[e.a]) * s.t
          g.globalAlpha = 0.85 * Math.sin(Math.PI * s.t)
          g.drawImage(glowSprite(sc.colors[e.a], 64), x - 4, y - 4, 8, 8)
        })
      }

      // nodes, far to near: glows first (added light), then the shapes on top
      const order = sc.order
      if (order.length !== count) {
        order.length = 0
        for (let i = 0; i < count; i++) order.push(i)
      }
      // Far to near. Depth changes little between frames, so insertion sort on last frame's order is nearly O(n).
      if (sc.amp > 0) {
        for (let k = 1; k < count; k++) {
          const v = order[k], fv = f[v]
          let j = k - 1
          while (j >= 0 && f[order[j]] > fv) { order[j + 1] = order[j]; j-- }
          order[j + 1] = v
        }
      }
      const lite = count > LITE_LIMIT && zoom < 2
      const visibleNode = (i: number, r: number) => sx[i] > -r * 4 && sx[i] < w + r * 4 && sy[i] > -r * 4 && sy[i] < h + r * 4
      for (const i of order) {
        const kind = nodes[i].node.kind
        if (lite && kind === 'item') continue
        const r = radius(i)
        if (!visibleNode(i, r) || (low && kind === 'item' && r < 3 && i !== focus)) continue
        const halo = r * (kind === 'folder' ? 2.6 : 3.4) * (i === focus ? 1.4 : 1)
        g.globalAlpha = (dimmed(i) ? 0.15 : 1) * (kind === 'tag' ? 0.5 : 0.8)
        g.drawImage(sc.sprites[i], sx[i] - halo, sy[i] - halo, halo * 2, halo * 2)
      }
      g.globalCompositeOperation = 'source-over'
      for (const i of order) {
        const n = nodes[i].node
        const r = radius(i)
        if (!visibleNode(i, r)) continue
        const css = sc.css[i]
        const alpha = dimmed(i) ? 0.15 : 1
        g.globalAlpha = alpha
        if (lite && n.kind === 'item') {
          const side = Math.max(1.6, r)
          g.fillStyle = css
          g.fillRect(sx[i] - side / 2, sy[i] - side / 2, side, side)
        } else if (n.kind === 'item') drawItemShape(g, n.itemType ?? 'note', sx[i], sy[i], r, css)
        else if (n.kind === 'folder' || n.kind === 'tag') {
          g.fillStyle = css
          g.globalAlpha = alpha * (n.kind === 'folder' ? 0.9 : 0.55)
          g.beginPath()
          g.arc(sx[i], sy[i], r * (n.kind === 'folder' ? 0.75 : 0.6), 0, Math.PI * 2)
          g.fill()
          g.strokeStyle = css
          g.globalAlpha = alpha * 0.6
          g.lineWidth = Math.max(1, r * 0.16)
          g.beginPath()
          g.arc(sx[i], sy[i], r, 0, Math.PI * 2)
          g.stroke()
          g.globalAlpha = alpha
          g.fillStyle = 'rgba(255,252,248,0.92)'
          g.beginPath()
          g.arc(sx[i], sy[i], Math.max(1, r * 0.25), 0, Math.PI * 2)
          g.fill()
        } else {
          // an unwritten link: a dashed ring
          g.setLineDash([2.5, 3])
          g.strokeStyle = css
          g.globalAlpha = alpha * 0.8
          g.lineWidth = 1
          g.beginPath()
          g.arc(sx[i], sy[i], Math.max(3, r * 1.5), 0, Math.PI * 2)
          g.stroke()
          g.setLineDash([])
        }
        if (hl && hl.has(i) && i !== sc.selected) {
          g.globalAlpha = 0.72
          g.strokeStyle = css
          g.lineWidth = 1.2
          g.beginPath()
          g.arc(sx[i], sy[i], r * 1.8 + 4, 0, Math.PI * 2)
          g.stroke()
        }
      }

      // the selected note: a white ring, and a ripple when it was just picked
      if (sc.selected >= 0 && sc.selected < count) {
        const i = sc.selected
        g.globalAlpha = 1
        g.strokeStyle = 'rgba(255,255,255,0.92)'
        g.lineWidth = 1.5
        g.beginPath()
        g.arc(sx[i], sy[i], Math.max(7, radius(i) * 1.7) + (calm ? 0 : Math.sin(t * 3) * 0.8), 0, Math.PI * 2)
        g.stroke()
      }
      const rip = sc.ripple
      if (rip && rip.idx < count) {
        if (rip.t0 < 0) rip.t0 = now
        const age = (now - rip.t0) / RIPPLE_MS
        if (age >= 1) sc.ripple = null
        else {
          const neighbours = sc.neighbours[rip.idx].map((n) => ({ x: sx[n], y: sy[n], halo: radius(n) * 5, col: sc.colors[n] }))
          drawRipple(g, { x: sx[rip.idx], y: sy[rip.idx] }, sc.colors[rip.idx], age, neighbours)
        }
      }

      // labels: one collision check for all of them, clear of each other, the edges and the panels
      g.globalCompositeOperation = 'source-over'
      const requests = labelRequests(
        { nodes, sx, sy, radius, w, h, focus, selected: sc.selected, neighbours: sc.neighbours, ranked: sc.ranked, highlight: hl, zoom, compact: compactMode, regions: regionsOnScreen, obstacles: obstaclesRef.current },
        measure,
      )
      const labels = placeLabels(requests, measure, { w, h }, obstaclesRef.current)
      for (const l of labels) {
        if (l.kind === 'region') {
          const r = sc.regionNames.indexOf(l.id.slice(7))
          g.globalAlpha = near || hl ? 0.45 : 0.95
          drawRegionName(g, l.text, l.box.x + l.box.w / 2, l.box.y + l.box.h / 2, l.size, sc.regionColors[r])
          continue
        }
        const i = sc.layout.index.get(l.id)!
        const strong = l.size === LABEL_SIZE.strong || l.size === LABEL_SIZE.hub
        g.globalAlpha = l.priority >= 990 ? 1 : dimmed(i) ? 0.4 : l.priority >= 800 ? 0.95 : 0.85
        drawLabelPill(g, l.text, l.box.x + l.box.w / 2, l.box.y, l.size, sc.colors[i], strong)
      }
      g.globalAlpha = 1
      if (import.meta.env.DEV) (window as DevWindow).__graphLabels = labels
    }

    if (import.meta.env.DEV) {
      // test hook: where every node is on screen, so automated checks can click real nodes
      ;(window as DevWindow).__graphNodes = () => {
        const atlas = atlasRef.current
        if (atlas) return atlas.positions().map((p) => ({ ...p, label: nodeById.get(p.id)?.label ?? p.id }))
        const sc = sceneRef.current
        return sc.layout.nodes.map((n, i) => ({ id: n.id, label: n.node.label, x: sc.placed.sx[i], y: sc.placed.sy[i], r: sizeOf(sc.looks[i], sc.view.scale, sc.placed.f[i] || 1) }))
      }
    }

    // ---- pointer input: click selects, double-click opens, drag moves a node or pans, wheel and pinch zoom ----
    const pointers = new Map<number, { x: number; y: number }>()
    let drag: { node: number; start: { x: number; y: number }; view: View; moved: boolean } | null = null
    let pinch: { distance: number; scale: number } | null = null
    let lastTap = 0
    let lastTapNode = -2

    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const hit = (p: { x: number; y: number }, touch: boolean) => {
      const sc = sceneRef.current
      return pick(sc.looks, sc.placed, sc.view.scale, p.x, p.y, touch ? 16 : 8)
    }

    // Atlas input: click an orb to fly in, a fanned note to select it (twice to open), empty space to go back.
    let adrag: { start: { x: number; y: number }; last: { x: number; y: number }; moved: boolean } | null = null
    let aTap = { t: 0, id: '' }
    const atlasDown = (e: PointerEvent, atlas: AtlasScene) => {
      void atlas
      const p = local(e)
      canvas.setPointerCapture?.(e.pointerId)
      adrag = { start: p, last: p, moved: false }
    }
    const atlasMove = (e: PointerEvent, atlas: AtlasScene) => {
      const p = local(e)
      if (!adrag) {
        const over = atlas.pick(p.x, p.y)
        if (atlas.setHover(over)) {
          canvas.style.cursor = over ? 'pointer' : isCompact() ? 'default' : 'grab'
          kick()
        }
        return
      }
      if (Math.hypot(p.x - adrag.start.x, p.y - adrag.start.y) > (e.pointerType === 'touch' ? 8 : 4)) adrag.moved = true
      if (!adrag.moved || isCompact()) return
      atlas.panBy(p.x - adrag.last.x, p.y - adrag.last.y)
      adrag.last = p
      kick()
    }
    const atlasUp = (e: PointerEvent, atlas: AtlasScene) => {
      const d = adrag
      adrag = null
      if (!d || d.moved || e.type === 'pointercancel') return
      const p = local(e)
      const hit = atlas.pick(p.x, p.y)
      if (!hit) {
        if (atlas.focused()) atlas.focus(null)
        else if (propsRef.current.selectedId) propsRef.current.onSelect(null)
      } else if (hit.kind === 'orb') atlas.focus(hit.region)
      else {
        const now = Date.now()
        const double = now - aTap.t < TAP_MS && aTap.id === hit.id
        aTap = { t: now, id: hit.id }
        const node = nodeById.get(hit.id)
        if (node) {
          if (double) propsRef.current.onOpen(node)
          else propsRef.current.onSelect(node.id)
        }
      }
      kick()
    }

    const down = (e: PointerEvent) => {
      const atlas = atlasRef.current
      if (atlas) return atlasDown(e, atlas)
      const p = local(e)
      pointers.set(e.pointerId, p)
      canvas.setPointerCapture?.(e.pointerId)
      const sc = sceneRef.current
      if (pointers.size === 2 && !isCompact()) {
        const [a, b] = [...pointers.values()]
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: sc.view.scale }
        if (drag && drag.node >= 0) sc.layout.nodes[drag.node].pinned = false
        drag = null
        return
      }
      const node = e.button === 0 || e.pointerType === 'touch' ? hit(p, e.pointerType === 'touch') : -1
      drag = { node, start: p, view: { ...sc.view }, moved: false }
      if (node >= 0 && !isCompact()) sc.layout.nodes[node].pinned = true
    }

    const move = (e: PointerEvent) => {
      const atlas = atlasRef.current
      if (atlas) return atlasMove(e, atlas)
      const p = local(e)
      const sc = sceneRef.current
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p)
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinch.distance > 0) zoomAt((pinch.scale * distance) / pinch.distance / sc.view.scale, (a.x + b.x) / 2, (a.y + b.y) / 2)
        return
      }
      if (!drag) {
        const over = hit(p, false)
        if (over !== sc.hover) {
          sc.hover = over
          canvas.style.cursor = over >= 0 ? 'pointer' : isCompact() ? 'default' : 'grab'
          kick()
        }
        return
      }
      if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) > (e.pointerType === 'touch' ? 8 : 4)) drag.moved = true
      if (!drag.moved || isCompact()) return
      sc.autoFit = false
      sc.flight = null
      if (drag.node >= 0) {
        const n = sc.layout.nodes[drag.node]
        const at = unplace(p.x, p.y, sc.looks[drag.node], sc.placed.f[drag.node] || 1, sc.stats, sc.view, sc.angle)
        n.x = at.x
        n.y = at.y
        sc.layout.reheat(0.3)
      } else {
        sc.view = { ...drag.view, x: drag.view.x + p.x - drag.start.x, y: drag.view.y + p.y - drag.start.y }
        canvas.style.cursor = 'grabbing'
      }
      kick()
    }

    const up = (e: PointerEvent) => {
      const atlas = atlasRef.current
      if (atlas) return atlasUp(e, atlas)
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = null
      if (!drag) return
      const sc = sceneRef.current
      const d = drag
      drag = null
      if (d.node >= 0) sc.layout.nodes[d.node].pinned = false
      canvas.style.cursor = sc.hover >= 0 ? 'pointer' : isCompact() ? 'default' : 'grab'
      if (d.moved || e.type === 'pointercancel') return
      const now = Date.now()
      const double = now - lastTap < TAP_MS && lastTapNode === d.node
      lastTap = now
      lastTapNode = d.node
      if (d.node >= 0) {
        const node = sc.layout.nodes[d.node].node
        if (double) propsRef.current.onOpen(node)
        else propsRef.current.onSelect(node.id)
      } else if (double && !isCompact()) {
        sc.flight = null
        sc.autoFit = true
        sc.fitted = false
        kick()
      } else if (sc.selected >= 0) propsRef.current.onSelect(null)
    }

    const leave = () => {
      const atlas = atlasRef.current
      if (atlas) {
        if (!adrag && atlas.setHover(null)) kick()
        return
      }
      const sc = sceneRef.current
      if (sc.hover >= 0 && !drag) {
        sc.hover = -1
        kick()
      }
    }

    const wheel = (e: WheelEvent) => {
      if (isCompact() && !e.ctrlKey) return // let the page scroll past the preview
      e.preventDefault()
      const p = local(e)
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
      const atlas = atlasRef.current
      if (atlas) {
        atlas.zoomAt(factor, p.x, p.y)
        kick()
      } else zoomAt(factor, p.x, p.y)
    }
    const noMenu = (e: Event) => e.preventDefault()

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('wheel', wheel, { passive: false })
    canvas.addEventListener('contextmenu', noMenu)
    kick()
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      raf = 0
      kickRef.current = () => {}
      ro.disconnect()
      theme.disconnect()
      panels.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      document.fonts?.removeEventListener('loadingdone', onFonts)
      page.removeEventListener('animationend', onSettle, true)
      page.removeEventListener('transitionend', onSettle, true)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('contextmenu', noMenu)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new layout per data change, warm-started from the previous one so surviving notes stay where they were.
  useEffect(() => {
    const sc = sceneRef.current
    const prev = sc.layout.nodes.length ? sc.layout : undefined
    const layout = createCloudLayout(data, prev)
    // Reduced motion: no unfolding, the settled cloud appears at once. Otherwise a short head start.
    const stop = performance.now() + (calm ? 250 : prev ? 0 : 40)
    while (!layout.settled && performance.now() < stop) layout.tick()
    sc.layout = layout
    sc.looks = layout.nodes.map(lookOf)
    sc.neighbours = layout.nodes.map(() => [])
    for (const e of layout.edges) {
      sc.neighbours[e.a].push(e.b)
      sc.neighbours[e.b].push(e.a)
    }
    // Busiest first, once per layout, so labels never sort in the frame loop.
    const busier = (a: number, b: number) => layout.nodes[b].degree - layout.nodes[a].degree || a - b
    for (const list of sc.neighbours) list.sort(busier)
    sc.ranked = Int32Array.from(layout.nodes.keys()).sort(busier)
    sc.placed = newPlaced(layout.nodes.length)
    sc.order = []
    sc.signals = []
    sc.hover = -1
    sc.ripple = null
    sc.settledReported = false
    sc.drawn = false
    const sel = propsRef.current.selectedId
    sc.selected = sel ? (layout.index.get(sel) ?? -1) : -1
    if (!prev) sc.autoFit = true
    if (sc.autoFit) sc.fitted = false
    restyle()
    syncHighlight()
    kickRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Atlas: one scene per data, theme-independent colours and view switch; the previous scene's focus carries over.
  useEffect(() => {
    if (view !== 'atlas') {
      atlasRef.current = null
      const sc = sceneRef.current
      if (sc.autoFit) sc.fitted = false
      kickRef.current(true)
      return
    }
    const prev = atlasRef.current
    const regions = new Set(data.nodes.flatMap((n) => regionOf(n) ?? []))
    for (const r of liveRegionsRef.current.split('\n')) if (r) regions.add(r)
    const atlas = createAtlasScene(data, { reducedMotion: calm, compact: !!compact, hues: regionHues(regions), intro: !prev })
    atlas.setSpin(sceneRef.current.spin)
    const { w, h, dpr } = sizeRef.current
    atlas.resize(w, h, dpr)
    atlas.setHighlight(propsRef.current.highlight ? new Set(propsRef.current.highlight) : null)
    const focused = prev?.focused()
    if (focused) atlas.focus(focused)
    atlas.setSelected(propsRef.current.selectedId)
    atlasRef.current = atlas
    syncAtlasRef.current()
  }, [data, view, calm, compact, liveRegions])

  // Selecting (here or from outside): a ripple, and the note is brought into view if it is hidden.
  useEffect(() => {
    const sc = sceneRef.current
    const first = sc.selectedId === undefined
    if (sc.selectedId === selectedId) return // StrictMode runs effects twice; nothing changed
    sc.selectedId = selectedId
    const idx = selectedId ? (sc.layout.index.get(selectedId) ?? -1) : -1
    sc.selected = idx
    sc.ripple = idx >= 0 && !calm ? { idx, t0: -1 } : null
    sc.reveal = idx >= 0 ? { zoom: first } : null
    atlasRef.current?.setSelected(selectedId)
    kickRef.current(true)
  }, [selectedId, calm])

  // A folder added or emptied elsewhere can change which hue each region gets.
  useEffect(() => {
    restyle()
    kickRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRegions])

  useEffect(() => {
    syncHighlight()
    atlasRef.current?.setHighlight(highlight ? new Set(highlight) : null)
    kickRef.current(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlight])

  return (
    <div ref={wrapRef} className="graph-wrap">
      <canvas ref={canvasRef} className="graph-canvas" style={{ touchAction: compact ? 'pan-y' : 'none', cursor: compact ? 'default' : 'grab' }} />
    </div>
  )
})
