import { describe, expect, it } from 'vitest';
import golden from './golden.json';
import { playGolden, type GoldenGame } from './golden-games';

// Recorded with scripts/golden.ts. If a change is meant to alter how cards play, re-record and say why.
describe('golden games play exactly as recorded', () => {
  for (const g of golden as (GoldenGame & { actions: string; winner: number | string | null; round: number })[]) {
    it(`${g.a} vs ${g.b}, seed ${g.seed}`, () => {
      const r = playGolden(g);
      expect({ actions: r.actions, winner: r.winner, round: r.round }).toEqual({ actions: g.actions, winner: g.winner, round: g.round });
    });
  }
});
