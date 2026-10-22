const { app, BrowserWindow, ipcMain, net, shell, Menu } = require('electron')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')

// The renderer is served from http://localhost:<port> instead of file:// so that
// Google Sign-In (which needs a registered http origin) and the service worker work.
// Register this exact origin in your Google OAuth client: http://localhost:47821
const PREFERRED_PORT = 47821
const DIST = path.join(__dirname, '..', 'dist')

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

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      let file = path.normalize(path.join(DIST, urlPath))
      if (!file.startsWith(DIST)) {
        res.writeHead(403).end()
        return
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
      const ext = path.extname(file).toLowerCase()
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
      fs.createReadStream(file).pipe(res)
    } catch {
      res.writeHead(500).end()
    }
  })
  return new Promise((resolve, reject) => {
    const listen = (port) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port === PREFERRED_PORT) listen(0)
        else reject(err)
      })
      server.listen(port, '127.0.0.1', () => resolve(server.address().port))
    }
    listen(PREFERRED_PORT)
  })
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#0e0f13',
    title: 'Mindvault',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      return { action: 'deny' }
    }
    // Google sign-in popup stays inside the app; everything else opens in the default browser.
    if (host === 'accounts.google.com') {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, autoHideMenuBar: true, parent: win, modal: false } }
    }
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://localhost:${port}`)) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
  win.loadURL(`http://localhost:${port}/`)
}

// Web clipping must never reach the user's own machine or LAN (SSRF guard for the CORS-free fetch).
function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return h.includes(':')
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

ipcMain.handle('mv:fetch-text', async (_e, url) => {
  const u = new URL(String(url))
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) links can be clipped.')
  if (isPrivateHost(u.hostname)) throw new Error('Local and private network addresses cannot be clipped.')
  const res = await net.fetch(u.toString(), {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; Mindvault/0.1)', accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Server answered ${res.status}`)
  return await res.text()
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    const port = await startServer()
    createWindow(port)
  })
  app.on('window-all-closed', () => app.quit())
}
