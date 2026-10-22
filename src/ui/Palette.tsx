import { useEffect, useMemo, useRef, useState } from 'react'
import { search } from '../core/search'
import { createItem, useAppState } from '../data/store'
import { Icon } from './Icon'
import { go } from './router'
import { TYPE_META, sortByRecent } from './util'

interface Entry {
  key: string
  icon: string
  label: string
  hint?: string
  run(): void
}

export function Palette({ onClose, onCapture }: { onClose(): void; onCapture(): void }) {
  const { items } = useAppState()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const entries: Entry[] = useMemo(() => {
    const close = (fn: () => void) => () => {
      onClose()
      fn()
    }
    const actions: Entry[] = [
      { key: 'a-capture', icon: 'plus', label: 'Capture link, text or file', run: close(onCapture) },
      {
        key: 'a-new',
        icon: 'edit',
        label: 'New note',
        run: close(async () => {
          const it = await createItem({ title: 'Untitled note', content: '', organized: true, type: 'note' })
          go({ name: 'item', id: it.id })
        }),
      },
      { key: 'a-inbox', icon: 'inbox', label: 'Go to Inbox', run: close(() => go({ name: 'inbox' })) },
      { key: 'a-lib', icon: 'library', label: 'Go to Library', run: close(() => go({ name: 'library' })) },
      { key: 'a-graph', icon: 'graph', label: 'Open Graph', run: close(() => go({ name: 'graph' })) },
      { key: 'a-prompts', icon: 'prompt', label: 'Show all prompts', run: close(() => go({ name: 'library', type: 'prompt' })) },
      { key: 'a-set', icon: 'settings', label: 'Settings & sync', run: close(() => go({ name: 'settings' })) },
    ]
    if (!q.trim()) {
      const recent = sortByRecent(items.filter((i) => !i.deleted)).slice(0, 6)
      return [
        ...recent.map((i) => ({
          key: i.id,
          icon: TYPE_META[i.type].icon,
          label: i.title,
          hint: i.folder || (i.status === 'inbox' ? 'Inbox' : 'Unfiled'),
          run: close(() => go({ name: 'item', id: i.id })),
        })),
        ...actions,
      ]
    }
    const hits = search(items, q, 8).map((h) => ({
      key: h.item.id,
      icon: TYPE_META[h.item.type].icon,
      label: h.item.title,
      hint: h.snippet,
      run: close(() => go({ name: 'item', id: h.item.id })),
    }))
    const ql = q.toLowerCase()
    const matchingActions = actions.filter((a) => a.label.toLowerCase().includes(ql))
    return [...hits, ...matchingActions]
  }, [q, items, onClose, onCapture])

  useEffect(() => setSel(0), [q])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(entries.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); entries[sel]?.run() }
    else if (e.key === 'Escape') onClose()
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette glass" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="palette-input">
          <Icon name="search" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search everything…" />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-list">
          {entries.length === 0 && <li className="muted pad">No matches</li>}
          {entries.map((e, i) => (
            <li key={e.key} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={e.run}>
              <Icon name={e.icon} size={17} />
              <span className="pl-label">{e.label}</span>
              {e.hint && <span className="pl-hint">{e.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
