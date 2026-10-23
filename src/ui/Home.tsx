import { useMemo } from 'react'
import { applyCollection } from '../core/collections'
import { excerpt } from '../core/markdown'
import type { Item } from '../core/types'
import { acceptAllInbox, useAppState } from '../data/store'
import { allCollections, useUsage } from '../data/usage'
import { sampleItems } from '../data/sample'
import { replaceItemsFromSync } from '../data/store'
import { Icon } from './Icon'
import { LibraryCard } from './Library'
import { go, href } from './router'
import { quickCopyPrompt, rankPrompts } from './promptActions'
import { toast } from './toast'
import { TYPE_META, sortByRecent } from './util'

function greeting(): string {
  const h = new Date().getHours()
  return h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function Home({ onSearch, onCapture }: { onSearch(): void; onCapture(): void }) {
  const { items } = useAppState()
  const usage = useUsage()
  const live = useMemo(() => items.filter((i) => !i.deleted), [items])
  const byId = useMemo(() => new Map(live.map((i) => [i.id, i])), [live])
  const inbox = live.filter((i) => i.status === 'inbox')
  const organized = live.filter((i) => i.status === 'organized')

  const recent = usage.recent.map((id) => byId.get(id)).filter((i): i is Item => !!i && i.status === 'organized').slice(0, 4)
  const pinned = sortByRecent(organized.filter((i) => i.pinned && i.type !== 'prompt')).slice(0, 4)
  const prompts = rankPrompts(live, usage.prompts).slice(0, 6)
  const latest = sortByRecent(organized).slice(0, 4)
  const seen = useMemo(() => new Set(usage.seen), [usage.seen])
  const collections = allCollections(usage).map((c) => ({ c, count: applyCollection(live, c.query, { seen, now: Date.now() }).length }))

  const copy = async (p: Item) => {
    const r = await quickCopyPrompt(p)
    if (r === 'copied') toast(`Copied “${p.title}”`)
    else if (r === 'needs-input') go({ name: 'item', id: p.id })
    else toast('Copy failed', 'error')
  }

  if (live.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-art" aria-hidden><Icon name="graph" size={34} /></div>
          <h2>Welcome to Mindvault</h2>
          <p>Capture a link, a PDF or a prompt, and it is sorted for you. Or look around with a few sample notes.</p>
          <div className="row">
            <button className="btn primary" onClick={onCapture}><Icon name="plus" size={16} /> Capture something</button>
            <button className="btn" onClick={async () => { await replaceItemsFromSync(sampleItems()); toast('Sample notes added') }}>Add sample notes</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page home">
      <header className="home-hero">
        <div>
          <h1>{greeting()}</h1>
          <p className="sub">{organized.length} items in your vault{inbox.length ? `, ${inbox.length} waiting in the inbox` : ''}.</p>
        </div>
        <button className="hero-search" onClick={onSearch}>
          <Icon name="search" size={18} /> <span>Search notes, PDFs, prompts…</span> <kbd>Ctrl K</kbd>
        </button>
      </header>

      {inbox.length > 0 && (
        <div className="banner">
          <Icon name="inbox" size={20} />
          <div>
            <b>{inbox.length} new item{inbox.length === 1 ? '' : 's'} to file</b>
            <span className="muted"> — each has a suggested folder and tags.</span>
          </div>
          <span className="spacer" />
          <a className="btn" href={href({ name: 'inbox' })}>Review</a>
          <button className="btn primary" onClick={async () => toast(`Filed ${await acceptAllInbox()} items`)}>Accept all</button>
        </div>
      )}

      {recent.length > 0 && (
        <section className="section">
          <h2>Continue where you left off</h2>
          <ul className="grid four">{recent.map((i) => <LibraryCard key={i.id} item={i} />)}</ul>
        </section>
      )}

      {prompts.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Prompt shelf</h2>
            <a className="link-btn small" href={href({ name: 'prompts' })}>All prompts</a>
          </div>
          <ul className="shelf">
            {prompts.map((p) => (
              <li key={p.id} className="card shelf-card" data-type="prompt">
                <a href={href({ name: 'item', id: p.id })}>
                  <h3 className="clamp2">{p.title}</h3>
                  <p className="muted clamp2">{excerpt(p.content, 110)}</p>
                </a>
                <button className="btn" onClick={() => void copy(p)} aria-label={`Copy ${p.title}`}><Icon name="copy" size={15} /> Copy</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Collections</h2>
          <a className="link-btn small" href={href({ name: 'library' })}>Library</a>
        </div>
        <ul className="tiles">
          {collections.map(({ c, count }) => (
            <li key={c.id}>
              <a className="collection-tile" href={href({ name: 'library', c: c.id })}>
                <span className="type-dot"><Icon name={c.icon} size={17} /></span>
                <span className="ct-name">{c.name}</span>
                <span className="ct-count">{count}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {pinned.length > 0 && (
        <section className="section">
          <h2>Pinned</h2>
          <ul className="grid four">{pinned.map((i) => <LibraryCard key={i.id} item={i} />)}</ul>
        </section>
      )}

      <section className="section">
        <h2>Recently added</h2>
        <ul className="grid four">{latest.map((i) => <LibraryCard key={i.id} item={i} />)}</ul>
      </section>

      <p className="muted small center-text">
        {Object.values(TYPE_META).map((t) => t.plural).join(' · ')} — press <kbd>?</kbd> for keyboard shortcuts.
      </p>
    </div>
  )
}
