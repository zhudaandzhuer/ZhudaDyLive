import { contextBridge, ipcRenderer } from 'electron';
import type { GameBridge } from '@zhuda/contracts';
const bridge: GameBridge = {
  snapshot: () => ipcRenderer.invoke('game:snapshot'),
  subscribe(callback) {
    const listener = (_event: unknown, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('game:update', listener);
    return () => ipcRenderer.removeListener('game:update', listener);
  },
};
contextBridge.exposeInMainWorld('zhudaGame', bridge);
