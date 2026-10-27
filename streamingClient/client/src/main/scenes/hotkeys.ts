import { randomUUID } from 'node:crypto';
import {
  platformHotkey,
  type SceneCommand,
  type SceneHotkeyStatus,
  type SceneSnapshot,
} from '@zhuda/contracts';

interface Shortcuts {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}
type Entry = { accelerator: string; signature: string; registered: boolean };
export class SceneHotkeys {
  private entries = new Map<string, Entry>();
  private statuses: SceneHotkeyStatus[] = [];
  private history = new Map<string, { lastTriggeredAt?: string; lastResult?: string }>();
  private pressed = new Map<string, number>();
  private suspended = false;
  private disposed = false;
  constructor(
    private shortcuts: Shortcuts,
    private fire: (command: SceneCommand) => Promise<void>,
    private changed: () => void,
    private platform = process.platform as string,
  ) {}
  capture(active: boolean) {
    this.suspended = active;
    if (active) this.clear();
  }
  private clear() {
    for (const entry of this.entries.values())
      if (entry.registered) this.shortcuts.unregister(entry.accelerator);
    this.entries.clear();
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
  sync(scene: SceneSnapshot) {
    if (this.disposed) return;
    // Live scene plugins are driven by scene-level gift mappings. Ignore old
    // per-layer bindings there so a migrated scene cannot keep registering
    // shortcuts that target one plugin instance.
    const bindings = scene.layers.flatMap((view) =>
      view.runtime.mode === 'live'
        ? []
        : (view.layer.hotkeys ?? []).map((binding) => ({ view, binding })),
    );
    const owners = new Map<string, number>();
    for (const { binding } of bindings)
      if (binding.enabled) {
        const key = platformHotkey(binding.accelerator, this.platform);
        owners.set(key, (owners.get(key) ?? 0) + 1);
      }
    const wanted = new Map<
      string,
      {
        accelerator: string;
        signature: string;
        layerId: string;
        hotkeyId: string;
        global?: boolean;
      }
    >();
    this.statuses = bindings.map(({ view, binding }) => {
      const id = `${scene.document.id}:${view.layer.id}:${binding.id}`;
      const status: SceneHotkeyStatus = {
        layerId: view.layer.id,
        hotkeyId: binding.id,
        state: 'waiting',
        message: '启动玩法后生效',
        ...this.history.get(id),
      };
      const event = view.source?.events.find((e) => e.id === binding.eventId);
      if (!binding.enabled) Object.assign(status, { state: 'disabled', message: '已停用' });
      else if (
        !view.available ||
        !event ||
        binding.amount < event.min ||
        binding.amount > event.max
      )
        Object.assign(status, {
          state: 'error',
          message: view.error ?? '事件或数量已失效，请重新配置',
        });
      else if (owners.get(platformHotkey(binding.accelerator, this.platform))! > 1)
        Object.assign(status, { state: 'conflict', message: '当前场景有重复热键，请修改其中一个' });
      else if (this.suspended)
        Object.assign(status, { state: 'suspended', message: '配置期间暂停热键' });
      else if (view.runtime.status === 'running') {
        wanted.set(id, {
          accelerator: binding.accelerator,
          signature: JSON.stringify(binding),
          layerId: view.layer.id,
          hotkeyId: binding.id,
        });
        status.state = 'active';
        status.message = '全局热键已生效';
      }
      return status;
    });
    for (const binding of scene.document.globalHotkeys ?? []) {
      const id = `global:${scene.document.id}:${binding.id}`;
      const status: SceneHotkeyStatus = {
        layerId: '',
        hotkeyId: binding.id,
        scope: 'global',
        state: 'waiting',
        message: '全局热键等待中',
        ...this.history.get(id),
      };
      if (!binding.enabled) Object.assign(status, { state: 'disabled', message: '已停用' });
      else if (this.suspended)
        Object.assign(status, { state: 'suspended', message: '配置期间暂停注册' });
      else {
        wanted.set(id, {
          accelerator: binding.accelerator,
          signature: JSON.stringify(binding),
          layerId: '',
          hotkeyId: binding.id,
          global: true,
        });
        status.state = 'active';
        status.message = '全局热键已生效';
      }
      this.statuses.push(status);
    }
    for (const [id, entry] of this.entries) {
      if (wanted.get(id)?.signature === entry.signature) continue;
      if (entry.registered) this.shortcuts.unregister(entry.accelerator);
      this.entries.delete(id);
    }
    for (const [id, spec] of wanted) {
      if (!this.entries.has(id)) {
        const entry: Entry = { ...spec, registered: false };
        this.entries.set(id, entry);
        try {
          entry.registered = this.shortcuts.register(spec.accelerator, () => {
            if (this.disposed || this.suspended || this.entries.get(id) !== entry) return;
            const now = Date.now();
            if (now - (this.pressed.get(id) ?? 0) < 250) return;
            this.pressed.set(id, now);
            void this.fire(
              spec.global
                ? {
                    action: 'globalHotkey',
                    sceneId: scene.document.id,
                    hotkeyId: spec.hotkeyId,
                    requestId: randomUUID(),
                  }
                : {
                    action: 'hotkey',
                    sceneId: scene.document.id,
                    id: spec.layerId,
                    hotkeyId: spec.hotkeyId,
                    requestId: randomUUID(),
                  },
            ).then(
              () => {
                this.history.set(id, {
                  lastTriggeredAt: new Date().toISOString(),
                  lastResult: '已补触发',
                });
                this.changed();
              },
              (error) => {
                this.history.set(id, {
                  lastResult: error instanceof Error ? error.message : '热键触发失败',
                });
                this.changed();
              },
            );
          });
        } catch {
          entry.registered = false;
        }
      }
      if (!this.entries.get(id)!.registered) {
        const status = this.statuses.find(
          (s) => s.layerId === spec.layerId && s.hotkeyId === spec.hotkeyId,
        )!;
        status.state = 'error';
        status.message = '注册失败：按键被占用或系统不支持，请更换组合';
      }
    }
  }
  snapshot() {
    return this.statuses.map((s) => ({ ...s }));
  }
}
