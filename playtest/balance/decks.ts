// Decks the starters never tried: random legal decks for every Hero Cat and partner family, and starters
// with a handful of cards swapped (closer to what players actually build). Both are checked with the same
// `deckProblems` the deck builder uses, so every generated deck is one a player could make.

import { BEHAVIOURS, CARDS, DECKS, DECK_RULES, NEUTRAL_FAMILY, catCount, copyLimit, deckProblems, deckSize, otherFamilies, type DeckList } from '../lib/engine';
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

/**
 * A deck that breaks only the size rule (an LLM that can't count to 50), brought to exactly 50: extra copies
 * come off the cards it has most of, the most expensive first; missing cards are filled from its own families
 * as randomDeck would. Returns null when something else is wrong too, and how many cards changed.
 */
export function fitToSize(deck: DeckList, rng: Rng): { deck: DeckList; changed: number } | null {
  if (!CARDS[deck.hero]) return null;
  const others = deckProblems({ ...deck, cards: {} }).filter((p) => !/^Add \d+ more/.test(p));
  const sizeOnly = deckProblems(deck).every((p) => /^(Add|Remove) \d+ /.test(p));
  if (others.length || !sizeOnly) return null;
  const out: DeckList = { ...deck, cards: { ...deck.cards } };
  let changed = 0;
  while (deckSize(out) > DECK_RULES.size) {
    const id = Object.keys(out.cards).sort((a, b) => out.cards[b] - out.cards[a] || (CARDS[b].cost ?? 0) - (CARDS[a].cost ?? 0))[0];
    if (--out.cards[id] === 0) delete out.cards[id];
    changed++;
  }
  if (deckSize(out) < DECK_RULES.size) {
    const partner = otherFamilies(out)[0];
    changed += DECK_RULES.size - deckSize(out);
    fill(out, cardPool(out.hero, partner), rng);
  }
  return deckProblems(out).length ? null : { deck: out, changed };
}

export const STARTERS = (): string[] => Object.keys(DECKS);
