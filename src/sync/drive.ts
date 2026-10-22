import type { BlobRecord, Item } from '../core/types'
import { blobsDb } from '../data/db'
import { getState, replaceItemsFromSync, saveSettings } from '../data/store'
import { getAccessToken, signOut } from './google'
import { planSync } from './plan'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

interface RemoteFile {
  id: string
  name: string
  appProperties?: { updatedAt?: string; mime?: string }
}

export interface SyncReport {
  pushed: number
  pulled: number
  at: number
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } })
  if (res.status === 401) {
    await signOut()
    throw new Error('Google session expired. Sign in again.')
  }
  if (!res.ok) throw new Error(`Google Drive error ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res
}

async function listRemote(token: string): Promise<RemoteFile[]> {
  const files: RemoteFile[] = []
  let pageToken = ''
  do {
    const qs = new URLSearchParams({
      spaces: 'appDataFolder',
      pageSize: '1000',
      fields: 'nextPageToken,files(id,name,appProperties)',
    })
    if (pageToken) qs.set('pageToken', pageToken)
    const json = await (await call(token, `${API}/files?${qs}`)).json()
    files.push(...(json.files ?? []))
    pageToken = json.nextPageToken ?? ''
  } while (pageToken)
  return files
}

async function upload(token: string, existingId: string | undefined, name: string, body: Blob, props: Record<string, string>) {
  const boundary = `mv${Math.random().toString(36).slice(2)}`
  const metadata = existingId ? { appProperties: props } : { name, parents: ['appDataFolder'], appProperties: props }
  const payload = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${body.type || 'application/octet-stream'}\r\n\r\n`,
    body,
    `\r\n--${boundary}--`,
  ])
  const url = existingId
    ? `${UPLOAD}/files/${existingId}?uploadType=multipart`
    : `${UPLOAD}/files?uploadType=multipart`
  await call(token, url, {
    method: existingId ? 'PATCH' : 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body: payload,
  })
}

const itemName = (id: string) => `item-${id}.json`
const blobName = (id: string) => `blob-${id}`

export async function syncNow(interactive: boolean): Promise<SyncReport> {
  const { settings } = getState()
  const token = await getAccessToken(settings.googleClientId, interactive)
  const remoteFiles = await listRemote(token)
  const byName = new Map(remoteFiles.map((f) => [f.name, f]))

  const remoteItems = new Map<string, { updatedAt: number; file: RemoteFile }>()
  for (const f of remoteFiles) {
    const m = /^item-(.+)\.json$/.exec(f.name)
    if (m) remoteItems.set(m[1], { updatedAt: Number(f.appProperties?.updatedAt ?? 0), file: f })
  }
  const local = getState().items
  const localMap = new Map(local.map((i) => [i.id, i]))
  const plan = planSync(localMap, remoteItems)

  // pull
  const pulled: Item[] = []
  for (const id of plan.pull) {
    const f = remoteItems.get(id)!.file
    const item = (await (await call(token, `${API}/files/${f.id}?alt=media`)).json()) as Item
    pulled.push(item)
    const bf = item.blobId ? byName.get(blobName(item.blobId)) : undefined
    if (bf && item.blobId && !(await blobsDb.get(item.blobId))) {
      const data = await (await call(token, `${API}/files/${bf.id}?alt=media`)).blob()
      const rec: BlobRecord = { id: item.blobId, mime: bf.appProperties?.mime ?? data.type, data, updatedAt: item.updatedAt }
      await blobsDb.put(rec)
    }
  }
  await replaceItemsFromSync(pulled)

  // push
  for (const id of plan.push) {
    const item = localMap.get(id)!
    const existing = remoteItems.get(id)?.file
    const json = new Blob([JSON.stringify(item)], { type: 'application/json' })
    await upload(token, existing?.id, itemName(id), json, { updatedAt: String(item.updatedAt) })
    if (item.blobId && !byName.has(blobName(item.blobId))) {
      const rec = await blobsDb.get(item.blobId)
      if (rec) await upload(token, undefined, blobName(item.blobId), rec.data, { updatedAt: String(item.updatedAt), mime: rec.mime })
    }
    if (item.deleted) {
      const bf = byName.get(blobName(id))
      if (bf) await call(token, `${API}/files/${bf.id}`, { method: 'DELETE' })
    }
  }
  // Blobs that exist locally for unchanged items but are missing remotely (e.g. first sync after an interrupted one).
  for (const item of local) {
    if (item.deleted || !item.blobId || plan.push.includes(item.id) || byName.has(blobName(item.blobId))) continue
    const rec = await blobsDb.get(item.blobId)
    if (rec) await upload(token, undefined, blobName(item.blobId), rec.data, { updatedAt: String(item.updatedAt), mime: rec.mime })
  }

  const report = { pushed: plan.push.length, pulled: pulled.length, at: Date.now() }
  await saveSettings({ lastSyncAt: report.at })
  return report
}
