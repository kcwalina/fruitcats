// The Store's rules (docs/store-plan.md): what's for sale, what it costs, and what a cart comes to. Shared by the
// Fruitcats API, whose answer is the one that counts, and the game, which shows the same numbers straight away.
// Pure: no storage, no network and nothing to do with payments. Money is always whole cents.
//
//   catalog   buildCatalog(sets)          every card and deck of the sets on sale, with its price
//   owning    starterCollection()         the copies everyone has (the starter decks)
//             collectionOf(grants)        those plus what an account bought
//   buying    priceCart(cart, catalog, owned)   → a Quote: each line's price, what it brings, the total
//             cartForDeck(deck, catalog, owned) → the cards a deck is missing, as a cart

import { CARDS, SETS, copyLimit, type DeckList, type Rarity } from '@fruitcats/engine';

export const CURRENCY = 'USD';
/** A single card's price by rarity, in cents (store-plan.md, Pricing: starting points). */
export const CARD_PRICES: Record<Rarity, number> = { Common: 49, Uncommon: 99, Rare: 149, Legendary: 499 };
/** A whole deck, Hero Cat included. Bought card by card it costs about three times as much. */
export const DECK_PRICE = 999;
/** Payment fees would eat a smaller order, so singles are bought through a cart. */
export const MINIMUM_ORDER = 499;
/** More lines than any real cart has: the server refuses bigger ones. */
export const MAX_CART_LINES = 120;

export type Owned = (id: string) => number;

export interface CardProduct { id: string; kind: 'card'; set: string; price: number; card: string }
export interface DeckProduct {
  id: string; kind: 'deck'; set: string; price: number;
  deck: string; name: string; hero: string; cards: Record<string, number>; blurb?: string;
}
export type Product = CardProduct | DeckProduct;

export interface Catalog {
  currency: string;
  minimumOrder: number;
  /** The sets on sale, in release order. */
  sets: string[];
  products: Record<string, Product>;
}

export const cardProduct = (card: string) => `card:${card}`;
export const deckProduct = (deck: string) => `deck:${deck}`;
export const validProductId = (id: unknown): id is string => typeof id === 'string' && /^(card|deck):[A-Za-z0-9-]{1,40}$/.test(id);

/**
 * Is this a starter set, whose decks everyone has? Sets say so (`starter`). A card pack published before sets said
 * it can replace the built-in Starter Box, so when no loaded set says, the released sets are the starters, as before.
 */
function isStarterSet(set: string): boolean {
  const s = SETS[set];
  if (!s) return false;
  return Object.values(SETS).some((x) => x.starter) ? !!s.starter : s.status === 'released';
}

/** Cards of a starter set come free with the starter decks, so they're never sold. */
const isStarterCard = (id: string) => isStarterSet(CARDS[id]?.set ?? '');

/** How many copies of a card are worth having: what one deck can hold, and one of each Hero Cat. */
export function maxCopies(id: string): number {
  return CARDS[id]?.type === 'Hero Cat' ? 1 : copyLimit(id);
}

/** What one copy is worth, to share a deck's price out fairly. */
const cardValue = (id: string) => CARD_PRICES[CARDS[id]?.rarity ?? 'Common'];

// ── The catalog ──────────────────────────────────────────────────────────────────────────────────

/**
 * Everything for sale in these sets (registered with the engine), in their order: each deck, then each single card.
 * The Store sells decks, and on their own only the cards that come in no deck: a card that's in a deck is had by buying
 * that deck (the owner's rule, 2026-09-24). Starter sets are skipped whatever the list says, and so are tokens and
 * exclusive cards.
 */
export function buildCatalog(sets: string[]): Catalog {
  const onSale = sets.filter((s) => SETS[s] && !isStarterSet(s));
  const products: Record<string, Product> = {};
  for (const set of onSale) {
    for (const [key, deck] of Object.entries(SETS[set].decks ?? {})) {
      const blurb = (deck as DeckList & { blurb?: string }).blurb;
      products[deckProduct(key)] = {
        id: deckProduct(key), kind: 'deck', set, price: DECK_PRICE,
        deck: key, name: deck.name, hero: deck.hero, cards: { ...deck.cards }, ...(blurb ? { blurb } : {}),
      };
    }
    const inDecks = new Set(Object.values(SETS[set].decks ?? {}).flatMap((d) => [d.hero, ...Object.keys(d.cards)]));
    for (const c of SETS[set].cards) {
      if (!CARDS[c.id] || CARDS[c.id].token || CARDS[c.id].exclusive || inDecks.has(c.id)) continue;
      products[cardProduct(c.id)] = { id: cardProduct(c.id), kind: 'card', set, price: CARD_PRICES[c.rarity ?? 'Common'], card: c.id };
    }
  }
  return { currency: CURRENCY, minimumOrder: MINIMUM_ORDER, sets: onSale, products };
}

// ── What a player owns ───────────────────────────────────────────────────────────────────────────

/** The copies everyone has: every starter deck (from sets marked `starter`), added together, Hero Cats included. */
export function starterCollection(): Record<string, number> {
  const have: Record<string, number> = {};
  for (const set of Object.values(SETS)) {
    if (!isStarterSet(set.set)) continue;
    for (const deck of Object.values(set.decks ?? {})) {
      have[deck.hero] = (have[deck.hero] ?? 0) + 1;
      for (const [id, qty] of Object.entries(deck.cards)) have[id] = (have[id] ?? 0) + qty;
    }
  }
  return have;
}

/** The starter copies plus what an account was granted (card id → copies). */
export function collectionOf(grants: Record<string, number>): Owned {
  const starter = starterCollection();
  return (id) => (starter[id] ?? 0) + (grants[id] ?? 0);
}

// ── Decks ────────────────────────────────────────────────────────────────────────────────────────

/** The copies of a deck's cards (Hero Cat included) you don't have yet: what buying it brings. */
export function missingForDeck(deck: DeckList, owned: Owned): Record<string, number> {
  const missing: Record<string, number> = {};
  if (CARDS[deck.hero] && owned(deck.hero) < 1) missing[deck.hero] = 1;
  for (const [id, qty] of Object.entries(deck.cards)) {
    if (!CARDS[id] || qty <= 0) continue;
    const short = Math.min(qty, maxCopies(id)) - owned(id);
    if (short > 0) missing[id] = (missing[id] ?? 0) + short;
  }
  return missing;
}

/**
 * A deck's price for someone who owns `owned`: never pay twice. The full price is for every copy that isn't a
 * starter card; the cards you already have take their share off it. Zero when you have them all.
 */
export function deckPrice(p: DeckProduct, owned: Owned): number {
  const whole = missingForDeck(p, () => 0);
  const missing = missingForDeck(p, owned);
  const worth = (copies: Record<string, number>) =>
    Object.entries(copies).reduce((sum, [id, n]) => sum + (isStarterCard(id) ? 0 : cardValue(id) * n), 0);
  const full = worth(whole);
  if (!Object.keys(missing).length) return 0;
  if (!full) return p.price;
  return Math.round((p.price * worth(missing)) / full);
}

// ── The cart ─────────────────────────────────────────────────────────────────────────────────────

export interface CartLine { product: string; qty: number }

export interface PricedLine {
  product: string;
  /** How many this line buys: what was asked, less any copies that wouldn't be useful. */
  qty: number;
  unit: number;
  amount: number;
  /** The copies this line brings: card id → copies. */
  grants: Record<string, number>;
  /** Why the line isn't what was asked for, in the player's words. */
  note?: string;
}

export interface Quote {
  currency: string;
  lines: PricedLine[];
  /** Cents. Tax, where it applies, is added by the payment page. */
  total: number;
  /** Everything the order brings, added up. */
  grants: Record<string, number>;
  minimumOrder: number;
  /** Something to buy, and at least the minimum order. */
  canBuy: boolean;
}

const copies = (n: number) => `${n} ${n === 1 ? 'copy' : 'copies'}`;

/**
 * What a cart comes to for someone who owns `owned`. Decks are counted first, so a single that a deck in the same
 * cart already brings isn't bought twice; no line ever brings more copies than a deck can use. Lines keep the
 * cart's order. Unknown products are dropped, with a note.
 */
export function priceCart(cart: CartLine[], catalog: Catalog, owned: Owned): Quote {
  // One line per product, in the order first seen.
  const merged = new Map<string, number>();
  for (const line of cart.slice(0, MAX_CART_LINES)) {
    if (!validProductId(line?.product) || !Number.isInteger(line.qty) || line.qty <= 0) continue;
    merged.set(line.product, Math.min(99, (merged.get(line.product) ?? 0) + line.qty));
  }
  const granted: Record<string, number> = {};
  const have = (id: string) => owned(id) + (granted[id] ?? 0);
  const give = (grants: Record<string, number>) => { for (const [id, n] of Object.entries(grants)) granted[id] = (granted[id] ?? 0) + n; };
  const priced = new Map<string, PricedLine>();

  for (const [id, asked] of merged) {
    const p = catalog.products[id];
    if (p?.kind !== 'deck') continue;
    const grants = missingForDeck(p, have);
    const unit = deckPrice(p, have);
    const qty = Object.keys(grants).length ? 1 : 0;
    priced.set(id, {
      product: id, qty, unit, amount: unit * qty, grants,
      ...(qty === 0 ? { note: 'You already have every card in this deck.' } : asked > 1 ? { note: 'One of each deck is all you need.' } : {}),
    });
    give(grants);
  }
  for (const [id, asked] of merged) {
    const p = catalog.products[id];
    if (p?.kind !== 'card') continue;
    const room = Math.max(0, maxCopies(p.card) - have(p.card));
    const qty = Math.min(asked, room);
    let note: string | undefined;
    if (qty < asked) {
      note = room === 0
        ? (granted[p.card] ? 'A deck in your cart already brings this card.' : 'You already have every copy a deck can use.')
        : `Only ${copies(room)} more ${room === 1 ? 'is' : 'are'} useful: a deck holds at most ${copies(maxCopies(p.card))}.`;
    }
    const grants = qty ? { [p.card]: qty } : {};
    priced.set(id, { product: id, qty, unit: p.price, amount: p.price * qty, grants, ...(note ? { note } : {}) });
    give(grants);
  }

  const lines = [...merged.keys()].map((id) => priced.get(id) ?? { product: id, qty: 0, unit: 0, amount: 0, grants: {}, note: 'This isn’t for sale any more.' });
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return {
    currency: catalog.currency, lines, total, grants: granted, minimumOrder: catalog.minimumOrder,
    canBuy: total > 0 && total >= catalog.minimumOrder,
  };
}

/** The Store deck a card comes in, if any. */
export function deckWith(id: string, catalog: Catalog): DeckProduct | undefined {
  return Object.values(catalog.products).find((p): p is DeckProduct => p.kind === 'deck' && (p.hero === id || !!p.cards[id]));
}

/**
 * Why the Store doesn't sell a card on its own: 'in-deck' (it comes with a deck: buy the deck), 'exclusive' (a promo or
 * event card, never sold: players get those another way), 'starter' (everyone has it already) or 'not-yet' (its set
 * isn't in the Store). Null when it's for sale.
 */
export type NotSold = 'in-deck' | 'exclusive' | 'starter' | 'not-yet';
export function whyNotSold(id: string, catalog: Catalog): NotSold | null {
  if (catalog.products[cardProduct(id)]) return null;
  if (CARDS[id]?.exclusive) return 'exclusive';
  if (isStarterCard(id)) return 'starter';
  return deckWith(id, catalog) ? 'in-deck' : 'not-yet';
}

/**
 * How to get the cards a deck needs that you don't have, as a cart: the Store decks that bring them (the one bringing
 * the most first, and so on), then the single cards sold on their own. Anything still missing (a card that isn't
 * sold, or more copies than its Store deck holds) is listed apart, with why.
 */
export function cartForDeck(deck: DeckList, catalog: Catalog, owned: Owned) {
  const missing = missingForDeck(deck, owned);
  const left: Record<string, number> = { ...missing };
  const decks: { product: string; covers: number }[] = [];
  const storeDecks = Object.values(catalog.products).filter((p): p is DeckProduct => p.kind === 'deck');
  for (;;) {
    let best: DeckProduct | null = null, bestCovers = 0;
    for (const p of storeDecks) {
      if (decks.some((d) => d.product === p.id)) continue;
      const brings = missingForDeck(p, owned);
      const covers = Object.entries(left).reduce((n, [id, qty]) => n + Math.min(qty, brings[id] ?? 0), 0);
      if (covers > bestCovers) { best = p; bestCovers = covers; }
    }
    if (!best) break;
    decks.push({ product: best.id, covers: bestCovers });
    for (const [id, n] of Object.entries(missingForDeck(best, owned))) {
      if (!left[id]) continue;
      left[id] -= Math.min(left[id], n);
      if (!left[id]) delete left[id];
    }
  }
  const lines: CartLine[] = decks.map((d) => ({ product: d.product, qty: 1 }));
  const unavailable: { card: string; qty: number; why: NotSold }[] = [];
  for (const [id, qty] of Object.entries(left)) {
    const why = whyNotSold(id, catalog);
    if (why) unavailable.push({ card: id, qty, why });
    else lines.push({ product: cardProduct(id), qty });
  }
  return { missing, lines, decks, unavailable };
}

/** "$4.99". */
export function formatPrice(cents: number, currency = CURRENCY): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
