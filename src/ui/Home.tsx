import { useMemo, type ReactNode } from 'react'
import { applyCollection, BUILTIN_COLLECTIONS } from '../core/collections'
import { buildGraph } from '../core/links'
import type { GraphNode, Item } from '../core/types'
import { replaceItemsFromSync, useAppState } from '../data/store'
import { useUsage } from '../data/usage'
import { sampleItems } from '../data/sample'
import { newNote, newPrompt } from './commands'
import { GraphCanvas } from './GraphCanvas'
import { Icon } from './Icon'
import { go, href } from './router'
import { quickCopyPrompt, rankPrompts } from './promptActions'
import { toast } from './toast'
import { TYPE_META, sortByRecent, timeAgo } from './util'

const ROWS = 5
const FRESH = BUILTIN_COLLECTIONS.find((c) => c.id === 'new')!

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function Home({ onSearch, onCapture }: { onSearch(): void; onCapture(): void }) {
  const { items } = useAppState()
  const usage = useUsage()
  const live = useMemo(() => items.filter((i) => !i.deleted), [items])
  const byId = useMemo(() => new Map(live.map((i) => [i.id, i])), [live])
  const seen = useMemo(() => new Set(usage.seen), [usage.seen])

  const fresh = useMemo(() => applyCollection(live, FRESH.query, { seen, now: Date.now() }), [live, seen])
  const latest = fresh.length ? fresh : sortByRecent(live)
  const recent = usage.recent.map((id) => byId.get(id)).filter((i): i is Item => !!i).slice(0, ROWS)
  const prompts = rankPrompts(live, usage.prompts).slice(0, ROWS)
  const pinned = sortByRecent(live.filter((i) => i.pinned)).slice(0, 8)
  const galaxy = useMemo(() => buildGraph(live, { showTags: false, showFolders: true, showGhosts: false, hideOrphans: false }), [live])

  const copy = async (p: Item) => {
    const r = await quickCopyPrompt(p)
    if (r === 'copied') toast(`Copied “${p.title}”`)
    else if (r === 'needs-input') go({ name: 'item', id: p.id })
    else toast('Copy failed', 'error')
  }
  const openNode = (n: GraphNode) => {
    if (n.kind === 'item') go({ name: 'item', id: n.id })
    else go({ name: 'graph' })
  }

  if (live.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-art" aria-hidden><Icon name="graph" size={34} /></div>
          <h2>Welcome to Mindvault</h2>
          <p>Capture a link, a PDF or a prompt and it files itself. Or look around with a few sample notes.</p>
          <div className="row">
            <button className="btn primary" onClick={onCapture}><Icon name="plus" size={16} /> Capture something</button>
            <button className="btn" onClick={async () => { await replaceItemsFromSync(sampleItems()); toast('Sample notes added') }}>Add sample notes</button>
          </div>
        </div>
      </div>
    )
  }

  const counts = (Object.keys(TYPE_META) as Item['type'][])
    .map((t) => ({ t, n: live.filter((i) => i.type === t).length }))
    .filter((c) => c.n > 0)

  return (
    <div className="page home">
      <header className="home-hero">
        <h1><span className="grad-text">{greeting()}</span></h1>
        <p className="sub">
          {counts.map((c, i) => (
            <a key={c.t} href={href({ name: 'library', type: c.t })} data-type={c.t}>
              {i > 0 && <span className="dot-sep">·</span>}
              <b>{c.n}</b> {c.n === 1 ? TYPE_META[c.t].label.toLowerCase() : TYPE_META[c.t].plural.toLowerCase()}
            </a>
          ))}
        </p>
        <button className="hero-search" onClick={onSearch}>
          <Icon name="search" size={18} /> <span>Search everything, or type &gt; for commands</span> <kbd>Ctrl K</kbd>
        </button>
        <div className="quick-row">
          <button className="quick" onClick={onCapture}><Icon name="plus" size={15} /> Capture</button>
          <button className="quick" onClick={() => void newNote()}><Icon name="edit" size={15} /> Note</button>
          <button className="quick" onClick={() => void newPrompt()}><Icon name="prompt" size={15} /> Prompt</button>
          <button className="quick" onClick={() => window.dispatchEvent(new CustomEvent('mv:quick', { detail: 'dictate' }))}><Icon name="sparkle" size={15} /> Dictate</button>
        </div>
      </header>

      {pinned.length > 0 && (
        <div className="pin-row" aria-label="Pinned">
          {pinned.map((i) => (
            <a key={i.id} className="pin-chip" href={href({ name: 'item', id: i.id })} data-type={i.type}>
              <Icon name={TYPE_META[i.type].icon} size={13} /> {i.title}
            </a>
          ))}
        </div>
      )}

      <div className="home-grid">
        <Panel title={fresh.length ? 'New' : 'Latest'} icon="bolt" more={fresh.length ? href({ name: 'library', c: 'new' }) : href({ name: 'library' })} count={fresh.length || undefined}>
          <Rows items={latest.slice(0, ROWS)} />
        </Panel>

        <Panel title="Jump back in" icon="clock" more={href({ name: 'library' })}>
          {recent.length ? <Rows items={recent} /> : <p className="muted small panel-empty">Items you open show up here.</p>}
        </Panel>

        <section className="panel galaxy-panel">
          <GraphCanvas data={galaxy} selectedId={null} onSelect={() => {}} onOpen={openNode} compact />
          <a className="galaxy-cta" href={href({ name: 'graph' })}><Icon name="graph" size={15} /> Open the galaxy</a>
        </section>

        <Panel title="Prompts" icon="prompt" more={href({ name: 'prompts' })}>
          {prompts.length ? (
            <ul className="rows">
              {prompts.map((p) => (
                <li key={p.id} className="row-item" data-type="prompt">
                  <a href={href({ name: 'item', id: p.id })}>
                    <Icon name="prompt" size={15} /> <span className="row-title">{p.title}</span>
                  </a>
                  <button className="icon-btn" onClick={() => void copy(p)} aria-label={`Copy ${p.title}`} title="Copy"><Icon name="copy" size={15} /></button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small panel-empty">Save a prompt and copy it from here in one click.</p>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Panel({ title, icon, more, count, children }: { title: string; icon: string; more: string; count?: number; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2><Icon name={icon} size={15} /> {title}{count ? <em className="badge">{count}</em> : null}</h2>
        <a className="link-btn small" href={more}>All</a>
      </div>
      {children}
    </section>
  )
}

function Rows({ items }: { items: Item[] }) {
  return (
    <ul className="rows">
      {items.map((i) => (
        <li key={i.id} className="row-item" data-type={i.type}>
          <a href={href({ name: 'item', id: i.id })}>
            <Icon name={TYPE_META[i.type].icon} size={15} />
            <span className="row-title">{i.title}</span>
            <span className="row-meta">{i.folder.split('/')[0] || TYPE_META[i.type].label} · {timeAgo(i.updatedAt)}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
