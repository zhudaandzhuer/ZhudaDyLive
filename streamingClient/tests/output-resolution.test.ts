import { expect, it } from 'vitest';
import { sceneOutputGeometry } from '../client/src/main/scenes/output-resolution';

it('直横版输出在常见系统缩放下始终保留场景像素，不受屏幕可用空间影响', () => {
  for (const scene of [
    { width: 1080, height: 1920 },
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
    { width: 1001, height: 777 },
  ]) {
    for (const density of [1, 1.25, 1.5, 1.75, 2, 3]) {
      const output = sceneOutputGeometry(scene, density);
      for (const axis of ['width', 'height'] as const) {
        const physical = output[axis] * density;
        expect(physical).toBeGreaterThanOrEqual(scene[axis]);
        expect(physical - scene[axis]).toBeLessThan(density);
        expect(output[axis] / output.zoomFactor).toBeGreaterThanOrEqual(scene[axis]);
      }
      expect(density * output.zoomFactor).toBe(1);
    }
  }
});
