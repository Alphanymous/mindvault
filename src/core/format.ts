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

export function applyFormat(value: string, start: number, end: number, kind: FormatKind): Edit {
  if (kind === 'heading' || kind === 'task') return toggleLinePrefix(value, start, end, LINE_PREFIX[kind])
  if (kind === 'tag') {
    const glue = start > 0 && !/\s/.test(value[start - 1]) ? ' ' : ''
    const insert = `${glue}#`
    return { value: value.slice(0, start) + insert + value.slice(end), start: start + insert.length, end: start + insert.length }
  }
  if (kind === 'code' && value.slice(start, end).includes('\n')) return wrap(value, start, end, '```\n', '\n```')
  const [open, close] = WRAP[kind]
  return wrap(value, start, end, open, close)
}
