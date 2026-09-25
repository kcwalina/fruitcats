// Decks the starters never tried: random legal decks for every Hero Cat and partner family, and starters
// with a handful of cards swapped (closer to what players actually build). Both are checked with the same
// `deckProblems` the deck builder uses, so every generated deck is one a player could make.

import { BEHAVIOURS, CARDS, DECKS, DECK_RULES, NEUTRAL_FAMILY, catCount, copyLimit, deckProblems, deckSize, isNeutralFamily, type DeckList } from '../lib/engine';
import { pick, pickWeighted, type Rng } from '../lib/rng';

/** Hero Cats that can be played: their Exhaust abilities and Grow Up are implemented (not previews). */
export function playableHeroes(): string[] {
  return Object.values(CARDS)
    .filter((c) => c.type === 'Hero Cat' && !c.preview && BEHAVIOURS[c.id]?.growUp)
    .map((c) => c.id);
}

/** Families that have cards to build with, besides Garden. */
export function families(): string[] {
  const set = new Set<string>();
  for (const c of Object.values(CARDS)) if (c.type !== 'Hero Cat' && !c.preview && c.family !== NEUTRAL_FAMILY) set.add(c.family);
  return [...set].sort();
}

/** The cards a deck led by `hero` may use, with `partner` as its one other family. */
export function cardPool(hero: string, partner?: string): string[] {
  const allowed = new Set([CARDS[hero].family, NEUTRAL_FAMILY, ...(partner ? [partner] : [])]);
  return Object.values(CARDS)
    .filter((c) => c.type !== 'Hero Cat' && !c.preview && allowed.has(c.family))
    .map((c) => c.id);
}

// A playable curve: cheap cards common, expensive ones rarer; units a little more likely than Tricks and Toys.
const COST_WEIGHT = [1, 1.2, 1.3, 1.2, 0.9, 0.6, 0.45, 0.3, 0.25];
function weight(id: string): number {
  const c = CARDS[id];
  const w = COST_WEIGHT[Math.min(c.cost ?? 0, COST_WEIGHT.length - 1)];
  return c.type === 'Critter' || c.type === 'Cat' ? w : w * 0.6;
}

function canAdd(deck: DeckList, id: string): boolean {
  if ((deck.cards[id] ?? 0) >= copyLimit(id)) return false;
  if (CARDS[id].type === 'Cat' && catCount(deck) >= DECK_RULES.maxCats) return false;
  return deckSize(deck) < DECK_RULES.size;
}

function fill(deck: DeckList, pool: string[], rng: Rng): DeckList {
  while (deckSize(deck) < DECK_RULES.size) {
    const options = pool.filter((id) => canAdd(deck, id));
    if (!options.length) throw new Error(`Not enough cards to fill ${deck.name}`);
    const id = options[pickWeighted(rng, options.map(weight))];
    deck.cards[id] = (deck.cards[id] ?? 0) + 1;
  }
  const problems = deckProblems(deck);
  if (problems.length) throw new Error(`${deck.name} is not legal: ${problems.join(' ')}`);
  return deck;
}

export function randomDeck(rng: Rng, hero: string, partner: string | undefined, name: string): DeckList {
  return fill({ name, hero, cards: {} }, cardPool(hero, partner), rng);
}

/** A starter with `swaps` cards taken out and as many put back from the families it already uses. */
export function mutateDeck(rng: Rng, base: DeckList, swaps: number, name: string): DeckList {
  const deck: DeckList = { name, hero: base.hero, cards: { ...base.cards } };
  for (let i = 0; i < swaps; i++) {
    const owned = Object.keys(deck.cards).filter((id) => deck.cards[id] > 0);
    const out = pick(rng, owned);
    if (--deck.cards[out] === 0) delete deck.cards[out];
  }
  const families = new Set(Object.keys(base.cards).map((id) => CARDS[id].family));
  const partner = [...families].find((f) => f !== CARDS[base.hero].family && f !== NEUTRAL_FAMILY);
  return fill(deck, cardPool(base.hero, partner), rng);
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

/** A card or Hero Cat by id or name, forgiving about case, accents, punctuation and a title after a comma. */
export function findCard(text: string, heroes = false): string | undefined {
  if (CARDS[text] && (CARDS[text].type === 'Hero Cat') === heroes && !CARDS[text].preview) return text;
  const want = norm(text);
  if (!want) return undefined;
  const candidates = Object.values(CARDS).filter((c) => (c.type === 'Hero Cat') === heroes && !c.preview && (!heroes || BEHAVIOURS[c.id]?.growUp));
  return (candidates.find((c) => norm(c.name) === want) ?? candidates.find((c) => norm(c.name.split(',')[0]) === want)
    ?? candidates.find((c) => norm(c.id) === want))?.id;
}

export interface Assembled {
  deck: DeckList;
  /** How many of the 50 cards are the ones the LLM asked for. */
  chosen: number;
  /** What was changed to make it legal, for the report. */
  notes: string[];
}

/**
 * A legal deck from an LLM's wish list: a Hero Cat and cards (ids or names) with copies. Small models are
 * good at the idea and poor at the bookkeeping, so the rules are applied here: unknown cards are dropped,
 * the partner family is the other family it asked for most (cards of any third family are dropped), copies
 * and Cats are capped, and the deck is trimmed (extra copies of what it has most of, the most expensive
 * first) or filled from its families to exactly 50. Null when there's no Hero Cat to lead it.
 */
export function assembleDeck(name: string, hero: string, wish: Record<string, number>, rng: Rng): Assembled | null {
  const heroId = findCard(hero, true);
  if (!heroId) return null;
  const heroFamily = CARDS[heroId].family;
  const notes: string[] = [];
  const cards: Record<string, number> = {};
  const unknown: string[] = [];
  for (const [text, qty] of Object.entries(wish)) {
    const id = findCard(text);
    const n = Math.floor(Number(qty));
    if (!id) { unknown.push(text); continue; }
    if (n > 0) cards[id] = (cards[id] ?? 0) + n;
  }
  if (unknown.length) notes.push(`${unknown.length} unknown card${unknown.length === 1 ? '' : 's'} left out (${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? ', …' : ''})`);
  // The partner: the other fruit family it asked for most copies of.
  const byFamily = new Map<string, number>();
  for (const [id, q] of Object.entries(cards)) {
    const f = CARDS[id].family;
    if (f !== heroFamily && f !== NEUTRAL_FAMILY && !isNeutralFamily(f)) byFamily.set(f, (byFamily.get(f) ?? 0) + q);
  }
  const partner = [...byFamily.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const dropped = [...byFamily.keys()].filter((f) => f !== partner);
  if (dropped.length) notes.push(`${dropped.join(', ')} left out: a deck has one family besides its Hero Cat's`);
  const allowed = new Set(cardPool(heroId, partner));
  let capped = 0;
  for (const id of Object.keys(cards)) {
    if (!allowed.has(id)) { delete cards[id]; continue; }
    if (cards[id] > copyLimit(id)) { capped += cards[id] - copyLimit(id); cards[id] = copyLimit(id); }
  }
  const cats = Object.keys(cards).filter((id) => CARDS[id].type === 'Cat');
  for (const id of cats.slice(DECK_RULES.maxCats)) { delete cards[id]; capped++; }
  if (capped) notes.push(`${capped} cop${capped === 1 ? 'y' : 'ies'} over the limits taken out`);
  const deck: DeckList = { name, hero: heroId, cards };
  let trimmed = 0;
  while (deckSize(deck) > DECK_RULES.size) {
    const id = Object.keys(deck.cards).sort((a, b) => deck.cards[b] - deck.cards[a] || (CARDS[b].cost ?? 0) - (CARDS[a].cost ?? 0))[0];
    if (--deck.cards[id] === 0) delete deck.cards[id];
    trimmed++;
  }
  if (trimmed) notes.push(`${trimmed} card${trimmed === 1 ? '' : 's'} trimmed to make 50`);
  const chosen = deckSize(deck);
  if (chosen < DECK_RULES.size) {
    notes.push(`${DECK_RULES.size - chosen} card${DECK_RULES.size - chosen === 1 ? '' : 's'} added to make 50`);
    fill(deck, cardPool(heroId, partner), rng);
  }
  return deckProblems(deck).length ? null : { deck, chosen, notes };
}

export const STARTERS = (): string[] => Object.keys(DECKS);
