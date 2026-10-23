import { useMemo, useState } from 'react'
import { excerpt, parseFrontmatter } from '../core/markdown'
import { topModels } from '../core/usage'
import type { Item } from '../core/types'
import { createItem, updateItem, useAppState } from '../data/store'
import { useUsage } from '../data/usage'
import { Icon } from './Icon'
import { go, href } from './router'
import { quickCopyPrompt, rankPrompts } from './promptActions'
import { toast } from './toast'

type Filter = 'all' | 'favorites' | 'recent' | string

export function PromptsPage() {
  const { items } = useAppState()
  const usage = useUsage()
  const [filter, setFilter] = useState<Filter>('all')
  const [text, setText] = useState('')

  const prompts = useMemo(() => rankPrompts(items, usage.prompts), [items, usage.prompts])
  const categories = useMemo(() => [...new Set(prompts.map((p) => p.folder || 'Unfiled'))].sort(), [prompts])

  const shown = prompts.filter((p) => {
    if (filter === 'favorites' && !p.pinned) return false
    if (filter === 'recent' && !usage.prompts[p.id]) return false
    if (filter !== 'all' && filter !== 'favorites' && filter !== 'recent' && (p.folder || 'Unfiled') !== filter) return false
    const q = text.trim().toLowerCase()
    return !q || `${p.title} ${p.tags.join(' ')} ${p.content}`.toLowerCase().includes(q)
  })
  const ordered = filter === 'recent' ? [...shown].sort((a, b) => (usage.prompts[b.id]?.last ?? 0) - (usage.prompts[a.id]?.last ?? 0)) : shown

  const create = async () => {
    const it = await createItem({
      type: 'prompt',
      title: 'New prompt',
      content: 'You are a helpful assistant.\n\nTask: {{task}}\n',
      organized: true,
      folder: filter !== 'all' && !['favorites', 'recent'].includes(filter) && filter !== 'Unfiled' ? filter : 'AI/Prompts',
      tags: ['prompt'],
    })
    go({ name: 'item', id: it.id })
  }

  const copy = async (p: Item) => {
    const r = await quickCopyPrompt(p)
    if (r === 'copied') toast(`Copied “${p.title}”`)
    else if (r === 'needs-input') {
      toast('This prompt has blanks to fill. Opening it.')
      go({ name: 'item', id: p.id })
    } else toast('Copy failed', 'error')
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Prompts</h1>
          <p className="sub">{prompts.length} saved. One tap copies a prompt with your remembered answers filled in.</p>
        </div>
        <button className="btn primary" onClick={() => void create()}><Icon name="plus" size={16} /> New prompt</button>
      </header>

      <div className="search-field">
        <Icon name="search" size={16} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter prompts…" aria-label="Filter prompts" />
      </div>
      <div className="filters">
        {[['all', 'All'], ['favorites', 'Favorites'], ['recent', 'Recently used']].map(([k, label]) => (
          <button key={k} className={`pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
        {categories.map((c) => (
          <button key={c} className={`pill ${filter === c ? 'on' : ''}`} onClick={() => setFilter(c)}><Icon name="folder" size={13} /> {c.split('/').pop()}</button>
        ))}
      </div>

      {ordered.length === 0 ? (
        <div className="empty">
          <h2>No prompts here</h2>
          <p>Paste a prompt into Capture, or create one with “New prompt”.</p>
        </div>
      ) : (
        <ul className="stack">
          {ordered.map((p) => {
            const stat = usage.prompts[p.id]
            const variantOf = parseFrontmatter(p.content).data.variant_of
            return (
              <li key={p.id} className="card prompt-row" data-type="prompt">
                <button className={`star ${p.pinned ? 'on' : ''}`} onClick={() => updateItem(p.id, { pinned: !p.pinned })} aria-label={p.pinned ? 'Remove from favorites' : 'Add to favorites'}>
                  <Icon name="sparkle" size={18} />
                </button>
                <a className="prompt-row-main" href={href({ name: 'item', id: p.id })}>
                  <h3>{p.title}{variantOf ? <span className="chip">variant</span> : null}</h3>
                  <p className="muted clamp2">{excerpt(p.content, 180)}</p>
                  <div className="meta">
                    <span>{p.folder || 'Unfiled'}</span>
                    {stat && <span>used {stat.count}×{topModels(stat, 1)[0] ? ` · ${topModels(stat, 1)[0][0]}` : ''}</span>}
                  </div>
                </a>
                <button className="btn" onClick={() => void copy(p)}><Icon name="copy" size={15} /> Copy</button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
