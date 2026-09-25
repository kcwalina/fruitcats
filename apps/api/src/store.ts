// The Store's server side (docs/store-plan.md): the catalog, prices worked out here rather than trusted from the game,
// what each account owns, checkout through Paddle, and test checkouts. The server is the only source of truth for
// ownership; the game never grants itself anything.
//
//   GET  /v1/store                    the catalog, what you own, your orders, and how to pay   (403 store_private)
//   POST /v1/store/quote              { cart }  →  the cart priced for you
//   POST /v1/store/checkout           { orderId, cart, total }  →  a pending order and Paddle's transaction to pay it
//   POST /v1/store/confirm            { orderId }  →  the order, after asking Paddle (back from the payment window)
//   POST /v1/store/test-checkout      { orderId, cart, total }  →  a test order; grants the cards, charges nothing
//   POST /v1/store/test-reset         forget your test orders, and the cards they brought
//   POST /v1/webhooks/paddle          Paddle's signed events (paddleWebhook, not signed in)
//
// Who may see it, from app settings:
//   STORE          off (the default) | testers | preview | open
//                  preview: every signed-in account may look around (catalog and prices), but nobody can buy: no
//                  checkout of any kind, and test orders count for nothing
//   STORE_TESTERS  account ids, comma-separated, who may see it while STORE=testers. "*" (any account) only works in
//                  a local API (LOCAL_DATA), never on Azure.
//   STORE_TEST_CHECKOUT   on: testers may check out without paying. Must be off once real payments open.
//   STORE_SETS     the sets on sale, comma-separated (default: every set the API knows, starter sets aside)
//   STORE_PAYMENTS and the PADDLE_ settings: see paddle.ts. Paying is for testers (STORE=testers) or everyone
//                  (STORE=open), never in preview.
//
// How a purchase can't be lost or granted twice (store-plan.md, Requirements for the payment work):
//   1. Checkout saves a pending order under our order id, then asks Paddle for a transaction that names it (custom
//      data), and records which order each transaction pays (paymenttxns). Paddle never takes a price from the game.
//   2. Paddle's signed webhook, the player coming back from the payment window, and the hourly check all end in
//      `settleTransaction`, which asks ledger.ts what the order becomes and writes it. Marking the order paid is the
//      grant: the order and the account's owned total are written in one batch, so both change or neither does.
//   3. The webhook is answered 2xx only after that write, so a crash means Paddle sends it again. Every step can be
//      repeated: a payment or refund already applied changes nothing.
//   4. Anything the rules can't settle raises an alert (`store.alert` in the ops log, level error).
//
// Rows: `orders`, partitioned by account id, one row per order plus the account's owned total ("~owned"): card id →
// copies from every order that counts. It is always rebuilt from the orders when written, so it can't drift, and
// reading what an account owns is one row. Test orders are left out of it: they count only while test checkout is on.

import { cardName, CARDS, SETS } from '@fruitcats/engine';
import {
  MAX_CART_LINES, buildCatalog, collectionOf, priceCart, type CartLine, type PricedLine, type Quote,
} from '@fruitcats/store';
import { held, total, transition, type Event, type OrderState, type Status } from './ledger';
import { log } from './logs';
import {
  isPaid, itemProducts, paddleApi, paddleConfig, verifySignature,
  type Adjustment, type NewItem, type Paddle, type PaddleConfig, type Transaction,
} from './paddle';
import { LOCAL_DATA, table, type BatchStep, type Row } from './tables';

const MODE = process.env.STORE ?? 'off';
const TESTERS = new Set((process.env.STORE_TESTERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const TEST_CHECKOUT = process.env.STORE_TEST_CHECKOUT === 'on';
const orders = table('orders');
/** Paddle transaction id → the account and order it pays. One transaction, one order. */
const txns = table('paymenttxns');
/** Every Paddle event we've handled, once. */
const events = table('webhookevents');

const OWNED = '~owned';
const ACCOUNT = /^[0-9a-f]{32}$/;
const ORDER_ID = /^[a-z0-9-]{8,40}$/;

// ── Payments ─────────────────────────────────────────────────────────────────────────────────────

let payments = paddleConfig();
let paddle: Paddle | null = payments.config ? paddleApi(payments.config) : null;
if (payments.problem) log('ops', 'store.payments_off', { why: payments.problem }, 'error');

/** Tests and drills: a Paddle of their own. */
export function usePaddle(config: PaddleConfig | null, api: Paddle | null) {
  payments = { config };
  paddle = api;
}

/** Local only (npm run api:local -- --fake-paddle): "pay" a transaction in the pretend Paddle, as its window would. */
let fakePay: ((txn: string, delayMs: number) => void) | null = null;
export function useFakePay(pay: (txn: string, delayMs: number) => void) {
  if (LOCAL_DATA) fakePay = pay;
}

/**
 * Something a person must look at: a payment for no order, an order paid twice, a partial refund. Logged as an error,
 * which the owner's alerts pick up, with the ids support needs and never anything a player typed.
 */
function alert(what: string, fields: Record<string, unknown> = {}) {
  log('ops', 'store.alert', { what, ...fields }, 'error');
}

// ── Orders ───────────────────────────────────────────────────────────────────────────────────────

type OrderRow = Row & {
  status: Status; createdAt: string; total: number; currency: string;
  /** JSON: the priced lines, as the player saw them. */
  lines: string;
  /** JSON: card id → copies. */
  grants: string;
  /** JSON: the rest of the order's state (ledger.ts), for paid orders. */
  state?: string;
  txn?: string;
  etag?: string;
};

type OwnedRow = Row & { kind: 'owned'; grants: string; version: number; updatedAt: string; etag?: string };

export interface Order {
  id: string; status: Status; createdAt: string; total: number; currency: string; lines: Quote['lines']; grants: Record<string, number>;
  /** Paddle's transaction, once checkout started (the game opens the payment window with it). */
  txn?: string;
  paidAt?: string;
  receipt?: string;
  /** Card id → copies taken back by a refund. */
  revoked?: Record<string, number>;
}

const toOrder = (r: OrderRow): Order => {
  const s = stateOf(r);
  return {
    id: r.rowKey, status: r.status, createdAt: r.createdAt, total: r.total, currency: r.currency,
    lines: JSON.parse(r.lines), grants: JSON.parse(r.grants),
    ...(s.txn ? { txn: s.txn } : {}), ...(s.paidAt ? { paidAt: s.paidAt } : {}),
    ...(s.receipt ? { receipt: s.receipt } : {}), ...(s.revoked ? { revoked: s.revoked } : {}),
  };
};

function stateOf(r: OrderRow): OrderState {
  const lines = JSON.parse(r.lines) as PricedLine[];
  return {
    status: r.status, grants: JSON.parse(r.grants),
    lineGrants: Object.fromEntries(lines.map((l) => [l.product, l.grants])),
    ...(r.txn ? { txn: r.txn } : {}),
    ...(r.state ? JSON.parse(r.state) : {}),
  };
}

function withState(r: OrderRow, s: OrderState): OrderRow {
  const { status, grants: _g, lineGrants: _l, txn, ...rest } = s;
  return { ...r, status, ...(txn ? { txn } : {}), state: JSON.stringify(rest) };
}

/** Test orders count as owned cards only while testers can place them: never in preview, never once they're off. */
const TEST_ORDERS_COUNT = TEST_CHECKOUT && MODE !== 'preview';

/** May this account see the Store? */
export function storeOpenFor(user: string): boolean {
  if (MODE === 'open' || MODE === 'preview') return true;
  if (MODE !== 'testers') return false;
  return TESTERS.has(user) || (!!LOCAL_DATA && TESTERS.has('*'));
}
const isTester = (user: string) => MODE !== 'off' && MODE !== 'preview' && (TESTERS.has(user) || (!!LOCAL_DATA && TESTERS.has('*')));
/** May this account start a real checkout? */
const canPay = (user: string) => !!payments.config?.checkouts && !!paddle && (MODE === 'open' || isTester(user));

/** The catalog: built once, from the sets the API knows. */
let catalogCache: ReturnType<typeof buildCatalog> | null = null;
export function catalog() {
  const sets = process.env.STORE_SETS?.split(',').map((s) => s.trim()).filter(Boolean) ?? Object.keys(SETS);
  return (catalogCache ??= buildCatalog(sets));
}

async function partition(user: string): Promise<{ list: OrderRow[]; owned: OwnedRow | null }> {
  const rows = await orders.list<OrderRow | OwnedRow>(user);
  const list = rows.filter((r): r is OrderRow => !r.rowKey.startsWith('~')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { list, owned: (rows.find((r) => r.rowKey === OWNED) as OwnedRow | undefined) ?? null };
}

const accountOrders = async (user: string) => (await partition(user)).list.map(toOrder);

/** What the account owns beyond the starter decks: one row, plus test orders while they count. For deck sync and online play too. */
export async function purchasedCards(user: string): Promise<Record<string, number>> {
  if (TEST_ORDERS_COUNT) return total((await partition(user)).list.map(stateOf), true);
  const row = await orders.get<OwnedRow>(user, OWNED);
  return row ? JSON.parse(row.grants) : {};
}

/**
 * Apply one event to one order: read it, ask the ledger, and write the order with the account's owned total in one
 * batch. If another write got there first (two webhooks for the same account at once), read again and retry.
 */
async function apply(user: string, orderId: string, event: Event, context: Record<string, unknown> = {}): Promise<{ order: Order | null; changed: boolean }> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { list, owned } = await partition(user);
    const row = list.find((r) => r.rowKey === orderId);
    if (!row) return { order: null, changed: false };
    const outcome = transition(stateOf(row), event);
    if (outcome.alert) alert(outcome.alert, { userId: user, orderId, ...context });
    if (!outcome.changed) return { order: toOrder(row), changed: false };
    const next = withState(row, outcome.next);
    const states = list.map((r) => (r.rowKey === orderId ? outcome.next : stateOf(r)));
    const grants = JSON.stringify(sortKeys(total(states)));
    // The owned total's version changes only when what's owned does (the game refreshes on a new version).
    const ownedStep: BatchStep[] = (owned ? owned.grants === grants : grants === '{}') ? [] : [(() => {
      const row: OwnedRow = { partitionKey: user, rowKey: OWNED, kind: 'owned', grants, version: (owned?.version ?? 0) + 1, updatedAt: new Date().toISOString() };
      return owned ? { op: 'replace' as const, row, etag: owned.etag! } : { op: 'create' as const, row };
    })()];
    const ok = await orders.batch([{ op: 'replace', row: next, etag: row.etag! }, ...ownedStep]);
    if (!ok) continue;
    if (row.status !== next.status) {
      // The permanent record of what was granted and taken back.
      log('security', `purchase.${next.status}`, {
        userId: user, orderId, txn: outcome.next.txn, total: row.total, currency: row.currency,
        copies: Object.values(held(outcome.next)).reduce((a, b) => a + b, 0), ...context,
      });
    }
    return { order: toOrder(next), changed: true };
  }
  throw new Error(`order ${orderId}: too many writes at once`);
}

// ── Settling what Paddle says ────────────────────────────────────────────────────────────────────

/** Which account and order a Paddle transaction pays: its custom data, checked against our own record. */
async function orderFor(t: Transaction): Promise<{ user: string; orderId: string } | null> {
  const known = await txns.get<Row & { account: string; order: string }>('paddle', t.id);
  const user = t.custom_data?.fruitcats_account, orderId = t.custom_data?.fruitcats_order;
  const named = typeof user === 'string' && ACCOUNT.test(user) && typeof orderId === 'string' && ORDER_ID.test(orderId) ? { user, orderId } : null;
  if (known && named && (known.account !== named.user || known.order !== named.orderId)) {
    alert('transaction names a different order than we recorded', { txn: t.id, userId: known.account, orderId: known.order });
    return { user: known.account, orderId: known.order };
  }
  return known ? { user: known.account, orderId: known.order } : named;
}

/**
 * Apply a Paddle transaction: paid → the order is paid (its cards granted), cancelled → abandoned, anything else
 * waits. Safe to call any number of times, from anywhere.
 */
export async function settleTransaction(t: Transaction, source: string): Promise<{ order: Order | null; changed: boolean }> {
  if (!isPaid(t) && t.status !== 'canceled') return { order: null, changed: false };
  const target = await orderFor(t);
  if (!target) {
    if (isPaid(t)) alert('payment for no order of ours', { txn: t.id, source });
    return { order: null, changed: false };
  }
  const event: Event = isPaid(t)
    ? {
      kind: 'paid', txn: t.id, at: t.billed_at ?? t.updated_at ?? new Date().toISOString(),
      amount: Number(t.details?.totals?.grand_total ?? t.details?.totals?.total ?? 0), currency: t.details?.totals?.currency_code ?? t.currency_code ?? '',
      ...(t.invoice_number ? { receipt: t.invoice_number } : {}), items: itemProducts(t),
    }
    : { kind: 'cancelled' };
  const result = await apply(target.user, target.orderId, event, { txn: t.id, source });
  if (!result.order && isPaid(t)) alert('payment for an order we don’t have', { txn: t.id, userId: target.user, orderId: target.orderId, source });
  return result;
}

/** Apply a Paddle refund or chargeback. The order must be paid first; if we haven't seen the payment yet, ask Paddle. */
export async function settleAdjustment(a: Adjustment, source: string): Promise<void> {
  if (a.action === 'chargeback_warning' || a.action === 'chargeback_reverse') {
    alert(a.action === 'chargeback_warning' ? 'a chargeback is coming' : 'a chargeback was reversed: grant the cards again by hand if right', { txn: a.transaction_id, adjustment: a.id, source });
    return;
  }
  if (a.action !== 'refund' && a.action !== 'chargeback') return;
  if (a.status !== 'approved') {
    log('ops', 'store.adjustment_waiting', { txn: a.transaction_id, adjustment: a.id, status: a.status, source });
    return;
  }
  let target = await orderFor({ id: a.transaction_id, status: 'paid' });
  const order = target ? (await orders.get<OrderRow>(target.user, target.orderId)) : null;
  if (!order || !stateOf(order).paidAt) {
    // The refund came before the payment (events arrive in any order): settle the payment first, from Paddle itself.
    if (!paddle) throw new Error('refund for an unpaid order, and no Paddle to ask');
    const t = await paddle.getTransaction(a.transaction_id);
    await settleTransaction(t, `${source}:before-refund`);
    target = await orderFor(t);
  }
  if (!target) { alert(`${a.action} for no order of ours`, { txn: a.transaction_id, adjustment: a.id, source }); return; }
  await apply(target.user, target.orderId, {
    kind: 'adjustment', id: a.id, action: a.action, txn: a.transaction_id,
    lines: (a.items ?? []).map((i) => ({ item: i.item_id, whole: i.type === 'full' })),
  }, { txn: a.transaction_id, adjustment: a.id, source });
}

/**
 * POST /v1/webhooks/paddle. Checks Paddle's signature over the exact bytes, applies the event, and only then answers
 * 200; anything that fails answers 500, so Paddle sends it again. Each event is recorded once it's applied.
 */
export async function paddleWebhook(signature: string | undefined, raw: Buffer): Promise<Reply> {
  const config = payments.config;
  if (!config) return [503, { error: 'payments_off' }];
  if (!verifySignature(signature, raw, config.webhookSecret)) {
    log('security', 'paddle.bad_signature', {}, 'warning');
    return [401, { error: 'bad_signature' }];
  }
  const event = JSON.parse(raw.toString('utf8')) as { event_id?: string; event_type?: string; data?: unknown };
  const id = event.event_id ?? '', type = event.event_type ?? '';
  if (!/^evt_[a-z0-9]{10,40}$/.test(id)) return [400, { error: 'bad_event' }];
  if (await events.get('paddle', id)) return [200, { ok: true, repeated: true }];
  if (type.startsWith('transaction.')) {
    const sent = event.data as Transaction;
    // Money is confirmed with Paddle's API, not only the message, as the plan requires.
    const t = isPaid(sent) && paddle ? await paddle.getTransaction(sent.id) : sent;
    await settleTransaction(t, 'webhook');
  } else if (type.startsWith('adjustment.')) {
    await settleAdjustment(event.data as Adjustment, 'webhook');
  }
  await events.put({ partitionKey: 'paddle', rowKey: id, type, at: new Date().toISOString() });
  return [200, { ok: true }];
}

/**
 * The regular check (hourly, from server.ts): every paid transaction and refund Paddle has from the last two days is
 * applied again (a webhook we missed lands here), pending orders are asked about, and old unpaid ones are marked
 * abandoned. `deep` also checks every account's owned total against its orders.
 */
export async function reconcile({ now = Date.now(), hours = 48, deep = false } = {}) {
  if (!paddle) return null;
  const since = new Date(now - hours * 3_600_000).toISOString();
  const tally = { transactions: 0, applied: 0, adjustments: 0, pendingChecked: 0, abandoned: 0, ownedFixed: 0 };
  for await (const t of paddle.paidSince(since)) {
    tally.transactions++;
    if ((await settleTransaction(t, 'check')).changed) {
      tally.applied++;
      alert('the check applied a payment the webhook hadn’t', { txn: t.id });
    }
  }
  for await (const a of paddle.adjustmentsSince(since)) { tally.adjustments++; await settleAdjustment(a, 'check'); }
  for (const r of await orders.where<OrderRow>({ status: 'pending' })) {
    const age = now - Date.parse(r.createdAt);
    if (age < 3_600_000) continue;
    tally.pendingChecked++;
    const s = stateOf(r);
    const t = s.txn ? await paddle.getTransaction(s.txn) : null;
    if (t && (isPaid(t) || t.status === 'canceled')) { await settleTransaction(t, 'check'); continue; }
    if (age > 24 * 3_600_000 && (await apply(r.partitionKey, r.rowKey, { kind: 'cancelled' }, { source: 'check' })).changed) tally.abandoned++;
  }
  if (deep) {
    for (const o of await orders.where<OwnedRow>({ kind: 'owned' })) {
      const { list } = await partition(o.partitionKey);
      const want = JSON.stringify(sortKeys(total(list.map(stateOf))));
      if (o.grants === want) continue;
      tally.ownedFixed++;
      alert('an owned total didn’t match its orders; rebuilt', { userId: o.partitionKey });
      await orders.batch([{ op: 'replace', row: { ...o, grants: want, version: o.version + 1, updatedAt: new Date(now).toISOString() }, etag: o.etag! }]);
    }
  }
  log('ops', 'store.checked', tally);
  return tally;
}

const sortKeys = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

// ── Requests ─────────────────────────────────────────────────────────────────────────────────────

function cleanCart(body: unknown): CartLine[] {
  const cart = (body as { cart?: unknown })?.cart;
  if (!Array.isArray(cart)) return [];
  // Only real numbers count: "3" is not a quantity (priceCart then drops anything that isn't a whole number above 0).
  return cart.slice(0, MAX_CART_LINES).map((l) => {
    const { product, qty } = (l ?? {}) as Partial<CartLine>;
    return { product: typeof product === 'string' ? product : '', qty: typeof qty === 'number' ? qty : 0 };
  });
}

/** One checkout at a time per account, so two taps at once can't both be priced against the same collection. */
const busy = new Map<string, Promise<unknown>>();
function oneAtATime<T>(user: string, work: () => Promise<T>): Promise<T> {
  const next = (busy.get(user) ?? Promise.resolve()).catch(() => {}).then(work);
  busy.set(user, next);
  void next.finally(() => { if (busy.get(user) === next) busy.delete(user); });
  return next;
}

/** At most this many new checkouts per account an hour: each one is a transaction in Paddle. */
const CHECKOUTS_PER_HOUR = 20;
const recentCheckouts = new Map<string, number[]>();
function checkoutAllowed(user: string, now = Date.now()): boolean {
  const recent = (recentCheckouts.get(user) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= CHECKOUTS_PER_HOUR) return false;
  recentCheckouts.set(user, [...recent, now]);
  return true;
}

/** How each line reads on Paddle's checkout and receipt. Paddle gets names and prices, never cards. */
function paddleItems(lines: PricedLine[]): NewItem[] {
  const products = catalog().products;
  return lines.filter((l) => l.qty > 0).map((l) => {
    const p = products[l.product];
    if (p?.kind === 'deck') {
      const copies = Object.values(l.grants).reduce((a, b) => a + b, 0);
      return { product: l.product, name: `${p.name} deck`, description: `Fruitcats deck: ${copies} cards for your Via Mochi account`, unit: l.unit, qty: 1 };
    }
    const id = p?.kind === 'card' ? p.card : l.product.replace(/^card:/, '');
    const kind = CARDS[id]?.signature ? 'Signature card' : 'card';
    return { product: l.product, name: `${cardName(id)} (${kind})`, description: `Fruitcats ${kind} for your Via Mochi account`, unit: l.unit, qty: l.qty };
  });
}

/** Create Paddle's transaction for a pending order and record which order it pays. */
async function startPayment(user: string, row: OrderRow): Promise<string> {
  const t = await paddle!.createTransaction({ order: row.rowKey, account: user, currency: row.currency, items: paddleItems(JSON.parse(row.lines)) });
  await txns.add({ partitionKey: 'paddle', rowKey: t.id, account: user, order: row.rowKey, createdAt: new Date().toISOString() });
  await apply(user, row.rowKey, { kind: 'checkout', txn: t.id });
  log('ops', 'store.checkout', { userId: user, orderId: row.rowKey, txn: t.id, total: row.total });
  return t.id;
}

export type Reply = [status: number, body: unknown];

/** The price check both checkouts share: the server's own price, and the total the player agreed to. */
function priceFor(cart: CartLine[], owned: Record<string, number>, agreed: unknown): Reply | Quote {
  const quote = priceCart(cart, catalog(), collectionOf(owned));
  // The player agreed to a total. If it's changed since (a price, or cards bought elsewhere), they see the new one first.
  if (quote.total !== agreed) return [409, { error: 'price_changed', quote }];
  if (!quote.canBuy) return [400, { error: quote.total ? 'below_minimum' : 'nothing_to_buy', quote }];
  return quote;
}

const newRow = (user: string, orderId: string, status: Status, quote: Quote): OrderRow => ({
  partitionKey: user, rowKey: orderId, status, createdAt: new Date().toISOString(),
  total: quote.total, currency: quote.currency,
  lines: JSON.stringify(quote.lines.filter((l) => l.qty > 0)), grants: JSON.stringify(quote.grants),
});

export async function storeRequest(user: string, method: string, path: string, body: () => Promise<unknown>): Promise<Reply> {
  if (!storeOpenFor(user)) return [403, { error: 'store_private' }];

  if (path === '/v1/store' && method === 'GET') {
    const { list, owned } = await partition(user);
    const shown = list.filter((o) => o.status !== 'test' || TEST_ORDERS_COUNT).map(toOrder);
    return [200, {
      catalog: catalog(), owned: total(list.map(stateOf), TEST_ORDERS_COUNT), ownedVersion: owned?.version ?? 0, orders: shown,
      testCheckout: TEST_CHECKOUT && isTester(user),
      ...(canPay(user) ? { payments: { provider: 'paddle', environment: payments.config!.environment, clientToken: payments.config!.clientToken, taxIncluded: payments.config!.taxMode === 'internal' } } : {}),
    }];
  }

  if (path === '/v1/store/quote' && method === 'POST') {
    const cart = cleanCart(await body());
    return [200, priceCart(cart, catalog(), collectionOf(await purchasedCards(user)))];
  }

  if (path === '/v1/store/checkout' && method === 'POST') {
    if (!canPay(user)) return [403, { error: 'payments_off' }];
    const sent = await body() as { orderId?: unknown; total?: unknown };
    const orderId = typeof sent?.orderId === 'string' && ORDER_ID.test(sent.orderId) ? sent.orderId : null;
    if (!orderId) return [400, { error: 'bad_order_id' }];
    const cart = cleanCart(sent);
    return oneAtATime(user, async (): Promise<Reply> => {
      const existing = await orders.get<OrderRow>(user, orderId);
      if (existing) {
        // The same order again (a retry, or the payment window opened a second time): the same transaction, never a
        // second order. An order already paid is just answered.
        const s = stateOf(existing);
        if (s.paidAt || existing.status === 'test' || existing.status === 'granted') return [200, { order: toOrder(existing), owned: await purchasedCards(user) }];
        if (existing.total !== sent.total) return [409, { error: 'order_exists' }];
        try {
          const txn = s.txn ?? await startPayment(user, existing);
          return [200, { order: { ...toOrder(existing), txn }, transactionId: txn }];
        } catch (e) {
          log('ops', 'store.paddle_failed', { userId: user, orderId, message: (e as Error).message }, 'error');
          return [502, { error: 'payment_unavailable' }];
        }
      }
      if (!checkoutAllowed(user)) return [429, { error: 'too_many_checkouts' }];
      const priced = priceFor(cart, await purchasedCards(user), sent.total);
      if (Array.isArray(priced)) return priced;
      const row = newRow(user, orderId, 'pending', priced);
      if (!await orders.add(row)) return [409, { error: 'order_exists' }];
      try {
        const txn = await startPayment(user, row);
        return [200, { order: { ...toOrder(row), txn }, transactionId: txn }];
      } catch (e) {
        // The pending order stays; the same order id tried again asks Paddle again.
        log('ops', 'store.paddle_failed', { userId: user, orderId, message: (e as Error).message }, 'error');
        return [502, { error: 'payment_unavailable' }];
      }
    });
  }

  if (path === '/v1/store/confirm' && method === 'POST') {
    const sent = await body() as { orderId?: unknown };
    const orderId = typeof sent?.orderId === 'string' && ORDER_ID.test(sent.orderId) ? sent.orderId : null;
    if (!orderId) return [400, { error: 'bad_order_id' }];
    const row = await orders.get<OrderRow>(user, orderId);
    if (!row) return [404, { error: 'no_order' }];
    const s = stateOf(row);
    let order = toOrder(row);
    if (!s.paidAt && s.txn && paddle) {
      try {
        // The player is back from the payment window: ask Paddle rather than wait for its webhook.
        const t = await paddle.getTransaction(s.txn);
        const settled = await settleTransaction(t, 'confirm');
        if (settled.order) order = settled.order;
      } catch (e) {
        log('ops', 'store.confirm_failed', { userId: user, orderId, message: (e as Error).message }, 'warning');
      }
    }
    return [200, { order, owned: await purchasedCards(user) }];
  }

  if (path === '/v1/store/fake-pay' && method === 'POST' && fakePay) {
    const sent = await body() as { txn?: unknown; delayMs?: unknown };
    if (typeof sent?.txn !== 'string') return [400, { error: 'bad_txn' }];
    fakePay(sent.txn, typeof sent.delayMs === 'number' ? Math.min(sent.delayMs, 120_000) : 0);
    return [200, { ok: true }];
  }

  if (path === '/v1/store/test-checkout' && method === 'POST') {
    if (!TEST_CHECKOUT || !isTester(user)) return [403, { error: 'no_test_checkout' }];
    const sent = await body() as { orderId?: unknown; total?: unknown };
    const orderId = typeof sent?.orderId === 'string' && ORDER_ID.test(sent.orderId) ? sent.orderId : null;
    if (!orderId) return [400, { error: 'bad_order_id' }];
    const cart = cleanCart(sent);
    return oneAtATime(user, async (): Promise<Reply> => {
      // The same order sent twice (a double tap, a retry after a lost reply) is answered, not bought again.
      const existing = await orders.get<OrderRow>(user, orderId);
      if (existing) return [200, { order: toOrder(existing), owned: await purchasedCards(user), repeated: true }];
      const priced = priceFor(cart, await purchasedCards(user), sent.total);
      if (Array.isArray(priced)) return priced;
      const row = newRow(user, orderId, 'test', priced);
      if (!await orders.add(row)) return [409, { error: 'order_exists' }];
      log('ops', 'store.test_order', { userId: user, orderId, total: priced.total, copies: Object.values(priced.grants).reduce((a, b) => a + b, 0) });
      return [200, { order: toOrder(row), owned: await purchasedCards(user) }];
    });
  }

  if (path === '/v1/store/test-reset' && method === 'POST') {
    if (!TEST_CHECKOUT || !isTester(user)) return [403, { error: 'no_test_checkout' }];
    return oneAtATime(user, async (): Promise<Reply> => {
      const list = await accountOrders(user);
      for (const o of list) if (o.status === 'test') await orders.remove(user, o.id);
      log('ops', 'store.test_reset', { userId: user, orders: list.filter((o) => o.status === 'test').length });
      return [200, { owned: await purchasedCards(user) }];
    });
  }

  return [404, { error: 'not_found' }];
}

/** For "Export my data". */
export const exportOrders = (user: string) => accountOrders(user);

/**
 * Deleting an account. Test orders and unpaid checkouts go with it. Orders that took money (paid, refunded, charged
 * back) are business records and stay, under the account id, which then points to no one (privacy-policy.md, How long
 * we keep it). A refund arriving later still lands on them.
 */
export async function eraseOrders(user: string) {
  const { list } = await partition(user);
  let kept = 0;
  for (const r of list) {
    if (r.status === 'test' || r.status === 'pending' || r.status === 'abandoned') await orders.remove(user, r.rowKey);
    else kept++;
  }
  if (kept) log('security', 'store.orders_kept_on_delete', { userId: user, orders: kept });
}
