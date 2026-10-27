/**
 * Local workspace access.
 *
 * It opens the bundled game catalog without a network request or expiry timer.
 * It is intentionally local-first:
 * all product capabilities are available as soon as the app starts.
 */
import type { CatalogItem } from '@zhuda/contracts';
import { verifyCatalog } from '@zhuda/core';
import type { LocalStore } from '@zhuda/core';

export class LocalWorkspace {
  catalog: CatalogItem[] = [];
  private bundled = new Map<string, Uint8Array>();

  constructor(
    private store: LocalStore,
    readonly publicKey: string,
    readonly deviceId: string,
  ) {
    // Read the cached bundled catalog only as a migration aid. It is never
    // fetched and it cannot gate the workspace.
    const cached = store.get<CatalogItem[]>('catalog', []);
    this.catalog = cached.flatMap((item) => {
      try {
        return [verifyCatalog(item, publicKey)];
      } catch {
        return [];
      }
    });
  }
  useBundled(items: CatalogItem[], load?: (item: CatalogItem) => Uint8Array) {
    for (const item of items) {
      try {
        const verified = verifyCatalog(item, this.publicKey);
        this.catalog = [
          ...this.catalog.filter((entry) => entry.manifest.id !== verified.manifest.id),
          verified,
        ];
        if (load)
          this.bundled.set(`${verified.manifest.id}:${verified.manifest.version}`, load(item));
      } catch {
        // A malformed old package is ignored; local plugins use PluginManager's
        // self-contained descriptor path instead.
      }
    }
    this.store.set('catalog', this.catalog);
  }
  download(item: CatalogItem): Promise<Uint8Array> {
    const bytes = this.bundled.get(`${item.manifest.id}:${item.manifest.version}`);
    if (!bytes) throw new Error('此游戏资源未随应用提供');
    return Promise.resolve(new Uint8Array(bytes));
  }
}
