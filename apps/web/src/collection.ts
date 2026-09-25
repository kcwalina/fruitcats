// The cards a player has: the starter decks added together (so Garden cards, which are in all three, come in
// plenty), plus what their Via Mochi account bought in the Store (shop.ts). The deck builder only ever asks through
// these functions.

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
 * the copies you buy will carry their finish here. For now the three starter Hero Cats come special.
 */
export type Finish = 'standard' | 'foil' | 'gold' | 'prismatic';
export const FINISH_NAMES: Record<Finish, string> = { standard: 'Standard', foil: 'Foil', gold: 'Gold', prismatic: 'Prismatic' };

const FINISHES: Record<string, Finish> = { 'SB1-H01': 'foil', 'SB1-H02': 'gold', 'SB1-H03': 'prismatic' };

/** The finest finish the player has a card in. */
export function finish(id: string): Finish {
  return owned(id) > 0 ? FINISHES[id] ?? 'standard' : 'standard';
}
