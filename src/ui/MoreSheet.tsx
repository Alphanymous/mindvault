import { useEffect, useRef } from 'react'
import { Icon } from './Icon'
import { useModal } from './modal'
import { href, type Route } from './router'

/** Matches the stylesheet's phone breakpoint (max-width: 820px). */
const PHONE_MAX_PX = 820

interface Props {
  route: Route
  onClose(): void
  onSearch(): void
}

const LINKS: { route: Route; icon: string; label: string; hint: string }[] = [
  { route: { name: 'prompts' }, icon: 'prompt', label: 'Prompts', hint: 'Your prompt toolbox' },
  { route: { name: 'clusters' }, icon: 'cluster', label: 'Clusters', hint: 'Regions, tags and gaps in your vault' },
  { route: { name: 'settings' }, icon: 'settings', label: 'Settings', hint: 'Sync, capture, data and theme' },
]

/** Phone bottom sheet behind the tab bar's "More": the pages that do not fit in five tabs. */
export function MoreSheet({ route, onClose, onSearch }: Props) {
  const overlay = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useModal(overlay, dialog)
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('a, button')?.focus()
  }, [])
  // the sheet belongs to the phone tab bar: close it if the window grows into the desktop layout
  useEffect(() => {
    const wide = matchMedia(`(min-width: ${PHONE_MAX_PX + 1}px)`)
    const onChange = () => { if (wide.matches) onClose() }
    onChange()
    wide.addEventListener('change', onChange)
    return () => wide.removeEventListener('change', onChange)
  }, [onClose])

  return (
    <div className="overlay sheet-overlay" ref={overlay} onMouseDown={onClose}>
      <div className="sheet glass" ref={dialog} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="More">
        <span className="sheet-grip" aria-hidden="true" />
        <ul className="sheet-list">
          <li>
            <button className="sheet-link" onClick={() => { onClose(); onSearch() }}>
              <span className="icon-tile sm"><Icon name="search" size={16} /></span>
              <span><b>Search</b><small>Notes, tags, folders and commands</small></span>
            </button>
          </li>
          {LINKS.map((l) => (
            <li key={l.route.name}>
              <a className="sheet-link" href={href(l.route)} onClick={onClose} aria-current={route.name === l.route.name ? 'page' : undefined}>
                <span className="icon-tile sm"><Icon name={l.icon} size={16} /></span>
                <span><b>{l.label}</b><small>{l.hint}</small></span>
              </a>
            </li>
          ))}
        </ul>
        <button className="btn block" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
