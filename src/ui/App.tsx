import { useCallback, useEffect, useState } from 'react'
import { useAppState } from '../data/store'
import { captureFile, captureShared } from '../import/capture'
import { initNativeShare } from '../import/nativeShare'
import { syncNow } from '../sync/drive'
import { isSignedIn } from '../sync/google'
import { syncPeerNow } from '../sync/peer'
import { Capture } from './Capture'
import { GraphView } from './GraphView'
import { Icon } from './Icon'
import { Inbox } from './Inbox'
import { ItemView } from './ItemView'
import { Library } from './Library'
import { PairPage } from './PairPage'
import { Palette } from './Palette'
import { Settings } from './Settings'
import { href, useRoute, type Route } from './router'
import { dismiss, toast, useToasts } from './toast'

const AUTO_SYNC_MS = 5 * 60_000

export function App() {
  const route = useRoute()
  const { settings, items, folders } = useAppState()
  const [palette, setPalette] = useState(false)
  const [capture, setCapture] = useState<string | null>(null)
  const toasts = useToasts()

  // theme
  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', settings.theme === 'light' ? '#f6f6f9' : '#0e0f13')
  }, [settings.theme])

  const openCapture = useCallback((text = '') => setCapture(text), [])

  // keyboard shortcuts + global paste/drop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) }
      else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); openCapture() }
      else if (e.key === 'Escape') { setPalette(false); setCapture(null) }
    }
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable]')) return
      const files = Array.from(e.clipboardData?.files ?? [])
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (files.length) {
        e.preventDefault()
        for (const f of files) await captureFile(f)
        toast(`Saved ${files.length} file${files.length > 1 ? 's' : ''} to your inbox`, 'ok', { label: 'Review', href: '#/inbox' })
      } else if (text.trim()) {
        e.preventDefault()
        openCapture(text)
      }
    }
    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer.files)
      for (const f of files) await captureFile(f)
      toast(`Saved ${files.length} file${files.length > 1 ? 's' : ''} to your inbox`, 'ok', { label: 'Review', href: '#/inbox' })
    }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    window.addEventListener('keydown', onKey)
    window.addEventListener('paste', onPaste)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
    }
  }, [openCapture])

  // PWA share target (?title=&text=&url=) and the Android share sheet
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    if (q.has('url') || q.has('text') || q.has('title')) {
      history.replaceState(null, '', location.pathname + location.hash)
      void captureShared({ title: q.get('title'), text: q.get('text'), url: q.get('url') }).then((r) => {
        if (r.item) toast('Saved to your inbox', r.warning ? 'warn' : 'ok', { label: 'Review', href: '#/inbox' })
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

  const inboxCount = items.filter((i) => !i.deleted && i.status === 'inbox').length
  const tree = buildTree(folders)

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/inbox" aria-label="Mindvault home">
          <img src="icon.svg" alt="" width={28} height={28} /> <span>Mindvault</span>
        </a>
        <button className="search-btn" onClick={() => setPalette(true)}>
          <Icon name="search" size={16} /> <span>Search</span> <kbd>Ctrl K</kbd>
        </button>
        <button className="btn primary capture-btn" onClick={() => openCapture()}>
          <Icon name="plus" size={17} /> Capture
        </button>
        <nav>
          <NavLink route={{ name: 'inbox' }} active={route.name === 'inbox'} icon="inbox" label="Inbox" badge={inboxCount} />
          <NavLink route={{ name: 'library' }} active={route.name === 'library' && !route.folder && !route.type} icon="library" label="Library" />
          <NavLink route={{ name: 'library', type: 'prompt' }} active={route.name === 'library' && route.type === 'prompt'} icon="prompt" label="Prompts" />
          <NavLink route={{ name: 'graph' }} active={route.name === 'graph'} icon="graph" label="Graph" />
        </nav>
        {tree.length > 0 && (
          <div className="folders">
            <h5>Folders</h5>
            <FolderTree nodes={tree} current={route.name === 'library' ? route.folder : undefined} />
          </div>
        )}
        <div className="spacer" />
        <NavLink route={{ name: 'settings' }} active={route.name === 'settings'} icon="settings" label="Settings" />
      </aside>

      <main className="main">
        {route.name === 'inbox' && <Inbox onCapture={() => openCapture()} />}
        {route.name === 'library' && <Library route={route} />}
        {route.name === 'graph' && <GraphView key={route.focus ?? 'all'} focus={route.focus} />}
        {route.name === 'item' && <ItemView id={route.id} />}
        {route.name === 'settings' && <Settings />}
        {route.name === 'pair' && <PairPage token={route.token} />}
      </main>

      <nav className="tabbar" aria-label="Main">
        <TabLink route={{ name: 'inbox' }} active={route.name === 'inbox'} icon="inbox" label="Inbox" badge={inboxCount} />
        <TabLink route={{ name: 'library' }} active={route.name === 'library' || route.name === 'item'} icon="library" label="Library" />
        <button className="fab" onClick={() => openCapture()} aria-label="Capture"><Icon name="plus" size={24} /></button>
        <TabLink route={{ name: 'graph' }} active={route.name === 'graph'} icon="graph" label="Graph" />
        <button className="tab" onClick={() => setPalette(true)}><Icon name="search" size={21} /><span>Search</span></button>
      </nav>

      {palette && <Palette onClose={() => setPalette(false)} onCapture={() => openCapture()} />}
      {capture !== null && <Capture initial={capture} onClose={() => setCapture(null)} />}

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

interface TreeNode { name: string; path: string; children: TreeNode[] }

function buildTree(folders: string[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const path of folders) {
    const parts = path.split('/')
    let level = root
    parts.forEach((name, i) => {
      const p = parts.slice(0, i + 1).join('/')
      let node = level.find((n) => n.path === p)
      if (!node) {
        node = { name, path: p, children: [] }
        level.push(node)
      }
      level = node.children
    })
  }
  return root
}

function FolderTree({ nodes, current }: { nodes: TreeNode[]; current?: string }) {
  return (
    <ul className="tree">
      {nodes.map((n) => (
        <li key={n.path}>
          <a href={href({ name: 'library', folder: n.path })} className={current === n.path ? 'on' : ''}>
            <Icon name="folder" size={15} /> {n.name}
          </a>
          {n.children.length > 0 && <FolderTree nodes={n.children} current={current} />}
        </li>
      ))}
    </ul>
  )
}

