import { useMemo, useRef, useState } from 'react'
import { buildRegions } from '../core/clusters'
import { buildGraph, DEFAULT_GRAPH_OPTIONS, type GraphOptions } from '../core/links'
import type { GraphNode, ItemType } from '../core/types'
import { createItem, useAppState } from '../data/store'
import { GraphCanvas, type GraphHandle } from './GraphCanvas'
import { Icon } from './Icon'
import { go } from './router'
import { TYPE_META, useDebounced } from './util'

const SHAPE_HINT: Record<ItemType, string> = { note: 'dot', web: 'ring', pdf: 'double ring', prompt: 'cross', file: 'square' }

export function GraphView({ focus }: { focus?: string }) {
  const { items } = useAppState()
  const [filter, setFilter] = useState('')
  // tags and unwritten links are opt-in: they double the number of stars
  const [opts, setOpts] = useState<Omit<GraphOptions, 'filter' | 'types'>>({ ...DEFAULT_GRAPH_OPTIONS, showTags: false, showGhosts: false })
  const [types, setTypes] = useState<Set<ItemType>>(new Set(Object.keys(TYPE_META) as ItemType[]))
  const [panelOpen, setPanelOpen] = useState(false)
  const [atlasOpen, setAtlasOpen] = useState(() => window.innerWidth > 820)
  const [selected, setSelected] = useState<string | null>(focus ?? null)
  const [spin, setSpin] = useState(true)
  const handle = useRef<GraphHandle>(null)
  const q = useDebounced(filter, 180)

  const data = useMemo(
    () => buildGraph(items, { ...opts, filter: q, types: types.size === 5 ? undefined : types }),
    [items, opts, q, types],
  )
  const regions = useMemo(() => buildRegions(data.nodes), [data])
  const node = data.nodes.find((n) => n.id === selected) ?? null
  const live = items.filter((i) => !i.deleted)
  const item = node && node.kind === 'item' ? live.find((i) => i.id === node.id) : undefined

  const open = async (n: GraphNode) => {
    if (n.kind === 'item') go({ name: 'item', id: n.id })
    else if (n.kind === 'tag') go({ name: 'library', tag: n.label.slice(1) })
    else if (n.kind === 'folder') go({ name: 'library', folder: n.label })
    else {
      const it = await createItem({ title: n.label, content: `# ${n.label}\n\n`, organized: true, type: 'note' })
      go({ name: 'item', id: it.id })
    }
  }

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

  return (
    <div className="graph-page">
      {live.length === 0 ? (
        <div className="empty center">
          <h2>Your graph starts with your first note</h2>
          <p>Link notes with [[double brackets]] and they appear here as a living map.</p>
        </div>
      ) : (
        <GraphCanvas ref={handle} data={data} selectedId={selected} onSelect={setSelected} onOpen={open} />
      )}

      <div className="graph-search glass">
        <Icon name="search" size={16} />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter the graph…" aria-label="Filter graph" />
        {filter && <button className="icon-btn" onClick={() => setFilter('')} aria-label="Clear"><Icon name="x" size={14} /></button>}
      </div>

      <div className="graph-zoom glass">
        <button className="icon-btn" onClick={() => handle.current?.zoomBy(1.4)} aria-label="Zoom in"><Icon name="plus" /></button>
        <button className="icon-btn" onClick={() => handle.current?.zoomBy(1 / 1.4)} aria-label="Zoom out"><Icon name="minus" /></button>
        <button className="icon-btn" onClick={() => handle.current?.fit()} aria-label="Show everything" title="Show everything"><Icon name="fit" /></button>
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
          <p className="muted small">{data.nodes.length} stars · {data.edges.length} connections</p>
        </div>
      )}

      {node && (
        <div className="graph-card glass">
          <div className="muted small">{node.kind === 'item' ? TYPE_META[node.itemType ?? 'note'].label : node.kind === 'ghost' ? 'Not written yet' : node.kind}</div>
          <h3>{node.label}</h3>
          {item && item.folder && <div className="muted small"><Icon name="folder" size={12} /> {item.folder}</div>}
          <div className="muted small">{node.degree} connection{node.degree === 1 ? '' : 's'}</div>
          <button className="btn primary block" onClick={() => open(node)}>
            {node.kind === 'ghost' ? 'Create note' : node.kind === 'item' ? 'Open' : 'Show items'}
          </button>
        </div>
      )}
    </div>
  )
}
