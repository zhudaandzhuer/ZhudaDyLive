import { it, expect } from 'vitest';
import {
  layerViewport,
  resizeLayerSize,
  scaleLayerSize,
} from '../client/src/renderer/layer-sizing';

it('等比缩小保留来源布局尺寸，文字与图标使用同一缩放比例', () => {
  const contentSize = { width: 900, height: 640 };
  expect(layerViewport({ width: 450, height: 320, contentSize })).toEqual({
    width: 900,
    height: 640,
    scale: 0.5,
  });
  expect(layerViewport({ width: 450, height: 100, contentSize })).toEqual({
    width: 900,
    height: 640,
    scale: 0.15625,
  });
  expect(layerViewport({ width: 450, height: 320, contentSize: null })).toEqual({
    width: 450,
    height: 320,
    scale: 1,
  });
});
it('拖动缩放保持比例，极端拖动不会产生超界尺寸；布局模式仍可独立调整宽高', () => {
  const layer = { width: 900, height: 640, contentSize: { width: 900, height: 640 } };
  expect(resizeLayerSize(layer, -450, -320)).toEqual({ width: 450, height: 320 });
  expect(resizeLayerSize({ ...layer, contentSize: null }, -450, -100)).toEqual({
    width: 450,
    height: 540,
  });
  for (const delta of [-100_000, 100_000]) {
    const result = resizeLayerSize(layer, delta, delta);
    expect(result.width / result.height).toBeCloseTo(900 / 640);
    expect(Math.min(result.width, result.height)).toBeGreaterThanOrEqual(16);
    expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(8192);
  }
  expect(scaleLayerSize(layer, 0.25)).toEqual({ width: 225, height: 160 });
});
