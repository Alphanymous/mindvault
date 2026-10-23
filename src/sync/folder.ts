import { useCallback, useEffect, useState } from 'react'
import { subscribe } from '../data/store'
import type { FolderInfo } from '../import/web'
import { localSide } from './localSide'
import { syncWithPeer, type PeerSyncReport, type RpcMessage, type Transport } from './peerEngine'

export const folderApi = () => window.mindvault?.folder

/** The same sync engine as phone pairing, but the "peer" is a folder on disk. */
export function folderTransport(): Transport {
  return {
    async call(msg: RpcMessage) {
      const api = folderApi()
      if (!api) throw new Error('Folder sync is available in the desktop app.')
      return api.rpc(msg)
    },
  }
}

const LAST_KEY = 'mv.folder.lastSync'
export function lastFolderSync(): number | null {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || null
  } catch {
    return null
  }
}

let running: Promise<PeerSyncReport> | null = null

export function syncFolderNow(): Promise<PeerSyncReport> {
  running ??= syncWithPeer(localSide, folderTransport())
    .then((r) => {
      // Kept outside the main store on purpose: saving settings would count as a change and trigger another sync.
      try {
        localStorage.setItem(LAST_KEY, String(Date.now()))
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event('mv:folder-synced'))
      return r
    })
    .finally(() => {
      running = null
    })
  return running
}

export function useFolderInfo() {
  const [info, setInfo] = useState<FolderInfo | null>(null)
  const refresh = useCallback(() => {
    void folderApi()?.get().then(setInfo)
  }, [])
  useEffect(() => {
    refresh()
    window.addEventListener('mv:folder-changed', refresh)
    window.addEventListener('mv:folder-synced', refresh)
    return () => {
      window.removeEventListener('mv:folder-changed', refresh)
      window.removeEventListener('mv:folder-synced', refresh)
    }
  }, [refresh])
  return { info, refresh }
}

const POLL_MS = 20_000
const CHANGE_DEBOUNCE_MS = 4_000

/**
 * While a folder is chosen: sync on start, every 20 s (to pick up what the cloud client delivered),
 * a few seconds after you edit something, and when the window regains focus.
 */
export function startFolderAutoSync(): () => void {
  const api = folderApi()
  if (!api) return () => {}
  let active = false
  let stopped = false
  let debounce = 0
  const tick = async () => {
    if (stopped || !active || document.visibilityState === 'hidden') return
    try {
      await syncFolderNow()
    } catch {
      /* the Sync settings page shows errors when you sync by hand */
    }
  }
  const refreshActive = async () => {
    active = !!(await api.get())?.path
    if (active) void tick()
  }
  void refreshActive()
  const poll = window.setInterval(() => void tick(), POLL_MS)
  const onFocus = () => void tick()
  const onChanged = () => void refreshActive()
  const unsub = subscribe(() => {
    window.clearTimeout(debounce)
    debounce = window.setTimeout(() => void tick(), CHANGE_DEBOUNCE_MS)
  })
  window.addEventListener('focus', onFocus)
  window.addEventListener('mv:folder-changed', onChanged)
  return () => {
    stopped = true
    window.clearInterval(poll)
    window.clearTimeout(debounce)
    unsub()
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('mv:folder-changed', onChanged)
  }
}
