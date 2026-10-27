import type { SceneLayer, SceneRuntime, SceneSource, DuelState } from '@zhuda/contracts';
import { forecastDuel } from '@zhuda/contracts';
import { elapsedSeconds, initialVariables } from './variables';

const bounded = (n: number) => Math.max(0, Math.min(1_000_000_000, Math.floor(n)));
export function createDuel(source: SceneSource, layer: SceneLayer): DuelState {
  const config = source.battle!;
  const values = initialVariables(source, layer);
  const prep = Number(layer.settings[config.prepParameter ?? ''] ?? config.prepSeconds);
  const retention = Number(layer.settings[config.retentionParameter ?? ''] ?? config.retention);
  return {
    version: 1,
    round: 1,
    phase: 'prepare',
    nextAtMs: Math.max(5, Math.min(120, prep)) * 1000,
    prepMs: Math.max(5, Math.min(120, prep)) * 1000,
    clashMs: config.clashSeconds * 1000,
    retention: Math.max(0, Math.min(1, retention)),
    hero: { hp: values.heroHealth!, maxHp: values.heroHealth! },
    dragon: { hp: values.dragonHealth!, maxHp: values.dragonHealth! },
    winner: null,
    lastClash: null,
    history: [],
  };
}

export function advanceDuel(
  source: SceneSource,
  layer: SceneLayer,
  runtime: SceneRuntime,
  now = Date.now(),
) {
  if (!source.battle || !runtime.battle || runtime.status !== 'running') return false;
  const duel = runtime.battle;
  const elapsed = elapsedSeconds(runtime, now) * 1000;
  let changed = false;
  // Bounded catch-up; logical deadlines advance from previous deadlines, never from frame time.
  for (let step = 0; step < 1000 && duel.phase !== 'finished' && elapsed >= duel.nextAtMs; step++) {
    changed = true;
    if (duel.phase === 'clash') {
      if (duel.winner) {
        duel.phase = 'finished';
        break;
      }
      duel.round++;
      duel.phase = 'prepare';
      duel.nextAtMs += duel.prepMs;
      continue;
    }
    const values = runtime.variables!;
    const preview = forecastDuel(values);
    const { hero, dragon, incoming, dodged, damageToHero } = preview;
    duel.hero.hp = Math.max(0, duel.hero.hp - damageToHero);
    const countered = duel.hero.hp > 0 && preview.countered;
    const damageToDragon = countered ? preview.damageToDragon : 0;
    duel.dragon.hp = Math.max(0, duel.dragon.hp - damageToDragon);
    const clash = {
      round: duel.round,
      atMs: duel.nextAtMs,
      incoming,
      damageToHero,
      damageToDragon,
      blocked: !dodged && damageToHero === 0,
      dodged,
      countered,
      hero,
      dragon,
    };
    duel.lastClash = clash;
    duel.history = [clash, ...duel.history].slice(0, 12);
    duel.winner = duel.hero.hp <= 0 ? 'dragon' : duel.dragon.hp <= 0 ? 'hero' : null;
    duel.phase = 'clash';
    duel.nextAtMs += duel.clashMs;
    // Consume only boosts used by this strike. Gifts received during the clash prepare the next one.
    const bases = initialVariables(source, layer);
    for (const side of ['hero', 'dragon'])
      for (const stat of ['Attack', 'Defense', 'Speed']) {
        const key = `${side}${stat}`;
        values[key] =
          bases[key]! + Math.floor(Math.max(0, values[key]! - bases[key]!) * duel.retention);
      }
  }
  return changed;
}

/** Vitality gifts increase max HP and restore exactly the granted HP, with no resurrection. */
export function syncDuelHealth(runtime: SceneRuntime) {
  const duel = runtime.battle;
  if (!duel || duel.winner) return;
  for (const side of ['hero', 'dragon'] as const) {
    const fighter = duel[side];
    const next = bounded(runtime.variables![`${side}Health`]!);
    fighter.hp = Math.min(next, Math.max(0, fighter.hp + next - fighter.maxHp));
    fighter.maxHp = next;
  }
}
