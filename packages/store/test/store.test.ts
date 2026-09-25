// The Store's money rules. Every number a player pays comes from here, on the server, so each rule has a test.

import { describe, expect, it } from 'vitest';
import { CARDS, DECKS, SETS, deckCode, parseDeckCode } from '@fruitcats/engine';
import {
  CARD_PRICES, DECK_PRICE, MINIMUM_ORDER, buildCatalog, cardProduct, cartForDeck, collectionOf, deckPrice, deckProduct,
  formatPrice, maxCopies, missingForDeck, priceCart, starterCollection, type DeckProduct,
} from '../src/index';

const catalog = buildCatalog(['SB1', 'HW1', 'BP1']);
const starterOnly = collectionOf({});
const fiveAlarm = catalog.products[deckProduct('five-alarm')] as DeckProduct;

describe('catalog', () => {
  it('never sells the starter set', () => {
    expect(catalog.sets).toEqual(['HW1', 'BP1']);
    expect(Object.values(catalog.products).some((p) => p.set === 'SB1')).toBe(false);
  });

  it('sells every card and deck of the sets on sale, priced by rarity', () => {
    for (const c of SETS.HW1.cards) expect(catalog.products[cardProduct(c.id)]?.price).toBe(CARD_PRICES[c.rarity ?? 'Common']);
    expect(fiveAlarm.price).toBe(DECK_PRICE);
    expect(fiveAlarm.hero).toBe('HW1-H01');
  });

  it('is plain data, so the server can send it as JSON', () => {
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });
});

describe('what a player owns', () => {
  it('starts with the three starter decks added together', () => {
    const starter = starterCollection();
    for (const deck of Object.values(SETS.SB1.decks!)) {
      expect(starter[deck.hero]).toBeGreaterThanOrEqual(1);
      for (const [id, qty] of Object.entries(deck.cards)) expect(starter[id]).toBeGreaterThanOrEqual(qty);
    }
    expect(starter['HW1-H01']).toBeUndefined();
  });

  it('adds what was bought', () => {
    expect(collectionOf({ 'HW1-P01': 2 })('HW1-P01')).toBe(2);
    expect(collectionOf({ 'HW1-P01': 2 })('HW1-P02')).toBe(0);
  });
});

describe('deck prices: never pay twice', () => {
  it('costs the full price when you have none of its cards', () => {
    expect(deckPrice(fiveAlarm, starterOnly)).toBe(DECK_PRICE);
  });

  it('brings every copy you are missing, but no starter cards you already have', () => {
    const brings = missingForDeck(fiveAlarm, starterOnly);
    expect(brings['HW1-H01']).toBe(1);
    expect(brings['HW1-P01']).toBe(3);
    expect(brings['SB1-G01']).toBeUndefined();   // Garden: in every starter deck
  });

  it('drops by the share of the cards you already own', () => {
    const half = collectionOf({ 'HW1-P01': 3, 'HW1-P02': 3, 'HW1-P03': 3 });
    const price = deckPrice(fiveAlarm, half);
    expect(price).toBeLessThan(DECK_PRICE);
    expect(price).toBeGreaterThan(0);
    // The three commons are 9 copies at 49¢ of the deck's worth.
    const worth = Object.entries(missingForDeck(fiveAlarm, () => 0))
      .filter(([id]) => !id.startsWith('SB1')).reduce((s, [id, n]) => s + CARD_PRICES[CARDS[id].rarity!] * n, 0);
    expect(price).toBe(Math.round((DECK_PRICE * (worth - 9 * 49)) / worth));
  });

  it('is free (and not for sale) when you have every card', () => {
    const all = missingForDeck(fiveAlarm, () => 0);
    expect(deckPrice(fiveAlarm, collectionOf(all))).toBe(0);
  });

  it('is always cheaper than the same cards as singles', () => {
    const singles = Object.entries(missingForDeck(fiveAlarm, starterOnly)).reduce((s, [id, n]) => s + catalog.products[cardProduct(id)].price * n, 0);
    expect(singles).toBeGreaterThan(2 * DECK_PRICE);
  });
});

describe('the cart', () => {
  it('adds up singles', () => {
    const q = priceCart([{ product: cardProduct('HW1-P01'), qty: 2 }, { product: cardProduct('HW1-X02'), qty: 1 }], catalog, starterOnly);
    expect(q.total).toBe(2 * CARD_PRICES.Common + CARD_PRICES.Legendary);
    expect(q.grants).toEqual({ 'HW1-P01': 2, 'HW1-X02': 1 });
    expect(q.canBuy).toBe(true);
  });

  it('has a minimum order', () => {
    const q = priceCart([{ product: cardProduct('HW1-P01'), qty: 1 }], catalog, starterOnly);
    expect(q.total).toBeLessThan(MINIMUM_ORDER);
    expect(q.canBuy).toBe(false);
  });

  it('never sells more copies than a deck can use', () => {
    const q = priceCart([{ product: cardProduct('HW1-P01'), qty: 5 }], catalog, collectionOf({ 'HW1-P01': 1 }));
    expect(q.lines[0].qty).toBe(2);
    expect(q.lines[0].note).toMatch(/Only 2 copies more|Only 2 more/);
    const cat = priceCart([{ product: cardProduct('HW1-P13'), qty: 3 }], catalog, starterOnly);
    expect(CARDS['HW1-P13'].type).toBe('Cat');
    expect(cat.lines[0].qty).toBe(1);
    const hero = priceCart([{ product: cardProduct('HW1-H01'), qty: 2 }], catalog, starterOnly);
    expect(hero.lines[0].qty).toBe(maxCopies('HW1-H01'));
    expect(maxCopies('HW1-H01')).toBe(1);
  });

  it('sells nothing you already have enough of', () => {
    const q = priceCart([{ product: cardProduct('HW1-P01'), qty: 1 }], catalog, collectionOf({ 'HW1-P01': 3 }));
    expect(q.lines[0]).toMatchObject({ qty: 0, amount: 0 });
    expect(q.lines[0].note).toBeTruthy();
    expect(q.canBuy).toBe(false);
  });

  it('counts decks first, so a single the deck brings is not bought twice', () => {
    const q = priceCart([{ product: cardProduct('HW1-P01'), qty: 3 }, { product: deckProduct('five-alarm'), qty: 1 }], catalog, starterOnly);
    expect(q.lines.map((l) => l.product)).toEqual([cardProduct('HW1-P01'), deckProduct('five-alarm')]);   // the cart's order
    expect(q.lines[0].qty).toBe(0);
    expect(q.lines[0].note).toMatch(/deck in your cart/);
    expect(q.total).toBe(DECK_PRICE);
  });

  it('merges repeated lines and sells one of each deck', () => {
    const q = priceCart([
      { product: deckProduct('five-alarm'), qty: 2 }, { product: cardProduct('HW1-P06'), qty: 1 }, { product: cardProduct('HW1-P06'), qty: 1 },
    ], catalog, starterOnly);
    expect(q.lines).toHaveLength(2);
    expect(q.lines[0].qty).toBe(1);
    expect(q.lines[1].qty).toBe(0);   // the deck already brings its three
  });

  it('ignores anything that is not a real line, and drops unknown products with a note', () => {
    const q = priceCart([
      { product: 'card:NOPE-1', qty: 1 }, { product: '<script>', qty: 1 }, { product: cardProduct('HW1-P01'), qty: -2 },
      { product: cardProduct('HW1-P01'), qty: 1.5 }, { product: cardProduct('SB1-C01'), qty: 1 },
    ] as never, catalog, starterOnly);
    expect(q.total).toBe(0);
    expect(q.lines.map((l) => l.product)).toEqual(['card:NOPE-1', cardProduct('SB1-C01')]);
    expect(q.lines.every((l) => l.qty === 0 && l.note)).toBe(true);
  });

  it('prices in whole cents', () => {
    const owned = collectionOf({ 'HW1-P06': 1, 'HW1-H01': 1 });
    const q = priceCart([{ product: deckProduct('five-alarm'), qty: 1 }], catalog, owned);
    expect(Number.isInteger(q.total)).toBe(true);
  });
});

describe('a deck from a code, with cards you don’t have', () => {
  it('becomes a cart of exactly the missing copies', () => {
    const code = deckCode(DECKS['five-alarm'] ?? SETS.HW1.decks!['five-alarm']);
    const deck = parseDeckCode(code)!;
    const owned = collectionOf({ 'HW1-P01': 1 });
    const { lines, unavailable, missing } = cartForDeck(deck, catalog, owned);
    expect(unavailable).toEqual([]);
    expect(missing['HW1-P01']).toBe(2);
    expect(lines).toContainEqual({ product: cardProduct('HW1-P01'), qty: 2 });
    expect(lines.some((l) => l.product.includes('SB1'))).toBe(false);
    // Buying it all makes the deck complete.
    const q = priceCart(lines, catalog, owned);
    const after = collectionOf({ 'HW1-P01': 1, ...Object.fromEntries(Object.entries(q.grants).map(([id, n]) => [id, n + (id === 'HW1-P01' ? 1 : 0)])) });
    expect(missingForDeck(deck, after)).toEqual({});
  });

  it('points out a Store deck that brings the same cards for less', () => {
    const deck = parseDeckCode(deckCode(SETS.HW1.decks!['five-alarm']))!;
    const { deals } = cartForDeck(deck, catalog, starterOnly);
    expect(deals[0]).toMatchObject({ product: deckProduct('five-alarm'), price: DECK_PRICE });
    expect(deals[0].singles).toBeGreaterThan(deals[0].price);
  });

  it('lists cards the Store doesn’t sell apart', () => {
    const deck = { name: 'x', hero: 'SB1-H01', cards: { 'HW1-P01': 1 } };
    const catalogHw = buildCatalog(['BP1']);
    expect(cartForDeck(deck, catalogHw, starterOnly).unavailable).toEqual(['HW1-P01']);
  });

  it('asks for nothing when you have the whole deck', () => {
    const sb = Object.values(SETS.SB1.decks!)[0];
    expect(cartForDeck(sb, catalog, starterOnly).lines).toEqual([]);
  });
});

it('formats prices for people', () => {
  expect(formatPrice(499)).toBe('$4.99');
  expect(formatPrice(0)).toBe('$0.00');
});
