import { useMemo } from 'react'
import { excerpt } from '../core/markdown'
import type { Item, ItemType } from '../core/types'
import { createItem, useAppState } from '../data/store'
import { Icon } from './Icon'
import { go, href, type Route } from './router'
import { TYPE_META, hostOf, sortByRecent, timeAgo } from './util'

type LibraryRoute = Extract<Route, { name: 'library' }>

export function Library({ route }: { route: LibraryRoute }) {
  const { items, tags } = useAppState()
  const filtered = useMemo(() => {
    let list = items.filter((i) => !i.deleted && i.status === 'organized')
    if (route.folder) list = list.filter((i) => i.folder === route.folder || i.folder.startsWith(route.folder + '/'))
    if (route.type) list = list.filter((i) => i.type === route.type)
    if (route.tag) list = list.filter((i) => i.tags.includes(route.tag!))
    return sortByRecent(list).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
  }, [items, route.folder, route.type, route.tag])

  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  const title = route.folder ? route.folder.split('/').pop()! : route.type ? TYPE_META[route.type as ItemType]?.plural ?? 'Library' : route.tag ? `#${route.tag}` : 'Library'

  const newNote = async () => {
    const it = await createItem({ title: 'Untitled note', content: '', organized: true, type: 'note', folder: route.folder ?? '' })
    go({ name: 'item', id: it.id })
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          {route.folder && <div className="crumbs">{route.folder.split('/').map((p, i, a) => (
            <a key={i} href={href({ name: 'library', folder: a.slice(0, i + 1).join('/') })}>{p}</a>
          ))}</div>}
          <h1>{title}</h1>
          <p className="sub">{filtered.length} item{filtered.length === 1 ? '' : 's'}</p>
        </div>
        <button className="btn primary" onClick={newNote}><Icon name="plus" size={16} /> New note</button>
      </header>

      <div className="filters">
        <a className={`pill ${!route.type ? 'on' : ''}`} href={href({ ...route, type: undefined })}>All</a>
        {(Object.keys(TYPE_META) as ItemType[]).map((t) => (
          <a key={t} className={`pill ${route.type === t ? 'on' : ''}`} href={href({ ...route, type: t })}>
            <Icon name={TYPE_META[t].icon} size={14} /> {TYPE_META[t].plural}
          </a>
        ))}
      </div>
      {topTags.length > 0 && (
        <div className="filters tagrow">
          {route.tag && <a className="chip on" href={href({ ...route, tag: undefined })}>#{route.tag} ✕</a>}
          {topTags.filter(([t]) => t !== route.tag).map(([t, n]) => (
            <a key={t} className="chip" href={href({ ...route, tag: t })}>#{t} <small>{n}</small></a>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty">
          <h2>Nothing here yet</h2>
          <p>Accepted items from your inbox appear in the library.</p>
        </div>
      ) : (
        <ul className="grid">
          {filtered.map((it) => <LibraryCard key={it.id} item={it} />)}
        </ul>
      )}
    </div>
  )
}

function LibraryCard({ item }: { item: Item }) {
  const meta = TYPE_META[item.type]
  return (
    <li className="card tile" data-type={item.type}>
      <a href={href({ name: 'item', id: item.id })} className="tile-link">
        <div className="tile-top">
          <span className="type-dot"><Icon name={meta.icon} size={16} /></span>
          <span className="muted small">{item.folder || 'Unfiled'}</span>
        </div>
        <h3 className="clamp2">{item.title}</h3>
        <p className="muted clamp3">{excerpt(item.content, 160)}</p>
        <div className="meta">
          <span>{item.url ? hostOf(item.url) : meta.label}</span>
          <span>{timeAgo(item.updatedAt)}</span>
        </div>
      </a>
    </li>
  )
}
