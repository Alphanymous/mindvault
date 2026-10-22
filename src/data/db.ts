import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { BlobRecord, Item } from '../core/types'

interface MindvaultDB extends DBSchema {
  items: { key: string; value: Item }
  blobs: { key: string; value: BlobRecord }
  meta: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<MindvaultDB>> | null = null

function db() {
  dbPromise ??= openDB<MindvaultDB>('mindvault', 1, {
    upgrade(d) {
      d.createObjectStore('items', { keyPath: 'id' })
      d.createObjectStore('blobs', { keyPath: 'id' })
      d.createObjectStore('meta')
    },
  })
  return dbPromise
}

export const itemsDb = {
  async all(): Promise<Item[]> {
    return (await db()).getAll('items')
  },
  async put(item: Item) {
    await (await db()).put('items', item)
  },
  async putMany(items: Item[]) {
    const d = await db()
    const tx = d.transaction('items', 'readwrite')
    await Promise.all([...items.map((i) => tx.store.put(i)), tx.done])
  },
  async clear() {
    const d = await db()
    await d.clear('items')
    await d.clear('blobs')
  },
}

export const blobsDb = {
  async get(id: string): Promise<BlobRecord | undefined> {
    return (await db()).get('blobs', id)
  },
  async put(rec: BlobRecord) {
    await (await db()).put('blobs', rec)
  },
  async delete(id: string) {
    await (await db()).delete('blobs', id)
  },
  async ids(): Promise<string[]> {
    return (await db()).getAllKeys('blobs')
  },
}

export const metaDb = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await (await db()).get('meta', key)) as T | undefined
  },
  async set(key: string, value: unknown) {
    await (await db()).put('meta', value, key)
  },
}
