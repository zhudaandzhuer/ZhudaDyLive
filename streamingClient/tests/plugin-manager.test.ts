import { it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore, installLocalPlugin } from '@zhuda/core';
import { pluginPack } from './plugin-fixtures';

const native = vi.hoisted(() => ({
  choose: vi.fn(),
  openPath: vi.fn(async () => ''),
  external: vi.fn(async () => {}),
}));
vi.mock('electron', () => ({
  dialog: { showOpenDialog: native.choose },
  shell: { openPath: native.openPath, openExternal: native.external },
}));
import { PluginManager } from '../client/src/main/plugins/manager';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zhuda-local-plugin-'));
  const store = new LocalStore(':memory:');
  const manager = new PluginManager(
    store,
    join(dir, 'installed'),
    () => {},
    () => null,
  );
  return { dir, store, manager, inbox: join(dir, 'installed', 'inbox') };
}
function close(f: ReturnType<typeof setup>) {
  f.manager.dispose();
  f.store.close();
  rmSync(f.dir, { recursive: true, force: true });
}

it('扫描插件区 ZIP 后自动安装，并按版本更新和保留回退', async () => {
  const f = setup();
  try {
    const first = pluginPack({ publisher: '本地开发者', version: '1.0.0' });
    writeFileSync(join(f.inbox, 'notes-1.0.0.zip'), first.zip);
    await f.manager.command({ action: 'sync' });
    expect(f.manager.snapshot().installed[0]?.item.manifest.version).toBe('1.0.0');
    const next = pluginPack({ publisher: '本地开发者', version: '1.1.0' });
    writeFileSync(join(f.inbox, 'notes-1.1.0.zip'), next.zip);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(f.manager.snapshot().installed[0]?.item.manifest.version).toBe('1.1.0');
    expect(f.manager.snapshot().rollback?.['plugin.notes']).toBe('1.0.0');
    await f.manager.command({ action: 'rollback', id: 'plugin.notes' });
    expect(f.manager.snapshot().installed[0]?.item.manifest.version).toBe('1.0.0');
  } finally {
    close(f);
  }
});

it('本机插件权限、数据迁移和移除后的数据保留', async () => {
  const f = setup();
  try {
    const pack = pluginPack({ permissions: ['storage'] });
    writeFileSync(join(f.inbox, 'notes.zip'), pack.zip);
    await f.manager.command({ action: 'sync' });
    await f.manager.request('plugin.notes', {
      method: 'storage.set',
      key: 'note',
      value: 'keep me',
    });
    expect(await f.manager.request('plugin.notes', { method: 'storage.get', key: 'note' })).toBe(
      'keep me',
    );
    await expect(f.manager.request('plugin.notes', { method: 'folders.choose' })).rejects.toThrow(
      /权限/,
    );
    await f.manager.command({ action: 'remove', id: 'plugin.notes' });
    writeFileSync(join(f.inbox, 'notes.zip'), pack.zip);
    await f.manager.command({ action: 'sync' });
    expect(await f.manager.request('plugin.notes', { method: 'storage.get', key: 'note' })).toBe(
      'keep me',
    );
  } finally {
    close(f);
  }
});

it('客户端携带的新版插件自动更新，保留数据、禁用状态与旧场景版本', async () => {
  const f = setup();
  try {
    const first = pluginPack({ version: '1.0.0', permissions: ['storage'] });
    const next = pluginPack({ version: '1.1.0', permissions: ['storage'] });
    f.manager.useBundled([{ item: first.item, bytes: first.zip }]);
    await f.manager.request('plugin.notes', { method: 'storage.set', key: 'note', value: '保留' });
    await f.manager.command({ action: 'enable', id: 'plugin.notes', enabled: false });
    f.manager.useBundled([{ item: next.item, bytes: next.zip }]);
    expect(f.manager.snapshot().installed[0]?.item.manifest.version).toBe('1.1.0');
    expect(f.manager.snapshot().installed[0]?.enabled).toBe(false);
    expect(f.manager.snapshot().rollback?.['plugin.notes']).toBe('1.0.0');
    await f.manager.command({ action: 'enable', id: 'plugin.notes', enabled: true });
    expect(await f.manager.request('plugin.notes', { method: 'storage.get', key: 'note' })).toBe(
      '保留',
    );
    f.manager.sceneVersionAllowed = (_id, version) => version === '1.0.0';
    expect(f.manager.validateInstalled('plugin.notes', '1.0.0').manifest.version).toBe('1.0.0');
    f.manager.useBundled([{ item: first.item, bytes: first.zip }]);
    expect(f.manager.snapshot().installed[0]?.item.manifest.version).toBe('1.1.0');
    await f.manager.command({ action: 'remove', id: 'plugin.notes' });
    f.manager.useBundled([{ item: next.item, bytes: next.zip }]);
    expect(f.manager.snapshot().installed).toHaveLength(0);
  } finally {
    close(f);
  }
});

it('文件夹能力只处理用户选定范围，不允许穿越和 symlink 逃逸', async () => {
  const f = setup();
  try {
    const pack = pluginPack({ permissions: ['storage', 'folders', 'external-links'] });
    writeFileSync(join(f.inbox, 'notes.zip'), pack.zip);
    await f.manager.command({ action: 'sync' });
    const selected = join(f.dir, 'selected'),
      outside = join(f.dir, 'outside');
    mkdirSync(join(selected, 'child'), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(selected, 'picture.png'), 'image fixture');
    writeFileSync(join(selected, 'secret.txt'), 'unavailable');
    symlinkSync(outside, join(selected, 'escape'), 'dir');
    native.choose.mockResolvedValue({ canceled: false, filePaths: [selected] });
    const folder = (await f.manager.request('plugin.notes', { method: 'folders.choose' })) as {
      id: string;
      name: string;
    };
    expect(folder.name).toBe('selected');
    const list = (await f.manager.request('plugin.notes', {
      method: 'folders.list',
      id: folder.id,
    })) as { name: string; previewUrl?: string }[];
    expect(list.map((entry) => entry.name)).not.toContain('escape');
    const preview = list.find((entry) => entry.name === 'picture.png')!.previewUrl!;
    expect(f.manager.serve(new Request(preview)).status).toBe(200);
    for (const path of ['../outside', 'escape', '/etc', '..\\outside'])
      await expect(
        f.manager.request('plugin.notes', { method: 'folders.list', id: folder.id, path }),
      ).rejects.toThrow();
    await expect(
      f.manager.request('plugin.notes', { method: 'external.open', url: 'file:///etc/passwd' }),
    ).rejects.toThrow(/HTTPS/);
    expect(native.openPath).not.toHaveBeenCalled();
  } finally {
    close(f);
  }
});

it('插件资源篡改会被拒绝，视频支持 Range 和 HEAD', async () => {
  const f = setup();
  try {
    const pack = pluginPack(
      { permissions: [] },
      { 'assets/idle.mp4': new TextEncoder().encode('0123456789') },
    );
    writeFileSync(join(f.inbox, 'notes.zip'), pack.zip);
    await f.manager.command({ action: 'sync' });
    const url = 'zhuda-plugin://plugin.notes/1.0.0/assets/assets/idle.mp4';
    const all = f.manager.serve(new Request(url));
    expect(all.headers.get('content-type')).toBe('video/mp4');
    expect(await all.text()).toBe('0123456789');
    expect(f.manager.serve(new Request(url, { headers: { Range: 'bytes=2-5' } })).status).toBe(206);
    expect(await f.manager.serve(new Request(url, { headers: { Range: 'bytes=-3' } })).text()).toBe(
      '789',
    );
    const head = f.manager.serve(new Request(url, { method: 'HEAD' }));
    expect(head.headers.get('content-length')).toBe('10');
    writeFileSync(join(f.dir, 'installed/plugin.notes/1.0.0/assets/idle.mp4'), '9876543210');
    expect(f.manager.serve(new Request(url)).status).toBe(404);
  } finally {
    close(f);
  }
});

it('损坏 ZIP 会被隔离，不影响其他本机插件', async () => {
  const f = setup();
  try {
    const good = pluginPack({ id: 'plugin.good' });
    writeFileSync(join(f.inbox, 'good.zip'), good.zip);
    writeFileSync(join(f.inbox, 'broken.zip'), Buffer.from('not a zip'));
    await f.manager.command({ action: 'sync' });
    expect(
      f.manager.snapshot().installed.some((entry) => entry.item.manifest.id === 'plugin.good'),
    ).toBe(true);
    expect(f.manager.snapshot().unavailable?.some((entry) => entry.name === 'broken.zip')).toBe(
      true,
    );
  } finally {
    close(f);
  }
});
