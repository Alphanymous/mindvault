const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mindvault', {
  platform: 'electron',
  fetchText: (url) => ipcRenderer.invoke('mv:fetch-text', url),
})
