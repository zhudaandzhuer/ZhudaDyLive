import { expect, it } from 'vitest';
import { commandSchema, parseRoom } from '@zhuda/contracts';
import { decodeGift, LocalStore } from '@zhuda/core';
import { gift, manifest } from './fixtures';

it.each([
  ['12345678demo', '12345678demo'],
  ['  12345678demo  ', '12345678demo'],
  ['https://live.douyin.com/12345678demo', '12345678demo'],
  ['https://live.douyin.com/12345678demo/?enter_from=share#live', '12345678demo'],
  ['https://LIVE.DOUYIN.COM/Host_01', 'Host_01'],
  ['http://live.douyin.com/123456', '123456'],
  ['http123', 'http123'],
  ['abc.Name-01', 'abc.Name-01'],
  ['0000123456', '0000123456'],
])('直播输入 %s 保留原始文字标识', (input, expected) => {
  const command = commandSchema.parse({ type: 'monitor', room: input });
  if (command.type !== 'monitor') throw new Error('unexpected command');
  expect(parseRoom(command.room)).toBe(expected);
});

it.each([
  '',
  '.',
  '..',
  'a'.repeat(65),
  '1234 5678demo',
  '主播名字',
  '12345678demo?room=another',
  '12345678demo/other',
  'https://live.douyin.com.evil.example/12345678demo',
  'https://evil.example/12345678demo',
  'https://live.douyin.com@evil.example/12345678demo',
  'https://user:password@live.douyin.com/12345678demo',
  'https://live.douyin.com:8443/12345678demo',
  'ftp://live.douyin.com/12345678demo',
  'https://live.douyin.com/',
  'https://live.douyin.com/12345678demo/other',
  'https://live.douyin.com/%2F12345678demo',
])('拒绝无效标识或非官方直播网址 %s', (input) => {
  expect(() => parseRoom(input)).toThrow();
});

it('英数直播号可绑定正式回合并计入礼物，其他直播间不混算', () => {
  const store = new LocalStore(':memory:');
  const webId = parseRoom('12345678demo');
  const context = { runId: 'room-input-test', source: 'live' as const, webId };
  try {
    store.startRound(manifest, 'live', webId, '4000');
    const payload = gift(1);
    expect(store.ingest(decodeGift(payload, context), payload).action?.after).toBe('3990');
    const other = gift(1, { common: { msgId: '123', roomId: '456' }, groupId: 'other' });
    expect(
      store.ingest(decodeGift(other, { ...context, webId: 'other_host' }), other).action,
    ).toBeNull();
    expect(store.round('live')?.remaining).toBe('3990');
  } finally {
    store.close();
  }
});
