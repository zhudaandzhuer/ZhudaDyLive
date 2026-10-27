import { expect, it } from 'vitest';
import { systemText } from '@zhuda/contracts';
import { verifyPlugin } from '@zhuda/core';
import { pluginPack } from './plugin-fixtures';
import { publicKey } from './fixtures';

it('旧版签章包仍可验证，只在显示官方信息时转换为简体', () => {
  const publisher = '\u8c6c\u5927\u5b98\u65b9';
  const { item } = pluginPack({ publisher });
  const verified = verifyPlugin(item, publicKey);
  expect(verified.manifest.publisher).toBe(publisher);
  expect(systemText(verified.manifest.publisher)).toBe('猪大官方');
  expect(verified.signature).toEqual(item.signature);
  expect(systemText('文件夹、图片、视频、场景测试')).toBe('文件夹、图片、视频、场景测试');
});
