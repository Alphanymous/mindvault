const { contextBridge, ipcRenderer, desktopCapturer } = require('electron')

contextBridge.exposeInMainWorld('mindvault', {
  platform: 'electron',
  fetchText: (url) => ipcRenderer.invoke('mv:fetch-text', url),
  pair: {
    get: () => ipcRenderer.invoke('mv:pair:get'),
    setEnabled: (enabled) => ipcRenderer.invoke('mv:pair:set', !!enabled),
    reset: () => ipcRenderer.invoke('mv:pair:reset'),
  },
  folder: {
    get: () => ipcRenderer.invoke('mv:folder:get'),
    choose: () => ipcRenderer.invoke('mv:folder:choose'),
    use: (path) => ipcRenderer.invoke('mv:folder:use', path),
    clear: () => ipcRenderer.invoke('mv:folder:clear'),
    rpc: (msg) => ipcRenderer.invoke('mv:folder:rpc', msg),
  },
  captureScreenshot: () => ipcRenderer.invoke('mv:capture-screenshot'),
  // Requests from the phone / browser clipper arrive here; the page answers with its own data.
  onRpc: (handler) => {
    ipcRenderer.removeAllListeners('mv:rpc')
    ipcRenderer.on('mv:rpc', async (_event, { id, msg }) => {
      let result
      try {
        result = await handler(msg)
      } catch (e) {
        result = { ok: false, error: String((e && e.message) || e) }
      }
      ipcRenderer.invoke('mv:rpc-reply', id, result)
    })
  },
})
