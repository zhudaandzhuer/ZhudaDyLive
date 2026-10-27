import { expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import type { SceneDocument } from '@zhuda/contracts';
import { SceneMedia } from '../client/src/main/scenes/media';
import { exportSceneArchive, importSceneArchive } from '../client/src/main/scenes/archive';
it('场景包携带素材和固定插件版本，跨素材库恢复，缺件和路径穿越被拒绝', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhuda-scene-archive-'));
  try {
    const media = new SceneMedia(join(dir, 'a')),
      other = new SceneMedia(join(dir, 'b'));
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB6kAAAAASUVORK5CYII=',
      'base64',
    );
    writeFileSync(join(dir, 'a.png'), png);
    const file = media.import(join(dir, 'a.png'), 'image');
    const document: SceneDocument = {
      schemaVersion: 1,
      id: randomUUID(),
      name: '场景',
      width: 1080,
      height: 1920,
      background: 'transparent',
      revision: 1,
      updatedAt: '',
      layers: [
        {
          id: randomUUID(),
          pluginId: 'plugin.scene-basics',
          pluginVersion: '1.2.2',
          sourceId: 'image',
          name: '图片',
          x: 0,
          y: 0,
          width: 400,
          height: 300,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          settings: { file },
          theme: 'default',
          rules: [],
        },
      ],
    };
    const archive = exportSceneArchive(document, media);
    expect(importSceneArchive(archive, other)).toEqual(document);
    expect(Buffer.from(await other.serve(new Request(file)).arrayBuffer())).toEqual(png);
    const files = unzipSync(archive);
    const asset = Object.keys(files).find((k) => k.startsWith('media/'))!;
    expect(() =>
      importSceneArchive(zipSync({ 'scene.json': files['scene.json']! }), other),
    ).toThrow(/清单|缺少/);
    expect(() =>
      importSceneArchive(zipSync({ ...files, [asset]: strToU8('tampered') }), other),
    ).toThrow(/校验/);
    expect(() =>
      importSceneArchive(zipSync({ ...files, '../escape': strToU8('bad') }), other),
    ).toThrow(/无效/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
