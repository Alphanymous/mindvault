import { captureClip } from '../import/capture'
import { toast } from '../ui/toast'
import { localSide } from './localSide'
import { handleRpc } from './peerEngine'
import { parseClip } from './pairing'

/**
 * Desktop app only: the Electron main process forwards authenticated requests from the phone
 * (sync) and from the browser bookmarklet (clip) to the renderer, which owns the data.
 */
export function registerPeerHost() {
  window.mindvault?.onRpc?.(async (msg) => {
    const m = msg as { op?: string } | null
    if (m?.op === 'clip') {
      const clip = parseClip(m)
      if (!clip) return { ok: false, error: 'Nothing readable to save' }
      const r = await captureClip(clip)
      if (!r.item) return { ok: false, error: r.error ?? 'Could not save' }
      toast(`Clipped “${r.item.title}”`, 'ok', { label: 'Review', href: '#/inbox' })
      return { ok: true, title: r.item.title }
    }
    return handleRpc(localSide, msg)
  })
}
