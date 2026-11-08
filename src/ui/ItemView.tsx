import { useEffect, useMemo, useState } from 'react'
import { buildGraph, neighborhood } from '../core/links'
import { normalizeTag, parseInlineTags } from '../core/markdown'
import type { Annotation, GraphNode, Item } from '../core/types'
import { createItem, deleteItem, getBlob, updateItem, useAppState } from '../data/store'
import { useRelated } from '../data/meaning'
import { markOpened } from '../data/usage'
import { GraphCanvas } from './GraphCanvas'
import { Editor } from './item/Editor'
import { Mentions } from './item/Mentions'
import { Crumbs, LinkStrip, MetaChips } from './item/NoteHeader'
import { Icon } from './Icon'
import { PdfReader } from './PdfReader'
import { PromptToolbox } from './PromptToolbox'
import { AnnotatedMarkdown, HighlightsPanel, scrollToAnnotation } from './Reader'
import { go, href } from './router'
import { toast } from './toast'
import { TYPE_META, formatBytes, hostOf, useDebounced } from './util'

type Mode = 'read' | 'edit' | 'pdf'

export function ItemView({ id, page }: { id: string; page?: number }) {
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
  return <ItemBody key={item.id} item={item} page={page} />
}

function initialMode(item: Item): Mode {
  if (item.type === 'pdf' && item.blobId) return 'pdf'
  if (item.type === 'note' && item.content.trim() === '') return 'edit'
  if (item.type === 'prompt' && item.title === 'New prompt') return 'edit'
  return 'read'
}

function ItemBody({ item, page }: { item: Item; page?: number }) {
  const { folders, links, items } = useAppState()
  const meta = TYPE_META[item.type]
  const [mode, setMode] = useState<Mode>(() => initialMode(item))
  const [target, setTarget] = useState<{ page: number; n: number } | undefined>(page ? { page, n: 1 } : undefined)
  const [draft, setDraft] = useState(item.content)
  const [title, setTitle] = useState(item.title)
  const debDraft = useDebounced(draft, 450)
  const debTitle = useDebounced(title, 450)
  const related = useRelated(item.id, 5)

  useEffect(() => markOpened(item.id), [item.id])
  useEffect(() => {
    if (page) {
      setMode('pdf')
      setTarget((t) => ({ page, n: (t?.n ?? 0) + 1 }))
    }
  }, [page])

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
  const linkedIds = new Set([...backlinks, ...outgoing].map((i) => i.id))

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

  /** Add "Related: [[Title]]" so the connection shows up in the graph. */
  const linkTo = (other: Item) => {
    const next = `${draft.trimEnd()}\n\nRelated: [[${other.title}]]\n`
    setDraft(next)
    void updateItem(item.id, { content: next })
    toast(`Linked to “${other.title}”`)
  }

  const goTo = (a: Annotation) => {
    if (a.page) {
      setMode('pdf')
      setTarget((t) => ({ page: a.page!, n: (t?.n ?? 0) + 1 }))
    } else {
      setMode('read')
      setTimeout(() => scrollToAnnotation(a), 80)
    }
  }

  const canHighlight = item.type !== 'prompt'
  const inspectLinks = () => {
    const el = document.getElementById('item-links')
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.classList.remove('flash')
    requestAnimationFrame(() => el?.classList.add('flash'))
  }

  return (
    <div className="page item-page">
      <div className="item-main">
        <header className="item-head">
          <a className="btn ghost" href="javascript:history.back()" onClick={(e) => { e.preventDefault(); history.back() }} aria-label="Back">
            <Icon name="back" size={18} />
          </a>
          <Crumbs folder={item.folder} />
          <span className="type-badge" data-type={item.type}><Icon name={meta.icon} size={13} /> {meta.label}</span>
          <button className={`btn ghost ${item.pinned ? 'pinned' : ''}`} onClick={() => updateItem(item.id, { pinned: !item.pinned })} title="Pin" aria-pressed={!!item.pinned}>
            <Icon name="sparkle" size={16} /> <span className="hide-mobile">{item.pinned ? 'Pinned' : 'Pin'}</span>
          </button>
          <button className="btn ghost danger" onClick={remove} aria-label="Delete"><Icon name="trash" size={16} /></button>
        </header>

        <div className="title-wrap">
          <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        </div>

        <MetaChips item={item} text={draft} />
        <LinkStrip backlinks={backlinks.length} outgoing={outgoing.length} onInspect={inspectLinks} />

        <div className="meta-row">
          <label className="folder-pick">
            <Icon name="folder" size={14} />
            <input
              list="folder-list-item"
              value={item.folder}
              placeholder="Unfiled"
              aria-label="Folder"
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
        {item.size ? <div className="muted small">{formatBytes(item.size)}</div> : null}

        {(item.type === 'pdf' || item.type === 'file') && <BlobActions item={item} />}

        <div className="seg">
          {item.type === 'pdf' && item.blobId && (
            <button className={mode === 'pdf' ? 'on' : ''} onClick={() => setMode('pdf')}><Icon name="pdf" size={15} /> PDF</button>
          )}
          <button className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}><Icon name="eye" size={15} /> {item.type === 'pdf' ? 'Text' : 'Read'}</button>
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}><Icon name="edit" size={15} /> Edit</button>
        </div>

        {mode === 'edit' ? (
          <Editor value={draft} onChange={setDraft} selfId={item.id} />
        ) : mode === 'pdf' ? (
          <PdfReader item={item} target={target} />
        ) : item.type === 'prompt' ? (
          <PromptToolbox item={item} content={draft} />
        ) : draft.trim() ? (
          <AnnotatedMarkdown item={item} source={draft} />
        ) : (
          <p className="muted">Empty. Switch to Edit and start writing. Link notes with [[double brackets]].</p>
        )}
        {mode !== 'edit' && <Mentions title={item.title} backlinks={backlinks} />}
      </div>

      <aside className="item-side">
        {canHighlight && <HighlightsPanel item={item} onGo={goTo} />}
        <section className="panel">
          <h4>Local graph</h4>
          <div className="mini-graph">
            <GraphCanvas data={local} selectedId={item.id} onSelect={() => {}} onOpen={onGraphOpen} compact />
          </div>
          <a className="btn block" href={href({ name: 'graph', focus: item.id })}><Icon name="graph" size={16} /> Open in graph</a>
        </section>
        {related.length > 0 && (
          <section className="panel">
            <h4>Related</h4>
            <ul className="mini-list">
              {related.map((r) => (
                <li key={r.id} className="related-row">
                  <a href={href({ name: 'item', id: r.id })}><Icon name={TYPE_META[r.type].icon} size={14} /> {r.title}</a>
                  {!linkedIds.has(r.id) && (
                    <button className="link-btn small" onClick={() => linkTo(r)} title="Add a [[link]] to this note">Link</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <div id="item-links" className="item-links">
        <LinkList title={`Linked from (${backlinks.length})`} items={backlinks} empty="No notes link here yet." />
        <LinkList title={`Links to (${outgoing.length})`} items={outgoing} empty="Use [[Note title]] to link." />
        </div>
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
        aria-label="Add tag"
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
