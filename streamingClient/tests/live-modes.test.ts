import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LocalStore, decodeGift, decodeMetric, protocolRoot } from '@zhuda/core';
import {
  sceneSourceSchema,
  validateGameRules,
  type SceneEvent,
  type SceneLayer,
  type SceneRuntime,
} from '@zhuda/contracts';
import {
  liveModePlugins,
  sewingSource,
  tasksSource,
  taskBarSources,
} from '../../plugins/live-modes/definitions';
import { SceneManager, type ScenePlugins } from '../client/src/main/scenes/manager';
import { pluginPack } from './plugin-fixtures';
import { gift } from './fixtures';
import { SettingsQueue } from '../client/src/renderer/settings-queue';

function fixture() {
  const store = new LocalStore(':memory:');
  const items = liveModePlugins.map(
    (info) =>
      pluginPack(
        info,
        Object.fromEntries(
          info.sceneSources!.map((s) => [s.entry, new TextEncoder().encode('<div>测试</div>')]),
        ),
      ).item,
  );
  const plugins: ScenePlugins = {
    sceneVersionAllowed: () => true,
    installedItem: (id) => items.find((i) => i.manifest.id === id)!,
    validateInstalled: (id) => items.find((i) => i.manifest.id === id)!,
    snapshot: () => ({ installed: items.map((item) => ({ item, enabled: true })) }),
  };
  let manager = new SceneManager(store, plugins, () => ({ state: 'connected', webId: 'room1' }));
  return {
    store,
    get manager() {
      return manager;
    },
    add(id: 'sewing' | 'tasks' | `task-${string}`, mode: 'demo' | 'live' = 'demo') {
      manager.command({
        action: 'add',
        pluginId: `plugin.${id.startsWith('task-') ? 'tasks' : id}`,
        sourceId: id,
      });
      const layer = manager.snapshot().layers.at(-1)!.layer;
      manager.command({
        action: 'control',
        id: layer.id,
        state: 'start',
        mode,
        initial: id === 'sewing' ? '3000' : undefined,
      });
      return layer.id;
    },
    view(id: string) {
      return manager.snapshot().layers.find((l) => l.layer.id === id)!;
    },
    trigger(id: string, eventId: string, amount = 1, requestId = randomUUID()) {
      manager.command({ action: 'trigger', id, eventId, amount, requestId });
    },
    restart() {
      manager = new SceneManager(store, plugins, () => ({ state: 'connected', webId: 'room1' }));
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('直播玩法状态', () => {
  it('缝纫机加入场景即从一块布运行，直接改数不重开回合且完成后恢复原倒计时', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T06:00:00Z'));
    const f = fixture();
    try {
      f.manager.command({ action: 'add', pluginId: 'plugin.sewing', sourceId: 'sewing' });
      const id = f.manager.snapshot().layers[0]!.layer.id;
      const round = f.view(id).runtime.game.round!;
      expect(round.remaining).toBe('1');
      expect(f.view(id).runtime.status).toBe('running');
      vi.advanceTimersByTime(10000);
      f.manager.command({ action: 'setCounter', id, value: '0' });
      expect(f.view(id).variables?.seconds).toBe(1790);
      vi.advanceTimersByTime(30000);
      f.manager.command({ action: 'setCounter', id, value: '20' });
      expect(f.view(id).variables?.seconds).toBe(1790);
      expect(f.view(id).runtime.game.round).toMatchObject({
        id: round.id,
        remaining: '20',
        status: 'running',
      });
      expect(f.view(id).runtime.completionId).toBeUndefined();
      vi.advanceTimersByTime(1000);
      expect(f.view(id).variables?.seconds).toBe(1789);
      f.manager.globalGift('2001', '1', randomUUID());
      expect(f.view(id).runtime.game.round?.remaining).toBe('21');
      f.manager.globalGift('1', '1', randomUUID());
      expect(f.view(id).runtime.game.round?.remaining).toBe('20');
    } finally {
      f.store.close();
    }
  });
  it('完成标识与时长只生成一次，加工作量取消后再次完成生成新标识', () => {
    const f = fixture();
    try {
      const id = f.add('sewing');
      f.manager.command({ action: 'settings', id, values: { completionDuration: 3 } });
      f.trigger(id, 'release');
      const first = f.view(id).runtime;
      expect(first.completionId).toBeTruthy();
      expect(first.completionDurationMs).toBe(3000);
      f.trigger(id, 'stitch-remove', 10);
      expect(f.view(id).runtime.completionId).toBe(first.completionId);
      f.manager.command({ action: 'settings', id, values: { completionDuration: 5 } });
      expect(f.view(id).runtime.completionDurationMs).toBe(3000);
      f.trigger(id, 'stitch-add', 10);
      expect(f.view(id).runtime.completionId).toBeUndefined();
      expect(f.view(id).runtime.completedAt).toBeUndefined();
      f.trigger(id, 'release');
      expect(f.view(id).runtime.completionId).not.toBe(first.completionId);
      expect(f.view(id).runtime.completionDurationMs).toBe(5000);
    } finally {
      f.store.close();
    }
  });
  it('插件声明可验证，非法变量、目标和礼物映射被拒绝', () => {
    for (const source of [sewingSource, tasksSource, ...taskBarSources]) {
      expect(sceneSourceSchema.safeParse(source).success).toBe(true);
      expect(validateGameRules(source.events, source.rules)).toEqual(source.rules);
    }
    expect(
      sceneSourceSchema.safeParse({
        ...tasksSource,
        observations: [{ kind: 'like', target: 'missing' }],
      }).success,
    ).toBe(false);
  });
  it('组合任务拆分保留目标、进度、礼物映射和热键，各进度条独立调整与补触发', () => {
    const f = fixture();
    try {
      const id = f.add('tasks');
      f.manager.command({
        action: 'settings',
        id,
        values: { scoreGoal: 20000, likeGoal: 5000, scoreTitle: '今晚的心愿', accent: '#80dcff' },
      });
      f.trigger(id, 'score-add', 600);
      f.manager.command({
        action: 'simulateObservation',
        id,
        kind: 'like',
        quantity: 120,
        requestId: randomUUID(),
      });
      f.manager.command({
        action: 'hotkeys',
        id,
        revision: f.manager.snapshot().document.revision,
        bindings: [
          {
            id: randomUUID(),
            eventId: 'score-add',
            amount: 10,
            accelerator: 'Control+1',
            enabled: true,
          },
        ],
      });
      const original = f.view(id),
        revision = f.manager.snapshot().document.revision;
      f.manager.command({ action: 'split', id, revision });
      const views = f.manager.snapshot().layers;
      expect(views).toHaveLength(4);
      expect(views.every((v) => v.runtime.status === 'running')).toBe(true);
      const score = views.find((v) => v.layer.sourceId === 'task-score')!,
        likes = views.find((v) => v.layer.sourceId === 'task-likes')!;
      expect(score.layer.id).toBe(id);
      expect(score.variables).toEqual({ score: 600 });
      expect(score.layer.settings).toMatchObject({
        scoreGoal: 20000,
        scoreTitle: '今晚的心愿',
        accent: '#80dcff',
      });
      expect(score.layer.rules).toEqual(original.layer.rules);
      expect(score.layer.hotkeys).toEqual(original.layer.hotkeys);
      expect(score.runtime.game.round?.id).toBe(original.runtime.game.round?.id);
      expect(likes.variables).toEqual({ likes: 120 });
      expect(likes.layer.settings.likeGoal).toBe(5000);
      expect(likes.layer.rules).toEqual([]);
      expect(likes.layer.hotkeys).toEqual([]);
      expect(likes.layer.contentSize).toEqual({ width: 1000, height: 144 });
      f.manager.command({
        action: 'patch',
        id: likes.layer.id,
        revision: f.manager.snapshot().document.revision,
        patch: { x: 25, width: 500, height: 72 },
      });
      expect(f.view(id).layer).toEqual(score.layer);
      f.trigger(likes.layer.id, 'likes-add', 80);
      expect(f.view(likes.layer.id).variables?.likes).toBe(200);
      expect(f.view(id).variables?.score).toBe(600);
      f.restart();
      expect(f.manager.snapshot().layers).toHaveLength(4);
      expect(f.view(likes.layer.id).variables?.likes).toBe(200);
      expect(f.view(id).variables?.score).toBe(600);
    } finally {
      f.store.close();
    }
  });
  it('拆分保留观测去重，重复点赞、已送礼观众与已关注观众不重复计数', () => {
    const f = fixture();
    try {
      const id = f.add('tasks', 'live');
      const event: SceneEvent = {
        id: 'before-like',
        kind: 'message',
        source: 'live',
        webId: 'room1',
        at: new Date().toISOString(),
        data: { metric: 'like', quantity: 100, senderId: 'user1' },
      };
      f.manager.event(event);
      f.manager.event({
        ...event,
        id: 'before-follow',
        data: { metric: 'follow', senderId: 'user1' },
      });
      const context = { source: 'live' as const, runId: 'run', webId: 'room1' };
      const send = (msgId: string) => {
        const bytes = gift(1, { common: { msgId, roomId: '101' }, groupId: msgId });
        f.store.ingest(decodeGift(bytes, context), bytes, (g) => f.manager.ingest(g));
      };
      send('9001');
      f.manager.command({ action: 'split', id, revision: f.manager.snapshot().document.revision });
      f.manager.event(event);
      f.manager.event({
        ...event,
        id: 'after-follow',
        data: { metric: 'follow', senderId: 'user1' },
      });
      send('9002');
      const views = f.manager.snapshot().layers;
      expect(views.find((v) => v.layer.sourceId === 'task-gifts')!.variables).toEqual({
        giftPeople: 1,
      });
      expect(views.find((v) => v.layer.sourceId === 'task-follows')!.variables).toEqual({
        follows: 1,
      });
      expect(views.find((v) => v.layer.sourceId === 'task-likes')!.variables).toEqual({
        likes: 100,
      });
      f.manager.event({ ...event, id: 'new-like', data: { metric: 'like', quantity: 50 } });
      expect(
        f.manager.snapshot().layers.find((v) => v.layer.sourceId === 'task-likes')!.variables
          ?.likes,
      ).toBe(150);
    } finally {
      f.store.close();
    }
  });
  it('独立进度条只接收自己的观测，锁定或过期版本的拆分请求不改动场景', () => {
    const f = fixture();
    try {
      const likes = f.add('task-likes', 'live'),
        follows = f.add('task-follows', 'live');
      f.manager.event({
        id: 'like',
        kind: 'message',
        source: 'live',
        webId: 'room1',
        at: new Date().toISOString(),
        data: { metric: 'like', quantity: 100 },
      });
      expect(f.view(likes).variables).toEqual({ likes: 100 });
      expect(f.view(follows).variables).toEqual({ follows: 0 });
      const id = f.add('tasks');
      const oldRevision = f.manager.snapshot().document.revision;
      f.manager.command({ action: 'patch', id, revision: oldRevision, patch: { locked: true } });
      expect(() => f.manager.command({ action: 'split', id, revision: oldRevision })).toThrow();
      expect(() =>
        f.manager.command({
          action: 'split',
          id,
          revision: f.manager.snapshot().document.revision,
        }),
      ).toThrow(/锁定/);
      expect(f.manager.snapshot().layers).toHaveLength(3);
    } finally {
      f.store.close();
    }
  });
  it('缝纫任务加减、连击倍增、清空开门和请求去重', () => {
    const f = fixture();
    try {
      const id = f.add('sewing');
      const requestId = randomUUID();
      f.trigger(id, 'stitch-add', 100, requestId);
      f.trigger(id, 'stitch-add', 100, requestId);
      expect(f.view(id).runtime.game.round?.remaining).toBe('3100');
      f.trigger(id, 'stitch-multiply', 3);
      expect(f.view(id).runtime.game.round?.remaining).toBe('9300');
      f.trigger(id, 'stitch-remove', 300);
      expect(f.view(id).runtime.game.round?.remaining).toBe('9000');
      f.trigger(id, 'release');
      expect(f.view(id).runtime.status).toBe('running');
      expect(f.view(id).runtime.game.round?.status).toBe('won');
      expect(f.view(id).runtime.game.round?.remaining).toBe('0');
      const roundId = f.view(id).runtime.game.round?.id;
      f.trigger(id, 'stitch-remove', 100);
      expect(f.view(id).runtime.game.lastAction?.won).toBe(false);
      f.trigger(id, 'stitch-add', 100);
      expect(f.view(id).runtime.game.round).toMatchObject({
        id: roundId,
        status: 'running',
        remaining: '100',
      });
      f.trigger(id, 'release');
      expect(f.view(id).runtime.status).toBe('running');
      expect(f.view(id).runtime.game.lastAction?.won).toBe(true);
    } finally {
      f.store.close();
    }
  });
  it('倒计时加减和翻倍以当前剩余时间计算，暂停和重启保留', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
    const f = fixture();
    try {
      const id = f.add('sewing');
      vi.advanceTimersByTime(10000);
      expect(f.view(id).variables?.seconds).toBe(1790);
      f.trigger(id, 'time-add', 60);
      f.trigger(id, 'time-multiply', 2);
      expect(f.view(id).variables?.seconds).toBe(3700);
      f.manager.command({ action: 'control', id, state: 'pause' });
      vi.advanceTimersByTime(20000);
      expect(f.view(id).variables?.seconds).toBe(3700);
      f.restart();
      expect(f.view(id).variables?.seconds).toBe(3700);
      f.manager.command({ action: 'control', id, state: 'resume' });
      f.trigger(id, 'time-remove', 5000);
      f.manager.reconcile();
      expect(f.view(id).runtime.status).toBe('running');
      expect(f.view(id).runtime.game.round?.status).toBe('won');
      f.trigger(id, 'time-add', 60);
      expect(f.view(id).runtime.game.round?.status).toBe('running');
      expect(f.view(id).variables?.seconds).toBe(60);
      f.trigger(id, 'time-remove', 100);
      vi.advanceTimersByTime(10000);
      f.trigger(id, 'stitch-add', 100);
      expect(f.view(id).runtime.game.round).toMatchObject({ status: 'running', remaining: '3100' });
      expect(f.view(id).variables?.seconds).toBe(1800);
    } finally {
      f.store.close();
    }
  });
  it('针数完成时冻结倒计时，批量倍增不丢精度也不会无限运算', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
    const f = fixture();
    try {
      const id = f.add('sewing');
      vi.advanceTimersByTime(10000);
      f.trigger(id, 'release');
      expect(f.view(id).variables?.seconds).toBe(1790);
      vi.advanceTimersByTime(10000);
      expect(f.view(id).variables?.seconds).toBe(1790);
      f.trigger(id, 'stitch-add', 100);
      expect(f.view(id).variables?.seconds).toBe(1790);
      vi.advanceTimersByTime(10000);
      expect(f.view(id).variables?.seconds).toBe(1780);
      f.manager.command({ action: 'control', id, state: 'reset', mode: 'demo', initial: '3000' });
      f.manager.command({
        action: 'patch',
        id,
        revision: f.manager.snapshot().document.revision,
        patch: {
          rules: [
            { giftId: '2001', giftName: '玫瑰', eventId: 'stitch-multiply', amount: 3, delta: 0 },
          ],
        },
      });
      f.manager.command({
        action: 'simulate',
        id,
        giftId: '2001',
        quantity: '2',
        requestId: randomUUID(),
      });
      expect(f.view(id).runtime.game.round?.remaining).toBe('27000');
      f.manager.command({
        action: 'simulate',
        id,
        giftId: '2001',
        quantity: '999999',
        requestId: randomUUID(),
      });
      expect(f.view(id).runtime.game.round?.remaining).toBe('9'.repeat(40));
      const tasks = f.add('tasks');
      f.manager.command({
        action: 'patch',
        id: tasks,
        revision: f.manager.snapshot().document.revision,
        patch: {
          rules: [
            {
              giftId: '2001',
              giftName: '玫瑰',
              eventId: 'score-multiply',
              amount: 1000000,
              delta: 0,
            },
          ],
        },
      });
      f.manager.command({
        action: 'simulate',
        id: tasks,
        giftId: '2001',
        quantity: '999999',
        requestId: randomUUID(),
      });
      expect(f.view(tasks).variables?.score).toBe(0);
    } finally {
      f.store.close();
    }
  });
  it('真实礼物在完工后继续路由、去重；主动暂停或停止才拒绝新事件', () => {
    const f = fixture();
    try {
      const id = f.add('sewing', 'live');
      const roundId = f.view(id).runtime.game.round!.id;
      const send = (giftId: string, quantity: number, msg: string) => {
        const bytes = gift(quantity, {
          giftId,
          groupCount: String(quantity),
          comboCount: '1',
          groupId: msg,
          common: { msgId: msg, roomId: '101' },
        });
        f.store.ingest(
          decodeGift(bytes, { source: 'live', runId: 'run', webId: 'room1' }),
          bytes,
          (g) => f.manager.ingest(g),
        );
      };
      send('1', 3000, '501');
      expect(f.view(id).runtime.game.round?.status).toBe('won');
      expect(f.view(id).runtime.status).toBe('running');
      send('2001', 1, '502');
      send('2001', 1, '502');
      expect(f.view(id).runtime.game.round).toMatchObject({
        id: roundId,
        remaining: '1',
        status: 'running',
      });
      f.manager.command({ action: 'control', id, state: 'pause' });
      send('2001', 1, '503');
      expect(f.view(id).runtime.game.round?.remaining).toBe('1');
      f.manager.command({ action: 'control', id, state: 'resume' });
      send('1', 1, '504');
      expect(f.view(id).runtime.game.round?.status).toBe('won');
      f.manager.command({ action: 'control', id, state: 'stop' });
      send('2001', 1, '505');
      expect(f.view(id).runtime.game.round?.remaining).toBe('0');
      expect(f.view(id).runtime.status).toBe('stopped');
    } finally {
      f.store.close();
    }
  });
  it('任务分与观测独立存储，礼物同一用户去重，真实观测不会进入试玩', () => {
    const f = fixture();
    try {
      const id = f.add('tasks', 'live'),
        demo = f.add('tasks');
      const context = { source: 'live' as const, runId: 'run', webId: 'room1' };
      for (let i = 0; i < 2; i++) {
        const bytes = gift(1, {
          common: { msgId: String(300 + i), roomId: '101' },
          groupId: String(900 + i),
        });
        f.store.ingest(decodeGift(bytes, context), bytes, (gift) => f.manager.ingest(gift));
      }
      expect(f.view(id).variables?.giftPeople).toBe(1);
      const event: SceneEvent = {
        id: 'like1',
        kind: 'message',
        source: 'live',
        webId: 'room1',
        at: new Date().toISOString(),
        data: { metric: 'like', quantity: 100, senderId: 'user1' },
      };
      f.manager.event(event);
      f.manager.event(event);
      f.manager.event({ ...event, id: 'follow1', data: { metric: 'follow', senderId: 'user1' } });
      f.manager.event({ ...event, id: 'follow2', data: { metric: 'follow', senderId: 'user1' } });
      expect(f.view(id).variables).toMatchObject({ likes: 100, follows: 1, giftPeople: 1 });
      expect(f.view(demo).variables).toEqual({ likes: 0, follows: 0, giftPeople: 0, score: 0 });
      f.trigger(demo, 'score-add', 500);
      f.trigger(demo, 'score-multiply', 3);
      f.trigger(demo, 'score-remove', 100);
      expect(f.view(demo).variables?.score).toBe(1400);
      f.trigger(demo, 'score-add', 10000);
      f.trigger(demo, 'score-add', 100);
      expect(f.view(demo).variables?.score).toBe(11500);
      expect(f.view(demo).runtime.status).toBe('running');
      f.restart();
      expect(f.view(demo).variables?.score).toBe(11500);
    } finally {
      f.store.close();
    }
  });
  it('旧完成态重开后可继续同一回合，补布不重置映射或冻结的剩余时间', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
    const f = fixture();
    try {
      const id = f.add('sewing');
      vi.advanceTimersByTime(10000);
      f.trigger(id, 'release');
      const state = f.store.get<{ runtimes: Record<string, SceneRuntime> }>('scene:state', {
        runtimes: {},
      });
      state.runtimes[id]!.status = 'won';
      state.runtimes[id]!.elapsedMs = 10000;
      delete state.runtimes[id]!.completedAt;
      const roundId = state.runtimes[id]!.game.round!.id;
      f.store.set('scene:state', state);
      f.restart();
      expect(f.view(id).runtime.status).toBe('paused');
      f.manager.command({ action: 'control', id, state: 'resume' });
      vi.advanceTimersByTime(10000);
      f.trigger(id, 'stitch-add', 100);
      expect(f.view(id).runtime.game.round).toMatchObject({
        id: roundId,
        status: 'running',
        remaining: '100',
      });
      expect(f.view(id).variables?.seconds).toBe(1790);
      expect(f.view(id).layer.rules).toEqual(sewingSource.rules);
    } finally {
      f.store.close();
    }
  });
  it('实时参数更新只合并改变的项，拒绝锁定和切换后旧场景请求', () => {
    const f = fixture();
    try {
      const id = f.add('tasks'),
        sceneId = f.manager.snapshot().document.id;
      f.manager.command({ action: 'settings', id, values: { color: '#123456' } });
      f.manager.command({ action: 'settings', id, values: { accent: '#abcdef' } });
      expect(f.view(id).layer.settings).toMatchObject({
        color: '#123456',
        accent: '#abcdef',
        title: '今日直播任务',
      });
      f.manager.command({
        action: 'patch',
        id,
        revision: f.manager.snapshot().document.revision,
        patch: { locked: true },
      });
      expect(() =>
        f.manager.command({ action: 'settings', id, values: { color: '#ffffff' } }),
      ).toThrow(/锁定/);
      f.manager.command({ action: 'sceneCreate', name: '其他主播' });
      expect(() =>
        f.manager.command({ action: 'settings', sceneId, id, values: { color: '#ffffff' } }),
      ).toThrow(/切换/);
    } finally {
      f.store.close();
    }
  });
});

it('连续取色合并排队，保留最终颜色和其他参数，不跨场景覆盖', async () => {
  let release: ((ok: boolean) => void) | undefined;
  const calls: unknown[] = [];
  const queue = new SettingsQueue(async (sceneId, id, values) => {
    calls.push({ sceneId, id, values });
    if (calls.length === 1)
      return new Promise<boolean>((resolve) => {
        release = resolve;
      });
    return true;
  });
  const first = queue.save('s1', 'l1', { color: '#000000' });
  const a = queue.save('s1', 'l1', { color: '#123456' }),
    b = queue.save('s1', 'l1', { color: '#abcdef', accent: '#ffffff' });
  const c = queue.save('s2', 'l1', { color: '#654321' });
  release!(true);
  expect(await Promise.all([first, a, b, c])).toEqual([true, true, true, true]);
  expect(calls).toEqual([
    { sceneId: 's1', id: 'l1', values: { color: '#000000' } },
    { sceneId: 's1', id: 'l1', values: { color: '#abcdef', accent: '#ffffff' } },
    { sceneId: 's2', id: 'l1', values: { color: '#654321' } },
  ]);
});

it('点赞使用消息增量，关注只接受关注动作，拒绝累计量与解析异常', () => {
  const encode = (name: string, value: object) =>
    protocolRoot.lookupType(name).encode(value).finish();
  const like = {
    method: 'WebcastLikeMessage',
    messageId: '100',
    payload: encode('LikeMessage', {
      count: 7,
      total: 999999,
      user: { id: 13, nickname: '测试用户' },
    }),
  };
  expect(decodeMetric(like)).toMatchObject({ metric: 'like', quantity: 7, senderId: '13' });
  expect(
    decodeMetric({ ...like, payload: encode('LikeMessage', { total: 9000, user: { id: 13 } }) }),
  ).toBeNull();
  const follow = {
    method: 'WebcastSocialMessage',
    messageId: '101',
    payload: encode('SocialMessage', { action: 1, user: { id: 13 }, followCount: 500 }),
  };
  expect(decodeMetric(follow)).toMatchObject({ metric: 'follow', quantity: 1 });
  expect(
    decodeMetric({
      ...follow,
      payload: encode('SocialMessage', { action: 3, shareType: 1, user: { id: 13 } }),
    }),
  ).toBeNull();
  expect(decodeMetric({ ...like, payload: new Uint8Array([255]) })).toBeNull();
});
