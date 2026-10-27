import { afterEach, expect, it, vi } from 'vitest';
import { ClothCanvas } from '../../plugins/live-modes/cloth-canvas';
import { clothChange, clothPiece } from '../../plugins/live-modes/cloth-layout';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const context = () => {
    const c = {
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      drawImage: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
    };
    for (const name of [
      'setTransform',
      'clearRect',
      'save',
      'restore',
      'translate',
      'rotate',
      'scale',
      'drawImage',
      'fill',
      'clip',
      'stroke',
      'beginPath',
      'moveTo',
      'lineTo',
      'quadraticCurveTo',
      'closePath',
      'setLineDash',
    ])
      (c as Record<string, unknown>)[name] = vi.fn();
    return c;
  };
  const main = context();
  const contexts: ReturnType<typeof context>[] = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const c = context();
      contexts.push(c);
      return { width: 1, height: 1, getContext: () => c };
    },
  });
  vi.stubGlobal('Path2D', class {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('performance', { now: () => 0 });
  const callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const canvas = {
    clientWidth: 1080,
    clientHeight: 1920,
    width: 1,
    height: 1,
    dataset: {},
    getContext: () => main,
  } as unknown as HTMLCanvasElement;
  const field = new ClothCanvas(canvas);
  return { field, canvas, main, base: contexts[0]!, callbacks };
}

it('1／30／4200 点分别逐块绘制，0 点清空；空闲快照不重复绘制', () => {
  const { field, canvas, base } = fixture();
  for (const count of [1n, 30n, 4200n, 0n]) {
    field.update(0n, 'noir');
    vi.mocked(base.drawImage).mockClear();
    field.update(count, 'noir');
    expect(base.drawImage).toHaveBeenCalledTimes(Number(count));
    expect(canvas.dataset.renderedCount).toBe(String(count));
    field.update(count, 'noir', undefined, true);
    expect(base.drawImage).toHaveBeenCalledTimes(Number(count));
  }
  field.dispose();
});

it('布料在机身两侧从底部逐层堆高，横竖版均保留中央空间及稳定身份', () => {
  for (const [width, height] of [
    [1080, 1920],
    [1920, 1080],
  ]) {
    const points = Array.from({ length: 4200 }, (_, i) => clothPiece(BigInt(i), width!, height!));
    expect(new Set(points.map((p) => JSON.stringify(p))).size).toBe(4200);
    expect(points.slice(0, 30).every((p) => p.x > width! * 0.6)).toBe(true);
    expect(points.filter((p) => p.y < height! * 0.4).length).toBeGreaterThan(1000);
    expect(points.filter((p) => p.x > width! * 0.6).length).toBeGreaterThan(1000);
    expect(points.filter((p) => p.x < width! * 0.4).length).toBeGreaterThan(1000);
    expect(points.every((p) => Math.abs(p.x - width! / 2) > width! * 0.15)).toBe(true);
    expect(
      points.every(
        (p) => p.x - p.width / 2 > 0 && p.x + p.width / 2 < width! && p.y > 0 && p.y < height!,
      ),
    ).toBe(true);
    // The next layer sits above the previous one in each of the three stack columns.
    for (let i = 3; i < 48; i++) expect(points[i]!.y).toBeLessThan(points[i - 3]!.y);
    expect(points[4197]!.y).toBeLessThan(points[27]!.y - height! * 0.3);
    expect(points.every((p) => Math.abs(p.angle) <= 0.05)).toBe(true);
    expect(clothPiece(31n, width!, height!)).toEqual(points[31]);
  }
});

it('追加与缝制同一块布，只有实际增减范围进入动画；暂停对齐实际数量', () => {
  expect(clothChange('30', '31')).toMatchObject({ kind: 'supply', from: 30n, to: 31n, count: 1n });
  expect(clothChange('31', '30')).toMatchObject({ kind: 'sew', from: 30n, to: 31n, count: 1n });
  const { field, canvas, main } = fixture();
  field.update(30n, 'rose');
  field.update(31n, 'rose', { before: '30', after: '31', duration: 650 });
  expect(canvas.dataset.effectCount).toBe('1');
  expect(canvas.dataset.drawnEffectCount).toBe('1');
  vi.mocked(main.drawImage).mockClear();
  field.draw(main as unknown as CanvasRenderingContext2D, 30n, 'sew', 0.5);
  expect(main.drawImage).toHaveBeenCalledTimes(1);
  const piece = clothPiece(30n, 1080, 1920);
  expect(main.translate).toHaveBeenLastCalledWith(piece.x, piece.y);
  expect(main.rotate).toHaveBeenLastCalledWith(piece.angle);
  // The sheet stays in its stack, with its top half consumed downward and its bottom anchored.
  const crop = vi.mocked(main.drawImage).mock.calls[0]! as unknown as number[];
  expect(crop).toHaveLength(9);
  expect(crop[2]).toBe(48);
  expect(crop[4]).toBe(48);
  expect(crop[6]).toBe(0);
  expect(crop[8]).toBe(piece.height / 2);
  field.update(31n, 'rose', undefined, true);
  expect(canvas.dataset.effectCount).toBe('0');
  expect(canvas.dataset.renderedCount).toBe('31');
  field.dispose();
});

it('减量从最高一块逐层向下消耗，下层保持原位，结束后精确对齐数量', () => {
  const { field, canvas, main, callbacks } = fixture();
  field.update(30n, 'noir');
  field.update(20n, 'noir', { before: '30', after: '20', duration: 1000 });
  for (const [time, visible] of [
    [250, 28],
    [500, 25],
    [750, 23],
  ] as const) {
    vi.stubGlobal('performance', { now: () => time });
    vi.mocked(main.translate).mockClear();
    callbacks.at(-1)!(time);
    expect(canvas.dataset.visibleCount).toBe(String(visible));
    expect(main.translate).toHaveBeenCalledTimes(visible - 20);
    for (let i = 20; i < visible; i++) {
      const piece = clothPiece(BigInt(i), 1080, 1920);
      expect(main.translate).toHaveBeenNthCalledWith(i - 19, piece.x, piece.y);
    }
  }
  vi.stubGlobal('performance', { now: () => 1000 });
  callbacks.at(-1)!(1000);
  expect(canvas.dataset.renderedCount).toBe('20');
  expect(canvas.dataset.visibleCount).toBe('20');
  expect(canvas.dataset.effect).toBeUndefined();
  field.dispose();
});

it('极大点数分帧可取消，没有固定布料上限，也不会转成不精确数字', () => {
  const { field, canvas, base, callbacks } = fixture();
  field.update(0n, 'noir');
  let clock = 0;
  vi.stubGlobal('performance', { now: () => (clock += 8) });
  const huge = BigInt('9'.repeat(40));
  field.update(huge, 'noir');
  expect(canvas.dataset.targetCount).toBe(String(huge));
  expect(canvas.dataset.renderedCount).toBe('64');
  expect(callbacks).toHaveLength(1);
  field.update(0n, 'noir');
  vi.mocked(base.drawImage).mockClear();
  callbacks[0]!(0);
  expect(base.drawImage).not.toHaveBeenCalled();
  expect(canvas.dataset.renderedCount).toBe('0');
  field.dispose();
});

it('三种主题改色仍保持每点一块，继续运行和更换主题不重播旧进布', () => {
  const { field, canvas, base } = fixture();
  for (const theme of ['noir', 'chrome', 'rose']) {
    vi.mocked(base.drawImage).mockClear();
    field.update(4200n, theme);
    expect(base.drawImage).toHaveBeenCalledTimes(4200);
    expect(canvas.dataset.renderedCount).toBe('4200');
    expect(canvas.dataset.effect).toBeUndefined();
  }
  field.dispose();
});
