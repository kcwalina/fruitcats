// The player's own decks, kept in localStorage (this browser only, like the saved game). The starter
// decks aren't stored: they're fixed, and a deck key is either a starter's key or `custom:<id>`.

import { CARDS, DECKS, deckProblems, type DeckList } from '@fruitcats/engine';
import { owned } from './collection';

const DECKS_KEY = 'fruitcats-decks';
const CHOSEN_KEY = 'fruitcats-deck';
const CUSTOM = 'custom:';

export interface MyDeck extends DeckList {
  id: string;
}

export function listDecks(): MyDeck[] {
  try {
    const decks = JSON.parse(localStorage.getItem(DECKS_KEY) ?? '[]');
    // A deck whose Hero Cat no longer exists can't be shown or fixed; unknown cards are dropped.
    return Array.isArray(decks)
      ? decks.filter((d: MyDeck) => d?.id && CARDS[d.hero]).map((d: MyDeck) => ({
        ...d, cards: Object.fromEntries(Object.entries(d.cards ?? {}).filter(([id, qty]) => CARDS[id] && qty > 0)),
      }))
      : [];
  } catch {
    return [];
  }
}

function store(decks: MyDeck[]): void {
  try { localStorage.setItem(DECKS_KEY, JSON.stringify(decks)); } catch { /* private mode or full: not remembered */ }
}

export function getDeck(id: string): MyDeck | undefined {
  return listDecks().find((d) => d.id === id);
}

export function saveDeck(deck: MyDeck): void {
  const decks = listDecks();
  const i = decks.findIndex((d) => d.id === deck.id);
  if (i >= 0) decks[i] = deck;
  else decks.push(deck);
  store(decks);
}

export function createDeck(hero: string): MyDeck {
  const deck: MyDeck = { id: Date.now().toString(36), name: `${CARDS[hero].name.split(',')[0]}'s deck`, hero, cards: {} };
  saveDeck(deck);
  return deck;
}

export function deleteDeck(id: string): void {
  store(listDecks().filter((d) => d.id !== id));
}

/** What's wrong with a deck, collection included; empty when it can be played. */
export const problems = (deck: DeckList) => deckProblems(deck, owned);
export const isReady = (deck: DeckList) => problems(deck).length === 0;

export const customKey = (id: string) => `${CUSTOM}${id}`;

/** A starter deck or one of the player's own, by key; undefined if it's gone. */
export function deckForKey(key: string): DeckList | undefined {
  return key.startsWith(CUSTOM) ? getDeck(key.slice(CUSTOM.length)) : DECKS[key];
}

/** The deck Solo plays with: remembered, and back to the first starter if it's gone or no longer legal. */
export function loadChosenDeck(): string {
  let key: string | null = null;
  try { key = localStorage.getItem(CHOSEN_KEY); } catch { /* private mode */ }
  const deck = key ? deckForKey(key) : undefined;
  return key && deck && isReady(deck) ? key : Object.keys(DECKS)[0];
}

export function saveChosenDeck(key: string): void {
  try { localStorage.setItem(CHOSEN_KEY, key); } catch { /* private mode: not remembered */ }
}
