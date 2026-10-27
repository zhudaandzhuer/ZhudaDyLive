import { dialog, shell, type BrowserWindow } from 'electron';
import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  rmSync,
  mkdirSync,
  watch,
  type FSWatcher,
} from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  APP_VERSION,
  compareVersions,
  pluginCompatible,
  isRetiredPlugin,
  HOST_CAPABILITIES,
  pluginId,
  pluginRequestSchema,
  type PluginCatalogItem,
  type InstalledPlugin,
  type PluginSnapshot,
  type PluginCommand,
  type PluginPermission,
  type PluginFolder,
} from '@zhuda/contracts';
import {
  LocalStore,
  safeAssetPath,
  sha256,
  migratePluginData,
  describeLocalPlugin,
  inspectLocalPlugin,
  installLocalPlugin,
  verifyInstalledLocalPlugin,
} from '@zhuda/core';

const images: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};
const assetTypes: Record<string, string> = {
  ...images,
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};
export class PluginManager {
  // Retired packages remain on disk for recovery but are no longer offered or executable.
  private retired(id: string) {
    return isRetiredPlugin(id);
  }
  private bundled = new Map<string, { item: PluginCatalogItem; bytes: Uint8Array }>();
  private localArchives = new Map<string, Uint8Array>();
  private inboxWatcher: FSWatcher | null = null;
  private readonly localMode = true;
  sceneVersionAllowed: (id: string, version: string) => boolean = () => false;
  private catalog: PluginCatalogItem[] = [];
  private installs: Record<string, InstalledPlugin> = {};
  private status: PluginSnapshot['status'] = 'offline';
  private updatedAt: string | null = null;
  private unavailable: NonNullable<PluginSnapshot['unavailable']> = [];
  private syncing: Promise<void> | null = null;
  private notify: () => void;
  private owner: () => BrowserWindow | null;
  /** The inbox is the only plugin source. ZIP files are installed locally. */
  constructor(
    private store: LocalStore,
    readonly root: string,
    ...args: unknown[]
  ) {
    const functions = args.filter(
      (value): value is (...args: never[]) => unknown => typeof value === 'function',
    );
    this.notify = (functions.at(-2) as (() => void) | undefined) ?? (() => {});
    this.owner = (functions.at(-1) as (() => BrowserWindow | null) | undefined) ?? (() => null);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    mkdirSync(this.inboxRoot(), { recursive: true, mode: 0o700 });
    for (const [id, entry] of Object.entries(
      store.get<Record<string, InstalledPlugin>>('plugin-installed', {}),
    )) {
      try {
        const item = this.verifyDescriptor(entry.item);
        if (id !== item.manifest.id) continue;
        this.installs[id] = { ...entry, item, enabled: entry.enabled === true };
      } catch {
        /* Ignore invalid metadata; never execute it. */
      }
    }
    this.scanLocal();
    this.inboxWatcher = watch(this.inboxRoot(), () => {
      setTimeout(() => this.scanLocal(), 50);
    });
  }
  private inboxRoot() {
    return join(this.root, 'inbox');
  }
  /** Directory shown in the UI for dropping plugin ZIP files. */
  openInbox() {
    const error = shell.openPath(this.inboxRoot());
    void error;
  }
  dispose() {
    this.inboxWatcher?.close();
    this.inboxWatcher = null;
  }
  private verifyDescriptor(item: PluginCatalogItem) {
    return {
      ...item,
      signature: { payload: 'local', signature: 'local' },
      downloadPath: `local://${item.manifest.id}/${item.manifest.version}`,
    };
  }
  private verifyInstalled(directory: string, item: PluginCatalogItem) {
    return verifyInstalledLocalPlugin(directory, item);
  }
  private install(root: string, bytes: Uint8Array, item: PluginCatalogItem) {
    return installLocalPlugin(root, bytes, item);
  }
  snapshot(): PluginSnapshot {
    return {
      status: this.status,
      updatedAt: this.updatedAt,
      unavailable: this.unavailable.filter((entry) => !this.retired(entry.id)),
      rollback: Object.fromEntries(
        Object.keys(this.installs).flatMap((id) => {
          const old = this.store.get<{ entry: InstalledPlugin } | null>(
            `plugin-rollback:${id}`,
            null,
          );
          return old ? [[id, old.entry.item.manifest.version]] : [];
        }),
      ),
      installed: Object.values(this.installs)
        .filter((entry) => !this.retired(entry.item.manifest.id))
        .map((entry) => ({ ...entry })),
      catalog: this.catalog
        .filter((item) => !this.retired(item.manifest.id))
        .map((item) => ({
          item,
          installed: this.installs[item.manifest.id] ?? null,
          compatible: pluginCompatible(item.manifest, APP_VERSION),
          updateAvailable:
            !!this.installs[item.manifest.id] &&
            compareVersions(
              item.manifest.version,
              this.installs[item.manifest.id]!.item.manifest.version,
            ) > 0,
        })),
    };
  }
  /** Scan the inbox and install the newest ZIP for each plugin automatically. */
  scanLocal() {
    mkdirSync(this.inboxRoot(), { recursive: true, mode: 0o700 });
    const found: PluginCatalogItem[] = [];
    this.unavailable = [];
    let changed = false;
    for (const name of readdirSync(this.inboxRoot(), { withFileTypes: true })) {
      if (!name.isFile() || extname(name.name).toLowerCase() !== '.zip') continue;
      const file = join(this.inboxRoot(), name.name);
      try {
        const bytes = readFileSync(file);
        const item = describeLocalPlugin(bytes);
        const key = `${item.manifest.id}:${item.manifest.version}`;
        this.localArchives.set(key, bytes);
        found.push(item);
        const previous = this.installs[item.manifest.id];
        if (
          !previous ||
          compareVersions(item.manifest.version, previous.item.manifest.version) > 0
        ) {
          const data = this.store.get<Record<string, unknown>>(
            `plugin-data:${item.manifest.id}`,
            {},
          );
          const dataVersion = this.store.get<number>(
            `plugin-data-version:${item.manifest.id}`,
            previous?.item.manifest.dataVersion ??
              (Object.keys(data).length ? 1 : (item.manifest.dataVersion ?? 1)),
          );
          const migrated = migratePluginData(data, dataVersion, item.manifest);
          this.install(this.root, bytes, item);
          const installs = {
            ...this.installs,
            [item.manifest.id]: {
              item,
              enabled: previous?.enabled ?? true,
              installedAt: new Date().toISOString(),
            },
          };
          this.store.transaction(() => {
            if (previous)
              this.store.set(`plugin-rollback:${item.manifest.id}`, {
                entry: previous,
                data,
                dataVersion,
              });
            this.store.set(`plugin-data:${item.manifest.id}`, migrated);
            this.store.set(
              `plugin-data-version:${item.manifest.id}`,
              item.manifest.dataVersion ?? 1,
            );
            this.store.set('plugin-installed', installs);
          });
          this.installs = installs;
          changed = true;
        }
      } catch (error) {
        this.unavailable.push({
          id: `local-${name.name}`,
          name: name.name,
          version: '',
          reason: error instanceof Error ? error.message : '插件 ZIP 无法读取',
        });
      }
    }
    const byId = new Map<string, PluginCatalogItem>();
    for (const item of [...this.catalog, ...found]) {
      const current = byId.get(item.manifest.id);
      if (!current || compareVersions(item.manifest.version, current.manifest.version) > 0)
        byId.set(item.manifest.id, item);
    }
    this.catalog = [...byId.values()];
    this.updatedAt = new Date().toISOString();
    this.status = 'ready';
    this.save();
    if (changed || found.length) this.notify();
  }
  useBundled(entries: { item: PluginCatalogItem; bytes: Uint8Array }[]) {
    const seen = this.store.get<Record<string, boolean>>('plugin-bundled-seen', {});
    for (const { item: raw, bytes } of entries) {
      // Bundled packages use the same local ZIP path as user supplied plugins.
      const item = describeLocalPlugin(bytes);
      if (this.retired(item.manifest.id)) continue;
      this.bundled.set(`${item.manifest.id}:${item.manifest.version}`, { item, bytes });
      const previous = this.installs[item.manifest.id];
      // App upgrades carry local ZIP updates too; never downgrade a newer inbox version.
      if (
        (!previous && !seen[item.manifest.id]) ||
        (previous && compareVersions(item.manifest.version, previous.item.manifest.version) > 0)
      ) {
        const data = this.store.get<Record<string, unknown>>(`plugin-data:${item.manifest.id}`, {});
        const dataVersion = this.store.get<number>(
          `plugin-data-version:${item.manifest.id}`,
          Object.keys(data).length ? 1 : (item.manifest.dataVersion ?? 1),
        );
        const migrated = migratePluginData(data, dataVersion, item.manifest);
        this.install(this.root, bytes, item);
        const installs = {
          ...this.installs,
          [item.manifest.id]: {
            item,
            enabled: previous?.enabled ?? true,
            installedAt: new Date().toISOString(),
          },
        };
        this.store.transaction(() => {
          if (previous)
            this.store.set(`plugin-rollback:${item.manifest.id}`, {
              entry: previous,
              data,
              dataVersion,
            });
          this.store.set(`plugin-data:${item.manifest.id}`, migrated);
          this.store.set(`plugin-data-version:${item.manifest.id}`, item.manifest.dataVersion ?? 1);
          this.store.set('plugin-installed', installs);
        });
        this.installs = installs;
      }
      seen[item.manifest.id] = true;
    }
    this.store.set('plugin-bundled-seen', seen);
    this.mergeBundled();
    this.save();
  }
  private mergeBundled() {
    for (const { item } of this.bundled.values()) {
      const prior = this.catalog.find((p) => p.manifest.id === item.manifest.id);
      if (!prior) this.catalog.push(item);
      else if (compareVersions(item.manifest.version, prior.manifest.version) > 0)
        this.catalog = this.catalog.map((p) => (p === prior ? item : p));
    }
  }
  installedItem(id: string, version?: string): PluginCatalogItem {
    if (this.retired(id)) throw new Error('此插件已下架');
    const entry = this.installs[pluginId.parse(id)];
    if (!entry?.enabled) throw new Error('插件未安装或已禁用');
    if (!version || entry.item.manifest.version === version) return entry.item;
    if (!this.sceneVersionAllowed(id, version)) throw new Error('场景版本不可用');
    const receipt = this.verifyDescriptor(
      JSON.parse(readFileSync(join(this.root, id, version, '.receipt.json'), 'utf8')),
    );
    if (receipt.manifest.id !== id || receipt.manifest.version !== version)
      throw new Error('插件版本验证失败');
    return receipt;
  }
  validateInstalled(id: string, version: string) {
    const item = this.installedItem(id, version);
    this.verifyInstalled(join(this.root, id, version), item);
    return item;
  }
  sync() {
    if (this.syncing) return this.syncing;
    this.syncing = this.performSync().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }
  private async performSync() {
    this.scanLocal();
  }
  private save() {
    this.store.set('plugin-installed', this.installs);
    this.notify();
  }
  async command(input: PluginCommand) {
    if (input.action === 'sync') return this.sync();
    if (input.action === 'openFolder') {
      this.openInbox();
      return;
    }
    const id = pluginId.parse(input.id);
    if (this.retired(id) && input.action !== 'remove') throw new Error('此插件已下架');
    if (input.action === 'install' || input.action === 'update') {
      const previous = this.installs[id];
      if (input.action === 'update' && !previous) throw new Error('请先安装此插件');
      if (previous && compareVersions(input.version, previous.item.manifest.version) <= 0)
        throw new Error('此插件已安装相同或更高版本');
      const item = this.catalog.find(
        (item) => item.manifest.id === id && item.manifest.version === input.version,
      );
      if (!item) throw new Error('插件目录已变更，请重新同步后安装');
      if (!pluginCompatible(item.manifest, APP_VERSION))
        throw new Error('请先更新工作台才能安装此插件');
      const accepted = [...new Set(input.permissions)].sort(),
        required = [...item.manifest.permissions].sort();
      if (JSON.stringify(accepted) !== JSON.stringify(required))
        throw new Error('请先确认此版本的全部插件权限');
      const bundled = this.bundled.get(`${id}:${input.version}`)?.bytes;
      const local = this.localArchives.get(`${id}:${input.version}`);
      const bytes = local ?? bundled;
      if (!bytes) throw new Error('插件 ZIP 不在本机插件区');
      const data = this.store.get<Record<string, unknown>>(`plugin-data:${id}`, {});
      const dataVersion = this.store.get<number>(
        `plugin-data-version:${id}`,
        previous?.item.manifest.dataVersion ??
          (Object.keys(data).length ? 1 : (item.manifest.dataVersion ?? 1)),
      );
      const migrated = migratePluginData(data, dataVersion, item.manifest);
      this.install(this.root, bytes, item);
      const installs = {
        ...this.installs,
        [id]: {
          item,
          enabled: this.installs[id]?.enabled ?? true,
          installedAt: new Date().toISOString(),
        },
      };
      this.store.transaction(() => {
        if (previous)
          this.store.set(`plugin-rollback:${id}`, { entry: previous, data, dataVersion });
        this.store.set(`plugin-data:${id}`, migrated);
        this.store.set(`plugin-data-version:${id}`, item.manifest.dataVersion ?? 1);
        this.store.set('plugin-installed', installs);
      });
      this.installs = installs;
      this.notify();
      return;
    }
    const entry = this.installs[id];
    if (!entry) throw new Error('插件尚未安装');
    if (input.action === 'rollback') {
      const backup = this.store.get<{
        entry: InstalledPlugin;
        data: Record<string, unknown>;
        dataVersion?: number;
      } | null>(`plugin-rollback:${id}`, null);
      if (!backup) throw new Error('没有可回退的插件更新');
      const item = this.verifyDescriptor(backup.entry.item);
      if (item.manifest.id !== id || !pluginCompatible(item.manifest, APP_VERSION))
        throw new Error('回退版本不兼容');
      this.verifyInstalled(join(this.root, id, item.manifest.version), item);
      const installs = {
        ...this.installs,
        [id]: { ...backup.entry, item, enabled: entry.enabled },
      };
      this.store.transaction(() => {
        this.store.set(`plugin-data:${id}`, backup.data);
        this.store.set(
          `plugin-data-version:${id}`,
          backup.dataVersion ?? backup.entry.item.manifest.dataVersion ?? 1,
        );
        this.store.set('plugin-installed', installs);
        this.store.set(`plugin-rollback:${id}`, null);
      });
      this.installs = installs;
      this.notify();
      return;
    }
    if (input.action === 'enable') {
      if (input.enabled) {
        this.verifyInstalled(join(this.root, id, entry.item.manifest.version), entry.item);
      }
      this.installs = { ...this.installs, [id]: { ...entry, enabled: input.enabled } };
      this.save();
    } else {
      this.installs = { ...this.installs };
      delete this.installs[id];
      this.save();
      this.store.set(`plugin-folders:${id}`, {});
      this.store.set(`plugin-rollback:${id}`, null);
      rmSync(join(this.root, id), { recursive: true, force: true });
    }
  }
  private requirePlugin(id: string, permission?: PluginPermission) {
    pluginId.parse(id);
    if (this.retired(id)) throw new Error('此插件已下架');
    const entry = this.installs[id];
    if (!entry?.enabled) throw new Error('插件未激活');
    if (!pluginCompatible(entry.item.manifest, APP_VERSION))
      throw new Error('请先更新工作台才能使用此插件');
    if (permission && !entry.item.manifest.permissions.includes(permission))
      throw new Error('插件未取得此功能的权限');
    return entry;
  }
  private folderPath(id: string, folderId: string, path: string) {
    if (
      path.includes('\\') ||
      path.includes(':') ||
      path.startsWith('/') ||
      path.split('/').some((p) => p === '..' || p === '.' || p === '')
    ) {
      if (path !== '') throw new Error('文件夹路径无效');
    }
    const folders = this.store.get<Record<string, string>>(`plugin-folders:${id}`, {}),
      root = Object.hasOwn(folders, folderId) ? folders[folderId] : null;
    if (!root) throw new Error('请先选择要授权的文件夹');
    try {
      const base = realpathSync(root),
        target = realpathSync(resolve(base, path));
      if (target !== base && !target.startsWith(base + sep)) throw new Error();
      return target;
    } catch {
      throw new Error('文件夹已移动、无法访问或超出已授权范围');
    }
  }
  async request(id: string, raw: unknown): Promise<unknown> {
    const input = pluginRequestSchema.parse(raw),
      permission = input.method.startsWith('storage.')
        ? 'storage'
        : input.method.startsWith('folders.')
          ? 'folders'
          : input.method === 'external.open'
            ? 'external-links'
            : undefined;
    const entry = this.requirePlugin(id, permission);
    if (input.method === 'info')
      return {
        id,
        version: entry.item.manifest.version,
        appVersion: APP_VERSION,
        platform: process.platform,
        apiVersion: 1,
        capabilities: HOST_CAPABILITIES,
      };
    if (input.method.startsWith('storage.')) {
      const storage = input as Extract<typeof input, { key: string }>;
      const data = this.store.get<Record<string, unknown>>(`plugin-data:${id}`, {});
      if (input.method === 'storage.get')
        return Object.hasOwn(data, input.key) ? data[input.key] : null;
      const next = { ...data };
      if (storage.method === 'storage.set') next[storage.key] = storage.value;
      else delete next[storage.key];
      if (Buffer.byteLength(JSON.stringify(next)) > 1024 * 1024)
        throw new Error('插件数据已达 1 MiB 上限');
      this.store.set(`plugin-data:${id}`, next);
      return null;
    }
    if (input.method === 'external.open') {
      const url = new URL(input.url);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('只允许打开 HTTPS 网站');
      await shell.openExternal(url.href);
      return null;
    }
    if (input.method === 'folders.choose') {
      const owner = this.owner(),
        options = {
          title: `允许「${entry.item.manifest.name}」访问文件夹`,
          properties: ['openDirectory'] as ['openDirectory'],
        };
      const chosen = await (owner
        ? dialog.showOpenDialog(owner, options)
        : dialog.showOpenDialog(options));
      this.requirePlugin(id, 'folders');
      if (chosen.canceled || !chosen.filePaths[0]) return null;
      const path = realpathSync(chosen.filePaths[0]);
      const folders = this.store.get<Record<string, string>>(`plugin-folders:${id}`, {});
      const folderId = Object.entries(folders).find(([, p]) => p === path)?.[0] ?? randomUUID();
      if (Object.keys(folders).length >= 50 && !folders[folderId])
        throw new Error('每个插件最多授权 50 个文件夹');
      this.store.set(`plugin-folders:${id}`, { ...folders, [folderId]: path });
      return { id: folderId, name: basename(path) } satisfies PluginFolder;
    }
    if (input.method === 'folders.list' || input.method === 'folders.open') {
      const path = this.folderPath(id, input.id, input.path);
      if (!statSync(path).isDirectory()) throw new Error('请指定文件夹');
      if (input.method === 'folders.open') {
        const error = await shell.openPath(path);
        if (error) throw new Error('无法打开所选文件夹');
        return null;
      }
      return readdirSync(path, { withFileTypes: true })
        .filter((e) => !e.isSymbolicLink() && (e.isDirectory() || e.isFile()))
        .slice(0, 500)
        .map((e) => {
          const child = [input.path, e.name].filter(Boolean).join('/');
          return {
            name: e.name,
            path: child,
            directory: e.isDirectory(),
            ...(e.isFile() && images[extname(e.name).toLowerCase()]
              ? {
                  previewUrl: `zhuda-plugin://${id}/${entry.item.manifest.version}/local/${input.id}/${child.split('/').map(encodeURIComponent).join('/')}`,
                }
              : {}),
          };
        });
    }
    throw new Error('不支持的插件操作');
  }
  serve(request: Request): Response {
    try {
      const url = new URL(request.url),
        id = url.hostname,
        current = this.requirePlugin(id);
      const parts = url.pathname.slice(1).split('/'),
        version = parts.shift(),
        kind = parts.shift(),
        path = parts.map(decodeURIComponent).join('/');
      if (!version) throw new Error('插件版本无效');
      const item = this.installedItem(id, version);
      const entry = { ...current, item };
      if (url.search || url.username || url.password) throw new Error();
      let content: Buffer, mime: string;
      if (kind === 'local') {
        this.requirePlugin(id, 'folders');
        const [folderId, ...names] = path.split('/');
        const local = this.folderPath(id, folderId!, names.join('/')),
          stat = statSync(local);
        mime = images[extname(local).toLowerCase()]!;
        if (!mime || !stat.isFile() || stat.size > 10_000_000) throw new Error();
        content = readFileSync(local);
      } else {
        if (
          kind !== 'assets' ||
          !safeAssetPath(path) ||
          !Object.hasOwn(entry.item.manifest.files, path)
        )
          throw new Error();
        const local = join(this.root, id, version, path),
          base = realpathSync(join(this.root, id, version));
        if (!realpathSync(local).startsWith(base + sep)) throw new Error();
        const record = entry.item.manifest.files[path]!;
        if (statSync(local).size !== record.bytes) throw new Error();
        content = readFileSync(local);
        if (content.length !== record.bytes || sha256(content) !== record.sha256) throw new Error();
        mime = assetTypes[extname(path)] ?? 'application/octet-stream';
      }
      const headers: Record<string, string> = {
        'Content-Type': mime,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: zhuda-scene:; font-src 'self'; media-src 'self' zhuda-scene:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
      };
      let start = 0,
        end = content.length - 1,
        status = 200;
      const range = request.headers.get('range');
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const invalid = () =>
          new Response(null, {
            status: 416,
            headers: { ...headers, 'Content-Range': `bytes */${content.length}` },
          });
        if (!match || (!match[1] && !match[2])) return invalid();
        start = match[1] ? Number(match[1]) : Math.max(0, content.length - Number(match[2]));
        end =
          match[1] && match[2]
            ? Math.min(content.length - 1, Number(match[2]))
            : content.length - 1;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= content.length
        )
          return invalid();
        status = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${content.length}`;
      }
      headers['Content-Length'] = String(Math.max(0, end - start + 1));
      return new Response(
        request.method === 'HEAD' ? null : new Uint8Array(content.subarray(start, end + 1)),
        { status, headers },
      );
    } catch {
      return new Response('Plugin resource unavailable', { status: 404 });
    }
  }
}
