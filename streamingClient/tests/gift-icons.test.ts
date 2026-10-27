import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStore } from '@zhuda/core';
import { GiftIconCache, trustedGiftIcon } from '../client/src/main/gift-icons';
import { SceneMedia } from '../client/src/main/scenes/media';
import { parseOfficialGifts } from '../client/src/main/gift-catalog';

it('官方图标只接受 HTTPS CDN 地址，不接受凭据、私网、重定向或伪造后缀', () => {
  const valid = 'https://p3-webcast.douyinpic.com/img/gift.png';
  expect(trustedGiftIcon(valid)).toBe(true);
  for (const url of [
    'http://p3.douyinpic.com/a',
    'https://127.0.0.1/a',
    'https://douyinpic.com.evil.test/a',
    'https://user:secret@p3.byteimg.com/a',
    'https://p3.byteimg.com:8443/a',
  ])
    expect(trustedGiftIcon(url)).toBe(false);
  const gifts = parseOfficialGifts({
    status_code: 0,
    data: {
      gifts: [
        { id: 2001, name: '玫瑰', image: { url_list: ['http://localhost/internal', valid] } },
      ],
    },
  });
  expect(gifts[0]?.iconUrl).toBe(valid);
});

it('只缓存所需图标，合并并发请求；预览与输出读取同一本机素材，离线重启继续可用', async () => {
  const store = new LocalStore(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'zhuda-gift-icons-'));
  try {
    const media = new SceneMedia(dir);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfXIAAAAASUVORK5CYII=',
      'base64',
    );
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(png));
    let done!: () => void;
    const ready = new Promise<void>((resolve) => {
      done = resolve;
    });
    const cache = new GiftIconCache(store, media, done, request);
    const gift = {
      id: '2001',
      name: '玫瑰',
      diamonds: 1,
      iconUrl: 'https://p3.douyinpic.com/rose.png',
    };
    cache.ensure([gift]);
    cache.ensure([gift]);
    await ready;
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]?.redirect).toBe('error');
    const url = cache.cached(gift)!;
    expect(url).toMatch(/^zhuda-scene:\/\/media\/[a-f0-9]{64}\.png$/);
    expect(Buffer.from(await media.serve(new Request(url)).arrayBuffer())).toEqual(png);
    const offline = new GiftIconCache(store, media, vi.fn(), request);
    offline.ensure([gift]);
    expect(offline.cached(gift)).toBe(url);
    expect(request).toHaveBeenCalledTimes(1);
    expect(() => media.cacheImage(Buffer.from('<svg onload="evil()"/>'))).toThrow('格式');
    expect(() => media.cacheImage(Buffer.alloc(1_000_001))).toThrow('过大');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
