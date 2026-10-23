import { useEffect, useState } from 'react'
import { checkClientId } from '../../core/providers'
import { testDrive } from '../../data/connections'
import { saveSettings, useAppState } from '../../data/store'
import { syncNow } from '../../sync/drive'
import { sessionInfo, signOut } from '../../sync/google'
import { Icon } from '../Icon'
import { toast } from '../toast'
import { copyText, timeAgo } from '../util'
import { ExternalLink, Section, Status, Step, Steps, TestButton } from './parts'

function useGoogleSession() {
  const [session, setSession] = useState(sessionInfo())
  useEffect(() => {
    const on = () => setSession(sessionInfo())
    window.addEventListener('mv:google-session', on)
    const t = setInterval(on, 30_000)
    return () => {
      window.removeEventListener('mv:google-session', on)
      clearInterval(t)
    }
  }, [])
  return [session, () => setSession(sessionInfo())] as const
}

const BAKED_CLIENT_ID = !!(import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)

export function DriveCard() {
  const { settings } = useAppState()
  const [session, refresh] = useGoogleSession()
  const [clientId, setClientId] = useState(settings.googleClientId)
  const [syncing, setSyncing] = useState(false)
  const check = checkClientId(clientId)
  const saved = checkClientId(settings.googleClientId).ok
  const origin = location.origin
  const [guideOpen, setGuideOpen] = useState(!saved)

  const status = session.signedIn ? (
    <Status kind="ok">Connected{session.email ? ` as ${session.email}` : ''}</Status>
  ) : saved ? (
    <Status kind="warn">Ready to sign in</Status>
  ) : (
    <Status kind="off">Not set up</Status>
  )

  const saveId = async () => {
    if (!check.ok) return toast(check.reason, 'error')
    await saveSettings({ googleClientId: clientId.trim() })
    toast('Client ID saved')
  }

  const sync = async () => {
    setSyncing(true)
    try {
      const r = await syncNow(true)
      toast(`Synced with Google Drive: ${r.pushed} sent, ${r.pulled} received`)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sync failed', 'error')
    } finally {
      setSyncing(false)
      refresh()
    }
  }

  return (
    <Section icon="cloud" title="Google Drive" status={status}>
      <p className="muted">
        Keeps your vault in a private folder of <i>your</i> Google Drive so every device sees the same notes. You sign in on Google&rsquo;s own page, so your
        password is never typed into Mindvault. Only this app can open that folder, and it does not show up in Drive&rsquo;s file list.
      </p>

      {!BAKED_CLIENT_ID && <details className="guide" open={guideOpen} onToggle={(e) => setGuideOpen((e.target as HTMLDetailsElement).open)}>
        <summary>One-time setup (about 5 minutes, free)</summary>
        <Steps>
          <Step done={saved} title="Create a Google Cloud project">
            <ExternalLink href="https://console.cloud.google.com/projectcreate">Open Google Cloud</ExternalLink> and create a project named Mindvault.
          </Step>
          <Step done={saved} title="Turn on the Google Drive API">
            <ExternalLink href="https://console.cloud.google.com/apis/library/drive.googleapis.com">Open the Drive API page</ExternalLink> and press <b>Enable</b>.
          </Step>
          <Step done={saved} title="Set up the consent screen">
            <ExternalLink href="https://console.cloud.google.com/auth/overview">Open Google Auth platform</ExternalLink>. Choose <b>External</b>, name it Mindvault, then under
            <b> Audience</b> add your own Google address as a <b>test user</b>. Under <b>Data access</b> add the scope <code>drive.appdata</code>.
          </Step>
          <Step done={saved} title="Create a web client ID">
            <ExternalLink href="https://console.cloud.google.com/auth/clients/create">Create an OAuth client</ExternalLink> of type <b>Web application</b>. Add this exact address under
            <b> Authorized JavaScript origins</b>:
            <div className="copy-row">
              <code>{origin}</code>
              <button className="btn" onClick={async () => toast((await copyText(origin)) ? 'Address copied' : 'Copy failed')}><Icon name="copy" size={14} /> Copy</button>
            </div>
            <span className="muted small">Using the desktop app, the browser version and the phone browser too? Add each address you open Mindvault from.</span>
          </Step>
        </Steps>
      </details>}

      {!BAKED_CLIENT_ID && <label className="field">
        <span>Client ID (from step 4)</span>
        <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="123456789012-abc123….apps.googleusercontent.com" spellCheck={false} aria-invalid={clientId !== '' && !check.ok} />
      </label>}
      {!BAKED_CLIENT_ID && clientId !== '' && !check.ok && <p className="hint bad">{check.reason}</p>}
      {!BAKED_CLIENT_ID && check.ok && clientId.trim() !== settings.googleClientId && <p className="hint">Looks right. Save it to continue.</p>}

      <div className="row">
        {!BAKED_CLIENT_ID && <button className="btn" disabled={!check.ok || clientId.trim() === settings.googleClientId} onClick={() => void saveId()}>Save client ID</button>}
        {!session.signedIn && <TestButton primary label="Sign in with Google" disabled={!saved} run={async () => { const r = await testDrive(); refresh(); return r }} />}
        {session.signedIn && (
          <>
            <button className="btn primary" disabled={syncing} onClick={() => void sync()}><Icon name="refresh" size={16} /> {syncing ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn" onClick={async () => { const r = await testDrive({ switchAccount: true }); toast(r.message, r.ok ? 'ok' : 'error'); refresh() }}>Use another account</button>
            <button className="btn ghost" onClick={async () => { await signOut(); refresh() }}>Sign out</button>
          </>
        )}
      </div>

      {session.signedIn && (
        <div className="kv">
          <label className="switch">
            <input type="checkbox" checked={settings.autoSync} onChange={(e) => saveSettings({ autoSync: e.target.checked })} />
            <span className="track" /> Sync automatically every few minutes
          </label>
          <p className="muted small">
            {settings.lastSyncAt ? `Last synced ${timeAgo(settings.lastSyncAt)}. ` : 'Not synced yet. '}
            Google keeps you connected for about an hour at a time; Mindvault reconnects quietly while you are signed in to Google in this browser.
          </p>
        </div>
      )}

      <details className="guide">
        <summary>Something went wrong?</summary>
        <ul className="trouble">
          <li><b>“Error 400: origin_mismatch”</b>: the address in step 4 is missing or has a typo. It must match <code>{origin}</code> exactly, with no slash at the end.</li>
          <li><b>“Access blocked” or “access_denied”</b>: add your Google address as a test user (step 3), or press <i>Publish app</i> on the Audience page.</li>
          <li><b>“Drive API has not been used”</b>: step 2 is not finished. Enable it, wait a minute, retry.</li>
          <li><b>The sign-in window never appears</b>: allow pop-ups for this site.</li>
          <li><b>You are asked to sign in every week</b>: apps in Testing mode expire after 7 days. Publishing the app (no review needed for this scope) removes that.</li>
          <li><b>Android app</b>: Google&rsquo;s sign-in window often does not work inside an app WebView. Sync that phone over Wi-Fi with the pairing code instead (Sync → Phone and computer).</li>
        </ul>
      </details>
    </Section>
  )
}
