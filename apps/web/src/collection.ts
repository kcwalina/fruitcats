// The cards a player has. For now everyone has the three starter decks, added together (so Garden
// cards, which are in all three, come in plenty). A store would add its decks and cards here, and the
// deck builder only ever asks through these functions.

import { CARDS, DECKS } from '@fruitcats/engine';

const COLLECTION: Record<string, number> = {};
for (const deck of Object.values(DECKS)) {
  COLLECTION[deck.hero] = (COLLECTION[deck.hero] ?? 0) + 1;
  for (const [id, qty] of Object.entries(deck.cards)) COLLECTION[id] = (COLLECTION[id] ?? 0) + qty;
}

/** How many copies of a card the player has. */
export function owned(id: string): number {
  return COLLECTION[id] ?? 0;
}

/** The Hero Cats the player can build a deck around. */
export function ownedHeroes(): string[] {
  return Object.keys(COLLECTION).filter((id) => CARDS[id]?.type === 'Hero Cat');
}

/** The cards that can go in a deck (not Hero Cats), in card-number order. */
export function ownedCards(): string[] {
  return Object.keys(CARDS).filter((id) => CARDS[id].type !== 'Hero Cat' && owned(id) > 0);
}
