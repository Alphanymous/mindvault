import { useMemo, useRef, useState } from 'react'
import { applyFormat, type FormatKind } from '../../core/format'
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
    onChange(next)
    setQuery(null)
    requestAnimationFrame(() => {
      const pos = query.start + title.length + 2
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const format = (kind: FormatKind) => {
    const el = ref.current
    if (!el) return
    const edit = applyFormat(el.value, el.selectionStart, el.selectionEnd, kind)
    onChange(edit.value)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(edit.start, edit.end)
      detect(el)
    })
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
