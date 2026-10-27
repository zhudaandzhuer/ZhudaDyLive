import type { GameAction, GameState } from '@zhuda/contracts';

/** Snapshots may overlap or arrive in bursts. Never replay history on window open. */
export class ActionCursor {
  private round: string | null = null;
  private seen = new Set<string>();
  consume(state: GameState, now = Date.now()): GameAction[] {
    const history = [...state.recent].reverse();
    if (state.lastAction && !history.some((a) => a.id === state.lastAction!.id))
      history.push(state.lastAction);
    const changed = this.round !== (state.round?.id ?? null);
    const fresh = changed
      ? []
      : history.filter(
          (a) =>
            a.roundId === this.round &&
            !this.seen.has(a.id) &&
            now - Date.parse(a.at) >= -1000 &&
            now - Date.parse(a.at) < 6000 &&
            (BigInt(a.delta) !== 0n || !!a.eventId),
        );
    this.round = state.round?.id ?? null;
    if (changed || this.seen.size > 300) this.seen.clear();
    history.forEach((a) => this.seen.add(a.id));
    return fresh;
  }
}
