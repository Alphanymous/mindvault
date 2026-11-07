/**
 * Device-to-device sync over a tiny JSON RPC. The desktop app hosts it, any other Mindvault instance calls it.
 * Both sides are described by `LocalSide`, so the protocol is unit-testable without a browser or network.
 */
import type { Item } from '../core/types'
import { isValidId, isValidItem } from './pairing'
import { planSync } from './plan'

/** Blobs are sent as base64 inside JSON. Larger files are skipped rather than exhausting memory. */
export const MAX_BLOB_B64 = 80_000_000

export interface BlobPayload {
  mime: string
  b64: string
}

export interface LocalSide {
  items(): Item[]
  applyItems(items: Item[]): Promise<void>
  hasBlob(id: string): Promise<boolean>
  blobIds(): Promise<string[]>
  readBlob(id: string): Promise<BlobPayload | undefined>
  writeBlob(id: string, payload: BlobPayload): Promise<void>
}

export type RpcMessage =
  | { op: 'manifest' }
  | { op: 'getItem'; id: string }
  | { op: 'putItem'; item: Item }
  | { op: 'getBlob'; id: string }
  | { op: 'putBlob'; id: string; mime: string; b64: string }

export interface Transport {
  call(msg: RpcMessage): Promise<Record<string, unknown>>
}

const fail = (error: string) => ({ ok: false as const, error })

/** Host side: answer one request. Never throws; unknown or malformed input becomes `{ ok: false }`. */
export async function handleRpc(side: LocalSide, raw: unknown): Promise<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return fail('bad request')
  const msg = raw as Record<string, unknown>
  try {
    switch (msg.op) {
      case 'manifest': {
        const items = side.items().map((i) => ({ id: i.id, updatedAt: i.updatedAt, blobId: i.blobId }))
        return { ok: true, items, blobs: await side.blobIds() }
      }
      case 'getItem': {
        if (!isValidId(msg.id)) return fail('bad id')
        const item = side.items().find((i) => i.id === msg.id)
        return item ? { ok: true, item } : fail('not found')
      }
      case 'putItem': {
        if (!isValidItem(msg.item)) return fail('invalid item')
        const incoming = msg.item
        const local = side.items().find((i) => i.id === incoming.id)
        if (local && local.updatedAt >= incoming.updatedAt) return { ok: true, applied: false }
        await side.applyItems([incoming])
        return { ok: true, applied: true }
      }
      case 'getBlob': {
        if (!isValidId(msg.id)) return fail('bad id')
        const blob = await side.readBlob(msg.id)
        return blob ? { ok: true, ...blob } : fail('not found')
      }
      case 'putBlob': {
        if (!isValidId(msg.id) || typeof msg.mime !== 'string' || typeof msg.b64 !== 'string') return fail('bad blob')
        if (msg.b64.length > MAX_BLOB_B64) return fail('blob too large')
        await side.writeBlob(msg.id, { mime: msg.mime.slice(0, 200), b64: msg.b64 })
        return { ok: true }
      }
      default:
        return fail('unknown op')
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'failed')
  }
}

export interface PeerSyncReport {
  pushed: number
  pulled: number
  skipped: number
}

/** Client side: reconcile with a peer. Last writer wins per item, blobs travel with their item. */
export async function syncWithPeer(side: LocalSide, peer: Transport): Promise<PeerSyncReport> {
  const manifest = await peer.call({ op: 'manifest' })
  if (!manifest.ok || !Array.isArray(manifest.items)) throw new Error(String(manifest.error ?? 'Peer did not answer'))

  const remote = new Map<string, { updatedAt: number }>()
  for (const r of manifest.items as { id: unknown; updatedAt: unknown }[]) {
    if (isValidId(r.id) && typeof r.updatedAt === 'number') remote.set(r.id, { updatedAt: r.updatedAt })
  }
  const remoteBlobs = new Set<string>(Array.isArray(manifest.blobs) ? (manifest.blobs as unknown[]).filter(isValidId) : [])

  const local = side.items()
  const localMap = new Map(local.map((i) => [i.id, i]))
  const plan = planSync(localMap, remote)
  let skipped = 0

  const pulled: Item[] = []
  for (const id of plan.pull) {
    const res = await peer.call({ op: 'getItem', id })
    if (!res.ok || !isValidItem(res.item)) {
      skipped++
      continue
    }
    const item = res.item
    if (item.blobId && !item.deleted && remoteBlobs.has(item.blobId) && !(await side.hasBlob(item.blobId))) {
      const b = await peer.call({ op: 'getBlob', id: item.blobId })
      if (b.ok && typeof b.b64 === 'string' && typeof b.mime === 'string') await side.writeBlob(item.blobId, { mime: b.mime, b64: b.b64 })
      else skipped++
    }
    pulled.push(item)
  }
  await side.applyItems(pulled)

  let pushed = 0
  for (const id of plan.push) {
    const item = localMap.get(id)!
    if (item.blobId && !item.deleted && !remoteBlobs.has(item.blobId)) {
      const blob = await side.readBlob(item.blobId)
      if (blob && blob.b64.length <= MAX_BLOB_B64) {
        const r = await peer.call({ op: 'putBlob', id: item.blobId, ...blob })
        if (!r.ok) skipped++
      } else {
        skipped++
      }
    }
    const res = await peer.call({ op: 'putItem', item })
    if (res.ok) pushed++
    else skipped++
  }

  skipped += await repairBlobs(side, peer, local, remote, remoteBlobs, new Set([...plan.pull, ...plan.push]))
  return { pushed, pulled: pulled.length, skipped }
}

/**
 * Items both sides already agree on can still miss their file on one side, when an earlier sync was cut off
 * between the item and its file. Without this the gap would never close, because the item looks in sync.
 * Returns how many files could not be moved.
 */
async function repairBlobs(
  side: LocalSide,
  peer: Transport,
  local: Item[],
  remote: Map<string, unknown>,
  remoteBlobs: Set<string>,
  alreadyHandled: Set<string>,
): Promise<number> {
  const localBlobs = new Set(await side.blobIds())
  let failed = 0
  for (const item of local) {
    if (alreadyHandled.has(item.id) || item.deleted || !item.blobId || !remote.has(item.id)) continue
    const here = localBlobs.has(item.blobId)
    const there = remoteBlobs.has(item.blobId)
    if (here && !there) {
      const blob = await side.readBlob(item.blobId)
      if (!blob || blob.b64.length > MAX_BLOB_B64) failed++
      else if (!(await peer.call({ op: 'putBlob', id: item.blobId, ...blob })).ok) failed++
    } else if (!here && there) {
      const b = await peer.call({ op: 'getBlob', id: item.blobId })
      if (b.ok && typeof b.b64 === 'string' && typeof b.mime === 'string') await side.writeBlob(item.blobId, { mime: b.mime, b64: b.b64 })
      else failed++
    }
  }
  return failed
}
