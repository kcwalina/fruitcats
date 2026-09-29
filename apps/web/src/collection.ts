// The cards a player has: the starter decks added together, plus what their Via Mochi account bought in the Store
// (shop.ts). The deck builder only ever asks through these functions. A card the account was given from a set since
// taken out of the game (the Starter Box) isn't in the catalog, so it's never listed: these functions ask by card.

import { CARDS, SETS } from '@fruitcats/engine';
import { starterCollection } from '@fruitcats/store';
import { purchased } from './shop';

/** The starter copies, worked out again only when the loaded sets change (a card pack can arrive after start-up). */
let starter: { sets: string; have: Record<string, number> } | null = null;
function starterCopies(): Record<string, number> {
  const sets = Object.values(SETS).map((s) => `${s.set}@${s.version}`).join();
  if (starter?.sets !== sets) starter = { sets, have: starterCollection() };
  return starter.have;
}

/** How many copies of a card the player has. */
export function owned(id: string): number {
  return (starterCopies()[id] ?? 0) + purchased(id);
}

/** The Hero Cats the player can build a deck around. */
export function ownedHeroes(): string[] {
  return Object.keys(CARDS).filter((id) => CARDS[id].type === 'Hero Cat' && owned(id) > 0);
}

/** The cards that can go in a deck (not Hero Cats), in card-number order. */
export function ownedCards(): string[] {
  return Object.keys(CARDS).filter((id) => CARDS[id].type !== 'Hero Cat' && owned(id) > 0);
}

/**
 * How a copy shines, rarest last. Finishes belong to copies, not cards: the Store will sell them, and
 * the copies you buy will carry their finish here. For now the starter Hero Cats come special.
 */
export type Finish = 'standard' | 'foil' | 'gold' | 'prismatic' | 'signature';
export const FINISH_NAMES: Record<Finish, string> = { standard: 'Standard', foil: 'Foil', gold: 'Gold', prismatic: 'Prismatic', signature: 'Signature' };

const FINISHES: Record<string, Finish> = { 'DW1-H01': 'gold', 'PR1-H01': 'gold' };

/** The finest finish the player has a card in. */
export function finish(id: string): Finish {
  // A Signature card exists only as its Signature print: its design decides, not the copy.
  if (CARDS[id]?.signature) return 'signature';
  return owned(id) > 0 ? FINISHES[id] ?? 'standard' : 'standard';
}
