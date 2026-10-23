import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Annotation, HighlightColor, Item } from '../core/types'
import { getBlob } from '../data/store'
import { pdfjs } from '../import/pdf'
import { HighlightToolbar, addAnnotation, type PendingHighlight } from './Reader'
import { toast } from './toast'

const MAX_WIDTH = 920

interface PageProps {
  doc: PDFDocumentProxy
  num: number
  width: number
  placeholderHeight: number
  highlights: Annotation[]
}

function PdfPage({ doc, num, width, placeholderHeight, highlights }: PageProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textDiv = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [height, setHeight] = useState(placeholderHeight)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: '700px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: { cancel(): void } | undefined
    ;(async () => {
      const page = await doc.getPage(num)
      const base = page.getViewport({ scale: 1 })
      const scale = width / base.width
      const vp = page.getViewport({ scale })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const c = canvas.current
      const t = textDiv.current
      const w = wrap.current
      if (!c || !t || !w || cancelled) return
      c.width = Math.floor(vp.width * dpr)
      c.height = Math.floor(vp.height * dpr)
      setHeight(vp.height)
      w.style.setProperty('--scale-factor', String(scale))
      w.style.setProperty('--total-scale-factor', String(scale))
      const render = page.render({ canvas: c, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      task = render
      await render.promise
      if (cancelled) return
      t.replaceChildren()
      const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: t, viewport: vp })
      await layer.render()
    })().catch(() => {
      /* cancelled renders and torn-down documents are expected */
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [visible, doc, num, width])

  return (
    <div ref={wrap} className="pdf-page" data-page={num} style={{ width, height }}>
      <canvas ref={canvas} style={{ width, height }} />
      {highlights.map((a) => (a.rects ?? []).map((r, i) => (
        <div key={`${a.id}-${i}`} className={`hl-rect hl-${a.color}`} data-ann={a.id} style={{ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` }} />
      )))}
      <div ref={textDiv} className="textLayer" />
    </div>
  )
}

/** In-app PDF viewer: selectable text, persistent highlights saved with the item, jump to a page. */
export function PdfReader({ item, target }: { item: Item; target?: { page: number; n: number } }) {
  const scroller = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [width, setWidth] = useState(0)
  const [placeholder, setPlaceholder] = useState(1100)
  const [pending, setPending] = useState<(PendingHighlight & { page: number; rects: number[][] }) | null>(null)

  // load the stored original
  useEffect(() => {
    let cancelled = false
    let task: ReturnType<typeof pdfjs.getDocument> | null = null
    ;(async () => {
      const blob = item.blobId ? await getBlob(item.blobId) : undefined
      if (!blob) return setError('The original PDF is not on this device yet. Sync first, or open the text view.')
      task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) })
      const loaded = await task.promise
      if (cancelled) return void task.destroy()
      setDoc(loaded)
    })().catch(() => setError('Could not open this PDF.'))
    return () => {
      cancelled = true
      void task?.destroy()
    }
  }, [item.blobId])

  // fit to the available width (debounced so dragging the window edge does not re-render every pixel)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setWidth(Math.min(MAX_WIDTH, Math.floor(el.clientWidth)))
    measure()
    let t = 0
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t)
      t = window.setTimeout(measure, 250)
    })
    ro.observe(el)
    return () => {
      window.clearTimeout(t)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!doc || !width) return
    void doc.getPage(1).then((p) => {
      const v = p.getViewport({ scale: 1 })
      setPlaceholder(Math.round((width * v.height) / v.width))
    })
  }, [doc, width])

  useEffect(() => {
    if (!doc || !target) return
    const t = setTimeout(() => scroller.current?.querySelector(`.pdf-page[data-page="${target.page}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    return () => clearTimeout(t)
  }, [doc, target, width])

  const onSelect = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return setPending(null)
    const range = sel.getRangeAt(0)
    const startPage = (range.startContainer.parentElement ?? (range.startContainer as Element)).closest?.('.pdf-page') as HTMLElement | null
    const endPage = (range.endContainer.parentElement ?? (range.endContainer as Element)).closest?.('.pdf-page') as HTMLElement | null
    if (!startPage || !scroller.current?.contains(startPage)) return setPending(null)
    if (startPage !== endPage) {
      toast('Highlight one page at a time.', 'warn')
      return setPending(null)
    }
    const box = startPage.getBoundingClientRect()
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 2 && r.height > 2)
      .slice(0, 200)
      .map((r) => [(r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height].map((n) => Math.round(n * 1e4) / 1e4))
    const text = sel.toString().replace(/\s+/g, ' ').trim()
    if (!text || rects.length === 0) return setPending(null)
    const last = range.getBoundingClientRect()
    setPending({
      x: Math.max(8, last.left + last.width / 2 - 90),
      y: Math.max(8, last.top - 52),
      page: Number(startPage.dataset.page),
      rects,
      payload: { text },
    })
  }, [])

  if (error) return <p className="muted">{error}</p>
  if (!doc) return <div ref={scroller} className="pdf-scroll"><p className="muted">Opening PDF…</p></div>

  const color = (c: HighlightColor) => {
    if (!pending) return
    addAnnotation(item, { text: pending.payload.text, color: c, page: pending.page, rects: pending.rects })
    window.getSelection()?.removeAllRanges()
    setPending(null)
  }

  return (
    <div ref={scroller} className="pdf-scroll" onMouseUp={onSelect} onTouchEnd={() => setTimeout(onSelect, 60)}>
      {width > 0 &&
        Array.from({ length: doc.numPages }, (_, i) => i + 1).map((n) => (
          <PdfPage key={`${n}-${width}`} doc={doc} num={n} width={width} placeholderHeight={placeholder} highlights={(item.annotations ?? []).filter((a) => a.page === n)} />
        ))}
      {pending && <HighlightToolbar pending={pending} onPick={color} onCancel={() => setPending(null)} />}
    </div>
  )
}
