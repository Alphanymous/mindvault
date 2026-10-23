import { useMemo } from 'react'
import { applyCollection, isEmptyQuery, newCollectionId, type CollectionQuery } from '../core/collections'
import { excerpt } from '../core/markdown'
import type { Item, ItemType } from '../core/types'
import { createItem, useAppState } from '../data/store'
import { allCollections, deleteCollection, saveCollection, useUsage } from '../data/usage'
import { Icon } from './Icon'
import { go, href, type Route } from './router'
import { toast } from './toast'
import { TYPE_META, hostOf, timeAgo } from './util'

type LibraryRoute = Extract<Route, { name: 'library' }>

export function Library({ route }: { route: LibraryRoute }) {
  const { items, tags } = useAppState()
  const usage = useUsage()
  const collection = route.c ? allCollections(usage).find((c) => c.id === route.c) : undefined

  const query: CollectionQuery = useMemo(
    () => ({
      ...(collection?.query ?? {}),
      ...(route.folder ? { folder: route.folder } : {}),
      ...(route.type ? { types: [route.type as ItemType] } : {}),
      ...(route.tag ? { tags: [...(collection?.query.tags ?? []), route.tag] } : {}),
    }),
    [collection, route.folder, route.type, route.tag],
  )

  const filtered = useMemo(() => {
    const list = applyCollection(items, query, { seen: new Set(usage.seen), now: Date.now() })
    return list.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned))
  }, [items, query, usage.seen])

  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  // topics = top-level folders; they replace the old folder tree
  const topics = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of items) {
      const top = i.deleted ? '' : i.folder.split('/')[0]
      if (top) counts.set(top, (counts.get(top) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [items])
  const title = collection
    ? collection.name
    : route.folder
      ? route.folder.split('/').pop()!
      : route.type
        ? (TYPE_META[route.type as ItemType]?.plural ?? 'Library')
        : route.tag
          ? `#${route.tag}`
          : 'Library'
  const canSave = !isEmptyQuery(query) && !collection?.builtin

  const newNote = async () => {
    const it = await createItem({ title: 'Untitled note', content: '', organized: true, type: 'note', folder: route.folder ?? '' })
    go({ name: 'item', id: it.id })
  }

  const saveAsCollection = () => {
    const name = prompt('Name this collection', title === 'Library' ? '' : title)?.trim()
    if (!name) return
    const c = { id: newCollectionId(name), name, icon: query.types?.length === 1 ? TYPE_META[query.types[0]].icon : 'tag', query }
    saveCollection(c)
    toast(`Saved collection “${name}”`)
    go({ name: 'library', c: c.id })
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          {route.folder && (
            <div className="crumbs">
              {route.folder.split('/').map((p, i, a) => (
                <a key={i} href={href({ name: 'library', folder: a.slice(0, i + 1).join('/') })}>{p}</a>
              ))}
            </div>
          )}
          <h1>{title}</h1>
          <p className="sub">{filtered.length} item{filtered.length === 1 ? '' : 's'}{collection ? ' · updates automatically' : ''}</p>
        </div>
        <div className="row">
          {canSave && (
            <button className="btn" onClick={saveAsCollection}><Icon name="tag" size={16} /> Save as collection</button>
          )}
          {collection && !collection.builtin && (
            <button
              className="btn ghost danger"
              onClick={() => {
                if (confirm(`Delete the collection “${collection.name}”? Your items stay.`)) {
                  deleteCollection(collection.id)
                  go({ name: 'library' })
                }
              }}
            >
              <Icon name="trash" size={16} />
            </button>
          )}
          <button className="btn primary" onClick={newNote}><Icon name="plus" size={16} /> New note</button>
        </div>
      </header>

      <div className="filters">
        <a className={`pill ${!route.type ? 'on' : ''}`} href={href({ ...route, type: undefined })}>All</a>
        {(Object.keys(TYPE_META) as ItemType[]).map((t) => (
          <a key={t} className={`pill ${route.type === t ? 'on' : ''}`} href={href({ ...route, type: t })}>
            <Icon name={TYPE_META[t].icon} size={14} /> {TYPE_META[t].plural}
          </a>
        ))}
      </div>
      {topics.length > 1 && (
        <div className="filters topic-row" aria-label="Topics">
          {topics.map(([t, n]) => {
            const on = route.folder === t || !!route.folder?.startsWith(t + '/')
            return (
              <a key={t} className={`chip topic ${on ? 'on' : ''}`} href={href({ ...route, folder: on ? undefined : t })}>
                <Icon name="folder" size={12} /> {t} <small>{n}</small>
              </a>
            )
          })}
        </div>
      )}
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
          <p>{collection ? 'Nothing matches this collection right now.' : 'Everything you capture is filed here automatically.'}</p>
        </div>
      ) : (
        <ul className="grid">
          {filtered.map((it) => <LibraryCard key={it.id} item={it} />)}
        </ul>
      )}
    </div>
  )
}

export function LibraryCard({ item }: { item: Item }) {
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
