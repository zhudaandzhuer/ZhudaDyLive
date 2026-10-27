import { describe, it, expect } from 'vitest';
import { ArenaWorld, attacksPerSecond } from '../../plugins/arena/engine';

const gift = (id: string, senderId: string, kind: 'join' | 'focus' | 'buff', quantity = 1) => ({
  id,
  senderId,
  senderName: `玩家${senderId}`,
  kind,
  quantity,
});
function pair() {
  const world = new ArenaWorld(7);
  world.gift(gift('join_a', 'a', 'join'));
  world.gift(gift('join_b', 'b', 'join'));
  world.players.get('a')!.x = 1000;
  world.players.get('a')!.y = 1000;
  world.players.get('b')!.x = 1040;
  world.players.get('b')!.y = 1000;
  return world;
}
describe('SVG 混战原型的统一世界', () => {
  it('按用户身份保留唯一角色，重复入场只加点；昵称相同也不会串角色', () => {
    const world = new ArenaWorld();
    world.gift({ ...gift('one', 'a', 'join'), senderName: '同名观众' });
    const life = world.players.get('a')!.life;
    world.gift({ ...gift('two', 'b', 'join'), senderName: '同名观众' });
    world.gift(gift('three', 'a', 'join', 10));
    expect(world.players.size).toBe(2);
    const a = world.players.get('a')!;
    expect(a.life).toBe(life);
    expect(a.strength - 18 + a.agility + a.maxHp - 1000).toBe(11);
  });
  it('同一事件不会重复加点、刷新抢镜；内容冲突拒绝处理', () => {
    const world = new ArenaWorld();
    world.gift(gift('join', 'a', 'join'));
    const event = gift('focus', 'a', 'focus', 10);
    world.gift(event);
    world.advance(500);
    const before = world.snapshot();
    expect(world.gift(event).accepted).toBe(false);
    expect(world.snapshot()).toEqual(before);
    expect(() => world.gift({ ...event, quantity: 20 })).toThrow(/不一致/);
  });
  it('抢镜采用最新事件覆盖，旧的不会排队重播；2 秒后回到存活榜首', () => {
    const world = pair();
    world.gift(gift('focus_a', 'a', 'focus'));
    world.advance(500);
    world.gift(gift('focus_b', 'b', 'focus'));
    expect(world.snapshot().focus?.playerId).toBe('b');
    expect(world.snapshot().focus?.until).toBe(2500);
    world.advance(1900);
    expect(world.snapshot().focus?.playerId).toBe('b');
    world.advance(100);
    expect(world.snapshot().focus).toBeNull();
    expect(world.snapshot().leaderId).toBe('a');
  });
  it('暂停冻结世界、出生保护与抢镜时钟', () => {
    const world = pair();
    world.gift(gift('focus', 'a', 'focus'));
    world.paused = true;
    const before = world.snapshot();
    world.advance(50_000);
    expect(world.snapshot()).toEqual(before);
  });
  it('攻击同一时间结算，致命攻击不能因遍历顺序吞掉对手攻击', () => {
    const world = pair();
    const a = world.players.get('a')!,
      b = world.players.get('b')!;
    a.hp = b.hp = 100;
    a.strength = b.strength = 1000;
    world.advance(2400);
    expect(a.hp).toBeGreaterThan(0);
    expect(b.hp).toBeGreaterThan(0);
    world.advance(100);
    expect(a.hp).toBe(0);
    expect(b.hp).toBe(0);
    expect(world.snapshot().leaderId).toBeNull();
  });
  it('死亡后不接受加点和抢镜；入场礼物创建新生命，不复用旧增益', () => {
    const world = pair();
    world.players.get('a')!.hp = 1;
    world.players.get('b')!.strength = 1000;
    world.gift(gift('focus', 'a', 'focus'));
    world.advance(2500);
    expect(world.players.get('a')!.diedAt).toBe(2500);
    expect(world.snapshot().focus).toBeNull();
    expect(() => world.gift(gift('late', 'a', 'buff', 100))).toThrow(/先/);
    world.gift(gift('rejoin', 'a', 'join'));
    const a = world.players.get('a')!;
    expect(a.life).toBe(2);
    expect(a.diedAt).toBeNull();
    expect(a.bornAt).toBe(2500);
    expect(a.strength - 18 + a.agility + a.maxHp - 1000).toBe(1);
  });
  it('非法份数和非入场用户不会消耗事件编号；可以修正后重试', () => {
    const world = new ArenaWorld();
    expect(() => world.gift(gift('join', 'a', 'join', 0))).toThrow();
    expect(() => world.gift(gift('buff', 'a', 'buff'))).toThrow();
    world.gift(gift('join', 'a', 'join'));
    expect(world.gift(gift('buff', 'a', 'buff')).accepted).toBe(true);
  });
  it('角色数量受限，不会因为超额入场污染世界', () => {
    const world = new ArenaWorld(7, 2);
    world.gift(gift('join_a', 'a', 'join'));
    world.gift(gift('join_b', 'b', 'join'));
    expect(() => world.gift(gift('join_c', 'c', 'join'))).toThrow(/上限/);
    expect(world.players.size).toBe(2);
  });
  it('大额敏捷使用递减收益，攻速有上限', () => {
    expect(attacksPerSecond(0)).toBe(1);
    expect(attacksPerSecond(40)).toBe(2);
    expect(attacksPerSecond(1_000_000)).toBeLessThan(3);
  });
  it('相同种子与礼物产生一致结果，拆分时间步长不改变结算', () => {
    const a = pair(),
      b = pair();
    a.advance(10_000);
    for (let i = 0; i < 1000; i++) b.advance(10);
    expect(a.snapshot()).toEqual(b.snapshot());
    const snapshot = a.snapshot();
    snapshot.players[0]!.hp = 99999;
    expect(a.snapshot().players[0]!.hp).not.toBe(99999);
  });
});
