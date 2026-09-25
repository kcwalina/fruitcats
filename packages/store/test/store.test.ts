// The Store's money rules. Every number a player pays comes from here, on the server, so each rule has a test.

import { describe, expect, it } from 'vitest';
import { CARDS, SETS } from '@fruitcats/engine';
import {
  SIGNATURE_PRICE,
  CARD_PRICES, DECK_PRICE, MINIMUM_ORDER, buildCatalog, cardProduct, cartForDeck, collectionOf, deckPrice, deckProduct,
  deckWith, formatPrice, maxCopies, missingForDeck, priceCart, starterCollection, whyNotSold, type DeckProduct,
} from '../src/index';

const catalog = buildCatalog(['SB1', 'HW1', 'BP1']);
const starterOnly = collectionOf({});
const fiveAlarm = catalog.products[deckProduct('five-alarm')] as DeckProduct;
/**
 * The catalog with Pepperoncini Bat (a common, in the Five Alarm deck) also sold on its own, as a set might sell a
 * common that isn't in a deck: the real sets' singles are all Cats and Hero Cats, one copy each.
 */
const withCommon = { ...catalog, products: { ...catalog.products, [cardProduct('HW1-P01')]: { id: cardProduct('HW1-P01'), kind: 'card' as const, set: 'HW1', price: 49, card: 'HW1-P01' } } };

describe('catalog', () => {
  it('sells a Signature card as its Signature print, at the Signature price, never as a standard copy', () => {
    const signatures = Object.values(catalog.products).filter((p) => p.kind === 'card' && CARDS[p.card].signature);
    expect(signatures.length).toBeGreaterThan(0);
    for (const p of signatures) expect(p.price).toBe(SIGNATURE_PRICE);
    for (const p of Object.values(catalog.products)) if (p.kind === 'card' && !CARDS[p.card].signature) expect(p.price).toBeLessThan(SIGNATURE_PRICE);
  });


  it('never sells the starter set', () => {
    expect(catalog.sets).toEqual(['HW1', 'BP1']);
    expect(Object.values(catalog.products).some((p) => p.set === 'SB1')).toBe(false);
  });

  it('sells every deck, and on their own only the cards that come in no deck, priced by rarity', () => {
    expect(fiveAlarm.price).toBe(DECK_PRICE);
    expect(fiveAlarm.hero).toBe('HW1-H01');
    const inDeck = new Set([fiveAlarm.hero, ...Object.keys(fiveAlarm.cards)]);
    for (const c of SETS.HW1.cards) {
      const single = catalog.products[cardProduct(c.id)];
      if (inDeck.has(c.id)) expect(single, c.id).toBeUndefined();
      else expect(single?.price, c.id).toBe(CARDS[c.id].signature ? SIGNATURE_PRICE : CARD_PRICES[c.rarity ?? 'Common']);
    }
    expect(Object.values(catalog.products).filter((p) => p.kind === 'card' && p.set === 'HW1').map((p) => p.id))
      .toEqual(['card:HW1-X01', 'card:HW1-X02', 'card:HW1-X03']);
  });

  it('says why a card isn’t sold on its own', () => {
    expect(whyNotSold('HW1-P01', catalog)).toBe('in-deck');
    expect(deckWith('HW1-P01', catalog)?.id).toBe(deckProduct('five-alarm'));
    expect(whyNotSold('SB1-C01', catalog)).toBe('starter');
    expect(whyNotSold('HW1-X01', catalog)).toBeNull();
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

  it('is always cheaper than its cards would be at single prices', () => {
    const singles = Object.entries(missingForDeck(fiveAlarm, starterOnly)).reduce((s, [id, n]) => s + CARD_PRICES[CARDS[id].rarity!] * n, 0);
    expect(singles).toBeGreaterThan(2 * DECK_PRICE);
  });
});

describe('the cart', () => {
  it('adds up singles', () => {
    const q = priceCart([{ product: cardProduct('HW1-P01'), qty: 2 }, { product: cardProduct('HW1-X02'), qty: 1 }], withCommon, starterOnly);
    expect(q.total).toBe(2 * CARD_PRICES.Common + CARD_PRICES.Legendary);
    expect(q.grants).toEqual({ 'HW1-P01': 2, 'HW1-X02': 1 });
    expect(q.canBuy).toBe(true);
  });

  it('has a minimum order', () => {
    const q = priceCart([{ product: cardProduct('HW1-P01'), qty: 1 }], withCommon, starterOnly);
    expect(q.total).toBeLessThan(MINIMUM_ORDER);
    expect(q.canBuy).toBe(false);
  });

  it('never sells more copies than a deck can use', () => {
    const q = priceCart([{ product: cardProduct('HW1-P01'), qty: 5 }], withCommon, collectionOf({ 'HW1-P01': 1 }));
    expect(q.lines[0].qty).toBe(2);
    expect(q.lines[0].note).toMatch(/Only 2 copies more|Only 2 more/);
    const cat = priceCart([{ product: cardProduct('HW1-X01'), qty: 3 }], catalog, starterOnly);
    expect(CARDS['HW1-X01'].type).toBe('Cat');
    expect(cat.lines[0].qty).toBe(1);
    const hero = priceCart([{ product: cardProduct('HW1-X03'), qty: 2 }], catalog, starterOnly);
    expect(hero.lines[0].qty).toBe(maxCopies('HW1-X03'));
    expect(maxCopies('HW1-X03')).toBe(1);
  });

  it('sells nothing you already have enough of', () => {
    const q = priceCart([{ product: cardProduct('HW1-X01'), qty: 1 }], catalog, collectionOf({ 'HW1-X01': 1 }));
    expect(q.lines[0]).toMatchObject({ qty: 0, amount: 0 });
    expect(q.lines[0].note).toBeTruthy();
    expect(q.canBuy).toBe(false);
  });

  it('counts decks first, so a single the deck brings is not bought twice', () => {
    const q = priceCart([{ product: cardProduct('HW1-P01'), qty: 3 }, { product: deckProduct('five-alarm'), qty: 1 }], withCommon, starterOnly);
    expect(q.lines.map((l) => l.product)).toEqual([cardProduct('HW1-P01'), deckProduct('five-alarm')]);   // the cart's order
    expect(q.lines[0].qty).toBe(0);
    expect(q.lines[0].note).toMatch(/deck in your cart/);
    expect(q.total).toBe(DECK_PRICE);
  });

  it('merges repeated lines and sells one of each deck', () => {
    const q = priceCart([
      { product: deckProduct('five-alarm'), qty: 2 }, { product: cardProduct('HW1-P01'), qty: 1 }, { product: cardProduct('HW1-P01'), qty: 1 },
    ], withCommon, starterOnly);
    expect(q.lines).toHaveLength(2);
    expect(q.lines[0].qty).toBe(1);
    expect(q.lines[1].qty).toBe(0);   // the deck already brings its three
  });

  it('ignores anything that is not a real line, and drops unknown products with a note', () => {
    const q = priceCart([
      { product: 'card:NOPE-1', qty: 1 }, { product: '<script>', qty: 1 }, { product: cardProduct('HW1-P01'), qty: -2 },
      { product: cardProduct('HW1-P01'), qty: 1.5 }, { product: cardProduct('SB1-C01'), qty: 1 },
    ] as never, withCommon, starterOnly);
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
  it('becomes the Store deck that brings them, plus the singles sold on their own', () => {
    const deck = { name: 'Hot Mess', hero: 'HW1-H01', cards: { 'HW1-P01': 3, 'HW1-P02': 3, 'HW1-X01': 1, 'SB1-G01': 3 } };
    const owned = collectionOf({ 'HW1-P01': 1 });
    const { lines, decks, unavailable, missing } = cartForDeck(deck, catalog, owned);
    expect(missing).toEqual({ 'HW1-H01': 1, 'HW1-P01': 2, 'HW1-P02': 3, 'HW1-X01': 1 });
    expect(decks).toEqual([{ product: deckProduct('five-alarm'), covers: 6 }]);
    expect(lines).toEqual([{ product: deckProduct('five-alarm'), qty: 1 }, { product: cardProduct('HW1-X01'), qty: 1 }]);
    expect(unavailable).toEqual([]);
    // Buying it all makes the deck complete.
    const q = priceCart(lines, catalog, owned);
    const after = collectionOf(Object.fromEntries(Object.entries(q.grants).map(([id, n]) => [id, n + (id === 'HW1-P01' ? 1 : 0)])));
    expect(missingForDeck(deck, after)).toEqual({});
  });

  it('lists apart what a Store deck can’t bring: more copies than it holds', () => {
    const deck = { name: 'x', hero: 'HW1-H01', cards: { 'HW1-P13': 1, 'HW1-P08': 3 } };   // Five Alarm holds 2 of HW1-P08
    const { lines, unavailable } = cartForDeck(deck, catalog, starterOnly);
    expect(lines).toEqual([{ product: deckProduct('five-alarm'), qty: 1 }]);
    expect(unavailable).toEqual([{ card: 'HW1-P08', qty: 1, why: 'in-deck' }]);
  });

  it('lists cards the Store doesn’t sell apart', () => {
    const deck = { name: 'x', hero: 'SB1-H01', cards: { 'HW1-X01': 1 } };
    expect(cartForDeck(deck, buildCatalog(['BP1']), starterOnly).unavailable).toEqual([{ card: 'HW1-X01', qty: 1, why: 'not-yet' }]);
  });

  it('never sells an exclusive card, and says why', () => {
    const card = CARDS['HW1-X02'];
    card.exclusive = 'promo';
    try {
      const cat = buildCatalog(['HW1']);
      expect(cat.products[cardProduct('HW1-X02')]).toBeUndefined();
      expect(priceCart([{ product: cardProduct('HW1-X02'), qty: 1 }], cat, starterOnly).total).toBe(0);
      const plan = cartForDeck({ name: 'x', hero: 'SB1-H01', cards: { 'HW1-X02': 1, 'HW1-X01': 1 } }, cat, starterOnly);
      expect(plan.unavailable).toEqual([{ card: 'HW1-X02', qty: 1, why: 'exclusive' }]);
      expect(plan.lines).toEqual([{ product: cardProduct('HW1-X01'), qty: 1 }]);
    } finally {
      delete card.exclusive;
    }
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
