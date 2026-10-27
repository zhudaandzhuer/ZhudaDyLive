import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  normalizeHotkey,
  hotkeyFromKeyEvent,
  platformHotkey,
  sceneHotkeysSchema,
  type SceneSnapshot,
  type SceneHotkey,
} from '@zhuda/contracts';
import { SceneHotkeys } from '../client/src/main/scenes/hotkeys';

afterEach(() => vi.useRealTimers());
const binding = (accelerator = 'Control+Alt+F6'): SceneHotkey => ({
  id: randomUUID(),
  accelerator,
  eventId: 'add',
  amount: 10,
  enabled: true,
});
function fixture() {
  const callbacks = new Map<string, () => void>();
  const shortcuts = {
    register: vi.fn((key: string, callback: () => void) => {
      callbacks.set(key, callback);
      return true;
    }),
    unregister: vi.fn((key: string) => {
      callbacks.delete(key);
    }),
  };
  const fire = vi.fn(async () => {}),
    changed = vi.fn();
  const manager = new SceneHotkeys(shortcuts, fire, changed, 'darwin');
  const hotkey = binding();
  const scene = {
    document: { id: randomUUID() },
    layers: [
      {
        layer: { id: randomUUID(), hotkeys: [hotkey], locked: true, visible: false },
        source: { events: [{ id: 'add', min: 1, max: 100 }] },
        available: true,
        runtime: { status: 'running', game: { round: { status: 'won' } } },
      },
    ],
  } as unknown as SceneSnapshot;
  return { manager, shortcuts, callbacks, fire, changed, hotkey, scene };
}
it('支持单键、规范组合键并识别 Mac / Windows 的同义按键', () => {
  expect(normalizeHotkey('Alt+Control+F6')).toBe('Control+Alt+F6');
  expect(normalizeHotkey('W')).toBe('W');
  expect(normalizeHotkey('1')).toBe('1');
  expect(platformHotkey('CommandOrControl+F6', 'darwin')).toBe(
    platformHotkey('Super+F6', 'darwin'),
  );
  expect(platformHotkey('CommandOrControl+F6', 'win32')).toBe(
    platformHotkey('Control+F6', 'win32'),
  );
  for (const invalid of [
    'Control+Control+A',
    'MediaPlayPause',
    'Control+Unknown',
    'CommandOrControl+Super+A',
  ])
    expect(() => normalizeHotkey(invalid)).toThrow();
  expect(sceneHotkeysSchema.safeParse([binding(), binding('Alt+Control+F6')]).success).toBe(false);
});
it('从键盘事件录制物理按键，兼容大小写、空格、方向键及双端修饰键', () => {
  const event = {
    key: 'w',
    code: 'KeyW',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
  expect(hotkeyFromKeyEvent(event, 'win32')).toBe('W');
  expect(hotkeyFromKeyEvent({ ...event, key: 'W', ctrlKey: true, shiftKey: true }, 'win32')).toBe(
    'Control+Shift+W',
  );
  expect(hotkeyFromKeyEvent({ ...event, metaKey: true }, 'darwin')).toBe('CommandOrControl+W');
  expect(hotkeyFromKeyEvent({ ...event, metaKey: true }, 'win32')).toBe('Super+W');
  expect(hotkeyFromKeyEvent({ ...event, key: ' ', code: 'Space' }, 'win32')).toBe('Space');
  expect(hotkeyFromKeyEvent({ ...event, key: 'ArrowUp', code: 'ArrowUp' }, 'win32')).toBe('Up');
  expect(
    hotkeyFromKeyEvent({ ...event, key: 'Shift', code: 'ShiftLeft', shiftKey: true }, 'win32'),
  ).toBeNull();
});
it('完成、隐藏和锁定不影响全局触发；连续快照不重复注册，长按有节流', async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.manager.sync(f.scene);
  f.manager.sync(f.scene);
  expect(f.shortcuts.register).toHaveBeenCalledTimes(1);
  expect(f.manager.snapshot()[0]?.state).toBe('active');
  f.callbacks.get(f.hotkey.accelerator)!();
  f.callbacks.get(f.hotkey.accelerator)!();
  await Promise.resolve();
  expect(f.fire).toHaveBeenCalledTimes(1);
  expect(f.fire).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'hotkey',
      sceneId: f.scene.document.id,
      id: f.scene.layers[0]!.layer.id,
      hotkeyId: f.hotkey.id,
    }),
  );
  vi.advanceTimersByTime(300);
  f.callbacks.get(f.hotkey.accelerator)!();
  await Promise.resolve();
  expect(f.fire).toHaveBeenCalledTimes(2);
  f.manager.sync(f.scene);
  expect(f.manager.snapshot()[0]?.lastResult).toBe('已补触发');
  f.manager.dispose();
});
it('全局热键按礼物映射触发工作站级事件', async () => {
  const f = fixture();
  const global = {
    id: randomUUID(),
    accelerator: 'CommandOrControl+F7',
    giftId: '2001',
    quantity: 1,
    enabled: true,
  };
  f.scene.document.globalHotkeys = [global];
  f.manager.sync(f.scene);
  expect(f.manager.snapshot().find((status) => status.hotkeyId === global.id)).toMatchObject({
    scope: 'global',
    state: 'active',
  });
  f.callbacks.get(global.accelerator)?.();
  await Promise.resolve();
  expect(f.fire).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'globalHotkey',
      sceneId: f.scene.document.id,
      hotkeyId: global.id,
    }),
  );
  f.manager.dispose();
});
it('暂停、禁用、切换场景和退出释放注册；过期回调不会命中其他场景', () => {
  const f = fixture();
  f.manager.sync(f.scene);
  const stale = f.callbacks.get(f.hotkey.accelerator)!;
  f.scene.layers[0]!.runtime.status = 'paused';
  f.manager.sync(f.scene);
  stale();
  expect(f.fire).not.toHaveBeenCalled();
  expect(f.callbacks.size).toBe(0);
  f.scene.layers[0]!.runtime.status = 'running';
  f.manager.sync(f.scene);
  f.hotkey.enabled = false;
  f.manager.sync(f.scene);
  expect(f.callbacks.size).toBe(0);
  f.hotkey.enabled = true;
  f.manager.sync(f.scene);
  f.scene.document.id = randomUUID();
  f.manager.sync(f.scene);
  expect(f.shortcuts.register).toHaveBeenCalledTimes(4);
  f.manager.dispose();
  expect(f.callbacks.size).toBe(0);
});
it('重复热键全部标记冲突，不随机选择图层；停用一项后恢复注册', () => {
  const f = fixture();
  f.scene.layers.push(structuredClone(f.scene.layers[0]!));
  const second = f.scene.layers[1]!;
  second.layer.id = randomUUID();
  second.layer.hotkeys = [binding()];
  f.manager.sync(f.scene);
  expect(f.shortcuts.register).not.toHaveBeenCalled();
  expect(f.manager.snapshot().map((s) => s.state)).toEqual(['conflict', 'conflict']);
  second.layer.hotkeys[0]!.enabled = false;
  f.manager.sync(f.scene);
  expect(f.callbacks.size).toBe(1);
  f.manager.dispose();
});
it('录制时注销热键，结束后恢复；系统占用和事件失效可见', () => {
  const f = fixture();
  f.manager.sync(f.scene);
  f.manager.capture(true);
  f.manager.sync(f.scene);
  expect(f.callbacks.size).toBe(0);
  expect(f.manager.snapshot()[0]?.state).toBe('suspended');
  f.shortcuts.register.mockReturnValue(false);
  f.manager.capture(false);
  f.manager.sync(f.scene);
  expect(f.manager.snapshot()[0]?.state).toBe('error');
  const calls = f.shortcuts.register.mock.calls.length;
  f.manager.sync(f.scene);
  expect(f.shortcuts.register).toHaveBeenCalledTimes(calls);
  f.manager.capture(true);
  f.shortcuts.register.mockReturnValue(true);
  f.manager.capture(false);
  f.manager.sync(f.scene);
  expect(f.manager.snapshot()[0]?.state).toBe('active');
  f.scene.layers[0]!.available = false;
  f.manager.sync(f.scene);
  expect(f.manager.snapshot()[0]?.state).toBe('error');
  f.manager.dispose();
});
it('触发被主机拒绝时显示失败原因，不显示虚假的成功', async () => {
  const f = fixture();
  f.fire.mockRejectedValueOnce(new Error('当前场景已切换'));
  f.manager.sync(f.scene);
  f.callbacks.get(f.hotkey.accelerator)!();
  await Promise.resolve();
  f.manager.sync(f.scene);
  expect(f.manager.snapshot()[0]?.lastResult).toBe('当前场景已切换');
  expect(f.manager.snapshot()[0]?.lastTriggeredAt).toBeUndefined();
  f.manager.dispose();
});
