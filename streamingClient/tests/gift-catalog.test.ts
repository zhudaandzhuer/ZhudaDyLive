import { expect, it, vi } from 'vitest';
import { LocalStore } from '@zhuda/core';
import { GiftCatalogClient, parseOfficialGifts } from '../client/src/main/gift-catalog';

const response = {
  status_code: 0,
  data: {
    gifts: [
      { id: 2001, name: '玫瑰', diamond_count: 1 },
      { id: '2001', name: '玫瑰', diamond_count: 1 },
      { id: '9223372036854775901', name: '测试新礼物', diamond_count: 100 },
    ],
  },
};
it('完整解析官方目录、依 ID 去重并保留字符串 ID 精度', () => {
  expect(parseOfficialGifts(response)).toEqual([
    { id: '2001', name: '玫瑰', diamonds: 1 },
    { id: '9223372036854775901', name: '测试新礼物', diamonds: 100 },
  ]);
  expect(() => parseOfficialGifts({ status_code: 1, data: response.data })).toThrow();
  expect(() => parseOfficialGifts({ status_code: 0, data: { gifts: [] } })).toThrow();
});
it('预载完整目录、合并同步请求，失败沿用最后成功数据并可恢复', async () => {
  const store = new LocalStore(':memory:');
  try {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(response))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json(response));
    const changed = vi.fn();
    const catalog = new GiftCatalogClient(store, changed, request);
    expect(catalog.snapshot().gifts.length).toBeGreaterThan(1000);
    const one = catalog.refresh(),
      two = catalog.refresh();
    expect(one).toBe(two);
    await one;
    expect(request).toHaveBeenCalledTimes(1);
    expect(catalog.snapshot()).toMatchObject({
      status: 'ready',
      gifts: [{ id: '2001' }, { id: '9223372036854775901' }],
    });
    const success = catalog.snapshot();
    await catalog.refresh();
    expect(catalog.snapshot()).toEqual({ ...success, status: 'offline' });
    await catalog.refresh();
    expect(catalog.snapshot().status).toBe('ready');
    expect(new GiftCatalogClient(store, changed, request).snapshot().gifts).toEqual(success.gifts);
  } finally {
    store.close();
  }
});
