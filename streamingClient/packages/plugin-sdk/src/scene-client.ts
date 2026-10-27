import type { SceneFrameState, SceneEvent, GameAction } from '../../contracts/src/index';
import { DeliveryCursor, type DeliveryGap } from './cursor';
export interface SceneLifecycle {
  onStart?(state: SceneFrameState): void;
  onPause?(state: SceneFrameState): void;
  onResume?(state: SceneFrameState): void;
  onStop?(state: SceneFrameState): void;
  onVisibility?(visible: boolean): void;
  onAudio?(enabled: boolean): void;
  onResize?(viewport: NonNullable<SceneFrameState['viewport']>): void;
  onDispose?(): void;
}
export class SceneClient {
  private state: SceneFrameState | null = null;
  private listeners = new Set<(state: SceneFrameState) => void>();
  private cleanup = new Set<() => void>();
  private disposed = false;
  constructor(
    private ready: () => void,
    private report: (error: unknown) => void,
  ) {}
  private safe(fn: () => void) {
    try {
      fn();
    } catch (error) {
      this.report(error);
    }
  }
  receive(raw: unknown) {
    const state = raw as SceneFrameState;
    if (
      this.disposed ||
      !state ||
      typeof state.layerId !== 'string' ||
      !state.game ||
      !Array.isArray(state.events) ||
      !Array.isArray(state.game.recent) ||
      !['idle', 'running', 'paused', 'stopped', 'won'].includes(state.status)
    )
      return;
    this.state = state;
    for (const listener of [...this.listeners]) this.safe(() => listener(state));
  }
  current() {
    return this.state;
  }
  subscribe(listener: (state: SceneFrameState) => void) {
    if (this.disposed) throw new Error('场景来源已销毁');
    this.listeners.add(listener);
    if (this.state) this.safe(() => listener(this.state!));
    this.ready();
    return () => {
      this.listeners.delete(listener);
    };
  }
  onEvent(
    listener: (event: SceneEvent) => void,
    options: { onGap?: (gap: DeliveryGap) => void } = {},
  ) {
    const cursor = new DeliveryCursor<SceneEvent>();
    return this.subscribe((state) => {
      const epoch = `${state.layerId}:${state.game.round?.id ?? ''}:${state.mode}`;
      const events = cursor.consume(epoch, state.events, (gap) =>
        this.safe(() => options.onGap?.(gap)),
      );
      events.forEach((event) => this.safe(() => listener(event)));
    });
  }
  onAction(
    listener: (action: GameAction) => void,
    options: { onGap?: (gap: DeliveryGap) => void } = {},
  ) {
    const cursor = new DeliveryCursor<GameAction>();
    return this.subscribe((state) => {
      const epoch = `${state.layerId}:${state.game.round?.id ?? ''}:${state.mode}`;
      const actions = cursor.consume(epoch, [...state.game.recent].reverse(), (gap) =>
        this.safe(() => options.onGap?.(gap)),
      );
      actions.forEach((action) => this.safe(() => listener(action)));
    });
  }
  lifecycle(hooks: SceneLifecycle) {
    let previous: SceneFrameState | null = null;
    let disposed = false;
    const stop = this.subscribe((state) => {
      const changed = !previous || previous.game.round?.id !== state.game.round?.id;
      if (state.status === 'running' && (changed || previous?.status !== 'running'))
        this.safe(() =>
          changed || previous?.status !== 'paused'
            ? hooks.onStart?.(state)
            : hooks.onResume?.(state),
        );
      if (state.status === 'paused' && previous?.status === 'running')
        this.safe(() => hooks.onPause?.(state));
      if (state.status === 'stopped' && previous?.status !== 'stopped')
        this.safe(() => hooks.onStop?.(state));
      if (!previous || previous.visible !== state.visible)
        this.safe(() => hooks.onVisibility?.(state.visible !== false));
      if (!previous || previous.audio?.enabled !== state.audio?.enabled)
        this.safe(() => hooks.onAudio?.(!!state.audio?.enabled));
      if (state.viewport && JSON.stringify(previous?.viewport) !== JSON.stringify(state.viewport))
        this.safe(() => hooks.onResize?.(state.viewport!));
      previous = state;
    });
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      stop();
      this.cleanup.delete(dispose);
      this.safe(() => hooks.onDispose?.());
    };
    this.cleanup.add(dispose);
    return dispose;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of [...this.cleanup]) cleanup();
    this.listeners.clear();
  }
}
