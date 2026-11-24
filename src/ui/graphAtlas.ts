/**
 * Atlas: one glowing orb per region on a ring around a golden cloud of every note, thin spokes to the middle,
 * satellites circling each orb. Clicking an orb flies in and fans out its newest notes. A port of EleSync's
 * dashboard-graph-atlas.js; the scene owns its own camera and is drawn by GraphCanvas on top of the backdrop.
 */
import { hash01 } from '../core/hash'
import { UNFILED, regionHue, regionHues, regionOf, regionRgb } from '../core/clusters'
import type { GraphData, GraphNode } from '../core/types'
import { drawLabelPill, easeInOut, glowSprite, pillFont, type RGB } from './graphFx'
import { placeLabels, type LabelRequest, type PlacedLabel } from './graphLabels'

const RING = 300
const MAX_ORBS = 12
const DUST_LIMIT = 2200
const FAN_LIMIT = 150
const FAN_LABELS = 14
const OTHER = '__other'
const OTHER_RGB: RGB = [185, 178, 163]
const DUST_RGB: RGB[] = [[255, 217, 138], [255, 199, 102], [255, 241, 201], [242, 184, 75]]
const GOLD: RGB = [255, 217, 138]
const ORB_LABEL = 12
const NOTE_LABEL = 11
const GOLDEN = 2.39996

export interface AtlasOrb {
  region: string
  label: string
  hue: number
  count: number
  angle: number
  x: number
  y: number
  radius: number
  /** Newest first. */
  noteIds: string[]
}

type Box = { x: number; y: number; w: number; h: number }
const newest = (nodes: Map<string, GraphNode>) => (a: string, b: string) => (nodes.get(b)?.createdAt ?? 0) - (nodes.get(a)?.createdAt ?? 0) || (a < b ? -1 : 1)

/** Orbs, largest first, evenly round the ring from the top. Hues default to those regions shown together get. */
export function buildAtlasOrbs(data: GraphData, ring = RING, hues?: Map<string, number>): AtlasOrb[] {
  const nodes = new Map(data.nodes.map((n) => [n.id, n]))
  const groups = new Map<string, string[]>()
  for (const n of data.nodes) {
    if (n.kind !== 'item') continue
    const r = regionOf(n) ?? UNFILED
    const list = groups.get(r)
    if (list) list.push(n.id)
    else groups.set(r, [n.id])
  }
  const hueOf = hues ?? regionHues(groups.keys())
  let ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
  if (ranked.length > MAX_ORBS) {
    const rest = ranked.slice(MAX_ORBS - 1).flatMap(([, ids]) => ids)
    ranked = [...ranked.slice(0, MAX_ORBS - 1), [OTHER, rest]]
  }
  const biggest = Math.max(1, ...ranked.map(([, ids]) => ids.length))
  const byNewest = newest(nodes)
  return ranked.map(([region, ids], i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ranked.length
    const reach = ring * (0.92 + 0.16 * hash01('atlas' + region))
    return {
      region,
      label: region === OTHER ? 'Everything else' : region,
      hue: region === OTHER ? 40 : (hueOf.get(region) ?? regionHue(region)),
      count: ids.length,
      angle,
      x: Math.cos(angle) * reach,
      y: Math.sin(angle) * reach,
      radius: 12 + 20 * Math.sqrt(ids.length / biggest),
      noteIds: ids.slice().sort(byNewest),
    }
  })
}

/** Where fanned note k sits: a golden-angle spiral round the orb. */
const spiral = (orb: AtlasOrb, k: number) => {
  const angle = k * GOLDEN
  const r = orb.radius + 16 + 7.5 * Math.sqrt(k)
  return { x: orb.x + Math.cos(angle) * r, y: orb.y + Math.sin(angle) * r }
}

/** The orb's newest notes (up to `limit`) laid out round it, newest nearest. World coordinates. */
export function fanOut(orb: AtlasOrb, nodes: Map<string, GraphNode>, limit = FAN_LIMIT): { id: string; x: number; y: number }[] {
  return orb.noteIds
    .filter((id) => nodes.has(id))
    .sort(newest(nodes))
    .slice(0, limit)
    .map((id, k) => ({ id, ...spiral(orb, k) }))
}

export type AtlasHit = { kind: 'orb'; region: string } | { kind: 'note'; id: string }

export interface AtlasScene {
  /** Paint on top of the backdrop (ctx already scaled by dpr); `time` in ms. True while it still needs frames. */
  draw(ctx: CanvasRenderingContext2D, time: number): boolean
  pick(px: number, py: number): AtlasHit | null
  /** Fly to an orb and fan out its notes; null or an unknown region returns to the ring. */
  focus(region: string | null): void
  resize(w: number, h: number, dpr?: number): void
  /** Area of the canvas free of floating side panels; the scene centres and frames itself in it. */
  setFrame(frame: Box): void
  setObstacles(boxes: Box[]): void
  setHighlight(ids: Set<string> | null): void
  /** Marks a note; when it is not in the open fan its orb is focused. */
  setSelected(id: string | null, fly?: boolean): void
  /** Returns true when the hovered thing changed. */
  setHover(hit: AtlasHit | null): boolean
  setSpin(on: boolean): void
  fit(): void
  zoomAt(factor: number, px: number, py: number): void
  panBy(dx: number, dy: number): void
  focused(): string | null
  /** Screen positions of everything pickable, for tests. */
  positions(): { id: string; x: number; y: number; r: number }[]
  /** Labels placed by the last draw, for tests. */
  labels(): PlacedLabel[]
}

interface View { x: number; y: number; scale: number }
interface Opts {
  reducedMotion: boolean
  compact: boolean
  /** Region name to hue, as the cloud uses. */
  hues?: Map<string, number>
  /** False when replacing a scene already on screen: orbs appear in place. */
  intro?: boolean
}

export function createAtlasScene(data: GraphData, opts: Opts): AtlasScene {
  const calm = opts.reducedMotion
  const nodes = new Map(data.nodes.map((n) => [n.id, n]))
  const orbs = buildAtlasOrbs(data, RING, opts.hues)
  const rgb = orbs.map((o) => (o.region === OTHER ? OTHER_RGB : regionRgb(o.hue)))
  const css = rgb.map((c) => `rgb(${c[0]},${c[1]},${c[2]})`)
  const orbIndex = new Map(orbs.map((o, i) => [o.region, i]))
  const orbOfNote = new Map<string, number>()
  orbs.forEach((o, i) => o.noteIds.forEach((id) => orbOfNote.set(id, i)))

  const satellites = orbs.map((o) =>
    Array.from({ length: Math.min(14, 3 + Math.round(Math.sqrt(o.count))) }, (_, s) => ({
      phase: hash01(o.region + s, 1) * 6.283,
      speed: (0.12 + hash01('s' + o.region + s, 2) * 0.3) * (s % 2 ? 1 : -1),
      reach: 1.7 + hash01('r' + o.region + s, 3) * 1.1,
    })),
  )

  // The central cloud: every note, sampled above DUST_LIMIT, as a gold speck round the middle.
  const dust: { orb: number; x: number; y: number; rgb: string; phase: number; size: number }[] = []
  {
    const ids = [...orbOfNote.keys()]
    const step = Math.max(1, Math.ceil(ids.length / DUST_LIMIT))
    for (let i = 0; i < ids.length; i += step) {
      const u = Math.max(1e-6, hash01(ids[i], 21)), v = hash01(ids[i], 22)
      const r = Math.min(RING * 0.46, Math.sqrt(-2 * Math.log(u)) * RING * 0.1)
      const c = DUST_RGB[i % DUST_RGB.length]
      dust.push({ orb: orbOfNote.get(ids[i])!, x: Math.cos(v * 6.283) * r, y: Math.sin(v * 6.283) * r, rgb: `rgb(${c[0]},${c[1]},${c[2]})`, phase: hash01(ids[i], 23) * 6.283, size: 1 + hash01(ids[i], 24) * 1.4 })
    }
  }

  let w = 300, h = 300
  let frame: Box = { x: 0, y: 0, w, h }
  let obstacles: Box[] = []
  let view: View = { x: 0, y: 0, scale: 1 }
  let intro = calm || opts.intro === false ? 1 : 0
  let flight: { from: View; to: View; t0: number } | null = null
  let auto = true
  let spin = true
  let spinTime = 0
  let last = -1
  let focus = -1
  let fan: { id: string; x: number; y: number }[] = []
  let selected: string | null = null
  let hover: AtlasHit | null = null
  let highlight: Set<string> | null = null
  let orbLit: boolean[] = orbs.map(() => true)
  let placed: PlacedLabel[] = []
  const widths = new Map<string, number>()

  const overview = (): View => {
    const side = Math.min(frame.w, frame.h)
    // a narrow frame (a phone) needs a smaller ring margin so the orbs stay legible
    return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2, scale: side / (2 * RING * (frame.w < 520 ? 1.3 : 1.5)) }
  }
  const focusView = (): View => {
    const o = orbs[focus]
    let extent = o.radius * 2
    for (const f of fan) extent = Math.max(extent, Math.hypot(f.x - o.x, f.y - o.y))
    const scale = Math.max(1.1, Math.min(3.4, Math.min(frame.w, frame.h) / (2 * (extent + 36))))
    return { x: frame.x + frame.w / 2 - o.x * scale, y: frame.y + frame.h / 2 - o.y * scale, scale }
  }
  const target = () => (focus >= 0 ? focusView() : overview())
  const flyTo = (to: View) => {
    if (calm) {
      view = to
      flight = null
    } else flight = { from: { ...view }, to, t0: -1 }
  }
  const retarget = () => {
    if (!auto) return
    if (flight) flight.to = target()
    else view = target()
  }
  view = overview()

  const ease = () => 1 - Math.pow(1 - intro, 3)
  const scr = (wx: number, wy: number) => ({ x: wx * view.scale + view.x, y: wy * view.scale + view.y })
  const orbScreen = (i: number) => {
    const e = ease()
    return scr(orbs[i].x * e, orbs[i].y * e)
  }
  const fanScreen = (f: { x: number; y: number }) => scr(f.x, f.y)

  const layoutFan = (extra: string | null) => {
    const o = orbs[focus]
    fan = fanOut(o, nodes)
    if (extra && !fan.some((f) => f.id === extra) && orbOfNote.get(extra) === focus) fan.push({ id: extra, ...spiral(o, fan.length) })
  }

  const setFocus = (i: number, extra: string | null) => {
    focus = i
    intro = 1
    layoutFan(extra)
    auto = true
    flyTo(focusView())
  }
  const back = () => {
    focus = -1
    fan = []
    selected = null
    auto = true
    flyTo(overview())
  }

  const syncLit = () => {
    orbLit = orbs.map((o) => !highlight || o.noteIds.some((id) => highlight!.has(id)))
  }
  const noteDim = (id: string) => !!highlight && !highlight.has(id) && id !== selected

  const measure = (text: string, size: number, ctx: CanvasRenderingContext2D) => {
    const key = size + '|' + text
    let width = widths.get(key)
    if (width === undefined) {
      if (widths.size > 2000) widths.clear()
      ctx.font = pillFont(size, size === ORB_LABEL)
      width = ctx.measureText(text).width
      widths.set(key, width)
    }
    return width
  }

  function draw(ctx: CanvasRenderingContext2D, time: number): boolean {
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, (time - last) / 1000))
    last = time
    if (intro < 1) intro = Math.min(1, intro + dt / 1.3)
    if (flight) {
      if (flight.t0 < 0) flight.t0 = time
      const t = Math.min(1, (time - flight.t0) / 650), e = easeInOut(t)
      view = { x: flight.from.x + (flight.to.x - flight.from.x) * e, y: flight.from.y + (flight.to.y - flight.from.y) * e, scale: flight.from.scale + (flight.to.scale - flight.from.scale) * e }
      if (t >= 1) flight = null
    }
    if (spin && !calm) spinTime += dt
    const e = ease(), s = view.scale
    const cx = view.x, cy = view.y
    const fo = focus >= 0 ? orbs[focus] : null
    const fine = !opts.compact

    // rings and spokes
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(255,226,163,0.11)'
    for (const k of [0.62, 1, 1.3]) {
      ctx.beginPath()
      ctx.arc(cx, cy, RING * k * e * s, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'lighter'
    const pos = orbs.map((_, i) => orbScreen(i))
    orbs.forEach((_, i) => {
      ctx.strokeStyle = css[i]
      ctx.globalAlpha = (focus >= 0 && focus !== i) || !orbLit[i] ? 0.05 : 0.22
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(pos[i].x, pos[i].y)
      ctx.stroke()
    })

    // golden cloud
    const core = 190 * s * Math.max(0.2, e)
    ctx.globalAlpha = 0.55
    ctx.drawImage(glowSprite(GOLD), cx - core / 2, cy - core / 2, core, core)
    const side = Math.max(1.2, Math.pow(s, 0.5))
    for (const d of dust) {
      const lit = focus === d.orb
      ctx.globalAlpha = ((focus >= 0 && !lit) || !orbLit[d.orb] ? 0.25 : 0.85) * (calm ? 1 : 0.75 + 0.25 * Math.sin(spinTime * 1.2 + d.phase))
      ctx.fillStyle = lit ? css[focus] : d.rgb
      const sz = d.size * side
      ctx.fillRect(cx + d.x * e * s - sz / 2, cy + d.y * e * s - sz / 2, sz, sz)
    }

    // orbs with their satellites
    orbs.forEach((o, i) => {
      const dim = focus >= 0 && focus !== i ? 0.25 : orbLit[i] ? 1 : 0.3
      const isHover = hover?.kind === 'orb' && hover.region === o.region
      const r = o.radius * s * (isHover ? 1.12 : 1), size = r * 3.2
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = dim
      ctx.drawImage(glowSprite(rgb[i]), pos[i].x - size / 2, pos[i].y - size / 2, size, size)
      ctx.fillStyle = css[i]
      ctx.globalAlpha = dim * 0.7
      for (const sat of satellites[i]) {
        const a = sat.phase + spinTime * sat.speed, d = r * sat.reach
        ctx.fillRect(pos[i].x + Math.cos(a) * d - 0.8, pos[i].y + Math.sin(a) * d * 0.72 - 0.8, 1.7, 1.7)
      }
      if (i === focus) {
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(pos[i].x, pos[i].y, r * 0.95, 0, Math.PI * 2)
        ctx.stroke()
      }
    })

    // the fan
    const fanPos = fan.map(fanScreen)
    if (fo && fan.length) {
      const op = pos[focus]
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = css[focus]
      ctx.globalAlpha = 0.14
      ctx.lineWidth = 1
      ctx.beginPath()
      for (const p of fanPos) {
        ctx.moveTo(op.x, op.y)
        ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
      const size = Math.max(7, 9 * Math.pow(s, 0.6))
      const sprite = glowSprite(rgb[focus])
      fan.forEach((f, k) => {
        const hot = f.id === selected || (hover?.kind === 'note' && hover.id === f.id) || (!!highlight && highlight.has(f.id))
        ctx.globalAlpha = noteDim(f.id) ? 0.25 : hot ? 1 : 0.85
        const sz = hot ? size * 1.5 : size
        ctx.drawImage(sprite, fanPos[k].x - sz / 2, fanPos[k].y - sz / 2, sz, sz)
      })
      const sel = fan.findIndex((f) => f.id === selected)
      if (sel >= 0) {
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        ctx.strokeStyle = 'rgba(255,255,255,0.92)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(fanPos[sel].x, fanPos[sel].y, Math.max(7, size * 0.75), 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // labels: orbs always; in a fan the focused orb and up to 14 notes; all clear of each other, the edges and panels
    ctx.globalCompositeOperation = 'source-over'
    placed = []
    if (fine) {
      const reqs: LabelRequest[] = orbs.map((o, i) => ({
        id: 'orb:' + o.region, text: `${o.label} · ${o.count}`, x: pos[i].x, y: pos[i].y, dotRadius: o.radius * s * 1.5,
        priority: i === focus ? 900 : 700 - i, size: ORB_LABEL, kind: 'region',
      }))
      if (fo) {
        const want = new Set<number>()
        const sel = fan.findIndex((f) => f.id === selected)
        if (sel >= 0) want.add(sel)
        fan.forEach((f, k) => { if (highlight?.has(f.id)) want.add(k) })
        for (let k = 0; want.size < FAN_LABELS && k < fan.length; k++) want.add(k)
        for (const k of want) {
          const f = fan[k], nd = nodes.get(f.id)
          if (!nd) continue
          reqs.push({ id: f.id, text: nd.label, x: fanPos[k].x, y: fanPos[k].y, dotRadius: 5, priority: k === sel ? 1000 : 600 - k, size: NOTE_LABEL, kind: 'note' })
        }
        const hovered = hover?.kind === 'note' ? hover.id : null
        const hov = hovered ? fan.findIndex((f) => f.id === hovered) : -1
        if (hov >= 0 && !want.has(hov)) reqs.push({ id: fan[hov].id, text: nodes.get(fan[hov].id)?.label ?? '', x: fanPos[hov].x, y: fanPos[hov].y, dotRadius: 5, priority: 990, size: NOTE_LABEL, kind: 'note' })
      }
      placed = placeLabels(reqs, (t, z) => measure(t, z, ctx), { w, h }, obstacles)
      for (const l of placed) {
        const orb = l.kind === 'region'
        const i = orb ? orbIndex.get(l.id.slice(4))! : focus
        ctx.globalAlpha = orb ? ((focus >= 0 && focus !== i) || !orbLit[i] ? 0.45 : 1) : noteDim(l.id) ? 0.4 : 0.95
        drawLabelPill(ctx, l.text, l.box.x + l.box.w / 2, l.box.y, l.size, rgb[i], orb || l.id === selected)
      }
    }
    ctx.globalAlpha = 1
    return flight !== null || intro < 1 || (!calm && spin)
  }

  function pick(px: number, py: number): AtlasHit | null {
    if (focus >= 0) {
      let best: AtlasHit | null = null, gap = 12
      for (const f of fan) {
        const p = fanScreen(f), d = Math.hypot(p.x - px, p.y - py)
        if (d < gap) { gap = d; best = { kind: 'note', id: f.id } }
      }
      if (best) return best
    }
    for (let i = 0; i < orbs.length; i++) {
      const p = orbScreen(i)
      if (Math.hypot(p.x - px, p.y - py) < orbs[i].radius * view.scale * 1.15 + 6) return { kind: 'orb', region: orbs[i].region }
    }
    return null
  }

  syncLit()
  return {
    draw,
    pick,
    focus(region) {
      const i = region ? orbIndex.get(region) : undefined
      if (i === undefined) {
        if (focus >= 0 || !auto) back()
        return
      }
      selected = null
      setFocus(i, null)
    },
    resize(nw, nh) {
      w = nw
      h = nh
      frame = { x: 0, y: 0, w, h }
      retarget()
    },
    setFrame(f) {
      frame = f
      retarget()
    },
    setObstacles(boxes) {
      obstacles = boxes
    },
    setHighlight(ids) {
      highlight = ids
      syncLit()
    },
    setSelected(id, fly = false) {
      selected = id
      const i = id ? orbOfNote.get(id) : undefined
      if (i === undefined) return
      if (fly || i !== focus || !fan.some((f) => f.id === id)) setFocus(i, id)
    },
    setHover(hit) {
      const key = (x: AtlasHit | null) => (x ? (x.kind === 'orb' ? 'orb:' + x.region : x.id) : '')
      if (key(hit) === key(hover)) return false
      hover = hit
      return true
    },
    setSpin(on) {
      spin = on
    },
    fit() {
      back()
    },
    zoomAt(factor, px, py) {
      const base = overview().scale
      const scale = Math.max(base * 0.4, Math.min(base * 12, view.scale * factor)), ratio = scale / view.scale
      view = { x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio, scale }
      auto = false
      flight = null
    },
    panBy(dx, dy) {
      view = { ...view, x: view.x + dx, y: view.y + dy }
      auto = false
      flight = null
    },
    focused: () => (focus >= 0 ? orbs[focus].region : null),
    positions() {
      const out = orbs.map((o, i) => ({ id: 'orb:' + o.region, ...orbScreen(i), r: o.radius * view.scale }))
      for (const f of fan) out.push({ id: f.id, ...fanScreen(f), r: 5 })
      return out
    },
    labels: () => placed,
  }
}
