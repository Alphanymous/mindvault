import { useSyncExternalStore } from 'react'
import { getState, saveSettings } from '../data/store'
import { isNativeApp } from '../import/web'
import { localSide } from './localSide'
import { peerCandidates } from './pairing'
import { syncWithPeer, type PeerSyncReport, type RpcMessage, type Transport } from './peerEngine'

const REQUEST_TIMEOUT_MS = 120_000
const PING_TIMEOUT_MS = 6000

export const UNREACHABLE_MESSAGE =
  'Can’t reach your computer. Make sure it is on, Mindvault is open there with phone pairing switched on, and both are on the same Wi-Fi. Syncing resumes by itself when it is back.'

class PeerUnreachable extends Error {
  constructor() {
    super(UNREACHABLE_MESSAGE)
  }
}

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
        throw new PeerUnreachable()
      }
      if (res.status === 401) throw new Error('Your computer rejected the pairing code. Reset it there and pair again.')
      if (!res.ok) throw new Error(`Your computer answered with error ${res.status}`)
      return (await res.json()) as Record<string, unknown>
    },
  }
}

/**
 * Browsers refuse http requests from an https page. Explain it instead of showing a network error.
 * The Android app is served from https://localhost but sends requests through native HTTP, so it is exempt.
 */
export function mixedContentProblem(peerUrl: string, pageOrigin = location.origin, native = isNativeApp()): string | null {
  if (native) return null
  if (pageOrigin.startsWith('https:') && peerUrl.startsWith('http:') && !peerUrl.startsWith(pageOrigin)) {
    return 'This page is https, so the browser blocks the plain-http link to your computer. Open the pairing link in the phone browser instead, or use the Android app.'
  }
  return null
}

export interface PeerInfo {
  /** Every address the computer can be reached at, network name first. */
  urls: string[]
}

/** Ask a computer whether it runs Mindvault. Returns null when it does not answer. */
export async function fetchPeerInfo(baseUrl: string): Promise<PeerInfo | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/ping`, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) })
    const json = (await res.json()) as { app?: string; urls?: unknown }
    if (json.app !== 'mindvault') return null
    return { urls: Array.isArray(json.urls) ? peerCandidates('', json.urls) : [] }
  } catch {
    return null
  }
}

/** Reachability check used before saving a pairing, so typos show up immediately. */
export async function pingPeer(baseUrl: string): Promise<boolean> {
  return (await fetchPeerInfo(baseUrl)) !== null
}

/** The first address that answers, in order. */
export async function firstReachable(urls: string[], ping: (url: string) => Promise<boolean> = pingPeer): Promise<string | null> {
  for (const url of urls) if (await ping(url)) return url
  return null
}

/** Save a pairing together with the computer's other addresses, so it can be found again if one changes. */
export async function savePairing(url: string, token: string, info: PeerInfo | null) {
  await saveSettings({ peerUrl: url, peerToken: token, peerAltUrls: peerCandidates(url, info?.urls ?? []).filter((u) => u !== url) })
}

// ---- sync status, shown in Settings ----

export type PeerStatus =
  | { state: 'idle' }
  | { state: 'syncing' }
  | { state: 'ok'; at: number; report: PeerSyncReport }
  | { state: 'error'; at: number; message: string; unreachable: boolean }

let status: PeerStatus = { state: 'idle' }
const statusListeners = new Set<() => void>()
function setStatus(next: PeerStatus) {
  status = next
  statusListeners.forEach((l) => l())
}
export function usePeerStatus(): PeerStatus {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l)
      return () => statusListeners.delete(l)
    },
    () => status,
  )
}

// ---- sync ----

let running: Promise<PeerSyncReport> | null = null

/** Sync with the paired computer. Calls made while a sync is running share its result. */
export function syncPeerNow(): Promise<PeerSyncReport> {
  running ??= runPeerSync()
    .then((r) => {
      setStatus({ state: 'ok', at: Date.now(), report: r })
      return r
    })
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : 'Sync failed'
      setStatus({ state: 'error', at: Date.now(), message, unreachable: e instanceof PeerUnreachable })
      throw e
    })
    .finally(() => {
      running = null
    })
  return running
}

async function runPeerSync(): Promise<PeerSyncReport> {
  const { peerUrl, peerToken, peerAltUrls } = getState().settings
  if (!peerUrl || !peerToken) throw new Error('Pair with your computer first.')
  const blocked = mixedContentProblem(peerUrl)
  if (blocked) throw new Error(blocked)
  setStatus({ state: 'syncing' })
  try {
    return await syncAt(peerUrl, peerToken)
  } catch (e) {
    if (!(e instanceof PeerUnreachable)) throw e
    // The saved address stopped answering (for example the router gave the computer a new IP): try the others.
    const others = peerCandidates('', peerAltUrls ?? []).filter((u) => u !== peerUrl && !mixedContentProblem(u))
    const found = await firstReachable(others)
    if (!found) throw e
    const report = await syncAt(found, peerToken)
    await saveSettings({ peerUrl: found })
    return report
  }
}

async function syncAt(baseUrl: string, token: string): Promise<PeerSyncReport> {
  const report = await syncWithPeer(localSide, httpTransport(baseUrl, token))
  // Refresh the computer's address list while connected, so the next fallback has current addresses.
  const info = await fetchPeerInfo(baseUrl)
  const alts = info ? peerCandidates(baseUrl, info.urls).filter((u) => u !== baseUrl) : getState().settings.peerAltUrls
  await saveSettings({ lastPeerSyncAt: Date.now(), peerAltUrls: alts })
  return report
}
