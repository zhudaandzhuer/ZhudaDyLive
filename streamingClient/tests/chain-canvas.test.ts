import { afterEach, expect, it, vi } from 'vitest';
import { chainChange, chainStrand, chainFaceArea } from '../games/shared/chain-layout';
import type { ChainTheme } from '../games/shared/chain-themes';
import { ChainCanvas } from '../games/shared/chain-canvas';

afterEach(() => vi.unstubAllGlobals());
it('单根增减使用同一根身分；清零只移除真正存在的数量', () => {
  expect(chainChange('1', '2')).toEqual({ kind: 'lock', from: 1n, to: 2n, count: 1n });
  expect(chainChange('2', '1')).toEqual({ kind: 'unlock', from: 1n, to: 2n, count: 1n });
  expect(chainChange('4200', '0')).toEqual({ kind: 'unlock', from: 0n, to: 4200n, count: 4200n });
  expect(chainChange('0', '0').count).toBe(0n);
});
it('4,200 根各有可见的独立路径，三种材质在直横版都避开上半部人脸', () => {
  for (const [width, height] of [
    [1280, 720],
    [540, 960],
    [360, 640],
  ] as const) {
    const intersects = (
      s: ReturnType<typeof chainStrand>,
      box: ReturnType<typeof chainFaceArea>,
      padding = 0,
    ) => {
      let low = 0,
        high = 1;
      for (const [start, distance, min, max] of [
        [s.x, Math.cos(s.angle) * s.length, box.left - padding, box.right + padding],
        [s.y, Math.sin(s.angle) * s.length, box.top - padding, box.bottom + padding],
      ] as const) {
        if (Math.abs(distance) < 0.00001) {
          if (start < min || start > max) return false;
          continue;
        }
        const a = (min - start) / distance,
          b = (max - start) / distance;
        low = Math.max(low, Math.min(a, b));
        high = Math.min(high, Math.max(a, b));
        if (low > high) return false;
      }
      return true;
    };
    for (const theme of ['classic', 'monochrome', 'plush'] as const) {
      const paths = new Set<string>();
      const directions = [0, 0, 0, 0];
      let upperCrossings = 0;
      for (let id = 0n; id < 4200n; id++) {
        const s = chainStrand(id, width, height, theme);
        paths.add(JSON.stringify(s));
        if (theme === 'classic') expect(s.thickness).toBeLessThan(5);
        const endX = s.x + Math.cos(s.angle) * s.length;
        const endY = s.y + Math.sin(s.angle) * s.length;
        expect(intersects(s, { left: 0, right: width, top: 0, bottom: height })).toBe(true);
        expect(intersects(s, chainFaceArea(width, height), s.thickness / 2)).toBe(false);
        const impactX = s.x + Math.cos(s.angle) * s.length * s.cut;
        const impactY = s.y + Math.sin(s.angle) * s.length * s.cut;
        expect(impactX >= 0 && impactX <= width && impactY >= 0 && impactY <= height).toBe(true);
        const bin = Math.floor((s.angle / Math.PI) * 4);
        directions[bin] = directions[bin]! + 1;
        if (Math.min(s.y, endY) < height! * 0.4) upperCrossings++;
      }
      expect(paths.size).toBe(4200);
      expect(directions.every((count) => count > 300)).toBe(true);
      expect(upperCrossings).toBeGreaterThanOrEqual(840);
    }
  }
});
function canvasFixture(theme: ChainTheme = 'classic') {
  const context = () => ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    globalAlpha: 1,
  });
  const ctx = context(),
    strip = context();
  vi.stubGlobal(
    'Image',
    class {
      decode = async () => {};
    },
  );
  vi.stubGlobal('document', {
    createElement: () => ({ width: 1, height: 1, getContext: () => strip }),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('performance', { now: () => 0 });
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const canvas = {
    clientWidth: 1280,
    clientHeight: 720,
    width: 1,
    height: 1,
    dataset: {},
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, ctx, field: new ChainCanvas(canvas, 'chain-steel.png', theme) };
}
it('实际逐根画 1／2／4,200 根，重复快照不重画，0 根清空', async () => {
  const { field, canvas, ctx } = canvasFixture();
  await field.ready;
  for (const count of [1n, 2n, 4200n, 0n]) {
    ctx.drawImage.mockClear();
    field.setCount(count);
    expect(ctx.drawImage).toHaveBeenCalledTimes(Number(count));
    expect(canvas.dataset.renderedCount).toBe(String(count));
    field.setCount(count);
    expect(ctx.drawImage).toHaveBeenCalledTimes(Number(count));
  }
  field.dispose();
});
it('手机缩放按实际屏幕像素绘制，输出保留高清，缩放不改变逐根数量', async () => {
  vi.stubGlobal('devicePixelRatio', 3);
  const { field, canvas, ctx } = canvasFixture('monochrome');
  vi.stubGlobal('devicePixelRatio', 3);
  field.setRenderScale(1 / 3);
  await field.ready;
  field.setCount(200n);
  expect(canvas.width).toBe(1280);
  expect(canvas.height).toBe(720);
  expect(canvas.dataset.renderedCount).toBe('200');
  ctx.drawImage.mockClear();
  field.setRenderScale(1);
  expect(canvas.width).toBe(2560);
  expect(canvas.height).toBe(1440);
  expect(canvas.dataset.renderedCount).toBe('200');
  expect(ctx.drawImage).toHaveBeenCalledTimes(200);
  field.setRenderScale(NaN);
  field.setRenderScale(-1);
  expect(canvas.width).toBe(2560);
  field.dispose();
});
it('单根添加画出一条由两端绑合，单根断开只画同一条的两段', async () => {
  const { field, ctx } = canvasFixture();
  await field.ready;
  for (const kind of ['lock', 'unlock'] as const) {
    ctx.drawImage.mockClear();
    field.draw(ctx as unknown as CanvasRenderingContext2D, 1n, kind, 0.4);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  }
  field.dispose();
});
it('极大数量分帧绘制可中止，不转成不精确数字，也不把数量抽样成固定条数', async () => {
  const { field, canvas, ctx } = canvasFixture();
  await field.ready;
  let time = 0;
  vi.stubGlobal('performance', { now: () => (time += 8) });
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }),
  );
  const huge = 18446744073709551615n;
  field.setCount(huge);
  expect(canvas.dataset.targetCount).toBe(String(huge));
  expect(canvas.dataset.renderedCount).toBe('128');
  expect(callbacks).toHaveLength(1);
  field.setCount(0n);
  ctx.drawImage.mockClear();
  callbacks[0]!(0);
  expect(ctx.drawImage).not.toHaveBeenCalled();
  expect(canvas.dataset.renderedCount).toBe('0');
  field.dispose();
});

it('三款主题都逐根绘制，粗链与玩偶放大材质，单根特效保持相同身分', async () => {
  for (const theme of ['classic', 'monochrome', 'plush'] as const) {
    const { field, canvas, ctx } = canvasFixture(theme);
    await field.ready;
    ctx.drawImage.mockClear();
    field.setCount(4200n);
    expect(ctx.drawImage).toHaveBeenCalledTimes(4200);
    expect(canvas.dataset.renderedCount).toBe('4200');
    expect(canvas.dataset.theme).toBe(theme);
    for (const [width, height] of [
      [1280, 720],
      [540, 960],
    ]) {
      const base = chainStrand(17n, width!, height!);
      const themed = chainStrand(17n, width!, height!, theme);
      expect({ ...themed, thickness: base.thickness }).toEqual(base);
      if (theme !== 'classic') expect(themed.thickness).toBeGreaterThan(base.thickness * 6);
    }
    for (const effect of ['lock', 'unlock'] as const) {
      ctx.drawImage.mockClear();
      field.draw(ctx as unknown as CanvasRenderingContext2D, 17n, effect, 0.4);
      expect(ctx.drawImage).toHaveBeenCalledTimes(2);
      expect(field.impact(17n).angle).toBe(chainStrand(17n, 1280, 720, theme).angle);
    }
    field.dispose();
  }
});
