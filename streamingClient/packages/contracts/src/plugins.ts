import { z } from 'zod';
import type { SignedValue } from './index';
import { sceneSourceSchema } from './scenes';

export const pluginId = z.string().regex(/^plugin\.[a-z0-9][a-z0-9-]{0,47}$/);
export const packageVersion = z
  .string()
  .max(50)
  .regex(/^[0-9]+\.[0-9]+\.[0-9]+$/);
export const pluginPermission = z.enum(['storage', 'folders', 'external-links', 'scene-events']);
export type PluginPermission = z.infer<typeof pluginPermission>;
/** Retired first-party packages remain recoverable, but cannot be offered or executed. */
export const isRetiredPlugin = (id: string) => id === 'plugin.prank';
export const HOST_CAPABILITIES: Readonly<Record<string, number>> = Object.freeze({
  'scene.sources': 1,
  'scene.lifecycle': 1,
  'scene.events': 1,
  'scene.views': 1,
  'scene.duel': 1,
  'scene.audio': 1,
  'storage.migrations': 1,
});
export function pluginCompatible(
  manifest: Pick<PluginManifest, 'minAppVersion' | 'requiredCapabilities'>,
  appVersion: string,
) {
  return (
    compareVersions(appVersion, manifest.minAppVersion) >= 0 &&
    Object.entries(manifest.requiredCapabilities ?? {}).every(
      ([name, version]) => (HOST_CAPABILITIES[name] ?? 0) >= version,
    )
  );
}
const dataKey = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]{1,80}$/)
  .refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value));
export const pluginDataMigration = z
  .object({
    from: z.number().int().min(1),
    to: z.number().int().min(2),
    operations: z
      .array(
        z.discriminatedUnion('operation', [
          z.object({ operation: z.literal('rename'), key: dataKey, to: dataKey }).strict(),
          z.object({ operation: z.literal('default'), key: dataKey, value: z.json() }).strict(),
          z.object({ operation: z.literal('remove'), key: dataKey }).strict(),
        ]),
      )
      .max(100),
  })
  .strict()
  .refine((migration) => migration.to > migration.from);
export const pluginPermissions: Record<PluginPermission, { name: string; description: string }> = {
  storage: { name: '保存插件数据', description: '只读写此插件自己的本机设置与数据。' },
  folders: {
    name: '访问选定文件夹',
    description: '由你选择文件夹；可浏览图片、列出子目录及在系统中打开文件夹。',
  },
  'external-links': { name: '打开网站', description: '透过系统浏览器打开 HTTPS 网站。' },
  'scene-events': {
    name: '接收直播事件',
    description: '接收场景分派的礼物、消息与连接状态，不包含登录数据。',
  },
};
export const pluginManifestSchema = z
  .object({
    kind: z.literal('plugin'),
    apiVersion: z.literal(1),
    id: pluginId,
    version: packageVersion,
    minAppVersion: packageVersion,
    requiredCapabilities: z
      .record(z.string().regex(/^[a-z][a-zA-Z0-9.-]{0,79}$/), z.number().int().min(1).max(100))
      .optional(),
    dataVersion: z.number().int().min(1).max(10000).optional(),
    dataMigrations: z.array(pluginDataMigration).max(100).optional(),
    name: z.string().min(1).max(60),
    description: z.string().min(1).max(300),
    // Any developer can publish a local plugin.  The desktop app never treats
    // this field as a trust boundary; it is display metadata only.
    publisher: z.string().min(1).max(80),
    category: z.enum(['stream', 'assets', 'productivity', 'tools']),
    entry: z.literal('index.html'),
    workspace: z.boolean().optional(),
    sceneSources: z.array(sceneSourceSchema).max(16).optional(),
    permissions: z
      .array(pluginPermission)
      .max(4)
      .refine((p) => new Set(p).size === p.length, '权限不可重复'),
    files: z.record(
      z.string(),
      z
        .object({
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          bytes: z.number().int().min(0).max(10_000_000),
        })
        .strict(),
    ),
  })
  .strict()
  .refine(
    (manifest) =>
      (manifest.sceneSources ?? []).every(
        (source) =>
          !source.splitSources ||
          (new Set(source.splitSources.map((part) => part.sourceId)).size ===
            source.splitSources.length &&
            source.splitSources.every((part) =>
              manifest.sceneSources?.some(
                (s) =>
                  s.id === part.sourceId &&
                  !s.splitSources &&
                  !['instructions', 'status'].includes(s.kind ?? ''),
              ),
            )),
      ),
    '拆分来源声明无效',
  )
  .refine(
    (manifest) =>
      (manifest.sceneSources ?? []).every(
        (source) =>
          (!source.statusSourceId ||
            manifest.sceneSources?.some(
              (s) =>
                s.id === source.statusSourceId &&
                s.kind === 'status' &&
                s.targetSourceId === source.id,
            )) &&
          (source.kind !== 'status' ||
            manifest.sceneSources?.some(
              (s) =>
                s.id === source.targetSourceId &&
                !['instructions', 'status'].includes(s.kind ?? '') &&
                s.statusSourceId === source.id,
            )),
      ),
    '状态面板来源声明无效',
  )
  .refine(
    (manifest) =>
      (manifest.sceneSources ?? []).every(
        (source) =>
          source.kind !== 'view' ||
          manifest.sceneSources?.some(
            (target) =>
              target.id === source.targetSourceId &&
              !['instructions', 'status', 'view'].includes(target.kind ?? ''),
          ),
      ),
    '展示部件必须绑定同插件的内容来源',
  );
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export interface PluginCatalogItem {
  manifest: PluginManifest;
  sha256: string;
  bytes: number;
  signature: SignedValue;
  downloadPath: string;
}
export interface InstalledPlugin {
  item: PluginCatalogItem;
  enabled: boolean;
  installedAt: string;
}
export interface PluginListing {
  item: PluginCatalogItem;
  installed: InstalledPlugin | null;
  compatible: boolean;
  updateAvailable: boolean;
}
export interface PluginSnapshot {
  catalog: PluginListing[];
  installed: InstalledPlugin[];
  status: 'ready' | 'syncing' | 'offline';
  updatedAt: string | null;
  unavailable?: { id: string; name: string; version: string; reason: string }[];
  rollback?: Record<string, string>;
}
export const pluginCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }).strict(),
  z.object({ action: z.literal('openFolder') }).strict(),
  z
    .object({
      action: z.enum(['install', 'update']),
      id: pluginId,
      version: packageVersion,
      permissions: z.array(pluginPermission).max(4),
    })
    .strict(),
  z.object({ action: z.literal('enable'), id: pluginId, enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('remove'), id: pluginId }).strict(),
  z.object({ action: z.literal('rollback'), id: pluginId }).strict(),
]);
export type PluginCommand = z.infer<typeof pluginCommand>;
const key = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]{1,80}$/)
  .refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value), '数据键名称无效');
const relativePath = z.string().max(500);
export const pluginRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('info') }).strict(),
  z.object({ method: z.literal('storage.get'), key }).strict(),
  z.object({ method: z.literal('storage.set'), key, value: z.json() }).strict(),
  z.object({ method: z.literal('storage.remove'), key }).strict(),
  z.object({ method: z.literal('folders.choose') }).strict(),
  z
    .object({
      method: z.literal('folders.list'),
      id: z.string().uuid(),
      path: relativePath.default(''),
    })
    .strict(),
  z
    .object({
      method: z.literal('folders.open'),
      id: z.string().uuid(),
      path: relativePath.default(''),
    })
    .strict(),
  z.object({ method: z.literal('external.open'), url: z.url().max(2000) }).strict(),
]);
export type PluginRequest = z.infer<typeof pluginRequestSchema>;
export interface PluginFolder {
  id: string;
  name: string;
}
export interface PluginFolderEntry {
  name: string;
  path: string;
  directory: boolean;
  previewUrl?: string;
}
export const pluginDescriptorSchema = z
  .object({
    manifest: pluginManifestSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .positive()
      .max(30 * 1024 * 1024),
  })
  .strict();
export function compareVersions(a: string, b: string): number {
  const left = packageVersion.parse(a).split('.').map(BigInt),
    right = packageVersion.parse(b).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! > right[i]! ? 1 : -1;
  return 0;
}
