import { afterEach, expect, it, vi } from 'vitest';
import type { GameAction } from '@zhuda/contracts';
import { ChainEffects } from '../games/shared/chain-effects';

const fields = vi.hoisted(
  () =>
    [] as {
      draw: ReturnType<typeof vi.fn>;
      setCount: ReturnType<typeof vi.fn>;
      setRenderScale: ReturnType<typeof vi.fn>;
    }[],
);
vi.mock('../games/shared/chain-canvas', () => ({
  ChainCanvas: class {
    ready = Promise.resolve();
    width = 1080;
    height = 1920;
    ratio = 1;
    draw = vi.fn();
    setCount = vi.fn();
    setRenderScale = vi.fn();
    dispose = vi.fn();
    constructor() {
      fields.push(this);
    }
    impact() {
      return {
        x: 0,
        y: 1400,
        length: 1080,
        angle: 0,
        thickness: 4,
        cut: 0.5,
        impactX: 540,
        impactY: 1400,
      };
    }
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  fields.length = 0;
});
function fixture() {
  let time = 0,
    serial = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('performance', { now: () => time });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.set(++serial, cb);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal('document', { createElement: () => ({ dataset: {}, style: {} }) });
  const ctx = Object.fromEntries(
    [
      'setTransform',
      'clearRect',
      'save',
      'restore',
      'beginPath',
      'rect',
      'clip',
      'arc',
      'stroke',
      'fillRect',
    ].map((key) => [key, vi.fn()]),
  );
  const overlay = {
    dataset: {} as Record<string, string>,
    width: 1,
    height: 1,
    getContext: () => ctx,
  };
  const delta = { style: {}, textContent: '' };
  const effects = { replaceChildren() {}, append() {} };
  const stage = {
    dataset: {},
    querySelector: (key: string) =>
      key === '.chain-motion'
        ? overlay
        : key === '#delta'
          ? delta
          : key === '#effects'
            ? effects
            : {},
  };
  const player = new ChainEffects(stage as unknown as HTMLElement, () => {});
  const tick = (now: number) => {
    time = now;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb(now));
  };
  return { player, overlay, tick };
}
const action = (before: number, after: number) =>
  ({
    before: String(before),
    after: String(after),
    senderName: '测试',
    giftName: '测试',
    quantity: '1',
  }) as GameAction;
it('连续礼物不会加速当前消融，100 根变化逐根完整绘制', async () => {
  const { player, overlay, tick } = fixture();
  player.update('100', [action(200, 100)]);
  await Promise.resolve();
  tick(100);
  expect(overlay.dataset.duration).toBe('2400');
  expect(overlay.dataset.renderedCount).toBe('100');
  expect(fields[0]!.draw).toHaveBeenCalledTimes(100);
  player.update('100', [action(100, 110), action(110, 100), action(100, 110), action(110, 100)]);
  tick(1200);
  expect(overlay.dataset.kind).toBe('unlock');
  expect(overlay.dataset.renderedCount).toBe('100');
  tick(2399);
  expect(overlay.dataset.renderedCount).toBe('100');
  tick(2400);
  expect(overlay.dataset.renderedCount).toBe('0');
  await Promise.resolve();
  expect(overlay.dataset.kind).toBe('lock');
  player.dispose();
});
it('面板时长用于下一次动画，修改设置不会跳过正在播放的过程', async () => {
  const { player, overlay, tick } = fixture();
  player.configure({ dissolveDuration: 3 });
  player.update('19', [action(20, 19)]);
  await Promise.resolve();
  player.configure({ dissolveDuration: 1.2, bindDuration: 0.8 });
  tick(1500);
  expect(overlay.dataset.duration).toBe('3000');
  expect(overlay.dataset.renderedCount).toBe('1');
  tick(3000);
  player.update('18', [action(19, 18)]);
  await Promise.resolve();
  expect(overlay.dataset.duration).toBe('1200');
  player.dispose();
});
it('100→40→0 连续消除保留待处理的 40 根，绘制动画后才交接静态层', async () => {
  const { player, overlay, tick } = fixture();
  const field = fields[0]!;
  player.update('100', []);
  player.update('40', [action(100, 40)]);
  await Promise.resolve();
  expect(field.setCount).toHaveBeenLastCalledWith(100n);
  tick(100);
  expect(field.setCount).toHaveBeenLastCalledWith(40n);
  player.update('0', [action(40, 0)]);
  player.update('0', []); // Unrelated snapshots cannot clear either wave.
  tick(1200);
  expect(field.setCount).toHaveBeenLastCalledWith(40n);
  tick(2400);
  await Promise.resolve();
  expect(overlay.dataset.from).toBe('0');
  expect(overlay.dataset.to).toBe('40');
  expect(field.setCount).toHaveBeenLastCalledWith(40n);
  field.draw.mockClear();
  field.setCount.mockClear();
  tick(2416);
  expect(field.draw.mock.calls.map((call) => call[1])).toEqual(
    Array.from({ length: 40 }, (_, i) => BigInt(i)),
  );
  expect(field.setCount).toHaveBeenLastCalledWith(0n);
  expect(field.draw.mock.invocationCallOrder.at(-1)).toBeLessThan(
    field.setCount.mock.invocationCallOrder[0]!,
  );
  tick(4800);
  expect(overlay.dataset.renderedCount).toBe('0');
  player.dispose();
});
it('切换主题继续使用当前预览缩放比例', () => {
  const { player } = fixture();
  player.setRenderScale(0.35);
  player.setTheme('monochrome');
  expect(fields.at(-1)!.setRenderScale).toHaveBeenLastCalledWith(0.35);
  player.dispose();
});
