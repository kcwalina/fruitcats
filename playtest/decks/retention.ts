// Which custom decks the library keeps. A deck is played for its results, so it is judged on them, not on its
// age alone: every night each deck plays the starters in bot games (with that night's cards), and
//
//   - a new deck has a grace period (graceDays) to show what it does;
//   - after that, a deck averaging below dropBelow against the starters goes, however full the library is:
//     a deck that keeps losing isn't one players will build;
//   - a deck averaging keepAbove or more is a keeper: it stays indefinitely, as the decks balance has to answer;
//   - above the cap, the deck with the lowest score goes first: its average win rate, less agePenaltyPerMonth
//     for every month it has been in the library, so of two middling decks the older one makes room. Keepers
//     go only when keepers alone fill the cap. Pinned decks (a deck someone brought in by hand) never go.
//
// LLM playtest results are recorded but don't decide: PC2024's LLM player wins about one game in five with any
// deck, so they say more about the player than the deck.

import config from '../playtest.config.json';
import { CARDS, DECKS, resolveDeck, type DeckList } from '../lib/engine';
import { scoreDecks } from '../llm/builder';
import type { LibraryDeck, LibraryFile } from './library';

export interface RetentionConfig {
  cap: number;
  graceDays: number;
  dropBelow: number;
  keepAbove: number;
  agePenaltyPerMonth: number;
  /** Bot games against each starter, per deck, per night. */
  gamesPerStarter: number;
}

export const retentionConfig = (): RetentionConfig => (config as unknown as { library: RetentionConfig }).library;

const DAY = 86400e3;
const ageDays = (d: LibraryDeck, now: number) => (now - Date.parse(d.addedAt)) / DAY;

/** A deck's win rate for judging: the mean of its last (up to) five nightly measurements, else its rate when added. */
export function averageRate(d: LibraryDeck): number | undefined {
  const recent = (d.stats?.bot ?? []).slice(-5);
  if (recent.length) return recent.reduce((t, b) => t + b.rate, 0) / recent.length;
  return d.vsStarters;
}

export interface Verdict { key: string; name: string; rate?: number; ageDays: number; score: number; keep: boolean; why: string }

export function retention(file: LibraryFile, now = Date.now(), cfg = retentionConfig()): Verdict[] {
  const all = Object.entries(file.decks).map(([key, d]): Verdict => {
    const rate = averageRate(d);
    const age = ageDays(d, now);
    const score = (rate ?? 0.5) - cfg.agePenaltyPerMonth * (age / 30);
    return { key, name: d.name, rate, ageDays: age, score, keep: true, why: '' };
  });
  const pct = (r?: number) => (r === undefined ? 'no results yet' : `${Math.round(r * 100)}%`);
  for (const v of all) {
    const d = file.decks[v.key];
    if (d.pinned) v.why = 'pinned';
    else if (v.ageDays < cfg.graceDays) v.why = `new (${Math.floor(v.ageDays)} of ${cfg.graceDays} grace days)`;
    else if (v.rate !== undefined && v.rate < cfg.dropBelow) { v.keep = false; v.why = `loses: ${pct(v.rate)} against the starters, below ${pct(cfg.dropBelow)}`; }
    else if (v.rate !== undefined && v.rate >= cfg.keepAbove) v.why = `keeper: ${pct(v.rate)} against the starters`;
    else v.why = `${pct(v.rate)} against the starters`;
  }
  // Over the cap: the lowest scores go, keepers and new decks last, pinned decks never.
  const rank = (v: Verdict) => (file.decks[v.key].pinned ? 3 : v.why.startsWith('keeper') ? 2 : v.why.startsWith('new') ? 1 : 0);
  const kept = all.filter((v) => v.keep);
  const over = kept.length - cfg.cap;
  if (over > 0) {
    const order = kept.filter((v) => rank(v) < 3).sort((a, b) => rank(a) - rank(b) || a.score - b.score);
    for (const v of order.slice(0, over)) {
      v.keep = false;
      v.why = `the library is over its ${cfg.cap} decks and this one scores lowest (${pct(v.rate)}, ${Math.round(v.ageDays)} days old)`;
    }
  }
  return all.sort((a, b) => Number(a.keep) - Number(b.keep) || b.score - a.score);
}

/** Tonight's bot games: every library deck against every starter, recorded in its stats (the latest 10 kept). */
export async function measureLibrary(file: LibraryFile, date: string, cfg = retentionConfig()): Promise<{ key: string; rate: number }[]> {
  const entries = Object.entries(file.decks).filter(([, d]) => Object.keys(d.cards).every((id) => CARDS[id]) && CARDS[d.hero]);
  if (!entries.length) return [];
  const starters: DeckList[] = Object.keys(DECKS).map((k) => resolveDeck(k));
  const scores = await scoreDecks(entries.map(([, d]) => ({ name: d.name, idea: '', deck: { name: d.name, hero: d.hero, cards: d.cards } })), starters, cfg.gamesPerStarter, `library:${date}`);
  return entries.map(([key, d], i) => {
    const bot = [...(d.stats?.bot ?? []).filter((b) => b.date !== date), { date, rate: scores[i].winRate }].slice(-10);
    d.stats = { ...(d.stats ?? {}), bot };
    return { key, rate: scores[i].winRate };
  });
}

/** Adds LLM playtest results (byDeck from llm-playtest runs) to the library decks they name. Returns how many games. */
export function recordLlmGames(file: LibraryFile, byDeck: { deck: string; games: number; won: number }[]): number {
  let n = 0;
  for (const b of byDeck) {
    const d = Object.values(file.decks).find((x) => x.name === b.deck);
    if (!d) continue;
    const llm = d.stats?.llm ?? { games: 0, won: 0 };
    d.stats = { bot: d.stats?.bot ?? [], llm: { games: llm.games + b.games, won: llm.won + b.won } };
    n += b.games;
  }
  return n;
}
