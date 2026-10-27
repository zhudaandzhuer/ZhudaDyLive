import type { SceneLayerView } from '@zhuda/contracts';

export interface CompletionPresentation {
  id: string;
  at: number;
  deadline: number;
  text: string;
  color: string;
  fireworks: boolean;
}

/** One authoritative completion event, one bounded effect, independent of scene redraws. */
export class CompletionPlayback {
  private id: string | undefined;
  private deadline = 0;
  private dismissed = false;

  sample(view: SceneLayerView, now: number): CompletionPresentation | null {
    const { runtime, layer, source } = view;
    const at = runtime.completedAt;
    if (!source?.completion || at === undefined || !Number.isFinite(at)) {
      this.dismissed = true;
      return null;
    }
    const id = runtime.completionId ?? `${runtime.game.round?.id}:${at}`;
    const duration =
      runtime.completionDurationMs ??
      Math.min(5, Math.max(3, Number(layer.settings.completionDuration ?? 4))) * 1000;
    if (id !== this.id) {
      this.id = id;
      this.deadline = at + duration;
      this.dismissed = false;
    }
    // Once ended or interrupted, editing settings cannot resurrect this event.
    if (now >= this.deadline) this.dismissed = true;
    if (
      !view.available ||
      runtime.status !== 'running' ||
      runtime.game.round?.status !== 'won' ||
      layer.settings.completionEnabled === false
    )
      this.dismissed = true;
    this.deadline = at + duration;
    if (this.dismissed || now < at || now >= this.deadline) {
      this.dismissed = true;
      return null;
    }
    return {
      id,
      at,
      deadline: this.deadline,
      text: String(layer.settings.completionText ?? source.completion.text),
      color: String(layer.settings.completionColor ?? source.completion.color),
      fireworks: layer.settings.completionFireworks !== false,
    };
  }
}
