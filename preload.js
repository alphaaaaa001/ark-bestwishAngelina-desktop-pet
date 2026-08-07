const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('cc', {
  setSize: (w, h) => ipcRenderer.send('win:set-size', [w, h]),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  onAction: (cb) => ipcRenderer.on('pet:action', (_e, action) => cb(action)),
})
