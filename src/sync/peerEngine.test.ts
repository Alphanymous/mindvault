import { describe, expect, it } from 'vitest'
import type { Item } from '../core/types'
import { handleRpc, syncWithPeer, type BlobPayload, type LocalSide, type Transport } from './peerEngine'

let n = 0
const mk = (title: string, updatedAt: number, over: Partial<Item> = {}): Item => ({
  id: `item${String(++n).padStart(4, '0')}`,
  type: 'note',
  title,
  content: `${title} body`,
  folder: '',
  tags: [],
  status: 'organized',
  createdAt: 1,
  updatedAt,
  ...over,
})

/** In-memory device. */
function device(initial: Item[] = [], blobs: Record<string, BlobPayload> = {}): LocalSide & { map: Map<string, Item>; blobs: Map<string, BlobPayload> } {
  const map = new Map(initial.map((i) => [i.id, i]))
  const blobMap = new Map(Object.entries(blobs))
  return {
    map,
    blobs: blobMap,
    items: () => [...map.values()],
    applyItems: async (items) => {
      for (const i of items) map.set(i.id, i)
    },
    hasBlob: async (id) => blobMap.has(id),
    blobIds: async () => [...blobMap.keys()],
    readBlob: async (id) => blobMap.get(id),
    writeBlob: async (id, p) => {
      blobMap.set(id, p)
    },
  }
}

/** Client talks to host through a JSON round trip, like the real network would. */
const link = (host: LocalSide): Transport => ({
  call: async (msg) => handleRpc(host, JSON.parse(JSON.stringify(msg))),
})

describe('peer sync protocol', () => {
  it('copies new items both ways', async () => {
    const a = mk('on phone', 10)
    const b = mk('on pc', 20)
    const phone = device([a])
    const pc = device([b])
    const report = await syncWithPeer(phone, link(pc))
    expect(report).toEqual({ pushed: 1, pulled: 1, skipped: 0 })
    expect([...phone.map.keys()].sort()).toEqual([a.id, b.id].sort())
    expect([...pc.map.keys()].sort()).toEqual([a.id, b.id].sort())
  })

  it('newer edit wins in either direction and a second sync is a no-op', async () => {
    const shared = mk('v1', 5)
    const phone = device([{ ...shared, title: 'phone edit', updatedAt: 50 }])
    const pc = device([{ ...shared, title: 'pc edit', updatedAt: 40 }])
    await syncWithPeer(phone, link(pc))
    expect(pc.map.get(shared.id)!.title).toBe('phone edit')
    expect(await syncWithPeer(phone, link(pc))).toEqual({ pushed: 0, pulled: 0, skipped: 0 })
  })

  it('propagates deletions (tombstones)', async () => {
    const it = mk('doomed', 5)
    const phone = device([{ ...it, deleted: true, content: '', updatedAt: 9 }])
    const pc = device([it])
    await syncWithPeer(phone, link(pc))
    expect(pc.map.get(it.id)!.deleted).toBe(true)
  })

  it('moves PDF originals with their item, both directions', async () => {
    const pdfOnPhone = mk('phone.pdf', 10, { type: 'pdf', blobId: 'blobphone01' })
    const pdfOnPc = mk('pc.pdf', 11, { type: 'pdf', blobId: 'blobpc00001' })
    const phone = device([pdfOnPhone], { blobphone01: { mime: 'application/pdf', b64: 'UEhPTkU=' } })
    const pc = device([pdfOnPc], { blobpc00001: { mime: 'application/pdf', b64: 'UENQREY=' } })
    await syncWithPeer(phone, link(pc))
    expect(pc.blobs.get('blobphone01')).toEqual({ mime: 'application/pdf', b64: 'UEhPTkU=' })
    expect(phone.blobs.get('blobpc00001')).toEqual({ mime: 'application/pdf', b64: 'UENQREY=' })
  })

  it('rejects malformed items sent by a peer instead of storing them', async () => {
    const pc = device()
    const bad = { ...mk('x', 1), id: '../../evil' }
    expect(await handleRpc(pc, { op: 'putItem', item: bad })).toEqual({ ok: false, error: 'invalid item' })
    expect(await handleRpc(pc, { op: 'putItem', item: { ...mk('y', 1), type: 'script' } })).toMatchObject({ ok: false })
    expect(pc.map.size).toBe(0)
  })

  it('does not overwrite a newer local copy on putItem', async () => {
    const it = mk('keep', 100)
    const pc = device([it])
    const res = await handleRpc(pc, { op: 'putItem', item: { ...it, title: 'older', updatedAt: 50 } })
    expect(res).toEqual({ ok: true, applied: false })
    expect(pc.map.get(it.id)!.title).toBe('keep')
  })

  it('answers unknown operations and garbage with errors, never throws', async () => {
    const pc = device()
    expect(await handleRpc(pc, { op: 'rm -rf' })).toEqual({ ok: false, error: 'unknown op' })
    expect(await handleRpc(pc, null)).toEqual({ ok: false, error: 'bad request' })
    expect(await handleRpc(pc, { op: 'getItem', id: '..' })).toEqual({ ok: false, error: 'bad id' })
  })

  it('skips an item the peer cannot deliver and reports it', async () => {
    const pc = device([mk('on pc', 5)])
    const flaky: Transport = {
      call: async (msg) => (msg.op === 'getItem' ? { ok: false, error: 'boom' } : handleRpc(pc, msg)),
    }
    const report = await syncWithPeer(device(), flaky)
    expect(report).toEqual({ pushed: 0, pulled: 0, skipped: 1 })
  })

  it('fails loudly when the peer is not a Mindvault host', async () => {
    await expect(syncWithPeer(device(), { call: async () => ({ ok: false, error: 'nope' }) })).rejects.toThrow('nope')
  })
})
