import { z } from 'zod';
import { giftCatalogItem, type GiftCatalogSnapshot } from '@zhuda/contracts';
import type { LocalStore } from '@zhuda/core';
import bundled from './data/douyin-gifts.json';
import { trustedGiftIcon } from './gift-icons';

export const officialGiftCatalogURL =
  'https://live.douyin.com/webcast/gift/list/?aid=6383&device_platform=web&live_id=1';
const savedCatalog = z.object({
  updatedAt: z.string().datetime(),
  gifts: z.array(giftCatalogItem).min(1).max(10_000),
});

export function parseOfficialGifts(input: unknown) {
  const response = z
    .object({
      status_code: z.literal(0),
      data: z.object({ gifts: z.array(z.unknown()).min(1).max(10_000) }),
    })
    .parse(input);
  const gifts = response.data.gifts.map((item) => {
    const gift = z
      .object({
        id: z.union([z.string(), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)]),
        name: z.string(),
        diamond_count: z.number().int().nonnegative().nullable().optional(),
        image: z.object({ url_list: z.array(z.string()).optional() }).nullish(),
        icon: z.object({ url_list: z.array(z.string()).optional() }).nullish(),
      })
      .parse(item);
    return giftCatalogItem.parse({
      id: String(gift.id),
      name: gift.name,
      diamonds: gift.diamond_count ?? null,
      ...(() => {
        const iconUrl = [...(gift.image?.url_list ?? []), ...(gift.icon?.url_list ?? [])].find(
          trustedGiftIcon,
        );
        return iconUrl ? { iconUrl } : {};
      })(),
    });
  });
  return [...new Map(gifts.map((gift) => [gift.id, gift])).values()].sort(
    (a, b) =>
      (a.diamonds ?? Infinity) - (b.diamonds ?? Infinity) ||
      a.name.localeCompare(b.name, 'zh-Hans'),
  );
}

export class GiftCatalogClient {
  private state: GiftCatalogSnapshot;
  private pending: Promise<void> | null = null;
  constructor(
    private store: LocalStore,
    private onChange: () => void,
    private request: typeof fetch = fetch,
  ) {
    const saved = savedCatalog.safeParse(store.get('gift-catalog', null));
    const fallback = savedCatalog.parse(bundled);
    this.state = {
      ...(saved.success && Date.parse(saved.data.updatedAt) >= Date.parse(fallback.updatedAt)
        ? saved.data
        : fallback),
      status: 'ready',
    };
  }
  snapshot(): GiftCatalogSnapshot {
    return this.state;
  }
  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    this.state = { ...this.state, status: 'syncing' };
    this.onChange();
    this.pending = this.sync().finally(() => {
      this.pending = null;
      this.onChange();
    });
    return this.pending;
  }
  private async sync() {
    try {
      const response = await this.request(officialGiftCatalogURL, {
        signal: AbortSignal.timeout(12_000),
        redirect: 'error',
      });
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get('content-length') ?? 0) > 10_000_000
      )
        throw new Error('礼物目录暂时无法取得');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 10_000_000) throw new Error('礼物目录回应过大');
          chunks.push(next.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const gifts = parseOfficialGifts(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const catalog = { gifts, updatedAt: new Date().toISOString() };
      this.store.set('gift-catalog', catalog);
      this.state = { ...catalog, status: 'ready' };
    } catch {
      this.state = { ...this.state, status: 'offline' };
    }
  }
}
