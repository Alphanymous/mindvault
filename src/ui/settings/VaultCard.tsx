import { useEffect, useMemo, useState } from 'react'
import type { ItemType } from '../../core/types'
import { useAppState } from '../../data/store'
import { Icon } from '../Icon'
import { href } from '../router'
import { TYPE_META, formatBytes } from '../util'

const TYPES = Object.keys(TYPE_META) as ItemType[]

/** Vault at a glance: what is stored, how connected it is, and how much room it takes on this device. */
export function VaultCard() {
  const { items, links, tags } = useAppState()
  const live = useMemo(() => items.filter((i) => !i.deleted), [items])
  const [used, setUsed] = useState<number | undefined>()
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsed(e.usage))
  }, [live.length])

  const linkCount = useMemo(() => [...links.outgoing.values()].reduce((n, l) => n + l.length, 0), [links])
  const byType = TYPES.map((t) => ({ t, n: live.filter((i) => i.type === t).length })).filter((x) => x.n > 0)

  return (
    <section className="panel vault-card">
      <header className="vault-head">
        <span className="icon-tile"><Icon name="database" size={18} /></span>
        <div>
          <small className="caps ok-text">This device</small>
          <h3>Your vault</h3>
        </div>
        <span className="spacer" />
        <a className="btn" href={href({ name: 'settings', tab: 'data' })}><Icon name="download" size={15} /> Backup</a>
      </header>
      <div className="stat-grid">
        <div className="stat"><small>Items</small><b className="all">{live.length.toLocaleString()}</b></div>
        <div className="stat"><small>Links</small><b className="in">{linkCount.toLocaleString()}</b></div>
        <div className="stat"><small>Tags</small><b className="out">{tags.size.toLocaleString()}</b></div>
      </div>
      {byType.length > 0 && (
        <>
          <div className="share-bar" role="img" aria-label={byType.map((x) => `${x.n} ${TYPE_META[x.t].plural}`).join(', ')}>
            {byType.map((x) => <i key={x.t} data-type={x.t} style={{ flexGrow: x.n }} />)}
          </div>
          <ul className="share-legend">
            {byType.map((x) => (
              <li key={x.t} data-type={x.t}><i /> {TYPE_META[x.t].plural} <b>{x.n}</b></li>
            ))}
            {used !== undefined && <li className="share-used">{formatBytes(used)} on this device</li>}
          </ul>
        </>
      )}
    </section>
  )
}
