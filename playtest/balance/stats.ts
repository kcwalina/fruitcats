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

export interface CardStat {
  id: string;
  games: number;
  winRate: number;
  /** Wins in games the card was played in, less its deck's rate in the games that reached the round it came down. */
  delta: number;
  /** Less its deck's rate over all games: the old number, which rewards late cards. */
  raw: number;
}

/**
 * A screen for the cards worth a removal test (removal.ts), not a verdict. A deck's win rate in games where it
 * played a card, against its usual rate, rewards late cards: an 8-cost card comes down only in long games the
 * player was already surviving (Elder of the South Sea: +23 points that way, yet its deck wins 5.9 points more
 * with it than without). So each game is compared with the deck's rate in the games that were still going in
 * the round the card first came down. Some bias is left (affording an 8-cost card in round 6 says the game is
 * going well), which is why only the removal test warns about a starter's card.
 */
export function cardImpact(records: GameRecord[]): CardStat[] {
  const { rate: wr } = matchups(records);
  // By deck: wins and games among the games that lasted at least r rounds, for every r.
  const ended: Record<string, Tally[]> = {};
  for (const r of records) {
    for (const p of [0, 1] as PlayerId[]) {
      const t = ((ended[r.seats[p]] ??= [])[r.rounds] ??= { wins: 0, games: 0 });
      t.wins += r.winner === 'draw' ? 0.5 : r.winner === p ? 1 : 0; t.games++;
    }
  }
  const reached: Record<string, Tally[]> = {};
  for (const [k, byRound] of Object.entries(ended)) {
    const out: Tally[] = [];
    let acc: Tally = { wins: 0, games: 0 };
    for (let round = byRound.length - 1; round >= 0; round--) {
      acc = { wins: acc.wins + (byRound[round]?.wins ?? 0), games: acc.games + (byRound[round]?.games ?? 0) };
      out[round] = acc;
    }
    reached[k] = out;
  }
  const acc: Record<string, { games: number; wins: number; delta: number; raw: number }> = {};
  for (const r of records) {
    for (const p of [0, 1] as PlayerId[]) {
      const won = r.winner === 'draw' ? 0.5 : r.winner === p ? 1 : 0;
      const k = r.seats[p];
      for (const [id, round] of Object.entries(r.played[p])) {
        const a = (acc[id] ??= { games: 0, wins: 0, delta: 0, raw: 0 });
        a.games++; a.wins += won; a.delta += won - rate(reached[k][round]); a.raw += won - wr(k);
      }
    }
  }
  return Object.entries(acc)
    .map(([id, a]) => ({ id, games: a.games, winRate: a.wins / a.games, delta: a.delta / a.games, raw: a.raw / a.games }))
    .sort((x, y) => y.delta - x.delta);
}
