// Deckbuilding rules (rulebook §11.1): which decks are legal, and why a card can't be added to one.
// Messages are written for players, since the deck builder shows them as they are.

import { CARDS, isNeutralFamily, type DeckList } from './cards';
import { DECK_SIZE, cardName } from './engine';

export const DECK_RULES = {
  size: DECK_SIZE,
  /** Copies of any one card, except Cats. */
  copies: 3,
  /** Copies of each Cat: they are one of a kind. */
  catCopies: 1,
  maxCats: 6,
} as const;

/**
 * Kept for older callers: the Starter Box's neutral family. Deck rules ask the catalog instead
 * (isNeutralFamily), where a set marks its neutral families.
 */
export const NEUTRAL_FAMILY = 'Garden';

/** How many copies of this card a deck may hold, by the rules (ownership aside). */
export function copyLimit(id: string): number {
  return CARDS[id]?.type === 'Cat' ? DECK_RULES.catCopies : DECK_RULES.copies;
}

export function deckSize(deck: DeckList): number {
  return Object.values(deck.cards).reduce((n, qty) => n + qty, 0);
}

export function catCount(deck: DeckList): number {
  return Object.entries(deck.cards).reduce((n, [id, qty]) => n + (CARDS[id]?.type === 'Cat' ? qty : 0), 0);
}

/** The fruit families in the deck besides its Hero Cat's own (Garden doesn't count). A legal deck has at most one. */
export function otherFamilies(deck: DeckList): string[] {
  const heroFamily = CARDS[deck.hero]?.family;
  const families = new Set<string>();
  for (const [id, qty] of Object.entries(deck.cards)) {
    const family = CARDS[id]?.family;
    if (qty > 0 && family && family !== heroFamily && !isNeutralFamily(family)) families.add(family);
  }
  return [...families];
}

const copies = (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`;

/**
 * Everything wrong with a deck, most useful first; empty for a legal one. `owned` (card id → copies
 * the player has) adds the collection check; leave it out to check the rules alone.
 */
export function deckProblems(deck: DeckList, owned?: (id: string) => number): string[] {
  const problems: string[] = [];
  const hero = CARDS[deck.hero];
  if (!hero || hero.type !== 'Hero Cat') problems.push('Choose a Hero Cat to lead the deck.');
  else if (owned && owned(deck.hero) < 1) problems.push(`You don't have ${cardName(deck.hero)} yet.`);

  const size = deckSize(deck);
  if (size < DECK_RULES.size) problems.push(`Add ${DECK_RULES.size - size} more ${DECK_RULES.size - size === 1 ? 'card' : 'cards'}.`);
  if (size > DECK_RULES.size) problems.push(`Remove ${size - DECK_RULES.size} ${size - DECK_RULES.size === 1 ? 'card' : 'cards'}.`);

  const others = otherFamilies(deck);
  if (others.length > 1 && hero) {
    problems.push(`Besides ${hero.family}, a deck can use one other family, not ${others.length} (${others.join(', ')}).`);
  }
  const cats = catCount(deck);
  if (cats > DECK_RULES.maxCats) problems.push(`Too many Cats (${cats} of ${DECK_RULES.maxCats}).`);

  for (const [id, qty] of Object.entries(deck.cards)) {
    if (qty <= 0) continue;
    const card = CARDS[id];
    if (!card) { problems.push(`Unknown card ${id}.`); continue; }
    const name = cardName(id);
    if (card.type === 'Hero Cat') problems.push(`${name} is a Hero Cat: Hero Cats lead a deck, they don't go in it.`);
    else if (card.token) problems.push(`${name} comes into play from another card: it can't be put in a deck.`);
    else if (qty > copyLimit(id)) {
      problems.push(card.type === 'Cat' ? `${name} is a Cat, and Cats are one of a kind.` : `At most ${DECK_RULES.copies} copies of ${name}.`);
    } else if (owned && qty > owned(id)) problems.push(`You have only ${copies(owned(id))} of ${name}.`);
  }
  return problems;
}

/**
 * Why one more copy of this card can't go in the deck, or null if it can. `ignoreSize` leaves out the
 * 50-card limit: the deck builder dims only the cards that could never go in this deck as it is.
 */
export function addProblem(deck: DeckList, id: string, owned?: (id: string) => number, ignoreSize = false): string | null {
  const card = CARDS[id];
  const hero = CARDS[deck.hero];
  if (!card || !hero) return 'That card is not available.';
  const name = cardName(id);
  if (card.type === 'Hero Cat') return `${name} is a Hero Cat: Hero Cats lead a deck, they don't go in it.`;
  if (card.token) return `${name} comes into play from another card: it can't be put in a deck.`;
  if (card.family !== hero.family && !isNeutralFamily(card.family)) {
    const other = otherFamilies(deck).find((f) => f !== card.family);
    if (other) return `Your deck already uses ${other}. Besides ${cardName(deck.hero)}'s ${hero.family}, a deck can have one other family.`;
  }
  const have = deck.cards[id] ?? 0;
  if (have >= copyLimit(id)) {
    return card.type === 'Cat' ? `${name} is a Cat, and Cats are one of a kind.` : `A deck can have at most ${DECK_RULES.copies} copies of ${name}.`;
  }
  if (owned && have >= owned(id)) return owned(id) ? `You have only ${copies(owned(id))} of ${name}.` : `You don't have ${name} yet.`;
  if (card.type === 'Cat' && catCount(deck) >= DECK_RULES.maxCats) return `A deck can have at most ${DECK_RULES.maxCats} Cats.`;
  if (!ignoreSize && deckSize(deck) >= DECK_RULES.size) return `Your deck already has ${DECK_RULES.size} cards.`;
  return null;
}

/**
 * A deck as one line of text, to copy out of the deck builder, paste into a playtest or pass along where only
 * plain words fit (PC2024's playtester takes letters, digits, spaces, dots, commas and dashes):
 * `FC1.Zest-Rush.SB1-H01.SB1-C01x3.SB1-C02x3…`. The name's spaces become dashes; a single copy has no `x1`.
 * There are no commas in a code, so a list of decks can be written with commas between them.
 */
export function deckCode(deck: DeckList): string {
  const name = deck.name.normalize('NFKD').replace(/[^A-Za-z0-9 -]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
  const cards = Object.entries(deck.cards).filter(([, qty]) => qty > 0).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, qty]) => (qty === 1 ? id : `${id}x${qty}`));
  return ['FC1', name, deck.hero, ...cards].join('.');
}

/** Reads a deck code back (see deckCode), or null when the text isn't one. The deck may still break the rules: check deckProblems. */
export function parseDeckCode(code: string): DeckList | null {
  const m = /^FC1\.([A-Za-z0-9-]*)\.([A-Za-z0-9-]+)((?:\.[A-Za-z0-9-]+)*)$/.exec(code.trim());
  if (!m) return null;
  const cards: Record<string, number> = {};
  for (const part of m[3].split('.').filter(Boolean)) {
    const q = /^(.+?)(?:x(\d+))?$/.exec(part)!;
    cards[q[1]] = (cards[q[1]] ?? 0) + Number(q[2] ?? 1);
  }
  return { name: m[1].replace(/-/g, ' ').trim() || `${cardName(m[2])}'s deck`, hero: m[2], cards };
}
