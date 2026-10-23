import { blobsDb } from '../data/db'
import { getState, replaceItemsFromSync } from '../data/store'
import type { BlobPayload, LocalSide } from './peerEngine'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '')
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** The real store, exposed through the same interface the protocol tests use. */
export const localSide: LocalSide = {
  items: () => getState().items,
  applyItems: (items) => replaceItemsFromSync(items),
  hasBlob: async (id) => !!(await blobsDb.get(id)),
  blobIds: () => blobsDb.ids(),
  async readBlob(id): Promise<BlobPayload | undefined> {
    const rec = await blobsDb.get(id)
    return rec ? { mime: rec.mime, b64: await blobToBase64(rec.data) } : undefined
  },
  async writeBlob(id, payload) {
    await blobsDb.put({ id, mime: payload.mime, data: base64ToBlob(payload.b64, payload.mime), updatedAt: Date.now() })
  },
}
