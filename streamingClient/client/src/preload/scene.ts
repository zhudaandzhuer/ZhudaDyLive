import { contextBridge, ipcRenderer } from 'electron';
import type { SceneSnapshot } from '@zhuda/contracts';
contextBridge.exposeInMainWorld('sceneOutput', {
  reportSourceError: (id: string, message: string) =>
    ipcRenderer.invoke('scene:source-error', id, message),
  snapshot: (): Promise<SceneSnapshot> => ipcRenderer.invoke('scene:snapshot'),
  subscribe: (callback: (state: SceneSnapshot) => void) => {
    const listener = (_: unknown, state: SceneSnapshot) => callback(state);
    ipcRenderer.on('scene:update', listener);
    return () => ipcRenderer.removeListener('scene:update', listener);
  },
});
