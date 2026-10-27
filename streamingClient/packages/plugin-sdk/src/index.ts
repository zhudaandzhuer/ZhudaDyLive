import { SceneClient } from './scene-client';
export type { SceneLifecycle } from './scene-client';
export type { DeliveryGap } from './cursor';
import type { PluginRequest, PluginFolder, PluginFolderEntry } from '../../contracts/src/plugins';
let serial = 0;
const pending = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.data?.channel !== 'zhuda-plugin-result') return;
  const call = pending.get(event.data.id);
  if (!call) return;
  clearTimeout(call.timer);
  pending.delete(event.data.id);
  if (event.data.error) call.reject(new Error(event.data.error));
  else call.resolve(event.data.value);
});
function request<T>(request: PluginRequest): Promise<T> {
  if (window.parent === window) return Promise.reject(new Error('请从猪大工作台打开插件'));
  if (pending.size >= 50) return Promise.reject(new Error('插件请求过于频繁'));
  const id = `${Date.now()}-${++serial}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('工作台请求逾时'));
    }, 120_000);
    pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    window.parent.postMessage({ channel: 'zhuda-plugin-request', id, request }, '*');
  });
}
export const studioPlugin = {
  info: () =>
    request<{
      id: string;
      version: string;
      appVersion: string;
      platform: string;
      apiVersion: number;
      capabilities: Record<string, number>;
    }>({
      method: 'info',
    }),
  storage: {
    get: <T>(key: string) => request<T | null>({ method: 'storage.get', key }),
    set: (key: string, value: unknown) =>
      request<void>({ method: 'storage.set', key, value: value as never }),
    remove: (key: string) => request<void>({ method: 'storage.remove', key }),
  },
  folders: {
    choose: () => request<PluginFolder | null>({ method: 'folders.choose' }),
    list: (id: string, path = '') =>
      request<PluginFolderEntry[]>({ method: 'folders.list', id, path }),
    open: (id: string, path = '') => request<void>({ method: 'folders.open', id, path }),
  },
  openWebsite: (url: string) => request<void>({ method: 'external.open', url }),
};

function report(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  window.parent.postMessage({ channel: 'zhuda-scene-error', message }, '*');
}
export const scene = new SceneClient(
  () => window.parent.postMessage({ channel: 'zhuda-scene-ready' }, '*'),
  report,
);
window.addEventListener('message', (event) => {
  if (event.source === window.parent && event.data?.channel === 'zhuda-scene-state')
    scene.receive(event.data.state);
});
window.addEventListener('error', (event) => report(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => report(event.reason));
window.addEventListener('pagehide', () => {
  scene.dispose();
  for (const call of pending.values()) {
    clearTimeout(call.timer);
    call.reject(new Error('插件页面已关闭'));
  }
  pending.clear();
  window.parent.postMessage({ channel: 'zhuda-scene-audio', action: 'stop' }, '*');
});
