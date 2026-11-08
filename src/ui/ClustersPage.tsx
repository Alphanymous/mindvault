import { useMemo, useState } from 'react'
import { UNFILED, buildRegions } from '../core/clusters'
import { buildGraph } from '../core/links'
import { leaderboard, orphanTags, regionStats, strongestTagPair, tagStats } from '../core/vaultStats'
import { useAppState } from '../data/store'
import { Icon } from './Icon'
import { href } from './router'

type TagSort = 'count' | 'links' | 'orphans'
const TOP_TAGS = 12
const LEADERS = 5

/** Clusters & Tags: how the vault groups (regions = top-level folders), which tags carry it, and what is left alone. */
export function ClustersPage() {
  const { items, links } = useAppState()
  const [sort, setSort] = useState<TagSort>('count')
  const live = useMemo(() => items.filter((i) => !i.deleted), [items])

  const regions = useMemo(() => regionStats(live, links), [live, links])
  const colors = useMemo(() => new Map(buildRegions(buildGraph(live).nodes).map((r) => [r.name, r.css])), [live])
  const tags = useMemo(() => tagStats(live, links), [live, links])
  const orphans = useMemo(() => orphanTags(live), [live])
  const pair = useMemo(() => strongestTagPair(live), [live])
  const leaders = useMemo(() => leaderboard(live, links, LEADERS), [live, links])

  const linkCount = useMemo(() => [...links.outgoing.values()].reduce((n, l) => n + l.length, 0), [links])
  const linked = live.filter((i) => (links.backlinks.get(i.id)?.length ?? 0) + (links.outgoing.get(i.id)?.length ?? 0) > 0).length
  const shownTags = sort === 'orphans'
    ? tags.filter((t) => t.count === 1)
    : [...tags].sort((a, b) => (sort === 'links' ? b.links - a.links : 0) || b.count - a.count).slice(0, TOP_TAGS)

  if (live.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <div className="empty-art"><Icon name="cluster" size={32} /></div>
          <h2>Clusters appear as you save</h2>
          <p>Folders become regions and tags show how ideas connect.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page clusters-page">
      <header className="page-head">
        <div>
          <h1>Clusters &amp; Tags</h1>
          <p className="sub">Each top-level folder is a region of your graph. Tags and links show how they hold together.</p>
        </div>
        <a className="btn" href={href({ name: 'graph' })}><Icon name="graph" size={16} /> Open graph</a>
      </header>

      <div className="stat-grid four">
        <div className="stat"><small><i className="dot blue" /> Regions</small><b className="in">{regions.length}</b></div>
        <div className="stat"><small><i className="dot green" /> Unique tags</small><b className="out">{tags.length}</b></div>
        <div className="stat"><small><i className="dot red" /> Linked items</small><b className="all">{linked}</b></div>
        <div className="stat"><small><i className="dot grey" /> Links per item</small><b className="all">{(linkCount / live.length).toFixed(1)}</b></div>
      </div>

      <section className="panel">
        <div className="panel-head"><h2><Icon name="cluster" size={15} /> Regions</h2><small className="muted">{live.length} items</small></div>
        <div className="share-bar" role="img" aria-label="Items per region">
          {regions.map((r) => <i key={r.name} style={{ flexGrow: r.count, background: colors.get(r.name) ?? 'var(--c-tag)' }} />)}
        </div>
        <ul className="region-list">
          {regions.map((r) => (
            <li key={r.name}>
              <span className="region-dot" style={{ background: colors.get(r.name) ?? 'var(--c-tag)', boxShadow: `0 0 10px ${colors.get(r.name) ?? 'transparent'}` }} />
              <div className="region-main">
                <div className="region-top">
                  {r.name === UNFILED ? <b>{r.name}</b> : <a href={href({ name: 'library', folder: r.name })}><b>{r.name}</b></a>}
                  <span className="mono accent">{r.count} item{r.count === 1 ? '' : 's'}</span>
                </div>
                <div className="region-meta">
                  <span>Linked: {Math.round(r.linkedShare * 100)}%</span>
                  {r.top ? <span>Most linked: <a className="wikilink-text" href={href({ name: 'item', id: r.top.id })}>[[{r.top.title}]]</a></span> : <span className="muted">No links yet</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head"><h2><Icon name="hash" size={15} /> Tags</h2></div>
        <div className="seg">
          <button className={sort === 'count' ? 'on' : ''} onClick={() => setSort('count')}>By use</button>
          <button className={sort === 'links' ? 'on' : ''} onClick={() => setSort('links')}>By links</button>
          <button className={sort === 'orphans' ? 'on' : ''} onClick={() => setSort('orphans')}>Used once</button>
        </div>
        {shownTags.length === 0 ? (
          <p className="muted small">{sort === 'orphans' ? 'Every tag is used more than once.' : 'No tags yet. Add #tags while writing.'}</p>
        ) : (
          <div className="tag-cloud">
            {shownTags.map((t) => (
              <a key={t.tag} className="tag-stat" href={href({ name: 'library', tag: t.tag })}>
                <span className="mono">#{t.tag}</span>
                <small>{t.count} item{t.count === 1 ? '' : 's'}</small>
                <small className="ok-text">· {t.links} link{t.links === 1 ? '' : 's'}</small>
              </a>
            ))}
          </div>
        )}
        {pair && pair.together > 1 && (
          <div className="insight">
            <Icon name="sparkle" size={16} />
            <div>
              <b>Strongest pair</b>
              <p className="small"><span className="mono accent">#{pair.a}</span> and <span className="mono ok-text">#{pair.b}</span> appear together on {pair.together} items.</p>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><h2><Icon name="target" size={15} /> Health</h2></div>
        {orphans.length > 0 ? (
          <div className="alert-card">
            <div className="alert-top"><i className="dot red" /> <b>Tags used only once</b> <span className="count-pill">{orphans.length}</span></div>
            <p className="small muted">A tag on a single item does not connect anything yet. Reuse it or remove it.</p>
            <div className="chips">
              {orphans.slice(0, 16).map((t) => <a key={t} className="chip mono" href={href({ name: 'library', tag: t })}>#{t}</a>)}
            </div>
          </div>
        ) : (
          <p className="muted small">Every tag connects at least two items.</p>
        )}
        <h4 className="caps">Most linked</h4>
        {leaders.length === 0 ? (
          <p className="muted small">Nothing links to anything yet. Use [[Note title]] to connect notes.</p>
        ) : (
          <ol className="leaderboard">
            {leaders.map((l, i) => (
              <li key={l.item.id}>
                <span className={`rank r${i + 1}`}>#{i + 1}</span>
                <a href={href({ name: 'item', id: l.item.id })}>
                  <b>[[{l.item.title}]]</b>
                  <small>{l.backlinks} backlink{l.backlinks === 1 ? '' : 's'}</small>
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
