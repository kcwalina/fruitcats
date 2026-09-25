// The Store's data on this device (docs/store-plan.md): whether the Store is open to this account, its catalog, the
// cards the account bought, and the cart. The Fruitcats API decides all of it; this keeps an offline copy per account,
// so bought cards are still yours in the deck builder without a connection. Nothing here grants a card: only an
// order the API accepted does, and the copy here is replaced by what the API says each time it answers.
//
// There are no payments yet. A tester's "test order" goes through the API like a real one would, and brings the cards
// without taking any money (store.ts in apps/api).

import { SETS, registerSet } from '@fruitcats/engine';
import {
  cartForDeck, collectionOf, priceCart,
  type Catalog, type CartLine, type Quote, type PricedLine,
} from '@fruitcats/store';
import { CONTENT } from '../../../content';
import { API } from './api';
import { session, token } from './auth';
import { STORE } from './flags';

/** open: this account may use the Store. private: it's in a test that this account isn't part of. */
export type Access = 'open' | 'private' | 'unknown';

export interface Order { id: string; status: string; createdAt: string; total: number; currency: string; lines: PricedLine[]; grants: Record<string, number> }

interface Saved {
  access: Access;
  catalog: Catalog | null;
  /** Card id → copies the account bought. */
  owned: Record<string, number>;
  orders: Order[];
  testCheckout: boolean;
}

const EMPTY: Saved = { access: 'unknown', catalog: null, owned: {}, orders: [], testCheckout: false };
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
/** Copies of a card this account bought (collection.ts adds the starter decks). */
export const purchased = (id: string): number => load().saved.owned[id] ?? 0;
/** What the account owns, starter decks included, as the Store counts it. */
export const ownedNow = () => collectionOf(load().saved.owned);

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> } | null> {
  const t = await token();
  if (!t) return null;
  try {
    const r = await fetch(`${API}${path}`, {
      method, headers: { Authorization: `Bearer ${t}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  } catch {
    return null;   // offline
  }
}

/** Ask the API what this account may see and owns. Offline, what's saved stays. */
export async function refreshStore(): Promise<Access> {
  if (!STORE || !session()) return 'unknown';
  const r = await call('GET', '/v1/store');
  const c = load() as NonNullable<typeof cache>;
  if (!r || !cache || cache.user !== session()?.userId) return c.saved.access;
  if (r.status === 403) cache.saved = { ...EMPTY, access: 'private' };
  else if (r.status === 200) {
    const d = r.data as unknown as Omit<Saved, 'access'>;
    cache.saved = { access: 'open', catalog: d.catalog, owned: d.owned ?? {}, orders: d.orders ?? [], testCheckout: !!d.testCheckout };
    ensureSets(d.catalog?.sets ?? []);
  }
  save();
  return cache.saved.access;
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

/** Swap singles in the cart for a deck that brings them: singles the deck covers leave the cart, the rest stay. */
export function swapForDeck(product: string) {
  if (catalog()?.products[product]?.kind !== 'deck') return;
  if (!inCart(product)) addToCart(product, 1);
  const q = localQuote();
  if (q) setCart(q.lines.filter((l) => l.qty > 0 || l.product === product).map((l) => ({ product: l.product, qty: l.product === product ? 1 : l.qty })));
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
export async function placeTestOrder(total: number, orderId: string = crypto.randomUUID()): Promise<OrderResult> {
  const r = await call('POST', '/v1/store/test-checkout', { orderId, cart: cartLines(), total });
  if (!r) return { ok: false, why: 'offline', message: 'You seem to be offline. Nothing was ordered; try again when you’re connected.' };
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

const REFUSALS: Record<string, string> = {
  below_minimum: 'This order is under the minimum. Nothing was ordered.',
  nothing_to_buy: 'You already have everything in this cart. Nothing was ordered.',
  no_test_checkout: 'Test orders are switched off. Nothing was ordered.',
  store_private: 'The Store isn’t open to this account. Nothing was ordered.',
};

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
