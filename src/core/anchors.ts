/**
 * Text highlights anchored by character offsets into an element's rendered text.
 * The same offsets are computed when saving and applied when rendering, so they stay valid as long as the text is unchanged.
 */
import type { Annotation, HighlightColor } from './types'

export function textNodes(root: Node): Text[] {
  const out: Text[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text)
  return out
}

/** Offsets (start, end) of a DOM range within root's text, or null when the range is outside root or empty. */
export function rangeOffsets(root: Node, range: Range): { start: number; end: number; text: string } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = pre.toString().length
  const text = range.toString()
  if (!text.trim()) return null
  return { start, end: start + text.length, text }
}

/** Find where a stored annotation lives now: trust its offsets if the quote still matches, else search the quote. */
export function resolveOffsets(rootText: string, ann: Pick<Annotation, 'start' | 'end' | 'text'>): { start: number; end: number } | null {
  if (ann.start !== undefined && ann.end !== undefined && rootText.slice(ann.start, ann.end) === ann.text) {
    return { start: ann.start, end: ann.end }
  }
  const at = rootText.indexOf(ann.text)
  return at >= 0 ? { start: at, end: at + ann.text.length } : null
}

export function clearHighlights(root: HTMLElement) {
  root.querySelectorAll('mark[data-ann]').forEach((m) => {
    const parent = m.parentNode!
    while (m.firstChild) parent.insertBefore(m.firstChild, m)
    parent.removeChild(m)
  })
  root.normalize()
}

/** Wrap each annotation's text in <mark data-ann class="hl hl-color">. Returns ids that could not be placed. */
export function applyHighlights(root: HTMLElement, anns: Annotation[]): string[] {
  clearHighlights(root)
  const missing: string[] = []
  const rootText = root.textContent ?? ''
  // Resolve against the unmodified text first, then wrap from the end so earlier offsets stay valid.
  const placed = anns
    .map((a) => ({ a, at: resolveOffsets(rootText, a) }))
    .filter((p): p is { a: Annotation; at: { start: number; end: number } } => {
      if (!p.at) missing.push(p.a.id)
      return !!p.at
    })
    .sort((x, y) => y.at.start - x.at.start)
  for (const { a, at } of placed) wrap(root, at.start, at.end, a.id, a.color)
  return missing
}

function wrap(root: HTMLElement, start: number, end: number, id: string, color: HighlightColor) {
  let pos = 0
  const segments: { node: Text; from: number; to: number }[] = []
  for (const node of textNodes(root)) {
    const len = node.data.length
    const from = Math.max(start - pos, 0)
    const to = Math.min(end - pos, len)
    if (from < to) segments.push({ node, from, to })
    pos += len
    if (pos >= end) break
  }
  for (const { node, from, to } of segments) {
    const r = document.createRange()
    r.setStart(node, from)
    r.setEnd(node, to)
    const mark = document.createElement('mark')
    mark.dataset.ann = id
    mark.className = `hl hl-${color}`
    r.surroundContents(mark)
  }
}
