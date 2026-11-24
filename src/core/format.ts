/** Markdown formatting for the editor toolbar: pure text in, text and new selection out. */
export type FormatKind = 'bold' | 'italic' | 'code' | 'wikilink' | 'heading' | 'task' | 'tag'

export interface Edit {
  value: string
  start: number
  end: number
}

const WRAP: Record<'bold' | 'italic' | 'code' | 'wikilink', [string, string]> = {
  bold: ['**', '**'],
  italic: ['_', '_'],
  code: ['`', '`'],
  wikilink: ['[[', ']]'],
}

const LINE_PREFIX: Record<'heading' | 'task', string> = { heading: '## ', task: '- [ ] ' }

function wrap(value: string, start: number, end: number, open: string, close: string): Edit {
  return {
    value: value.slice(0, start) + open + value.slice(start, end) + close + value.slice(end),
    start: start + open.length,
    end: end + open.length,
  }
}

function toggleLinePrefix(value: string, start: number, end: number, prefix: string): Edit {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const has = value.startsWith(prefix, lineStart)
  const next = has ? value.slice(0, lineStart) + value.slice(lineStart + prefix.length) : value.slice(0, lineStart) + prefix + value.slice(lineStart)
  const shift = has ? -prefix.length : prefix.length
  const move = (p: number) => Math.max(lineStart, p + shift)
  return { value: next, start: move(start), end: move(end) }
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
  if (kind === 'heading' || kind === 'task') return toggleLinePrefix(value, start, end, LINE_PREFIX[kind])
  if (kind === 'tag') return tag(value, start, end)
  if (kind === 'code' && value.slice(start, end).includes('\n')) return wrap(value, start, end, '```\n', '\n```')
  const [open, close] = WRAP[kind]
  return wrap(value, start, end, open, close)
}
