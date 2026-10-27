import { unzipSync } from 'fflate';
import { z } from 'zod';
import { join, dirname, resolve, sep } from 'node:path';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  renameSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { manifestSchema, type CatalogItem, type GameManifest } from '@zhuda/contracts';
import { sha256, verifyValue } from './crypto';

const descriptor = z
  .object({
    manifest: manifestSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .positive()
      .max(30 * 1024 * 1024),
  })
  .strict();
export function safeAssetPath(name: string): boolean {
  return (
    name.length < 200 &&
    /^[a-zA-Z0-9_./-]+\.(html|js|css|json|png|jpg|jpeg|webp|svg|woff2|mp3|wav|mp4|webm)$/.test(
      name,
    ) &&
    !name.startsWith('/') &&
    name.split('/').every((p) => p !== '..' && p !== '.' && p !== '' && p !== '__proto__')
  );
}
export function verifyCatalog(item: CatalogItem, publicKey: string): CatalogItem {
  const trusted = descriptor.parse(verifyValue(item.signature, publicKey));
  if (
    JSON.stringify(trusted.manifest) !== JSON.stringify(manifestSchema.parse(item.manifest)) ||
    trusted.sha256 !== item.sha256 ||
    trusted.bytes !== item.bytes
  )
    throw new Error('游戏目录与官方签章不符');
  const downloadPath = `/api/v1/packages/${trusted.manifest.id}/${trusted.manifest.version}`;
  if (item.downloadPath !== downloadPath) throw new Error('游戏下载位置无效');
  return { ...trusted, signature: item.signature, downloadPath };
}
export function inspectPackage(
  bytes: Uint8Array,
  item: CatalogItem,
  publicKey: string,
): { manifest: GameManifest; files: Record<string, Uint8Array> } {
  const trusted = verifyCatalog(item, publicKey);
  if (bytes.byteLength !== trusted.bytes || sha256(bytes) !== trusted.sha256)
    throw new Error('游戏包哈希验证失败');
  let expanded = 0,
    entries = 0;
  const names = new Set<string>();
  const files = unzipSync(bytes, {
    filter(file) {
      entries++;
      expanded += file.originalSize;
      if (
        entries > 500 ||
        expanded > 100 * 1024 * 1024 ||
        file.originalSize > 10_000_000 ||
        names.has(file.name) ||
        !safeAssetPath(file.name)
      )
        throw new Error('游戏包包含无效路径或超过大小限制');
      names.add(file.name);
      return true;
    },
  });
  const expected = trusted.manifest.files;
  if (
    Object.keys(files).length !== Object.keys(expected).length ||
    !Object.hasOwn(expected, trusted.manifest.entry)
  )
    throw new Error('游戏包文件清单不完整');
  for (const [name, file] of Object.entries(files)) {
    const record = Object.hasOwn(expected, name) ? expected[name] : undefined;
    if (
      !safeAssetPath(name) ||
      !record ||
      file.byteLength !== record.bytes ||
      sha256(file) !== record.sha256
    )
      throw new Error('游戏包文件验证失败');
  }
  return { manifest: trusted.manifest, files };
}
export function installPackage(
  root: string,
  bytes: Uint8Array,
  item: CatalogItem,
  publicKey: string,
): string {
  const { manifest, files } = inspectPackage(bytes, item, publicKey);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const destination = join(root, manifest.id, manifest.version);
  if (existsSync(destination)) {
    verifyInstalled(destination, item, publicKey);
    return destination;
  }
  const stage = mkdtempSync(join(root, '.install-'));
  try {
    for (const [name, file] of Object.entries(files)) {
      const path = join(stage, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file);
    }
    writeFileSync(join(stage, '.receipt.json'), JSON.stringify(item));
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(stage, destination);
    return destination;
  } finally {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
  }
}
export function verifyInstalled(directory: string, item: CatalogItem, publicKey: string): void {
  const { manifest } = verifyCatalog(item, publicKey);
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!safeAssetPath(name)) throw new Error('安装文件路径无效');
    const path = resolve(directory, name);
    if (!path.startsWith(resolve(directory) + sep)) throw new Error('安装文件路径无效');
    const content = readFileSync(path);
    if (content.length !== expected.bytes || sha256(content) !== expected.sha256)
      throw new Error('游戏文件已变更，请重新下载');
  }
}
