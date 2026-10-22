import { useRef, useState } from 'react'
import type { Item } from '../core/types'
import { sampleItems } from '../data/sample'
import { liveItems, replaceItemsFromSync, saveSettings, useAppState } from '../data/store'
import { isSignedIn, signOut } from '../sync/google'
import { syncNow } from '../sync/drive'
import { Icon } from './Icon'
import { toast } from './toast'
import { timeAgo } from './util'

export function Settings() {
  const { settings } = useAppState()
  const [syncing, setSyncing] = useState(false)
  const [signed, setSigned] = useState(isSignedIn())
  const [clientId, setClientId] = useState(settings.googleClientId)
  const importRef = useRef<HTMLInputElement>(null)
  const origin = location.origin

  const sync = async (interactive: boolean) => {
    if (clientId !== settings.googleClientId) await saveSettings({ googleClientId: clientId.trim() })
    setSyncing(true)
    try {
      const r = await syncNow(interactive)
      setSigned(true)
      toast(`Synced: ${r.pushed} sent, ${r.pulled} received`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ version: 1, items: liveItems() }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `mindvault-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  const importJson = async (file?: File) => {
    if (!file) return
    try {
      const data = JSON.parse(await file.text()) as { items?: Item[] }
      if (!Array.isArray(data.items)) throw new Error('Not a Mindvault backup.')
      await replaceItemsFromSync(data.items.filter((i) => i && i.id && i.title !== undefined))
      toast(`Imported ${data.items.length} items`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed', 'error')
    }
  }

  const loadSample = async () => {
    await replaceItemsFromSync(sampleItems())
    toast('Sample notes added')
  }

  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Settings</h1><p className="sub">Everything is stored on this device. Sync is optional.</p></div></header>

      <section className="panel">
        <h3>Appearance</h3>
        <div className="seg">
          {(['dark', 'light', 'system'] as const).map((t) => (
            <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => saveSettings({ theme: t })}>{t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3><Icon name="cloud" size={18} /> Google Drive sync</h3>
        <p className="muted">
          Stores your vault in this app&rsquo;s private Drive app-data folder. It does not appear in Drive&rsquo;s file list and only this app can read it.
          You need your own OAuth client ID (one-time, free): see <code>docs/GOOGLE_DRIVE_SETUP.md</code>.
        </p>
        <label className="field">
          <span>Google OAuth client ID</span>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890-abc123.apps.googleusercontent.com" spellCheck={false} />
        </label>
        <p className="muted small">Authorised JavaScript origin to register for this app: <code>{origin}</code></p>
        <div className="row">
          <button className="btn primary" disabled={syncing || !clientId.trim()} onClick={() => sync(true)}>
            <Icon name="refresh" size={16} /> {syncing ? 'Syncing…' : signed ? 'Sync now' : 'Sign in & sync'}
          </button>
          {signed && <button className="btn" onClick={async () => { await signOut(); setSigned(false) }}>Sign out</button>}
          <label className="switch inline">
            <input type="checkbox" checked={settings.autoSync} onChange={(e) => saveSettings({ autoSync: e.target.checked })} />
            <span className="track" /> Auto-sync
          </label>
        </div>
        <p className="muted small">{settings.lastSyncAt ? `Last synced ${timeAgo(settings.lastSyncAt)}` : 'Never synced'}</p>
      </section>

      <section className="panel">
        <h3>Web clipping</h3>
        <p className="muted">
          The desktop and Android apps download pages directly. A plain browser is blocked by CORS on most sites; optionally route through your own proxy.
          Use <code>{'{url}'}</code> as the placeholder. Leave empty to save links only.
        </p>
        <label className="field">
          <span>Clip proxy</span>
          <input value={settings.clipProxy} onChange={(e) => saveSettings({ clipProxy: e.target.value })} placeholder="https://your-proxy.example/?url={url}" spellCheck={false} />
        </label>
      </section>

      <section className="panel">
        <h3><Icon name="sparkle" size={18} /> AI sorting (optional)</h3>
        <p className="muted">Rules sort everything offline. Add any OpenAI-compatible chat endpoint to refine folders and tags. The first 3000 characters of each new item are sent to it.</p>
        <label className="field"><span>Endpoint</span>
          <input value={settings.llmEndpoint} onChange={(e) => saveSettings({ llmEndpoint: e.target.value })} placeholder="https://api.openai.com/v1/chat/completions" spellCheck={false} />
        </label>
        <div className="row two">
          <label className="field"><span>Model</span><input value={settings.llmModel} onChange={(e) => saveSettings({ llmModel: e.target.value })} spellCheck={false} /></label>
          <label className="field"><span>API key</span><input type="password" value={settings.llmApiKey} onChange={(e) => saveSettings({ llmApiKey: e.target.value })} spellCheck={false} /></label>
        </div>
      </section>

      <section className="panel">
        <h3>Your data</h3>
        <div className="row">
          <button className="btn" onClick={exportJson}><Icon name="download" size={16} /> Export backup (JSON)</button>
          <button className="btn" onClick={() => importRef.current?.click()}><Icon name="upload" size={16} /> Import backup</button>
          <button className="btn ghost" onClick={loadSample}>Add sample notes</button>
          <input ref={importRef} type="file" accept="application/json" hidden onChange={(e) => { void importJson(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      </section>
    </div>
  )
}
