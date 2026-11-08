import { useState } from 'react'
import { mentionExcerpt } from '../../core/noteStats'
import type { Item } from '../../core/types'
import { Icon } from '../Icon'
import { href } from '../router'
import { timeAgo } from '../util'

const COLLAPSED = 4

/** Notes that link here, with the sentence that mentions this note. Shown under the text, like a footer. */
export function Mentions({ title, backlinks }: { title: string; backlinks: Item[] }) {
  const [open, setOpen] = useState(true)
  const [all, setAll] = useState(false)
  if (backlinks.length === 0) return null
  const shown = all ? backlinks : backlinks.slice(0, COLLAPSED)
  return (
    <section className="mentions">
      <button className="mentions-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="link" size={17} />
        <span>Mentioned in {backlinks.length} note{backlinks.length === 1 ? '' : 's'}</span>
        <span className={`chev ${open ? 'up' : ''}`}><Icon name="chevron" size={15} /></span>
      </button>
      {open && (
        <ul className="mention-list">
          {shown.map((b) => {
            const quote = mentionExcerpt(b.content, title)
            return (
              <li key={b.id}>
                <a className="mention-card" href={href({ name: 'item', id: b.id })}>
                  <span className="mention-top">
                    <Icon name="external" size={13} />
                    <span className="mention-title">[[{b.title}]]</span>
                    <small>{timeAgo(b.updatedAt)}</small>
                  </span>
                  {quote && <span className="mention-quote">“{quote}”</span>}
                </a>
              </li>
            )
          })}
        </ul>
      )}
      {open && backlinks.length > COLLAPSED && (
        <button className="link-btn small" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${backlinks.length}`}</button>
      )}
    </section>
  )
}
