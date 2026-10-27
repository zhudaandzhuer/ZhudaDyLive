import { afterEach, expect, it, vi } from 'vitest';
import { PrisonGate } from '../../plugins/live-modes/effects';

afterEach(() => vi.unstubAllGlobals());

it('开门初始两次时钟相同也继续动画，新订单立即关闭并可再次开门', () => {
  const context: Record<string, unknown> = {
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  for (const method of [
    'setTransform',
    'clearRect',
    'save',
    'restore',
    'translate',
    'beginPath',
    'rect',
    'clip',
    'fillRect',
    'arc',
    'fill',
  ])
    context[method] = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
    },
  );
  vi.stubGlobal('devicePixelRatio', 1);
  let now = 100;
  vi.stubGlobal('performance', { now: () => now });
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const gate = new PrisonGate({
    clientWidth: 1080,
    clientHeight: 1920,
    getContext: () => context,
  } as unknown as HTMLCanvasElement);
  gate.update(true, true, true);
  expect(frames).toHaveLength(1);
  now = 1800;
  frames.shift()!(now);
  expect(frames).toHaveLength(0);
  expect(context.translate).toHaveBeenLastCalledWith(568, 0);
  gate.update(true, false, true);
  expect(context.translate).toHaveBeenLastCalledWith(0, 0);
  gate.update(true, true, true);
  expect(frames).toHaveLength(1);
});
