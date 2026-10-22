import { useEffect, useMemo, useRef, useState } from 'react'
import { buildGraph, neighborhood } from '../core/links'
import { normalizeTag, parseInlineTags } from '../core/markdown'
import { fillPrompt, promptBody, promptVariables } from '../core/prompts'
import type { GraphNode, Item } from '../core/types'
import { createItem, deleteItem, getBlob, updateItem, useAppState } from '../data/store'
import { GraphCanvas } from './GraphCanvas'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { go, href } from './router'
import { toast } from './toast'
import { TYPE_META, copyText, formatBytes, hostOf, timeAgo, useDebounced } from './util'

export function ItemView({ id }: { id: string }) {
  const { items } = useAppState()
  const item = items.find((i) => i.id === id && !i.deleted)
  if (!item) {
    return (
      <div className="page">
        <div className="empty">
          <h2>Item not found</h2>
          <p>It may have been deleted or not synced to this device yet.</p>
          <a className="btn" href="#/library">Back to library</a>
        </div>
      </div>
    )
  }
  return <ItemBody key={item.id} item={item} />
}

function ItemBody({ item }: { item: Item }) {
  const { folders, links, items } = useAppState()
  const meta = TYPE_META[item.type]
  const [editing, setEditing] = useState(item.type === 'note' && item.content.trim() === '')
  const [draft, setDraft] = useState(item.content)
  const [title, setTitle] = useState(item.title)
  const debDraft = useDebounced(draft, 450)
  const debTitle = useDebounced(title, 450)

  // autosave content + merge inline #tags
  useEffect(() => {
    if (debDraft === item.content) return
    const inline = parseInlineTags(debDraft)
    const tags = [...new Set([...item.tags, ...inline])]
    void updateItem(item.id, { content: debDraft, tags })
  }, [debDraft]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = debTitle.trim()
    if (t && t !== item.title) void updateItem(item.id, { title: t })
  }, [debTitle]) // eslint-disable-line react-hooks/exhaustive-deps

  const backlinks = (links.backlinks.get(item.id) ?? []).map((i) => items.find((x) => x.id === i)).filter(Boolean) as Item[]
  const outgoing = (links.outgoing.get(item.id) ?? []).map((i) => items.find((x) => x.id === i)).filter(Boolean) as Item[]
  const missing = links.unresolved.get(item.id) ?? []

  const local = useMemo(() => {
    const g = buildGraph(items, { showTags: true, showFolders: false, showGhosts: true, hideOrphans: false })
    return neighborhood(g, item.id)
  }, [items, item.id])

  const remove = async () => {
    if (!confirm(`Delete "${item.title}"?`)) return
    await deleteItem(item.id)
    toast('Deleted')
    history.length > 1 ? history.back() : go({ name: 'library' })
  }

  const onGraphOpen = async (n: GraphNode) => {
    if (n.kind === 'item') go({ name: 'item', id: n.id })
    else if (n.kind === 'tag') go({ name: 'library', tag: n.label.slice(1) })
    else if (n.kind === 'ghost') {
      const it = await createItem({ title: n.label, content: `# ${n.label}\n\n`, organized: true, type: 'note' })
      go({ name: 'item', id: it.id })
    }
  }

  return (
    <div className="page item-page">
      <div className="item-main">
        <header className="item-head">
          <a className="btn ghost" href="javascript:history.back()" onClick={(e) => { e.preventDefault(); history.back() }} aria-label="Back">
            <Icon name="back" size={18} />
          </a>
          <span className="type-badge" data-type={item.type}><Icon name={meta.icon} size={14} /> {meta.label}</span>
          <span className="spacer" />
          {item.status === 'inbox' && <a className="btn" href="#/inbox">In inbox</a>}
          <button className="btn ghost" onClick={() => updateItem(item.id, { pinned: !item.pinned })} title="Pin">
            <Icon name="sparkle" size={16} /> {item.pinned ? 'Pinned' : 'Pin'}
          </button>
          <button className="btn ghost danger" onClick={remove} aria-label="Delete"><Icon name="trash" size={16} /></button>
        </header>

        <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />

        <div className="meta-row">
          <label className="folder-pick">
            <Icon name="folder" size={14} />
            <input
              list="folder-list-item"
              value={item.folder}
              placeholder="Unfiled"
              onChange={(e) => updateItem(item.id, { folder: e.target.value.replace(/^\/+/, ''), status: 'organized', suggestion: undefined })}
            />
            <datalist id="folder-list-item">{folders.map((f) => <option key={f} value={f} />)}</datalist>
          </label>
          <TagEditor tags={item.tags} onChange={(tags) => updateItem(item.id, { tags })} />
        </div>

        {item.url && (
          <a className="source" href={item.url} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={14} /> {hostOf(item.url)} <span className="muted">· open original</span>
          </a>
        )}
        <div className="muted small">Updated {timeAgo(item.updatedAt)}{item.size ? ` · ${formatBytes(item.size)}` : ''}</div>

        {(item.type === 'pdf' || item.type === 'file') && <BlobActions item={item} />}
        {item.type === 'prompt' && !editing && <PromptCard content={draft} />}

        <div className="seg">
          <button className={!editing ? 'on' : ''} onClick={() => setEditing(false)}><Icon name="eye" size={15} /> Read</button>
          <button className={editing ? 'on' : ''} onClick={() => setEditing(true)}><Icon name="edit" size={15} /> Edit</button>
        </div>

        {editing ? (
          <Editor value={draft} onChange={setDraft} selfId={item.id} />
        ) : item.type === 'prompt' ? null : draft.trim() ? (
          <Markdown source={draft} />
        ) : (
          <p className="muted">Empty. Switch to Edit and start writing. Link notes with [[double brackets]].</p>
        )}
      </div>

      <aside className="item-side">
        <section className="panel">
          <h4>Local graph</h4>
          <div className="mini-graph">
            <GraphCanvas data={local} selectedId={item.id} onSelect={() => {}} onOpen={onGraphOpen} compact />
          </div>
          <a className="btn block" href={href({ name: 'graph', focus: item.id })}><Icon name="graph" size={16} /> Open in graph</a>
        </section>
        <LinkList title={`Linked from (${backlinks.length})`} items={backlinks} empty="No notes link here yet." />
        <LinkList title={`Links to (${outgoing.length})`} items={outgoing} empty="Use [[Note title]] to link." />
        {missing.length > 0 && (
          <section className="panel">
            <h4>Not created yet</h4>
            <ul className="mini-list">
              {missing.map((m) => (
                <li key={m}>
                  <button className="link-btn" onClick={() => onGraphOpen({ id: '', label: m, kind: 'ghost', degree: 0 })}>
                    <Icon name="plus" size={14} /> {m}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  )
}

function LinkList({ title, items, empty }: { title: string; items: Item[]; empty: string }) {
  return (
    <section className="panel">
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="mini-list">
          {items.map((i) => (
            <li key={i.id}>
              <a href={href({ name: 'item', id: i.id })}><Icon name={TYPE_META[i.type].icon} size={14} /> {i.title}</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange(t: string[]): void }) {
  const [val, setVal] = useState('')
  const add = () => {
    const t = normalizeTag(val)
    if (t && !tags.includes(t)) onChange([...tags, t])
    setVal('')
  }
  return (
    <div className="tag-editor">
      {tags.map((t) => (
        <span key={t} className="chip">
          <a href={href({ name: 'library', tag: t })}>#{t}</a>
          <button aria-label={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>×</button>
        </span>
      ))}
      <input
        value={val}
        placeholder="+ tag"
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
    </div>
  )
}

function BlobActions({ item }: { item: Item }) {
  const [busy, setBusy] = useState(false)
  const open = async (download: boolean) => {
    if (!item.blobId) return toast('Original not available on this device yet. Sync first.', 'warn')
    setBusy(true)
    const blob = await getBlob(item.blobId)
    setBusy(false)
    if (!blob) return toast('Original not available on this device yet. Sync first.', 'warn')
    const url = URL.createObjectURL(blob)
    if (download) {
      const a = document.createElement('a')
      a.href = url
      a.download = item.fileName ?? item.title
      a.click()
    } else {
      window.open(url, '_blank')
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return (
    <div className="row">
      {item.type === 'pdf' && <button className="btn" disabled={busy} onClick={() => open(false)}><Icon name="external" size={16} /> Open PDF</button>}
      <button className="btn" disabled={busy} onClick={() => open(true)}><Icon name="download" size={16} /> Download original</button>
    </div>
  )
}

function PromptCard({ content }: { content: string }) {
  const body = promptBody(content)
  const vars = promptVariables(body)
  const [values, setValues] = useState<Record<string, string>>({})
  const filled = fillPrompt(body, values)
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    const ok = await copyText(filled)
    setCopied(ok)
    toast(ok ? 'Prompt copied' : 'Copy failed', ok ? 'ok' : 'error')
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="prompt-card">
      {vars.length > 0 && (
        <div className="vars">
          {vars.map((v) => (
            <label key={v}>
              <span>{v}</span>
              <input value={values[v] ?? ''} onChange={(e) => setValues({ ...values, [v]: e.target.value })} placeholder={`{{${v}}}`} />
            </label>
          ))}
        </div>
      )}
      <pre className="prompt-text">{filled}</pre>
      <button className={`btn primary big ${copied ? 'done' : ''}`} onClick={copy}>
        <Icon name={copied ? 'check' : 'copy'} size={18} /> {copied ? 'Copied' : 'Copy prompt'}
      </button>
    </div>
  )
}

/** Textarea editor with [[wikilink]] autocomplete. */
function Editor({ value, onChange, selfId }: { value: string; onChange(v: string): void; selfId: string }) {
  const { items } = useAppState()
  const ref = useRef<HTMLTextAreaElement>(null)
  const [query, setQuery] = useState<{ q: string; start: number } | null>(null)
  const [sel, setSel] = useState(0)

  const options = useMemo(() => {
    if (!query) return []
    const q = query.q.toLowerCase()
    return items
      .filter((i) => !i.deleted && i.id !== selfId && i.title.toLowerCase().includes(q))
      .sort((a, b) => Number(b.title.toLowerCase().startsWith(q)) - Number(a.title.toLowerCase().startsWith(q)) || b.updatedAt - a.updatedAt)
      .slice(0, 6)
  }, [query, items, selfId])

  const detect = (el: HTMLTextAreaElement) => {
    const before = el.value.slice(0, el.selectionStart)
    const m = /\[\[([^\]\n|#]*)$/.exec(before)
    setQuery(m ? { q: m[1], start: el.selectionStart - m[1].length } : null)
    setSel(0)
  }

  const insert = (title: string) => {
    const el = ref.current
    if (!el || !query) return
    const end = el.selectionStart
    const after = el.value.slice(end).startsWith(']]') ? '' : ']]'
    const next = el.value.slice(0, query.start) + title + after + el.value.slice(end)
    onChange(next)
    setQuery(null)
    requestAnimationFrame(() => {
      const pos = query.start + title.length + 2
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="editor">
      <textarea
        ref={ref}
        value={value}
        autoFocus
        spellCheck
        placeholder="Write in Markdown. [[Link]] to other notes, #tag inline."
        onChange={(e) => {
          onChange(e.target.value)
          detect(e.target)
        }}
        onClick={(e) => detect(e.currentTarget)}
        onKeyDown={(e) => {
          if (!options.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % options.length) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + options.length) % options.length) }
          else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(options[sel].title) }
          else if (e.key === 'Escape') setQuery(null)
        }}
      />
      {options.length > 0 && (
        <ul className="ac" role="listbox">
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); insert(o.title) }}>
              <Icon name={TYPE_META[o.type].icon} size={14} /> {o.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
