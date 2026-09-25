// Turns game records into the numbers a balance report shows.

import type { PlayerId } from '../lib/engine';
import type { GameRecord } from './match';

export interface Tally { wins: number; games: number }
const rate = (t: Tally | undefined) => (t && t.games ? t.wins / t.games : 0);

/** Win rate of every contestant against every other, and overall, draws counted as half. */
export function matchups(records: GameRecord[]) {
  const pair: Record<string, Record<string, Tally>> = {};
  const overall: Record<string, Tally> = {};
  for (const r of records) {
    for (const p of [0, 1] as PlayerId[]) {
      const me = r.seats[p], them = r.seats[1 - p];
      const w = r.winner === 'draw' ? 0.5 : r.winner === p ? 1 : 0;
      const t = ((pair[me] ??= {})[them] ??= { wins: 0, games: 0 });
      t.wins += w; t.games++;
      const o = (overall[me] ??= { wins: 0, games: 0 });
      o.wins += w; o.games++;
    }
  }
  return {
    pair,
    overall,
    rate: (a: string, b?: string) => rate(b === undefined ? overall[a] : pair[a]?.[b]),
  };
}

/** Everything about how games go, beyond who wins. */
export function gameShape(records: GameRecord[]) {
  let starterWins = 0, decided = 0, rounds = 0, actions = 0;
  const grew: Record<string, Tally> = {}, grewRound: Record<string, Tally> = {}, handEnd: Record<string, Tally> = {};
  for (const r of records) {
    rounds += r.rounds;
    actions += r.actions;
    if (r.winner !== 'draw') { decided++; if (r.winner === r.starting) starterWins++; }
    for (const p of [0, 1] as PlayerId[]) {
      const k = r.seats[p];
      const g = (grew[k] ??= { wins: 0, games: 0 });
      g.games++;
      if (r.grewUp[p]) { g.wins++; const gr = (grewRound[k] ??= { wins: 0, games: 0 }); gr.wins += r.grewUp[p]; gr.games++; }
      const h = (handEnd[k] ??= { wins: 0, games: 0 });
      h.wins += r.handEnd[p]; h.games++;
    }
  }
  const map = (m: Record<string, Tally>) => Object.fromEntries(Object.entries(m).map(([k, t]) => [k, rate(t)]));
  return {
    games: records.length,
    firstPlayer: decided ? starterWins / decided : 0.5,
    avgRounds: records.length ? rounds / records.length : 0,
    avgActions: records.length ? actions / records.length : 0,
    grewUp: map(grew),
    grewUpRound: map(grewRound),
    handEnd: map(handEnd),
  };
}

export interface CardStat { id: string; games: number; winRate: number; delta: number }

/**
 * How much more often a deck wins in games where it played a card than it wins overall. A card far above
 * its deck's own win rate is doing too much (Jackfruit Elephant: +20 points before its nerf). This is a
 * pointer, not a verdict: cards that come down late show up in games that were going well anyway.
 */
export function cardImpact(records: GameRecord[]): CardStat[] {
  const { rate: wr } = matchups(records);
  const acc: Record<string, { games: number; wins: number; delta: number }> = {};
  for (const r of records) {
    for (const p of [0, 1] as PlayerId[]) {
      const won = r.winner === 'draw' ? 0.5 : r.winner === p ? 1 : 0;
      const base = wr(r.seats[p]);
      for (const id of r.played[p]) {
        const a = (acc[id] ??= { games: 0, wins: 0, delta: 0 });
        a.games++; a.wins += won; a.delta += won - base;
      }
    }
  }
  return Object.entries(acc)
    .map(([id, a]) => ({ id, games: a.games, winRate: a.wins / a.games, delta: a.delta / a.games }))
    .sort((x, y) => y.delta - x.delta);
}
