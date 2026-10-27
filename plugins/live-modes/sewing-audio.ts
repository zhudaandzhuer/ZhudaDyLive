import type {
  GameAction,
  SceneFrameState,
} from "../../streamingClient/packages/contracts/src/index";
import { sceneAudio } from "../../streamingClient/packages/plugin-sdk/src/audio";
import type { SewingWork } from "./sewing-motion";

export type SewingCue = "supply" | "machine" | "finish";
export interface SewingSoundPlayer {
  play(cue: SewingCue, volume: number, hosted: boolean): void;
  stop(): void;
  dispose(): void;
}

class SewingSoundOutput implements SewingSoundPlayer {
  private voices: HTMLAudioElement[] = [];
  private hosted = false;
  play(cue: SewingCue, volume: number, hosted: boolean) {
    this.hosted = hosted;
    const file = `audio/sewing-${cue}.wav`;
    if (hosted) {
      sceneAudio.play(file, volume);
      return;
    }
    let voice = this.voices.find((audio) => audio.paused || audio.ended);
    if (!voice && this.voices.length >= 2) voice = this.voices.shift();
    if (!voice) {
      voice = document.createElement("audio");
      voice.preload = "auto";
      voice.hidden = true;
      document.body.append(voice);
    }
    if (!this.voices.includes(voice)) this.voices.push(voice);
    voice.pause();
    const url = new URL(file, location.href).href;
    if (voice.src !== url) voice.src = url;
    else voice.currentTime = 0;
    voice.volume = volume;
    voice.dataset.sewingSound = cue;
    voice.dataset.plays = String(Number(voice.dataset.plays ?? 0) + 1);
    void voice.play().catch(() => {
      voice!.dataset.playbackError = "true";
    });
  }
  stop() {
    if (this.hosted) sceneAudio.stop();
    for (const voice of this.voices) {
      voice.pause();
      voice.currentTime = 0;
    }
  }
  dispose() {
    this.stop();
    for (const voice of this.voices) voice.remove();
    this.voices = [];
  }
}

/** Follow visible work, not gift quantity. Reopening or resuming never replays a completion. */
export class SewingAudio {
  private round: string | null | undefined;
  private completed = false;
  private pendingCompletion = false;
  private working = false;
  private sounding = false;
  private hosted = false;
  private machineAt = -Infinity;
  constructor(private output: SewingSoundPlayer = new SewingSoundOutput()) {}

  private stop() {
    if (this.sounding) this.output.stop();
    this.sounding = this.working = false;
    this.machineAt = -Infinity;
  }

  update(
    state: SceneFrameState,
    actions: GameAction[],
    view: { work: SewingWork; complete: boolean },
    now: number,
  ) {
    const round = state.game.round?.id ?? null;
    const sameRound = this.round !== undefined && this.round === round;
    const completed =
      state.game.round?.status === "won" || state.status === "won";
    const hosted = state.audio?.transport === "host";
    const enabled =
      state.audio?.enabled === true && state.settings.soundEnabled !== false;
    const configured = Number(state.settings.soundVolume ?? 60);
    const volume =
      Math.max(
        0,
        Math.min(100, Number.isFinite(configured) ? configured : 60),
      ) / 200;
    const running = state.status === "running" || state.status === "won";
    if (!sameRound || hosted !== this.hosted) {
      this.stop();
      this.pendingCompletion = false;
    }
    this.round = round;
    this.hosted = hosted;
    if (sameRound && !this.completed && completed)
      this.pendingCompletion = true;
    if (this.completed && !completed) this.stop();
    this.completed = completed;
    if (!completed) this.pendingCompletion = false;
    if (!enabled || !volume || !running) {
      this.stop();
      this.pendingCompletion = false;
      return;
    }
    if (!sameRound) return;
    const working = view.work === "sewing" || view.work === "overdrive";
    if (this.working && !working) this.stop();
    const play = (cue: SewingCue) => {
      this.output.play(cue, volume, hosted);
      this.sounding = true;
    };
    if (actions.some((action) => BigInt(action.after) > BigInt(action.before)))
      play("supply");
    if (working && now - this.machineAt >= 500) {
      play("machine");
      this.machineAt = now;
    }
    this.working = working;
    if (view.complete && this.pendingCompletion) {
      this.stop();
      play("finish");
      this.pendingCompletion = false;
    }
  }
  dispose() {
    this.stop();
    this.output.dispose();
  }
}
