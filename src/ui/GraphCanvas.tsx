import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { EdgeKind, GraphData, GraphNode } from '../core/types'

interface SimNode extends SimulationNodeDatum, GraphNode {
  r: number
}
type SimLink = SimulationLinkDatum<SimNode> & { kind: EdgeKind }

interface Transform {
  x: number
  y: number
  k: number
}

export interface GraphHandle {
  zoomBy(factor: number): void
  fit(): void
}

interface Props {
  data: GraphData
  selectedId: string | null
  /** Node under the pointer / tapped. */
  onSelect(id: string | null): void
  onOpen(node: GraphNode): void
  compact?: boolean
}

interface Palette {
  bg: string
  text: string
  muted: string
  edge: string
  accent: string
  types: Record<string, string>
}

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb
  return {
    bg: v('--bg', '#0e0f13'),
    text: v('--text', '#e8e9ee'),
    muted: v('--muted', '#8b8fa3'),
    edge: v('--edge', '#8b8fa3'),
    accent: v('--accent', '#8b7cff'),
    types: {
      note: v('--c-note', '#8b7cff'),
      pdf: v('--c-pdf', '#ff7a9c'),
      web: v('--c-web', '#3fd5c0'),
      prompt: v('--c-prompt', '#ffc15a'),
      file: v('--c-file', '#8fa1b8'),
      tag: v('--c-tag', '#6c7086'),
      folder: v('--c-folder', '#5aa7ff'),
      ghost: v('--muted', '#8b8fa3'),
    },
  }
}

const radiusOf = (n: GraphNode) =>
  n.kind === 'tag' ? 3.5 + Math.sqrt(n.degree) * 1.4 : n.kind === 'folder' ? 6 + Math.sqrt(n.degree) * 1.6 : 4.5 + Math.sqrt(n.degree) * 2.3

export const GraphCanvas = forwardRef<GraphHandle, Props>(function GraphCanvas({ data, selectedId, onSelect, onOpen, compact }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const adjRef = useRef<Map<string, Set<string>>>(new Map())
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)
  const tfRef = useRef<Transform>({ x: 0, y: 0, k: 1 })
  const sizeRef = useRef({ w: 300, h: 300, dpr: 1 })
  const hoverRef = useRef<string | null>(null)
  const selRef = useRef<string | null>(selectedId)
  const paletteRef = useRef<Palette>(readPalette())
  const rafRef = useRef(0)
  const fittedRef = useRef(false)
  const touchedRef = useRef(false)
  const anim = useRef<{ from: Transform; to: Transform; t0: number } | null>(null)
  const propsRef = useRef({ onSelect, onOpen })
  propsRef.current = { onSelect, onOpen }

  const draw = useCallback(() => {
    rafRef.current = 0
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const { w, h, dpr } = sizeRef.current
    const pal = paletteRef.current

    if (anim.current) {
      const a = anim.current
      const p = Math.min(1, (performance.now() - a.t0) / 420)
      const e = 1 - Math.pow(1 - p, 3)
      tfRef.current = {
        x: a.from.x + (a.to.x - a.from.x) * e,
        y: a.from.y + (a.to.y - a.from.y) * e,
        k: a.from.k + (a.to.k - a.from.k) * e,
      }
      if (p >= 1) anim.current = null
      else requestDraw()
    }
    const t = tfRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.translate(t.x, t.y)
    ctx.scale(t.k, t.k)

    const focus = hoverRef.current ?? selRef.current
    const neighbors = focus ? adjRef.current.get(focus) : undefined
    const isLit = (id: string) => !focus || id === focus || !!neighbors?.has(id)

    // edges
    ctx.lineCap = 'round'
    for (const l of linksRef.current) {
      const s = l.source as SimNode
      const d = l.target as SimNode
      if (s.x == null || d.x == null) continue
      const lit = !focus || s.id === focus || d.id === focus
      ctx.beginPath()
      ctx.moveTo(s.x, s.y!)
      ctx.lineTo(d.x, d.y!)
      ctx.lineWidth = (lit && focus ? 1.6 : 1) / Math.sqrt(t.k)
      ctx.strokeStyle = lit && focus ? pal.accent : pal.edge
      ctx.globalAlpha = lit ? (focus ? 0.85 : l.kind === 'link' ? 0.42 : 0.18) : 0.05
      ctx.setLineDash(l.kind === 'folder' ? [4, 4] : l.kind === 'tag' ? [1.5, 3.5] : [])
      ctx.stroke()
    }
    ctx.setLineDash([])

    // nodes
    for (const n of nodesRef.current) {
      if (n.x == null) continue
      const lit = isLit(n.id)
      const color = n.kind === 'item' ? (pal.types[n.itemType ?? 'note'] ?? pal.accent) : (pal.types[n.kind] ?? pal.muted)
      const isFocus = n.id === focus
      ctx.globalAlpha = lit ? 1 : 0.14
      if (isFocus || n.id === selRef.current) {
        const g = ctx.createRadialGradient(n.x, n.y!, n.r * 0.5, n.x, n.y!, n.r * 3.4)
        g.addColorStop(0, color + '88')
        g.addColorStop(1, color + '00')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(n.x, n.y!, n.r * 3.4, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.beginPath()
      if (n.kind === 'folder') {
        const s = n.r * 1.7
        ctx.roundRect(n.x - s / 2, n.y! - s / 2, s, s, 3)
      } else {
        ctx.arc(n.x, n.y!, n.r, 0, Math.PI * 2)
      }
      if (n.kind === 'ghost') {
        ctx.setLineDash([2.5, 2.5])
        ctx.lineWidth = 1.2
        ctx.strokeStyle = color
        ctx.stroke()
        ctx.setLineDash([])
      } else if (n.kind === 'tag') {
        ctx.lineWidth = 1.4
        ctx.strokeStyle = color
        ctx.stroke()
        ctx.globalAlpha *= 0.25
        ctx.fillStyle = color
        ctx.fill()
      } else {
        ctx.fillStyle = color
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = pal.bg
        ctx.stroke()
      }
    }

    // labels
    ctx.globalAlpha = 1
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const fontPx = 11.5 / Math.max(0.75, Math.min(t.k, 1.6))
    ctx.font = `500 ${fontPx}px Inter, system-ui, -apple-system, 'Segoe UI', sans-serif`
    ctx.lineJoin = 'round'
    for (const n of nodesRef.current) {
      if (n.x == null) continue
      const important = n.id === focus || !!neighbors?.has(n.id)
      const showAll = t.k > 1.15
      const showHubs = n.degree >= 4 && t.k > 0.55
      if (!(important || showAll || showHubs || (compact && n.kind === 'item'))) continue
      if (focus && !important) continue
      const label = n.label.length > 30 ? n.label.slice(0, 29) + '…' : n.label
      const y = n.y! + n.r + 4
      ctx.lineWidth = 3.5 / Math.max(0.75, t.k)
      ctx.strokeStyle = pal.bg
      ctx.globalAlpha = 0.9
      ctx.strokeText(label, n.x, y)
      ctx.globalAlpha = n.kind === 'item' || important ? 1 : 0.7
      ctx.fillStyle = important ? pal.text : pal.muted
      ctx.fillText(label, n.x, y)
    }
    ctx.globalAlpha = 1
  }, [compact])

  const requestDraw = useCallback(() => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(draw)
  }, [draw])

  const fit = useCallback(
    (animate = true) => {
      const nodes = nodesRef.current.filter((n) => n.x != null)
      if (!nodes.length) return
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of nodes) {
        minX = Math.min(minX, n.x! - n.r)
        maxX = Math.max(maxX, n.x! + n.r)
        minY = Math.min(minY, n.y! - n.r)
        maxY = Math.max(maxY, n.y! + n.r)
      }
      const { w, h } = sizeRef.current
      const pad = compact ? 24 : 70
      const bw = Math.max(maxX - minX, 40)
      const bh = Math.max(maxY - minY, 40)
      const k = Math.min(1.8, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh))
      const to = { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k }
      if (animate) anim.current = { from: tfRef.current, to, t0: performance.now() }
      else tfRef.current = to
      requestDraw()
    },
    [compact, requestDraw],
  )

  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      const t = tfRef.current
      const k = Math.min(6, Math.max(0.12, t.k * factor))
      const f = k / t.k
      anim.current = null
      touchedRef.current = true
      tfRef.current = { k, x: cx - (cx - t.x) * f, y: cy - (cy - t.y) * f }
      requestDraw()
    },
    [requestDraw],
  )

  useImperativeHandle(ref, () => ({
    zoomBy: (f) => zoomAt(sizeRef.current.w / 2, sizeRef.current.h / 2, f),
    fit: () => fit(true),
  }))

  // (Re)build the simulation when data changes, keeping positions of surviving nodes.
  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]))
    const { w, h } = sizeRef.current
    const nodes: SimNode[] = data.nodes.map((n, i) => {
      const old = prev.get(n.id)
      const angle = i * 2.399963
      const spread = 20 * Math.sqrt(i + 1)
      return {
        ...n,
        r: radiusOf(n),
        x: old?.x ?? w / 2 + Math.cos(angle) * spread,
        y: old?.y ?? h / 2 + Math.sin(angle) * spread,
        vx: 0,
        vy: 0,
      }
    })
    const ids = new Set(nodes.map((n) => n.id))
    const links: SimLink[] = data.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, kind: e.kind }))
    const adj = new Map<string, Set<string>>()
    for (const e of links) {
      const s = e.source as string
      const t = e.target as string
      if (!adj.has(s)) adj.set(s, new Set())
      if (!adj.has(t)) adj.set(t, new Set())
      adj.get(s)!.add(t)
      adj.get(t)!.add(s)
    }
    nodesRef.current = nodes
    linksRef.current = links
    adjRef.current = adj
    simRef.current?.stop()
    const sim = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => (l.kind === 'link' ? 85 : l.kind === 'tag' ? 110 : 130))
          .strength((l) => (l.kind === 'link' ? 0.55 : l.kind === 'tag' ? 0.12 : 0.08)),
      )
      .force('charge', forceManyBody<SimNode>().strength((d) => (d.kind === 'tag' ? -120 : -280)).distanceMax(600))
      .force('collide', forceCollide<SimNode>().radius((d) => d.r + 12).strength(0.8))
      .force('x', forceX<SimNode>(w / 2).strength(0.045))
      .force('y', forceY<SimNode>(h / 2).strength(0.045))
      .alpha(prev.size ? 0.5 : 1)
      .alphaDecay(0.028)
      .on('tick', () => {
        if (!fittedRef.current && sim.alpha() < 0.3 && nodes.length) {
          fittedRef.current = true
          fit(true)
        }
        requestDraw()
      })
      .on('end', () => {
        if (!touchedRef.current && nodes.length) fit(true)
      })
    simRef.current = sim
    if (!prev.size) {
      fittedRef.current = false
      touchedRef.current = false
    }
    requestDraw()
    return () => {
      sim.stop()
    }
  }, [data, fit, requestDraw])

  useEffect(() => {
    selRef.current = selectedId
    requestDraw()
  }, [selectedId, requestDraw])

  // size + theme observers
  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    const resize = () => {
      const r = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
      const prev = sizeRef.current
      sizeRef.current = { w: r.width, h: r.height, dpr }
      canvas.width = Math.max(1, Math.round(r.width * dpr))
      canvas.height = Math.max(1, Math.round(r.height * dpr))
      if (prev.w === 300 && !fittedRef.current) tfRef.current = { x: 0, y: 0, k: 1 }
      requestDraw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    const mo = new MutationObserver(() => {
      paletteRef.current = readPalette()
      requestDraw()
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => {
      paletteRef.current = readPalette()
      requestDraw()
    }
    mq.addEventListener('change', onScheme)
    return () => {
      ro.disconnect()
      mo.disconnect()
      mq.removeEventListener('change', onScheme)
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [requestDraw])

  // pointer interaction: pan, drag node, pinch, wheel, click, hover
  useEffect(() => {
    const canvas = canvasRef.current!
    const pointers = new Map<number, { x: number; y: number }>()
    let dragNode: SimNode | null = null
    let panning = false
    let moved = 0
    let pinchDist = 0
    let lastTap = 0

    const toWorld = (x: number, y: number) => {
      const t = tfRef.current
      return { x: (x - t.x) / t.k, y: (y - t.y) / t.k }
    }
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const hit = (x: number, y: number): SimNode | null => {
      const p = toWorld(x, y)
      const slop = 5 / tfRef.current.k
      const nodes = nodesRef.current
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i]
        if (n.x == null) continue
        const dx = n.x - p.x
        const dy = n.y! - p.y
        if (dx * dx + dy * dy <= (n.r + slop) ** 2) return n
      }
      return null
    }

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      const p = local(e)
      pointers.set(e.pointerId, p)
      moved = 0
      anim.current = null
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
        dragNode = null
        panning = false
        return
      }
      const n = hit(p.x, p.y)
      if (n) {
        dragNode = n
        const w = toWorld(p.x, p.y)
        n.fx = w.x
        n.fy = w.y
        simRef.current?.alphaTarget(0.25).restart()
      } else {
        panning = true
        touchedRef.current = true
      }
    }
    const move = (e: PointerEvent) => {
      const p = local(e)
      const prev = pointers.get(e.pointerId)
      if (!prev) {
        const n = hit(p.x, p.y)
        const id = n?.id ?? null
        if (id !== hoverRef.current) {
          hoverRef.current = id
          canvas.style.cursor = n ? 'pointer' : 'grab'
          requestDraw()
        }
        return
      }
      pointers.set(e.pointerId, p)
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinchDist)
        pinchDist = dist
        moved += 10
        return
      }
      const dx = p.x - prev.x
      const dy = p.y - prev.y
      moved += Math.abs(dx) + Math.abs(dy)
      if (dragNode) {
        const w = toWorld(p.x, p.y)
        dragNode.fx = w.x
        dragNode.fy = w.y
      } else if (panning) {
        tfRef.current = { ...tfRef.current, x: tfRef.current.x + dx, y: tfRef.current.y + dy }
        canvas.style.cursor = 'grabbing'
        requestDraw()
      }
    }
    const up = (e: PointerEvent) => {
      const p = local(e)
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      const wasClick = moved < 6
      if (dragNode) {
        const n = dragNode
        n.fx = null
        n.fy = null
        simRef.current?.alphaTarget(0)
        dragNode = null
        if (wasClick) {
          const now = Date.now()
          if (now - lastTap < 350 && selRef.current === n.id) propsRef.current.onOpen(n)
          else propsRef.current.onSelect(n.id)
          lastTap = now
        }
      } else if (panning && wasClick && !hit(p.x, p.y)) {
        propsRef.current.onSelect(null)
      }
      panning = false
      canvas.style.cursor = 'grab'
    }
    const leave = () => {
      if (hoverRef.current) {
        hoverRef.current = null
        requestDraw()
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = local(e)
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('wheel', wheel)
    }
  }, [requestDraw, zoomAt])

  return (
    <div ref={wrapRef} className="graph-wrap">
      <canvas ref={canvasRef} className="graph-canvas" style={{ touchAction: 'none', cursor: 'grab' }} />
    </div>
  )
})
