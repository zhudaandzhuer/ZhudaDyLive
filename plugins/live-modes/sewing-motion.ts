import type {
  GameAction,
  SceneFrameState,
} from "../../streamingClient/packages/contracts/src/index";

export type SewingWork =
  "idle" | "supply" | "sewing" | "overdrive" | "finished";
type Tween = { from: bigint; to: bigint; start: number; duration: number };

/** Display-only motion: the host owns the counter, even while the needle catches up. */
export class SewingMotion {
  private round: string | null | undefined;
  private status: SceneFrameState["status"] = "idle";
  private completed = false;
  private tween: Tween = { from: 0n, to: 0n, start: 0, duration: 0 };
  private sewUntil = 0;
  private supplyUntil = 0;
  private overdriveUntil = 0;
  private delivered = 0n;
  private initial = 1n;

  sync(state: SceneFrameState, actions: GameAction[], now: number) {
    const round = state.game.round;
    const target = BigInt(round?.remaining ?? "1");
    const changed = this.round !== (round?.id ?? null);
    const completed = round?.status === "won" || state.status === "won";
    if (
      changed ||
      state.status === "paused" ||
      state.status === "stopped" ||
      state.status === "idle"
    ) {
      this.round = round?.id ?? null;
      this.tween = { from: target, to: target, start: now, duration: 0 };
      this.sewUntil = this.supplyUntil = this.overdriveUntil = 0;
      if (changed) {
        this.initial = BigInt(round?.initial ?? "1") || 1n;
        this.delivered = this.initial > target ? this.initial - target : 0n;
      }
      this.status = state.status;
      this.completed = completed;
      return;
    }
    let from = this.sample(now).count;
    let duration = 0;
    let lastChange: GameAction | undefined;
    for (const action of actions) {
      const delta = BigInt(action.after) - BigInt(action.before);
      if (delta !== 0n) lastChange = action;
      if (action.eventId === "release") {
        this.delivered += BigInt(action.before);
        this.sewUntil = now + 1000;
        this.supplyUntil = this.overdriveUntil = 0;
        duration = 1000;
      } else if (delta > 0n) {
        if (this.completed || BigInt(action.before) === 0n)
          this.sewUntil = this.overdriveUntil = 0;
        this.supplyUntil = now + 1250;
        duration = Math.max(duration, 650);
      } else if (delta < 0n) {
        this.delivered += -delta;
        const run = Math.min(2200, 850 + (-delta).toString().length * 160);
        this.sewUntil = Math.min(
          now + 3600,
          Math.max(now, this.sewUntil) + run,
        );
        duration = Math.max(duration, run);
      } else if (action.eventId === "overdrive")
        this.overdriveUntil = now + 1300;
    }
    if (lastChange && BigInt(lastChange.after) < BigInt(lastChange.before))
      duration = Math.max(duration, this.sewUntil - now);
    if (target !== this.tween.to || lastChange) {
      // A reduction arriving during an unfinished increase starts at its host
      // 'before' value, so the sewing display never counts upward while reducing.
      if (lastChange) {
        const before = BigInt(lastChange.before),
          after = BigInt(lastChange.after);
        if (
          (after < before && from <= target) ||
          (after > before && from >= target)
        )
          from = before;
      }
      // Missing or stale history snaps to authority; opening a window never replays work.
      this.tween = { from, to: target, start: now, duration };
    }
    this.status = state.status;
    this.completed = completed;
  }

  sample(now: number) {
    const tween = this.tween;
    const progress = tween.duration
      ? Math.min(1, Math.max(0, (now - tween.start) / tween.duration))
      : 1;
    const fraction = BigInt(Math.round(progress * 1000));
    const count =
      progress === 1
        ? tween.to
        : tween.from + ((tween.to - tween.from) * fraction) / 1000n;
    const enabled = this.status === "running" || this.status === "won";
    const sewing = enabled && now < this.sewUntil;
    const complete = this.completed && !sewing && progress === 1;
    const work: SewingWork = complete
      ? "finished"
      : sewing
        ? "sewing"
        : enabled && now < this.overdriveUntil
          ? "overdrive"
          : enabled && now < this.supplyUntil
            ? "supply"
            : "idle";
    const finishedLoad = Math.min(
      1,
      Math.log1p(Number(this.delivered)) / Math.log1p(Number(this.initial)),
    );
    return {
      count,
      work,
      complete,
      finishedLoad,
      progress,
      duration: tween.duration,
      target: tween.to,
    };
  }
}
