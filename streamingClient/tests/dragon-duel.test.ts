import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { strToU8 } from 'fflate';
import { LocalStore, decodeGift } from '@zhuda/core';
import { sceneSourceSchema, type SceneSource } from '@zhuda/contracts';
import { SceneManager, type ScenePlugins } from '../client/src/main/scenes/manager';
import { dragonSource, dragonPlugin } from '../../plugins/dragon/definitions';
import { pluginPack } from './plugin-fixtures';
import { gift } from './fixtures';
import { previewScene } from '../client/src/main/scenes/mobile-preview';

const ctx = { source: 'live' as const, runId: 'duel-test', webId: 'room1' };
function setup(overrides: Partial<SceneSource> = {}) {
  const source = { ...dragonSource, instructionSourceId: undefined, ...overrides };
  const item = pluginPack(
    { ...dragonPlugin, sceneSources: [source] },
    { 'assets/idle.mp4': strToU8('fixture') },
  ).item;
  const store = new LocalStore(':memory:');
  let enabled = true;
  const plugins: ScenePlugins = {
    sceneVersionAllowed: () => true,
    installedItem: () => {
      if (!enabled) throw new Error('已停用');
      return item;
    },
    validateInstalled() {
      return this.installedItem('plugin.dragon');
    },
    snapshot: () => ({ installed: [{ item, enabled }] }),
  };
  let engine = new SceneManager(store, plugins, () => ({ state: 'connected', webId: 'room1' }));
  engine.command({ action: 'add', pluginId: 'plugin.dragon', sourceId: 'duel' });
  const id = engine.snapshot().document.layers[0]!.id;
  const start = (mode: 'live' | 'demo' = 'demo') =>
    engine.command({ action: 'control', id, state: 'start', mode });
  const trigger = (eventId: string, amount: number, requestId = randomUUID()) =>
    engine.command({ action: 'trigger', id, eventId, amount, requestId });
  const view = () => engine.snapshot().layers[0]!;
  const run = (ms: number) => {
    vi.advanceTimersByTime(ms);
    engine.reconcile();
  };
  const send = (count: number, options = {}) => {
    const bytes = gift(count, options);
    return store.ingest(decodeGift(bytes, ctx), bytes, (g) => engine.ingest(g));
  };
  return {
    store,
    id,
    start,
    trigger,
    view,
    run,
    send,
    get engine() {
      return engine;
    },
    enabled: (v: boolean) => (enabled = v),
    restart: () =>
      (engine = new SceneManager(store, plugins, () => ({ state: 'connected', webId: 'room1' }))),
  };
}
const stores: LocalStore[] = [];
const fixture = (overrides: Partial<SceneSource> = {}) => {
  const f = setup(overrides);
  stores.push(f.store);
  return f;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T09:00:00Z'));
});
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.useRealTimers();
});
describe('双阵营定时对战插件', () => {
  it('礼物只训练属性，交战由主机时钟独立执行；双方属性均可增加', () => {
    const f = fixture();
    f.start();
    for (const side of ['hero', 'dragon'])
      for (const stat of ['health', 'attack', 'defense', 'speed']) f.trigger(`${side}-${stat}`, 10);
    expect(f.view().runtime.battle!.hero.hp).toBe(2410);
    expect(f.view().runtime.battle!.dragon.hp).toBe(3610);
    expect(f.view().runtime.battle!.lastClash).toBeNull();
    f.run(19999);
    expect(f.view().runtime.battle!.phase).toBe('prepare');
    f.run(1);
    const clash = f.view().runtime.battle!;
    expect(clash.phase).toBe('clash');
    expect(clash.lastClash!.damageToHero).toBeGreaterThan(0);
    const once = structuredClone(clash);
    f.engine.reconcile();
    expect(f.view().runtime.battle).toEqual(once);
  });
  it('足够防御能完全抵挡并回击，快过对方能闪避，攻击不足会被护甲挡住', () => {
    const f = fixture();
    f.start();
    f.trigger('hero-defense', 500);
    f.run(20000);
    expect(f.view().runtime.battle!.lastClash).toMatchObject({
      blocked: true,
      countered: true,
      damageToHero: 0,
      damageToDragon: 170,
    });
    f.engine.command({ action: 'control', id: f.id, state: 'reset' });
    f.trigger('hero-speed', 40);
    f.trigger('dragon-defense', 10000);
    f.run(20000);
    expect(f.view().runtime.battle!.lastClash).toMatchObject({
      dodged: true,
      countered: true,
      damageToHero: 0,
      damageToDragon: 0,
    });
  });
  it('没有足够速度或防御无法回击；恶龙强化攻击和速度会改变伤害', () => {
    const f = fixture();
    f.start();
    f.trigger('dragon-attack', 100);
    f.trigger('dragon-speed', 40);
    f.run(20000);
    expect(f.view().runtime.battle!.lastClash).toMatchObject({
      incoming: 920,
      damageToHero: 730,
      countered: false,
      damageToDragon: 0,
    });
  });
  it('交战前的加成部分消耗，交战期间收到的礼物完整留给下一次', () => {
    const f = fixture();
    f.start();
    f.trigger('hero-defense', 100);
    f.run(20000);
    expect(f.view().runtime.variables!.heroDefense).toBe(230);
    f.trigger('hero-defense', 100);
    f.run(dragonSource.battle!.clashSeconds * 1000);
    expect(f.view().runtime.variables!.heroDefense).toBe(330);
    f.run(20000);
    expect(f.view().runtime.battle!.lastClash!.hero.defense).toBe(330);
  });
  it('截止时间后的礼物不能回头救上一次攻击；致死后不能复活或继续加属性', () => {
    const f = fixture();
    f.start();
    f.trigger('dragon-attack', 100000);
    vi.advanceTimersByTime(20001);
    f.trigger('hero-health', 100000);
    expect(f.view().runtime.battle!.hero.hp).toBe(0);
    expect(f.view().runtime.battle!.winner).toBe('dragon');
    expect(f.view().runtime.variables!.heroHealth).toBe(2400);
    f.run(dragonSource.battle!.clashSeconds * 1000);
    expect(f.view().runtime.battle!.phase).toBe('finished');
    expect(f.view().runtime.game.round!.status).toBe('won');
  });
  it('高攻击、高防御可击败恶龙，结果只结算一次', () => {
    const f = fixture();
    f.start();
    f.trigger('hero-defense', 1000);
    f.trigger('hero-attack', 10000);
    f.run(20000);
    expect(f.view().runtime.battle!.winner).toBe('hero');
    f.run(dragonSource.battle!.clashSeconds * 1000);
    const done = f.view().runtime;
    f.run(100000);
    expect(f.view().runtime).toEqual(done);
  });
  it('暂停与重启保留双方生命、增益、倒计时，两个来源实例独立', () => {
    const f = fixture();
    f.start();
    f.trigger('hero-speed', 20);
    f.run(7000);
    f.engine.command({ action: 'control', id: f.id, state: 'pause' });
    f.run(60000);
    f.restart();
    expect(f.view().runtime.status).toBe('paused');
    expect(f.view().runtime.variables!.heroSpeed).toBe(70);
    f.engine.command({ action: 'control', id: f.id, state: 'resume' });
    f.run(12999);
    expect(f.view().runtime.battle!.lastClash).toBeNull();
    f.run(1);
    expect(f.view().runtime.battle!.lastClash).not.toBeNull();
    f.engine.command({ action: 'duplicate', id: f.id });
    const second = f.engine.snapshot().layers[1]!;
    expect(second.runtime.battle).toBeUndefined();
    expect(second.runtime.status).toBe('idle');
    expect(f.view().runtime.battle!.round).toBe(1);
  });
  it('真实范式连击只计新增量；重送、错房间和暂停不训练', () => {
    const f = fixture({
      rules: [{ giftId: '2001', giftName: '玫瑰', eventId: 'hero-speed', amount: 10, delta: 0 }],
    });
    f.start('live');
    f.send(1);
    f.send(1);
    f.send(3);
    f.send(3, { repeatEnd: 1 });
    expect(f.view().runtime.variables!.heroSpeed).toBe(80);
    f.engine.ingest({
      source: 'live',
      webId: 'other',
      delta: '99',
      quality: 'inferred',
      seq: '999',
      receivedAt: new Date().toISOString(),
      id: 'other',
      giftId: '2001',
      senderName: 'test',
    } as never);
    expect(f.view().runtime.variables!.heroSpeed).toBe(80);
    f.run(1);
    expect(f.view().runtime.status).toBe('running');
    f.send(4);
    expect(f.view().runtime.variables!.heroSpeed).toBeGreaterThan(80);
  });
  it('模拟请求幂等，数值封顶，手机投影读取同一份战斗状态', () => {
    const f = fixture();
    f.start();
    const key = randomUUID();
    f.trigger('hero-health', 1000000, key);
    f.trigger('hero-health', 1000000, key);
    expect(f.view().runtime.battle!.hero.maxHp).toBe(1002400);
    f.run(20000);
    const snap = f.engine.snapshot();
    const projected = previewScene(snap, 'http://127.0.0.1:1234/');
    expect(projected.layers[0]!.runtime.battle).toEqual(snap.layers[0]!.runtime.battle);
  });
  it('高份数生命礼物安全封顶，截止点暂停会先结算已经发生的攻击', () => {
    const f = fixture({
      rules: [
        { giftId: '2001', giftName: '玫瑰', eventId: 'hero-health', amount: 1000000, delta: 0 },
      ],
    });
    f.start();
    f.engine.command({
      action: 'simulate',
      id: f.id,
      giftId: '2001',
      quantity: '999999',
      requestId: randomUUID(),
    });
    expect(f.view().runtime.battle!.hero.maxHp).toBe(1000000000);
    expect(f.view().runtime.battle!.hero.hp).toBe(1000000000);
    vi.advanceTimersByTime(20001);
    f.engine.command({ action: 'control', id: f.id, state: 'pause' });
    expect(f.view().runtime.battle!.lastClash!.damageToHero).toBe(242);
    expect(f.view().runtime.status).toBe('paused');
  });
  it('宣告版本与八项属性须完整；影片仍受签章与路径检查', () => {
    expect(
      sceneSourceSchema.safeParse({
        ...dragonSource,
        battle: { ...dragonSource.battle, version: 2 },
      }).success,
    ).toBe(false);
    expect(sceneSourceSchema.safeParse({ ...dragonSource, variables: [] }).success).toBe(false);
    expect(() =>
      pluginPack({ ...dragonPlugin, sceneSources: [] }, { '../idle.mp4': strToU8('bad') }),
    ).toThrow();
  });
});
