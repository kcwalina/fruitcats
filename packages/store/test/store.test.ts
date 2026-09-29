// The Store's money rules. Every number a player pays comes from here, on the server, so each rule has a test.

import { describe, expect, it } from 'vitest';
import { CARDS, DECKS, SETS } from '@fruitcats/engine';
import {
  SIGNATURE_PRICE,
  CARD_PRICES, DECK_PRICE, MINIMUM_ORDER, buildCatalog, cardProduct, cartForDeck, collectionOf, deckPrice, deckProduct,
  deckWith, formatPrice, maxCopies, missingForDeck, priceCart, soloFoeDecks, starterCollection, whyNotSold, type DeckProduct,
} from '../src/index';

// SB1, the retired Starter Box, as an old STORE_SETS may still name it: a set the game doesn't have is left out.
const catalog = buildCatalog(['DW1', 'SB1', 'JR1', 'MB1', 'MC1']);
const starterOnly = collectionOf({});
const jiaoren = catalog.products[deckProduct('jiaoren')] as DeckProduct;
/**
 * The catalog with Weaver of the Sea Hall (a common, in the Jiaoren deck) also sold on its own: a single and a deck that
 * bring the same card. The real sets never sell a card that comes in a deck.
 */
const withCommon = { ...catalog, products: { ...catalog.products, [cardProduct('JR1-D02')]: { id: cardProduct('JR1-D02'), kind: 'card' as const, set: 'JR1', price: 49, card: 'JR1-D02' } } };

describe('catalog', () => {
  it('sells a Signature card as its Signature print, at the Signature price, never as a standard copy', () => {
    const signatures = Object.values(catalog.products).filter((p) => p.kind === 'card' && CARDS[p.card].signature);
    expect(signatures.length).toBeGreaterThan(0);
    for (const p of signatures) expect(p.price).toBe(SIGNATURE_PRICE);
    for (const p of Object.values(catalog.products)) if (p.kind === 'card' && !CARDS[p.card].signature) expect(p.price).toBeLessThan(SIGNATURE_PRICE);
  });


  it('never sells the starter set, nor a set the game doesn’t have', () => {
    expect(catalog.sets).toEqual(['JR1', 'MB1', 'MC1']);
    expect(Object.values(catalog.products).some((p) => p.set === 'DW1')).toBe(false);
  });

  it('lists a free deck for free: a deck names its own price', () => {
    const free: DeckProduct = { ...jiaoren, id: deckProduct('free-jiaoren'), deck: 'free-jiaoren', price: 0 };
    const cat = { ...catalog, products: { ...catalog.products, [free.id]: free } };
    expect(deckPrice(free, starterOnly)).toBe(0);
    expect(Object.keys(missingForDeck(free, starterOnly)).length).toBeGreaterThan(0);   // free, but it brings cards
    expect(priceCart([{ product: free.id, qty: 1 }], cat, starterOnly)).toMatchObject({ total: 0, canBuy: false });
  });

  it('sells every deck, and on their own only the cards that come in no deck, priced by rarity', () => {
    expect(jiaoren.price).toBe(DECK_PRICE);
    expect(jiaoren.hero).toBe('JR1-H01');
    const inDeck = new Set([jiaoren.hero, ...Object.keys(jiaoren.cards)]);
    for (const c of [...SETS.JR1.cards, ...SETS.MB1.cards]) {
      const single = catalog.products[cardProduct(c.id)];
      if (inDeck.has(c.id)) expect(single, c.id).toBeUndefined();
      else expect(single?.price, c.id).toBe(CARDS[c.id].signature ? SIGNATURE_PRICE : CARD_PRICES[c.rarity ?? 'Common']);
    }
    const singles = (set: string) => Object.values(catalog.products).filter((p) => p.kind === 'card' && p.set === set).map((p) => p.id);
    expect(singles('JR1')).toEqual([]);
    expect(singles('MB1')).toEqual(['card:MB1-H01', 'card:MB1-D01', 'card:MB1-D02', 'card:MB1-D03']);
  });

  it('says why a card isn’t sold on its own', () => {
    expect(whyNotSold('JR1-D02', catalog)).toBe('in-deck');
    expect(deckWith('JR1-D02', catalog)?.id).toBe(deckProduct('jiaoren'));
    expect(whyNotSold('DW1-D01', catalog)).toBe('starter');
    expect(whyNotSold('SB1-C01', catalog)).toBe('not-yet');   // a retired card: the game doesn't know it
    expect(whyNotSold('MB1-D01', catalog)).toBeNull();
  });

  it('gives the Solo opponent a deck with another Hero Cat', () => {
    for (const deck of Object.values(DECKS)) {
      const foes = soloFoeDecks(deck.hero);
      expect(foes.length).toBeGreaterThan(0);
      expect(foes.filter((key) => DECKS[key].hero === deck.hero)).toEqual([]);
    }
  });

  it('is plain data, so the server can send it as JSON', () => {
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });
});

describe('what a player owns', () => {
  it('starts with the starter decks (the Domowiki) added together', () => {
    const starter = starterCollection();
    for (const deck of Object.values(SETS.DW1.decks!)) {
      expect(starter[deck.hero]).toBeGreaterThanOrEqual(1);
      for (const [id, qty] of Object.entries(deck.cards)) expect(starter[id]).toBeGreaterThanOrEqual(qty);
    }
    expect(starter['JR1-H01']).toBeUndefined();
  });

  it('adds what was bought', () => {
    expect(collectionOf({ 'JR1-D02': 2 })('JR1-D02')).toBe(2);
    expect(collectionOf({ 'JR1-D02': 2 })('JR1-D04')).toBe(0);
  });

  it('keeps cards of a retired set an account was given (the Starter Box), without their counting for anything', () => {
    const owned = collectionOf({ 'SB1-H01': 1, 'SB1-C01': 3, 'JR1-D02': 1 });
    expect(owned('JR1-D02')).toBe(1);
    expect(owned('SB1-C01')).toBe(3);
    const deck = { name: 'Old', hero: 'SB1-H01', cards: { 'SB1-C01': 3, 'JR1-D02': 1 } };
    expect(missingForDeck(deck, collectionOf({}))).toEqual({ 'JR1-D02': 1 });
    expect(cartForDeck(deck, catalog, owned).unavailable).toEqual([]);
    expect(priceCart([{ product: deckProduct('zest-rush'), qty: 1 }], catalog, owned)).toMatchObject({ total: 0, canBuy: false });   // its old free deck: gone
  });
});

describe('deck prices: never pay twice', () => {
  it('costs the full price when you have none of its cards', () => {
    expect(deckPrice(jiaoren, starterOnly)).toBe(DECK_PRICE);
  });

  it('brings every copy you are missing, and none you already have', () => {
    const brings = missingForDeck(jiaoren, starterOnly);
    expect(brings['JR1-H01']).toBe(1);
    expect(brings['JR1-D02']).toBe(3);
    expect(missingForDeck(jiaoren, collectionOf({ 'JR1-D02': 3 }))['JR1-D02']).toBeUndefined();
  });

  it('drops by the share of the cards you already own', () => {
    const half = collectionOf({ 'JR1-D02': 3, 'JR1-D04': 3, 'JR1-D05': 3 });
    const price = deckPrice(jiaoren, half);
    expect(price).toBeLessThan(DECK_PRICE);
    expect(price).toBeGreaterThan(0);
    // The three commons are 9 copies at 49¢ of the deck's worth.
    const worth = Object.entries(missingForDeck(jiaoren, () => 0))
      .reduce((s, [id, n]) => s + CARD_PRICES[CARDS[id].rarity!] * n, 0);
    expect(price).toBe(Math.round((DECK_PRICE * (worth - 9 * 49)) / worth));
  });

  it('is free (and not for sale) when you have every card', () => {
    const all = missingForDeck(jiaoren, () => 0);
    expect(deckPrice(jiaoren, collectionOf(all))).toBe(0);
  });

  it('is always cheaper than its cards would be at single prices', () => {
    const singles = Object.entries(missingForDeck(jiaoren, starterOnly)).reduce((s, [id, n]) => s + CARD_PRICES[CARDS[id].rarity!] * n, 0);
    expect(singles).toBeGreaterThan(2 * DECK_PRICE);
  });
});

describe('the cart', () => {
  it('adds up singles', () => {
    const q = priceCart([{ product: cardProduct('MB1-D02'), qty: 2 }, { product: cardProduct('MB1-H01'), qty: 1 }], catalog, starterOnly);
    expect(q.total).toBe(2 * CARD_PRICES.Common + CARD_PRICES.Legendary);
    expect(q.grants).toEqual({ 'MB1-D02': 2, 'MB1-H01': 1 });
    expect(q.canBuy).toBe(true);
  });

  it('has a minimum order', () => {
    const q = priceCart([{ product: cardProduct('MB1-D02'), qty: 1 }], catalog, starterOnly);
    expect(q.total).toBeLessThan(MINIMUM_ORDER);
    expect(q.canBuy).toBe(false);
  });

  it('never sells more copies than a deck can use', () => {
    const q = priceCart([{ product: cardProduct('MB1-D02'), qty: 5 }], catalog, collectionOf({ 'MB1-D02': 1 }));
    expect(q.lines[0].qty).toBe(2);
    expect(q.lines[0].note).toMatch(/Only 2 copies more|Only 2 more/);
    const cat = priceCart([{ product: cardProduct('MB1-D01'), qty: 3 }], catalog, starterOnly);
    expect(CARDS['MB1-D01'].type).toBe('Cat');
    expect(cat.lines[0].qty).toBe(1);
    const hero = priceCart([{ product: cardProduct('MB1-H01'), qty: 2 }], catalog, starterOnly);
    expect(hero.lines[0].qty).toBe(maxCopies('MB1-H01'));
    expect(maxCopies('MB1-H01')).toBe(1);
  });

  it('sells nothing you already have enough of', () => {
    const q = priceCart([{ product: cardProduct('MB1-D01'), qty: 1 }], catalog, collectionOf({ 'MB1-D01': 1 }));
    expect(q.lines[0]).toMatchObject({ qty: 0, amount: 0 });
    expect(q.lines[0].note).toBeTruthy();
    expect(q.canBuy).toBe(false);
  });

  it('counts decks first, so a single the deck brings is not bought twice', () => {
    const q = priceCart([{ product: cardProduct('JR1-D02'), qty: 3 }, { product: deckProduct('jiaoren'), qty: 1 }], withCommon, starterOnly);
    expect(q.lines.map((l) => l.product)).toEqual([cardProduct('JR1-D02'), deckProduct('jiaoren')]);   // the cart's order
    expect(q.lines[0].qty).toBe(0);
    expect(q.lines[0].note).toMatch(/deck in your cart/);
    expect(q.total).toBe(DECK_PRICE);
  });

  it('merges repeated lines and sells one of each deck', () => {
    const q = priceCart([
      { product: deckProduct('jiaoren'), qty: 2 }, { product: cardProduct('JR1-D02'), qty: 1 }, { product: cardProduct('JR1-D02'), qty: 1 },
    ], withCommon, starterOnly);
    expect(q.lines).toHaveLength(2);
    expect(q.lines[0].qty).toBe(1);
    expect(q.lines[1].qty).toBe(0);   // the deck already brings its three
  });

  it('ignores anything that is not a real line, and drops unknown products with a note', () => {
    const q = priceCart([
      { product: 'card:NOPE-1', qty: 1 }, { product: '<script>', qty: 1 }, { product: cardProduct('JR1-D02'), qty: -2 },
      { product: cardProduct('JR1-D02'), qty: 1.5 }, { product: cardProduct('SB1-C01'), qty: 1 },
    ] as never, withCommon, starterOnly);
    expect(q.total).toBe(0);
    expect(q.lines.map((l) => l.product)).toEqual(['card:NOPE-1', cardProduct('SB1-C01')]);
    expect(q.lines.every((l) => l.qty === 0 && l.note)).toBe(true);
  });

  it('prices in whole cents', () => {
    const owned = collectionOf({ 'JR1-D01': 1, 'JR1-H01': 1 });
    const q = priceCart([{ product: deckProduct('jiaoren'), qty: 1 }], catalog, owned);
    expect(Number.isInteger(q.total)).toBe(true);
  });
});

describe('a deck from a code, with cards you don’t have', () => {
  it('becomes the Store deck that brings them, plus the singles sold on their own', () => {
    const deck = { name: 'Pearl Mess', hero: 'JR1-H01', cards: { 'JR1-D02': 3, 'JR1-D04': 3, 'MB1-D01': 1, 'DW1-D16': 3 } };
    const owned = collectionOf({ 'JR1-D02': 1 });
    const { lines, decks, unavailable, missing } = cartForDeck(deck, catalog, owned);
    expect(missing).toEqual({ 'JR1-H01': 1, 'JR1-D02': 2, 'JR1-D04': 3, 'MB1-D01': 1 });
    expect(decks).toEqual([{ product: deckProduct('jiaoren'), covers: 6 }]);
    expect(lines).toEqual([{ product: deckProduct('jiaoren'), qty: 1 }, { product: cardProduct('MB1-D01'), qty: 1 }]);
    expect(unavailable).toEqual([]);
    // Buying it all makes the deck complete.
    const q = priceCart(lines, catalog, owned);
    const after = collectionOf(Object.fromEntries(Object.entries(q.grants).map(([id, n]) => [id, n + (id === 'JR1-D02' ? 1 : 0)])));
    expect(missingForDeck(deck, after)).toEqual({});
  });

  it('lists apart what a Store deck can’t bring: more copies than it holds', () => {
    const deck = { name: 'x', hero: 'JR1-H01', cards: { 'JR1-D17': 1, 'JR1-D11': 3 } };   // the Jiaoren deck holds 2 of JR1-D11
    const { lines, unavailable } = cartForDeck(deck, catalog, starterOnly);
    expect(lines).toEqual([{ product: deckProduct('jiaoren'), qty: 1 }]);
    expect(unavailable).toEqual([{ card: 'JR1-D11', qty: 1, why: 'in-deck' }]);
  });

  it('lists cards the Store doesn’t sell apart', () => {
    const deck = { name: 'x', hero: 'DW1-H01', cards: { 'MB1-D01': 1 } };
    expect(cartForDeck(deck, buildCatalog([]), starterOnly).unavailable).toEqual([{ card: 'MB1-D01', qty: 1, why: 'not-yet' }]);
  });

  it('never sells an exclusive card, and says why', () => {
    const card = CARDS['MB1-D03'];
    card.exclusive = 'promo';
    try {
      const cat = buildCatalog(['MB1']);
      expect(cat.products[cardProduct('MB1-D03')]).toBeUndefined();
      expect(priceCart([{ product: cardProduct('MB1-D03'), qty: 1 }], cat, starterOnly).total).toBe(0);
      const plan = cartForDeck({ name: 'x', hero: 'DW1-H01', cards: { 'MB1-D03': 1, 'MB1-D01': 1 } }, cat, starterOnly);
      expect(plan.unavailable).toEqual([{ card: 'MB1-D03', qty: 1, why: 'exclusive' }]);
      expect(plan.lines).toEqual([{ product: cardProduct('MB1-D01'), qty: 1 }]);
    } finally {
      delete card.exclusive;
    }
  });

  it('asks for nothing when you have the whole deck', () => {
    const sb = Object.values(SETS.DW1.decks!)[0];
    expect(cartForDeck(sb, catalog, starterOnly).lines).toEqual([]);
  });
});

it('formats prices for people', () => {
  expect(formatPrice(499)).toBe('$4.99');
  expect(formatPrice(0)).toBe('$0.00');
});
