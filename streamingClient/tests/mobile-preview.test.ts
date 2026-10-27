import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore } from '@zhuda/core';
import { SceneManager } from '../client/src/main/scenes/manager';
import { SceneMedia } from '../client/src/main/scenes/media';
import { MobilePreview, previewScene } from '../client/src/main/scenes/mobile-preview';
import { pluginPack } from './plugin-fixtures';

const source = {
  id: 'image',
  name: '图片',
  description: 'test',
  entry: 'index.html',
  width: 600,
  height: 600,
  parameters: [{ key: 'file', label: '图片', type: 'image', default: '' }],
  events: [],
  rules: [],
  themes: [],
};
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'zhuda-preview-test-'));
  const store = new LocalStore(':memory:');
  const { item } = pluginPack({
    id: 'plugin.scene-basics',
    permissions: [],
    sceneSources: [source],
  });
  const engine = new SceneManager(
    store,
    {
      snapshot: () => ({ installed: [{ item, enabled: true }] }),
      installedItem: () => item,
      validateInstalled: () => item,
      sceneVersionAllowed: () => true,
    },
    () => ({ state: 'idle', webId: '' }),
  );
  engine.command({ action: 'add', pluginId: item.manifest.id, sourceId: source.id });
  const id = engine.snapshot().layers[0]!.layer.id;
  const media = new SceneMedia(join(directory, 'media'));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB6kAAAAASUVORK5CYII=',
    'base64',
  );
  const url = media.cacheImage(png);
  const unused = media.cacheImage(Buffer.concat([png, Buffer.from('unused')]));
  const patch = (value: object) =>
    engine.command({
      action: 'patch',
      id,
      revision: engine.snapshot().document.revision,
      patch: value,
    });
  patch({ settings: { file: url } });
  writeFileSync(join(directory, 'preview.js'), '// phone');
  writeFileSync(join(directory, 'preview.css'), 'body{}');
  const service = new MobilePreview({
    assets: directory,
    snapshot: () => engine.snapshot(),
    media: (request) => media.serve(request),
    plugin: () =>
      new Response('<h1>signed plugin asset</h1>', { headers: { 'Content-Type': 'text/html' } }),
    addresses: () => [{ name: 'Wi-Fi', address: '127.0.0.1' }],
  });
  return {
    service,
    engine,
    id,
    url,
    unused,
    patch,
    png,
    close() {
      service.stop();
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

describe('手机局域网预览', () => {
  it('按需开启、生成二维码，重复开启复用分享，停用后旧链接不可用', async () => {
    const f = fixture();
    try {
      expect(await f.service.status()).toEqual({ active: false, addresses: [] });
      const [first, duplicate] = await Promise.all([f.service.start(), f.service.start()]);
      const address = first.addresses[0]!;
      expect(address.qr).toMatch(/^data:image\/png;base64,iVBOR/);
      expect(duplicate.addresses[0]!.url).toBe(address.url);
      const response = await fetch(address.url);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('手机预览');
      expect((await fetch(new URL('preview.js', address.url))).status).toBe(200);
      f.service.stop();
      expect((await f.service.status()).active).toBe(false);
      const next = (await f.service.start()).addresses[0]!;
      expect(next.url).not.toBe(address.url);
      const revoked = new URL(next.url);
      revoked.pathname = new URL(address.url).pathname;
      expect((await fetch(revoked)).status).toBe(404);
    } finally {
      f.close();
    }
  });

  it('只提供当前场景素材和来源，支持视频式 Range 请求，拒绝其他资源与写入', async () => {
    const f = fixture();
    try {
      const base = (await f.service.start()).addresses[0]!.url;
      const state = await (await fetch(new URL('snapshot', base))).json();
      expect(state.library).toEqual([]);
      expect(state.hotkeys).toBeUndefined();
      expect(state.layers[0].layer.hotkeys).toEqual([]);
      expect(state.layers[0].runtime.webId).toBe('');
      expect(state.layers[0].layer.settings.file).toContain(new URL(base).pathname + 'media/');
      const mediaPath = f.url.replace('zhuda-scene://', '');
      const bytes = await fetch(new URL(mediaPath, base), { headers: { Range: 'bytes=1-4' } });
      expect(bytes.status).toBe(206);
      expect(Buffer.from(await bytes.arrayBuffer())).toEqual(f.png.subarray(1, 5));
      expect((await fetch(new URL(f.unused.replace('zhuda-scene://', ''), base))).status).toBe(404);
      expect(
        (await fetch(new URL('plugin/plugin.scene-basics/1.0.0/assets/index.html', base))).status,
      ).toBe(200);
      for (const path of [
        'plugin/plugin.notes/1.0.0/assets/index.html',
        'plugin/plugin.scene-basics/9.9.9/assets/index.html',
        'plugin/plugin.scene-basics/1.0.0/local/private/file.png',
        '../../studio.sqlite',
        'api/v1/activate',
        'snapshot?token=x',
      ])
        expect((await fetch(new URL(path, base))).status, path).toBe(404);
      expect((await fetch(new URL('snapshot', base), { method: 'POST' })).status).toBe(405);
      expect(
        (
          await fetch(new URL('snapshot', base), {
            headers: { Origin: 'https://unrelated.example' },
          })
        ).status,
      ).toBe(404);
      const noToken = new URL(base);
      noToken.pathname = '/';
      expect((await fetch(noToken)).status).toBe(404);
      f.patch({ visible: false });
      expect((await fetch(new URL(mediaPath, base))).status).toBe(404);
      expect(
        (await fetch(new URL('plugin/plugin.scene-basics/1.0.0/assets/index.html', base))).status,
      ).toBe(404);
    } finally {
      f.close();
    }
  });

  it('SSE 首次连接与重连获取最新场景，实时更新并在停止后断开', async () => {
    const f = fixture();
    const abort = new AbortController();
    try {
      const base = (await f.service.start()).addresses[0]!.url;
      const response = await fetch(new URL('events', base), { signal: abort.signal });
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      const reader = response.body!.getReader();
      const decode = new TextDecoder();
      expect(decode.decode((await reader.read()).value)).toContain('"width":1080');
      f.patch({ x: 120, name: '新布局' });
      f.service.publish();
      expect(decode.decode((await reader.read()).value)).toContain('新布局');
      const reconnect = await fetch(new URL('events', base), { signal: abort.signal });
      const again = reconnect.body!.getReader();
      expect(decode.decode((await again.read()).value)).toContain('"x":120');
      await again.cancel();
      f.service.stop();
      const ending = decode.decode((await reader.read()).value);
      expect(ending).toContain('event: ended');
      expect((await reader.read()).done).toBe(true);
      // Projecting URLs must never mutate the local scene or its custom protocols.
      const original = f.engine.snapshot();
      const projected = previewScene(original, '/p/test/');
      expect(projected.layers[0]!.url).toMatch(/^\/p\/test\/plugin\//);
      expect(original.layers[0]!.url).toMatch(/^zhuda-plugin:/);
      expect(original.layers[0]!.layer.settings.file).toBe(f.url);
    } finally {
      abort.abort();
      f.close();
    }
  });

  it('未连接网络时不启动分享服务', async () => {
    const service = new MobilePreview({
      assets: '',
      snapshot: () => {
        throw new Error();
      },
      plugin: () => new Response(),
      media: () => new Response(),
      addresses: () => [],
    });
    await expect(service.start()).rejects.toThrow('连接 Wi-Fi');
    expect((await service.status()).active).toBe(false);
  });
});
