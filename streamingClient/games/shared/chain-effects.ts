import type { GameAction } from '@zhuda/contracts';
import { ChainCanvas } from './chain-canvas';
import { chainChange, clipChainFace } from './chain-layout';
import { chainTheme, chainMaterials, type ChainTheme } from './chain-themes';

type Kind = 'lock' | 'unlock';
interface Batch {
  kind: Kind;
  delta: bigint;
  count: number;
  action: GameAction;
  before: bigint;
  after: bigint;
}
export class ChainEffects {
  private field: ChainCanvas;
  private overlay: HTMLCanvasElement;
  private pending: Batch[] = [];
  private active: Batch | null = null;
  private frame = 0;
  private serial = 0;
  private stopped = false;
  private target = 0n;
  private media = matchMedia('(prefers-reduced-motion: reduce)');
  private delta: HTMLElement;
  private effects: HTMLElement;
  private markers: HTMLElement[] = [];
  private theme: ChainTheme = 'classic';
  private renderScale = 1;
  private durations = { lock: 1100, unlock: 2400 };
  constructor(
    private stage: HTMLElement,
    private describe: (batch: Batch) => void,
    private sound: (kind: Kind) => void = () => {},
  ) {
    this.field = new ChainCanvas(stage.querySelector<HTMLCanvasElement>('.chain-rig')!);
    this.overlay = stage.querySelector<HTMLCanvasElement>('.chain-motion')!;
    this.delta = stage.querySelector('#delta')!;
    this.effects = stage.querySelector('#effects')!;
    this.media.addEventListener('change', this.motionChanged);
  }
  configure(settings: Record<string, string | number | boolean>) {
    const duration = (value: unknown, fallback: number, min: number, max: number) =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(min, Math.min(max, value)) * 1000
        : fallback;
    this.durations = {
      lock: duration(settings.bindDuration, 1100, 0.6, 3),
      unlock: duration(settings.dissolveDuration, 2400, 1.2, 5),
    };
  }
  setRenderScale(scale = 1) {
    this.renderScale = scale;
    this.field.setRenderScale(scale);
  }
  private motionChanged = () => {
    if (this.media.matches) {
      this.clear();
      this.field.setCount(this.target);
    }
  };
  setTheme(id?: string) {
    const theme = chainTheme(id);
    if (theme === this.theme) return;
    this.clear();
    this.delta.style.opacity = '0';
    delete this.stage.dataset.effect;
    this.field.dispose();
    this.theme = theme;
    this.field = new ChainCanvas(
      this.stage.querySelector<HTMLCanvasElement>('.chain-rig')!,
      'chain-steel.png',
      theme,
    );
    this.field.setRenderScale(this.renderScale);
    this.field.setCount(this.target);
  }
  update(remaining: string, actions: GameAction[]) {
    this.target = BigInt(remaining);
    if (!actions.length) {
      const expected = this.pending.at(-1)?.after ?? this.active?.after;
      if (expected !== undefined && expected === this.target) return;
      this.clear();
      this.field.setCount(this.target);
      return;
    }
    for (const action of actions) {
      const change = chainChange(action.before, action.after);
      if (!change.count) continue;
      const before = BigInt(action.before),
        after = BigInt(action.after);
      const last = this.pending.at(-1);
      if (last && last.kind === change.kind && last.after === before) {
        last.after = after;
        last.delta += after - before;
        last.count++;
        last.action = action;
      } else
        this.pending.push({
          kind: change.kind,
          delta: after - before,
          count: 1,
          action,
          before,
          after,
        });
    }
    if (!this.active) this.playNext();
  }
  private label(batch: Batch) {
    this.stage.dataset.effect = batch.kind;
    this.describe(batch);
    this.delta.textContent = `${batch.delta > 0n ? '+' : ''}${batch.delta.toLocaleString('en-US')} ${batch.kind === 'lock' ? '加锁' : '解锁'}`;
    this.delta.style.opacity = '1';
  }
  private playNext() {
    if (this.stopped) return;
    const batch = this.pending.shift();
    this.active = batch ?? null;
    if (!batch) {
      this.field.setCount(this.target);
      return;
    }
    this.label(batch);
    if (this.media.matches) {
      this.sound(batch.kind);
      this.field.setCount(batch.after);
      this.active = null;
      this.playNext();
      return;
    }
    const serial = this.serial;
    void this.field.ready.then(() => {
      if (serial !== this.serial || this.stopped) return;
      this.wave(batch, batch.before);
    });
  }
  private wave(batch: Batch, before: bigint) {
    this.sound(batch.kind);
    // Each wave animates every affected identity. Large gifts continue in waves;
    // neither the static renderer nor the transition substitutes representative chains.
    const lock = batch.kind === 'lock',
      step = 10000n;
    const after = lock
      ? before + step < batch.after
        ? before + step
        : batch.after
      : before - step > batch.after
        ? before - step
        : batch.after;
    const low = lock ? before : after,
      high = lock ? after : before;
    this.effects.replaceChildren();
    this.markers = [];
    this.overlay.dataset.kind = batch.kind;
    this.overlay.dataset.from = String(low);
    this.overlay.dataset.to = String(high);
    this.overlay.dataset.count = String(high - low);
    // Compute geometry, particle directions and diagnostic positions once per wave.
    // No DOM style mutations or repeated BigInt/trigonometry work in the frame loop.
    const affected = Number(high - low);
    const particles = Math.max(2, Math.min(12, Math.floor(120 / affected)));
    const drops = affected > 30 ? 1 : 4;
    const prepare = () => {
      const strands: {
        id: bigint;
        impact: ReturnType<ChainCanvas['impact']>;
        delay: number;
        dx: number;
        dy: number;
        sparks: { x: number; y: number }[];
        drops: number[];
      }[] = [];
      for (let id = low; id < high; id++) {
        const impact = this.field.impact(id);
        const phase = Number(id % 31n);
        strands.push({
          id,
          impact,
          delay: (Number((id - low) % 23n) / 23) * 0.16,
          dx: Math.cos(impact.angle) * impact.length,
          dy: Math.sin(impact.angle) * impact.length,
          sparks: Array.from({ length: particles }, (_, n) => {
            const angle = n * 2.39996 + phase;
            const distance = 18 + (n % 4) * 8;
            return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
          }),
          drops: Array.from({ length: drops }, (_, drop) => Math.sin(phase + drop)),
        });
      }
      this.markers.forEach((marker, index) => {
        const impact = strands[index]!.impact;
        marker.style.left = `${impact.impactX}px`;
        marker.style.top = `${impact.impactY}px`;
        marker.dataset.angle = String(impact.angle);
      });
      return strands;
    };
    // These zero-size markers expose a few actual impact positions for diagnostics.
    for (let id = low; id < high && id < low + 3n; id++) {
      const marker = document.createElement('i');
      marker.className = `effect-burst ${batch.kind}`;
      marker.dataset.chainId = String(id);
      this.effects.append(marker);
      this.markers.push(marker);
    }
    let strands = prepare();
    let geometrySize = `${this.field.width}:${this.field.height}`;
    // Capture a stable duration. Incoming gifts must never fast-forward an
    // in-progress crack/dissolve or shorten it to a barely visible flash.
    const duration = this.durations[batch.kind];
    this.overlay.dataset.duration = String(duration);
    const started = performance.now(),
      serial = this.serial;
    let transferred = false;
    const draw = (now: number) => {
      if (serial !== this.serial || this.stopped) return;
      const p = Math.min(1, (now - started) / duration);
      const { width, height, ratio } = this.field;
      const size = `${width}:${height}`;
      if (size !== geometrySize) {
        strands = prepare();
        geometrySize = size;
      }
      if (
        this.overlay.width !== Math.round(width * ratio) ||
        this.overlay.height !== Math.round(height * ratio)
      ) {
        this.overlay.width = Math.round(width * ratio);
        this.overlay.height = Math.round(height * ratio);
      }
      const ctx = this.overlay.getContext('2d')!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      clipChainFace(ctx, width, height);
      let rendered = 0n;
      for (const { id, impact, delay, dx, dy, sparks, drops } of strands) {
        const local = Math.max(0, Math.min(1, (p - delay) / 0.84));
        this.field.draw(ctx, id, batch.kind, local);
        rendered++;
        // Sparks accompany each real strand, with fewer sparks in dense batches.
        const flash = lock ? (local - 0.52) / 0.3 : (local - 0.06) / 0.36;
        if (flash > 0 && flash < 1) {
          const color = chainMaterials[this.theme].spark;
          ctx.fillStyle = color;
          ctx.globalAlpha = 1 - flash;
          ctx.beginPath();
          ctx.arc(impact.impactX, impact.impactY, 2 + flash * 10, 0, Math.PI * 2);
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.stroke();
          for (const spark of sparks) {
            ctx.fillRect(
              impact.impactX + spark.x * flash,
              impact.impactY + spark.y * flash + flash * flash * 18,
              this.theme === 'plush' ? 3 : 1.4,
              this.theme === 'plush' ? 3 : 1.4,
            );
          }
          ctx.globalAlpha = 1;
        }
        if (!lock && local > 0.24 && local < 1) {
          const melt = (local - 0.24) / 0.76;
          ctx.fillStyle = chainMaterials[this.theme].melt;
          ctx.globalAlpha = (1 - melt) * 0.9;
          for (const t of [impact.cut * (1 - melt), impact.cut + (1 - impact.cut) * melt]) {
            const x = impact.x + dx * t;
            const y = impact.y + dy * t;
            for (let drop = 0; drop < drops.length; drop++) {
              const fall = (melt * 3 + drop * 0.27) % 1;
              ctx.fillRect(
                x + drops[drop]! * fall * 8,
                y + fall * fall * 45,
                Math.max(0.7, 2 * (1 - fall)),
                2 + fall * 4,
              );
            }
          }
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
      // Keep the previous static image until the moving identities are actually
      // drawn. A queued wave starts in a microtask between frames; clearing its
      // static strands there would paint a blank frame before they reappear.
      if (!transferred) {
        this.field.setCount(lock ? before : after);
        transferred = true;
      }
      this.overlay.dataset.renderedCount = String(rendered);
      if (p < 1) this.frame = requestAnimationFrame(draw);
      else {
        ctx.clearRect(0, 0, width, height);
        this.field.setCount(after);
        this.effects.replaceChildren();
        this.overlay.dataset.count = '0';
        this.overlay.dataset.renderedCount = '0';
        if (after !== batch.after) this.wave(batch, after);
        else {
          this.active = null;
          this.delta.style.opacity = '0';
          this.playNext();
        }
      }
    };
    this.frame = requestAnimationFrame(draw);
  }
  private clear() {
    this.serial++;
    cancelAnimationFrame(this.frame);
    this.pending = [];
    this.active = null;
    this.overlay.getContext('2d')!.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.overlay.dataset.count = '0';
    this.overlay.dataset.renderedCount = '0';
    this.effects.replaceChildren();
  }
  reset() {
    this.clear();
    this.target = 0n;
    this.field.setCount(0n);
    this.delta.style.opacity = '0';
    delete this.stage.dataset.effect;
  }
  dispose() {
    this.reset();
    this.stopped = true;
    this.field.dispose();
    this.media.removeEventListener('change', this.motionChanged);
  }
}
