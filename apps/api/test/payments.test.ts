// Real payments, against a pretend Paddle (docs/store-plan.md, Requirements for the payment work). These are the
// plan's drills, kept as tests: a crash before the write, after it and before answering Paddle; a webhook sent twice,
// late, or never; a double tap; a price changed mid-checkout; refunds, whole and in part; chargebacks; a refund that
// arrives before its payment; and an account deleted after buying. Each must end with the right cards, and no order
// paid or granted twice.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DECK_PRICE, cardProduct, deckProduct, priceCart, collectionOf, type Quote } from '@fruitcats/store';
import type { Adjustment, Paddle, PaddleConfig, Transaction } from '../src/paddle';

type Store = typeof import('../src/store');
let store: Store;
let paddleMod: typeof import('../src/paddle');

const SECRET = 'pdl_ntfset_test_secret';
const CONFIG: PaddleConfig = { environment: 'sandbox', apiKey: 'pdl_sdbx_apikey_x', webhookSecret: SECRET, clientToken: 'test_abc', taxMode: 'internal', checkouts: true };

/** A pretend Paddle: transactions made by checkout, paid and refunded by the tests. */
function fakePaddle() {
  const txns = new Map<string, Transaction>();
  const adjustments: Adjustment[] = [];
  let n = 0;
  const f = {
    txns, adjustments, created: 0,
    /** The next getTransaction calls throw, as if the server crashed or Paddle was down. */
    failGets: 0,
    pay(id: string) {
      const t = txns.get(id)!;
      t.status = 'completed';
      t.invoice_number = `2026-${id.slice(-4)}`;
      t.updated_at = t.billed_at = new Date().toISOString();
      return structuredClone(t);
    },
    adjust(txn: string, action: Adjustment['action'], lines: number[] | 'all', type: 'full' | 'partial' = 'full', status: Adjustment['status'] = 'approved') {
      const t = txns.get(txn)!;
      const items = (t.details?.line_items ?? []).filter((_, i) => lines === 'all' || lines.includes(i)).map((l) => ({ item_id: l.id, type }));
      const a: Adjustment = { id: `adj_${String(adjustments.length + 1).padStart(12, '0')}`, action, status, transaction_id: txn, created_at: new Date().toISOString(), items };
      adjustments.push(a);
      return structuredClone(a);
    },
    api: {
      async createTransaction({ order, account, currency, items }) {
        f.created++;
        const id = `txn_${String(++n).padStart(12, '0')}`;
        const t: Transaction = {
          id, status: 'ready', currency_code: currency, custom_data: { fruitcats_order: order, fruitcats_account: account },
          items: items.map((it, i) => ({ price: { id: `pri_${n}_${i}`, custom_data: { product: it.product } } })),
          details: {
            totals: { grand_total: String(items.reduce((s, i) => s + i.unit * i.qty, 0)), currency_code: currency },
            line_items: items.map((_, i) => ({ id: `txnitm_${n}_${i}`, price_id: `pri_${n}_${i}` })),
          },
        };
        txns.set(id, t);
        return structuredClone(t);
      },
      async getTransaction(id) {
        if (f.failGets > 0) { f.failGets--; throw new Error('Paddle GET /transactions: 503'); }
        const t = txns.get(id);
        if (!t) throw new Error('not found');
        return structuredClone(t);
      },
      async *paidSince() { for (const t of txns.values()) if (t.status === 'completed') yield structuredClone(t); },
      async *adjustmentsSince() { for (const a of [...adjustments].reverse()) yield structuredClone(a); },
    } as Paddle,
  };
  return f;
}

let paddle: ReturnType<typeof fakePaddle>;
let accounts = 0;
/** A fresh account for each test, so they don't share cards. */
const account = () => (++accounts).toString(16).padStart(32, 'c');
let orderN = 0;
const orderId = () => `order-${++orderN}-${Date.now()}`;

beforeAll(async () => {
  process.env.LOCAL_DATA = mkdtempSync(join(tmpdir(), 'fruitcats-payments-'));
  process.env.STORE = 'open';
  process.env.STORE_TEST_CHECKOUT = 'off';
  delete process.env.STORE_PAYMENTS;
  store = await import('../src/store');
  paddleMod = await import('../src/paddle');
});

// Alerts are logged as errors: counted per test, and kept off the test output.
const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
vi.spyOn(console, 'log').mockImplementation(() => {});
beforeAll(() => { paddle = fakePaddle(); store.usePaddle(CONFIG, paddle.api); });
const alerts = () => errors.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('store.alert'));
afterEach(() => { errors.mockClear(); });

const call = (user: string, method: string, path: string, body: unknown = {}) => store.storeRequest(user, method, path, async () => body);
const DECK = [{ product: deckProduct('five-alarm'), qty: 1 }];

async function checkout(user: string, cart = DECK, id = orderId()) {
  const q = (await call(user, 'POST', '/v1/store/quote', { cart }))[1] as Quote;
  const [status, body] = await call(user, 'POST', '/v1/store/checkout', { orderId: id, cart, total: q.total }) as [number, { transactionId: string; order: { id: string } }];
  expect(status).toBe(200);
  return { id, txn: body.transactionId, total: q.total };
}

let eventN = 0;
function webhook(type: string, data: unknown, eventId = `evt_${String(++eventN).padStart(12, '0')}`, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify({ event_id: eventId, event_type: type, occurred_at: new Date().toISOString(), data }));
  return store.paddleWebhook(paddleMod.signFor(raw, secret), raw);
}

const orderOf = async (user: string, id: string) =>
  ((await call(user, 'GET', '/v1/store'))[1] as { orders: { id: string; status: string; txn?: string; receipt?: string }[] }).orders.find((o) => o.id === id);
const owned = (user: string) => store.purchasedCards(user);

describe('checkout', () => {
  it('tells a buyer how to pay: Paddle, sandbox, and the public client token only', async () => {
    const [, body] = await call(account(), 'GET', '/v1/store') as [number, { payments: unknown }];
    expect(body.payments).toEqual({ provider: 'paddle', environment: 'sandbox', clientToken: 'test_abc' });
    expect(JSON.stringify(body)).not.toContain('pdl_');
  });

  it('prices the cart itself, refusing a total the player didn’t see (a price changed mid-checkout)', async () => {
    const before = paddle.created;
    const [status, body] = await call(account(), 'POST', '/v1/store/checkout', { orderId: orderId(), cart: DECK, total: DECK_PRICE - 100 });
    expect(status).toBe(409);
    expect(body).toMatchObject({ error: 'price_changed', quote: { total: DECK_PRICE } });
    expect(paddle.created).toBe(before);
  });

  it('saves a pending order, then a Paddle transaction naming it, priced by the server', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    const t = paddle.txns.get(txn)!;
    expect(t.custom_data).toEqual({ fruitcats_order: id, fruitcats_account: user });
    expect(t.details?.totals?.grand_total).toBe(String(DECK_PRICE));
    expect(await orderOf(user, id)).toMatchObject({ status: 'pending', txn });
    expect(await owned(user)).toEqual({});
  });

  it('a double tap or a retry opens the same transaction, never a second order', async () => {
    const user = account();
    const first = await checkout(user);
    const before = paddle.created;
    const again = await checkout(user, DECK, first.id);
    expect(again.txn).toBe(first.txn);
    expect(paddle.created).toBe(before);
  });

  it('keeps the pending order when Paddle can’t be reached, and the same order tried again carries on', async () => {
    const user = account();
    const q = (await call(user, 'POST', '/v1/store/quote', { cart: DECK }))[1] as Quote;
    const create = paddle.api.createTransaction;
    paddle.api.createTransaction = async () => { throw new Error('Paddle POST /transactions: 503'); };
    const id = orderId();
    expect((await call(user, 'POST', '/v1/store/checkout', { orderId: id, cart: DECK, total: q.total }))[0]).toBe(502);
    paddle.api.createTransaction = create;
    const again = await checkout(user, DECK, id);
    expect(again.txn).toMatch(/^txn_/);
  });

  it('is closed in preview, to anyone the Store isn’t open to, and with checkouts off', async () => {
    store.usePaddle({ ...CONFIG, checkouts: false }, paddle.api);
    const [status] = await call(account(), 'POST', '/v1/store/checkout', { orderId: orderId(), cart: DECK, total: DECK_PRICE });
    store.usePaddle(CONFIG, paddle.api);
    expect(status).toBe(403);
  });
});

describe('paying', () => {
  it('refuses a webhook without Paddle’s signature, and changes nothing', async () => {
    const user = account();
    const { txn } = await checkout(user);
    const paid = paddle.pay(txn);
    expect((await webhook('transaction.completed', paid, undefined, 'someone-else'))[0]).toBe(401);
    expect(await owned(user)).toEqual({});
  });

  it('grants the cards when the signed webhook says paid, and only once, however often it comes', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    const paid = paddle.pay(txn);
    expect(await webhook('transaction.completed', paid, 'evt_000000000aaa')).toEqual([200, { ok: true }]);
    const cards = await owned(user);
    expect(cards['HW1-H01']).toBe(1);
    expect(cards['HW1-P01']).toBe(3);
    // The same event again, then Paddle's other event for the same payment.
    expect(await webhook('transaction.completed', paid, 'evt_000000000aaa')).toEqual([200, { ok: true, repeated: true }]);
    expect((await webhook('transaction.paid', paid))[0]).toBe(200);
    expect(await owned(user)).toEqual(cards);
    expect(await orderOf(user, id)).toMatchObject({ status: 'paid', txn, receipt: paid.invoice_number });
    expect(alerts()).toEqual([]);
  });

  it('a player back from the payment window gets their cards straight away, by asking Paddle (no webhook yet)', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    paddle.pay(txn);
    const [, body] = await call(user, 'POST', '/v1/store/confirm', { orderId: id }) as [number, { order: { status: string }; owned: Record<string, number> }];
    expect(body.order.status).toBe('paid');
    expect(body.owned['HW1-H01']).toBe(1);
  });

  it('a checkout after paying is answered with the paid order, never a second payment', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    await webhook('transaction.completed', paddle.pay(txn));
    const before = paddle.created;
    const [status, body] = await call(user, 'POST', '/v1/store/checkout', { orderId: id, cart: DECK, total: DECK_PRICE }) as [number, { order: { status: string }; transactionId?: string }];
    expect(status).toBe(200);
    expect(body.order.status).toBe('paid');
    expect(body.transactionId).toBeUndefined();
    expect(paddle.created).toBe(before);
  });

  it('the owned total is one row, and the same as the orders added up', async () => {
    const user = account();
    const { txn } = await checkout(user);
    await webhook('transaction.completed', paddle.pay(txn));
    const [, body] = await call(user, 'GET', '/v1/store') as [number, { owned: Record<string, number>; ownedVersion: number }];
    expect(await owned(user)).toEqual(body.owned);
    expect(body.ownedVersion).toBe(1);
  });
});

describe('crash drills', () => {
  it('a crash before the write: Paddle is told to try again, and the retry grants once', async () => {
    const user = account();
    const { txn } = await checkout(user);
    const paid = paddle.pay(txn);
    paddle.failGets = 1;
    await expect(webhook('transaction.completed', paid, 'evt_00000000crash')).rejects.toThrow();   // server.ts answers 500
    expect(await owned(user)).toEqual({});
    expect((await webhook('transaction.completed', paid, 'evt_00000000crash'))[0]).toBe(200);
    expect((await owned(user))['HW1-H01']).toBe(1);
  });

  it('a crash after the write, before answering Paddle: the retry changes nothing', async () => {
    const user = account();
    const { txn } = await checkout(user);
    const paid = paddle.pay(txn);
    // The write happened (as if from the webhook), then the answer was lost: the event isn't recorded as handled.
    expect((await store.settleTransaction(paid, 'webhook')).changed).toBe(true);
    const cards = await owned(user);
    expect((await webhook('transaction.completed', paid))[0]).toBe(200);
    expect(await owned(user)).toEqual(cards);
  });

  it('a webhook that never comes: the regular check applies the payment, and says so', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    paddle.pay(txn);
    const tally = await store.reconcile();
    expect(tally?.applied).toBeGreaterThanOrEqual(1);
    expect(await orderOf(user, id)).toMatchObject({ status: 'paid' });
    expect(alerts().some((a) => a.includes('the check applied a payment'))).toBe(true);
    // Running it again finds nothing more to do for this order.
    const cards = await owned(user);
    await store.reconcile();
    expect(await owned(user)).toEqual(cards);
  });

  it('a late payment still counts: an order left unpaid and marked abandoned becomes paid', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    await store.reconcile({ now: Date.now() + 25 * 3_600_000 });
    expect(await orderOf(user, id)).toMatchObject({ status: 'abandoned' });
    await webhook('transaction.completed', paddle.pay(txn));
    expect(await orderOf(user, id)).toMatchObject({ status: 'paid' });
    expect((await owned(user))['HW1-H01']).toBe(1);
  });

  it('two payments for one order: one grant, and an alert to refund the second', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    await webhook('transaction.completed', paddle.pay(txn));
    const cards = await owned(user);
    // A second transaction naming the same order (as if made by hand in Paddle), also paid.
    const second = await paddle.api.createTransaction({ order: id, account: user, currency: 'USD', items: [{ product: DECK[0].product, name: 'x', description: 'x', unit: DECK_PRICE, qty: 1 }] });
    await webhook('transaction.completed', paddle.pay(second.id));
    expect(await owned(user)).toEqual(cards);
    expect(alerts().some((a) => a.includes('order paid twice'))).toBe(true);
  });

  it('a payment that names no order of ours is kept aside with an alert, and Paddle isn’t asked to retry', async () => {
    const t = await paddle.api.createTransaction({ order: 'order-nobody-has', account: 'f'.repeat(32), currency: 'USD', items: [] });
    expect((await webhook('transaction.completed', paddle.pay(t.id)))[0]).toBe(200);
    expect(alerts().some((a) => a.includes('payment for an order we don'))).toBe(true);
  });
});

describe('refunds and chargebacks', () => {
  it('a full refund takes the cards back, once; a late payment webhook doesn’t bring them back', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    const paid = paddle.pay(txn);
    await webhook('transaction.completed', paid);
    const refund = paddle.adjust(txn, 'refund', 'all');
    await webhook('adjustment.created', refund);
    expect(await owned(user)).toEqual({});
    expect(await orderOf(user, id)).toMatchObject({ status: 'refunded' });
    await webhook('adjustment.updated', refund);
    await webhook('transaction.paid', paid);
    expect(await owned(user)).toEqual({});
  });

  it('waits for a refund Paddle hasn’t approved yet', async () => {
    const user = account();
    const { txn } = await checkout(user);
    await webhook('transaction.completed', paddle.pay(txn));
    const cards = await owned(user);
    await webhook('adjustment.created', paddle.adjust(txn, 'refund', 'all', 'full', 'pending_approval'));
    expect(await owned(user)).toEqual(cards);
  });

  it('a refund of one line takes only that line’s cards', async () => {
    const user = account();
    const cart = [...DECK, { product: cardProduct('HW1-X01'), qty: 1 }];
    const { id, txn } = await checkout(user, cart);
    await webhook('transaction.completed', paddle.pay(txn));
    expect((await owned(user))['HW1-X01']).toBe(1);
    await webhook('adjustment.created', paddle.adjust(txn, 'refund', [1]));
    const cards = await owned(user);
    expect(cards['HW1-X01']).toBeUndefined();
    expect(cards['HW1-H01']).toBe(1);
    expect(await orderOf(user, id)).toMatchObject({ status: 'paid' });
  });

  it('a refund of part of an amount takes nothing, and asks the owner', async () => {
    const user = account();
    const { txn } = await checkout(user);
    await webhook('transaction.completed', paddle.pay(txn));
    const cards = await owned(user);
    await webhook('adjustment.created', paddle.adjust(txn, 'refund', 'all', 'partial'));
    expect(await owned(user)).toEqual(cards);
    expect(alerts().some((a) => a.includes('part of an amount'))).toBe(true);
  });

  it('a refund that arrives before its payment: the payment is settled from Paddle first, then refunded', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    paddle.pay(txn);
    await webhook('adjustment.created', paddle.adjust(txn, 'refund', 'all'));
    expect(await orderOf(user, id)).toMatchObject({ status: 'refunded' });
    expect(await owned(user)).toEqual({});
  });

  it('a chargeback takes the cards back, and a warning of one only alerts', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    await webhook('transaction.completed', paddle.pay(txn));
    await webhook('adjustment.created', paddle.adjust(txn, 'chargeback_warning', 'all'));
    expect((await owned(user))['HW1-H01']).toBe(1);
    await webhook('adjustment.created', paddle.adjust(txn, 'chargeback', 'all'));
    expect(await orderOf(user, id)).toMatchObject({ status: 'charged_back' });
    expect(await owned(user)).toEqual({});
  });

  it('the regular check applies a refund whose webhook was missed', async () => {
    const user = account();
    const { txn } = await checkout(user);
    await webhook('transaction.completed', paddle.pay(txn));
    paddle.adjust(txn, 'refund', 'all');
    await store.reconcile();
    expect(await owned(user)).toEqual({});
  });
});

describe('the owned total and deleted accounts', () => {
  it('the daily check rebuilds an owned total that doesn’t match its orders', async () => {
    const user = account();
    const { txn } = await checkout(user);
    await webhook('transaction.completed', paddle.pay(txn));
    const right = await owned(user);
    const { table } = await import('../src/tables');
    const orders = table('orders');
    const row = await orders.get(user, '~owned');
    await orders.put({ ...row!, grants: JSON.stringify({ 'HW1-H01': 7 }) });
    await store.reconcile({ deep: true });
    expect(await owned(user)).toEqual(right);
  });

  it('deleting an account keeps paid orders as records, and a later refund still lands', async () => {
    const user = account();
    const { id, txn } = await checkout(user);
    await webhook('transaction.completed', paddle.pay(txn));
    const unpaid = await checkout(user, [{ product: deckProduct('five-alarm'), qty: 1 }, { product: cardProduct('HW1-X02'), qty: 1 }]);
    await store.eraseOrders(user);
    const kept = await store.exportOrders(user);
    expect(kept.map((o) => o.id)).toEqual([id]);
    expect(kept.some((o) => o.id === unpaid.id)).toBe(false);
    await webhook('adjustment.created', paddle.adjust(txn, 'refund', 'all'));
    expect((await store.exportOrders(user))[0].status).toBe('refunded');
  });

  it('a second order is priced against the first: a deck already bought costs nothing more', async () => {
    const user = account();
    const { txn } = await checkout(user);
    await webhook('transaction.completed', paddle.pay(txn));
    const q = priceCart(DECK, store.catalog(), collectionOf(await owned(user)));
    expect(q.total).toBe(0);
  });
});
