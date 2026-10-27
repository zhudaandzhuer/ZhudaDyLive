import { zipSync, unzipSync, strToU8 } from 'fflate';
import { sceneDocumentSchema, type SceneDocument } from '@zhuda/contracts';
import { SceneMedia } from './media';

const limit = 300 * 1024 * 1024;
function assets(document: SceneDocument) {
  return [
    ...new Set(
      document.layers.flatMap((layer) =>
        Object.values(layer.settings).flatMap((value) => {
          if (typeof value !== 'string' || !value.startsWith('zhuda-scene:')) return [];
          const match =
            /^zhuda-scene:\/\/media\/([a-f0-9]{64}\.(?:png|jpg|jpeg|webp|gif|mp4|webm))$/.exec(
              value,
            );
          if (!match) throw new Error('场景包含无效素材地址');
          return [match[1]!];
        }),
      ),
    ),
  ];
}
export function exportSceneArchive(document: SceneDocument, media: SceneMedia) {
  const files: Record<string, Uint8Array> = {
    'scene.json': strToU8(
      JSON.stringify({
        format: 'zhuda-scene',
        version: 1,
        document: sceneDocumentSchema.parse(document),
      }),
    ),
  };
  let size = files['scene.json']!.length;
  if (size > 1024 * 1024) throw new Error('场景配置超过 1 MB，请精简文字后导出');
  for (const name of assets(document)) {
    const bytes = media.exportAsset(name);
    size += bytes.length;
    if (size > limit) throw new Error('场景素材超过 300 MB，请精简后导出');
    files[`media/${name}`] = bytes;
  }
  if (Object.keys(files).length > 256) throw new Error('场景素材超过 255 个，请精简后导出');
  return zipSync(files, { level: 0 });
}
export function importSceneArchive(bytes: Uint8Array, media: SceneMedia) {
  if (bytes.length > limit + 1024 * 1024) throw new Error('场景包超过 300 MB');
  let expanded = 0,
    count = 0;
  const names = new Set<string>();
  const files = unzipSync(bytes, {
    filter(file) {
      count++;
      expanded += file.originalSize;
      if (
        count > 256 ||
        expanded > limit ||
        names.has(file.name) ||
        (file.name !== 'scene.json' &&
          !/^media\/[a-f0-9]{64}\.(png|jpg|jpeg|webp|gif|mp4|webm)$/.test(file.name)) ||
        (file.name === 'scene.json' && file.originalSize > 1024 * 1024)
      )
        throw new Error('场景包包含无效文件或超过大小限制');
      names.add(file.name);
      return true;
    },
  });
  if (!files['scene.json']) throw new Error('场景包缺少配置');
  const manifest = JSON.parse(Buffer.from(files['scene.json']).toString('utf8'));
  if (manifest.format !== 'zhuda-scene' || manifest.version !== 1)
    throw new Error('场景包格式不兼容');
  const document = sceneDocumentSchema.parse(manifest.document);
  const required = assets(document);
  if (required.length + 1 !== Object.keys(files).length) throw new Error('场景包素材清单不匹配');
  for (const name of required) {
    const asset = files[`media/${name}`];
    if (!asset) throw new Error('场景包缺少素材');
    // Content addressed writes cannot overwrite another valid asset or run any plugin code.
    media.importAsset(name, Buffer.from(asset));
  }
  return document;
}
