// The player's own decks, kept in localStorage. The starter decks aren't stored: they're fixed, and a deck key is
// either a starter's key or `custom:<id>`. When signed in to a Via Mochi account, src/sync.ts keeps these the same on
// every device: each deck carries when it last changed, and a deleted deck is remembered until the account knows.

import { CARDS, DECKS, deckProblems, type DeckList } from '@fruitcats/engine';
import { isStarterSet } from '@fruitcats/store';
import { owned } from './collection';

const DECKS_KEY = 'fruitcats-decks';
const DELETED_KEY = 'fruitcats-decks-deleted';
const CHOSEN_KEY = 'fruitcats-deck';
const CUSTOM = 'custom:';

export interface MyDeck extends DeckList {
  id: string;
  /** When it last changed (ms since epoch), so the newest edit wins across devices. */
  updatedAt?: number;
  /** The deck this one was copied from (a starter or one of your decks), as it was then. */
  from?: DeckOrigin;
}

/**
 * Where a copied deck came from: that deck's name, key (a starter's, or `custom:<id>`) and cards when it was copied.
 * The cards are kept so the builder can mark what changed even after the original is changed or deleted. A copy of a
 * copy points at the copy, so decks form a chain.
 */
export interface DeckOrigin { name: string; key: string; cards: Record<string, number> }

/** A deck deleted on this device and not yet known to the account. */
export interface DeletedDeck { id: string; updatedAt: number }

const listeners: (() => void)[] = [];
/** Called after any change to the player's decks (sync listens). */
export function onDecksChanged(fn: () => void) { listeners.push(fn); }
const changed = () => listeners.forEach((fn) => fn());

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
  deck.updatedAt = Date.now();
  const decks = listDecks();
  const i = decks.findIndex((d) => d.id === deck.id);
  if (i >= 0) decks[i] = deck;
  else decks.push(deck);
  store(decks);
  changed();
}

/** A new, empty deck. The builder stores it on its first change. */
export function newDeck(hero: string): MyDeck {
  return { id: Date.now().toString(36), name: `${CARDS[hero].name.split(',')[0]}'s deck`, hero, cards: {} };
}

/**
 * A new deck with the cards of a starter or one of your decks (by key), remembering where it came from. Like any new
 * deck, the builder stores it on its first change. Its name is "My <starter>", or "<your deck> 2" (3, 4…).
 */
export function copyDeck(key: string): MyDeck | undefined {
  const source = deckForKey(key);
  if (!source) return undefined;
  const deck = newDeck(source.hero);
  const names = new Set(listDecks().map((d) => d.name));
  const stem = (key.startsWith(CUSTOM) ? source.name : `My ${source.name}`).slice(0, 36);
  let name = stem;
  for (let n = 2; names.has(name); n++) name = `${stem} ${n}`;
  deck.name = name;
  deck.cards = { ...source.cards };
  deck.from = { name: source.name, key, cards: { ...source.cards } };
  return deck;
}

export function deleteDeck(id: string): void {
  store(listDecks().filter((d) => d.id !== id));
  storeDeleted([...deletedDecks().filter((d) => d.id !== id), { id, updatedAt: Date.now() }]);
  changed();
}

export function deletedDecks(): DeletedDeck[] {
  try { const d = JSON.parse(localStorage.getItem(DELETED_KEY) ?? '[]'); return Array.isArray(d) ? d : []; } catch { return []; }
}
function storeDeleted(list: DeletedDeck[]) {
  try { localStorage.setItem(DELETED_KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

/** Replace this device's decks with the account's (after a sync). Deletions the account now knows are forgotten. */
export function applySyncedDecks(decks: MyDeck[], deletedIds: string[]): void {
  store(decks);
  const known = new Set(deletedIds);
  storeDeleted(deletedDecks().filter((d) => !known.has(d.id)));
}

/** Signing out: this device forgets the account's decks (they're safe in the account). */
export function forgetDecks(): void {
  try { localStorage.removeItem(DECKS_KEY); localStorage.removeItem(DELETED_KEY); } catch { /* private mode */ }
}

/** What's wrong with a deck, collection included; empty when it can be played. */
export const problems = (deck: DeckList) => deckProblems(deck, owned);
export const isReady = (deck: DeckList) => problems(deck).length === 0;

export const customKey = (id: string) => `${CUSTOM}${id}`;

/**
 * The ready-made decks the player has every card of: the starter decks, and those taken from the Store (the old
 * Starter Box decks are there, free). Starter decks first.
 */
export function ownedDeckKeys(): string[] {
  const starter = (key: string) => (isStarterSet(CARDS[DECKS[key].hero]?.set ?? '') ? 0 : 1);
  return Object.keys(DECKS).filter((key) => isReady(DECKS[key])).sort((a, b) => starter(a) - starter(b));
}

/** The deck to fall back on: the first ready-made deck the player has. */
export const firstDeck = () => ownedDeckKeys()[0] ?? Object.keys(DECKS)[0];

/** A starter deck or one of the player's own, by key; undefined if it's gone. */
export function deckForKey(key: string): DeckList | undefined {
  return key.startsWith(CUSTOM) ? getDeck(key.slice(CUSTOM.length)) : DECKS[key];
}

/** The deck Solo plays with: remembered, and back to the first starter if it's gone or no longer legal. */
export function loadChosenDeck(): string {
  let key: string | null = null;
  try { key = localStorage.getItem(CHOSEN_KEY); } catch { /* private mode */ }
  const deck = key ? deckForKey(key) : undefined;
  return key && deck && isReady(deck) ? key : firstDeck();
}

export function saveChosenDeck(key: string): void {
  try { localStorage.setItem(CHOSEN_KEY, key); } catch { /* private mode: not remembered */ }
}
