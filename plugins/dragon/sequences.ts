import type { SceneFrameState } from "../../streamingClient/packages/contracts/src/index";

export const clips = {
  idle: { file: "idle.mp4", duration: 10 },
  hit: { file: "hit.mp4", duration: 8 },
  "hit-counter": { file: "hit-counter.mp4", duration: 8 },
  "block-counter": { file: "block-counter.mp4", duration: 8 },
  "dodge-counter": { file: "dodge-counter.mp4", duration: 8 },
  "hero-win": { file: "hero-win.mp4", duration: 8 },
  "dragon-win": { file: "dragon-win.mp4", duration: 8 },
} as const;
export type ClipId = keyof typeof clips;
export interface Sequence {
  clip: ClipId;
  key: string;
  time: number;
  rate: number;
  loop: boolean;
  playing: boolean;
}

/** Logical time owns the film, so preview, output, pause and late joining use the same frame. */
export function sequenceAt(s: SceneFrameState, logicalMs: number): Sequence {
  const b = s.battle;
  const gameId = s.game.round?.id ?? "idle";
  if (!b || b.phase === "prepare") {
    const seconds = (b?.prepMs ?? 20000) / 1000;
    // Fit complete breathing cycles into any configured preparation interval.
    const cycles = Math.ceil(seconds / clips.idle.duration);
    const period = seconds / cycles;
    const elapsed = Math.max(
      0,
      (logicalMs - ((b?.nextAtMs ?? seconds * 1000) - seconds * 1000)) / 1000,
    );
    const done = elapsed >= seconds;
    const rate = clips.idle.duration / period;
    return {
      clip: "idle",
      key: `${gameId}:prepare:${b?.round ?? 0}`,
      time: done ? clips.idle.duration - 1 / 24 : (elapsed % period) * rate,
      rate,
      loop: !done && Math.floor(elapsed / period) < cycles - 1,
      playing:
        !!b && s.status === "running" && !done && s.settings.motion !== false,
    };
  }
  const c = b.lastClash;
  const clip: ClipId =
    b.winner === "hero"
      ? "hero-win"
      : b.winner === "dragon"
        ? "dragon-win"
        : c?.dodged
          ? "dodge-counter"
          : c?.blocked
            ? "block-counter"
            : c?.countered
              ? "hit-counter"
              : "hit";
  const duration = clips[clip].duration;
  const age = Math.max(0, (logicalMs - (c?.atMs ?? logicalMs)) / 1000);
  const rate = duration / (b.clashMs / 1000);
  return {
    clip,
    key: `${gameId}:clash:${c?.round ?? b.round}:${clip}`,
    time: Math.min(duration - 1 / 24, age * rate),
    rate,
    loop: false,
    playing: s.status === "running" && age < b.clashMs / 1000,
  };
}
