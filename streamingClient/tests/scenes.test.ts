import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LocalStore, decodeGift } from '@zhuda/core';
import {
  eventsFor,
  type SceneSource,
  type PluginCatalogItem,
  type SceneLayer,
  type SceneDocument,
  type SceneRuntime,
} from '@zhuda/contracts';
import { SceneManager, type ScenePlugins } from '../client/src/main/scenes/manager';
import { pluginPack } from './plugin-fixtures';
import { gift, manifest } from './fixtures';
import type { SceneHotkey } from '@zhuda/contracts';
const source: SceneSource = {
  id: 'chain',
  name: '锁链',
  description: 'test',
  entry: 'index.html',
  width: 1080,
  height: 1920,
  parameters: [{ key: 'label', label: '标题', type: 'text', default: '锁链' }],
  events: eventsFor(manifest),
  rules: manifest.rules,
  themes: [{ id: 'classic', name: '原版', description: 'test', accent: '#ffffff' }],
  defaultTheme: 'classic',
  counter: { initial: '4000', label: '根' },
};
const ctx = { source: 'live' as const, runId: 'run', webId: 'room1' };
const statusSource: SceneSource = {
  id: 'chain-status',
  kind: 'status',
  targetSourceId: 'chain',
  name: '锁链状态面板',
  description: 'test',
  entry: 'index.html',
  width: 720,
  height: 240,
  sizing: 'scale',
  runtime: 'static',
  parameters: [{ key: 'title', label: '标题', type: 'text', default: '解锁挑战', live: true }],
  events: [],
  rules: [],
  themes: [],
};
type SavedState = { document: SceneDocument; runtimes: Record<string, SceneRuntime> };
function fixture(sourceName = source.name, customInstructions = false, withStatus = false) {
  const store = new LocalStore(':memory:');
  let enabled = true;
  let current = pluginPack({
    id: 'plugin.chain',
    permissions: ['scene-events'],
    sceneSources: withStatus
      ? [{ ...source, name: sourceName, statusSourceId: statusSource.id }, statusSource]
      : [{ ...source, name: sourceName }],
  }).item;
  const guideSource: SceneSource = {
    id: 'instructions',
    kind: 'instructions',
    name: '玩法说明',
    description: 'test',
    entry: 'index.html',
    width: 900,
    height: 320,
    parameters: [],
    events: [],
    rules: [],
    themes: [],
  };
  const basics = pluginPack({ id: 'plugin.scene-basics', sceneSources: [guideSource] }).item;
  if (customInstructions)
    current = pluginPack({
      id: 'plugin.chain',
      permissions: ['scene-events'],
      sceneSources: [
        { ...source, name: sourceName, instructionSourceId: 'instructions' },
        guideSource,
      ],
    }).item;
  const versions = new Map([[current.manifest.version, current]]);
  const plugins: ScenePlugins = {
    sceneVersionAllowed: () => false,
    installedItem(id, version) {
      if (id === 'plugin.scene-basics') return basics;
      if (!enabled || id !== 'plugin.chain') throw new Error('未激活');
      if (!version || version === current.manifest.version) return current;
      if (!this.sceneVersionAllowed(id, version) || !versions.has(version))
        throw new Error('旧版不可用');
      return versions.get(version)!;
    },
    validateInstalled(id, version) {
      return this.installedItem(id, version);
    },
    snapshot: () => ({ installed: [{ item: current, enabled }] }),
  };
  const connection = { state: 'connected', webId: ctx.webId };
  let engine = new SceneManager(
    store,
    plugins,
    () => connection,
    (id) =>
      id === '2001'
        ? { name: '玫瑰', icon: 'zhuda-scene://media/' + 'a'.repeat(64) + '.png' }
        : undefined,
  );
  const run = (id: string, mode: 'live' | 'demo' = 'live') =>
    engine.command({ action: 'control', id, state: 'start', mode, initial: '4000' });
  const add = () => {
    engine.command({ action: 'add', pluginId: 'plugin.chain', sourceId: 'chain' });
    return engine
      .snapshot()
      .document.layers.filter((l) => l.sourceId === 'chain')
      .at(-1)!.id;
  };
  const patch = (id: string, patch: Partial<SceneLayer>) =>
    engine.command({ action: 'patch', id, revision: engine.snapshot().document.revision, patch });
  const send = (count: number, options = {}) => {
    const bytes = gift(count, options);
    return store.ingest(decodeGift(bytes, ctx), bytes, (g) => engine.ingest(g));
  };
  return {
    store,
    plugins,
    add,
    run,
    patch,
    send,
    connection,
    get engine() {
      return engine;
    },
    setEnabled: (v: boolean) => (enabled = v),
    restart: () => (engine = new SceneManager(store, plugins, () => connection)),
    upgrade: (nextSource: SceneSource = source, components: SceneSource[] = []) => {
      current = pluginPack({
        id: 'plugin.chain',
        version: '1.1.0',
        permissions: ['scene-events'],
        sceneSources: [
          nextSource,
          ...(nextSource.statusSourceId ? [statusSource] : []),
          ...components,
        ],
      }).item;
      versions.set('1.1.0', current);
    },
  };
}
describe('场景主机与独立插件实例', () => {
  it('直接修改当前数量保持回合、映射和其他图层，清零后仍响应全局礼物', () => {
    const f = fixture('锁链', false, true);
    try {
      const id = f.add(),
        other = f.add();
      const before = f.engine.snapshot();
      const round = before.layers.find((view) => view.layer.id === id)!.runtime.game.round!;
      f.engine.command({ action: 'setCounter', id, value: '12' });
      let view = f.engine.snapshot().layers.find((entry) => entry.layer.id === id)!;
      expect(view.runtime.game.round).toMatchObject({
        id: round.id,
        initial: round.initial,
        remaining: '12',
        startedAt: round.startedAt,
      });
      expect(view.layer.initial).toBe(source.counter!.initial);
      expect(view.layer.rules).toEqual(
        before.layers.find((entry) => entry.layer.id === id)!.layer.rules,
      );
      expect(f.engine.snapshot().document.revision).toBe(before.document.revision);
      expect(
        f.engine.snapshot().layers.find((entry) => entry.layer.binding?.targetLayerId === id)!
          .runtime.game.round?.remaining,
      ).toBe('12');
      expect(
        f.engine.snapshot().layers.find((entry) => entry.layer.id === other)!.runtime.game.round
          ?.remaining,
      ).toBe(source.counter!.initial);
      f.engine.command({ action: 'setCounter', id, value: '0' });
      view = f.engine.snapshot().layers.find((entry) => entry.layer.id === id)!;
      expect(view.runtime.status).toBe('running');
      expect(view.runtime.game.round?.status).toBe('won');
      expect(view.runtime.completionId).toBeTruthy();
      f.engine.command({ action: 'setCounter', id, value: '50' });
      view = f.engine.snapshot().layers.find((entry) => entry.layer.id === id)!;
      expect(view.runtime.completionId).toBeUndefined();
      expect(view.runtime.game.round).toMatchObject({
        id: round.id,
        status: 'running',
        remaining: '50',
      });
      f.engine.globalGift('2001', '1', randomUUID());
      expect(
        f.engine.snapshot().layers.find((entry) => entry.layer.id === id)!.runtime.game.round
          ?.remaining,
      ).toBe('40');
      f.engine.command({ action: 'setCounter', id, value: '42' });
      view = f.engine.snapshot().layers.find((entry) => entry.layer.id === id)!;
      expect(view.runtime.game.recent).toEqual([]);
      expect(view.runtime.game.lastAction).toBeNull();
      for (const value of ['-1', '1.5', '1000000000', 'NaN'])
        expect(() => f.engine.command({ action: 'setCounter', id, value })).toThrow();
      expect(
        f.engine.snapshot().layers.find((entry) => entry.layer.id === id)!.runtime.game.round
          ?.remaining,
      ).toBe('42');
    } finally {
      f.store.close();
    }
  });
  it('计数玩法加入场景即运行，全局礼物让所有玩法一起响应并在换房间时重置回合', () => {
    const f = fixture();
    try {
      const first = f.add();
      const second = f.add();
      const ready = f.engine.snapshot().layers.filter((view) => view.layer.sourceId === 'chain');
      expect(ready).toHaveLength(2);
      expect(ready.every((view) => view.runtime.status === 'running')).toBe(true);
      expect(ready.every((view) => view.runtime.mode === 'live')).toBe(true);
      expect(
        ready.every((view) => view.runtime.game.round?.remaining === source.counter!.initial),
      ).toBe(true);

      f.engine.globalGift('2001', '2', randomUUID(), '全局测试观众');
      const afterGift = f.engine
        .snapshot()
        .layers.filter((view) => view.layer.sourceId === 'chain');
      expect(afterGift.every((view) => view.runtime.game.round?.remaining === '3980')).toBe(true);
      const oldRoundIds = new Set(afterGift.map((view) => view.runtime.game.round?.id));

      f.connection.webId = 'room2';
      f.engine.resetEventSession();
      const reset = f.engine.snapshot().layers.filter((view) => view.layer.sourceId === 'chain');
      expect(reset.every((view) => view.runtime.status === 'running')).toBe(true);
      expect(
        reset.every((view) => view.runtime.game.round?.remaining === source.counter!.initial),
      ).toBe(true);
      expect(reset.every((view) => view.runtime.webId === 'room2')).toBe(true);

      f.engine.globalGift('2001', '1', randomUUID(), '新房间观众');
      const next = f.engine.snapshot().layers.filter((view) => view.layer.sourceId === 'chain');
      expect(next.every((view) => view.runtime.game.round?.remaining === '3990')).toBe(true);
      expect(next.every((view) => !oldRoundIds.has(view.runtime.game.round?.id))).toBe(true);
      expect(first).not.toBe(second);
    } finally {
      f.store.close();
    }
  });

  it('全局热键按映射礼物分发给场景内所有玩法', () => {
    const f = fixture();
    try {
      f.add();
      f.add();
      const binding = {
        id: randomUUID(),
        accelerator: 'CommandOrControl+F7',
        giftId: '2001',
        quantity: 1,
        enabled: true,
      };
      f.engine.command({
        action: 'globalHotkeys',
        revision: f.engine.snapshot().document.revision,
        bindings: [binding],
      });
      f.engine.command({
        action: 'globalHotkey',
        hotkeyId: binding.id,
        requestId: randomUUID(),
      });
      const layers = f.engine.snapshot().layers.filter((view) => view.layer.sourceId === 'chain');
      expect(layers).toHaveLength(2);
      expect(layers.every((view) => view.runtime.game.round?.remaining === '3990')).toBe(true);
      expect(layers.every((view) => view.runtime.events.at(-1)?.kind === 'gift')).toBe(true);
    } finally {
      f.store.close();
    }
  });

  it('状态面板独立缩放和保存，逐实例跟随实时数量与暂停，不重复处理礼物', () => {
    const f = fixture('锁链', false, true);
    try {
      const a = f.add(),
        b = f.add();
      const panels = () => f.engine.snapshot().layers.filter((v) => v.source?.kind === 'status');
      const panel = panels().find((v) => v.layer.binding?.targetLayerId === a)!;
      expect(panels()).toHaveLength(2);
      expect(panel.layer.contentSize).toEqual({ width: 720, height: 240 });
      expect(panel.runtime.game.round?.remaining).toBe(source.counter!.initial);
      const geometry = structuredClone(
        f.engine.snapshot().layers.find((v) => v.layer.id === a)!.layer,
      );
      f.patch(panel.layer.id, { x: 80, y: 1400, width: 900, height: 300 });
      expect(f.engine.snapshot().layers.find((v) => v.layer.id === a)!.layer).toEqual(geometry);
      f.run(a);
      f.run(b);
      f.send(1);
      expect(panels().every((v) => v.runtime.game.round?.remaining === '3990')).toBe(true);
      f.patch(a, { visible: false, width: 500, height: 900 });
      f.patch(panel.layer.id, { visible: false, locked: true });
      f.engine.command({ action: 'settings', id: panel.layer.id, values: { title: '自定义挑战' } });
      f.send(2);
      const target = f.engine.snapshot().layers.find((v) => v.layer.id === a)!;
      expect(target.runtime.game.round?.remaining).toBe('3980');
      expect(panels().find((v) => v.layer.id === panel.layer.id)!.runtime).toEqual(target.runtime);
      expect(
        f.store.get<SavedState>('scene:state', null as never).runtimes[panel.layer.id]!.game.round,
      ).toBeNull();
      expect(() =>
        f.engine.command({ action: 'control', id: panel.layer.id, state: 'start' }),
      ).toThrow('跟随绑定玩法');
      f.engine.command({ action: 'addStatus', id: a });
      expect(panels()).toHaveLength(2);
      f.restart();
      const restored = panels().find((v) => v.layer.id === panel.layer.id)!;
      expect(restored.runtime.status).toBe('paused');
      expect(restored.runtime.game.round?.remaining).toBe('3980');
      expect(restored.layer).toMatchObject({
        x: 80,
        y: 1400,
        width: 900,
        height: 300,
        visible: false,
        locked: true,
        settings: { title: '自定义挑战' },
      });
      f.engine.command({ action: 'duplicate', id: a });
      const copy = f.engine
        .snapshot()
        .layers.find((v) => v.layer.sourceId === 'chain' && ![a, b].includes(v.layer.id))!;
      const copyPanel = panels().find((v) => v.layer.binding?.targetLayerId === copy.layer.id)!;
      expect(copyPanel.layer).toMatchObject({
        width: 900,
        height: 300,
        x: 104,
        y: 1424,
        settings: { title: '自定义挑战' },
      });
      expect(copyPanel.runtime.game.round).toBeNull();
      expect(copy.runtime.status).toBe('idle');
    } finally {
      f.store.close();
    }
  });
  it('状态绑定拒绝循环，删除目标后停止输出，可重绑及随场景另存', () => {
    const f = fixture('锁链', false, true);
    try {
      const a = f.add(),
        b = f.add();
      const panel = f.engine.snapshot().layers.find((v) => v.layer.binding?.targetLayerId === a)!;
      expect(() => f.patch(panel.layer.id, { binding: { targetLayerId: panel.layer.id } })).toThrow(
        '不兼容',
      );
      expect(() => f.patch(a, { binding: { targetLayerId: b } })).toThrow('不支持');
      f.engine.command({ action: 'remove', id: a });
      expect(f.engine.snapshot().layers.find((v) => v.layer.id === panel.layer.id)!.available).toBe(
        false,
      );
      f.run(b, 'demo');
      f.patch(panel.layer.id, { binding: { targetLayerId: b } });
      expect(
        f.engine.snapshot().layers.find((v) => v.layer.id === panel.layer.id)!.runtime.game.round
          ?.remaining,
      ).toBe('4000');
      f.engine.command({ action: 'sceneCopy', name: '晚班' });
      const copied = f.engine.snapshot();
      const game = copied.layers.find((v) => v.layer.sourceId === 'chain')!;
      const statuses = copied.layers.filter((v) => v.source?.kind === 'status');
      expect(statuses).toHaveLength(2);
      expect(
        statuses.every(
          (v) => v.layer.binding?.targetLayerId === game.layer.id && v.runtime.status === 'idle',
        ),
      ).toBe(true);
    } finally {
      f.store.close();
    }
  });
  it('升级旧玩法只拆出一次面板，保留回合、进度、主题、映射和热键', () => {
    const f = fixture();
    try {
      const a = f.add();
      f.run(a, 'demo');
      f.engine.command({
        action: 'trigger',
        id: a,
        eventId: 'unlock',
        amount: 60,
        requestId: randomUUID(),
      });
      f.engine.command({ action: 'control', id: a, state: 'pause' });
      f.patch(a, { x: 70, y: 90, width: 600, height: 1000, locked: true });
      const before = f.engine.snapshot().layers[0]!;
      f.upgrade({ ...source, statusSourceId: statusSource.id });
      f.engine.command({ action: 'upgrade', id: a });
      const after = f.engine.snapshot().layers[0]!;
      expect(after.layer).toEqual({ ...before.layer, pluginVersion: '1.1.0' });
      expect(after.runtime.game.round).toEqual({
        ...before.runtime.game.round,
        packageVersion: '1.1.0',
      });
      expect(f.engine.snapshot().layers[1]!.layer.binding?.targetLayerId).toBe(a);
      f.engine.command({ action: 'upgrade', id: a });
      expect(f.engine.snapshot().layers).toHaveLength(2);
      f.engine.command({ action: 'remove', id: f.engine.snapshot().layers[1]!.layer.id });
      f.engine.command({ action: 'upgrade', id: a });
      expect(f.engine.snapshot().layers).toHaveLength(1);
      f.engine.command({ action: 'addStatus', id: a });
      expect(f.engine.snapshot().layers).toHaveLength(2);
    } finally {
      f.store.close();
    }
  });
  it('锁定图层在所有运行状态都能换主题并同步配色，不改变原回合进度', () => {
    const f = fixture();
    try {
      f.upgrade({
        ...source,
        parameters: [
          ...source.parameters,
          { key: 'accent', label: '强调色', type: 'color', default: '#ffffff' },
        ],
        themes: [
          ...source.themes,
          { id: 'rose', name: '莓粉', description: 'test', accent: '#ff9cc8' },
        ],
      });
      const id = f.add();
      f.patch(id, { locked: true });
      for (const status of ['idle', 'running', 'paused', 'stopped']) {
        if (status === 'running') f.run(id, 'demo');
        if (status === 'paused' || status === 'stopped')
          f.engine.command({
            action: 'control',
            id,
            state: status === 'paused' ? 'pause' : 'stop',
          });
        const before = f.engine.snapshot().layers[0]!;
        const theme = before.layer.theme === 'classic' ? 'rose' : 'classic';
        f.patch(id, { theme });
        const after = f.engine.snapshot().layers[0]!;
        expect(after.layer.locked).toBe(true);
        expect(after.layer.theme).toBe(theme);
        expect(after.layer.settings.accent).toBe(theme === 'rose' ? '#ff9cc8' : '#ffffff');
        const previous = structuredClone(after.runtime);
        if (previous.game.round) previous.game.round.theme = before.runtime.game.round!.theme;
        expect(previous).toEqual(before.runtime);
        expect(() => f.patch(id, { theme: 'missing' })).toThrow('此来源没有此主题');
        expect(() => f.patch(id, { theme, x: 123 })).toThrow('请先解除图层锁定');
        expect(() => f.patch(id, { theme, settings: { label: '不能绕过锁定' } })).toThrow(
          '请先解除图层锁定',
        );
      }
    } finally {
      f.store.close();
    }
  });
  it('旧系统默认名称迁移为简体，自定义场景和图层名称原样保留', () => {
    const oldName = '\u9396\u93c8';
    const f = fixture(oldName);
    try {
      const id = f.add();
      expect(f.engine.snapshot().document.layers[0]!.name).toBe('锁链');
      const state = f.store.get<SavedState>('scene:state', null as never);
      state.document.name = '我的直播\u5834景';
      state.document.layers[0]!.name = oldName;
      f.store.set('scene:state', state);
      f.restart();
      expect(f.engine.snapshot().document.name).toBe('我的直播场景');
      expect(f.engine.snapshot().document.layers[0]!.name).toBe('锁链');
      const custom = '自定\u7fa9\u5834景';
      f.patch(id, { name: custom, settings: { label: custom } });
      const saved = f.store.get<SavedState>('scene:state', null as never);
      saved.document.name = custom;
      f.store.set('scene:state', saved);
      f.restart();
      expect(f.engine.snapshot().document.name).toBe(custom);
      expect(f.engine.snapshot().document.layers[0]!.name).toBe(custom);
      expect(f.engine.snapshot().document.layers[0]!.settings.label).toBe(custom);
    } finally {
      f.store.close();
    }
  });
  it('预设场景、图层、设置与排列会保存，拷贝不共用进度', () => {
    const f = fixture();
    try {
      const id = f.add();
      f.patch(id, {
        settings: { label: 'A' },
        initial: '4321',
        x: 123,
        rotation: 12,
        opacity: 0.7,
      });
      f.run(id, 'demo');
      f.engine.command({
        action: 'simulate',
        id,
        giftId: '2001',
        quantity: '2',
        requestId: randomUUID(),
      });
      f.engine.command({ action: 'duplicate', id });
      const copy = f.engine.snapshot().layers.at(-1)!;
      expect(copy.layer.id).not.toBe(id);
      expect(copy.runtime.status).toBe('idle');
      expect(copy.runtime.game.round).toBeNull();
      f.patch(copy.layer.id, { settings: { label: 'B' } });
      expect(f.engine.snapshot().layers[0]!.layer.settings.label).toBe('A');
      f.engine.command({ action: 'order', id: copy.layer.id, direction: 'down' });
      expect(f.engine.snapshot().layers[0]!.layer.id).toBe(copy.layer.id);
      f.restart();
      const restored = f.engine.snapshot().layers.find((l) => l.layer.id === id)!;
      expect(restored.layer.x).toBe(123);
      expect(restored.layer.initial).toBe('4321');
      expect(restored.runtime.status).toBe('paused');
      expect(restored.runtime.game.round?.remaining).toBe('3980');
    } finally {
      f.store.close();
    }
  });
  it('跨多层拖动按上方和下方插入，保留锁定、隐藏与玩法进度并保存顺序', () => {
    const f = fixture();
    try {
      const a = f.add(),
        b = f.add(),
        c = f.add(),
        d = f.add();
      f.run(a, 'demo');
      f.engine.command({
        action: 'simulate',
        id: a,
        giftId: '2001',
        quantity: '2',
        requestId: randomUUID(),
      });
      f.patch(a, { locked: true, visible: false });
      const originalRuntime = f.engine.snapshot().layers[0]!.runtime;
      const reorder = (id: string, targetId: string, placement: 'above' | 'below') =>
        f.engine.command({
          action: 'reorder',
          id,
          targetId,
          placement,
          revision: f.engine.snapshot().document.revision,
        });
      const ids = () => f.engine.snapshot().document.layers.map((l) => l.id);
      reorder(a, d, 'above');
      expect(ids()).toEqual([b, c, d, a]);
      expect(f.engine.snapshot().layers.at(-1)!.runtime).toEqual(originalRuntime);
      reorder(d, b, 'below');
      expect(ids()).toEqual([d, b, c, a]);
      reorder(a, c, 'below');
      expect(ids()).toEqual([d, b, a, c]);
      reorder(a, a, 'above');
      expect(ids()).toEqual([d, b, a, c]);
      f.restart();
      expect(ids()).toEqual([d, b, a, c]);
      expect(f.engine.snapshot().layers.find((v) => v.layer.id === a)).toMatchObject({
        layer: { locked: true, visible: false },
        runtime: { game: { round: { remaining: '3980' } } },
      });
    } finally {
      f.store.close();
    }
  });
  it('拖动遇到过期场景或缺失目标会拒绝，不改变原有排列', () => {
    const f = fixture();
    try {
      const a = f.add(),
        b = f.add();
      const revision = f.engine.snapshot().document.revision;
      f.patch(a, { name: '新名称' });
      const command = {
        action: 'reorder' as const,
        id: a,
        targetId: b,
        placement: 'above' as const,
        revision,
      };
      expect(() => f.engine.command(command)).toThrow('场景已更新');
      command.revision = f.engine.snapshot().document.revision;
      expect(() => f.engine.command({ ...command, targetId: randomUUID() })).toThrow();
      expect(() => f.engine.command({ ...command, sceneId: randomUUID() })).toThrow(
        '当前场景已切换',
      );
      expect(f.engine.snapshot().document.layers.map((l) => l.id)).toEqual([a, b]);
    } finally {
      f.store.close();
    }
  });
  it('一份连击只范式一次并分发到多个独立图层，旧全域回合不会再计算', () => {
    const f = fixture();
    try {
      f.store.startRound(manifest, 'live', ctx.webId, '4000');
      const a = f.add(),
        b = f.add();
      f.run(a);
      f.run(b);
      expect(f.send(1).gift.delta).toBe('1');
      expect(f.send(3).gift.delta).toBe('2');
      expect(f.send(3, { repeatEnd: 1 }).gift.delta).toBe('0');
      expect(f.engine.snapshot().layers.map((l) => l.runtime.game.round?.remaining)).toEqual([
        '3970',
        '3970',
      ]);
      expect(f.engine.snapshot().layers.map((l) => l.runtime.game.recent.length)).toEqual([2, 2]);
      expect(f.store.round('live')?.remaining).toBe('4000');
    } finally {
      f.store.close();
    }
  });
  it('锁链清空后仍接收真实礼物，同一实例自动重新绑链且可重复通关', () => {
    const f = fixture();
    try {
      const id = f.add();
      f.run(id);
      const roundId = f.engine.snapshot().layers[0]!.runtime.game.round!.id;
      f.send(1);
      f.send(400);
      expect(f.engine.snapshot().layers[0]!.runtime.status).toBe('running');
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.status).toBe('won');
      f.send(1, { giftId: '685', common: { msgId: '200', roomId: '101' }, groupId: '200' });
      expect(f.engine.snapshot().layers[0]!.runtime.game.round).toMatchObject({
        id: roundId,
        remaining: '100',
        status: 'running',
      });
      f.send(1, { common: { msgId: '201', roomId: '101' }, groupId: '201' });
      f.send(10, { common: { msgId: '202', roomId: '101' }, groupId: '201' });
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.status).toBe('won');
      expect(f.engine.snapshot().layers[0]!.runtime.status).toBe('running');
    } finally {
      f.store.close();
    }
  });
  it('隐藏照常交互，暂停和停止不追补事件，继续保留进度', () => {
    const f = fixture();
    try {
      const id = f.add();
      f.run(id);
      f.patch(id, { visible: false });
      f.send(1);
      f.engine.command({ action: 'control', id, state: 'pause' });
      f.send(3);
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.remaining).toBe('3990');
      f.engine.command({ action: 'control', id, state: 'resume' });
      f.send(4);
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.remaining).toBe('3980');
      f.engine.command({ action: 'control', id, state: 'stop' });
      f.send(5);
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.remaining).toBe('3980');
    } finally {
      f.store.close();
    }
  });
  it('新图层、重开、房间切换和过早事件均不追算', () => {
    const f = fixture();
    try {
      f.send(1);
      const id = f.add();
      f.run(id);
      f.send(3);
      f.restart();
      f.send(4);
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.remaining).toBe('3980');
      f.engine.command({ action: 'control', id, state: 'resume' });
      const bytes = gift(1, { groupId: 'new' });
      f.store.ingest(
        decodeGift(bytes, { ...ctx, receivedAt: '2000-01-01T00:00:00.000Z' }),
        bytes,
        (g) => f.engine.ingest(g),
      );
      f.connection.webId = 'room2';
      expect(f.engine.reconcile()).toBe(true);
      expect(() => f.engine.command({ action: 'control', id, state: 'resume' })).toThrow(
        '原直播间',
      );
    } finally {
      f.store.close();
    }
  });
  it('本机模式持续接收事件，禁用插件后停止响应', () => {
    const f = fixture();
    try {
      const id = f.add();
      f.run(id);
      f.send(3);
      expect(f.engine.snapshot().layers[0]!.runtime.status).toBe('running');
      expect(f.store.gifts()).toHaveLength(1);
      f.setEnabled(false);
      f.engine.reconcile();
      expect(f.engine.snapshot().layers[0]!.available).toBe(false);
      expect(f.engine.snapshot().layers[0]!.runtime.status).toBe('paused');
    } finally {
      f.store.close();
    }
  });
  it('试送请求可重试且拒绝 ID 冲突，不会因打开两个输出增加计数', () => {
    const f = fixture();
    try {
      const id = f.add();
      f.run(id, 'demo');
      const requestId = randomUUID(),
        request = { action: 'simulate' as const, id, giftId: '685', quantity: '2', requestId };
      f.engine.command(request);
      f.engine.command(request);
      for (let i = 0; i < 5; i++) f.engine.snapshot(true);
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.remaining).toBe('4200');
      expect(() => f.engine.command({ ...request, quantity: '3' })).toThrow('ID');
      f.engine.command({
        action: 'trigger',
        id,
        eventId: 'unlock',
        amount: 5,
        requestId: randomUUID(),
      });
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.remaining).toBe('4195');
    } finally {
      f.store.close();
    }
  });
  it('失败时观测、连击高水位、请求去重与图层状态一起回滚', () => {
    const f = fixture();
    try {
      const id = f.add();
      f.run(id);
      f.store.db.exec(
        "CREATE TRIGGER fail_scene BEFORE UPDATE ON settings WHEN NEW.key='scene:state' BEGIN SELECT RAISE(ABORT,'failure'); END;",
      );
      expect(() => f.send(1)).toThrow();
      expect(f.store.gifts()).toHaveLength(0);
      expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM scene_requests').get()?.n).toBe(0);
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.remaining).toBe('4000');
      f.store.db.exec('DROP TRIGGER fail_scene');
      f.send(1);
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.remaining).toBe('3990');
    } finally {
      f.store.close();
    }
  });
  it('新版安装不更动场景固定版本，暂停后才能明确升级', () => {
    const f = fixture();
    try {
      const id = f.add();
      f.run(id, 'demo');
      f.upgrade();
      expect(f.engine.snapshot().layers[0]!.layer.pluginVersion).toBe('1.0.0');
      expect(() => f.engine.command({ action: 'upgrade', id })).toThrow('暂停');
      f.engine.command({ action: 'control', id, state: 'pause' });
      f.engine.command({ action: 'upgrade', id });
      expect(f.engine.snapshot().layers[0]!.layer.pluginVersion).toBe('1.1.0');
    } finally {
      f.store.close();
    }
  });
  it('缩放来源升级为方形时保留位置与缩放，不再使用旧竖版画布', () => {
    const f = fixture();
    try {
      const id = f.add();
      f.patch(id, { x: 42, y: 80, width: 540, height: 960 });
      f.run(id, 'demo');
      f.engine.command({ action: 'control', id, state: 'pause' });
      const runtime = structuredClone(f.engine.snapshot().layers[0]!.runtime);
      f.upgrade({ ...source, width: 1080, height: 1080, sizing: 'scale' });
      f.engine.command({ action: 'upgrade', id });
      const updated = f.engine.snapshot().layers[0]!;
      expect(updated.layer).toMatchObject({
        x: 42,
        y: 80,
        width: 540,
        height: 540,
        contentSize: { width: 1080, height: 1080 },
      });
      expect(updated.runtime.game.round?.remaining).toBe(runtime.game.round?.remaining);
      expect(updated.runtime.status).toBe('paused');
      f.engine.command({ action: 'undo' });
      expect(f.engine.snapshot().layers[0]!.layer).toMatchObject({ width: 540, height: 960 });
    } finally {
      f.store.close();
    }
  });
  it('拒绝过期 revision、锁定图层变形、不支持的参数及礼物动作', () => {
    const f = fixture();
    try {
      const id = f.add();
      expect(() => f.engine.command({ action: 'patch', id, revision: 0, patch: { x: 1 } })).toThrow(
        '更新',
      );
      f.patch(id, { locked: true });
      expect(() => f.patch(id, { x: 1 })).toThrow('锁定');
      f.patch(id, { locked: false });
      expect(() => f.patch(id, { settings: { unknown: 'bad' } })).toThrow('参数');
      expect(() =>
        f.patch(id, {
          rules: [{ giftId: '2001', giftName: '玫瑰', delta: -1, eventId: 'missing', amount: 1 }],
        }),
      ).toThrow();
    } finally {
      f.store.close();
    }
  });
  it('插件升级可增减参数，保留仍支持的值并补齐默认值，不重置回合', () => {
    const f = fixture();
    try {
      const id = f.add();
      f.patch(id, { settings: { label: '旧标题' } });
      f.run(id, 'demo');
      const roundId = f.engine.snapshot().layers[0]!.runtime.game.round!.id;
      f.engine.command({ action: 'control', id, state: 'pause' });
      f.upgrade({
        ...source,
        parameters: [
          { key: 'newText', label: '新文案', type: 'text', default: '新默认值', live: true },
        ],
        completion: { text: '完成！', color: '#ffffff' },
      });
      f.engine.command({ action: 'upgrade', id });
      const view = f.engine.snapshot().layers[0]!;
      expect(view.layer.settings).not.toHaveProperty('label');
      expect(view.layer.settings).toMatchObject({ newText: '新默认值', completionDuration: 4 });
      expect(view.runtime.game.round!.id).toBe(roundId);
      f.patch(id, { locked: true });
      f.engine.command({
        action: 'settings',
        id,
        values: { completionText: '收工！', newText: '即时修改' },
      });
      expect(f.engine.snapshot().layers[0]!.layer.settings).toMatchObject({
        completionText: '收工！',
        newText: '即时修改',
      });
      expect(() => f.patch(id, { x: 5 })).toThrow('锁定');
    } finally {
      f.store.close();
    }
  });
  it('旧玩法回合仅迁移一次，保留进度主题及映射，先暂停', () => {
    const f = fixture();
    try {
      f.store.set('selected-mode', 'live');
      f.store.startRound(manifest, 'live', ctx.webId, '4000');
      f.store.ingest(decodeGift(gift(1), ctx), gift(1));
      f.store.db.prepare('DELETE FROM settings WHERE key=?').run('scene:state');
      f.restart();
      expect(f.engine.snapshot().layers).toHaveLength(1);
      expect(f.engine.snapshot().layers[0]!.runtime.status).toBe('paused');
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.remaining).toBe('3990');
      f.restart();
      expect(f.engine.snapshot().layers).toHaveLength(1);
    } finally {
      f.store.close();
    }
  });
});

describe('场景库与玩法说明', () => {
  it('旧单场景自动纳入库，切换隔离配置与事件并恢复最后使用场景', () => {
    const f = fixture();
    try {
      const layer = f.add(),
        first = f.engine.snapshot().document.id;
      f.patch(layer, { x: 123, settings: { label: '白天主播' } });
      f.run(layer);
      f.send(1);
      f.engine.command({ action: 'sceneCreate', name: '晚间主播' });
      const second = f.engine.snapshot().document.id;
      expect(f.engine.snapshot().layers).toHaveLength(0);
      expect(f.engine.snapshot().library).toHaveLength(2);
      f.send(2);
      expect(() =>
        f.engine.command({
          action: 'add',
          sceneId: first,
          pluginId: 'plugin.chain',
          sourceId: 'chain',
        }),
      ).toThrow('已切换');
      f.restart();
      expect(f.engine.snapshot().document.id).toBe(second);
      f.engine.command({ action: 'sceneSwitch', id: first });
      const restored = f.engine.snapshot().layers[0]!;
      expect(restored.layer.x).toBe(123);
      expect(restored.layer.settings.label).toBe('白天主播');
      expect(restored.runtime.game.round?.remaining).toBe('3990');
      expect(restored.runtime.status).toBe('stopped');
      expect(() => f.engine.command({ action: 'control', id: layer, state: 'resume' })).toThrow(
        '暂停',
      );
      f.send(3);
      expect(f.engine.snapshot().layers[0]!.runtime.game.round?.remaining).toBe('3990');
    } finally {
      f.store.close();
    }
  });
  it('玩法说明在启动前展示映射，逐实例跟随修改，删除目标后可重新绑定', () => {
    const f = fixture();
    try {
      const a = f.add(),
        b = f.add();
      f.engine.command({ action: 'addInstructions', id: a });
      const guide = f.engine.snapshot().layers.at(-1)!;
      expect(guide.layer.binding?.targetLayerId).toBe(a);
      expect(guide.layer.contentSize).toEqual({ width: 900, height: 320 });
      f.patch(guide.layer.id, { width: 450, height: 160 });
      expect(f.engine.snapshot().layers.at(-1)!.layer.contentSize).toEqual({
        width: 900,
        height: 320,
      });
      expect(guide.runtime.game.round).toBeNull();
      expect(guide.instructions?.mappings[0]).toMatchObject({
        giftId: '2001',
        giftName: '玫瑰',
        amount: 10,
        operation: 'subtract',
      });
      expect(guide.instructions?.mappings[0]?.icon).toMatch(/^zhuda-scene:/);
      f.patch(b, {
        rules: [{ giftId: '2001', giftName: '玫瑰', delta: -77, eventId: 'unlock', amount: 77 }],
      });
      expect(f.engine.snapshot().layers.at(-1)!.instructions?.mappings[0]?.amount).toBe(10);
      f.patch(a, {
        rules: [{ giftId: '2001', giftName: '玫瑰', delta: -5, eventId: 'unlock', amount: 5 }],
      });
      expect(f.engine.snapshot().layers.at(-1)!.instructions?.mappings).toHaveLength(1);
      expect(f.engine.snapshot().layers.at(-1)!.instructions?.mappings[0]?.amount).toBe(5);
      f.engine.command({ action: 'remove', id: a });
      expect(f.engine.snapshot().layers.at(-1)!.available).toBe(false);
      expect(f.engine.snapshot().layers.at(-1)!.source?.kind).toBe('instructions');
      expect(f.engine.snapshot().layers.at(-1)!.instructions).toBeUndefined();
      f.patch(guide.layer.id, { binding: { targetLayerId: b } });
      expect(f.engine.snapshot().layers.at(-1)!.instructions?.mappings[0]?.amount).toBe(77);
      expect(() => f.patch(b, { binding: { targetLayerId: guide.layer.id } })).toThrow('不支持');
    } finally {
      f.store.close();
    }
  });
  it('另存为复制全部配置并重新绑定说明，进度不共用，重命名及删除只影响指定场景', () => {
    const f = fixture();
    try {
      const a = f.add();
      f.engine.command({ action: 'addInstructions', id: a });
      const first = f.engine.snapshot().document.id;
      f.run(a, 'demo');
      f.engine.command({ action: 'sceneCopy', name: '节日特别场' });
      const copy = f.engine.snapshot(),
        second = copy.document.id;
      expect(copy.layers[0]!.layer.id).not.toBe(a);
      expect(copy.layers[1]!.layer.binding?.targetLayerId).toBe(copy.layers[0]!.layer.id);
      expect(copy.layers[1]!.layer.contentSize).toEqual({ width: 900, height: 320 });
      expect(copy.layers[1]!.instructions?.targetLayerId).toBe(copy.layers[0]!.layer.id);
      expect(copy.layers.every((l) => l.runtime.status === 'idle')).toBe(true);
      f.engine.command({ action: 'sceneRename', id: first, name: '白天互动' });
      expect(f.engine.snapshot().document.name).toBe('节日特别场');
      expect(f.engine.snapshot().library.find((s) => s.id === first)?.name).toBe('白天互动');
      expect(() => f.engine.command({ action: 'sceneDelete', id: second })).toThrow('先切换');
      f.engine.command({ action: 'sceneDelete', id: first });
      f.restart();
      expect(f.engine.snapshot().library).toHaveLength(1);
      expect(f.engine.snapshot().document.id).toBe(second);
    } finally {
      f.store.close();
    }
  });
  it('保留未打开场景固定的旧插件版本，损坏单个场景不拖垮整个库', () => {
    const f = fixture();
    try {
      const a = f.add(),
        first = f.engine.snapshot().document.id;
      f.engine.command({ action: 'sceneCreate', name: '新场景' });
      f.upgrade();
      expect(f.plugins.sceneVersionAllowed('plugin.chain', '1.0.0')).toBe(true);
      f.restart();
      f.engine.command({ action: 'sceneSwitch', id: first });
      expect(f.engine.snapshot().layers.find((l) => l.layer.id === a)?.available).toBe(true);
      const library = f.store.get<SavedState[]>('scene:library', []);
      f.store.set('scene:library', [...library, { document: { id: 'broken' } }]);
      f.restart();
      expect(f.engine.snapshot().library).toHaveLength(2);
      expect(f.engine.snapshot().warning).toContain('复原副本');
      expect(f.engine.snapshot().layers[0]!.available).toBe(true);
    } finally {
      f.store.close();
    }
  });
  it('场景切换保存失败时，当前场景、库和运行状态原子回滚', () => {
    const f = fixture();
    try {
      const a = f.add(),
        first = f.engine.snapshot().document.id;
      f.run(a, 'demo');
      f.store.db.exec(
        "CREATE TRIGGER fail_library BEFORE UPDATE ON settings WHEN NEW.key='scene:library' BEGIN SELECT RAISE(ABORT,'failure'); END;",
      );
      expect(() => f.engine.command({ action: 'sceneCreate', name: '失败' })).toThrow();
      expect(f.engine.snapshot().document.id).toBe(first);
      expect(f.engine.snapshot().layers[0]!.runtime.status).toBe('running');
      expect(f.engine.snapshot().library).toHaveLength(1);
    } finally {
      f.store.close();
    }
  });
  it('插件可提供自己的说明来源，收到相同的工作站映射数据', () => {
    const f = fixture('锁链', true);
    try {
      const a = f.add();
      f.engine.command({ action: 'addInstructions', id: a });
      const guide = f.engine.snapshot().layers.at(-1)!;
      expect(guide.layer.pluginId).toBe('plugin.chain');
      expect(guide.source?.kind).toBe('instructions');
      expect(guide.instructions?.mappings.length).toBeGreaterThan(0);
    } finally {
      f.store.close();
    }
  });
});

it('升级旧说明来源时保留当前排版尺寸，之后可整体缩放', () => {
  const f = fixture();
  try {
    const a = f.add();
    f.engine.command({ action: 'addInstructions', id: a });
    const state = f.store.get<SavedState>('scene:state', null as never);
    const guide = state.document.layers.at(-1)!;
    guide.width = 608;
    guide.height = 1120;
    delete guide.contentSize;
    f.store.set('scene:state', state);
    f.restart();
    f.engine.command({ action: 'upgrade', id: guide.id });
    expect(f.engine.snapshot().layers.at(-1)!.layer.contentSize).toEqual({
      width: 608,
      height: 1120,
    });
    f.patch(guide.id, { width: 304, height: 560 });
    f.restart();
    expect(f.engine.snapshot().layers.at(-1)!.layer.contentSize).toEqual({
      width: 608,
      height: 1120,
    });
  } finally {
    f.store.close();
  }
});

it('热键在直播回合补触发，完成后继续；不伪造礼物', () => {
  const f = fixture();
  try {
    const id = f.add();
    f.run(id);
    f.patch(id, { locked: true });
    const events = f.engine.snapshot().layers[0]!.source!.events;
    const remove = events.find((e) => e.operation === 'subtract')!,
      add = events.find((e) => e.operation === 'add')!;
    const hotkey: SceneHotkey = {
      id: randomUUID(),
      accelerator: 'Control+Alt+F6',
      eventId: remove.id,
      amount: 4000,
      enabled: true,
    };
    const save = () =>
      f.engine.command({
        action: 'hotkeys',
        id,
        revision: f.engine.snapshot().document.revision,
        bindings: [hotkey],
      });
    const trigger = (requestId = randomUUID()) =>
      f.engine.command({ action: 'hotkey', id, hotkeyId: hotkey.id, requestId });
    save();
    f.connection.state = 'error'; // Packet collection can fail while the scene remains active.
    const round = f.engine.snapshot().layers[0]!.runtime.game.round!.id;
    const requestId = randomUUID();
    trigger(requestId);
    trigger(requestId);
    let view = f.engine.snapshot().layers[0]!;
    expect(view.runtime.status).toBe('running');
    expect(view.runtime.game.round?.status).toBe('won');
    expect(view.runtime.game.round?.remaining).toBe('0');
    expect(view.runtime.game.recent).toHaveLength(1);
    expect(view.runtime.events.at(-1)).toMatchObject({
      kind: 'status',
      source: 'live',
      data: { origin: 'hotkey' },
    });
    expect(f.store.gifts()).toHaveLength(0);
    f.engine.command({
      action: 'manual',
      id,
      eventId: add.id,
      amount: 100,
      requestId: randomUUID(),
    });
    view = f.engine.snapshot().layers[0]!;
    expect(view.runtime.game.round).toMatchObject({
      id: round,
      status: 'running',
      remaining: '100',
    });
    f.engine.command({ action: 'control', id, state: 'pause' });
    expect(() => trigger()).toThrow('启动或继续');
    f.connection.state = 'connected';
    f.engine.command({ action: 'control', id, state: 'resume' });
    expect(() => trigger()).not.toThrow();
    hotkey.enabled = false;
    save();
    expect(() => trigger()).toThrow('停用或移除');
  } finally {
    f.store.close();
  }
});
it('热键参数校验、保存恢复及场景隔离；复制图层默认停用复制的热键', () => {
  const f = fixture();
  try {
    const id = f.add();
    const event = f.engine.snapshot().layers[0]!.source!.events[0]!;
    const hotkey: SceneHotkey = {
      id: randomUUID(),
      accelerator: 'Control+Alt+F6',
      eventId: event.id,
      amount: event.default,
      enabled: true,
    };
    const save = (bindings: SceneHotkey[]) =>
      f.engine.command({
        action: 'hotkeys',
        id,
        revision: f.engine.snapshot().document.revision,
        bindings,
      });
    expect(() => save([{ ...hotkey, eventId: 'missing' }])).toThrow('事件或数量');
    expect(() => save([{ ...hotkey, amount: event.max + 1 }])).toThrow();
    save([hotkey]);
    f.restart();
    expect(f.engine.snapshot().layers[0]!.layer.hotkeys).toEqual([hotkey]);
    f.engine.command({ action: 'duplicate', id });
    const copied = f.engine.snapshot().layers[1]!.layer.hotkeys![0]!;
    expect(copied.enabled).toBe(false);
    expect(copied.id).not.toBe(hotkey.id);
    const sceneId = f.engine.snapshot().document.id;
    f.engine.command({ action: 'sceneCreate', name: '其他主播' });
    expect(() =>
      f.engine.command({
        action: 'hotkey',
        sceneId,
        id,
        hotkeyId: hotkey.id,
        requestId: randomUUID(),
      }),
    ).toThrow('场景已切换');
    f.engine.command({ action: 'sceneSwitch', id: sceneId });
    expect(f.engine.snapshot().layers[0]!.layer.hotkeys).toEqual([hotkey]);
    save([]);
    expect(f.engine.snapshot().layers[0]!.layer.hotkeys).toEqual([]);
  } finally {
    f.store.close();
  }
});

it('撤销与重做只改变配置，期间送礼的权威进度保留，删除恢复先暂停', () => {
  const f = fixture();
  try {
    const id = f.add();
    f.run(id);
    f.patch(id, { x: 80 });
    f.send(1);
    f.engine.command({ action: 'undo' });
    let view = f.engine.snapshot().layers.find((v) => v.layer.id === id)!;
    expect(view.layer.x).toBe(0);
    expect(view.runtime.game.round?.remaining).toBe('3990');
    expect(view.runtime.status).toBe('running');
    f.engine.command({ action: 'redo' });
    expect(f.engine.snapshot().layers.find((v) => v.layer.id === id)!.layer.x).toBe(80);
    f.engine.command({ action: 'remove', id });
    f.engine.command({ action: 'undo' });
    view = f.engine.snapshot().layers.find((v) => v.layer.id === id)!;
    expect(view.runtime.status).toBe('paused');
    expect(view.runtime.game.round?.remaining).toBe('3990');
    expect(view.runtime.game.recent).toEqual([]);
    f.restart();
    expect(f.engine.snapshot().history?.canRedo).toBe(true);
  } finally {
    f.store.close();
  }
});
it('来源报错只暂停该实例，重试不重置计数或影响其他实例', () => {
  const f = fixture();
  try {
    const a = f.add(),
      b = f.add();
    f.run(a);
    f.run(b);
    f.engine.reportFailure(a, '测试异常');
    expect(f.engine.snapshot().layers.find((v) => v.layer.id === a)!.available).toBe(false);
    expect(f.engine.snapshot().layers.find((v) => v.layer.id === b)!.runtime.status).toBe(
      'running',
    );
    f.engine.command({ action: 'retrySource', id: a });
    const view = f.engine.snapshot().layers.find((v) => v.layer.id === a)!;
    expect(view.available).toBe(true);
    expect(view.runtime.status).toBe('paused');
    expect(view.runtime.game.round?.remaining).toBe('4000');
  } finally {
    f.store.close();
  }
});
it('导入场景重建图层绑定及 ID，不带运行状态，原场景仍在库中', () => {
  const f = fixture('锁链', false, true);
  try {
    const id = f.add();
    f.run(id);
    const original = f.engine.snapshot().document;
    f.engine.importDocument(original);
    const imported = f.engine.snapshot();
    expect(imported.document.id).not.toBe(original.id);
    expect(imported.library.some((s) => s.id === original.id)).toBe(true);
    expect(imported.layers.every((v) => v.runtime.status === 'idle')).toBe(true);
    const target = imported.layers.find((v) => v.source?.id === 'chain')!;
    expect(
      imported.layers.find((v) => v.source?.kind === 'status')?.layer.binding?.targetLayerId,
    ).toBe(target.layer.id);
  } finally {
    f.store.close();
  }
});

it('通用展示部件共享目标状态并独立保存，复制重绑，部件错误不影响玩法', () => {
  const f = fixture();
  try {
    const component: SceneSource = {
      ...statusSource,
      id: 'scoreboard',
      kind: 'view',
      name: '榜单',
    };
    f.upgrade(source, [component]);
    const id = f.add();
    f.engine.command({ action: 'addView', id, sourceId: 'scoreboard' });
    const view = () => f.engine.snapshot().layers.find((v) => v.source?.id === 'scoreboard')!;
    expect(view().layer.binding?.targetLayerId).toBe(id);
    f.run(id);
    f.send(1);
    expect(view().runtime.game.round?.remaining).toBe('3990');
    f.engine.reportFailure(view().layer.id, '部件错误');
    expect(view().available).toBe(false);
    expect(view().failure?.message).toContain('部件错误');
    expect(f.engine.snapshot().layers.find((v) => v.layer.id === id)!.runtime.status).toBe(
      'running',
    );
    f.engine.command({ action: 'retrySource', id: view().layer.id });
    expect(view().available).toBe(true);
    f.engine.command({ action: 'duplicate', id });
    const copy = f.engine
      .snapshot()
      .layers.find((v) => v.layer.sourceId === 'chain' && v.layer.id !== id)!;
    expect(
      f.engine
        .snapshot()
        .layers.some(
          (v) => v.source?.kind === 'view' && v.layer.binding?.targetLayerId === copy.layer.id,
        ),
    ).toBe(true);
  } finally {
    f.store.close();
  }
});
