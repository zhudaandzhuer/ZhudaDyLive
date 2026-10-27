import { z } from 'zod';

/** Versioned host capability: renderers consume state and never run combat. */
export const duelConfigSchema = z
  .object({
    version: z.literal(1),
    prepSeconds: z.number().int().min(5).max(120),
    clashSeconds: z.number().int().min(2).max(10),
    retention: z.number().min(0).max(1),
    prepParameter: z.string().optional(),
    retentionParameter: z.string().optional(),
  })
  .strict();
export type DuelConfig = z.infer<typeof duelConfigSchema>;
export type DuelSide = 'hero' | 'dragon';
export interface DuelFighter {
  hp: number;
  maxHp: number;
}
export interface DuelClash {
  round: number;
  atMs: number;
  incoming: number;
  damageToHero: number;
  damageToDragon: number;
  blocked: boolean;
  dodged: boolean;
  countered: boolean;
  hero: { attack: number; defense: number; speed: number };
  dragon: { attack: number; defense: number; speed: number };
}
export interface DuelState {
  version: 1;
  round: number;
  phase: 'prepare' | 'clash' | 'finished';
  nextAtMs: number;
  prepMs: number;
  clashMs: number;
  retention: number;
  hero: DuelFighter;
  dragon: DuelFighter;
  winner: DuelSide | null;
  lastClash: DuelClash | null;
  history: DuelClash[];
}
export const duelStats = ['Health', 'Attack', 'Defense', 'Speed'] as const;

/** Pure preview used by the host resolver and the read-only renderer. */
export function forecastDuel(values: Record<string, number>) {
  const stats = (side: DuelSide) => ({
    attack: values[`${side}Attack`] ?? 0,
    defense: values[`${side}Defense`] ?? 0,
    speed: values[`${side}Speed`] ?? 0,
  });
  const hero = stats('hero'),
    dragon = stats('dragon');
  const power = (attack: number, fast: number, slow: number) =>
    Math.min(
      1_000_000_000,
      Math.floor(attack * (1 + Math.min(1, Math.max(0, fast - slow) / Math.max(1, slow)))),
    );
  const incoming = power(dragon.attack, dragon.speed, hero.speed);
  const dodged = hero.speed > dragon.speed && hero.speed >= dragon.speed * 1.5;
  const damageToHero = dodged ? 0 : Math.max(0, incoming - hero.defense);
  const countered = hero.defense >= incoming || hero.speed >= dragon.speed;
  const damageToDragon = countered
    ? Math.max(0, power(hero.attack, hero.speed, dragon.speed) - dragon.defense)
    : 0;
  return {
    hero,
    dragon,
    incoming,
    dodged,
    blocked: !dodged && damageToHero === 0,
    countered,
    damageToHero,
    damageToDragon,
  };
}
