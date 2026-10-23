import { useState } from 'react'
import { lastFolderSync, syncFolderNow, folderApi, useFolderInfo } from '../../sync/folder'
import { Icon } from '../Icon'
import { toast } from '../toast'
import { timeAgo } from '../util'
import { Section, Status } from './parts'

/** The no-account way to sync: any folder your Google Drive / OneDrive / Dropbox / Nextcloud app already keeps in sync. */
export function FolderCard() {
  const api = folderApi()
  const { info, refresh } = useFolderInfo()
  const [busy, setBusy] = useState(false)
  if (!api || !info) return null

  const last = lastFolderSync()
  const changed = () => {
    refresh()
    window.dispatchEvent(new Event('mv:folder-changed'))
  }
  const sync = async () => {
    setBusy(true)
    try {
      const r = await syncFolderNow()
      toast(`Synced with the folder: ${r.pushed} sent, ${r.pulled} received${r.skipped ? `, ${r.skipped} skipped` : ''}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sync failed', 'error')
    } finally {
      setBusy(false)
    }
  }
  const pick = async (path: string) => {
    await api.use(path)
    changed()
  }

  return (
    <Section icon="folder" title="Sync through a folder" status={info.path ? <Status kind="ok">On</Status> : <Status kind="off">Off</Status>}>
      <p className="muted">
        The simplest cloud sync: pick a folder that Google Drive, OneDrive, Dropbox or Nextcloud already keeps up to date, and Mindvault stores your notes
        in a <b>Mindvault</b> folder inside it. Do the same on your other computers. No accounts to connect, nothing to set up.
      </p>

      {info.path ? (
        <>
          <p className="path-line"><Icon name="folder" size={16} /> <code>{info.path}</code></p>
          <p className="muted small">
            Syncs by itself every few seconds while the app is open. {last ? `Last synced ${timeAgo(last)}.` : 'Not synced yet.'}
          </p>
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => void sync()}><Icon name="refresh" size={16} /> {busy ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn" onClick={async () => { await api.choose(); changed() }}>Change folder…</button>
            <button className="btn ghost" onClick={async () => { await api.clear(); changed() }}>Turn off</button>
          </div>
        </>
      ) : (
        <>
          {info.candidates.length > 0 ? (
            <>
              <p className="small"><b>Found on this computer</b></p>
              <div className="chips-row">
                {info.candidates.map((c) => (
                  <button key={c.path} className="btn" onClick={() => void pick(c.path)} title={c.path}><Icon name="cloud" size={16} /> {c.label}</button>
                ))}
              </div>
            </>
          ) : (
            <p className="hint">No Google Drive, OneDrive, Dropbox or Nextcloud folder was found. Install one of those apps, or pick any shared folder.</p>
          )}
          <div className="row">
            <button className="btn" onClick={async () => { await api.choose(); changed() }}>Choose another folder…</button>
          </div>
        </>
      )}
    </Section>
  )
}
