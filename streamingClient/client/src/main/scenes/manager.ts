import { createDuel, advanceDuel, syncDuelHealth } from './duel';
import { randomUUID } from 'node:crypto';
import { LocalStore } from '@zhuda/core';
import {
  initialVariables,
  visibleVariables,
  elapsedSeconds,
  applyVariable,
  mutateCounter,
} from './variables';
import {
  sceneCommand,
  sceneDocumentSchema,
  validateSceneSettings,
  sceneParameters,
  validateGameRules,
  type SceneHotkey,
  systemText,
  type SceneCommand,
  type SceneDocument,
  type SceneLayer,
  type SceneRuntime,
  type SceneSnapshot,
  type SceneSource,
  type SceneEvent,
  type SceneInstructions,
  type GiftEvent,
  type PluginCatalogItem,
  type GameRule,
  type GameAction,
  globalHotkeysSchema,
} from '@zhuda/contracts';

export interface ScenePlugins {
  installedItem(id: string, version?: string): PluginCatalogItem;
  validateInstalled(id: string, version: string): PluginCatalogItem;
  sceneVersionAllowed: (id: string, version: string) => boolean;
  snapshot(): { installed: { item: PluginCatalogItem; enabled: boolean }[] };
}
type State = { document: SceneDocument; runtimes: Record<string, SceneRuntime>; savedAt?: number };
type HistoryEntry = { document: SceneDocument; removed: Record<string, SceneRuntime> };
type History = { undo: HistoryEntry[]; redo: HistoryEntry[]; key?: string; at?: number };
const emptyRuntime = (): SceneRuntime => ({
  status: 'idle',
  mode: 'demo',
  webId: 'demo',
  startedAt: '',
  startSeq: '0',
  game: { round: null, recent: [], lastAction: null, background: 'transparent' },
  events: [],
});
export class SceneManager {
  warning: string | undefined;
  constructor(
    private store: LocalStore,
    private plugins: ScenePlugins,
    private connection: () => { state: string; webId: string },
    private giftInfo: (id: string) => { name: string; icon: string | null } | undefined = () =>
      undefined,
  ) {
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS scene_requests(key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL)',
    );
    const raw = store.get<State | null>('scene:state', null);
    if (raw) {
      try {
        this.validateState(raw);
        store.set('scene:state', raw);
      } catch {
        store.set(`scene:recovery:${Date.now()}`, raw);
        this.warning = '原场景数据无法加载，已保存复原副本；目前显示新场景。';
        this.create();
      }
    } else this.create();
    const savedLibrary = store.get<unknown>('scene:library', []);
    const library: State[] = [];
    if (Array.isArray(savedLibrary)) {
      for (const entry of savedLibrary) {
        try {
          this.validateState(entry);
          if (
            entry.document.id === this.read().document.id ||
            library.some((s) => s.document.id === entry.document.id)
          )
            throw new Error();
          library.push(entry);
        } catch {
          store.set(`scene:recovery:${randomUUID()}`, entry);
          this.warning = '部分场景无法加载，已保存复原副本；其他场景仍可使用。';
        }
      }
    } else {
      store.set(`scene:recovery:${randomUUID()}`, savedLibrary);
      this.warning = '场景库无法加载，已保存复原副本；当前场景已保留。';
    }
    store.set('scene:library', library);
    plugins.sceneVersionAllowed = (id, version) =>
      [this.read(), ...this.library()].some((s) =>
        s.document.layers.some((l) => l.pluginId === id && l.pluginVersion === version),
      );
    this.migrateSystemNames();
    if (!raw) this.migrate();
  }
  private validateState(state: State) {
    sceneDocumentSchema.parse(state.document);
    if (!state.runtimes || typeof state.runtimes !== 'object' || Array.isArray(state.runtimes))
      throw new Error();
    for (const runtime of Object.values(state.runtimes)) {
      if (
        !['idle', 'running', 'paused', 'stopped', 'won'].includes(runtime.status) ||
        !['live', 'demo'].includes(runtime.mode) ||
        !Array.isArray(runtime.events) ||
        !Array.isArray(runtime.game.recent)
      )
        throw new Error();
      if (
        runtime.game.round &&
        (!/^(0|[1-9][0-9]{0,39})$/.test(runtime.game.round.remaining) ||
          !/^[1-9][0-9]{0,8}$/.test(runtime.game.round.initial))
      )
        throw new Error();
      // Old completed layers were terminal. Restore them paused like every saved interaction.
      if (runtime.status === 'won') runtime.status = 'paused';
      if (runtime.game.round?.status === 'won')
        runtime.completedAt ??= state.savedAt ?? Date.parse(runtime.startedAt);
      if (runtime.status === 'running')
        this.pause(runtime, state.savedAt ?? Date.parse(runtime.startedAt));
    }
  }
  private library(): State[] {
    return this.store.get<State[]>('scene:library', []);
  }
  private endInteractions(state: State) {
    for (const runtime of Object.values(state.runtimes)) {
      if (runtime.status === 'running') this.pause(runtime);
      if (runtime.status === 'paused') {
        runtime.status = 'stopped';
        if (runtime.game.round) runtime.game.round.status = 'stopped';
      }
    }
  }
  private libraryCommand(input: SceneCommand, state: State): boolean {
    if (
      !['sceneCreate', 'sceneCopy', 'sceneSwitch', 'sceneRename', 'sceneDelete'].includes(
        input.action,
      )
    )
      return false;
    const library = this.library();
    if (input.action === 'sceneRename') {
      const target =
        input.id === state.document.id ? state : library.find((s) => s.document.id === input.id);
      if (!target) throw new Error('场景已不存在');
      target.document.name = input.name;
      target.document.revision++;
      target.document.updatedAt = new Date().toISOString();
      this.save(state);
    } else if (input.action === 'sceneDelete') {
      if (input.id === state.document.id) throw new Error('请先切换到其他场景，再删除当前场景');
      const index = library.findIndex((s) => s.document.id === input.id);
      if (index < 0) throw new Error('场景已不存在');
      library.splice(index, 1);
    } else if (input.action === 'sceneSwitch') {
      if (input.id === state.document.id) return true;
      const index = library.findIndex((s) => s.document.id === input.id);
      if (index < 0) throw new Error('场景已不存在');
      const target = library.splice(index, 1)[0]!;
      this.endInteractions(state);
      this.endInteractions(target);
      library.push(state);
      this.save(target);
    } else if (input.action === 'sceneCreate' || input.action === 'sceneCopy') {
      if (library.length >= 99) throw new Error('最多可保存 100 个场景');
      const doc = structuredClone(state.document);
      doc.id = randomUUID();
      doc.name = input.name;
      doc.revision = 0;
      doc.updatedAt = new Date().toISOString();
      if (input.action === 'sceneCreate') doc.layers = [];
      else {
        const ids = new Map(doc.layers.map((l) => [l.id, randomUUID()]));
        for (const layer of doc.layers) {
          layer.id = ids.get(layer.id)!;
          if (layer.binding && ids.has(layer.binding.targetLayerId))
            layer.binding.targetLayerId = ids.get(layer.binding.targetLayerId)!;
        }
      }
      this.endInteractions(state);
      library.push(state);
      this.save({ document: doc, runtimes: {} });
    }
    this.store.set('scene:library', library);
    return true;
  }
  private migrateSystemNames() {
    const state = this.read();
    let changed = false;
    if (state.document.name === '我的直播\u5834景') {
      state.document.name = '我的直播场景';
      changed = true;
    }
    for (const layer of state.document.layers) {
      try {
        const source = this.plugins
          .installedItem(layer.pluginId, layer.pluginVersion)
          .manifest.sceneSources?.find((s) => s.id === layer.sourceId);
        if (source && layer.name === source.name && systemText(source.name) !== layer.name) {
          layer.name = systemText(source.name);
          changed = true;
        }
      } catch {
        // Unavailable plugins must not prevent restoration of the saved scene.
      }
    }
    if (changed) this.save(state);
  }
  private create() {
    const portrait = this.store.get<string>('output-layout', 'portrait') !== 'landscape';
    this.store.set('scene:state', {
      document: {
        schemaVersion: 1,
        id: randomUUID(),
        name: '我的直播场景',
        width: portrait ? 1080 : 1920,
        height: portrait ? 1920 : 1080,
        background: this.store.get('background', 'green'),
        layers: [],
        revision: 0,
        updatedAt: new Date().toISOString(),
      },
      runtimes: {},
    });
  }
  private read(): State {
    return this.store.get<State>('scene:state', null as never);
  }
  private save(state: State, layout = false) {
    if (layout) {
      state.document = sceneDocumentSchema.parse({
        ...state.document,
        revision: state.document.revision + 1,
        updatedAt: new Date().toISOString(),
      });
    }
    state.savedAt = Date.now();
    this.store.set('scene:state', state);
  }
  private source(layer: SceneLayer, full = false) {
    const item = full
      ? this.plugins.validateInstalled(layer.pluginId, layer.pluginVersion)
      : this.plugins.installedItem(layer.pluginId, layer.pluginVersion);
    const source = item.manifest.sceneSources?.find((s) => s.id === layer.sourceId);
    if (!source) throw new Error('插件没有提供此场景来源');
    return { item, source };
  }
  private available(layer: SceneLayer, _runtime: SceneRuntime) {
    const found = this.source(layer);
    return found;
  }
  snapshot(outputOpen = false): SceneSnapshot {
    const state = this.read();
    const history = this.store.get<History>(`scene:history:${state.document.id}`, {
      undo: [],
      redo: [],
    });
    return {
      history: { canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 },
      document: state.document,
      library: [state, ...this.library()].map(({ document: d }) => ({
        id: d.id,
        name: d.name,
        width: d.width,
        height: d.height,
        layerCount: d.layers.length,
        updatedAt: d.updatedAt,
      })),
      outputOpen,
      generatedAt: Date.now(),
      warning: this.warning,
      layers: state.document.layers.map((layer) => {
        let runtime = state.runtimes[layer.id] ?? emptyRuntime();
        const failure = runtime.failure;
        try {
          const { source, item } = this.source(layer);
          let instructions: SceneInstructions | undefined;
          let variables = runtime.game.round
            ? visibleVariables(source, runtime)
            : initialVariables(source, layer);
          let error: string | null = runtime.failure?.message ?? null;
          try {
            this.available(layer, runtime);
            if (source.kind === 'instructions') instructions = this.instructions(state, layer);
            if (source.kind === 'status' || source.kind === 'view') {
              const target = this.statusTarget(state, layer);
              runtime = state.runtimes[target.id] ?? emptyRuntime();
              const targetSource = this.available(target, runtime).source;
              variables = runtime.game.round
                ? visibleVariables(targetSource, runtime)
                : initialVariables(targetSource, target);
            }
          } catch (e) {
            error = (e as Error).message;
          }
          return {
            failure,
            layer,
            runtime,
            variables,
            source,
            instructions,
            available: !error,
            error,
            url: error
              ? null
              : `zhuda-plugin://${item.manifest.id}/${item.manifest.version}/assets/${source.entry}`,
          };
        } catch (error) {
          return {
            failure,
            layer,
            runtime,
            source: null,
            available: false,
            error: (error as Error).message,
            url: null,
          };
        }
      }),
    };
  }
  private instructions(state: State, layer: SceneLayer): SceneInstructions {
    const target = state.document.layers.find((l) => l.id === layer.binding?.targetLayerId);
    if (!target) throw new Error('绑定的玩法已移除，请重新选择玩法');
    const { source } = this.source(target);
    if (!source.events.length || ['instructions', 'status', 'view'].includes(source.kind ?? ''))
      throw new Error('绑定目标不是玩法来源');
    return {
      targetLayerId: target.id,
      targetName: target.name,
      theme: target.theme,
      mappings: target.rules
        .map((rule) => {
          const event =
            source.events.find((e) => e.id === rule.eventId) ??
            source.events.find((e) => e.operation === (rule.delta < 0 ? 'subtract' : 'add'));
          if (!event) return null;
          const gift = this.giftInfo(rule.giftId);
          return {
            giftId: rule.giftId,
            giftName: gift?.name ?? rule.giftName,
            icon: gift?.icon ?? null,
            eventId: event.id,
            label: systemText(event.label),
            description: systemText(event.description),
            operation: event.operation,
            amount: rule.amount ?? Math.abs(rule.delta),
            unit: systemText(event.unit),
          };
        })
        .filter((m): m is NonNullable<typeof m> => !!m),
    };
  }
  private checkBinding(state: State, layer: SceneLayer) {
    const { source } = this.source(layer);
    if (source.kind === 'status' || source.kind === 'view') {
      this.statusTarget(state, layer);
      return;
    }
    if (source.kind !== 'instructions') {
      if (layer.binding) throw new Error('此来源不支持玩法绑定');
      return;
    }
    this.instructions(state, layer);
  }
  private validateGlobalHotkeys(state: State, bindings: unknown) {
    const parsed = globalHotkeysSchema.parse(bindings);
    const giftIds = new Set(
      state.document.layers.flatMap((layer) => layer.rules.map((r) => r.giftId)),
    );
    if (parsed.some((binding) => !giftIds.has(binding.giftId)))
      throw new Error('全局热键绑定的礼物尚未配置玩法映射');
    return parsed;
  }
  private pruneGlobalHotkeys(state: State) {
    if (!state.document.globalHotkeys?.length) return;
    const giftIds = new Set(
      state.document.layers.flatMap((layer) => layer.rules.map((r) => r.giftId)),
    );
    const next = state.document.globalHotkeys.filter((binding) => giftIds.has(binding.giftId));
    if (next.length !== state.document.globalHotkeys.length) state.document.globalHotkeys = next;
  }
  private statusTarget(state: State, layer: SceneLayer) {
    const { source } = this.source(layer);
    const target = state.document.layers.find((l) => l.id === layer.binding?.targetLayerId);
    if (!target) throw new Error('绑定的玩法已移除，请重新选择玩法');
    const targetSource = this.source(target).source;
    if (
      target.pluginId !== layer.pluginId ||
      target.sourceId !== source.targetSourceId ||
      ['instructions', 'status', 'view'].includes(targetSource.kind ?? '')
    )
      throw new Error('状态面板与绑定玩法不兼容');
    return target;
  }
  private addStatus(state: State, target: SceneLayer) {
    const { item, source } = this.source(target);
    const panelSource = item.manifest.sceneSources?.find(
      (s) =>
        s.id === source.statusSourceId && s.kind === 'status' && s.targetSourceId === source.id,
    );
    if (!panelSource) throw new Error('此来源没有独立状态面板');
    if (
      state.document.layers.some(
        (l) =>
          l.pluginId === target.pluginId &&
          l.sourceId === panelSource.id &&
          l.binding?.targetLayerId === target.id,
      )
    )
      return;
    if (state.document.layers.length >= 32) throw new Error('最多可放入 32 个图层');
    this.plugins.validateInstalled(item.manifest.id, item.manifest.version);
    const panel = this.makeLayer(item, panelSource, state.document);
    panel.name = `${target.name.slice(0, 45)} · 状态面板`;
    panel.binding = { targetLayerId: target.id };
    panel.y = Math.max(0, state.document.height - panel.height - 48);
    state.document.layers.splice(state.document.layers.indexOf(target) + 1, 0, panel);
    state.runtimes[panel.id] = emptyRuntime();
  }
  private layer(state: State, id: string) {
    const layer = state.document.layers.find((l) => l.id === id);
    if (!layer) throw new Error('图层已不存在');
    return layer;
  }
  private revision(state: State, revision: number) {
    if (state.document.revision !== revision) throw new Error('场景已更新，请再试一次');
  }
  private latestSeq() {
    return String(
      this.store.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM observations').get()?.seq ?? 0,
    );
  }
  private makeLayer(item: PluginCatalogItem, source: SceneSource, doc: SceneDocument): SceneLayer {
    const scale = Math.min(1, doc.width / source.width, doc.height / source.height);
    const width = source.width * scale,
      height = source.height * scale;
    return {
      id: randomUUID(),
      pluginId: item.manifest.id,
      pluginVersion: item.manifest.version,
      sourceId: source.id,
      name: systemText(source.name),
      x: (doc.width - width) / 2,
      y: (doc.height - height) / 2,
      width,
      height,
      contentSize:
        source.sizing === 'scale' ||
        source.kind === 'instructions' ||
        ['status', 'view'].includes(source.kind ?? '') ||
        (item.manifest.id === 'plugin.scene-basics' && source.id === 'text')
          ? { width: source.width, height: source.height }
          : undefined,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      initial: source.counter?.initial,
      settings: validateSceneSettings(source, {}),
      theme: source.defaultTheme ?? source.themes[0]?.id ?? 'default',
      rules: validateGameRules(source.events, source.rules),
    };
  }
  private split(state: State, layer: SceneLayer, runtime: SceneRuntime) {
    if (layer.locked) throw new Error('请先解除图层锁定');
    const { item, source } = this.source(layer, true);
    if (!source.splitSources) throw new Error('此来源不支持拆分');
    if (state.document.layers.length + source.splitSources.length - 1 > 32)
      throw new Error('拆分后超过 32 个图层，请先整理图层');
    const sx = layer.width / source.width,
      sy = layer.height / source.height;
    const angle = (layer.rotation * Math.PI) / 180;
    const children = source.splitSources.map((part, index) => {
      const childSource = item.manifest.sceneSources?.find((s) => s.id === part.sourceId);
      if (!childSource || childSource.splitSources || childSource.kind === 'instructions')
        throw new Error('拆分来源声明无效');
      const child = this.makeLayer(item, childSource, state.document);
      if (index === 0) child.id = layer.id;
      const keys = new Set(sceneParameters(childSource).map((p) => p.key));
      child.settings = validateSceneSettings(
        childSource,
        Object.fromEntries(Object.entries(layer.settings).filter(([key]) => keys.has(key))),
      );
      child.theme = childSource.themes.some((t) => t.id === layer.theme)
        ? layer.theme
        : child.theme;
      child.rules = validateGameRules(
        childSource.events,
        layer.rules.filter((r) => childSource.events.some((e) => e.id === r.eventId)),
      );
      child.hotkeys = (layer.hotkeys ?? []).filter((h) =>
        childSource.events.some((e) => e.id === h.eventId),
      );
      child.width *= sx;
      child.height *= sy;
      const dx = part.x * sx + child.width / 2 - layer.width / 2;
      const dy = part.y * sy + child.height / 2 - layer.height / 2;
      child.x =
        layer.x + layer.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle) - child.width / 2;
      child.y =
        layer.y + layer.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) - child.height / 2;
      child.rotation = layer.rotation;
      child.opacity = layer.opacity;
      child.visible = layer.visible;
      const next = structuredClone(runtime);
      next.variables = Object.fromEntries(
        (childSource.variables ?? []).map((v) => [v.key, runtime.variables?.[v.key] ?? v.initial]),
      );
      next.game.recent = [];
      next.game.lastAction = null;
      if (next.game.round) {
        const previousRound = next.game.round.id;
        if (index > 0) next.game.round.id = randomUUID();
        Object.assign(next.game.round, {
          events: childSource.events,
          rules: child.rules,
          themes: childSource.themes,
          theme: child.theme,
        });
        // Preserve sender/follow deduplication across the new independent rounds.
        if (index > 0)
          for (const [oldPrefix, newPrefix] of [
            [`sender:${previousRound}:`, `sender:${next.game.round.id}:`],
            [`follow:${previousRound}:`, `follow:${next.game.round.id}:`],
            [`gift:${layer.id}:`, `gift:${child.id}:`],
            [`event:${layer.id}:${previousRound}:`, `event:${child.id}:${next.game.round.id}:`],
          ] as const) {
            const rows = this.store.db
              .prepare(
                'SELECT key, fingerprint, created_at FROM scene_requests WHERE substr(key,1,?)=?',
              )
              .all(oldPrefix.length, oldPrefix);
            for (const row of rows)
              this.store.db
                .prepare('INSERT OR IGNORE INTO scene_requests VALUES(?,?,?)')
                .run(
                  `${newPrefix}${String(row.key).slice(oldPrefix.length)}`,
                  String(row.fingerprint),
                  String(row.created_at),
                );
          }
      }
      state.runtimes[child.id] = next;
      return child;
    });
    state.document.layers.splice(state.document.layers.indexOf(layer), 1, ...children);
  }
  private fresh(layer: SceneLayer, mode: 'live' | 'demo', initial?: string): SceneRuntime {
    const { item, source } = this.source(layer, true);
    const connection = this.connection();
    if (mode === 'live') {
      if (connection.state !== 'connected') throw new Error('请先连接直播间');
    }
    const runtime = emptyRuntime();
    runtime.status = 'running';
    runtime.mode = mode;
    runtime.webId = mode === 'demo' ? 'demo' : connection.webId;
    runtime.startedAt = new Date().toISOString();
    runtime.startSeq = this.latestSeq();
    runtime.variables = initialVariables(source, layer);
    if (source.battle) runtime.battle = createDuel(source, layer);
    const count = initial ?? layer.initial ?? source.counter?.initial ?? '1';
    runtime.game.round = {
      id: randomUUID(),
      product: layer.pluginId,
      packageVersion: layer.pluginVersion,
      mode,
      webId: runtime.webId,
      initial: count,
      remaining: count,
      status: 'running',
      startedAt: runtime.startedAt,
      startSeq: runtime.startSeq,
      rules: structuredClone(layer.rules),
      events: source.events,
      themes: source.themes,
      theme: layer.theme,
    };
    return runtime;
  }
  /** Create a scene-level interaction that waits for the next global gift event. */
  private armed(layer: SceneLayer): SceneRuntime {
    const { item, source } = this.source(layer, true);
    const connection = this.connection();
    const runtime = emptyRuntime();
    runtime.status = 'running';
    runtime.mode = 'live';
    runtime.webId = connection.state === 'connected' ? connection.webId : '';
    runtime.startedAt = new Date().toISOString();
    runtime.startSeq = this.latestSeq();
    runtime.variables = initialVariables(source, layer);
    if (source.counter) this.ensureRound(runtime, layer, source);
    return runtime;
  }

  private ensureRound(runtime: SceneRuntime, layer: SceneLayer, source: SceneSource) {
    if (runtime.game.round) return;
    const item = this.source(layer, true).item;
    const count = layer.initial ?? source.counter?.initial ?? '1';
    if (source.battle) runtime.battle = createDuel(source, layer);
    runtime.game.round = {
      id: randomUUID(),
      product: layer.pluginId,
      packageVersion: layer.pluginVersion,
      mode: 'live',
      webId: runtime.webId,
      initial: count,
      remaining: count,
      status: 'running',
      startedAt: runtime.startedAt,
      startSeq: runtime.startSeq,
      rules: structuredClone(layer.rules),
      events: source.events,
      themes: source.themes,
      theme: layer.theme,
    };
  }

  /** Re-arm every interactive layer after app startup, room changes, or a stream ending. */
  armAll() {
    this.store.transaction(() => {
      // Gift IDs are scoped to a collector run. A new room may reuse an ID
      // from the previous stream, so never carry event deduplication across
      // the re-arming boundary.
      this.store.db
        .prepare(
          "DELETE FROM scene_requests WHERE key LIKE 'gift:%' OR key LIKE 'event:%' OR key LIKE 'follow:%' OR key LIKE 'sender:%'",
        )
        .run();
      const state = this.read();
      let changed = false;
      for (const layer of state.document.layers) {
        try {
          const source = this.source(layer, true).source;
          if (layer.binding) {
            // Bound status/instruction/view layers mirror another layer. Their
            // own runtime must never retain a room or round from an older run.
            if (state.runtimes[layer.id]?.status !== 'idle' || state.runtimes[layer.id]?.game.round)
              changed = true;
            state.runtimes[layer.id] = emptyRuntime();
            continue;
          }
          if (!source.events.length && !source.observations?.length && !source.battle) continue;
          state.runtimes[layer.id] = this.armed(layer);
          changed = true;
        } catch {
          state.runtimes[layer.id] = emptyRuntime();
          changed = true;
        }
      }
      if (changed) this.save(state);
    });
  }

  /** Drop the old room's event identity while leaving all scene plugins ready. */
  resetEventSession() {
    this.armAll();
  }
  private migrate() {
    const legacy = this.store.round(this.store.get<'live' | 'demo'>('selected-mode', 'demo'));
    if (!legacy || legacy.status === 'stopped') return;
    const legacyPluginId = legacy.product.startsWith('game.')
      ? `plugin.${legacy.product.slice('game.'.length)}`
      : legacy.product;
    const entry = this.plugins
      .snapshot()
      .installed.find((p) => p.enabled && p.item.manifest.id === legacyPluginId);
    const source = entry?.item.manifest.sceneSources?.[0];
    if (!entry || !source) return;
    const state = this.read(),
      layer = this.makeLayer(entry.item, source, state.document);
    layer.width = state.document.width;
    layer.height = state.document.height;
    layer.x = 0;
    layer.y = 0;
    layer.initial = legacy.initial;
    layer.rules = validateGameRules(source.events, legacy.rules);
    layer.theme = source.themes.some((t) => t.id === legacy.theme) ? legacy.theme! : layer.theme;
    const runtime = emptyRuntime();
    runtime.status = 'paused';
    runtime.mode = legacy.mode;
    runtime.webId = legacy.webId;
    runtime.startedAt = legacy.startedAt;
    runtime.startSeq = legacy.startSeq;
    runtime.game.round = {
      ...legacy,
      packageVersion: layer.pluginVersion,
      theme: layer.theme,
      rules: layer.rules,
    };
    state.document.layers.push(layer);
    state.runtimes[layer.id] = runtime;
    this.save(state, true);
  }
  command(raw: SceneCommand) {
    const input = sceneCommand.parse(raw);
    if (input.action === 'output' || input.action === 'importMedia')
      throw new Error('此操作由主机处理');
    this.store.transaction(() => {
      const state = this.read();
      if (input.sceneId && input.sceneId !== state.document.id)
        throw new Error('当前场景已切换，请重新操作');
      if (input.action === 'undo' || input.action === 'redo') {
        this.restoreHistory(state, input.action);
        return;
      }
      if (input.action === 'exportScene' || input.action === 'importScene') return;
      const before = structuredClone(state);
      if (
        input.action === 'sceneCreate' ||
        input.action === 'sceneCopy' ||
        input.action === 'sceneSwitch' ||
        input.action === 'sceneRename' ||
        input.action === 'sceneDelete'
      ) {
        this.libraryCommand(input, state);
        return;
      }
      if (input.action === 'configure') {
        this.revision(state, input.revision);
        Object.assign(state.document, {
          name: input.name,
          width: input.width,
          height: input.height,
          background: input.background,
        });
      } else if (input.action === 'add') {
        if (state.document.layers.length >= 32) throw new Error('最多可放入 32 个图层');
        const item = this.plugins.installedItem(input.pluginId);
        this.plugins.validateInstalled(input.pluginId, item.manifest.version);
        const source = item.manifest.sceneSources?.find((s) => s.id === input.sourceId);
        if (!source) throw new Error('找不到来源，请安装并激活插件');
        if (['instructions', 'status', 'view'].includes(source.kind ?? ''))
          throw new Error('请从玩法图层添加说明或状态面板');
        const layer = this.makeLayer(item, source, state.document);
        if (source.counter) {
          layer.width = state.document.width;
          layer.height = state.document.height;
          layer.x = 0;
          layer.y = 0;
        }
        state.document.layers.push(layer);
        state.runtimes[layer.id] =
          source.events.length || source.observations?.length || source.battle
            ? this.armed(layer)
            : emptyRuntime();
        if (source.statusSourceId) this.addStatus(state, layer);
      } else if (input.action === 'globalHotkeys') {
        this.revision(state, input.revision);
        state.document.globalHotkeys = this.validateGlobalHotkeys(state, input.bindings);
      } else if (input.action === 'globalHotkey') {
        const binding = state.document.globalHotkeys?.find((h) => h.id === input.hotkeyId);
        if (!binding || !binding.enabled) throw new Error('全局热键已停用或移除');
        if (
          !this.emitGlobalGift(
            state,
            binding.giftId,
            String(binding.quantity),
            input.requestId,
            '主播',
          )
        )
          throw new Error('当前场景没有匹配此礼物的玩法映射');
      } else if (input.action === 'globalGift') {
        if (!this.emitGlobalGift(state, input.giftId, input.quantity, input.requestId, '测试观众'))
          throw new Error('当前场景没有匹配此礼物的玩法映射');
      } else {
        const layer = this.layer(state, input.id);
        const runtime = (state.runtimes[layer.id] ??= emptyRuntime());
        if (input.action === 'addView') {
          if (state.document.layers.length >= 32) throw new Error('最多可放入 32 个图层');
          const { item } = this.source(layer, true);
          const component = item.manifest.sceneSources?.find(
            (s) =>
              s.id === input.sourceId && s.kind === 'view' && s.targetSourceId === layer.sourceId,
          );
          if (!component) throw new Error('展示部件与绑定玩法不兼容');
          const child = this.makeLayer(item, component, state.document);
          child.binding = { targetLayerId: layer.id };
          state.document.layers.push(child);
          state.runtimes[child.id] = emptyRuntime();
        } else if (input.action === 'retrySource') {
          delete runtime.failure;
        } else if (input.action === 'addStatus') {
          this.addStatus(state, layer);
        } else if (input.action === 'split') {
          this.revision(state, input.revision);
          this.split(state, layer, runtime);
          this.pruneGlobalHotkeys(state);
        } else if (input.action === 'addInstructions') {
          if (state.document.layers.length >= 32) throw new Error('最多可放入 32 个图层');
          const { source, item } = this.source(layer);
          if (!source.events.length || source.kind === 'instructions')
            throw new Error('此来源没有玩法动作');
          let guideItem = item;
          let guideSource = source.instructionSourceId
            ? item.manifest.sceneSources?.find(
                (s) => s.id === source.instructionSourceId && s.kind === 'instructions',
              )
            : undefined;
          if (!guideSource) {
            guideItem = this.plugins.installedItem('plugin.scene-basics');
            guideSource = guideItem.manifest.sceneSources?.find((s) => s.kind === 'instructions');
          }
          if (!guideSource) throw new Error('请先安装新版场景基本素材');
          this.plugins.validateInstalled(guideItem.manifest.id, guideItem.manifest.version);
          const guide = this.makeLayer(guideItem, guideSource, state.document);
          guide.name = `${layer.name.slice(0, 50)} · 玩法说明`;
          guide.binding = { targetLayerId: layer.id };
          guide.y = Math.max(0, state.document.height - guide.height - 60);
          state.document.layers.push(guide);
          state.runtimes[guide.id] = emptyRuntime();
        } else if (input.action === 'settings') {
          const { source } = this.source(layer);
          if (
            layer.locked &&
            Object.keys(input.values).some(
              (key) => !sceneParameters(source).find((p) => p.key === key)?.live,
            )
          )
            throw new Error('请先解除图层锁定');
          layer.settings = validateSceneSettings(source, { ...layer.settings, ...input.values });
        } else if (input.action === 'hotkeys') {
          this.revision(state, input.revision);
          this.checkHotkeys(layer, input.bindings);
          layer.hotkeys = input.bindings;
        } else if (input.action === 'patch') {
          this.revision(state, input.revision);
          const patch = { ...input.patch };
          if (patch.hotkeys) this.checkHotkeys(layer, patch.hotkeys);
          if (patch.settings || patch.rules || patch.theme) {
            const { source } = this.source(layer);
            if (patch.settings)
              patch.settings = validateSceneSettings(source, {
                ...layer.settings,
                ...patch.settings,
              });
            if (patch.rules) patch.rules = validateGameRules(source.events, patch.rules);
            if (patch.theme) {
              const theme = source.themes.find((t) => t.id === patch.theme);
              if (!theme) throw new Error('此来源没有此主题');
              if (source.parameters.some((p) => p.key === 'accent' && p.type === 'color'))
                patch.settings = validateSceneSettings(source, {
                  ...layer.settings,
                  ...patch.settings,
                  accent: theme.accent,
                });
            }
          }
          if (
            layer.locked &&
            Object.keys(input.patch).some(
              (k) => !['locked', 'visible', 'name', 'theme'].includes(k),
            )
          )
            throw new Error('请先解除图层锁定');
          Object.assign(layer, patch);
          if (patch.rules) this.pruneGlobalHotkeys(state);
          if (patch.binding) this.checkBinding(state, layer);
          if (runtime.game.round)
            Object.assign(runtime.game.round, {
              theme: layer.theme,
              rules: structuredClone(layer.rules),
            });
        } else if (input.action === 'remove') {
          state.document.layers = state.document.layers.filter((l) => l.id !== layer.id);
          delete state.runtimes[layer.id];
          this.pruneGlobalHotkeys(state);
        } else if (input.action === 'duplicate') {
          const panels = state.document.layers.filter((l) => l.binding?.targetLayerId === layer.id);
          if (state.document.layers.length + panels.length >= 32)
            throw new Error('最多可放入 32 个图层');
          const copy = structuredClone(layer);
          // A duplicated layer must not capture the original layer's shortcuts.
          if (copy.hotkeys)
            copy.hotkeys = copy.hotkeys.map((h) => ({ ...h, id: randomUUID(), enabled: false }));
          copy.id = randomUUID();
          copy.name = `${layer.name.slice(0, 50)} 副本`;
          copy.x += 24;
          copy.y += 24;
          copy.locked = false;
          state.document.layers.splice(state.document.layers.indexOf(layer) + 1, 0, copy);
          state.runtimes[copy.id] = emptyRuntime();
          for (const panel of panels) {
            const child = structuredClone(panel);
            child.id = randomUUID();
            child.name = `${copy.name.slice(0, 35)} · ${panel.name.slice(-20)}`;
            child.binding = { targetLayerId: copy.id };
            child.x += 24;
            child.y += 24;
            child.locked = false;
            state.document.layers.splice(state.document.layers.indexOf(copy) + 1, 0, child);
            state.runtimes[child.id] = emptyRuntime();
          }
        } else if (input.action === 'reorder') {
          this.revision(state, input.revision);
          const target = this.layer(state, input.targetId);
          if (target.id === layer.id) return;
          const layers = state.document.layers.filter((l) => l.id !== layer.id);
          // Documents paint bottom to top; the layer list displays the reverse order.
          layers.splice(layers.indexOf(target) + (input.placement === 'above' ? 1 : 0), 0, layer);
          state.document.layers = layers;
        } else if (input.action === 'order') {
          const i = state.document.layers.indexOf(layer),
            next = i + (input.direction === 'up' ? 1 : -1);
          if (next >= 0 && next < state.document.layers.length)
            [state.document.layers[i], state.document.layers[next]] = [
              state.document.layers[next]!,
              layer,
            ];
        } else if (input.action === 'upgrade') {
          if (runtime.status === 'running') throw new Error('请先暂停图层，再更新版本');
          const previousSource = this.source(layer).source;
          const latest = this.plugins.installedItem(layer.pluginId);
          const source = latest.manifest.sceneSources?.find((s) => s.id === layer.sourceId);
          if (!source) throw new Error('新版已移除此来源，请保留旧版或添加其他来源');
          this.plugins.validateInstalled(layer.pluginId, latest.manifest.version);
          const keys = new Set(sceneParameters(source).map((p) => p.key));
          layer.settings = validateSceneSettings(
            source,
            Object.fromEntries(Object.entries(layer.settings).filter(([key]) => keys.has(key))),
          );
          layer.rules = validateGameRules(source.events, layer.rules);
          this.checkHotkeys(layer, layer.hotkeys ?? [], source);
          if (!source.themes.some((t) => t.id === layer.theme) && source.themes.length)
            throw new Error('新版不支持目前主题');
          // A scaled source owns its intrinsic aspect ratio. Preserve the user's
          // scale and position when a plugin changes its native composition.
          if (
            source.sizing === 'scale' &&
            (source.width !== previousSource.width || source.height !== previousSource.height)
          ) {
            const previousSize = layer.contentSize ?? previousSource;
            const scale = Math.min(
              layer.width / previousSize.width,
              layer.height / previousSize.height,
            );
            layer.contentSize = { width: source.width, height: source.height };
            layer.width = source.width * scale;
            layer.height = source.height * scale;
          }
          layer.pluginVersion = latest.manifest.version;
          if (source.kind === 'instructions' && layer.contentSize === undefined)
            layer.contentSize = { width: layer.width, height: layer.height };
          if (runtime.game.round)
            Object.assign(runtime.game.round, {
              packageVersion: layer.pluginVersion,
              events: source.events,
              themes: source.themes,
            });
          if (source.statusSourceId && !previousSource.statusSourceId) this.addStatus(state, layer);
          this.pruneGlobalHotkeys(state);
        } else if (input.action === 'control') {
          if (['status', 'view'].includes(this.source(layer).source.kind ?? ''))
            throw new Error('状态面板跟随绑定玩法，请在玩法图层控制运行');
          if (input.state === 'start' || input.state === 'reset')
            state.runtimes[layer.id] = this.fresh(
              layer,
              input.mode ?? runtime.mode,
              input.initial ?? layer.initial ?? runtime.game.round?.initial,
            );
          else if (input.state === 'pause') {
            if (runtime.status !== 'running') throw new Error('此图层没有正在运行');
            const { source } = this.available(layer, runtime);
            if (advanceDuel(source, layer, runtime) && runtime.battle?.phase === 'finished')
              this.complete(runtime, layer);
            this.pause(runtime);
          } else if (input.state === 'stop') {
            runtime.status = 'stopped';
            runtime.elapsedMs = 0;
            if (runtime.game.round) runtime.game.round.status = 'stopped';
          } else {
            if (runtime.status !== 'paused') throw new Error('只能继续暂停中的图层');
            this.available(layer, runtime);
            this.source(layer, true);
            if (
              runtime.mode === 'live' &&
              (this.connection().state !== 'connected' || this.connection().webId !== runtime.webId)
            )
              throw new Error('请连接原直播间，或重新开始');
            runtime.startedAt = new Date().toISOString();
            runtime.startSeq = this.latestSeq();
            runtime.status = 'running';
          }
        } else if (input.action === 'setCounter') {
          const { source } = this.source(layer, true);
          if (!source.counter) throw new Error('此来源没有可调整的当前数量');
          if (!['running', 'paused'].includes(runtime.status))
            throw new Error('请先启动玩法，再调整当前数量');
          this.ensureRound(runtime, layer, source);
          const round = runtime.game.round!;
          const visible = visibleVariables(source, runtime);
          round.remaining = input.value;
          runtime.game.recent = [];
          runtime.game.lastAction = null;
          if (input.value === '0') {
            this.complete(runtime, layer);
          } else if (round.status === 'won') {
            round.status = 'running';
            this.resumeCompletion(runtime, source, layer, visible);
          }
        } else if (input.action === 'manual' || input.action === 'hotkey') {
          if (runtime.status !== 'running' || !runtime.game.round)
            throw new Error('请先启动或继续此玩法');
          const { source } = this.available(layer, runtime);
          const binding =
            input.action === 'hotkey'
              ? layer.hotkeys?.find((h) => h.id === input.hotkeyId && h.enabled)
              : undefined;
          if (input.action === 'hotkey' && !binding) throw new Error('热键绑定已停用或移除');
          const eventId = binding?.eventId ?? (input.action === 'manual' ? input.eventId : '');
          const amount = binding?.amount ?? (input.action === 'manual' ? input.amount : 0);
          const event = source.events.find((e) => e.id === eventId);
          if (!event || amount < event.min || amount > event.max) throw new Error('动作参数不支持');
          const fingerprint = JSON.stringify({ ...input, requestId: undefined });
          if (!this.remember(`manual:${runtime.game.round.id}:${input.requestId}`, fingerprint))
            return;
          const label = input.action === 'hotkey' ? '热键补触发' : '手动补触发';
          this.apply(
            runtime,
            source,
            layer,
            {
              giftId: '0',
              giftName: label,
              eventId,
              amount,
              delta:
                event.operation === 'effect'
                  ? 0
                  : amount * (event.operation === 'subtract' ? -1 : 1),
            },
            '1',
            '主播',
          );
          this.push(runtime, {
            id: input.requestId,
            kind: 'status',
            source: runtime.mode,
            webId: runtime.webId,
            at: new Date().toISOString(),
            data: {
              origin: input.action,
              eventId,
              eventName: event.label,
              amount,
              accelerator: binding?.accelerator ?? '',
            },
          });
        } else if (input.action === 'simulateObservation') {
          if (runtime.mode !== 'demo' || runtime.status !== 'running')
            throw new Error('请先开始试玩此图层');
          const { source } = this.available(layer, runtime);
          if (!source.observations?.some((o) => o.kind === input.kind))
            throw new Error('此来源不接收该观测');
          if (
            !this.remember(
              `demo:${runtime.game.round?.id}:${input.requestId}`,
              JSON.stringify(input),
            )
          )
            return;
          this.observe(source, runtime, input.kind, input.quantity);
          this.push(runtime, {
            id: input.requestId,
            kind: 'message',
            source: 'demo',
            webId: 'demo',
            at: new Date().toISOString(),
            data: { metric: input.kind, quantity: input.quantity },
          });
        } else if (input.action === 'simulate' || input.action === 'trigger') {
          if (runtime.mode !== 'demo') throw new Error('模拟事件只适用试玩模式');
          const fingerprint = JSON.stringify({ ...input, requestId: undefined });
          if (!this.remember(`demo:${runtime.game.round?.id}:${input.requestId}`, fingerprint))
            return;
          if (runtime.status !== 'running') throw new Error('请先开始试玩此图层');
          const { source } = this.available(layer, runtime);
          const rule =
            input.action === 'simulate'
              ? layer.rules.find((r) => r.giftId === input.giftId)
              : (() => {
                  const event = source.events.find((e) => e.id === input.eventId);
                  if (!event || input.amount < event.min || input.amount > event.max)
                    throw new Error('动作参数不支持');
                  return {
                    giftId: '0',
                    giftName: '手动预览',
                    eventId: event.id,
                    amount: input.amount,
                    delta:
                      event.operation === 'effect'
                        ? 0
                        : input.amount * (event.operation === 'subtract' ? -1 : 1),
                  };
                })();
          if (!rule) throw new Error('此礼物尚未设置触发功能');
          const event: SceneEvent = {
            id: input.requestId,
            kind: 'gift',
            source: 'demo',
            webId: 'demo',
            at: new Date().toISOString(),
            data: {
              giftId: rule.giftId,
              giftName: rule.giftName,
              quantity: input.action === 'simulate' ? input.quantity : '1',
              senderName: '试玩观众',
            },
          };
          this.apply(runtime, source, layer, rule, String(event.data.quantity), '试玩观众');
          this.push(runtime, event);
          if (input.action === 'simulate')
            this.observeGift(source, runtime, 'demo', Number(input.quantity));
        }
      }
      this.save(
        state,
        ![
          'control',
          'simulate',
          'globalGift',
          'globalHotkey',
          'trigger',
          'simulateObservation',
          'manual',
          'hotkey',
          'setCounter',
        ].includes(input.action),
      );
      if (
        ![
          'control',
          'simulate',
          'globalGift',
          'globalHotkey',
          'trigger',
          'simulateObservation',
          'manual',
          'hotkey',
          'setCounter',
          'retrySource',
        ].includes(input.action)
      )
        this.rememberEdit(before, this.read(), input);
    });
  }
  private historyEntry(state: State, other: State): HistoryEntry {
    return {
      document: structuredClone(state.document),
      removed: Object.fromEntries(
        Object.entries(state.runtimes)
          .filter(([id]) => !other.document.layers.some((l) => l.id === id))
          .map(([id, runtime]) => {
            const copy = structuredClone(runtime);
            if (copy.status === 'running') this.pause(copy);
            copy.events = [];
            copy.game.recent = [];
            copy.game.lastAction = null;
            return [id, copy];
          }),
      ),
    };
  }
  importDocument(input: SceneDocument) {
    const document = structuredClone(sceneDocumentSchema.parse(input));
    this.store.transaction(() => {
      const current = this.read(),
        library = this.library();
      if (library.length >= 99) throw new Error('最多可保存 100 个场景');
      const ids = new Map(document.layers.map((layer) => [layer.id, randomUUID()]));
      document.id = randomUUID();
      document.name = `${document.name.slice(0, 54)} · 导入`;
      document.revision = 0;
      document.updatedAt = new Date().toISOString();
      let unavailable = false;
      for (const layer of document.layers) {
        layer.id = ids.get(layer.id)!;
        if (layer.binding) {
          const target = ids.get(layer.binding.targetLayerId);
          if (!target) throw new Error('场景包的图层绑定无效');
          layer.binding.targetLayerId = target;
        }
        layer.hotkeys = layer.hotkeys?.map((h) => ({ ...h, id: randomUUID(), enabled: false }));
        let source: SceneSource;
        try {
          source = this.source(layer).source;
        } catch {
          unavailable = true;
          continue;
        }
        layer.settings = validateSceneSettings(source, layer.settings);
        layer.rules = validateGameRules(source.events, layer.rules);
        this.checkHotkeys(layer, layer.hotkeys ?? [], source);
      }
      this.endInteractions(current);
      library.push(current);
      this.save({ document, runtimes: {} });
      this.store.set('scene:library', library);
      this.warning = unavailable
        ? '场景已导入，部分插件版本尚未安装，请从插件区安装后再运行。'
        : undefined;
    });
  }
  private rememberEdit(before: State, after: State, input: SceneCommand) {
    const signature = (document: SceneDocument) =>
      JSON.stringify({ ...document, revision: 0, updatedAt: '' });
    if (signature(before.document) === signature(after.document)) return;
    const key = `scene:history:${before.document.id}`;
    const history = this.store.get<History>(key, { undo: [], redo: [] });
    const coalesce =
      input.action === 'settings'
        ? `settings:${input.id}:${Object.keys(input.values).sort().join(',')}`
        : '';
    if (!coalesce || history.key !== coalesce || Date.now() - (history.at ?? 0) > 600)
      history.undo.push(this.historyEntry(before, after));
    history.undo = history.undo.slice(-30);
    history.redo = [];
    history.key = coalesce;
    history.at = Date.now();
    this.store.set(key, history);
  }
  private restoreHistory(current: State, direction: 'undo' | 'redo') {
    const key = `scene:history:${current.document.id}`;
    const history = this.store.get<History>(key, { undo: [], redo: [] });
    const entry = history[direction].pop();
    if (!entry) throw new Error(direction === 'undo' ? '没有可撤销的操作' : '没有可重做的操作');
    const document = sceneDocumentSchema.parse({
      ...entry.document,
      revision: current.document.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    const next: State = { document, runtimes: {} };
    for (const layer of document.layers) {
      const runtime = structuredClone(
        current.runtimes[layer.id] ?? entry.removed[layer.id] ?? emptyRuntime(),
      );
      const oldLayer = current.document.layers.find((l) => l.id === layer.id);
      // Undo changes configuration only; live gifts and accumulated progress stay authoritative.
      if (runtime.game.round) {
        Object.assign(runtime.game.round, {
          rules: layer.rules,
          theme: layer.theme,
          packageVersion: layer.pluginVersion,
        });
        try {
          const source = this.source(layer).source;
          runtime.game.round.events = source.events;
          runtime.game.round.themes = source.themes;
        } catch {
          if (runtime.status === 'running') this.pause(runtime);
        }
      }
      if (
        !oldLayer ||
        oldLayer.pluginVersion !== layer.pluginVersion ||
        oldLayer.sourceId !== layer.sourceId
      ) {
        if (runtime.status === 'running') this.pause(runtime);
      }
      next.runtimes[layer.id] = runtime;
    }
    history[direction === 'undo' ? 'redo' : 'undo'].push(this.historyEntry(current, next));
    delete history.key;
    this.save(next);
    this.store.set(key, history);
  }
  private checkHotkeys(
    layer: SceneLayer,
    bindings: SceneHotkey[],
    source = this.source(layer).source,
  ) {
    for (const binding of bindings) {
      const event = source.events.find((e) => e.id === binding.eventId);
      if (!event || binding.amount < event.min || binding.amount > event.max)
        throw new Error('热键事件或数量不支持，请重新配置');
    }
  }
  reportFailure(id: string, message: string) {
    this.store.transaction(() => {
      const state = this.read();
      this.layer(state, id);
      const runtime = (state.runtimes[id] ??= emptyRuntime());
      if (runtime.failure) return;
      if (runtime.status === 'running') this.pause(runtime);
      runtime.failure = {
        message: `来源运行错误：${message.slice(0, 500)}`,
        at: new Date().toISOString(),
      };
      this.save(state);
    });
  }
  private remember(key: string, fingerprint: string) {
    const old = this.store.db
      .prepare('SELECT fingerprint FROM scene_requests WHERE key=?')
      .get(key);
    if (old) {
      if (old.fingerprint !== fingerprint) throw new Error('事件 ID 已用于其他内容');
      return false;
    }
    this.store.db
      .prepare('INSERT INTO scene_requests VALUES(?,?,?)')
      .run(key, fingerprint, new Date().toISOString());
    return true;
  }
  private push(runtime: SceneRuntime, event: SceneEvent) {
    runtime.eventSeq = (runtime.eventSeq ?? 0) + 1;
    runtime.events = [...runtime.events, { ...event, seq: runtime.eventSeq }].slice(-256);
  }
  private apply(
    runtime: SceneRuntime,
    source: SceneSource,
    layer: SceneLayer,
    rule: GameRule,
    quantity: string,
    senderName: string,
  ) {
    if (source.battle) {
      advanceDuel(source, layer, runtime);
      if (runtime.battle?.phase === 'finished') this.complete(runtime, layer);
      if (runtime.battle?.winner || runtime.battle?.phase === 'finished') return;
    }
    const round = runtime.game.round!;
    const before = BigInt(round.remaining),
      requested = BigInt(quantity) * BigInt(rule.delta);
    const definition = source.events.find((e) => e.id === rule.eventId);
    const mutation = definition?.mutation;
    const after =
      mutation?.target === 'remaining'
        ? mutateCounter(before, mutation.operation, mutation.value ?? rule.amount ?? 1, quantity)
        : before + requested < 0n
          ? 0n
          : before + requested;
    if (definition) applyVariable(source, runtime, definition, rule.amount ?? 1, Number(quantity));
    if (source.battle) syncDuelHealth(runtime);
    if (after > 9999999999999999999999999999999999999999n) throw new Error('计数超出上限');
    const won = !!source.counter && before > 0n && after === 0n;
    const action: GameAction = {
      seq: (runtime.actionSeq = (runtime.actionSeq ?? 0) + 1),
      id: randomUUID(),
      roundId: round.id,
      giftId: rule.giftId,
      giftName: rule.giftName,
      senderName,
      quantity,
      delta: (after - before).toString(),
      before: before.toString(),
      after: after.toString(),
      eventId: rule.eventId,
      eventName: source.events.find((e) => e.id === rule.eventId)?.label,
      value: (BigInt(quantity) * BigInt(rule.amount ?? 1)).toString(),
      won,
      at: new Date().toISOString(),
    };
    round.remaining = after.toString();
    const clocks = source.variables?.filter((v) => v.finishAtZero) ?? [];
    const visible = visibleVariables(source, runtime);
    const expired = clocks.some((v) => visible[v.key] === 0);
    const timeRestored = clocks.some((v) => v.key === mutation?.target) && !expired;
    if (round.status === 'won' && after > 0n && (after > before || timeRestored)) {
      this.resumeCompletion(runtime, source, layer, visible);
      round.status = 'running';
    } else if ((source.counter && after === 0n) || expired) this.complete(runtime, layer);
    runtime.game.recent = [action, ...runtime.game.recent].slice(0, 256);
    runtime.game.lastAction = action;
  }
  private emitGlobalGift(
    state: State,
    giftId: string,
    quantity: string,
    requestId: string,
    senderName: string,
  ) {
    if (!/^[1-9][0-9]{0,5}$/.test(quantity)) throw new Error('礼物数量须为 1–999,999');
    const fingerprint = JSON.stringify({ giftId, quantity, senderName });
    if (!this.remember(`global:${requestId}`, fingerprint)) return false;
    const giftName = this.giftInfo(giftId)?.name ?? giftId;
    const webId = this.connection().state === 'connected' ? this.connection().webId : '';
    const at = new Date().toISOString();
    let changed = false;
    for (const layer of state.document.layers) {
      const runtime = state.runtimes[layer.id];
      if (!runtime || runtime.status !== 'running' || runtime.mode !== 'live') continue;
      let source: SceneSource;
      try {
        source = this.available(layer, runtime).source;
      } catch {
        continue;
      }
      const rule = layer.rules.find((entry) => entry.giftId === giftId);
      if (!rule) continue;
      if (!runtime.webId && webId) {
        runtime.webId = webId;
        if (runtime.game.round) runtime.game.round.webId = webId;
      }
      this.ensureRound(runtime, layer, source);
      if (runtime.game.round) runtime.game.round.webId = runtime.webId || webId;
      this.apply(runtime, source, layer, rule, quantity, senderName);
      this.push(runtime, {
        id: requestId,
        kind: 'gift',
        source: 'live',
        webId: runtime.webId || webId,
        at,
        data: { giftId, giftName, quantity, senderName },
      });
      this.observeGift(source, runtime, '', Number(quantity));
      changed = true;
    }
    return changed;
  }

  globalGift(giftId: string, quantity: string, requestId: string, senderName = '测试观众') {
    this.store.transaction(() => {
      const state = this.read();
      if (this.emitGlobalGift(state, giftId, quantity, requestId, senderName)) this.save(state);
    });
  }

  // Called inside LocalStore.ingest's transaction after combo normalization and dedup.
  ingest(gift: GiftEvent) {
    if (!gift.delta || BigInt(gift.delta) <= 0n || gift.quality === 'duplicate' || !gift.seq)
      return;
    const state = this.read();
    let changed = false;
    for (const layer of state.document.layers) {
      const runtime = state.runtimes[layer.id];
      if (
        !runtime ||
        runtime.status !== 'running' ||
        runtime.mode !== 'live' ||
        (runtime.webId && runtime.webId !== gift.webId) ||
        BigInt(gift.seq) <= BigInt(runtime.startSeq) ||
        Date.parse(gift.receivedAt) < Date.parse(runtime.startedAt)
      )
        continue;
      if (!runtime.webId) {
        runtime.webId = gift.webId;
        if (runtime.game.round) runtime.game.round.webId = gift.webId;
      }
      let source: SceneSource;
      try {
        source = this.available(layer, runtime).source;
      } catch {
        this.pause(runtime);
        changed = true;
        continue;
      }
      if (!this.remember(`gift:${layer.id}:${gift.id}`, gift.delta)) continue;
      const rule = layer.rules.find((r) => r.giftId === gift.giftId);
      if (rule) {
        // Armed layers do not own a round until the first real event arrives.
        // Create it here so a restarted or newly connected room can never reuse
        // the previous stream's round identity.
        this.ensureRound(runtime, layer, source);
        this.apply(runtime, source, layer, rule, gift.delta, gift.senderName);
      }
      this.push(runtime, {
        id: gift.id,
        kind: 'gift',
        source: gift.source,
        webId: gift.webId,
        at: gift.receivedAt,
        data: {
          giftId: gift.giftId,
          giftName: gift.giftName,
          quantity: gift.delta,
          senderName: gift.senderName,
          senderId: gift.senderId,
        },
      });
      this.observeGift(source, runtime, gift.senderId, Number(gift.delta));
      changed = true;
    }
    if (changed) this.save(state);
  }
  event(event: SceneEvent) {
    this.store.transaction(() => {
      const state = this.read();
      let changed = false;
      for (const layer of state.document.layers) {
        const runtime = state.runtimes[layer.id];
        if (
          !runtime ||
          runtime.status !== 'running' ||
          runtime.mode !== 'live' ||
          (!!runtime.webId && runtime.webId !== event.webId)
        )
          continue;
        try {
          const { item, source } = this.available(layer, runtime);
          if (!item.manifest.permissions.includes('scene-events')) continue;
          if (Date.parse(event.at) < Date.parse(runtime.startedAt)) continue;
          if (
            !this.remember(
              `event:${layer.id}:${runtime.game.round?.id}:${event.id}`,
              JSON.stringify(event.data),
            )
          )
            continue;
          if (event.data.metric === 'like' || event.data.metric === 'follow')
            this.ensureRound(runtime, layer, source);
          if (event.data.metric === 'like')
            this.observe(source, runtime, 'like', Number(event.data.quantity ?? 0));
          if (
            event.data.metric === 'follow' &&
            event.data.senderId &&
            this.remember(`follow:${runtime.game.round?.id}:${event.data.senderId}`, '1')
          )
            this.observe(source, runtime, 'follow', 1);
          this.push(runtime, event);
          changed = true;
        } catch {
          this.pause(runtime);
          changed = true;
        }
      }
      if (changed) this.save(state);
    });
  }
  private pause(runtime: SceneRuntime, at = Date.now()) {
    if (runtime.status === 'running') runtime.elapsedMs = elapsedSeconds(runtime, at) * 1000;
    runtime.status = 'paused';
  }
  private complete(runtime: SceneRuntime, layer: SceneLayer) {
    if (runtime.game.round) runtime.game.round.status = 'won';
    if (runtime.completedAt === undefined) {
      runtime.completedAt = Date.now();
      runtime.completionId = randomUUID();
      runtime.completionDurationMs =
        Math.min(5, Math.max(3, Number(layer.settings.completionDuration ?? 4))) * 1000;
    }
  }
  private resumeCompletion(
    runtime: SceneRuntime,
    source: SceneSource,
    layer: SceneLayer,
    visible: Record<string, number>,
  ) {
    // Keep the clock frozen during completion and retain the event receipt boundary.
    delete runtime.completedAt;
    delete runtime.completionId;
    delete runtime.completionDurationMs;
    const elapsed = elapsedSeconds(runtime);
    const defaults = initialVariables(source, layer);
    for (const variable of source.variables ?? []) {
      if (!variable.clock) continue;
      const remaining = visible[variable.key] ?? 0;
      (runtime.variables ??= {})[variable.key] =
        (remaining === 0 && variable.finishAtZero ? defaults[variable.key]! : remaining) + elapsed;
    }
  }
  private observe(source: SceneSource, runtime: SceneRuntime, kind: string, quantity: number) {
    if (!Number.isFinite(quantity) || quantity <= 0) return;
    for (const observation of source.observations ?? []) {
      if (observation.kind !== kind) continue;
      const variables = (runtime.variables ??= {});
      variables[observation.target] = Math.min(
        1_000_000_000,
        (variables[observation.target] ?? 0) + quantity,
      );
    }
  }
  private observeGift(
    source: SceneSource,
    runtime: SceneRuntime,
    senderId: string,
    quantity: number,
  ) {
    this.observe(source, runtime, 'gift', quantity);
    if (
      senderId &&
      source.observations?.some((o) => o.kind === 'gift-sender') &&
      this.remember(`sender:${runtime.game.round?.id}:${senderId}`, '1')
    )
      this.observe(source, runtime, 'gift-sender', 1);
  }
  pauseAll() {
    const state = this.read();
    for (const runtime of Object.values(state.runtimes))
      if (runtime.status === 'running') this.pause(runtime);
    this.save(state);
  }
  reconcile() {
    const state = this.read();
    let changed = false;
    for (const layer of state.document.layers) {
      const runtime = state.runtimes[layer.id];
      if (runtime?.status !== 'running') continue;
      try {
        const { source } = this.available(layer, runtime);
        if (
          runtime.mode === 'live' &&
          runtime.webId &&
          this.connection().state === 'connected' &&
          this.connection().webId !== runtime.webId
        )
          throw new Error();
        if (source.battle && advanceDuel(source, layer, runtime)) {
          if (runtime.battle?.phase === 'finished') this.complete(runtime, layer);
          changed = true;
        }
        const variables = visibleVariables(source, runtime);
        if (
          runtime.game.round?.status !== 'won' &&
          source.variables?.some((v) => v.finishAtZero && variables[v.key] === 0)
        ) {
          this.complete(runtime, layer);
          changed = true;
        }
      } catch {
        this.pause(runtime);
        changed = true;
      }
    }
    if (changed) this.save(state);
    return changed;
  }
}
