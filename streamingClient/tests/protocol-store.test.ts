import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeGift, decodePush, decodeResponse, LocalStore } from '@zhuda/core';
import { encode, gift, manifest } from './fixtures';
const ctx = { runId: 'run1', source: 'live' as const, webId: '123456' };
describe('协议与数量交易', () => {
  it('保留 64 位识别、解码 gzip PushFrame 并限制大小', () => {
    const payload = gift(1),
      message = { method: 'WebcastGiftMessage', msgId: '9223372036854775901', payload };
    const response = encode('Response', { messages: [message] });
    const push = encode('PushFrame', {
      payload: gzipSync(response),
      payloadEncoding: 'gzip',
      payloadType: 'msg',
    });
    expect(decodePush(push)[0]?.messageId).toBe('9223372036854775901');
    expect(decodeGift(decodePush(push)[0]!.payload, ctx).senderId).toBe('9223372036854775903');
    expect(() => decodeResponse(new Uint8Array(8 * 1024 * 1024 + 1))).toThrow();
    expect(() =>
      decodePush(
        encode('PushFrame', {
          payload: gzipSync(Buffer.alloc(9 * 1024 * 1024)),
          payloadEncoding: 'gzip',
        }),
      ),
    ).toThrow();
    expect(decodeGift(new Uint8Array([255]), ctx).quality).toBe('parse_error');
  });
  it('连击 1→3→3 收尾只加 1、2、0；暱称变更及重送不重复', () => {
    const store = new LocalStore(':memory:');
    try {
      store.startRound(manifest, 'live', ctx.webId, '4000');
      const add = (n: number, options = {}) =>
        store.ingest(decodeGift(gift(n, options), ctx), gift(n, options));
      expect(add(1).gift.delta).toBe('1');
      expect(add(3).gift.delta).toBe('2');
      expect(add(3, { repeatEnd: 1 }).gift.delta).toBe('0');
      expect(
        add(3, { repeatEnd: 1, user: { id: '9223372036854775903', nickname: '新暱称' } }).gift
          .quality,
      ).toBe('duplicate');
      expect(add(2).gift.delta).toBe('0');
      expect(store.round('live')?.remaining).toBe('3970');
      expect(store.actions(store.round('live')?.id)).toHaveLength(2);
    } finally {
      store.close();
    }
  });
  it('中途连入以首笔为基准；批量不将 group 与 combo 相乘', () => {
    const store = new LocalStore(':memory:');
    try {
      const add = (n: number, options = {}) =>
        store.ingest(decodeGift(gift(n, options), ctx), gift(n, options)).gift;
      expect(add(3).delta).toBe('0');
      expect(add(4).delta).toBe('1');
      expect(add(4).quality).toBe('duplicate');
      expect(add(10, { groupId: '9002', groupCount: '10', comboCount: '1' }).delta).toBe('10');
      expect(add(13, { groupId: '9002', groupCount: '3', comboCount: '2' }).delta).toBe('3');
      expect(
        add(13, { groupId: '9002', groupCount: '3', comboCount: '2', repeatEnd: 1 }).delta,
      ).toBe('0');
      expect(add(1, { groupId: '9003', toUserIds: ['1', '2'] }).delta).toBeNull();
    } finally {
      store.close();
    }
  });
  it('写入失败会回滚观测、连击进度和游戏效果', () => {
    const store = new LocalStore(':memory:');
    try {
      store.startRound(manifest, 'live', ctx.webId, '4000');
      store.db.exec(
        "CREATE TRIGGER fail_action BEFORE INSERT ON actions BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
      );
      expect(() => store.ingest(decodeGift(gift(1), ctx), gift(1))).toThrow();
      expect(store.gifts()).toHaveLength(0);
      expect(store.round('live')?.remaining).toBe('4000');
      expect(store.db.prepare('SELECT COUNT(*) AS n FROM combos').get()?.n).toBe(0);
      store.db.exec('DROP TRIGGER fail_action');
      expect(store.ingest(decodeGift(gift(1), ctx), gift(1)).gift.delta).toBe('1');
    } finally {
      store.close();
    }
  });
  it('重启保存高水位，试玩隔离，旧礼物不追算', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zhuda-store-')),
      path = join(dir, 'studio.sqlite');
    let store = new LocalStore(path);
    try {
      store.ingest(decodeGift(gift(1), ctx), gift(1));
      store.startRound(manifest, 'live', ctx.webId, '4000');
      store.startRound(manifest, 'demo', 'demo', '4000');
      expect(store.simulate('2001', '3', 'request1').after).toBe('3970');
      expect(store.simulate('2001', '3', 'request1').after).toBe('3970');
      expect(() => store.simulate('2001', '4', 'request1')).toThrow();
      store.close();
      store = new LocalStore(path);
      expect(store.ingest(decodeGift(gift(3), { ...ctx, runId: 'run2' }), gift(3)).gift.delta).toBe(
        '2',
      );
      expect(store.round('live')?.remaining).toBe('3980');
      expect(store.round('demo')?.remaining).toBe('3970');
      store.retain(Date.now() + 40 * 86400_000);
      expect(store.gifts()).toHaveLength(0);
      expect(store.actions(store.round('live')?.id)).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('精确整数运算、零下限；通关继续收礼，新加量自动恢复', () => {
    const store = new LocalStore(':memory:');
    try {
      store.startRound(manifest, 'demo', 'demo', '10');
      const a = store.simulate('2001', '999999');
      expect(a.after).toBe('0');
      expect(a.delta).toBe('-10');
      expect(a.won).toBe(true);
      const roundId = store.round('demo')!.id;
      expect(store.simulate('2001', '1').won).toBe(false);
      expect(store.simulate('685', '1').after).toBe('100');
      expect(store.round('demo')).toMatchObject({
        id: roundId,
        remaining: '100',
        status: 'running',
      });
      expect(store.simulate('2001', '10').won).toBe(true);
      expect(store.actions(roundId)).toHaveLength(4);
      store.stopRound('demo');
      expect(store.round('demo')?.status).toBe('stopped');
      expect(() => store.simulate('685', '1')).toThrow();
    } finally {
      store.close();
    }
  });
  it('超过 JS 安全整数的礼物数量仍精确，其他直播间及过早时间不套用', () => {
    const store = new LocalStore(':memory:');
    try {
      store.startRound(manifest, 'live', ctx.webId, '4000');
      const payload = gift(0, {
        giftId: '685',
        groupId: '0',
        comboCount: '0',
        gift: { id: '685', name: '心心', combo: false },
        count: '18446744073709551615',
      });
      store.ingest(
        decodeGift(payload, { ...ctx, webId: '999999', receivedAt: '2000-01-01T00:00:00.000Z' }),
        payload,
      );
      expect(store.round('live')?.remaining).toBe('4000');
      // Different room IDs also produce distinct event identities.
      const fresh = gift(0, {
        common: { msgId: '902', roomId: '903' },
        giftId: '685',
        groupId: '0',
        comboCount: '0',
        gift: { id: '685', name: '心心', combo: false },
        count: '18446744073709551615',
      });
      store.ingest(decodeGift(fresh, ctx), fresh);
      expect(store.round('live')?.remaining).toBe(
        (4000n + 18446744073709551615n * 100n).toString(),
      );
    } finally {
      store.close();
    }
  });
});
