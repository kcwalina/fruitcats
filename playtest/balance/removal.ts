// Removal tests: how much a starter deck's win rate drops when one card is taken out of it, each copy
// replaced by a plain 1-cost unit. That is the number that says a card is too strong; the per-card
// screen (stats.ts cardImpact) only picks which cards to test.
//
// The change is made in the deck list, never to the card, so nothing about any card changes in any worker
// (the engine caches keywords by card id, and PLAYTEST_CARD_MODS must be set before any game runs).

import { CARDS, DECKS, type DeckList } from '../lib/engine';
import type { Contestant, GameRecord, MatchJob } from './match';

/**
 * The plain unit a removed card's copies become: a 1-cost Creature with no keywords and no abilities, the weakest
 * of the Hero's family, or of any family when the Hero's has none (Folkborn 0.6 gave every Hui Hai something to do).
 */
export function vanillaFor(deck: DeckList): string | undefined {
  const family = CARDS[deck.hero].family;
  const plain = Object.values(CARDS)
    .filter((c) => c.type === 'Critter' && c.set && !c.token && !c.preview && c.cost === 1 && !c.keywords?.length && !c.abilities?.length)
    .sort((a, b) => (a.power ?? 0) + (a.health ?? 0) - (b.power ?? 0) - (b.health ?? 0) || a.id.localeCompare(b.id));
  return (plain.find((c) => c.family === family) ?? plain[0])?.id;
}

/** The deck with every copy of `id` swapped for its vanilla card, or undefined if it has no vanilla card. */
export function withoutCard(deck: DeckList, id: string): DeckList | undefined {
  const vanilla = vanillaFor(deck);
  const copies = deck.cards[id] ?? 0;
  if (!vanilla || vanilla === id || !copies) return undefined;
  const cards = { ...deck.cards };
  delete cards[id];
  cards[vanilla] = (cards[vanilla] ?? 0) + copies;
  return { ...deck, name: `${deck.name} without ${CARDS[id].name}`, cards };
}

export interface RemovalTest {
  card: string;
  deck: string;
  /** The changed deck's key in its records. */
  key: string;
  jobs: MatchJob[];
  base: MatchJob[];
}

/**
 * The starter deck holding `card` without it, against every other starter. Each job reuses the seeds and seats
 * of `baseJobs` (the starters' own games), so the two differ only by the card and some of the luck cancels.
 */
export function removalTest(card: string, baseJobs: MatchJob[], games: number): RemovalTest | undefined {
  const deck = Object.keys(DECKS).find((k) => DECKS[k].cards[card]);
  const changed = deck && withoutCard(DECKS[deck], card);
  if (!deck || !changed) return undefined;
  const mine: Contestant = { key: `${deck} without ${card}`, deck: changed };
  const base = baseJobs.filter((j) => j.a.key === deck || j.b.key === deck);
  const jobs = base.map((j) => ({
    a: j.a.key === deck ? mine : j.a,
    b: j.b.key === deck ? mine : j.b,
    seed: j.seed, from: j.from, to: Math.min(j.to, j.from + games),
  }));
  return { card, deck, key: mine.key, jobs, base };
}

export interface RemovalResult {
  card: string;
  deck: string;
  games: number;
  /** The deck's win rate over these games with the card, and without it. */
  withCard: number;
  without: number;
  /** withCard − without: what the card is worth to its deck. */
  worth: number;
  /** Standard error of `worth`, from the game-by-game differences. */
  error: number;
}

const score = (r: GameRecord, key: string) => {
  const seat = r.seats.indexOf(key);
  return r.winner === 'draw' ? 0.5 : r.winner === seat ? 1 : 0;
};

/** Pairs each game without the card with the same game (same seed) with it. */
export function removalResult(t: RemovalTest, baseRecords: GameRecord[][], records: GameRecord[][]): RemovalResult {
  const diffs: number[] = [];
  let withCard = 0, without = 0;
  records.forEach((games, j) => games.forEach((r, g) => {
    const w = score(baseRecords[j][g], t.deck), wo = score(r, t.key);
    withCard += w; without += wo; diffs.push(w - wo);
  }));
  const n = diffs.length;
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const variance = diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / Math.max(1, n - 1);
  return { card: t.card, deck: t.deck, games: n, withCard: withCard / n, without: without / n, worth: mean, error: Math.sqrt(variance / n) };
}
