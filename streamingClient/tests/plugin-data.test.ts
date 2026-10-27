import { expect, it } from 'vitest';
import { migratePluginData } from '@zhuda/core';
import { pluginCompatible } from '@zhuda/contracts';
import { pluginPack } from './plugin-fixtures';
it('插件数据逐版本迁移，失败不改写原数据，新值不会覆盖用户配置', () => {
  const source = { title: '用户标题', volume: 22 };
  const manifest = pluginPack({
    dataVersion: 3,
    dataMigrations: [
      {
        from: 1,
        to: 2,
        operations: [
          { operation: 'rename', key: 'title', to: 'heading' },
          { operation: 'default', key: 'volume', value: 60 },
        ],
      },
      { from: 2, to: 3, operations: [{ operation: 'default', key: 'sound', value: true }] },
    ],
  }).item.manifest;
  expect(migratePluginData(source, 1, manifest)).toEqual({
    heading: '用户标题',
    volume: 22,
    sound: true,
  });
  expect(source).toEqual({ title: '用户标题', volume: 22 });
  expect(() => migratePluginData({ ...source, heading: '冲突' }, 1, manifest)).toThrow(/冲突/);
  expect(() => migratePluginData(source, 1, { ...manifest, dataMigrations: [] })).toThrow(/缺少/);
  expect(() => migratePluginData(source, 4, manifest)).toThrow(/降级/);
});
it('插件声明的能力版本必须由宿主支持', () => {
  const manifest = pluginPack({ requiredCapabilities: { 'scene.events': 1 } }).item.manifest;
  expect(pluginCompatible(manifest, '0.2.0')).toBe(true);
  expect(
    pluginCompatible({ ...manifest, requiredCapabilities: { 'scene.events': 2 } }, '0.2.0'),
  ).toBe(false);
  expect(
    pluginCompatible({ ...manifest, requiredCapabilities: { 'future.feature': 1 } }, '9.0.0'),
  ).toBe(false);
});
