import { useCallback, useEffect, useRef, useState } from 'react'
import { applyHighlights, rangeOffsets } from '../core/anchors'
import type { Annotation, HighlightColor, Item } from '../core/types'
import { createItem, newId, updateItem } from '../data/store'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { href } from './router'
import { toast } from './toast'

export const COLORS: HighlightColor[] = ['yellow', 'green', 'pink', 'blue']

export function addAnnotation(item: Item, ann: Omit<Annotation, 'id' | 'createdAt'>) {
  const full: Annotation = { ...ann, id: newId(), createdAt: Date.now() }
  void updateItem(item.id, { annotations: [...(item.annotations ?? []), full] })
}

export function removeAnnotation(item: Item, id: string) {
  void updateItem(item.id, { annotations: (item.annotations ?? []).filter((a) => a.id !== id) })
}

/** Turn a highlight into its own note that links back to the source (and the exact page). */
export async function highlightToNote(item: Item, ann: Annotation) {
  const words = ann.text.replace(/\s+/g, ' ').trim().split(' ')
  const title = `“${words.slice(0, 7).join(' ')}${words.length > 7 ? '…' : ''}”`
  const where = ann.page ? ` · [page ${ann.page}](${href({ name: 'item', id: item.id, page: ann.page })})` : ''
  const quote = ann.text.trim().split('\n').map((l) => `> ${l}`).join('\n')
  const note = await createItem({
    title,
    content: `${quote}\n\n— [[${item.title}]]${where}\n${ann.note ? `\n${ann.note}\n` : ''}`,
    organized: true,
    type: 'note',
    folder: item.folder,
    tags: [...new Set([...item.tags, 'highlight'])],
  })
  toast('Note created from highlight', 'ok', { label: 'Open', href: href({ name: 'item', id: note.id }) })
  return note
}

/** Highlight list shown beside a document. */
export function HighlightsPanel({ item, onGo }: { item: Item; onGo?(a: Annotation): void }) {
  const anns = [...(item.annotations ?? [])].sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.start ?? 0) - (b.start ?? 0) || a.createdAt - b.createdAt)
  if (anns.length === 0) {
    return (
      <section className="panel">
        <h4>Highlights</h4>
        <p className="muted small">Select text while reading and pick a color to highlight it. Each highlight can become its own linked note.</p>
      </section>
    )
  }
  return (
    <section className="panel">
      <h4>Highlights ({anns.length})</h4>
      <ul className="hl-list">
        {anns.map((a) => (
          <li key={a.id} className={`hl-item hl-${a.color}`}>
            <button className="hl-quote" onClick={() => onGo?.(a)}>
              {a.page ? <span className="chip">p.{a.page}</span> : null} {a.text.length > 160 ? a.text.slice(0, 160) + '…' : a.text}
            </button>
            <div className="hl-actions">
              <button className="btn ghost" onClick={() => void highlightToNote(item, a)}><Icon name="note" size={14} /> Note</button>
              <button className="btn ghost danger" onClick={() => removeAnnotation(item, a.id)} aria-label="Remove highlight"><Icon name="trash" size={14} /></button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export interface PendingHighlight {
  x: number
  y: number
  payload: Omit<Annotation, 'id' | 'createdAt' | 'color'>
}

export function HighlightToolbar({ pending, onPick, onCancel }: { pending: PendingHighlight; onPick(c: HighlightColor): void; onCancel(): void }) {
  return (
    <div className="hl-toolbar glass" style={{ left: pending.x, top: pending.y }} onMouseDown={(e) => e.preventDefault()}>
      {COLORS.map((c) => (
        <button key={c} className={`swatch hl-${c}`} onClick={() => onPick(c)} aria-label={`Highlight ${c}`} />
      ))}
      <button className="icon-btn" onClick={onCancel} aria-label="Cancel"><Icon name="x" size={14} /></button>
    </div>
  )
}

/** Rendered Markdown with selectable, persistent highlights. */
export function AnnotatedMarkdown({ item, source }: { item: Item; source: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<PendingHighlight | null>(null)
  const anns = item.annotations

  // Re-apply highlights after every render (Markdown is re-rendered as HTML).
  useEffect(() => {
    const root = box.current?.querySelector<HTMLElement>('.prose')
    if (root) applyHighlights(root, anns ?? [])
  })

  const onSelect = useCallback(() => {
    const root = box.current?.querySelector<HTMLElement>('.prose')
    const sel = window.getSelection()
    if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return setPending(null)
    const range = sel.getRangeAt(0)
    const off = rangeOffsets(root, range)
    if (!off) return setPending(null)
    const rect = range.getBoundingClientRect()
    setPending({ x: Math.max(8, rect.left + rect.width / 2 - 90), y: Math.max(8, rect.top - 52), payload: { text: off.text, start: off.start, end: off.end } })
  }, [])

  return (
    <div ref={box} onMouseUp={onSelect} onTouchEnd={() => setTimeout(onSelect, 50)} onKeyUp={onSelect}>
      <Markdown source={source} />
      {pending && (
        <HighlightToolbar
          pending={pending}
          onCancel={() => setPending(null)}
          onPick={(color) => {
            addAnnotation(item, { ...pending.payload, color })
            window.getSelection()?.removeAllRanges()
            setPending(null)
          }}
        />
      )}
    </div>
  )
}

/** Jump to a text highlight inside the rendered Markdown. */
export function scrollToAnnotation(a: Annotation) {
  document.querySelector(`mark[data-ann="${a.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

