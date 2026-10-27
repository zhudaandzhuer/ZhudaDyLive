import { contextBridge, ipcRenderer } from 'electron';
import type { StudioBridge } from '@zhuda/contracts';
const bridge: StudioBridge = {
  reportSourceError: (id, message) => ipcRenderer.invoke('scene:source-error', id, message),
  mobilePreview: (action) => ipcRenderer.invoke('scene:mobile-preview', action),
  setHotkeyCapture: (active) => ipcRenderer.invoke('scene:hotkey-capture', active),
  sceneCommand: (command) => ipcRenderer.invoke('scene:command', command),
  sceneSnapshot: () => ipcRenderer.invoke('scene:snapshot'),
  subscribeScene(callback) {
    const listener = (_event: unknown, snapshot: Parameters<typeof callback>[0]) =>
      callback(snapshot);
    ipcRenderer.on('scene:update', listener);
    return () => ipcRenderer.removeListener('scene:update', listener);
  },
  snapshot: () => ipcRenderer.invoke('studio:snapshot'),
  pluginCommand: (command) => ipcRenderer.invoke('plugins:command', command),
  pluginRequest: (id, request) => ipcRenderer.invoke('plugins:request', id, request),
  command: (command) => ipcRenderer.invoke('studio:command', command),
  subscribe(callback) {
    const listener = (_event: unknown, snapshot: Parameters<typeof callback>[0]) =>
      callback(snapshot);
    ipcRenderer.on('studio:update', listener);
    return () => ipcRenderer.removeListener('studio:update', listener);
  },
};
contextBridge.exposeInMainWorld('studio', bridge);
