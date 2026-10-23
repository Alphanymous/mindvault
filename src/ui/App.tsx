import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SHORTCUTS, createSequencer } from '../core/keys'
import { applyCollection } from '../core/collections'
import type { Item } from '../core/types'
import { fileWaitingItems, useAppState } from '../data/store'
import { allCollections, useUsage } from '../data/usage'
import { captureFile, captureShared } from '../import/capture'
import { initNativeShare } from '../import/nativeShare'
import { syncNow } from '../sync/drive'
import { isSignedIn } from '../sync/google'
import { startFolderAutoSync } from '../sync/folder'
import { syncPeerNow } from '../sync/peer'
import { Capture } from './Capture'
import { GraphView } from './GraphView'
import { Home } from './Home'
import { Icon } from './Icon'
import { ItemView } from './ItemView'
import { Library } from './Library'
import { PairPage } from './PairPage'
import { Palette } from './Palette'
import { PromptsPage } from './PromptsPage'
import { Settings } from './Settings'
import { ShortcutsHelp } from './ShortcutsHelp'
import { runShortcut, type AppActions } from './commands'
import { href, useRoute, type Route } from './router'
import { dismiss, toast, useToasts } from './toast'
import { TYPE_META } from './util'

const AUTO_SYNC_MS = 5 * 60_000
const LONG_PRESS_MS = 450

interface CaptureState {
  text: string
  dictate: boolean
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable="true"]')

export function App() {
  const route = useRoute()
  const { settings, items } = useAppState()
  const usage = useUsage()
  const [palette, setPalette] = useState<string | null>(null)
  const [capture, setCapture] = useState<CaptureState | null>(null)
  const [help, setHelp] = useState(false)
  const toasts = useToasts()

  // theme: always write a concrete data-theme so the stylesheet needs no media query
  useEffect(() => {
    const root = document.documentElement
    const mq = matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const light = settings.theme === 'light' || (settings.theme === 'system' && mq.matches)
      root.setAttribute('data-theme', light ? 'light' : 'dark')
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim()
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#060a12')
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  const actions: AppActions = useMemo(
    () => ({
      openCapture: (o) => setCapture({ text: o?.text ?? '', dictate: !!o?.dictate }),
      openSearch: (initial = '') => setPalette(initial),
      openHelp: () => setHelp(true),
    }),
    [],
  )
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // keyboard shortcuts + global paste/drop
  useEffect(() => {
    const seq = createSequencer(SHORTCUTS)
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => (p === null ? '' : null)); return }
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); actionsRef.current.openCapture(); return }
      if (e.key === 'Escape') { setPalette(null); setCapture(null); setHelp(false); return }
      if (mod || e.altKey || isTyping(e.target)) return
      const action = seq.feed(e.key, Date.now())
      if (action) {
        e.preventDefault()
        runShortcut(action, actionsRef.current)
      }
    }
    const onPaste = async (e: ClipboardEvent) => {
      if (isTyping(e.target)) return
      const files = Array.from(e.clipboardData?.files ?? [])
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (files.length) {
        e.preventDefault()
        for (const f of files) await captureFile(f)
        toast(`Saved ${files.length} file${files.length > 1 ? 's' : ''}`, 'ok', { label: 'View', href: '#/library?c=new' })
      } else if (text.trim()) {
        e.preventDefault()
        actionsRef.current.openCapture({ text })
      }
    }
    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      for (const f of files) await captureFile(f)
      toast(`Saved ${files.length} file${files.length > 1 ? 's' : ''}`, 'ok', { label: 'View', href: '#/library?c=new' })
    }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    // Android widget / app shortcuts send "mv:quick" with a mode
    const onQuick = (e: Event) => {
      const mode = (e as CustomEvent<string>).detail
      if (mode === 'dictate') actionsRef.current.openCapture({ dictate: true })
      else if (mode === 'search') actionsRef.current.openSearch()
      else if (mode === 'prompts') runShortcut('prompts', actionsRef.current)
      else actionsRef.current.openCapture()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('mv:quick', onQuick)
    const onHelp = () => setHelp(true)
    window.addEventListener('mv:help', onHelp)
    return () => {
      window.removeEventListener('mv:help', onHelp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('mv:quick', onQuick)
    }
  }, [])

  // PWA share target (?title=&text=&url=) and the Android share sheet
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    if (q.has('url') || q.has('text') || q.has('title')) {
      history.replaceState(null, '', location.pathname + location.hash)
      void captureShared({ title: q.get('title'), text: q.get('text'), url: q.get('url') }).then((r) => {
        if (r.item) toast('Saved', r.warning ? 'warn' : 'ok', { label: 'View', href: '#/library?c=new' })
        else if (r.error) toast(r.error, 'error')
      })
    }
    return initNativeShare()
  }, [])

  // background sync
  useEffect(() => {
    if (!settings.autoSync || !settings.googleClientId) return
    let stop = false
    const tick = async () => {
      if (stop || !navigator.onLine || !isSignedIn()) return
      try { await syncNow(false) } catch { /* silent: manual sync shows errors */ }
    }
    const first = setTimeout(tick, 2500)
    const iv = setInterval(tick, AUTO_SYNC_MS)
    const onOnline = () => void tick()
    window.addEventListener('online', onOnline)
    return () => { stop = true; clearTimeout(first); clearInterval(iv); window.removeEventListener('online', onOnline) }
  }, [settings.autoSync, settings.googleClientId])

  // background sync with a paired computer (same Wi-Fi)
  useEffect(() => {
    if (!settings.peerAutoSync || !settings.peerUrl || !settings.peerToken) return
    let stop = false
    const tick = async () => {
      if (stop || !navigator.onLine || document.visibilityState === 'hidden') return
      try { await syncPeerNow() } catch { /* manual sync shows errors */ }
    }
    const first = setTimeout(tick, 1500)
    const iv = setInterval(tick, 60_000)
    const onVisible = () => void tick()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => { stop = true; clearTimeout(first); clearInterval(iv); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('online', onVisible) }
  }, [settings.peerAutoSync, settings.peerUrl, settings.peerToken])

  // items saved by older versions (or older synced devices) still sit in the old inbox: file them
  const waiting = items.some((i) => !i.deleted && i.status === 'inbox')
  useEffect(() => {
    if (waiting) void fileWaitingItems()
  }, [waiting])

  // folder sync (desktop): runs while a folder is chosen
  useEffect(() => startFolderAutoSync(), [])

  // long-press on the + button = hold to speak
  const pressTimer = useRef(0)
  const longPressed = useRef(false)
  const fabDown = useCallback(() => {
    longPressed.current = false
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true
      actionsRef.current.openCapture({ dictate: true })
    }, LONG_PRESS_MS)
  }, [])
  const fabUp = useCallback(() => window.clearTimeout(pressTimer.current), [])

  const collections = allCollections(usage)
  const live = useMemo(() => items.filter((i) => !i.deleted), [items])
  const byId = useMemo(() => new Map(live.map((i) => [i.id, i])), [live])
  const seen = useMemo(() => new Set(usage.seen), [usage.seen])
  const collectionCounts = useMemo(
    () => Object.fromEntries(collections.map((c) => [c.id, applyCollection(live, c.query, { seen, now: Date.now() }).length])),
    [collections, live, seen],
  )
  const freshCount = collectionCounts.new ?? 0
  const recent = usage.recent.map((id) => byId.get(id)).filter((i): i is Item => !!i).slice(0, 5)

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/home" aria-label="Mindvault home">
          <img src="icon.svg" alt="" width={28} height={28} /> <span>Mindvault</span>
        </a>
        <button className="search-btn" onClick={() => setPalette('')}>
          <Icon name="search" size={16} /> <span>Search</span> <kbd>Ctrl K</kbd>
        </button>
        <button className="btn primary capture-btn" onClick={() => actions.openCapture()}>
          <Icon name="plus" size={17} /> Capture
        </button>
        <nav>
          <NavLink route={{ name: 'home' }} active={route.name === 'home'} icon="home" label="Home" />
          <NavLink route={{ name: 'library' }} active={route.name === 'library' && !route.c} icon="library" label="Library" />
          <NavLink route={{ name: 'prompts' }} active={route.name === 'prompts'} icon="prompt" label="Prompts" />
          <NavLink route={{ name: 'graph' }} active={route.name === 'graph'} icon="graph" label="Graph" />
        </nav>
        <div className="side-group">
          <h5>Smart views</h5>
          <div className="smart-chips">
            {collections.map((c) => (
              <a key={c.id} href={href({ name: 'library', c: c.id })} className={`smart-chip ${route.name === 'library' && route.c === c.id ? 'on' : ''}`}>
                <Icon name={c.icon} size={13} /> {c.name}
                {!!collectionCounts[c.id] && <small>{collectionCounts[c.id]}</small>}
              </a>
            ))}
          </div>
        </div>
        {recent.length > 0 && (
          <div className="side-group">
            <h5>Recent</h5>
            <ul className="recent-list">
              {recent.map((i) => (
                <li key={i.id}>
                  <a href={href({ name: 'item', id: i.id })} className={route.name === 'item' && route.id === i.id ? 'on' : ''} data-type={i.type}>
                    <Icon name={TYPE_META[i.type].icon} size={14} /> <span>{i.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="spacer" />
        <button className="nav-link help-link" onClick={() => setHelp(true)}><Icon name="help" size={18} /> <span>Shortcuts</span> <kbd>?</kbd></button>
        <NavLink route={{ name: 'settings' }} active={route.name === 'settings'} icon="settings" label="Settings" />
      </aside>

      <main className="main">
        {route.name === 'home' && <Home onSearch={() => setPalette('')} onCapture={() => actions.openCapture()} />}
        {route.name === 'prompts' && <PromptsPage />}
        {route.name === 'library' && <Library route={route} />}
        {route.name === 'graph' && <GraphView key={route.focus ?? 'all'} focus={route.focus} />}
        {route.name === 'item' && <ItemView id={route.id} page={route.page} />}
        {route.name === 'settings' && <Settings route={route} />}
        {route.name === 'pair' && <PairPage token={route.token} />}
      </main>

      <nav className="tabbar" aria-label="Main">
        <TabLink route={{ name: 'home' }} active={route.name === 'home'} icon="home" label="Home" badge={freshCount} />
        <TabLink route={{ name: 'library' }} active={route.name === 'library' || route.name === 'item' || route.name === 'prompts'} icon="library" label="Library" />
        <button
          className="fab"
          onPointerDown={fabDown}
          onPointerUp={fabUp}
          onPointerLeave={fabUp}
          onPointerCancel={fabUp}
          onClick={() => { if (!longPressed.current) actions.openCapture() }}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Capture (hold to speak)"
        >
          <Icon name="plus" size={24} />
        </button>
        <TabLink route={{ name: 'graph' }} active={route.name === 'graph'} icon="graph" label="Graph" />
        <button className="tab" onClick={() => setPalette('')}><Icon name="search" size={21} /><span>Search</span></button>
      </nav>

      {palette !== null && <Palette initial={palette} onClose={() => setPalette(null)} actions={actions} />}
      {capture && <Capture initial={capture.text} dictate={capture.dictate} onClose={() => setCapture(null)} />}
      {help && <ShortcutsHelp onClose={() => setHelp(false)} />}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
            <span>{t.text}</span>
            {t.action && <a href={t.action.href} onClick={() => dismiss(t.id)}>{t.action.label}</a>}
          </div>
        ))}
      </div>
    </div>
  )
}

function NavLink({ route, active, icon, label, badge }: { route: Route; active: boolean; icon: string; label: string; badge?: number }) {
  return (
    <a href={href(route)} className={`nav-link ${active ? 'on' : ''}`}>
      <Icon name={icon} size={18} /> <span>{label}</span>
      {!!badge && <em className="badge">{badge}</em>}
    </a>
  )
}

function TabLink({ route, active, icon, label, badge }: { route: Route; active: boolean; icon: string; label: string; badge?: number }) {
  return (
    <a href={href(route)} className={`tab ${active ? 'on' : ''}`}>
      <span className="tab-icon"><Icon name={icon} size={21} />{!!badge && <em className="badge">{badge}</em>}</span>
      <span>{label}</span>
    </a>
  )
}
