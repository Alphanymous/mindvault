import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { saveSettings, useAppState } from '../data/store'
import type { PairInfo } from '../import/web'
import { buildBookmarklet, parsePairLink } from '../sync/pairing'
import { fetchPeerInfo, mixedContentProblem, savePairing, syncPeerNow, usePeerStatus, type PeerStatus } from '../sync/peer'
import { Icon } from './Icon'
import { ScanQr, qrScanSupported } from './ScanQr'
import { toast } from './toast'
import { copyText, timeAgo } from './util'

/** Desktop app: let a phone on the same Wi-Fi pair and sync. */
export function HostPanel() {
  const api = window.mindvault?.pair
  const [info, setInfo] = useState<PairInfo | null>(null)
  const [qr, setQr] = useState<string[]>([])

  useEffect(() => {
    void api?.get().then(setInfo)
  }, [api])
  useEffect(() => {
    let cancelled = false
    if (!info?.enabled) return setQr([])
    void Promise.all(info.links.map((l) => QRCode.toDataURL(l, { margin: 1, width: 220, errorCorrectionLevel: 'M' }))).then((u) => {
      if (!cancelled) setQr(u)
    })
    return () => {
      cancelled = true
    }
  }, [info])

  if (!api || !info) return null
  const set = async (enabled: boolean) => setInfo(await api.setEnabled(enabled))

  return (
    <section className="panel settings-section">
      <h3><Icon name="upload" size={18} /> Pair your phone</h3>
      <p className="muted">
        Sync notes, prompts and PDFs straight between your phone and this computer over your home Wi-Fi. No Google account needed. Only devices with the pairing code can connect.
      </p>
      <label className="switch">
        <input type="checkbox" checked={info.enabled} onChange={(e) => void set(e.target.checked)} />
        <span className="track" /> Allow phone pairing on this network
      </label>
      {info.enabled && info.links.length === 0 && (
        <p className="muted small">No network address found. Connect this computer to Wi-Fi or Ethernet.</p>
      )}
      {info.enabled && info.links.length > 0 && (
        <PairCard link={info.links[0]} qr={qr[0]}>
          <p className="small">
            On your phone, open Mindvault → Settings → Sync and scan this code. On an iPhone, open the link in Safari, then Share → Add to Home Screen.
          </p>
        </PairCard>
      )}
      {info.enabled && info.links.length > 1 && (
        <details className="guide">
          <summary>Code does not connect? Use an address instead</summary>
          <p className="muted small">The code above uses this computer’s network name, so it keeps working when your router changes the computer’s address. Some networks do not support names; use one of these then.</p>
          {info.links.slice(1).map((link, i) => <PairCard key={link} link={link} qr={qr[i + 1]} />)}
        </details>
      )}
      {info.enabled && (
        <>
          <p className="muted small">
            The first time, Windows asks whether to allow Mindvault on private networks. Choose <b>Private networks</b>. Traffic on your Wi-Fi is not encrypted, so only switch this on at home or on a network you trust.
          </p>
          <div className="row">
            <button
              className="btn"
              onClick={async () => {
                if (confirm('Create a new code? Phones paired with the old one will have to pair again.')) setInfo(await api.reset())
              }}
            >
              Reset pairing code
            </button>
          </div>
        </>
      )}
    </section>
  )
}

function PairCard({ link, qr, children }: { link: string; qr?: string; children?: React.ReactNode }) {
  return (
    <div className="pair-card">
      {qr && <img src={qr} alt="Pairing QR code" width={220} height={220} />}
      <div>
        {children}
        <code className="pair-link">{link}</code>
        <div className="row">
          <button className="btn" onClick={async () => toast((await copyText(link)) ? 'Pairing link copied' : 'Copy failed')}>
            <Icon name="copy" size={16} /> Copy link
          </button>
        </div>
      </div>
    </div>
  )
}

/** Desktop app: bookmarklet that sends the page you are viewing to Mindvault. */
export function ClipperPanel() {
  const api = window.mindvault?.pair
  const [info, setInfo] = useState<PairInfo | null>(null)
  const link = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    void api?.get().then(setInfo)
  }, [api])
  const code = info ? buildBookmarklet(info.clipUrl, info.token) : ''
  useEffect(() => {
    // React refuses javascript: URLs as props, so the bookmarklet is attached to the DOM node directly.
    if (link.current && code) link.current.setAttribute('href', code)
  }, [code])

  if (!api || !info) return null
  return (
    <section className="panel settings-section">
      <h3><Icon name="web" size={18} /> Browser clipper</h3>
      <p className="muted">
        Save the page you are looking at (or just the text you selected) from Chrome, Edge or Firefox straight into Mindvault, including pages that need you to be logged in.
        Drag this button to your bookmarks bar. Keep Mindvault running while you clip.
      </p>
      <div className="row">
        <a ref={link} className="btn primary bookmarklet" draggable onClick={(e) => e.preventDefault()}>
          <Icon name="plus" size={16} /> Save to Mindvault
        </a>
        <button className="btn" onClick={async () => toast((await copyText(code)) ? 'Bookmarklet copied. Paste it as the URL of a new bookmark.' : 'Copy failed')}>
          <Icon name="copy" size={16} /> Copy bookmarklet
        </button>
      </div>
      <p className="muted small">
        Chrome may ask once to allow the site to reach apps on your computer. A few sites with strict security rules block bookmarklets; use the link capture there. The bookmarklet contains your private code, so do not share it.
      </p>
    </section>
  )
}

/** Phone / other computer: connect to a desktop that has pairing switched on. */
export function PeerPanel() {
  const { settings } = useAppState()
  const [text, setText] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const paired = !!settings.peerUrl && !!settings.peerToken
  const status = usePeerStatus()

  const sync = useCallback(async () => {
    setBusy(true)
    try {
      const r = await syncPeerNow()
      toast(`Synced with your computer: ${r.pushed} sent, ${r.pulled} received${r.skipped ? `, ${r.skipped} skipped` : ''}`)
    } catch {
      // shown in the status line
    } finally {
      setBusy(false)
    }
  }, [])

  const pair = useCallback(
    async (raw: string) => {
      const target = parsePairLink(raw)
      if (!target) return toast('That is not a Mindvault pairing link.', 'error')
      const blocked = mixedContentProblem(target.url)
      if (blocked) return toast(blocked, 'error')
      setBusy(true)
      let info
      try {
        info = await fetchPeerInfo(target.url, target.token)
      } catch (e) {
        setBusy(false)
        return toast(e instanceof Error ? e.message : 'That computer did not accept the pairing link.', 'error')
      }
      setBusy(false)
      if (!info) return toast('Could not reach that computer. Same Wi-Fi? Is phone pairing switched on there?', 'error')
      await savePairing(target.url, target.token, info)
      setText('')
      setScanning(false)
      void sync()
    },
    [sync],
  )

  return (
    <section className="panel settings-section">
      <h3><Icon name="refresh" size={18} /> Sync with your computer</h3>
      {paired ? (
        <>
          <SyncStatus status={status} lastSyncAt={settings.lastPeerSyncAt} />
          {status.state === 'error' && <p className={`hint ${status.unreachable ? '' : 'bad'}`}>{status.message}</p>}
          <p className="muted small">Paired with <code>{settings.peerUrl}</code>. New items you save here go to your computer, and from there to your other paired devices.</p>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => void sync()}>
              <Icon name="refresh" size={16} /> {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn ghost" onClick={() => saveSettings({ peerUrl: '', peerToken: '', peerAltUrls: [] })}>Unpair</button>
            <label className="switch inline">
              <input type="checkbox" checked={settings.peerAutoSync} onChange={(e) => saveSettings({ peerAutoSync: e.target.checked })} />
              <span className="track" /> Auto-sync
            </label>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            On your computer open Mindvault → Settings → <b>Pair your phone</b>, then scan the code here or paste its link. Both devices must be on the same Wi-Fi.
          </p>
          {scanning ? (
            <ScanQr onResult={(v) => { setScanning(false); void pair(v) }} onClose={() => setScanning(false)} />
          ) : (
            <div className="row">
              {qrScanSupported() && (
                <button className="btn primary" onClick={() => setScanning(true)}><Icon name="search" size={16} /> Scan QR code</button>
              )}
            </div>
          )}
          <label className="field">
            <span>Or paste the pairing link</span>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="http://192.168.1.5:47822/#/pair/…" spellCheck={false} />
          </label>
          <div className="row">
            <button className="btn" disabled={busy || !text.trim()} onClick={() => void pair(text)}>{busy ? 'Connecting…' : 'Pair'}</button>
          </div>
        </>
      )}
    </section>
  )
}

function SyncStatus({ status, lastSyncAt }: { status: PeerStatus; lastSyncAt?: number }) {
  const last = lastSyncAt ? `last synced ${timeAgo(lastSyncAt)}` : 'not synced yet'
  if (status.state === 'syncing') return <p><span className="status"><i /> Syncing…</span></p>
  if (status.state === 'error')
    return <p><span className="status warn"><i /> {status.unreachable ? 'Computer not reachable' : 'Sync failed'} · {last}</span></p>
  if (status.state === 'ok') return <p><span className="status ok"><i /> Connected · {last}</span></p>
  if (lastSyncAt) return <p><span className="status"><i /> Paired · {last}</span></p>
  return <p><span className="status"><i /> Waiting for the first sync</span></p>
}
