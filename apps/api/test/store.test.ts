// The Store's server side, run against local tables in a temporary folder: who may see it, that prices are the
// server's own, and that an order is granted once, whatever the game sends.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { DECK_PRICE, cardProduct, deckProduct, type Quote } from '@fruitcats/store';

const ALICE = 'a'.repeat(32);   // a tester
const BOB = 'b'.repeat(32);     // not a tester
const CAROL = 'c'.repeat(32);   // a tester who takes the free decks
let storeRequest: typeof import('../src/store').storeRequest;
let hasPaid: typeof import('../src/store').hasPaid;

beforeAll(async () => {
  process.env.LOCAL_DATA = mkdtempSync(join(tmpdir(), 'fruitcats-store-'));
  process.env.STORE = 'testers';
  process.env.STORE_TESTERS = `${ALICE},${CAROL}`;
  process.env.STORE_TEST_CHECKOUT = 'on';
  ({ storeRequest, hasPaid } = await import('../src/store'));
});

const call = (user: string, method: string, path: string, body: unknown = {}) => storeRequest(user, method, path, async () => body);
const quote = async (user: string, cart: unknown) => (await call(user, 'POST', '/v1/store/quote', { cart }))[1] as Quote;
let n = 0;
const orderId = () => `test-order-${++n}-${Date.now()}`;

describe('who may see the Store', () => {
  it('is private to anyone not on the tester list', async () => {
    expect(await call(BOB, 'GET', '/v1/store')).toEqual([403, { error: 'store_private' }]);
    expect((await call(BOB, 'POST', '/v1/store/test-checkout', { orderId: orderId(), cart: [], total: 0 }))[0]).toBe(403);
  });

  it('shows a tester the catalog, what they own and whether test checkout is on', async () => {
    const [status, body] = await call(ALICE, 'GET', '/v1/store') as [number, { catalog: { products: object }; owned: object; testCheckout: boolean }];
    expect(status).toBe(200);
    expect(Object.keys(body.catalog.products)).toContain(deckProduct('five-alarm'));
    expect(body.owned).toEqual({});
    expect(body.testCheckout).toBe(true);
  });
});

describe('test checkout', () => {
  it('prices the cart itself and refuses a total the player didn’t see', async () => {
    const cart = [{ product: deckProduct('five-alarm'), qty: 1 }];
    const [status, body] = await call(ALICE, 'POST', '/v1/store/test-checkout', { orderId: orderId(), cart, total: 1 });
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: 'price_changed', quote: { total: DECK_PRICE } });
  });

  it('refuses an order under the minimum', async () => {
    const cart = [{ product: cardProduct('HW1-X01'), qty: 1 }];
    const q = await quote(ALICE, cart);
    const [status, body] = await call(ALICE, 'POST', '/v1/store/test-checkout', { orderId: orderId(), cart, total: q.total });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'below_minimum' });
  });

  it('grants what was bought, once, even when the same order arrives twice', async () => {
    const cart = [{ product: deckProduct('five-alarm'), qty: 1 }];
    const q = await quote(ALICE, cart);
    const id = orderId();
    const first = await call(ALICE, 'POST', '/v1/store/test-checkout', { orderId: id, cart, total: q.total });
    const again = await call(ALICE, 'POST', '/v1/store/test-checkout', { orderId: id, cart, total: q.total });
    expect(first[0]).toBe(200);
    expect(again).toMatchObject([200, { repeated: true }]);
    const [, store] = await call(ALICE, 'GET', '/v1/store') as [number, { owned: Record<string, number>; orders: unknown[] }];
    expect(store.orders).toHaveLength(1);
    expect(store.owned['HW1-H01']).toBe(1);
    expect(store.owned['HW1-P01']).toBe(3);
  });

  it('then has nothing more to sell of that deck', async () => {
    const q = await quote(ALICE, [{ product: deckProduct('five-alarm'), qty: 1 }, { product: cardProduct('HW1-P01'), qty: 1 }]);
    expect(q.total).toBe(0);
    expect(q.canBuy).toBe(false);
  });

  it('handles two checkouts at once one after the other, so they can’t both sell the last copies', async () => {
    const cart = [{ product: cardProduct('HW1-X02'), qty: 1 }, { product: cardProduct('HW1-X01'), qty: 1 }];
    const q = await quote(ALICE, cart);
    const [a, b] = await Promise.all([
      call(ALICE, 'POST', '/v1/store/test-checkout', { orderId: orderId(), cart, total: q.total }),
      call(ALICE, 'POST', '/v1/store/test-checkout', { orderId: orderId(), cart, total: q.total }),
    ]);
    expect([a[0], b[0]].sort()).toEqual([200, 409]);
    const [, store] = await call(ALICE, 'GET', '/v1/store') as [number, { owned: Record<string, number> }];
    expect(store.owned['HW1-X02']).toBe(1);
  });

  it('can be reset, and the cards go with the orders', async () => {
    const [status, body] = await call(ALICE, 'POST', '/v1/store/test-reset');
    expect(status).toBe(200);
    expect(body).toEqual({ owned: {} });
  });

  it('ignores junk in the cart', async () => {
    const q = await quote(ALICE, [{ product: 'card:HW1-P01', qty: '3' }, { product: { a: 1 }, qty: 1 }, 'x', null]);
    expect(q.total).toBe(0);
    expect(await quote(ALICE, 'not a list')).toMatchObject({ total: 0, lines: [] });
  });
});

describe('free decks (the old Starter Box decks, at $0)', () => {
  const get = (user: string, product: string, id = orderId()) => call(user, 'POST', '/v1/store/get', { orderId: id, product });

  it('never gives away a deck that costs money', async () => {
    expect(await get(CAROL, deckProduct('five-alarm'))).toEqual([400, { error: 'not_free' }]);
    expect(await get(CAROL, cardProduct('HW1-X01'))).toEqual([400, { error: 'not_free' }]);
    expect(await get(CAROL, 'deck:nope')).toEqual([400, { error: 'not_free' }]);
    expect((await call(CAROL, 'GET', '/v1/store'))[1]).toMatchObject({ owned: {} });
  });

  it('is only for accounts the Store is open to', async () => {
    expect(await get(BOB, deckProduct('zest-rush'))).toEqual([403, { error: 'store_private' }]);
  });

  it('gives the deck’s cards once, however often it’s asked, and they stay after a test reset', async () => {
    const id = orderId();
    const first = await get(CAROL, deckProduct('zest-rush'), id);
    const again = await get(CAROL, deckProduct('zest-rush'), id);
    expect(first).toMatchObject([200, { order: { status: 'free', total: 0 } }]);
    expect(again).toMatchObject([200, { repeated: true }]);
    expect(await get(CAROL, deckProduct('zest-rush'))).toMatchObject([400, { error: 'nothing_to_buy' }]);
    await call(CAROL, 'POST', '/v1/store/test-reset');
    const [, store] = await call(CAROL, 'GET', '/v1/store') as [number, { owned: Record<string, number>; orders: unknown[] }];
    expect(store.orders).toHaveLength(1);
    expect(store.owned['SB1-H01']).toBe(1);
    expect(store.owned['SB1-C01']).toBe(3);
  });

  it('doesn’t make the account a paying one', async () => {
    expect(await hasPaid(CAROL)).toBe(false);
  });
});
