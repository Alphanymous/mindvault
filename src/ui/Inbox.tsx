import { useState } from 'react'
import { excerpt } from '../core/markdown'
import { normalizeTag } from '../core/markdown'
import type { Item, ItemType } from '../core/types'
import { acceptAllInbox, acceptSuggestion, deleteItem, useAppState } from '../data/store'
import { Icon } from './Icon'
import { go } from './router'
import { toast } from './toast'
import { TYPE_META, hostOf, sortByRecent, timeAgo } from './util'

export function Inbox({ onCapture }: { onCapture(): void }) {
  const { items } = useAppState()
  const inbox = sortByRecent(items.filter((i) => !i.deleted && i.status === 'inbox'))

  const acceptAll = async () => {
    const n = await acceptAllInbox()
    toast(`Filed ${n} item${n === 1 ? '' : 's'}`)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="sub">
            {inbox.length
              ? 'Everything you save lands here with a suggested home. Accept it in one click, or tweak first.'
              : 'Nothing waiting. New captures show up here with a suggested folder and tags.'}
          </p>
        </div>
        {inbox.length > 1 && (
          <button className="btn primary" onClick={acceptAll}>
            <Icon name="check" size={16} /> Accept all ({inbox.length})
          </button>
        )}
      </header>

      {inbox.length === 0 ? (
        <div className="empty">
          <div className="empty-art" aria-hidden>
            <Icon name="inbox" size={34} />
          </div>
          <h2>Inbox zero</h2>
          <p>Paste a link, drop a PDF or write something down. Mindvault sorts it for you.</p>
          <button className="btn primary" onClick={onCapture}>
            <Icon name="plus" size={16} /> Capture something
          </button>
        </div>
      ) : (
        <ul className="stack">
          {inbox.map((it) => (
            <InboxCard key={it.id} item={it} />
          ))}
        </ul>
      )}
    </div>
  )
}

function InboxCard({ item }: { item: Item }) {
  const { folders } = useAppState()
  const s = item.suggestion
  const [editing, setEditing] = useState(false)
  const [folder, setFolder] = useState(s?.folder ?? '')
  const [tags, setTags] = useState((s?.tags ?? []).join(', '))
  const [type, setType] = useState<ItemType>(s?.type ?? item.type)
  const meta = TYPE_META[s?.type ?? item.type]

  const accept = async (custom = false) => {
    if (custom) {
      await acceptSuggestion(item.id, {
        folder: folder.trim().replace(/^\/+|\/+$/g, ''),
        tags: tags.split(/[,\s]+/).map(normalizeTag).filter(Boolean),
        type,
      })
    } else {
      await acceptSuggestion(item.id)
    }
    toast(`Filed in ${custom ? folder.trim() || 'Library' : s?.folder}`, 'ok', { label: 'Open', href: `#/item/${item.id}` })
  }

  return (
    <li className="card inbox-card" data-type={s?.type ?? item.type}>
      <div className="card-main" onClick={() => go({ name: 'item', id: item.id })} role="link" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && go({ name: 'item', id: item.id })}>
        <span className="type-dot" title={meta.label}><Icon name={meta.icon} size={18} /></span>
        <div className="card-text">
          <h3>{item.title}</h3>
          <p className="muted clamp2">{excerpt(item.content, 200)}</p>
          <div className="meta">
            <span>{meta.label}</span>
            {item.url && <span>{hostOf(item.url)}</span>}
            <span>{timeAgo(item.createdAt)}</span>
          </div>
        </div>
      </div>

      {s && !editing && (
        <div className="suggest">
          <div className="suggest-line">
            <Icon name="sparkle" size={15} />
            <span className="suggest-folder"><Icon name="folder" size={14} /> {s.folder}</span>
            <span className="chips">
              {s.tags.map((t) => (
                <span key={t} className="chip">#{t}</span>
              ))}
            </span>
            <span className="conf" title={`${Math.round(s.confidence * 100)}% sure: ${s.reason}`}>
              <i style={{ width: `${Math.round(s.confidence * 100)}%` }} />
            </span>
          </div>
          <div className="suggest-actions">
            <button className="btn primary" onClick={() => accept(false)}><Icon name="check" size={16} /> Accept</button>
            <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={16} /> Change</button>
            <button className="btn ghost danger" onClick={() => deleteItem(item.id)} aria-label="Delete"><Icon name="trash" size={16} /></button>
          </div>
        </div>
      )}

      {editing && (
        <div className="suggest edit">
          <label>
            <span>Folder</span>
            <input list="folder-list" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="e.g. Work/Clients" />
            <datalist id="folder-list">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          </label>
          <label>
            <span>Tags</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="comma separated" />
          </label>
          <label>
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as ItemType)}>
              {(Object.keys(TYPE_META) as ItemType[]).map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
            </select>
          </label>
          <div className="suggest-actions">
            <button className="btn primary" onClick={() => accept(true)}><Icon name="check" size={16} /> File it</button>
            <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  )
}
