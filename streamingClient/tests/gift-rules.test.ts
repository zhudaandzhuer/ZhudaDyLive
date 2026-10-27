import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventsFor, manifestSchema } from '@zhuda/contracts';
import { decodeGift, LocalStore } from '@zhuda/core';
import { manifest, gift } from './fixtures';

const configurable = manifestSchema.parse({
  ...manifest,
  events: [
    {
      id: 'unlock',
      label: '解开锁链',
      description: '移除锁链',
      operation: 'subtract',
      amountLabel: '解开根数',
      unit: '根',
      min: 1,
      max: 1000,
      default: 10,
    },
    {
      id: 'lock',
      label: '添加锁链',
      description: '添加锁链',
      operation: 'add',
      amountLabel: '添加根数',
      unit: '根',
      min: 1,
      max: 1000,
      default: 100,
    },
    {
      id: 'spark',
      label: '金属闪光',
      description: '不改数量',
      operation: 'effect',
      amountLabel: '强度',
      unit: '级',
      min: 1,
      max: 10,
      default: 3,
    },
  ],
});
const rose = { giftId: '2001', giftName: '玫瑰', eventId: 'unlock', amount: 25, delta: -25 };
describe('可配置的游戏礼物事件', () => {
  it('旧回合以玩法 ID 取得兼容功能，回合 UUID 不会盖掉玩法', () => {
    expect(
      eventsFor({ id: 'round-uuid', product: 'game.chain' }).map((event) => event.label),
    ).toEqual(['添加锁链', '解开锁链']);
    expect(eventsFor({ id: 'prank.stage' }).map((event) => event.label)).toEqual([
      '反转加码',
      '舞台震动',
    ]);
  });
  it('修改映射立即套用后续真实礼物与试送，不重算历史或改回合', () => {
    const store = new LocalStore(':memory:');
    try {
      const live = store.startRound(configurable, 'live', '12345678demo', '4000');
      const demo = store.startRound(configurable, 'demo', 'demo', '4000');
      expect(store.simulate('2001', '1').after).toBe('3990');
      store.configureRules(configurable, [rose]);
      expect(store.round('demo')).toMatchObject({ id: demo.id, remaining: '3990' });
      expect(store.actions(demo.id)).toHaveLength(1);
      expect(store.simulate('2001', '2')).toMatchObject({
        after: '3940',
        eventId: 'unlock',
        eventName: '解开锁链',
        value: '50',
      });
      const payload = gift(1);
      store.ingest(
        decodeGift(payload, { runId: 'test', source: 'live', webId: live.webId }),
        payload,
      );
      expect(store.round('live')).toMatchObject({ id: live.id, remaining: '3975' });
      expect(() => store.simulate('685', '1')).toThrow('没有激活规则');
    } finally {
      store.close();
    }
  });
  it('删除全部映射有效，设置重启保留、兼容新版本沿用且不同玩法独立', () => {
    const directory = mkdtempSync(join(tmpdir(), 'zhuda-rules-'));
    let store = new LocalStore(join(directory, 'test.sqlite'));
    try {
      store.configureRules(configurable, [rose]);
      store.close();
      store = new LocalStore(join(directory, 'test.sqlite'));
      expect(store.startRound(configurable, 'demo', 'demo', '100').rules).toEqual([rose]);
      store.configureRules(configurable, []);
      expect(store.round('demo')?.rules).toEqual([]);
      expect(() => store.simulate('2001', '1')).toThrow();
      expect(store.configuration(configurable).rules).toEqual([]);
      expect(store.configuration({ ...configurable, version: '2.0.0' }).rules).toHaveLength(0);
      expect(store.configuration({ ...configurable, id: 'prank.other' }).rules).toHaveLength(2);
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('未知功能、重复礼物、错误增减方向与超出游戏参数都拒绝且不覆盖设置', () => {
    const store = new LocalStore(':memory:');
    try {
      store.configureRules(configurable, [rose]);
      for (const rules of [
        [{ ...rose, eventId: 'unknown' }],
        [rose, rose],
        [{ ...rose, delta: 25 }],
        [{ ...rose, amount: 1001, delta: -1001 }],
      ]) {
        expect(() => store.configureRules(configurable, rules)).toThrow();
        expect(store.configuration(configurable).rules).toEqual([rose]);
      }
      expect(() =>
        manifestSchema.parse({
          ...configurable,
          events: [configurable.events![0], configurable.events![0]],
        }),
      ).toThrow();
    } finally {
      store.close();
    }
  });
  it('纯特效不改数量且只触发一次，保留游戏功能及参数', () => {
    const store = new LocalStore(':memory:');
    try {
      store.configureRules(configurable, [{ ...rose, eventId: 'spark', amount: 3, delta: 0 }]);
      store.startRound(configurable, 'demo', 'demo', '100');
      const action = store.simulate('2001', '2', 'same');
      expect(action).toMatchObject({
        eventId: 'spark',
        eventName: '金属闪光',
        value: '6',
        before: '100',
        after: '100',
        delta: '0',
        won: false,
      });
      expect(store.simulate('2001', '2', 'same').id).toBe(action.id);
      expect(store.actions(action.roundId)).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});
