import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { toast } from '../ui/toast'
import { captureFile, captureShared } from './capture'

interface SharedFile {
  name: string
  mime: string
  b64?: string
  tooLarge?: boolean
}
interface SharedPayload {
  /** Set by the widget / launcher shortcuts: capture | dictate | search | prompts */
  shortcut?: string
  text?: string
  subject?: string
  files?: SharedFile[]
}
interface ShareReceiverPlugin {
  getPending(): Promise<{ items: SharedPayload[] }>
  addListener(event: 'shareReceived', cb: () => void): Promise<PluginListenerHandle>
}

function fileFrom(f: SharedFile): File {
  const bin = atob(f.b64 ?? '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], f.name, { type: f.mime })
}

/**
 * Android share sheet: "Share → Mindvault" from Chrome, a file manager, any app.
 * The native ShareReceiver plugin (android/…/ShareReceiverPlugin.java) queues what was shared;
 * this drains the queue at start-up and whenever the app is already open and receives a new share.
 * Returns a cleanup function. Does nothing outside the native app.
 */
export function initNativeShare(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
  const plugin = registerPlugin<ShareReceiverPlugin>('ShareReceiver')
  let saved = 0

  const drain = async () => {
    let batch: SharedPayload[]
    try {
      batch = (await plugin.getPending()).items
    } catch {
      return
    }
    saved = 0
    for (const p of batch) {
      if (p.shortcut) {
        window.dispatchEvent(new CustomEvent('mv:quick', { detail: p.shortcut }))
        continue
      }
      if (p.text?.trim() || p.subject?.trim()) {
        const r = await captureShared({ text: p.text, title: p.subject })
        if (r.item) saved++
        if (r.warning) toast(r.warning, 'warn')
        if (r.error) toast(r.error, 'error')
      }
      for (const f of p.files ?? []) {
        if (f.tooLarge || !f.b64) {
          toast(`${f.name} is too large to import from the share sheet (40 MB limit).`, 'warn')
          continue
        }
        const r = await captureFile(fileFrom(f))
        if (r.item) saved++
        if (r.warning) toast(r.warning, 'warn')
        if (r.error) toast(r.error, 'error')
      }
    }
    if (saved) toast(`Saved ${saved} shared item${saved === 1 ? '' : 's'} to your inbox`, 'ok', { label: 'Review', href: '#/inbox' })
  }

  void drain()
  let handle: PluginListenerHandle | undefined
  void plugin.addListener('shareReceived', () => void drain()).then((h) => (handle = h))
  return () => void handle?.remove()
}
