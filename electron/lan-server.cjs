// HTTP request handler shared by the two local servers:
//  - the loopback server (127.0.0.1) that serves the UI to the Electron window and accepts web-clipper posts
//  - the optional LAN server that also lets a paired phone sync (POST /api/rpc)
// Every API call needs the pairing token. Static files are the public app bundle only.
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

// The desktop app always loads the files bundled with it. A cached PWA service worker from an older version
// would keep serving the old UI after an upgrade, so /sw.js is replaced by a script that clears caches and
// removes itself, and /registerSW.js does nothing.
const KILL_SW = [
  "self.addEventListener('install', () => self.skipWaiting())",
  "self.addEventListener('activate', (event) => event.waitUntil((async () => {",
  '  for (const key of await caches.keys()) await caches.delete(key)',
  '  await self.registration.unregister()',
  '  for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url)',
  '})()))',
].join('\n')

const CLIP_LIMIT = 12 * 1024 * 1024
const RPC_LIMIT = 110 * 1024 * 1024
const HELLO_LIMIT = 4 * 1024
const SESSION_TTL_MS = 30 * 60 * 1000
const MAX_SESSIONS = 64
const BAD_AUTH_DELAY_MS = 400

function tokenOk(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

// Signed phone sync (see src/sync/peerAuth.ts for the phone's side). The pairing code never crosses the network.
const PROTOCOL = 'mv1'
const sign = (token, ...parts) => crypto.createHmac('sha256', token).update([PROTOCOL, ...parts].join('|')).digest('hex')
const bodyHash = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

function cors(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type, x-mv-session, x-mv-seq, x-mv-sig')
  res.setHeader('access-control-expose-headers', 'x-mv-sig')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  // Chrome's Private Network Access: a public https page may call this local server only if it says so.
  res.setHeader('access-control-allow-private-network', 'true')
  res.setHeader('access-control-max-age', '600')
}

function sendJson(res, status, body, extraHeaders = {}) {
  cors(res)
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders })
  res.end(text)
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms))

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson(req, res, limit) {
  try {
    const buf = await readBody(req, limit)
    return { buf, body: JSON.parse(buf.toString('utf8')) }
  } catch (e) {
    sendJson(res, e.status === 413 ? 413 : 400, { ok: false, error: e.status === 413 ? 'too large' : 'bad json' })
    return null
  }
}

function serveStatic(distDir, req, res) {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = path.normalize(path.join(distDir, urlPath))
    // Inside the app folder only (a plain prefix check would also allow a sibling such as "dist-old").
    const root = distDir.endsWith(path.sep) ? distDir : distDir + path.sep
    if (file !== distDir && !file.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html')
    const ext = path.extname(file).toLowerCase()
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
    fs.createReadStream(file).pipe(res)
  } catch {
    res.writeHead(500).end()
  }
}

/**
 * @param {object} opts
 * @param {string} opts.distDir          built web app
 * @param {() => string} opts.getToken   current pairing token
 * @param {(msg: object) => Promise<object>} opts.dispatch   forwards a message to the renderer
 * @param {boolean} opts.allowRpc        expose signed phone sync (POST /api/hello, /api/rpc)
 * @param {string[] | null} opts.allowedHosts  accepted Host headers (guards loopback server against DNS rebinding)
 * @param {boolean} [opts.allowClip]     accept bookmarklet clips (POST /api/clip); defaults to the loopback server only
 * @param {() => string[]} [opts.getPeerUrls]  every address a phone can reach this computer at (name first)
 */
function createRequestHandler(opts) {
  const { distDir, getToken, dispatch, allowRpc, allowedHosts, getPeerUrls } = opts
  const allowClip = opts.allowClip ?? !allowRpc
  /** session id -> { seq: last sequence number used, exp } */
  const sessions = new Map()

  function newSession() {
    const now = Date.now()
    for (const [id, s] of sessions) if (s.exp < now) sessions.delete(id)
    // Hello needs no code, so cap how many sessions a stranger can open.
    while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value)
    const id = crypto.randomBytes(16).toString('hex')
    sessions.set(id, { seq: 0, exp: now + SESSION_TTL_MS })
    return id
  }

  async function handleHello(req, res) {
    const parsed = await readJson(req, res, HELLO_LIMIT)
    if (!parsed) return
    const nonce = parsed.body && parsed.body.nonce
    if (typeof nonce !== 'string' || !/^[0-9a-f]{32}$/.test(nonce)) return sendJson(res, 400, { ok: false, error: 'bad nonce' })
    const session = newSession()
    return sendJson(res, 200, { session, proof: sign(getToken(), 'host', nonce, session) })
  }

  async function handleRpc(req, res) {
    const parsed = await readJson(req, res, RPC_LIMIT)
    if (!parsed) return
    const token = getToken()
    const id = String(req.headers['x-mv-session'] ?? '')
    const seq = String(req.headers['x-mv-seq'] ?? '')
    const s = sessions.get(id)
    const seqNum = /^\d{1,12}$/.test(seq) ? Number(seq) : NaN
    const valid =
      !!s && s.exp >= Date.now() && seqNum > s.seq && sameHex(req.headers['x-mv-sig'], sign(token, 'req', id, seq, bodyHash(parsed.buf)))
    if (!valid) {
      await delay(BAD_AUTH_DELAY_MS)
      return sendJson(res, 401, { ok: false, error: 'not verified' })
    }
    s.seq = seqNum // a copied request reuses its number and is refused
    s.exp = Date.now() + SESSION_TTL_MS
    const msg = parsed.body
    // Answered here: the computer's addresses, so a verified phone can find it again after an IP change.
    const result = msg && msg.op === 'peerInfo' ? { ok: true, urls: getPeerUrls ? getPeerUrls() : [] } : await dispatch(msg)
    const text = JSON.stringify(result)
    return sendJson(res, 200, text, { 'x-mv-sig': sign(token, 'res', id, seq, bodyHash(Buffer.from(text, 'utf8'))) })
  }

  async function handleClip(req, res) {
    const parsed = await readJson(req, res, CLIP_LIMIT)
    if (!parsed) return
    const body = parsed.body
    // The bookmarklet runs on the same computer and talks to the loopback server only.
    if (!body || typeof body !== 'object' || !tokenOk(body.token, getToken())) {
      await delay(BAD_AUTH_DELAY_MS)
      return sendJson(res, 401, { ok: false, error: 'bad token' })
    }
    delete body.token
    const clip = Object.assign({}, body, { op: 'clip' })
    return sendJson(res, 200, await dispatch(clip))
  }

  return async (req, res) => {
    try {
      if (allowedHosts && !allowedHosts.includes(String(req.headers.host ?? '').toLowerCase())) {
        res.writeHead(421).end()
        return
      }
      const pathname = new URL(req.url, 'http://x').pathname

      if (req.method === 'OPTIONS') {
        cors(res)
        res.writeHead(204).end()
        return
      }
      if (req.method === 'GET' && pathname === '/api/ping') return sendJson(res, 200, { app: 'mindvault', rpc: !!allowRpc })
      if (req.method === 'POST' && allowRpc && pathname === '/api/hello') return await handleHello(req, res)
      if (req.method === 'POST' && allowRpc && pathname === '/api/rpc') return await handleRpc(req, res)
      if (req.method === 'POST' && allowClip && pathname === '/api/clip') return await handleClip(req, res)

      if (req.method === 'GET' && pathname === '/sw.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
        res.end(KILL_SW)
        return
      }
      if (req.method === 'GET' && pathname === '/registerSW.js') {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
        res.end('/* service worker is disabled in the desktop app */')
        return
      }
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(distDir, req, res)
      res.writeHead(404).end()
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : 'failed' })
    }
  }
}

// A name the network can resolve (mDNS): letters, digits and hyphens only.
const HOST_LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/

/**
 * Addresses a phone can use to reach this computer. The network name (<name>.local) comes first because it
 * survives the router handing out a new IP address; the IP addresses follow as fallbacks.
 */
function peerBases(hostname, ips, port) {
  const name = String(hostname || '').trim()
  const out = HOST_LABEL_RE.test(name) ? [`http://${name.toLowerCase()}.local:${port}`] : []
  for (const ip of ips) out.push(`http://${ip}:${port}`)
  return out
}

module.exports = { createRequestHandler, tokenOk, peerBases }
