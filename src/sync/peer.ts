import { getState, saveSettings } from '../data/store'
import { localSide } from './localSide'
import { syncWithPeer, type PeerSyncReport, type RpcMessage, type Transport } from './peerEngine'

const REQUEST_TIMEOUT_MS = 120_000

export function httpTransport(baseUrl: string, token: string): Transport {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/rpc`
  return {
    async call(msg: RpcMessage) {
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(msg),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch {
        throw new Error('Could not reach your computer. Is Mindvault open there, on the same Wi-Fi, with pairing switched on?')
      }
      if (res.status === 401) throw new Error('The pairing code was rejected. Reset it on the computer and pair again.')
      if (!res.ok) throw new Error(`Computer answered ${res.status}`)
      return (await res.json()) as Record<string, unknown>
    },
  }
}

/** Browsers refuse http requests from an https page. Explain it instead of showing a network error. */
export function mixedContentProblem(peerUrl: string, pageOrigin = location.origin): string | null {
  if (pageOrigin.startsWith('https:') && peerUrl.startsWith('http:') && !peerUrl.startsWith(pageOrigin)) {
    return 'This page is https, so the browser blocks the plain-http link to your computer. Open the pairing link in the phone browser instead, or use the Android app.'
  }
  return null
}

let running: Promise<PeerSyncReport> | null = null

/** Sync with the paired computer. Calls made while a sync is running share its result. */
export function syncPeerNow(): Promise<PeerSyncReport> {
  const { peerUrl, peerToken } = getState().settings
  if (!peerUrl || !peerToken) return Promise.reject(new Error('Pair with your computer first.'))
  const blocked = mixedContentProblem(peerUrl)
  if (blocked) return Promise.reject(new Error(blocked))
  running ??= syncWithPeer(localSide, httpTransport(peerUrl, peerToken))
    .then(async (r) => {
      await saveSettings({ lastPeerSyncAt: Date.now() })
      return r
    })
    .finally(() => {
      running = null
    })
  return running
}

/** Reachability check used before saving a pairing, so typos show up immediately. */
export async function pingPeer(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/ping`, { signal: AbortSignal.timeout(6000) })
    const json = (await res.json()) as { app?: string }
    return json.app === 'mindvault'
  } catch {
    return false
  }
}
