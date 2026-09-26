// The Store's data on this device (docs/store-plan.md): whether the Store is open to this account, its catalog, the
// cards the account bought, and the cart. The Fruitcats API decides all of it; this keeps an offline copy per account,
// so bought cards are still yours in the deck builder without a connection. Nothing here grants a card: only an
// order the API accepted does, and the copy here is replaced by what the API says each time it answers.
//
// Paying: the API saves a pending order and gives back Paddle's transaction for it; Paddle's window takes the payment
// (paddle.ts here); then the API is asked for the order until it's paid, which is when the cards are owned. A tester's
// "test order" instead brings the cards without taking any money (store.ts in apps/api).

import { SETS, registerSet } from '@fruitcats/engine';
import {
  cartForDeck, collectionOf, priceCart,
  type Catalog, type CartLine, type Quote, type PricedLine,
} from '@fruitcats/store';
import { CONTENT } from '../../../content';
import { API } from './api';
import { authedFetch, session } from './auth';
import { STORE } from './flags';
import { apiPolicy } from './net';

/** open: this account may use the Store. private: it's in a test that this account isn't part of. */
export type Access = 'open' | 'private' | 'unknown';

export interface Order {
  id: string; status: string; createdAt: string; total: number; currency: string; lines: PricedLine[]; grants: Record<string, number>;
  txn?: string; paidAt?: string; receipt?: string; revoked?: Record<string, number>;
}

/** How to pay, when the API lets this account buy: Paddle's environment and its public client token. */
export interface Payments { provider: 'paddle'; environment: 'sandbox' | 'live'; clientToken: string; taxIncluded?: boolean }

interface Saved {
  access: Access;
  catalog: Catalog | null;
  /** Card id → copies the account bought. */
  owned: Record<string, number>;
  orders: Order[];
  testCheckout: boolean;
  payments: Payments | null;
  /** Orders this device paid for whose cards haven't been shown yet (the payment was still being confirmed). */
  awaiting: string[];
}

const EMPTY: Saved = { access: 'unknown', catalog: null, owned: {}, orders: [], testCheckout: false, payments: null, awaiting: [] };
const stateKey = (user: string) => `fruitcats-store-${user}`;
const cartKey = (user: string) => `fruitcats-cart-${user}`;

let cache: { user: string; saved: Saved; cart: CartLine[] } | null = null;

function load(): { saved: Saved; cart: CartLine[] } {
  const user = session()?.userId;
  if (!STORE || !user) return { saved: EMPTY, cart: [] };
  if (cache?.user === user) return cache;
  let saved = EMPTY, cart: CartLine[] = [];
  try { saved = { ...EMPTY, ...JSON.parse(localStorage.getItem(stateKey(user)) ?? '{}') }; } catch { /* nothing saved */ }
  try { const c = JSON.parse(localStorage.getItem(cartKey(user)) ?? '[]'); if (Array.isArray(c)) cart = c; } catch { /* nothing saved */ }
  cache = { user, saved, cart };
  ensureSets(saved.catalog?.sets ?? []);
  return cache;
}

function save() {
  if (!cache) return;
  try {
    localStorage.setItem(stateKey(cache.user), JSON.stringify(cache.saved));
    localStorage.setItem(cartKey(cache.user), JSON.stringify(cache.cart));
  } catch { /* private mode: kept until the page closes */ }
}

/**
 * The Store sells sets the public game doesn't load yet (prototypes, before release). Their cards are built into the
 * game but not registered, so the Store registers them for its testers: the cards alone, never their decks (a set's
 * decks would otherwise turn up in Solo for free).
 */
function ensureSets(sets: string[]) {
  for (const set of sets) {
    if (SETS[set]) continue;
    const c = CONTENT.find((x) => x.data.set === set);
    if (c) registerSet({ ...c.data, decks: {} }, c.plugin);
  }
}

// ── What the Store knows ─────────────────────────────────────────────────────────────────────────

export const storeAccess = (): Access => load().saved.access;
export const catalog = (): Catalog | null => load().saved.catalog;
export const orders = (): Order[] => load().saved.orders;
export const testCheckout = (): boolean => load().saved.testCheckout;
/** How to pay, if this account may buy for real. */
export const payments = (): Payments | null => load().saved.payments ?? null;
/** Copies of a card this account bought (collection.ts adds the starter decks). */
export const purchased = (id: string): number => load().saved.owned[id] ?? 0;
/** What the account owns, starter decks included, as the Store counts it. */
export const ownedNow = () => collectionOf(load().saved.owned);

/**
 * Null when the API couldn't be asked or didn't really answer: offline, too slow, or restarting (a 5xx). Callers treat
 * that as "try again", never as the Store's answer: what's saved stays, and an order keeps its id for the retry.
 */
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> } | null> {
  try {
    // Never waits for ever (net.ts). An order is safe even if its answer is lost: the same order id again never
    // buys twice.
    const r = await authedFetch(`${API}${path}`, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, apiPolicy(method));
    if (!r || r.status >= 500) return null;
    return { status: r.status, data: await r.json().catch(() => ({})) };
  } catch {
    return null;   // offline, or no answer in time
  }
}

/** Ask the API what this account may see and owns. Offline, what's saved stays. True when the API answered. */
export async function refreshStore(): Promise<boolean> {
  if (!STORE || !session()) return false;
  const r = await call('GET', '/v1/store');
  load();
  if (!r || !cache || cache.user !== session()?.userId) return false;
  if (r.status === 403) cache.saved = { ...EMPTY, access: 'private' };
  else if (r.status === 200) {
    const d = r.data as unknown as Omit<Saved, 'access' | 'awaiting'>;
    cache.saved = {
      access: 'open', catalog: d.catalog, owned: d.owned ?? {}, orders: d.orders ?? [], testCheckout: !!d.testCheckout,
      payments: d.payments ?? null, awaiting: cache.saved.awaiting ?? [],
    };
    ensureSets(d.catalog?.sets ?? []);
  }
  save();
  return true;
}

// ── The cart ─────────────────────────────────────────────────────────────────────────────────────

export const cartLines = (): CartLine[] => load().cart;
export const cartCount = (): number => load().cart.reduce((n, l) => n + l.qty, 0);
export const inCart = (product: string): number => load().cart.find((l) => l.product === product)?.qty ?? 0;

function setCart(cart: CartLine[]) {
  const c = load();
  if (!cache) return;
  c.cart = cart.filter((l) => l.qty > 0);
  save();
}

export function addToCart(product: string, qty = 1) {
  const cart = [...cartLines()];
  const line = cart.find((l) => l.product === product);
  if (line) line.qty += qty; else cart.push({ product, qty });
  setCart(cart);
}
export function setLineQty(product: string, qty: number) {
  setCart(cartLines().map((l) => (l.product === product ? { ...l, qty: Math.max(0, qty) } : l)));
}
export const removeLine = (product: string) => setCart(cartLines().filter((l) => l.product !== product));
export const clearCart = () => setCart([]);

/** The cart priced on this device, for showing straight away. The API prices it again before any order. */
export function localQuote(): Quote | null {
  const cat = catalog();
  return cat ? priceCart(cartLines(), cat, ownedNow()) : null;
}

/** The cards a deck is missing, as cart lines of singles, plus any Store deck that would be a better deal. */
export function planForDeck(deck: Parameters<typeof cartForDeck>[0]) {
  const cat = catalog();
  return cat ? cartForDeck(deck, cat, ownedNow()) : null;
}

/** Put these lines in the cart, raising any line already there to at least this many (the quote trims extras). */
export function addLinesToCart(lines: CartLine[]) {
  for (const line of lines) {
    const have = inCart(line.product);
    if (!have) addToCart(line.product, line.qty);
    else if (have < line.qty) setLineQty(line.product, line.qty);
  }
}

/**
 * A fresh order id: 32 random hex digits. Not crypto.randomUUID, which browsers only offer on secure pages (a dev
 * server opened from another device on the home network is plain http).
 */
export function newOrderId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Orders ───────────────────────────────────────────────────────────────────────────────────────

/** The API's price for the cart: what the player agrees to before a test order. */
export async function serverQuote(): Promise<Quote | null> {
  const r = await call('POST', '/v1/store/quote', { cart: cartLines() });
  return r?.status === 200 ? r.data as unknown as Quote : null;
}

export type OrderResult =
  | { ok: true; order: Order }
  | { ok: false; why: 'changed'; quote: Quote }
  | { ok: false; why: 'offline' | 'refused'; message: string };

/**
 * Place a test order for exactly `total` cents (the total the player saw and agreed to). The order id is made once
 * per attempt, so a retry after a lost answer can't buy twice.
 */
export async function placeTestOrder(total: number, orderId: string = newOrderId()): Promise<OrderResult> {
  const r = await call('POST', '/v1/store/test-checkout', { orderId, cart: cartLines(), total });
  if (!r) return { ok: false, why: 'offline', message: 'The Store didn’t answer. Please try again in a minute: it picks up this same order, so nothing is ordered twice.' };
  if (r.status === 409 && r.data.quote) return { ok: false, why: 'changed', quote: r.data.quote as Quote };
  if (r.status !== 200) return { ok: false, why: 'refused', message: REFUSALS[String(r.data.error)] ?? 'The Store couldn’t take this order. Nothing was ordered.' };
  const order = r.data.order as Order;
  if (cache) {
    cache.saved.owned = r.data.owned as Record<string, number>;
    if (!cache.saved.orders.some((o) => o.id === order.id)) cache.saved.orders.push(order);
    cache.cart = [];
    save();
  }
  return { ok: true, order };
}

/**
 * Take a free deck (one the Store lists at $0): no cart and no checkout, so it works while buying is off. The API grants
 * its cards; the same order id again is answered, not granted twice.
 */
export async function getFreeDeck(product: string, orderId: string = newOrderId()): Promise<OrderResult> {
  const r = await call('POST', '/v1/store/get', { orderId, product });
  if (!r) return { ok: false, why: 'offline', message: 'The Store didn’t answer. Please try again in a minute.' };
  if (r.status !== 200) return { ok: false, why: 'refused', message: REFUSALS[String(r.data.error)] ?? 'The Store couldn’t give you this deck. Please try again later.' };
  const order = r.data.order as Order;
  if (cache) {
    cache.saved.owned = r.data.owned as Record<string, number>;
    if (!cache.saved.orders.some((o) => o.id === order.id)) cache.saved.orders.push(order);
    save();
  }
  return { ok: true, order };
}

const REFUSALS: Record<string, string> = {
  not_free: 'This deck isn’t free any more.',
  below_minimum: 'This order is under the minimum. Nothing was ordered.',
  nothing_to_buy: 'You already have everything in this cart. Nothing was ordered.',
  no_test_checkout: 'Test orders are switched off. Nothing was ordered.',
  store_private: 'The Store isn’t open to this account. Nothing was ordered.',
  payments_off: 'Buying is switched off right now. Nothing was ordered.',
  payment_unavailable: 'The payment service didn’t answer. Nothing was charged; please try again in a minute.',
  too_many_checkouts: 'Too many orders were started in the last hour. Nothing was charged; please try again later.',
  order_exists: 'This order was already started with a different total. Nothing was charged; please review your cart again.',
};

// ── Paying ───────────────────────────────────────────────────────────────────────────────────────

export type CheckoutResult =
  | { ok: true; order: Order; transactionId?: string }
  | { ok: false; why: 'changed'; quote: Quote }
  | { ok: false; why: 'offline' | 'refused'; message: string };

/**
 * Start paying for exactly `total` cents: the API prices the cart again, saves a pending order under `orderId` and
 * answers with Paddle's transaction. The same id again gives the same transaction (never a second order), and an
 * order already paid comes back without one.
 */
export async function startCheckout(total: number, orderId: string): Promise<CheckoutResult> {
  const r = await call('POST', '/v1/store/checkout', { orderId, cart: cartLines(), total });
  if (!r) return { ok: false, why: 'offline', message: 'The Store didn’t answer. Please try again in a minute: it picks up this same order, so nothing is ordered twice.' };
  if (r.status === 409 && r.data.quote) return { ok: false, why: 'changed', quote: r.data.quote as Quote };
  if (r.status !== 200) return { ok: false, why: 'refused', message: REFUSALS[String(r.data.error)] ?? 'The Store couldn’t start this order. Nothing was ordered.' };
  const order = r.data.order as Order;
  remember(order);
  return { ok: true, order, ...(typeof r.data.transactionId === 'string' ? { transactionId: r.data.transactionId } : {}) };
}

/** Keep this order in the offline copy, as the API described it. */
function remember(order: Order, owned?: Record<string, number>) {
  if (!cache) return;
  cache.saved.orders = [...cache.saved.orders.filter((o) => o.id !== order.id), order];
  if (owned) cache.saved.owned = owned;
  save();
}

/** This device is waiting for the order's payment to be confirmed: show its cards when it is, even after a restart. */
export function awaitOrder(orderId: string) {
  if (!cache || cache.saved.awaiting.includes(orderId)) return;
  cache.saved.awaiting = [...cache.saved.awaiting, orderId];
  cache.cart = [];
  save();
}

/** Ask the API about an order (it asks Paddle). Null offline. A paid order's cards are then in the offline copy. */
export async function confirmOrder(orderId: string): Promise<Order | null> {
  const r = await call('POST', '/v1/store/confirm', { orderId });
  if (r?.status !== 200) return null;
  const order = r.data.order as Order;
  remember(order, r.data.owned as Record<string, number>);
  return order;
}

/** Local only: tell the pretend Paddle (npm run api:local -- --fake-paddle) to pay this transaction. */
export async function fakePay(txn: string, delayMs: number): Promise<boolean> {
  return (await call('POST', '/v1/store/fake-pay', { txn, delayMs }))?.status === 200;
}

/** Orders this device was waiting for that are now paid: their cards are ready to be shown. Each is given once. */
export function takeArrived(): Order[] {
  if (!cache) return [];
  const arrived = cache.saved.orders.filter((o) => cache!.saved.awaiting.includes(o.id) && o.paidAt);
  if (!arrived.length) return [];
  const ids = new Set(arrived.map((o) => o.id));
  cache.saved.awaiting = cache.saved.awaiting.filter((id) => !ids.has(id));
  save();
  return arrived;
}

/** Tester tool: forget this account's test orders and the cards they brought. */
export async function resetTestOrders(): Promise<boolean> {
  const r = await call('POST', '/v1/store/test-reset');
  if (r?.status !== 200 || !cache) return false;
  cache.saved.owned = r.data.owned as Record<string, number>;
  cache.saved.orders = cache.saved.orders.filter((o) => o.status !== 'test');
  save();
  return true;
}

/** Signing out: this device forgets the account's Store copy and cart. */
export function forgetStore() {
  const user = cache?.user ?? session()?.userId;
  cache = null;
  if (!user) return;
  try { localStorage.removeItem(stateKey(user)); localStorage.removeItem(cartKey(user)); } catch { /* private mode */ }
}
