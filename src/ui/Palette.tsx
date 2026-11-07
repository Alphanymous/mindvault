import { useEffect, useMemo, useRef, useState } from 'react'
import { smartSearch, type SmartHit } from '../core/smartSearch'
import { getIndex, meaningNeighbours } from '../data/meaning'
import { useAppState } from '../data/store'
import { allCollections, useUsage } from '../data/usage'
import { filterCommands, makeCommands, type AppActions } from './commands'
import { Icon } from './Icon'
import { go } from './router'
import { TYPE_META, sortByRecent, useDebounced } from './util'

interface Entry {
  key: string
  icon: string
  label: string
  hint?: string
  parts?: SmartHit['passage']
  badge?: string
  run(): void
}

const HELP_ROWS = [
  ['>', 'commands'],
  ['#', 'tags'],
  ['@', 'folders & collections'],
]

export function Palette({ onClose, actions, initial = '' }: { onClose(): void; actions: AppActions; initial?: string }) {
  const { items, tags, folders } = useAppState()
  const usage = useUsage()
  const [q, setQ] = useState(initial)
  const [sel, setSel] = useState(0)
  const [semantic, setSemantic] = useState<{ q: string; hits: { id: string; score: number }[] }>({ q: '', hits: [] })
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const debounced = useDebounced(q, 350)

  const mode = q.startsWith('>') ? 'commands' : q.startsWith('#') ? 'tags' : q.startsWith('@') ? 'places' : 'search'
  const term = mode === 'search' ? q.trim() : q.slice(1).trim()

  // meaning-based neighbours arrive asynchronously (only when an embeddings endpoint is configured)
  useEffect(() => {
    if (mode !== 'search' || debounced.trim().length < 3) return
    let cancelled = false
    void meaningNeighbours(debounced.trim()).then((hits) => {
      if (!cancelled && hits.length) setSemantic({ q: debounced.trim(), hits })
    })
    return () => {
      cancelled = true
    }
  }, [debounced, mode])

  const entries: Entry[] = useMemo(() => {
    const close = (fn: () => void) => () => {
      onClose()
      fn()
    }
    const commands = makeCommands({
      openCapture: (o) => actions.openCapture(o),
      openSearch: actions.openSearch,
      openHelp: actions.openHelp,
    })
    const cmdEntry = (c: (typeof commands)[number]): Entry => ({ key: `c-${c.id}`, icon: c.icon, label: c.label, hint: c.hint, run: close(c.run) })
    const itemEntry = (i: (typeof items)[number], extra: Partial<Entry> = {}): Entry => ({
      key: i.id,
      icon: TYPE_META[i.type].icon,
      label: i.title,
      hint: i.folder || undefined,
      run: close(() => go({ name: 'item', id: i.id })),
      ...extra,
    })

    if (mode === 'commands') return filterCommands(commands, term).map(cmdEntry)

    if (mode === 'tags') {
      return [...tags.entries()]
        .filter(([t]) => t.includes(term.replace(/^#/, '').toLowerCase()))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([t, n]) => ({ key: `t-${t}`, icon: 'tag', label: `#${t}`, hint: `${n} item${n === 1 ? '' : 's'}`, run: close(() => go({ name: 'library', tag: t })) }))
    }

    if (mode === 'places') {
      const needle = term.toLowerCase()
      const cols = allCollections(usage)
        .filter((c) => c.name.toLowerCase().includes(needle))
        .map((c): Entry => ({ key: `col-${c.id}`, icon: c.icon, label: c.name, hint: 'collection', run: close(() => go({ name: 'library', c: c.id })) }))
      const dirs = folders
        .filter((f) => f.toLowerCase().includes(needle))
        .slice(0, 10)
        .map((f): Entry => ({ key: `f-${f}`, icon: 'folder', label: f, hint: 'folder', run: close(() => go({ name: 'library', folder: f })) }))
      return [...cols, ...dirs]
    }

    if (!term) {
      const byId = new Map(items.filter((i) => !i.deleted).map((i) => [i.id, i]))
      const recent = usage.recent.map((id) => byId.get(id)).filter(Boolean).slice(0, 6) as typeof items
      const fallback = recent.length ? recent : sortByRecent(items.filter((i) => !i.deleted)).slice(0, 6)
      const label = recent.length ? 'Recent' : 'Latest'
      return [
        ...fallback.map((i) => itemEntry(i, { badge: label })),
        ...commands.slice(0, 5).map(cmdEntry),
      ]
    }

    const hits = smartSearch(items, term, getIndex(items), semantic.q === term ? semantic.hits : [], 10)
    const results = hits.map((h) =>
      itemEntry(h.item, { parts: h.passage, badge: h.via.includes('meaning') && !h.via.includes('words') ? 'meaning' : h.via.includes('words') ? undefined : 'topic', hint: h.item.folder || undefined }),
    )
    return [...results, ...filterCommands(commands, term).slice(0, 3).map(cmdEntry)]
  }, [mode, term, items, tags, folders, usage, semantic, actions, onClose])

  useEffect(() => setSel(0), [q])
  useEffect(() => {
    document.querySelector('.palette-list li.on')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(entries.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); entries[sel]?.run() }
    else if (e.key === 'Escape') onClose()
    else if (e.key === 'Tab' && !q) { e.preventDefault(); setQ('>') }
  }

  const placeholder = { search: 'Search everything…', commands: 'Type a command…', tags: 'Find a tag…', places: 'Find a folder or collection…' }[mode]

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette glass" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search and commands">
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={placeholder}
            aria-label={placeholder}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-autocomplete="list"
            aria-activedescendant={entries[sel] ? `palette-opt-${sel}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox" aria-label="Results">
          {entries.length === 0 && <li className="muted pad" role="option" aria-selected="false" aria-disabled="true">No matches</li>}
          {entries.map((e, i) => (
            <li key={e.key} id={`palette-opt-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onMouseEnter={() => setSel(i)} onClick={e.run}>
              <Icon name={e.icon} size={17} />
              <span className="pl-main">
                <span className="pl-label">{e.label}</span>
                {e.parts && (
                  <span className="pl-passage">
                    {e.parts.map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
                  </span>
                )}
              </span>
              {e.badge && <span className="pl-badge">{e.badge}</span>}
              {e.hint && <span className="pl-hint">{e.hint}</span>}
            </li>
          ))}
        </ul>
        <div className="palette-foot">
          {HELP_ROWS.map(([k, v]) => (
            <button key={k} className="pl-tip" onMouseDown={(e) => { e.preventDefault(); setQ(k); input.current?.focus() }}>
              <kbd>{k}</kbd> {v}
            </button>
          ))}
          <span className="spacer" />
          <span className="muted small">↑↓ select · ↵ open</span>
        </div>
      </div>
    </div>
  )
}
