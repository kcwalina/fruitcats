// The Store's money rules. Every number a player pays comes from here, on the server, so each rule has a test.

import { describe, expect, it } from 'vitest';
import { CARDS, DECKS, SETS } from '@fruitcats/engine';
import {
  SIGNATURE_PRICE,
  CARD_PRICES, DECK_PRICE, MINIMUM_ORDER, buildCatalog, cardProduct, cartForDeck, collectionOf, deckPrice, deckProduct,
  deckWith, formatPrice, isLegacySet, maxCopies, missingForDeck, priceCart, soloFoeDecks, starterCollection, whyNotSold, type DeckProduct,
} from '../src/index';

const catalog = buildCatalog(['DW1', 'SB1', 'BP1']);
const starterOnly = collectionOf({});
const picnicClub = catalog.products[deckProduct('picnic-club')] as DeckProduct;
/**
 * The catalog with Lingonberry Ladybug (a common, in the Picnic Club deck) also sold on its own, as a set might sell a
 * common that isn't in a deck: the real sets' singles are all Cats and Hero Cats, one copy each.
 */
const withCommon = { ...catalog, products: { ...catalog.products, [cardProduct('BP1-B01')]: { id: cardProduct('BP1-B01'), kind: 'card' as const, set: 'BP1', price: 49, card: 'BP1-B01' } } };

describe('catalog', () => {
  it('sells a Signature card as its Signature print, at the Signature price, never as a standard copy', () => {
    const signatures = Object.values(catalog.products).filter((p) => p.kind === 'card' && CARDS[p.card].signature);
    expect(signatures.length).toBeGreaterThan(0);
    for (const p of signatures) expect(p.price).toBe(SIGNATURE_PRICE);
    for (const p of Object.values(catalog.products)) if (p.kind === 'card' && !CARDS[p.card].signature) expect(p.price).toBeLessThan(SIGNATURE_PRICE);
  });


  it('never sells the starter set', () => {
    expect(catalog.sets).toEqual(['SB1', 'BP1']);
    expect(Object.values(catalog.products).some((p) => p.set === 'DW1')).toBe(false);
  });

  it('lists the old Starter Box decks for free: a deck names its own price', () => {
    const old = Object.values(catalog.products).filter((p): p is DeckProduct => p.kind === 'deck' && p.set === 'SB1');
    expect(old.map((p) => p.deck)).toEqual(['zest-rush', 'orchard-guard', 'mango-tango']);
    for (const p of old) {
      expect(p.price).toBe(0);
      expect(deckPrice(p, starterOnly)).toBe(0);
      expect(Object.keys(missingForDeck(p, starterOnly)).length).toBeGreaterThan(0);   // free, but it brings cards
      expect(priceCart([{ product: p.id, qty: 1 }], catalog, starterOnly)).toMatchObject({ total: 0, canBuy: false });
    }
  });

  it('sells every deck, and on their own only the cards that come in no deck, priced by rarity', () => {
    expect(picnicClub.price).toBe(DECK_PRICE);
    expect(picnicClub.hero).toBe('BP1-H01');
    const inDeck = new Set([picnicClub.hero, ...Object.keys(picnicClub.cards)]);
    for (const c of SETS.BP1.cards) {
      const single = catalog.products[cardProduct(c.id)];
      if (inDeck.has(c.id)) expect(single, c.id).toBeUndefined();
      else expect(single?.price, c.id).toBe(CARDS[c.id].signature ? SIGNATURE_PRICE : CARD_PRICES[c.rarity ?? 'Common']);
    }
    expect(Object.values(catalog.products).filter((p) => p.kind === 'card' && p.set === 'BP1').map((p) => p.id))
      .toEqual(['card:BP1-X01', 'card:BP1-X02', 'card:BP1-X03']);
  });

  it('says why a card isn’t sold on its own', () => {
    expect(whyNotSold('BP1-B01', catalog)).toBe('in-deck');
    expect(deckWith('BP1-B01', catalog)?.id).toBe(deckProduct('picnic-club'));
    expect(whyNotSold('DW1-D01', catalog)).toBe('starter');
    expect(whyNotSold('SB1-C01', catalog)).toBe('in-deck');
    expect(whyNotSold('BP1-X01', catalog)).toBeNull();
  });

  it('puts the sets from before the folklore re-theme in the Legacy tab', () => {
    expect(isLegacySet('SB1')).toBe(true);
    expect(isLegacySet('BP1')).toBe(false);
    expect(isLegacySet('DW1')).toBe(false);
  });

  it('never gives the Solo opponent a Legacy deck', () => {
    const legacy = Object.keys(DECKS).filter((key) => isLegacySet(CARDS[DECKS[key].hero].set));
    expect(legacy.length).toBeGreaterThan(0);
    for (const deck of Object.values(DECKS)) {
      const foes = soloFoeDecks(deck.hero);
      expect(foes.length).toBeGreaterThan(0);
      expect(foes.filter((key) => legacy.includes(key))).toEqual([]);
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
    expect(starter['BP1-H01']).toBeUndefined();
    expect(starter['SB1-H01']).toBeUndefined();   // the old Starter Box: taken from the Store now
  });

  it('adds what was bought', () => {
    expect(collectionOf({ 'BP1-B01': 2 })('BP1-B01')).toBe(2);
    expect(collectionOf({ 'BP1-B01': 2 })('BP1-B02')).toBe(0);
  });
});

describe('deck prices: never pay twice', () => {
  it('costs the full price when you have none of its cards', () => {
    expect(deckPrice(picnicClub, starterOnly)).toBe(DECK_PRICE);
  });

  it('brings every copy you are missing, but no starter cards you already have', () => {
    const brings = missingForDeck(picnicClub, starterOnly);
    expect(brings['BP1-H01']).toBe(1);
    expect(brings['BP1-B01']).toBe(3);
    const gardens = picnicClub.cards['SB1-G01'];
    expect(missingForDeck(picnicClub, collectionOf({ 'SB1-G01': gardens }))['SB1-G01']).toBeUndefined();
  });

  it('drops by the share of the cards you already own', () => {
    const half = collectionOf({ 'BP1-B01': 3, 'BP1-B02': 3, 'BP1-B03': 3 });
    const price = deckPrice(picnicClub, half);
    expect(price).toBeLessThan(DECK_PRICE);
    expect(price).toBeGreaterThan(0);
    // The three commons are 9 copies at 49¢ of the deck's worth.
    const worth = Object.entries(missingForDeck(picnicClub, () => 0))
      .reduce((s, [id, n]) => s + CARD_PRICES[CARDS[id].rarity!] * n, 0);
    expect(price).toBe(Math.round((DECK_PRICE * (worth - 9 * 49)) / worth));
  });

  it('is free (and not for sale) when you have every card', () => {
    const all = missingForDeck(picnicClub, () => 0);
    expect(deckPrice(picnicClub, collectionOf(all))).toBe(0);
  });

  it('is always cheaper than its cards would be at single prices', () => {
    const singles = Object.entries(missingForDeck(picnicClub, starterOnly)).reduce((s, [id, n]) => s + CARD_PRICES[CARDS[id].rarity!] * n, 0);
    expect(singles).toBeGreaterThan(2 * DECK_PRICE);
  });
});

describe('the cart', () => {
  it('adds up singles', () => {
    const q = priceCart([{ product: cardProduct('BP1-B01'), qty: 2 }, { product: cardProduct('BP1-X02'), qty: 1 }], withCommon, starterOnly);
    expect(q.total).toBe(2 * CARD_PRICES.Common + CARD_PRICES.Legendary);
    expect(q.grants).toEqual({ 'BP1-B01': 2, 'BP1-X02': 1 });
    expect(q.canBuy).toBe(true);
  });

  it('has a minimum order', () => {
    const q = priceCart([{ product: cardProduct('BP1-B01'), qty: 1 }], withCommon, starterOnly);
    expect(q.total).toBeLessThan(MINIMUM_ORDER);
    expect(q.canBuy).toBe(false);
  });

  it('never sells more copies than a deck can use', () => {
    const q = priceCart([{ product: cardProduct('BP1-B01'), qty: 5 }], withCommon, collectionOf({ 'BP1-B01': 1 }));
    expect(q.lines[0].qty).toBe(2);
    expect(q.lines[0].note).toMatch(/Only 2 copies more|Only 2 more/);
    const cat = priceCart([{ product: cardProduct('BP1-X01'), qty: 3 }], catalog, starterOnly);
    expect(CARDS['BP1-X01'].type).toBe('Cat');
    expect(cat.lines[0].qty).toBe(1);
    const hero = priceCart([{ product: cardProduct('BP1-X03'), qty: 2 }], catalog, starterOnly);
    expect(hero.lines[0].qty).toBe(maxCopies('BP1-X03'));
    expect(maxCopies('BP1-X03')).toBe(1);
  });

  it('sells nothing you already have enough of', () => {
    const q = priceCart([{ product: cardProduct('BP1-X01'), qty: 1 }], catalog, collectionOf({ 'BP1-X01': 1 }));
    expect(q.lines[0]).toMatchObject({ qty: 0, amount: 0 });
    expect(q.lines[0].note).toBeTruthy();
    expect(q.canBuy).toBe(false);
  });

  it('counts decks first, so a single the deck brings is not bought twice', () => {
    const q = priceCart([{ product: cardProduct('BP1-B01'), qty: 3 }, { product: deckProduct('picnic-club'), qty: 1 }], withCommon, starterOnly);
    expect(q.lines.map((l) => l.product)).toEqual([cardProduct('BP1-B01'), deckProduct('picnic-club')]);   // the cart's order
    expect(q.lines[0].qty).toBe(0);
    expect(q.lines[0].note).toMatch(/deck in your cart/);
    expect(q.total).toBe(DECK_PRICE);
  });

  it('merges repeated lines and sells one of each deck', () => {
    const q = priceCart([
      { product: deckProduct('picnic-club'), qty: 2 }, { product: cardProduct('BP1-B01'), qty: 1 }, { product: cardProduct('BP1-B01'), qty: 1 },
    ], withCommon, starterOnly);
    expect(q.lines).toHaveLength(2);
    expect(q.lines[0].qty).toBe(1);
    expect(q.lines[1].qty).toBe(0);   // the deck already brings its three
  });

  it('ignores anything that is not a real line, and drops unknown products with a note', () => {
    const q = priceCart([
      { product: 'card:NOPE-1', qty: 1 }, { product: '<script>', qty: 1 }, { product: cardProduct('BP1-B01'), qty: -2 },
      { product: cardProduct('BP1-B01'), qty: 1.5 }, { product: cardProduct('SB1-C01'), qty: 1 },
    ] as never, withCommon, starterOnly);
    expect(q.total).toBe(0);
    expect(q.lines.map((l) => l.product)).toEqual(['card:NOPE-1', cardProduct('SB1-C01')]);
    expect(q.lines.every((l) => l.qty === 0 && l.note)).toBe(true);
  });

  it('prices in whole cents', () => {
    const owned = collectionOf({ 'BP1-B06': 1, 'BP1-H01': 1 });
    const q = priceCart([{ product: deckProduct('picnic-club'), qty: 1 }], catalog, owned);
    expect(Number.isInteger(q.total)).toBe(true);
  });
});

describe('a deck from a code, with cards you don’t have', () => {
  it('becomes the Store deck that brings them, plus the singles sold on their own', () => {
    const deck = { name: 'Berry Mess', hero: 'BP1-H01', cards: { 'BP1-B01': 3, 'BP1-B02': 3, 'BP1-X01': 1, 'DW1-D16': 3 } };
    const owned = collectionOf({ 'BP1-B01': 1 });
    const { lines, decks, unavailable, missing } = cartForDeck(deck, catalog, owned);
    expect(missing).toEqual({ 'BP1-H01': 1, 'BP1-B01': 2, 'BP1-B02': 3, 'BP1-X01': 1 });
    expect(decks).toEqual([{ product: deckProduct('picnic-club'), covers: 6 }]);
    expect(lines).toEqual([{ product: deckProduct('picnic-club'), qty: 1 }, { product: cardProduct('BP1-X01'), qty: 1 }]);
    expect(unavailable).toEqual([]);
    // Buying it all makes the deck complete.
    const q = priceCart(lines, catalog, owned);
    const after = collectionOf(Object.fromEntries(Object.entries(q.grants).map(([id, n]) => [id, n + (id === 'BP1-B01' ? 1 : 0)])));
    expect(missingForDeck(deck, after)).toEqual({});
  });

  it('lists apart what a Store deck can’t bring: more copies than it holds', () => {
    const deck = { name: 'x', hero: 'BP1-H01', cards: { 'BP1-B13': 1, 'BP1-B07': 3 } };   // Picnic Club holds 2 of BP1-B07
    const { lines, unavailable } = cartForDeck(deck, catalog, starterOnly);
    expect(lines).toEqual([{ product: deckProduct('picnic-club'), qty: 1 }]);
    expect(unavailable).toEqual([{ card: 'BP1-B07', qty: 1, why: 'in-deck' }]);
  });

  it('lists cards the Store doesn’t sell apart', () => {
    const deck = { name: 'x', hero: 'DW1-H01', cards: { 'BP1-X01': 1 } };
    expect(cartForDeck(deck, buildCatalog(['SB1']), starterOnly).unavailable).toEqual([{ card: 'BP1-X01', qty: 1, why: 'not-yet' }]);
  });

  it('never sells an exclusive card, and says why', () => {
    const card = CARDS['BP1-X02'];
    card.exclusive = 'promo';
    try {
      const cat = buildCatalog(['BP1']);
      expect(cat.products[cardProduct('BP1-X02')]).toBeUndefined();
      expect(priceCart([{ product: cardProduct('BP1-X02'), qty: 1 }], cat, starterOnly).total).toBe(0);
      const plan = cartForDeck({ name: 'x', hero: 'DW1-H01', cards: { 'BP1-X02': 1, 'BP1-X01': 1 } }, cat, starterOnly);
      expect(plan.unavailable).toEqual([{ card: 'BP1-X02', qty: 1, why: 'exclusive' }]);
      expect(plan.lines).toEqual([{ product: cardProduct('BP1-X01'), qty: 1 }]);
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
