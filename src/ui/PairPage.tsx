import { useEffect, useState } from 'react'
import { TOKEN_RE } from '../sync/pairing'
import { fetchPeerInfo, savePairing, syncPeerNow } from '../sync/peer'
import { go } from './router'
import { toast } from './toast'

/**
 * Opened when a phone browser follows the pairing link served by the desktop app (http://<pc>:47822/#/pair/<token>).
 * The page itself came from the computer, so its own origin is the peer to sync with.
 */
export function PairPage({ token }: { token: string }) {
  const [message, setMessage] = useState('Pairing with your computer…')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!TOKEN_RE.test(token) || !/^https?:$/.test(location.protocol)) {
        setFailed(true)
        return setMessage('This is not a valid pairing link.')
      }
      let info
      try {
        info = await fetchPeerInfo(location.origin, token)
      } catch (e) {
        setFailed(true)
        return setMessage(e instanceof Error ? e.message : 'Your computer did not accept this pairing link.')
      }
      if (!info) {
        setFailed(true)
        return setMessage('This page was not opened from the Mindvault desktop app. Open the pairing link on your phone, or paste it in Settings.')
      }
      await savePairing(location.origin, token, info)
      try {
        const r = await syncPeerNow()
        if (!cancelled) toast(`Paired. ${r.pushed} sent, ${r.pulled} received.`)
      } catch (e) {
        if (!cancelled) toast(e instanceof Error ? e.message : 'Paired, but the first sync failed', 'warn')
      }
      if (!cancelled) go({ name: 'library', c: 'new' })
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="page narrow">
      <div className="empty">
        <h2>{failed ? 'Could not pair' : 'Pairing'}</h2>
        <p>{message}</p>
        {failed && <a className="btn" href="#/settings">Open Settings</a>}
      </div>
    </div>
  )
}
