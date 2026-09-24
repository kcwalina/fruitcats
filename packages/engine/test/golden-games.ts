// The golden games (scripts/golden.ts records them, golden.test.ts replays them): every pairing of the
// Starter Box decks, both seats, bot against bot, fixed seeds for the deal and for the bots.

import { createHash } from 'node:crypto';
import { apply, chooseAction, createGame, type Action } from '../src/index';

export interface GoldenGame { a: string; b: string; seed: number }

const PAIRS: [string, string][] = [['zest-rush', 'orchard-guard'], ['zest-rush', 'mango-tango'], ['orchard-guard', 'mango-tango']];
export const GOLDEN_GAMES: GoldenGame[] = PAIRS.flatMap(([a, b]) =>
  Array.from({ length: 100 }, (_, i) => (i % 2 ? { a: b, b: a, seed: 5000 + i } : { a, b, seed: 5000 + i })));

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function playGolden(g: GoldenGame): { actions: string; winner: number | string | null; round: number } {
  const s = createGame({ decks: [g.a, g.b], seed: g.seed, names: ['A', 'B'] });
  const rnd = mulberry(g.seed * 7 + 1);
  const hash = createHash('sha256');
  while (s.winner === null) {
    const action: Action = chooseAction(s, { random: rnd });
    hash.update(JSON.stringify(action));
    apply(s, action);
  }
  return { actions: hash.digest('hex').slice(0, 16), winner: s.winner, round: s.round };
}
