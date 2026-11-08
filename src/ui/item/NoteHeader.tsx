import { useMemo } from 'react'
import { readingMinutes, wordCount } from '../../core/noteStats'
import type { Item } from '../../core/types'
import { Icon } from '../Icon'
import { href } from '../router'

const DATE_FMT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }

/** Library / folder / subfolder, each part a link into the library. */
export function Crumbs({ folder }: { folder: string }) {
  const parts = folder.split('/').filter(Boolean)
  return (
    <nav className="note-crumbs" aria-label="Folder">
      <Icon name="cluster" size={14} />
      <a href={href({ name: 'library' })}>Library</a>
      {parts.map((p, i) => (
        <a key={i} href={href({ name: 'library', folder: parts.slice(0, i + 1).join('/') })} className={i === parts.length - 1 ? 'here' : ''}>{p}</a>
      ))}
    </nav>
  )
}

/** Date, reading time and word count as small chips. */
export function MetaChips({ item, text }: { item: Item; text: string }) {
  const words = useMemo(() => wordCount(text), [text])
  return (
    <div className="meta-chips">
      <span className="meta-chip" title={`Updated ${new Date(item.updatedAt).toLocaleString()}`}>
        <Icon name="calendar" size={14} /> {new Date(item.updatedAt).toLocaleDateString(undefined, DATE_FMT)}
      </span>
      {words > 0 && <span className="meta-chip"><Icon name="clock" size={14} /> {readingMinutes(words)} min read</span>}
      <span className="meta-chip mono"><Icon name="words" size={14} /> {words.toLocaleString()} words</span>
    </div>
  )
}

/** "N backlinks · M outgoing" with a jump to the link panels. */
export function LinkStrip({ backlinks, outgoing, onInspect }: { backlinks: number; outgoing: number; onInspect(): void }) {
  return (
    <button className="link-strip" onClick={onInspect}>
      <span className="link-strip-icon"><Icon name="link" size={15} /></span>
      <b className="in">{backlinks} backlink{backlinks === 1 ? '' : 's'}</b>
      <span className="dot-sep">·</span>
      <b className="out">{outgoing} outgoing</b>
      <span className="spacer" />
      <span className="inspect">Inspect <Icon name="chevron" size={14} /></span>
    </button>
  )
}
