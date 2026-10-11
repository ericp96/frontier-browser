// Preload for the TRUSTED shell only. Web pages get no preload at all.
// Exposes a narrow, typed API: no ipcRenderer, no Node, no secrets.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('frontier', {
  command: (text) => ipcRenderer.invoke('frontier:command', String(text)),
  audio: (bytes) => ipcRenderer.invoke('frontier:audio', bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
  getSettings: () => ipcRenderer.invoke('frontier:get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('frontier:save-settings', s),
  delivered: (id, result) => ipcRenderer.send('frontier:delivered', id, result),
  onAnnounce: (cb) => ipcRenderer.on('frontier:announce', (_e, id, a) => cb(id, a)),
  onInterrupt: (cb) => ipcRenderer.on('frontier:interrupt', () => cb()),
  onRate: (cb) => ipcRenderer.on('frontier:rate', (_e, d) => cb(d)),
  onFocusCommand: (cb) => ipcRenderer.on('frontier:focus-command', () => cb()),
});
