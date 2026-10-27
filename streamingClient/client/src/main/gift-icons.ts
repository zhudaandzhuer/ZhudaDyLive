import type { LocalStore } from '@zhuda/core';
import type { GiftCatalogItem } from '@zhuda/contracts';
import type { SceneMedia } from './scenes/media';

export function trustedGiftIcon(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      ['douyinpic.com', 'byteimg.com', 'douyincdn.com', 'pstatp.com', 'bytedance.com'].some(
        (host) => url.hostname.endsWith('.' + host),
      )
    );
  } catch {
    return false;
  }
}
// Icons are fetched by the host only for gifts in the active scene, then served as local media.
export class GiftIconCache {
  private icons: Record<string, string>;
  private pending = new Set<string>();
  private retryAt = new Map<string, number>();
  private queue = new Map<string, string>();
  constructor(
    private store: LocalStore,
    private media: SceneMedia,
    private onChange: () => void,
    private request: typeof fetch = fetch,
  ) {
    const saved = store.get<unknown>('gift-icons', {});
    this.icons =
      saved && typeof saved === 'object' && !Array.isArray(saved)
        ? Object.fromEntries(
            Object.entries(saved).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : {};
  }
  cached(gift: GiftCatalogItem) {
    const url = gift.iconUrl && this.icons[gift.iconUrl];
    return url && /^zhuda-scene:\/\/media\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(url)
      ? url
      : null;
  }
  ensure(gifts: GiftCatalogItem[]) {
    for (const gift of gifts) {
      const url = gift.iconUrl;
      if (
        url &&
        trustedGiftIcon(url) &&
        !this.cached(gift) &&
        !this.pending.has(url) &&
        (this.retryAt.get(url) ?? 0) < Date.now()
      )
        this.queue.set(url, gift.id);
    }
    this.pump();
  }
  private pump() {
    while (this.pending.size < 3 && this.queue.size) {
      const url = this.queue.keys().next().value!;
      this.queue.delete(url);
      this.pending.add(url);
      void this.download(url).finally(() => {
        this.pending.delete(url);
        this.pump();
      });
    }
  }
  private async download(url: string) {
    try {
      const response = await this.request(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get('content-length') ?? 0) > 1_000_000
      )
        throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 1_000_000) throw new Error();
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      this.icons[url] = this.media.cacheImage(Buffer.concat(chunks));
      this.store.set('gift-icons', this.icons);
      this.onChange();
    } catch {
      this.retryAt.set(url, Date.now() + 3600_000);
      this.queue.delete(url);
    }
  }
}
