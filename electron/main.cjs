const { app, BrowserWindow, dialog, ipcMain, net, shell, Menu } = require('electron')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const { createRequestHandler } = require('./lan-server.cjs')
const { createFolderRpc, detectCloudFolders } = require('./folder-sync.cjs')

// The renderer is served from http://localhost:<port> instead of file:// so that
// Google Sign-In (which needs a registered http origin) and the service worker work.
// Register this exact origin in your Google OAuth client: http://localhost:47821
const PREFERRED_PORT = 47821
// Optional LAN server for phone pairing (off until switched on in Settings).
const LAN_PORT = 47822
const DIST = path.join(__dirname, '..', 'dist')

let mainWindow = null
let loopbackPort = PREFERRED_PORT
let lanServer = null
let lanPort = LAN_PORT

// ---- pairing config: { enabled, token } stored next to the app data ----
const configFile = () => path.join(app.getPath('userData'), 'pairing.json')
const newToken = () => crypto.randomBytes(16).toString('base64url')
let config = { enabled: false, token: '', syncFolder: '' }

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf8'))
    if (typeof raw.token === 'string' && raw.token.length >= 16) config = { enabled: !!raw.enabled, token: raw.token, syncFolder: typeof raw.syncFolder === 'string' ? raw.syncFolder : '' }
  } catch {
    /* first run */
  }
  if (!config.token) {
    config.token = newToken()
    saveConfig()
  }
}
function saveConfig() {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify(config), { mode: 0o600 })
}

function lanAddresses() {
  const out = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')) out.push(i.address)
    }
  }
  const rank = (a) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : 2)
  return out.sort((a, b) => rank(a) - rank(b))
}

function pairInfo() {
  const links = config.enabled && lanServer ? lanAddresses().map((ip) => `http://${ip}:${lanPort}/#/pair/${config.token}`) : []
  return { enabled: config.enabled && !!lanServer, token: config.token, links, clipUrl: `http://localhost:${loopbackPort}/api/clip` }
}

// ---- bridge: HTTP request -> renderer (which owns the data) -> HTTP response ----
const pending = new Map()
let nextRpc = 1
function dispatchToRenderer(msg) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) return resolve({ ok: false, error: 'Mindvault window is not ready' })
    const id = nextRpc++
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ ok: false, error: 'Mindvault did not answer in time' })
    }, 120000)
    pending.set(id, { resolve, timer })
    mainWindow.webContents.send('mv:rpc', { id, msg })
  })
}
ipcMain.handle('mv:rpc-reply', (event, id, result) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return
  const p = pending.get(id)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(id)
  p.resolve(result ?? { ok: false, error: 'empty answer' })
})

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const attempt = (p) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && p !== 0) attempt(0)
        else reject(err)
      }
      server.once('error', onError)
      server.listen(p, host, () => {
        server.removeListener('error', onError)
        resolve(server.address().port)
      })
    }
    attempt(port)
  })
}

async function startLoopbackServer() {
  const server = http.createServer()
  loopbackPort = await listen(server, PREFERRED_PORT, '127.0.0.1')
  server.on(
    'request',
    createRequestHandler({
      distDir: DIST,
      getToken: () => config.token,
      dispatch: dispatchToRenderer,
      allowRpc: false,
      // Reject requests whose Host header is not us (DNS-rebinding guard).
      allowedHosts: [`localhost:${loopbackPort}`, `127.0.0.1:${loopbackPort}`],
    }),
  )
}

async function startLanServer() {
  if (lanServer) return
  const server = http.createServer()
  lanPort = await listen(server, LAN_PORT, '0.0.0.0')
  server.on(
    'request',
    createRequestHandler({ distDir: DIST, getToken: () => config.token, dispatch: dispatchToRenderer, allowRpc: true, allowedHosts: null }),
  )
  lanServer = server
}

function stopLanServer() {
  if (!lanServer) return
  lanServer.close()
  lanServer.closeAllConnections?.()
  lanServer = null
}

const fromMainWindow = (event) => mainWindow && event.sender === mainWindow.webContents
ipcMain.handle('mv:pair:get', (event) => (fromMainWindow(event) ? pairInfo() : null))
ipcMain.handle('mv:pair:set', async (event, enabled) => {
  if (!fromMainWindow(event)) return null
  config.enabled = !!enabled
  saveConfig()
  if (config.enabled) await startLanServer()
  else stopLanServer()
  return pairInfo()
})
// ---- folder sync: a folder kept in sync by Google Drive / OneDrive / Dropbox / Nextcloud ----
const folderInfo = () => ({ path: config.syncFolder || null, candidates: detectCloudFolders() })
const isDirectory = (p) => {
  try {
    return typeof p === 'string' && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}
ipcMain.handle('mv:folder:get', (event) => (fromMainWindow(event) ? folderInfo() : null))
ipcMain.handle('mv:folder:choose', async (event) => {
  if (!fromMainWindow(event)) return null
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder that your devices share',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (!res.canceled && res.filePaths[0] && isDirectory(res.filePaths[0])) {
    config.syncFolder = res.filePaths[0]
    saveConfig()
  }
  return folderInfo()
})
ipcMain.handle('mv:folder:use', (event, p) => {
  if (!fromMainWindow(event)) return null
  if (isDirectory(p)) {
    config.syncFolder = p
    saveConfig()
  }
  return folderInfo()
})
ipcMain.handle('mv:folder:clear', (event) => {
  if (!fromMainWindow(event)) return null
  config.syncFolder = ''
  saveConfig()
  return folderInfo()
})
ipcMain.handle('mv:folder:rpc', async (event, msg) => {
  if (!fromMainWindow(event)) return { ok: false, error: 'not allowed' }
  if (!config.syncFolder || !isDirectory(config.syncFolder)) return { ok: false, error: 'The sync folder is not available. Is it connected?' }
  return createFolderRpc(config.syncFolder)(msg)
})

ipcMain.handle('mv:pair:reset', (event) => {
  if (!fromMainWindow(event)) return null
  config.token = newToken()
  saveConfig()
  return pairInfo()
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#060a12',
    title: 'Mindvault',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win

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
    if (!url.startsWith(`http://localhost:${loopbackPort}`)) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })
  win.loadURL(`http://localhost:${loopbackPort}/`)
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
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`Server answered ${res.status}`)
  return await res.text()
})

ipcMain.handle('mv:capture-screenshot', async () => {
  if (!mainWindow) throw new Error('Window not available')
  
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
  
  if (sources.length === 0) {
    throw new Error('No screenshot sources available')
  }
  
  const source = sources[0]
  const image = source.thumbnail
  
  if (!image) {
    throw new Error('Could not capture screenshot')
  }
  
  const buffer = image.toPNG()
  const blob = new Blob([buffer], { type: 'image/png' })
  
  return {
    blob: blob,
    name: `screenshot-${Date.now()}.png`,
    mime: 'image/png',
    size: buffer.length
  }
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    loadConfig()
    await startLoopbackServer()
    if (config.enabled) {
      try {
        await startLanServer()
      } catch {
        config.enabled = false
      }
    }
    createWindow()
  })
  app.on('window-all-closed', () => app.quit())
}
