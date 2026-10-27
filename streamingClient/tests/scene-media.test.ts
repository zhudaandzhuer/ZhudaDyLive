import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SceneMedia } from '../client/src/main/scenes/media';
import { pluginPack } from './plugin-fixtures';
import { sceneSourceSchema, validateSceneSettings } from '@zhuda/contracts';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB6kAAAAASUVORK5CYII=',
  'base64',
);
const source = sceneSourceSchema.parse({
  id: 'picture',
  name: '图',
  description: 'test',
  entry: 'index.html',
  width: 200,
  height: 200,
  parameters: [{ key: 'file', label: '图片', type: 'image', default: '' }],
  events: [],
  rules: [],
  themes: [],
});
describe('场景素材与来源边界', () => {
  it('导入后拷贝到项目、以 hash 寻址，原档删除仍可读取', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zhuda-media-'));
    try {
      const media = new SceneMedia(join(dir, 'assets')),
        path = join(dir, 'picture.png');
      writeFileSync(path, png);
      const url = media.import(path, 'image');
      rmSync(path);
      expect(url).toMatch(/^zhuda-scene:\/\/media\/[a-f0-9]{64}\.png$/);
      expect(validateSceneSettings(source, { file: url }).file).toBe(url);
      const response = media.serve(new Request(url));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
      const again = media.serve(new Request(url, { headers: { Range: 'bytes=1-4' } }));
      expect(again.status).toBe(206);
      expect(again.headers.get('content-range')).toBe(`bytes 1-4/${png.length}`);
      expect(Buffer.from(await again.arrayBuffer())).toEqual(png.subarray(1, 5));
      expect(media.serve(new Request(url, { headers: { Range: 'bytes=99999-' } })).status).toBe(
        416,
      );
      writeFileSync(join(dir, 'assets', url.split('/').at(-1)!), Buffer.from('tampered'));
      expect(media.serve(new Request(url)).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('拒绝外部网址、绝对路径、伪装文件与错误素材类型', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zhuda-media-'));
    try {
      const media = new SceneMedia(join(dir, 'assets')),
        path = join(dir, 'picture.png');
      writeFileSync(path, '<script>bad</script>');
      expect(() => media.import(path, 'image')).toThrow('内容');
      writeFileSync(path, png);
      expect(() => media.import(path, 'video')).toThrow('格式');
      for (const file of [
        'file:///etc/passwd',
        'https://example.com/a.png',
        'zhuda-scene://media/../secret',
        'javascript:alert(1)',
      ])
        expect(() => validateSceneSettings(source, { file })).toThrow('本机素材');
      expect(media.serve(new Request('zhuda-scene://other/a.png')).status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('官方签章前验证场景入口、唯一 ID 与事件权限', () => {
    expect(() => pluginPack({ sceneSources: [{ ...source, entry: 'missing.html' }] })).toThrow(
      '入口',
    );
    expect(() => pluginPack({ sceneSources: [source, source] })).toThrow('重复');
    expect(() =>
      pluginPack({
        sceneSources: [
          {
            ...source,
            parameters: [
              { key: 'file', label: '图', type: 'image', default: 'https://example.com/image.png' },
            ],
          },
        ],
      }),
    ).toThrow('本机');
    expect(() =>
      pluginPack({
        sceneSources: [
          {
            ...source,
            events: [
              {
                id: 'show',
                label: '显示',
                description: 'test',
                operation: 'effect',
                min: 1,
                max: 1,
                default: 1,
                amountLabel: '次',
                unit: '次',
              },
            ],
          },
        ],
      }),
    ).toThrow('权限');
  });
});
