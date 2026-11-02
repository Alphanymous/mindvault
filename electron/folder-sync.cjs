// Folder sync: Mindvault reads and writes plain files in a folder that Google Drive, OneDrive, Dropbox,
// Nextcloud, Syncthing, etc. already keep in sync between devices. No accounts or API keys inside Mindvault.
//
// Layout:  <folder>/Mindvault/items/<id>@<updatedAt>.json     one file per note (newest version wins)
//          <folder>/Mindvault/blobs/<id>  + <id>.mime          original PDFs / files
//
// The request shape is the same JSON protocol used for phone pairing, so one sync engine serves both.
const fs = require('node:fs/promises')
const fssync = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/
const ITEM_FILE_RE = /^([A-Za-z0-9_-]{6,64})@(\d{1,16})\.json$/
const MAX_ITEM_BYTES = 12 * 1024 * 1024
const MAX_BLOB_BYTES = 120 * 1024 * 1024

const fail = (error) => ({ ok: false, error })

async function ensureDirs(root) {
  const base = path.join(root, 'Mindvault')
  const items = path.join(base, 'items')
  const blobs = path.join(base, 'blobs')
  await fs.mkdir(items, { recursive: true })
  await fs.mkdir(blobs, { recursive: true })
  return { base, items, blobs }
}

/** id -> sorted versions (highest updatedAt first) */
async function listItems(itemsDir) {
  const byId = new Map()
  for (const name of await fs.readdir(itemsDir)) {
    const m = ITEM_FILE_RE.exec(name)
    if (!m) continue // ignore sync-conflict copies, temp files, anything we did not write
    const list = byId.get(m[1]) ?? []
    list.push({ ts: Number(m[2]), name })
    byId.set(m[1], list)
  }
  for (const list of byId.values()) list.sort((a, b) => b.ts - a.ts)
  return byId
}

async function removeQuietly(file) {
  try {
    await fs.unlink(file)
  } catch {
    /* already gone, or locked by the sync client; retried next time */
  }
}

/** Returns an async handler for protocol messages bound to one folder. */
function createFolderRpc(rootDir) {
  return async function handle(msg) {
    if (!msg || typeof msg !== 'object') return fail('bad request')
    try {
      const { items: itemsDir, blobs: blobsDir } = await ensureDirs(rootDir)
      switch (msg.op) {
        case 'manifest': {
          const byId = await listItems(itemsDir)
          const items = [...byId.entries()].map(([id, versions]) => ({ id, updatedAt: versions[0].ts }))
          const blobs = (await fs.readdir(blobsDir)).filter((n) => ID_RE.test(n))
          return { ok: true, items, blobs }
        }
        case 'getItem': {
          if (!ID_RE.test(msg.id)) return fail('bad id')
          const versions = (await listItems(itemsDir)).get(msg.id)
          if (!versions) return fail('not found')
          const file = path.join(itemsDir, versions[0].name)
          if ((await fs.stat(file)).size > MAX_ITEM_BYTES) return fail('item too large')
          return { ok: true, item: JSON.parse(await fs.readFile(file, 'utf8')) }
        }
        case 'putItem': {
          const item = msg.item
          if (!item || !ID_RE.test(item.id) || !Number.isFinite(item.updatedAt)) return fail('invalid item')
          const ts = Math.trunc(item.updatedAt)
          const existing = (await listItems(itemsDir)).get(item.id) ?? []
          if (existing[0] && existing[0].ts >= ts) return { ok: true, applied: false }
          const json = JSON.stringify(item)
          if (Buffer.byteLength(json) > MAX_ITEM_BYTES) return fail('item too large')
          const finalName = `${item.id}@${ts}.json`
          const tmp = path.join(itemsDir, `.${finalName}.tmp`)
          await fs.writeFile(tmp, json, 'utf8')
          await fs.rename(tmp, path.join(itemsDir, finalName))
          for (const old of existing) await removeQuietly(path.join(itemsDir, old.name))
          return { ok: true, applied: true }
        }
        case 'getBlob': {
          if (!ID_RE.test(msg.id)) return fail('bad id')
          const file = path.join(blobsDir, msg.id)
          if (!fssync.existsSync(file)) return fail('not found')
          if ((await fs.stat(file)).size > MAX_BLOB_BYTES) return fail('file too large')
          let mime = 'application/octet-stream'
          try {
            mime = (await fs.readFile(file + '.mime', 'utf8')).trim() || mime
          } catch {
            /* no sidecar */
          }
          return { ok: true, mime, b64: (await fs.readFile(file)).toString('base64') }
        }
        case 'putBlob': {
          if (!ID_RE.test(msg.id) || typeof msg.b64 !== 'string' || typeof msg.mime !== 'string') return fail('bad blob')
          const data = Buffer.from(msg.b64, 'base64')
          if (data.length > MAX_BLOB_BYTES) return fail('file too large')
          const file = path.join(blobsDir, msg.id)
          await fs.writeFile(file + '.tmp', data)
          await fs.rename(file + '.tmp', file)
          await fs.writeFile(file + '.mime', msg.mime.slice(0, 200), 'utf8')
          return { ok: true }
        }
        default:
          return fail('unknown op')
      }
    } catch (e) {
      return fail(e && e.message ? String(e.message) : 'folder error')
    }
  }
}

function joinFolderPath(base, ...parts) {
  const windowsLike = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(base) || parts.some((p) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(p)) || base.includes('\\')
  return windowsLike ? path.win32.join(base, ...parts) : path.join(base, ...parts)
}

/** Cloud-synced folders that exist on this PC, so the user can pick with one click. */
function detectCloudFolders(env = process.env, home = os.homedir(), exists = (p) => fssync.existsSync(p)) {
  const found = []
  const add = (label, p) => {
    if (p && exists(p) && !found.some((f) => f.path.toLowerCase() === p.toLowerCase())) found.push({ label, path: p })
  }
  add('Google Drive', joinFolderPath(home, 'Google Drive'))
  add('Google Drive', joinFolderPath(home, 'My Drive'))
  for (const letter of 'GHIJKLMNOPQRSTUVWXYZ') {
    add('Google Drive', `${letter}:\\My Drive`)
  }
  add('OneDrive', env.OneDrive)
  add('OneDrive', env.OneDriveConsumer)
  add('OneDrive', joinFolderPath(home, 'OneDrive'))
  add('Dropbox', joinFolderPath(home, 'Dropbox'))
  add('Nextcloud', joinFolderPath(home, 'Nextcloud'))
  add('iCloud Drive', joinFolderPath(home, 'iCloudDrive'))
  return found
}

module.exports = { createFolderRpc, detectCloudFolders, ID_RE, ITEM_FILE_RE }
