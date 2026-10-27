import { unzipSync } from 'fflate';
import { join, dirname, resolve, sep } from 'node:path';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
} from 'node:fs';
import {
  pluginManifestSchema,
  validateGameRules,
  validateSceneSettings,
  pluginDescriptorSchema,
  type PluginCatalogItem,
} from '@zhuda/contracts';
import { sha256, signValue, verifyValue } from './crypto';
import { safeAssetPath } from './packages';

export function pluginArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (!bytes.length || bytes.length > 30 * 1024 * 1024) throw new Error('插件 ZIP 大小超出限制');
  let expanded = 0,
    entries = 0;
  const names = new Set<string>();
  return unzipSync(bytes, {
    filter(file) {
      expanded += file.originalSize;
      entries++;
      if (
        entries > 500 ||
        expanded > 100 * 1024 * 1024 ||
        file.originalSize > 10_000_000 ||
        names.has(file.name) ||
        !safeAssetPath(file.name)
      )
        throw new Error('插件包含无效路径、重复文件或超出大小限制');
      names.add(file.name);
      return true;
    },
  });
}
export function signPluginUpload(bytes: Uint8Array, privateKey: string): PluginCatalogItem {
  const files = pluginArchive(bytes);
  if (!files['plugin.json'] || !files['index.html'])
    throw new Error('插件须包含 plugin.json 与 index.html');
  const source = JSON.parse(Buffer.from(files['plugin.json']).toString('utf8'));
  const manifest = pluginManifestSchema.parse({
    ...source,
    files: Object.fromEntries(
      Object.entries(files).map(([name, file]) => [
        name,
        { sha256: sha256(file), bytes: file.length },
      ]),
    ),
  });
  validateContributions(manifest);
  const descriptor = { manifest, sha256: sha256(bytes), bytes: bytes.length };
  return {
    ...descriptor,
    signature: signValue(descriptor, privateKey),
    downloadPath: `/api/v1/plugins/${manifest.id}/${manifest.version}/download`,
  };
}

/**
 * Read a plugin dropped into the local plugin inbox.
 *
 * Local packages deliberately have no publisher signature.  The archive is
 * still bounded, every file is hashed, paths are validated and the manifest is
 * checked before it can be loaded by the renderer.  The descriptor shape is
 * shared with the legacy catalog so existing scene records remain readable.
 */
export function describeLocalPlugin(bytes: Uint8Array): PluginCatalogItem {
  const files = pluginArchive(bytes);
  if (!files['plugin.json'] || !files['index.html'])
    throw new Error('插件须包含 plugin.json 与 index.html');
  const source = JSON.parse(Buffer.from(files['plugin.json']).toString('utf8')) as unknown;
  const manifest = pluginManifestSchema.parse({
    ...(source as object),
    files: Object.fromEntries(
      Object.entries(files).map(([name, file]) => [
        name,
        { sha256: sha256(file), bytes: file.length },
      ]),
    ),
  });
  validateContributions(manifest);
  const descriptor = { manifest, sha256: sha256(bytes), bytes: bytes.length };
  return {
    ...descriptor,
    // A local descriptor is intentionally self-contained and never sent to a
    // server. These sentinel values make the legacy type interoperable.
    signature: { payload: 'local', signature: 'local' },
    downloadPath: `local://${manifest.id}/${manifest.version}`,
  };
}

export function inspectLocalPlugin(bytes: Uint8Array, item: PluginCatalogItem) {
  const described = describeLocalPlugin(bytes);
  if (
    described.manifest.id !== item.manifest.id ||
    described.manifest.version !== item.manifest.version ||
    described.sha256 !== item.sha256 ||
    described.bytes !== item.bytes
  )
    throw new Error('插件描述与 ZIP 不符');
  return { ...described, files: pluginArchive(bytes) };
}

export function installLocalPlugin(root: string, bytes: Uint8Array, item: PluginCatalogItem) {
  const { files } = inspectLocalPlugin(bytes, item);
  const destination = join(root, item.manifest.id, item.manifest.version);
  if (existsSync(destination)) {
    verifyInstalledLocalPlugin(destination, item);
    return destination;
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(root, '.install-'));
  try {
    for (const [name, file] of Object.entries(files)) {
      const path = join(staging, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file);
    }
    writeFileSync(join(staging, '.receipt.json'), JSON.stringify(item));
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(staging, destination);
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
  return destination;
}

export function verifyInstalledLocalPlugin(directory: string, item: PluginCatalogItem) {
  for (const [name, record] of Object.entries(item.manifest.files)) {
    if (!safeAssetPath(name)) throw new Error('插件资产路径无效');
    const path = resolve(directory, name);
    if (!path.startsWith(resolve(directory) + sep)) throw new Error('插件资产路径无效');
    const file = readFileSync(path);
    if (file.length !== record.bytes || sha256(file) !== record.sha256)
      throw new Error('插件资产已变更，请重新安装');
  }
  return item;
}
export function verifyPlugin(item: PluginCatalogItem, publicKey: string): PluginCatalogItem {
  const trusted = pluginDescriptorSchema.parse(verifyValue(item.signature, publicKey));
  if (
    JSON.stringify(trusted.manifest) !==
      JSON.stringify(pluginManifestSchema.parse(item.manifest)) ||
    trusted.sha256 !== item.sha256 ||
    trusted.bytes !== item.bytes
  )
    throw new Error('插件目录与官方签章不符');
  const downloadPath = `/api/v1/plugins/${trusted.manifest.id}/${trusted.manifest.version}/download`;
  validateContributions(trusted.manifest);
  if (item.downloadPath !== downloadPath) throw new Error('插件下载位置无效');
  return { ...trusted, signature: item.signature, downloadPath };
}
export function inspectPlugin(bytes: Uint8Array, item: PluginCatalogItem, publicKey: string) {
  const trusted = verifyPlugin(item, publicKey);
  if (bytes.length !== trusted.bytes || sha256(bytes) !== trusted.sha256)
    throw new Error('插件 ZIP 验证失败');
  const files = pluginArchive(bytes),
    expected = trusted.manifest.files;
  if (
    Object.keys(files).length !== Object.keys(expected).length ||
    !Object.hasOwn(expected, trusted.manifest.entry)
  )
    throw new Error('插件文件清单不完整');
  for (const [name, file] of Object.entries(files)) {
    const record = Object.hasOwn(expected, name) ? expected[name] : undefined;
    if (!record || record.bytes !== file.length || record.sha256 !== sha256(file))
      throw new Error('插件文件验证失败');
  }
  return { ...trusted, files };
}
export function verifyInstalledPlugin(
  directory: string,
  item: PluginCatalogItem,
  publicKey: string,
) {
  const trusted = verifyPlugin(item, publicKey);
  for (const [name, record] of Object.entries(trusted.manifest.files)) {
    if (!safeAssetPath(name)) throw new Error('插件资产路径无效');
    const path = resolve(directory, name);
    if (!path.startsWith(resolve(directory) + sep)) throw new Error('插件资产路径无效');
    const file = readFileSync(path);
    if (file.length !== record.bytes || sha256(file) !== record.sha256)
      throw new Error('插件资产已变更，请重新安装');
  }
  return trusted;
}
export function installPlugin(
  root: string,
  bytes: Uint8Array,
  item: PluginCatalogItem,
  publicKey: string,
) {
  const { files } = inspectPlugin(bytes, item, publicKey),
    destination = join(root, item.manifest.id, item.manifest.version);
  if (existsSync(destination)) {
    verifyInstalledPlugin(destination, item, publicKey);
    return destination;
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(root, '.install-'));
  try {
    for (const [name, file] of Object.entries(files)) {
      const path = join(staging, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file);
    }
    writeFileSync(join(staging, '.receipt.json'), JSON.stringify(item));
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(staging, destination);
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
  return destination;
}

function validateContributions(manifest: import('@zhuda/contracts').PluginManifest) {
  const sources = manifest.sceneSources ?? [];
  if (new Set(sources.map((s) => s.id)).size !== sources.length)
    throw new Error('场景来源 ID 重复');
  for (const source of sources) {
    if (!safeAssetPath(source.entry) || !Object.hasOwn(manifest.files, source.entry))
      throw new Error('找不到场景来源入口');
    if (
      (source.events.length || source.observations?.length) &&
      !manifest.permissions.includes('scene-events')
    )
      throw new Error('交互来源需要直播事件权限');
    if (source.themes.length && !source.themes.some((t) => t.id === source.defaultTheme))
      throw new Error('场景来源预设主题无效');
    if (
      source.kind === 'instructions' &&
      (source.events.length ||
        source.rules.length ||
        source.counter ||
        (source.runtime && source.runtime !== 'static'))
    )
      throw new Error('玩法说明来源必须为静态展示');
    if (
      source.instructionSourceId &&
      (!source.events.length ||
        source.kind === 'instructions' ||
        !sources.some((s) => s.id === source.instructionSourceId && s.kind === 'instructions'))
    )
      throw new Error('玩法说明来源声明无效');
    validateGameRules(source.events, source.rules);
    validateSceneSettings(source, {});
  }
}
