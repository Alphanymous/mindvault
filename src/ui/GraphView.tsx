import { useEffect, useMemo, useRef, useState } from 'react'
import { buildRegions } from '../core/clusters'
import { connectionsOf, neighbourhood, previewText, searchGraph } from '../core/graphQuery'
import { buildGraph, DEFAULT_GRAPH_OPTIONS, type GraphOptions } from '../core/links'
import type { GraphNode, ItemType } from '../core/types'
import { createItem, useAppState } from '../data/store'
import { GraphCanvas, type GraphHandle } from './GraphCanvas'
import { Icon } from './Icon'
import { go } from './router'
import { TYPE_META, useDebounced } from './util'

const SHAPE_HINT: Record<ItemType, string> = { note: 'dot', web: 'ring', pdf: 'double ring', prompt: 'cross', file: 'square' }
const MAX_RESULTS = 6
const MAX_CONNECTIONS = 8
const NEIGHBOURHOOD_HOPS = 2

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"]')

export function GraphView({ focus }: { focus?: string }) {
  const { items, links } = useAppState()
  const [query, setQuery] = useState('')
  // tags and unwritten links are opt-in: they double the number of stars
  const [opts, setOpts] = useState<Omit<GraphOptions, 'filter' | 'types'>>({ ...DEFAULT_GRAPH_OPTIONS, showTags: false, showGhosts: false })
  const [types, setTypes] = useState<Set<ItemType>>(new Set(Object.keys(TYPE_META) as ItemType[]))
  const [panelOpen, setPanelOpen] = useState(false)
  const [atlasOpen, setAtlasOpen] = useState(() => window.innerWidth > 1100)
  const [selected, setSelected] = useState<string | null>(focus ?? null)
  const [localOnly, setLocalOnly] = useState(false)
  const [spin, setSpin] = useState(true)
  const [resultIdx, setResultIdx] = useState(0)
  const [searchFocused, setSearchFocused] = useState(false)
  const handle = useRef<GraphHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const q = useDebounced(query, 120)

  const live = useMemo(() => items.filter((i) => !i.deleted), [items])
  const full = useMemo(() => buildGraph(items, { ...opts, types: types.size === 5 ? undefined : types }), [items, opts, types])
  // "Only this neighbourhood": the selected star and what sits within two connections of it
  const data = useMemo(() => (localOnly && selected ? neighbourhood(full, selected, NEIGHBOURHOOD_HOPS) : full), [full, localOnly, selected])
  const regions = useMemo(() => buildRegions(data.nodes), [data])

  // search lights stars up instead of removing them, so you keep your bearings
  const extra = useMemo(() => new Map(live.map((i) => [i.id, `${i.folder} ${i.tags.map((t) => '#' + t).join(' ')}`])), [live])
  const matches = useMemo(() => searchGraph(data.nodes, q, extra), [data, q, extra])
  const highlight = useMemo(() => (q.trim() ? new Set(matches.map((n) => n.id)) : null), [q, matches])

  const node = data.nodes.find((n) => n.id === selected) ?? null
  const item = node && node.kind === 'item' ? live.find((i) => i.id === node.id) : undefined
  const connections = useMemo(() => (selected ? connectionsOf(data, selected) : []), [data, selected])

  const open = async (n: GraphNode) => {
    if (n.kind === 'item') go({ name: 'item', id: n.id })
    else if (n.kind === 'tag') go({ name: 'library', tag: n.label.slice(1) })
    else if (n.kind === 'folder') go({ name: 'library', folder: n.label })
    else {
      const it = await createItem({ title: n.label, content: `# ${n.label}\n\n`, organized: true, type: 'note' })
      go({ name: 'item', id: it.id })
    }
  }

  const pickResult = (n: GraphNode) => {
    setSelected(n.id)
    searchRef.current?.blur()
  }

  // keyboard: F fits everything, Tab steps through the selected star's connections, Enter opens, Esc lets go
  const keyState = useRef({ selected, connections, node, open })
  keyState.current = { selected, connections, node, open }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || document.querySelector('.overlay')) return
      const s = keyState.current
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        handle.current?.fit()
      } else if (e.key === 'Escape' && s.selected) {
        setSelected(null)
        setLocalOnly(false)
      } else if (e.key === 'Enter' && s.node) {
        e.preventDefault()
        void s.open(s.node)
      } else if (e.key === 'Tab' && s.selected) {
        // Tab cycles around the star you started from, instead of wandering off through each new star's links.
        let step = stepRef.current
        if (!step || (s.selected !== step.anchor && !step.ids.includes(s.selected))) {
          step = { anchor: s.selected, ids: s.connections.map((c) => c.id) }
          stepRef.current = step
        }
        if (!step.ids.length) return
        e.preventDefault()
        const at = step.ids.indexOf(s.selected)
        const next = step.ids[(at + (e.shiftKey ? -1 : 1) + step.ids.length) % step.ids.length]
        setSelected(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const stepRef = useRef<{ anchor: string; ids: string[] } | null>(null)
  useEffect(() => setResultIdx(0), [q])

  const toggleType = (t: ItemType) => {
    const next = new Set(types)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    setTypes(next.size ? next : new Set(Object.keys(TYPE_META) as ItemType[]))
  }
  const flag = (k: keyof typeof opts, label: string) => (
    <label className="switch">
      <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
      <span className="track" />
      {label}
    </label>
  )
  const results = matches.slice(0, MAX_RESULTS)

  return (
    <div className="graph-page">
      {live.length === 0 ? (
        <div className="empty center">
          <h2>Your graph starts with your first note</h2>
          <p>Link notes with [[double brackets]] and they appear here as a living map.</p>
        </div>
      ) : (
        <GraphCanvas ref={handle} data={data} selectedId={selected} onSelect={setSelected} onOpen={open} highlight={highlight} />
      )}

      <div className="graph-search-wrap">
        <div className="graph-search glass">
          <Icon name="search" size={16} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setResultIdx((i) => Math.min(results.length - 1, i + 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setResultIdx((i) => Math.max(0, i - 1)) }
              else if (e.key === 'Enter' && results[resultIdx]) pickResult(results[resultIdx])
              else if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur() }
            }}
            placeholder="Find a star…"
            aria-label="Find in the graph"
            role="combobox"
            aria-expanded={searchFocused && results.length > 0}
            aria-controls="graph-results"
            aria-activedescendant={results[resultIdx] ? `graph-result-${resultIdx}` : undefined}
          />
          {query && <span className="graph-count">{matches.length}</span>}
          {query && <button className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search"><Icon name="x" size={14} /></button>}
        </div>
        {searchFocused && query.trim() && (
          <ul className="graph-results glass" id="graph-results" role="listbox" aria-label="Matching stars">
            {results.length === 0 && <li className="muted small" role="option" aria-selected="false" aria-disabled="true">No star matches “{query.trim()}”</li>}
            {results.map((n, i) => (
              <li key={n.id} id={`graph-result-${i}`} role="option" aria-selected={i === resultIdx} className={i === resultIdx ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); pickResult(n) }} onMouseEnter={() => setResultIdx(i)}>
                <Icon name={n.kind === 'item' ? TYPE_META[n.itemType ?? 'note'].icon : n.kind === 'folder' ? 'folder' : 'tag'} size={14} />
                <span>{n.label}</span>
                <small>{n.degree}</small>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="graph-zoom glass">
        <button className="icon-btn" onClick={() => handle.current?.zoomBy(1.4)} aria-label="Zoom in"><Icon name="plus" /></button>
        <button className="icon-btn" onClick={() => handle.current?.zoomBy(1 / 1.4)} aria-label="Zoom out"><Icon name="minus" /></button>
        <button className="icon-btn" onClick={() => handle.current?.fit()} aria-label="Show everything (F)" title="Show everything (F)"><Icon name="fit" /></button>
        <button className="icon-btn" onClick={() => handle.current?.focusSelected()} disabled={!selected} aria-label="Fly to selected" title="Fly to selected"><Icon name="target" /></button>
        <button className={`icon-btn ${spin ? 'on' : ''}`} onClick={() => setSpin(handle.current?.toggleSpin() ?? false)} aria-pressed={spin} aria-label="Slow rotation" title="Slow rotation"><Icon name="spin" /></button>
      </div>

      {regions.length > 0 && (
        <nav className={`atlas glass ${atlasOpen ? '' : 'closed'}`} aria-label="Atlas">
          <button className="atlas-head" onClick={() => setAtlasOpen(!atlasOpen)} aria-expanded={atlasOpen}>
            <Icon name="graph" size={14} /> <span>Atlas</span> <small>{regions.length} regions</small>
          </button>
          {atlasOpen && (
            <ul className="atlas-list">
              <li>
                <button onClick={() => handle.current?.fit()}><i className="all" /> <span>Whole galaxy</span> <small>{data.nodes.length}</small></button>
              </li>
              {regions.map((r) => (
                <li key={r.name}>
                  <button onClick={() => handle.current?.focusRegion(r.name)} title="Fly to this region">
                    <i style={{ background: r.css, boxShadow: `0 0 10px ${r.css}` }} /> <span>{r.name}</span> <small>{r.count}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      )}

      <button className={`graph-options-btn glass icon-btn ${panelOpen ? 'on' : ''}`} onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen} aria-label="Graph options" title="Options">
        <Icon name="settings" size={17} />
      </button>
      {panelOpen && (
        <div className="graph-panel glass">
          <div className="panel-title"><Icon name="settings" size={15} /> <b>Graph settings</b></div>
          <div className="stat-grid two">
            <div className="stat"><small>Stars</small><b className="all">{data.nodes.length}</b></div>
            <div className="stat"><small>Connections</small><b className="out">{data.edges.length}</b></div>
          </div>
          <h4>Show</h4>
          {flag('showTags', 'Tags')}
          {flag('showFolders', 'Folders')}
          {flag('showGhosts', 'Unwritten links')}
          {flag('hideOrphans', 'Hide unconnected')}
          <h4>Only these kinds</h4>
          <div className="legend">
            {(Object.keys(TYPE_META) as ItemType[]).map((t) => (
              <button key={t} className={`legend-chip ${types.has(t) ? 'on' : ''}`} onClick={() => toggleType(t)} title={SHAPE_HINT[t]}>
                <Icon name={TYPE_META[t].icon} size={13} /> {TYPE_META[t].plural}
              </button>
            ))}
          </div>
          <p className="muted small">Color = region. Shape = kind: dot note, ring web page, double ring PDF, cross prompt, square file.</p>
          <p className="muted small">Keys: F show everything · Tab next connection · Enter open · Esc let go</p>
        </div>
      )}

      {node && (
        <aside className="graph-card glass" aria-label="Selected star">
          <div className="graph-card-kind muted small">
            <Icon name={node.kind === 'item' ? TYPE_META[node.itemType ?? 'note'].icon : node.kind === 'folder' ? 'folder' : 'tag'} size={12} />
            {node.kind === 'item' ? TYPE_META[node.itemType ?? 'note'].label : node.kind === 'ghost' ? 'Not written yet' : node.kind}
            {item?.folder && <span> · {item.folder}</span>}
          </div>
          <h3>{node.label}</h3>
          <div className="stat-grid">
            <div className="stat"><small>Backlinks</small><b className="in">{item ? (links.backlinks.get(item.id)?.length ?? 0) : '—'}</b></div>
            <div className="stat"><small>Links out</small><b className="out">{item ? (links.outgoing.get(item.id)?.length ?? 0) : '—'}</b></div>
            <div className="stat"><small>Total</small><b className="all">{node.degree}</b></div>
          </div>
          {item && item.content.trim() && <p className="graph-card-preview">{previewText(item.content, 150)}</p>}
          {item && item.tags.length > 0 && (
            <div className="chips">
              {item.tags.slice(0, 6).map((t) => <span key={t} className="chip">#{t}</span>)}
            </div>
          )}
          {connections.length > 0 && (
            <>
              <h4><Icon name="cluster" size={12} /> Connected ({connections.length})</h4>
              <ul className="graph-card-links">
                {connections.slice(0, MAX_CONNECTIONS).map((c) => (
                  <li key={c.id}>
                    <button onClick={() => setSelected(c.id)} title="Go to this star">
                      <Icon name={c.kind === 'item' ? TYPE_META[c.itemType ?? 'note'].icon : c.kind === 'folder' ? 'folder' : 'tag'} size={13} />
                      <span>{c.label}</span>
                      <Icon name="arrow" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              {connections.length > MAX_CONNECTIONS && <p className="muted small">and {connections.length - MAX_CONNECTIONS} more</p>}
            </>
          )}
          <div className="graph-card-actions">
            <button className="btn primary" onClick={() => open(node)}>
              {node.kind === 'ghost' ? 'Create note' : node.kind === 'item' ? 'Open' : 'Show items'}
            </button>
            {connections.length > 0 && (
              <button className={`btn ${localOnly ? 'on' : ''}`} onClick={() => setLocalOnly(!localOnly)} aria-pressed={localOnly} title="Show only this star and what sits within two connections">
                <Icon name="target" size={15} /> {localOnly ? 'Show all' : 'Neighbourhood'}
              </button>
            )}
            <button className="icon-btn" onClick={() => { setSelected(null); setLocalOnly(false) }} aria-label="Close"><Icon name="x" size={15} /></button>
          </div>
        </aside>
      )}
    </div>
  )
}
