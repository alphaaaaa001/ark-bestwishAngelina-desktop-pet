const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cc', {
  setSize: (w, h) => ipcRenderer.send('win:set-size', [w, h]),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  drift: () => ipcRenderer.send('pet:drift'),
  getScale: () => ipcRenderer.invoke('pet:get-scale'),
  saveScale: (s) => ipcRenderer.send('pet:save-scale', s),
  onAction: (cb) => ipcRenderer.on('pet:action', (_e, action) => cb(action)),
  onSay: (cb) => ipcRenderer.on('pet:say', (_e, text) => cb(text)),
  onMusic: (cb) => ipcRenderer.on('pet:music', (_e, data) => cb(data)),
})
