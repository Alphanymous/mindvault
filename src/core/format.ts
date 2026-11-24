/** Markdown formatting for the editor toolbar: pure text in, text and new selection out. */
export type FormatKind = 'bold' | 'italic' | 'code' | 'wikilink' | 'heading' | 'task' | 'tag'

export interface Edit {
  value: string
  start: number
  end: number
}

const WRAP: Record<'code' | 'wikilink', [string, string]> = {
  code: ['`', '`'],
  wikilink: ['[[', ']]'],
}

/** Stars each emphasis kind adds. Runs of 1 = italic, 2 = bold, 3 = both. */
const STARS = { italic: 1, bold: 2 } as const

const starRun = (s: string, from: number, step: 1 | -1) => {
  let n = 0
  for (let i = from; i >= 0 && i < s.length && s[i] === '*'; i += step) n++
  return n
}

/** Whitespace at the edges of a selection stays outside the marks ("hi " → "**hi** "). */
function trimSelection(value: string, start: number, end: number): [number, number] {
  while (start < end && /\s/.test(value[start])) start++
  while (end > start && /\s/.test(value[end - 1])) end--
  return [start, end]
}

function wrap(value: string, start: number, end: number, open: string, close: string): Edit {
  return {
    value: value.slice(0, start) + open + value.slice(start, end) + close + value.slice(end),
    start: start + open.length,
    end: end + open.length,
  }
}

function unwrap(value: string, start: number, end: number, open: number, close: number): Edit {
  return {
    value: value.slice(0, start - open) + value.slice(start, end) + value.slice(end + close),
    start: start - open,
    end: end - open,
  }
}

/** Bold / italic with *, toggled off when the selection already has them. */
function emphasis(value: string, start: number, end: number, kind: keyof typeof STARS): Edit {
  // A selection that includes its own stars ("**hi**") counts as the text inside them.
  const inner = Math.min(starRun(value, start, 1), starRun(value, end - 1, -1))
  if (inner > 0 && end - start > inner * 2) [start, end] = [start + inner, end - inner]
  const run = Math.min(starRun(value, start - 1, -1), starRun(value, end, 1), 3)
  const n = STARS[kind]
  const active = run === n || run === 3
  if (active) return unwrap(value, start, end, n, n)
  const marks = '*'.repeat(n)
  return wrap(value, start, end, marks, marks)
}

function toggleWrap(value: string, start: number, end: number, open: string, close: string): Edit {
  const sel = value.slice(start, end)
  if (sel.length > open.length + close.length && sel.startsWith(open) && sel.endsWith(close)) {
    return unwrap(value, start + open.length, end - close.length, open.length, close.length)
  }
  if (value.slice(start - open.length, start) === open && value.slice(end, end + close.length) === close) {
    return unwrap(value, start, end, open.length, close.length)
  }
  return wrap(value, start, end, open, close)
}

const HEADING = /^#{1,6} /
const TASK = /^([ \t]*)[-*+] \[[ xX]\] /
const BULLET = /^([ \t]*)[-*+] /

interface LineChange {
  /** Length of the old marker at the start of the line, and the text that replaces it. */
  cut: number
  put: string
}

function headingChange(line: string, off: boolean): LineChange {
  const old = HEADING.exec(line)?.[0] ?? ''
  return { cut: old.length, put: off ? '' : '## ' }
}

function taskChange(line: string, off: boolean): LineChange {
  const task = TASK.exec(line)
  if (task) return { cut: task[0].length, put: off ? '' : task[0] }
  const bullet = BULLET.exec(line)
  if (bullet) return { cut: bullet[0].length, put: `${bullet[1]}- [ ] ` }
  const indent = /^[ \t]*/.exec(line)![0]
  return { cut: indent.length, put: `${indent}- [ ] ` }
}

/** Heading or task marker on every line the selection touches; removed from all when every line already has it. */
function toggleLines(value: string, start: number, end: number, kind: 'heading' | 'task'): Edit {
  const first = start > 0 ? value.lastIndexOf('\n', start - 1) + 1 : 0
  // A selection ending right after a newline does not reach into the next line.
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end
  const stop = value.indexOf('\n', last)
  const block = value.slice(first, stop === -1 ? value.length : stop)
  const lines = block.split('\n')
  const has = (l: string) => (kind === 'heading' ? l.startsWith('## ') : TASK.test(l))
  const off = lines.every(has)
  const changes = lines.map((l) => (kind === 'heading' ? headingChange(l, off) : taskChange(l, off)))

  let out = ''
  let oldAt = first
  let newAt = first
  const map: { oldStart: number; newStart: number; change: LineChange }[] = []
  lines.forEach((l, i) => {
    const c = changes[i]
    map.push({ oldStart: oldAt, newStart: newAt, change: c })
    const next = c.put + l.slice(c.cut)
    out += next + (i < lines.length - 1 ? '\n' : '')
    oldAt += l.length + 1
    newAt += next.length + 1
  })
  const move = (p: number) => {
    const row = [...map].reverse().find((r) => r.oldStart <= p) ?? map[0]
    return row.newStart + row.change.put.length + Math.max(0, p - row.oldStart - row.change.cut)
  }
  return { value: value.slice(0, first) + out + value.slice(first + block.length), start: move(start), end: move(end) }
}

/** Insert a # at the cursor, or turn the selected words into a tag ("deep work" → "#deep-work") without dropping any text. */
function tag(value: string, start: number, end: number): Edit {
  const selected = value.slice(start, end)
  const lead = /^\s*/.exec(selected)![0]
  const trail = /\s*$/.exec(selected.slice(lead.length))![0]
  const core = selected.slice(lead.length, selected.length - trail.length)
  const from = start + lead.length
  const to = end - trail.length
  const glue = from > 0 && !/\s/.test(value[from - 1]) ? ' ' : ''
  const slug = core.replace(/^#+/, '').trim().replace(/\s+/g, '-')
  const body = /^[\p{L}\p{N}_/-]+$/u.test(slug) ? slug : core.replace(/^#+/, '')
  const insert = `${glue}#${body}`
  const pos = from + insert.length
  return { value: value.slice(0, from) + insert + value.slice(to), start: pos, end: pos }
}

/** The smallest single replacement that turns `prev` into `next`, or null when they are equal. */
export function diffEdit(prev: string, next: string): { from: number; to: number; text: string } | null {
  if (prev === next) return null
  let from = 0
  while (from < prev.length && from < next.length && prev[from] === next[from]) from++
  let prevEnd = prev.length
  let nextEnd = next.length
  while (prevEnd > from && nextEnd > from && prev[prevEnd - 1] === next[nextEnd - 1]) {
    prevEnd--
    nextEnd--
  }
  return { from, to: prevEnd, text: next.slice(from, nextEnd) }
}

export function applyFormat(value: string, start: number, end: number, kind: FormatKind): Edit {
  if (kind === 'heading' || kind === 'task') return toggleLines(value, start, end, kind)
  if (kind === 'tag') return tag(value, start, end)
  ;[start, end] = trimSelection(value, start, end)
  if (kind === 'bold' || kind === 'italic') return emphasis(value, start, end, kind)
  if (kind === 'code' && value.slice(start, end).includes('\n')) return wrap(value, start, end, '```\n', '\n```')
  const [open, close] = WRAP[kind]
  return toggleWrap(value, start, end, open, close)
}
