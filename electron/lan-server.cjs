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

const CLIP_LIMIT = 12 * 1024 * 1024
const RPC_LIMIT = 110 * 1024 * 1024

function tokenOk(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

function cors(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'authorization, content-type')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  // Chrome's Private Network Access: a public https page may call this local server only if it says so.
  res.setHeader('access-control-allow-private-network', 'true')
  res.setHeader('access-control-max-age', '600')
}

function sendJson(res, status, body) {
  cors(res)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function serveStatic(distDir, req, res) {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = path.normalize(path.join(distDir, urlPath))
    if (!file.startsWith(distDir)) {
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
 * @param {boolean} opts.allowRpc        expose POST /api/rpc (phone sync)
 * @param {string[] | null} opts.allowedHosts  accepted Host headers (guards loopback server against DNS rebinding)
 */
function createRequestHandler(opts) {
  const { distDir, getToken, dispatch, allowRpc, allowedHosts } = opts
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

      if (req.method === 'POST' && (pathname === '/api/clip' || (allowRpc && pathname === '/api/rpc'))) {
        const isClip = pathname === '/api/clip'
        let body
        try {
          body = JSON.parse(await readBody(req, isClip ? CLIP_LIMIT : RPC_LIMIT))
        } catch (e) {
          return sendJson(res, e.status === 413 ? 413 : 400, { ok: false, error: e.status === 413 ? 'too large' : 'bad json' })
        }
        const header = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''))
        const provided = header ? header[1] : body && typeof body === 'object' ? body.token : undefined
        if (!tokenOk(provided, getToken())) {
          await new Promise((r) => setTimeout(r, 400))
          return sendJson(res, 401, { ok: false, error: 'bad token' })
        }
        if (body && typeof body === 'object') delete body.token
        const msg = isClip ? { ...body, op: 'clip' } : body
        const result = await dispatch(msg)
        return sendJson(res, 200, result)
      }

      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(distDir, req, res)
      res.writeHead(404).end()
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : 'failed' })
    }
  }
}

module.exports = { createRequestHandler, tokenOk }
