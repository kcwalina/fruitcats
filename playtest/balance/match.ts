// One bot-vs-bot game, and what a balance report needs to know about it.

import { apply, chooseAction, createGame, type DeckList, type PlayerId } from '../lib/engine';
import { mulberry } from '../lib/rng';

/** A deck in a matchup: `key` names it in reports (a starter's key, or a generated deck's name). */
export interface Contestant {
  key: string;
  deck: DeckList;
  /** Bot strength, 0 (random) to 1 (full). */
  skill?: number;
}

export interface GameRecord {
  /** Contestant keys by seat. */
  seats: [string, string];
  winner: PlayerId | 'draw';
  /** Who held the Yarn Ball in round 1. */
  starting: PlayerId;
  rounds: number;
  actions: number;
  /** Round each seat's Hero Cat Grew Up in, or 0 if it never did. */
  grewUp: [number, number];
  /** Card ids each seat played (from hand, as a Pounce, or as a Lucky Life), once per game. */
  played: [string[], string[]];
  /** Cards left in each hand at the end: a hand that piles up means a deck starved for Treats. */
  handEnd: [number, number];
}

/** A matchup's games are numbered from `seed`; seats alternate so both decks play both sides of the Yarn. */
export interface MatchJob {
  a: Contestant;
  b: Contestant;
  seed: number;
  /** Game numbers to play, `from` inclusive, `to` exclusive. */
  from: number;
  to: number;
}

export function playGame(a: Contestant, b: Contestant, seed: number): GameRecord {
  const seats: [Contestant, Contestant] = seed % 2 ? [b, a] : [a, b];
  const s = createGame({ decks: [seats[0].deck, seats[1].deck], seed, names: [seats[0].key, seats[1].key] });
  const rnd = mulberry(seed ^ 0x9e3779b9);
  const played: [Set<string>, Set<string>] = [new Set(), new Set()];
  const grewUp: [number, number] = [0, 0];
  while (s.winner === null) {
    const prompt = s.prompt!;
    const p = prompt.player;
    const action = chooseAction(s, { skill: seats[p].skill ?? 1, random: rnd });
    const uid = action.t === 'play' || action.t === 'pounce' ? action.uid : action.t === 'lucky' && prompt.kind === 'lucky' ? prompt.uid : null;
    const card = uid === null ? undefined : s.players[p].hand.find((c) => c.uid === uid);
    if (card) played[p].add(card.id);
    apply(s, action);
    for (const q of [0, 1] as PlayerId[]) if (!grewUp[q] && s.players[q].hero.grown) grewUp[q] = s.round;
  }
  return {
    seats: [seats[0].key, seats[1].key],
    winner: s.winner,
    starting: s.startingYarn,
    rounds: s.round,
    actions: s.actions,
    grewUp,
    played: [[...played[0]], [...played[1]]],
    handEnd: [s.players[0].hand.length, s.players[1].hand.length],
  };
}

export function playJob(job: MatchJob): GameRecord[] {
  const records: GameRecord[] = [];
  for (let g = job.from; g < job.to; g++) records.push(playGame(job.a, job.b, job.seed + g));
  return records;
}
