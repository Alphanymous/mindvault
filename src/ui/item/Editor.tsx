import { useEffect, useMemo, useRef, useState } from 'react'
import { applyFormat, diffEdit, type Edit, type FormatKind } from '../../core/format'
import { useAppState } from '../../data/store'
import { Icon } from '../Icon'
import { TYPE_META } from '../util'

const TOOLS: { kind: FormatKind; icon: string; label: string }[] = [
  { kind: 'wikilink', icon: 'wikilink', label: 'Link a note [[ ]]' },
  { kind: 'heading', icon: 'heading', label: 'Heading' },
  { kind: 'bold', icon: 'bold', label: 'Bold' },
  { kind: 'italic', icon: 'italic', label: 'Italic' },
  { kind: 'task', icon: 'task', label: 'Task' },
  { kind: 'tag', icon: 'hash', label: 'Tag' },
  { kind: 'code', icon: 'code', label: 'Code' },
]

/**
 * Apply an edit through the browser's editing commands so it lands in the textarea's undo history (Ctrl+Z works).
 * Falls back to a plain state update where execCommand is missing or does something unexpected.
 */
function commitEdit(el: HTMLTextAreaElement, edit: Edit, onChange: (v: string) => void, after: () => void) {
  const change = diffEdit(el.value, edit.value)
  if (change) {
    el.focus()
    el.setSelectionRange(change.from, change.to)
    let ok = false
    try {
      ok = document.execCommand(change.text ? 'insertText' : 'delete', false, change.text)
    } catch {
      ok = false
    }
    if (!ok || el.value !== edit.value) onChange(edit.value)
  }
  requestAnimationFrame(() => {
    el.focus()
    el.setSelectionRange(edit.start, edit.end)
    after()
  })
}

/** Markdown textarea with a formatting toolbar and [[wikilink]] autocomplete. */
export function Editor({ value, onChange, selfId }: { value: string; onChange(v: string): void; selfId: string }) {
  const { items } = useAppState()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<{ q: string; start: number } | null>(null)
  const [sel, setSel] = useState(0)

  const options = useMemo(() => {
    if (!query) return []
    const q = query.q.toLowerCase()
    return items
      .filter((i) => !i.deleted && i.id !== selfId && i.title.toLowerCase().includes(q))
      .sort((a, b) => Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)) || b.updatedAt - a.updatedAt)
      .slice(0, 6)
  }, [query, items, selfId])

  const detect = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart)
    const m = /\[\[([^\]\n|#]*)$/.exec(before)
    setQuery(m ? { q: m[1], start: el.selectionStart - m[1].length } : null)
    setSel(0)
  }

  const insert = (title: string) => {
    const el = ref.current
    if (!el || !query) return
    const end = el.selectionStart
    const after = el.value.slice(end).startsWith(']]') ? '' : ']]'
    const next = el.value.slice(0, query.start) + title + after + el.value.slice(end)
    const pos = query.start + title.length + 2
    commitEdit(el, { value: next, start: pos, end: pos }, onChange, () => setQuery(null))
  }

  // Typing # over selected words makes them a tag, like the toolbar button. Without this the browser's default
  // replaces the selection with a lone "#". Native listener: React's onBeforeInput doesn't expose inputType.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onBeforeInput = (e: InputEvent) => {
      if (e.inputType !== 'insertText' || e.data !== '#') return
      if (!el.value.slice(el.selectionStart, el.selectionEnd).trim()) return
      e.preventDefault()
      format('tag')
    }
    el.addEventListener('beforeinput', onBeforeInput)
    return () => el.removeEventListener('beforeinput', onBeforeInput)
  })

  const format = (kind: FormatKind) => {
    const el = ref.current
    if (!el) return
    commitEdit(el, applyFormat(el.value, el.selectionStart, el.selectionEnd, kind), onChange, () => detect(el))
  }

  return (
    <div className="editor">
      <div className="md-toolbar glass" role="toolbar" aria-label="Formatting">
        {TOOLS.map((t) => (
          <button key={t.kind} type="button" className={`md-tool ${t.kind === 'wikilink' ? 'lead' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => format(t.kind)} aria-label={t.label} title={t.label}>
            <Icon name={t.icon} size={17} />
          </button>
        ))}
        <span className="spacer" />
        <span className="md-hint">Markdown</span>
      </div>
      <textarea
        ref={ref}
        value={value}
        autoFocus
        spellCheck
        placeholder="Write in Markdown. [[Link]] to other notes, #tag inline."
        aria-label="Note text"
        onChange={(e) => {
          onChange(e.target.value)
          detect(e.target)
        }}
        onClick={(e) => detect(e.currentTarget)}
        onKeyDown={(e) => {
          const mod = e.ctrlKey || e.metaKey
          if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); format('bold'); return }
          if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); format('italic'); return }
          if (!options.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % options.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + options.length) % options.length) }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(options[sel].title) }
          else if (e.key === 'Escape') setQuery(null)
        }}
      />
      {options.length > 0 && (
        <ul className="ac" role="listbox">
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); insert(o.title) }}>
              <Icon name={TYPE_META[o.type].icon} size={14} /> {o.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
