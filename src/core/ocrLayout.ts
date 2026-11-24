/**
 * Rebuilds readable Markdown from OCR word boxes.
 *
 * Tesseract reads straight across a page, so a sidebar ends up woven into the article line by line, and its
 * own paragraph detection does not separate columns. This works from the word positions instead:
 * words -> line segments (split at wide horizontal gaps) -> columns (split at empty vertical gutters,
 * with full-width lines cutting the page into bands) -> paragraphs, headings and lists.
 */
export interface OcrWord {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

interface Line {
  words: OcrWord[]
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Glyphs Tesseract reports for list bullets (it often reads a round bullet as «, + or *). */
const BULLET = /^[•●○◦▪■□‣⁃∙·«»+*–—-]$/
const NUMBERED = /^\(?\d{1,3}[.)]$/
const MIN_CONFIDENCE = 50

const height = (b: { y0: number; y1: number }) => b.y1 - b.y0
const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function makeLine(words: OcrWord[]): Line {
  return {
    words,
    x0: Math.min(...words.map((w) => w.bbox.x0)),
    x1: Math.max(...words.map((w) => w.bbox.x1)),
    y0: Math.min(...words.map((w) => w.bbox.y0)),
    y1: Math.max(...words.map((w) => w.bbox.y1)),
  }
}

/** Words on the same text row, split wherever the horizontal gap is far wider than a word space. */
function toLines(words: OcrWord[]): Line[] {
  const rows: OcrWord[][] = []
  const center = (w: OcrWord) => (w.bbox.y0 + w.bbox.y1) / 2
  for (const word of [...words].sort((a, b) => center(a) - center(b))) {
    const row = rows.find((r) => {
      const last = r[r.length - 1]
      return Math.abs(center(last) - center(word)) < Math.min(height(last.bbox), height(word.bbox)) * 0.5
    })
    if (row) row.push(word)
    else rows.push([word])
  }
  const lines: Line[] = []
  for (const row of rows) {
    row.sort((a, b) => a.bbox.x0 - b.bbox.x0)
    const rowHeight = Math.max(...row.map((w) => height(w.bbox)))
    let current: OcrWord[] = [row[0]]
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].bbox.x0 - row[i - 1].bbox.x1
      if (gap > rowHeight * 2) {
        lines.push(makeLine(current))
        current = []
      }
      current.push(row[i])
    }
    lines.push(makeLine(current))
  }
  return lines
}

/**
 * Empty vertical strips between blocks of text. A strip counts as a gutter when almost no line crosses it,
 * it is wider than a couple of letters, and there is text on both sides.
 */
function findGutters(lines: Line[], lineHeight: number): { start: number; end: number }[] {
  const left = Math.min(...lines.map((l) => l.x0))
  const right = Math.max(...lines.map((l) => l.x1))
  const width = Math.ceil(right - left) + 1
  const coverage = new Array<number>(width).fill(0)
  for (const l of lines) for (let x = Math.floor(l.x0 - left); x <= Math.ceil(l.x1 - left) && x < width; x++) coverage[x]++
  const crossing = Math.max(1, Math.floor(lines.length * 0.05))
  const minWidth = Math.max(lineHeight * 2, 12)
  const gutters: { start: number; end: number }[] = []
  let runStart = -1
  for (let x = 0; x <= width; x++) {
    const open = x < width && coverage[x] <= crossing
    if (open && runStart < 0) runStart = x
    if (!open && runStart >= 0) {
      const touchesEdge = runStart === 0 || x === width
      if (!touchesEdge && x - runStart >= minWidth) gutters.push({ start: runStart + left, end: x - 1 + left })
      runStart = -1
    }
  }
  return gutters
}

/** Reading order: bands separated by lines that cross a gutter; inside a band, columns left to right. */
function orderIntoColumns(lines: Line[], lineHeight: number): Line[][] {
  const gutters = findGutters(lines, lineHeight)
  if (!gutters.length) return [[...lines].sort((a, b) => a.y0 - b.y0)]
  const spans = (l: Line) => gutters.some((g) => l.x0 < g.start && l.x1 > g.end)
  // Midpoint, not edge: a ragged text edge often reaches into the gutter strip.
  const columnOf = (l: Line) => gutters.filter((g) => l.x0 >= (g.start + g.end) / 2).length
  const groups: Line[][] = []
  let band: Line[][] = []
  const flush = () => {
    for (const col of band) if (col?.length) groups.push(col)
    band = []
  }
  for (const line of [...lines].sort((a, b) => a.y0 - b.y0)) {
    if (spans(line)) {
      flush()
      groups.push([line])
      continue
    }
    const c = columnOf(line)
    ;(band[c] ??= []).push(line)
  }
  flush()
  return groups
}

const lineText = (l: Line) => l.words.map((w) => w.text).join(' ')

/**
 * Average letter width of a line: tracks font size. Box height doesn't, because a line without descenders
 * (a heading like "How to start") is as tall as smaller body text that has them.
 */
const letterWidth = (l: Line) => {
  const letters = l.words.reduce((n, w) => n + [...w.text].length, 0)
  const width = l.words.reduce((n, w) => n + (w.bbox.x1 - w.bbox.x0), 0)
  return letters ? width / letters : 0
}

function joinLines(parts: string[]): string {
  let out = ''
  for (const part of parts) {
    if (!out) out = part
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(part)) out = out.slice(0, -1) + part
    else out += ' ' + part
  }
  return out
}

/** Keep OCR text from being read as Markdown syntax. */
const escapeStart = (text: string) => text.replace(/^([#>|])/, '\\$1')

interface Block {
  kind: 'para' | 'heading' | 'bullet' | 'numbered'
  level?: number
  marker?: string
  lines: Line[]
}

function toBlocks(column: Line[], bodyHeight: number, bodyLetter: number): Block[] {
  const blocks: Block[] = []
  const headingLevel = (l: Line) => {
    if (l.words.length > 15) return 0
    const ratio = Math.max(height(l) / bodyHeight, bodyLetter ? letterWidth(l) / bodyLetter : 0)
    return ratio >= 1.6 ? 1 : ratio >= 1.18 ? 2 : 0
  }
  for (const line of column) {
    const first = line.words[0].text
    const level = headingLevel(line)
    const prev = blocks[blocks.length - 1]
    const prevLine = prev?.lines[prev.lines.length - 1]
    const gap = prevLine ? line.y0 - prevLine.y1 : Infinity
    if (BULLET.test(first) && line.words.length > 1) {
      blocks.push({ kind: 'bullet', lines: [{ ...line, words: line.words.slice(1) }] })
      continue
    }
    if (NUMBERED.test(first) && line.words.length > 1) {
      blocks.push({ kind: 'numbered', marker: first.replace(/[()]/g, '').replace(/\)$/, '.'), lines: [{ ...line, words: line.words.slice(1) }] })
      continue
    }
    if (level) {
      if (prev?.kind === 'heading' && prev.level === level && gap < bodyHeight) prev.lines.push(line)
      else blocks.push({ kind: 'heading', level, lines: [line] })
      continue
    }
    // A wrapped line continues the paragraph or list item above it when it sits close underneath.
    const continues = prev && prev.kind !== 'heading' && gap < bodyHeight * 0.9
    const listContinuation = prev && (prev.kind === 'bullet' || prev.kind === 'numbered') && Math.abs(line.x0 - prev.lines[0].x0) < bodyHeight
    if (continues && (prev.kind === 'para' || listContinuation)) prev.lines.push(line)
    else blocks.push({ kind: 'para', lines: [line] })
  }
  return blocks
}

function render(block: Block): string {
  const text = joinLines(block.lines.map(lineText))
  if (block.kind === 'heading') return `${'#'.repeat(block.level ?? 2)} ${text}`
  if (block.kind === 'bullet') return `- ${text}`
  if (block.kind === 'numbered') return `${block.marker} ${text}`
  return escapeStart(text)
}

export function layoutOcr(words: OcrWord[]): string {
  const kept = words.filter((w) => w.text.trim() && (w.confidence >= MIN_CONFIDENCE || BULLET.test(w.text)) && (/[\p{L}\p{N}]/u.test(w.text) || BULLET.test(w.text)))
  if (!kept.length) return ''
  const lines = toLines(kept)
  // Body text size: the typical line height, weighted by how many words share it.
  const bodyHeight = median(lines.flatMap((l) => l.words.map(() => height(l))))
  const bodyLetter = median(lines.flatMap((l) => l.words.map(() => letterWidth(l))))
  const out: string[] = []
  for (const column of orderIntoColumns(lines, bodyHeight)) {
    const blocks = toBlocks(column, bodyHeight, bodyLetter)
    blocks.forEach((b, i) => {
      const listItem = b.kind === 'bullet' || b.kind === 'numbered'
      const prevListItem = i > 0 && (blocks[i - 1].kind === 'bullet' || blocks[i - 1].kind === 'numbered')
      out.push((out.length ? (listItem && prevListItem ? '\n' : '\n\n') : '') + render(b))
    })
  }
  return out.join('').trim()
}
