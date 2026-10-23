import { createRequire } from 'node:module'
import { mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Item } from '../core/types'
import { syncWithPeer, type BlobPayload, type LocalSide, type Transport } from './peerEngine'

const require = createRequire(import.meta.url)
const { createFolderRpc, detectCloudFolders } = require('../../electron/folder-sync.cjs') as {
  createFolderRpc(root: string): (msg: unknown) => Promise<Record<string, unknown>>
  detectCloudFolders(env: Record<string, string | undefined>, home: string, exists: (p: string) => boolean): { label: string; path: string }[]
}

const dirs: string[] = []
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mv-folder-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

let n = 0
const mk = (title: string, updatedAt: number, over: Partial<Item> = {}): Item => ({
  id: `fld${String(++n).padStart(5, '0')}`, type: 'note', title, content: `${title} body`, folder: '', tags: [], status: 'organized', createdAt: 1, updatedAt, ...over,
})

function device(initial: Item[] = [], blobs: Record<string, BlobPayload> = {}) {
  const map = new Map(initial.map((i) => [i.id, i]))
  const blobMap = new Map(Object.entries(blobs))
  const side: LocalSide = {
    items: () => [...map.values()],
    applyItems: async (items) => items.forEach((i) => map.set(i.id, i)),
    hasBlob: async (id) => blobMap.has(id),
    blobIds: async () => [...blobMap.keys()],
    readBlob: async (id) => blobMap.get(id),
    writeBlob: async (id, p) => void blobMap.set(id, p),
  }
  return { side, map, blobs: blobMap }
}
const viaFolder = (root: string): Transport => {
  const rpc = createFolderRpc(root)
  return { call: async (msg) => rpc(JSON.parse(JSON.stringify(msg))) }
}

describe('folder sync (what Google Drive / OneDrive / Dropbox clients would carry)', () => {
  it('two computers converge through one shared folder', async () => {
    const shared = tmp()
    const a = device([mk('from A', 10)])
    const b = device([mk('from B', 20)])
    await syncWithPeer(a.side, viaFolder(shared)) // A uploads
    await syncWithPeer(b.side, viaFolder(shared)) // B uploads and downloads A's
    await syncWithPeer(a.side, viaFolder(shared)) // A downloads B's
    expect([...a.map.values()].map((i) => i.title).sort()).toEqual(['from A', 'from B'])
    expect([...b.map.values()].map((i) => i.title).sort()).toEqual(['from A', 'from B'])
    expect(await syncWithPeer(a.side, viaFolder(shared))).toEqual({ pushed: 0, pulled: 0, skipped: 0 })
  })

  it('stores one file per note, replaces old versions, and keeps the newest edit', async () => {
    const shared = tmp()
    const first = mk('v1', 5)
    const a = device([first])
    await syncWithPeer(a.side, viaFolder(shared))
    a.map.set(first.id, { ...first, title: 'v2', updatedAt: 50 })
    await syncWithPeer(a.side, viaFolder(shared))
    const files = readdirSync(join(shared, 'Mindvault', 'items'))
    expect(files).toEqual([`${first.id}@50.json`])
    const b = device()
    await syncWithPeer(b.side, viaFolder(shared))
    expect(b.map.get(first.id)!.title).toBe('v2')
  })

  it('carries PDF originals and deletions', async () => {
    const shared = tmp()
    const pdf = mk('doc.pdf', 5, { type: 'pdf', blobId: 'blobabc123', mime: 'application/pdf' })
    const a = device([pdf], { blobabc123: { mime: 'application/pdf', b64: Buffer.from('%PDF-fake').toString('base64') } })
    await syncWithPeer(a.side, viaFolder(shared))
    const b = device()
    await syncWithPeer(b.side, viaFolder(shared))
    expect(b.blobs.get('blobabc123')).toEqual({ mime: 'application/pdf', b64: Buffer.from('%PDF-fake').toString('base64') })
    a.map.set(pdf.id, { ...pdf, deleted: true, content: '', blobId: undefined, updatedAt: 99 })
    await syncWithPeer(a.side, viaFolder(shared))
    await syncWithPeer(b.side, viaFolder(shared))
    expect(b.map.get(pdf.id)!.deleted).toBe(true)
  })

  it('ignores cloud-client leftovers and files it did not write', async () => {
    const shared = tmp()
    const a = device([mk('real', 5)])
    await syncWithPeer(a.side, viaFolder(shared))
    const items = join(shared, 'Mindvault', 'items')
    writeFileSync(join(items, 'notes (conflicted copy).json'), '{}')
    writeFileSync(join(items, 'desktop.ini'), '')
    writeFileSync(join(items, '..evil@1.json'), '{}')
    const b = device()
    expect(await syncWithPeer(b.side, viaFolder(shared))).toMatchObject({ pulled: 1, skipped: 0 })
  })

  it('refuses ids that could escape the folder and rejects tampered items on pull', async () => {
    const shared = tmp()
    const rpc = createFolderRpc(shared)
    expect(await rpc({ op: 'getItem', id: '../../secret' })).toEqual({ ok: false, error: 'bad id' })
    expect(await rpc({ op: 'getBlob', id: '..\\x' })).toEqual({ ok: false, error: 'bad id' })
    expect(await rpc({ op: 'putItem', item: { id: '../x', updatedAt: 1 } })).toEqual({ ok: false, error: 'invalid item' })
    expect(existsSync(join(shared, 'secret'))).toBe(false)
    // a hostile file dropped into the shared folder is skipped, not applied
    await rpc({ op: 'manifest' })
    writeFileSync(join(shared, 'Mindvault', 'items', 'hacked001@9.json'), JSON.stringify({ id: 'hacked001', type: 'exe', title: 1 }))
    const b = device()
    expect(await syncWithPeer(b.side, viaFolder(shared))).toMatchObject({ pulled: 0, skipped: 1 })
    expect(b.map.size).toBe(0)
  })

  it('detects cloud folders that exist on this PC', () => {
    const present = new Set(['C:\\Users\\me\\OneDrive', 'C:\\Users\\me\\Nextcloud', 'G:\\My Drive'])
    const found = detectCloudFolders({ OneDrive: 'C:\\Users\\me\\OneDrive' }, 'C:\\Users\\me', (p) => present.has(p))
    expect(found.map((f) => f.label)).toEqual(['Google Drive', 'OneDrive', 'Nextcloud'])
    expect(found.filter((f) => f.label === 'OneDrive')).toHaveLength(1)
  })
})
