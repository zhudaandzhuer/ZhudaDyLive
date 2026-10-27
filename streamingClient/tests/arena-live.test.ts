import { describe, it, expect } from 'vitest';
import { LocalStore, decodeGift } from '@zhuda/core';
import type { GiftEvent } from '@zhuda/contracts';
import { gift } from './fixtures';
import { ArenaHost } from '../../plugins/arena/host';
import { ArenaWorld } from '../../plugins/arena/engine';
import { ArenaLiveSession, arenaViewerId, type ArenaLiveSource } from '../../plugins/arena/live';

const now = Date.parse('2026-10-18T13:00:00Z');
const source = (): ArenaLiveSource => ({
  state: 'connected',
  webId: '123456',
  runId: 'run1',
  sequence: '0',
});
const catalog = [
  { id: '2001', name: '入场礼物', diamonds: 1 },
  { id: '685', name: '抢镜礼物', diamonds: 1 },
];
const attach = { action: 'live', joinGiftId: '2001', focusGiftId: '685' };
const total = (p: { strength: number; agility: number; maxHp: number }) =>
  p.strength - 18 + p.agility + p.maxHp - 1000;
function setup() {
  const state = source();
  const store = new LocalStore(':memory:');
  const host = new ArenaHost({ source: () => state, catalog: () => catalog, now: () => now });
  host.control(attach);
  let message = 0;
  function receive(repeat: number, options: Record<string, unknown> = {}) {
    const bytes = gift(repeat, options);
    const decoded = decodeGift(bytes, {
      source: 'live',
      runId: state.runId,
      webId: state.webId,
      receivedAt: new Date(now + 1).toISOString(),
      messageId: String(++message),
    });
    const committed = store.ingest(decoded, bytes).gift;
    state.sequence = committed.seq!;
    return { event: committed, receipt: host.ingest(committed) };
  }
  return { state, store, host, receive };
}
describe('真实礼物进入统一 SVG 世界', () => {
  it('真实协议解码、提交、入场到命名角色；连击 1→3→3 只加三点', () => {
    const { store, host, receive } = setup();
    try {
      expect(host.snapshot().players).toHaveLength(0);
      expect(receive(1).receipt?.accepted).toBe(true);
      expect(receive(3).receipt?.accepted).toBe(true);
      expect(receive(3, { repeatEnd: 1 }).receipt?.accepted).toBe(false);
      const p = host.snapshot().players[0]!;
      expect(p.id).toBe(arenaViewerId('9223372036854775903'));
      expect(p.name).toBe('测试观众');
      expect(total(p)).toBe(3);
      expect(p.life).toBe(1);
    } finally {
      store.close();
    }
  });
  it('昵称相同的真实用户各自入场；普通礼物只增强赠送者，小心心只抢自己的镜头', () => {
    const { store, host, receive } = setup();
    try {
      const user = (id: string) => ({ id, nickname: '同名玩家' });
      receive(1, { user: user('11'), groupId: '101' });
      receive(1, { user: user('12'), groupId: '102' });
      receive(1, {
        user: user('12'),
        giftId: '685',
        gift: { id: '685', name: '小心心', combo: false },
        groupId: '103',
      });
      expect(host.snapshot().focus?.playerId).toBe(arenaViewerId('12'));
      receive(1, {
        user: user('11'),
        giftId: '685',
        gift: { id: '685', name: '小心心', combo: false },
        groupId: '104',
      });
      expect(host.snapshot().focus?.playerId).toBe(arenaViewerId('11'));
      receive(1, {
        user: user('12'),
        giftId: '999',
        gift: { id: '999', name: '任意礼物', combo: false },
        groupId: '105',
      });
      const players = host.snapshot().players;
      expect(players).toHaveLength(2);
      expect(total(players.find((p) => p.id === arenaViewerId('11'))!)).toBe(2);
      expect(total(players.find((p) => p.id === arenaViewerId('12'))!)).toBe(3);
      host.advance(2000);
      expect(host.snapshot().focus).toBeNull();
    } finally {
      store.close();
    }
  });
  it('未入场礼物不会创建分身或在稍后重播；身份缺失不会猜测玩家', () => {
    const state = source(),
      world = new ArenaWorld();
    const session = new ArenaLiveSession(world, {
      ...state,
      startSeq: '0',
      startedAt: new Date(now).toISOString(),
      joinGiftId: '2001',
      focusGiftId: '685',
    });
    const event = (id: string, seq: string, giftId: string): GiftEvent => ({
      ...decodeGift(gift(1), {
        source: 'live',
        runId: state.runId,
        webId: state.webId,
        receivedAt: new Date(now + 1).toISOString(),
      }),
      id,
      seq,
      giftId,
      delta: '1',
    });
    expect(session.ingest(event('late', '1', '999'), state).accepted).toBe(false);
    expect(session.ingest(event('join', '2', '2001'), state).accepted).toBe(true);
    expect(session.ingest(event('late', '3', '999'), state).code).toBe('duplicate');
    expect(session.ingest({ ...event('missing', '4', '2001'), senderId: '' }, state).code).toBe(
      'identity',
    );
    expect(world.players.size).toBe(1);
    expect(total(world.snapshot().players[0]!)).toBe(1);
  });
  it('隔离旧事件、旧时间、其他房间、模拟来源、模糊数量与超过上限的增量', () => {
    const { state, store, host, receive } = setup();
    try {
      const first = receive(1).event;
      const before = host.snapshot().players;
      for (const [i, change] of [
        { webId: 'other' },
        { runId: 'other' },
        { source: 'demo' },
        { receivedAt: new Date(now - 1).toISOString() },
        { quality: 'ambiguous' },
        { quality: 'duplicate' },
        { delta: null },
        { delta: '1001' },
      ].entries()) {
        host.ingest({ ...first, id: `invalid_${i}`, seq: String(i + 2), ...change } as GiftEvent);
      }
      expect(host.snapshot().players).toEqual(before);
    } finally {
      store.close();
    }
  });
  it('断线暂停时钟；相同连接恢复继续；换房或重连新批次必须重新接入', () => {
    const { state, store, host, receive } = setup();
    try {
      receive(1);
      host.advance(500);
      const id = host.snapshot().instanceId;
      state.state = 'reconnecting';
      host.advance(2000);
      expect(host.snapshot().time).toBe(500);
      state.state = 'connected';
      host.advance(100);
      expect(host.snapshot().time).toBe(600);
      state.runId = 'run2';
      expect(host.snapshot().players).toHaveLength(0);
      expect(host.snapshot().instanceId).not.toBe(id);
      host.control(attach);
      receive(1, { groupId: '106' });
      state.webId = '654321';
      expect(host.snapshot().players).toHaveLength(0);
      expect(host.snapshot().input.attached).toBe(false);
    } finally {
      store.close();
    }
  });
  it('直播模式拒绝模拟输入和未列入目录的映射；演示世界不会混入直播', () => {
    const { store, host } = setup();
    try {
      expect(() =>
        host.simulate({
          id: 'fake',
          senderId: 'fake',
          senderName: '模拟角色',
          kind: 'join',
          quantity: 1,
        }),
      ).toThrow(/不接受/);
      expect(() => host.control({ action: 'add' })).toThrow(/模拟/);
      expect(() => host.control({ ...attach, joinGiftId: '999' })).toThrow(/目录/);
      expect(() => host.control({ ...attach, focusGiftId: '2001' })).toThrow(/不同/);
      host.control({ action: 'demo' });
      expect(host.snapshot().players).toHaveLength(24);
      expect(host.ingest({} as GiftEvent)).toBeNull();
    } finally {
      store.close();
    }
  });
});
