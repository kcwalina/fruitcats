// The Store's server side (docs/store-plan.md): the catalog, prices worked out here rather than trusted from the game,
// what each account owns, and test checkouts. There are no payments yet: a test checkout grants the cards without
// taking any money, so testers can try the whole experience. The server is the only source of truth for ownership;
// the game never grants itself anything.
//
//   GET  /v1/store                    the catalog, what you own, your orders   (403 store_private if you may not see it)
//   POST /v1/store/quote              { cart }  →  the cart priced for you
//   POST /v1/store/test-checkout      { orderId, cart, total }  →  the order; grants the cards, charges nothing
//   POST /v1/store/test-reset         forget your test orders, and the cards they brought
//
// Who may see it, from app settings:
//   STORE          off (the default) | testers | open
//   STORE_TESTERS  account ids, comma-separated, who may see it while STORE=testers. "*" (any account) only works in
//                  a local API (LOCAL_DATA), never on Azure.
//   STORE_TEST_CHECKOUT   on: testers may check out without paying. Must be off once real payments exist.
//   STORE_SETS     the sets on sale, comma-separated (default: every set the API knows, starter sets aside)
//
// What an account owns is worked out from its orders: the starter decks, plus the cards of every order that counts
// (a test order now; a paid one later). So an order that is refunded or reset takes its cards with it, and there is
// no second tally that could drift.

import { SETS } from '@fruitcats/engine';
import { MAX_CART_LINES, buildCatalog, collectionOf, priceCart, type CartLine, type Quote } from '@fruitcats/store';
import { log } from './logs';
import { LOCAL_DATA, table } from './tables';

const MODE = process.env.STORE ?? 'off';
const TESTERS = new Set((process.env.STORE_TESTERS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const TEST_CHECKOUT = process.env.STORE_TEST_CHECKOUT === 'on';
const orders = table('orders');

/** Orders whose cards the account owns. Later: 'paid'. */
const COUNTS = new Set(['test']);

type OrderRow = {
  partitionKey: string; rowKey: string;
  status: string; createdAt: string; total: number; currency: string;
  /** JSON: the priced lines, as the player saw them. */
  lines: string;
  /** JSON: card id → copies. */
  grants: string;
};

export interface Order { id: string; status: string; createdAt: string; total: number; currency: string; lines: Quote['lines']; grants: Record<string, number> }

const toOrder = (r: OrderRow): Order => ({
  id: r.rowKey, status: r.status, createdAt: r.createdAt, total: r.total, currency: r.currency,
  lines: JSON.parse(r.lines), grants: JSON.parse(r.grants),
});

/** May this account see the Store? */
export function storeOpenFor(user: string): boolean {
  if (MODE === 'open') return true;
  if (MODE !== 'testers') return false;
  return TESTERS.has(user) || (!!LOCAL_DATA && TESTERS.has('*'));
}
const isTester = (user: string) => MODE !== 'off' && (TESTERS.has(user) || (!!LOCAL_DATA && TESTERS.has('*')));

/** The catalog: built once, from the sets the API knows. */
let catalogCache: ReturnType<typeof buildCatalog> | null = null;
export function catalog() {
  const sets = process.env.STORE_SETS?.split(',').map((s) => s.trim()).filter(Boolean) ?? Object.keys(SETS);
  return (catalogCache ??= buildCatalog(sets));
}

async function accountOrders(user: string): Promise<Order[]> {
  return (await orders.list<OrderRow>(user)).map(toOrder).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Card id → copies the account's orders brought. */
function grantsOf(list: Order[]): Record<string, number> {
  const grants: Record<string, number> = {};
  for (const o of list) {
    if (!COUNTS.has(o.status)) continue;
    for (const [id, n] of Object.entries(o.grants)) grants[id] = (grants[id] ?? 0) + n;
  }
  return grants;
}

/** What the account owns beyond the starter decks. Also for deck sync and the export. */
export async function purchasedCards(user: string): Promise<Record<string, number>> {
  return grantsOf(await accountOrders(user));
}

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

export type Reply = [status: number, body: unknown];

export async function storeRequest(user: string, method: string, path: string, body: () => Promise<unknown>): Promise<Reply> {
  if (!storeOpenFor(user)) return [403, { error: 'store_private' }];

  if (path === '/v1/store' && method === 'GET') {
    const list = await accountOrders(user);
    return [200, { catalog: catalog(), owned: grantsOf(list), orders: list, testCheckout: TEST_CHECKOUT && isTester(user) }];
  }

  if (path === '/v1/store/quote' && method === 'POST') {
    const cart = cleanCart(await body());
    return [200, priceCart(cart, catalog(), collectionOf(await purchasedCards(user)))];
  }

  if (path === '/v1/store/test-checkout' && method === 'POST') {
    if (!TEST_CHECKOUT || !isTester(user)) return [403, { error: 'no_test_checkout' }];
    const sent = await body() as { orderId?: unknown; total?: unknown };
    const orderId = typeof sent?.orderId === 'string' && /^[a-z0-9-]{8,40}$/.test(sent.orderId) ? sent.orderId : null;
    if (!orderId) return [400, { error: 'bad_order_id' }];
    const cart = cleanCart(sent);
    return oneAtATime(user, async (): Promise<Reply> => {
      // The same order sent twice (a double tap, a retry after a lost reply) is answered, not bought again.
      const existing = await orders.get<OrderRow>(user, orderId);
      if (existing) return [200, { order: toOrder(existing), owned: await purchasedCards(user), repeated: true }];
      const quote = priceCart(cart, catalog(), collectionOf(await purchasedCards(user)));
      // The player agreed to a total. If it's changed since (a price, or cards bought elsewhere), they see the new one first.
      if (quote.total !== sent.total) return [409, { error: 'price_changed', quote }];
      if (!quote.canBuy) return [400, { error: quote.total ? 'below_minimum' : 'nothing_to_buy', quote }];
      const row: OrderRow = {
        partitionKey: user, rowKey: orderId, status: 'test', createdAt: new Date().toISOString(),
        total: quote.total, currency: quote.currency,
        lines: JSON.stringify(quote.lines.filter((l) => l.qty > 0)), grants: JSON.stringify(quote.grants),
      };
      if (!await orders.add(row)) return [409, { error: 'order_exists' }];
      log('ops', 'store.test_order', { userId: user, orderId, total: quote.total, copies: Object.values(quote.grants).reduce((a, b) => a + b, 0) });
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
 * Deleting an account. Test orders go with it. Paid orders will have to be kept for the tax period, with the account
 * id pointing to no one (store-plan.md): decide how when payments arrive, before any exist.
 */
export async function eraseOrders(user: string) {
  for (const o of await accountOrders(user)) {
    if (o.status === 'test') await orders.remove(user, o.id);
    else throw new Error(`order ${o.id} is ${o.status}: paid orders need their own deletion rule first`);
  }
}
