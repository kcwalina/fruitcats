// The Store screen (docs/store-plan.md, Store experience): a Decks tab and a Cards tab, a deck's page, the cart, an
// explicit confirmation step and, after an order, the new cards revealed one by one. It's built on the Collection's
// dark gallery (showcase.css) with store.css on top.
//
// No dark patterns: nothing is bought in one tap, there are no timers or "limited" offers, the total is always shown
// before confirming, and a deck never costs you for cards you already have. Paying happens in Paddle's window
// (paddle.ts), opened from the confirmation step; a tester's test order takes no money, and every screen says so.

import './store.css';
import { CARDS, SETS, cardName, type DeckList } from '@fruitcats/engine';
import {
  deckPrice, deckWith, formatPrice, maxCopies, missingForDeck,
  type CardProduct, type DeckProduct, type NotSold, type Quote,
} from '@fruitcats/store';
import { rarity, rarityMark } from './rarity';
import {
  addLinesToCart, addToCart, planForDeck, cartCount, cartLines, catalog, clearCart, inCart, localQuote, ownedNow, placeTestOrder,
  newOrderId, refreshStore, removeLine, resetTestOrders, serverQuote, setLineQty, storeAccess, testCheckout, type Order,
  awaitOrder, confirmOrder, payments, startCheckout, takeArrived,
} from './shop';
import { BUYING } from './flags';
import { payWithPaddle } from './paddle';
import { BASE, artUrl, backButton, cardUrl as standardUrl, esc, famClass, finishUrl } from './ui';

export interface StoreHost {
  render(): void;
  /** Leave the Store for the deck builder (after an order: "Build a deck with them"). */
  openDeckBuilder(): void;
  /** Back to the deck being built, as it was (from a deck's missing cards). */
  backToBuilder(): void;
}

/**
 * missing: the cards a deck (from a code, say) needs that you don't have, as a selection: all picked at first, tap one
 * to leave it out, then "Add to cart" below.
 */
type View = { kind: 'browse' } | { kind: 'deck'; product: string } | { kind: 'card'; product: string } | { kind: 'cart' }
  | { kind: 'missing'; deck: DeckList; plan: NonNullable<ReturnType<typeof planForDeck>>; left: Set<string> };
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary'] as const;

let view: View = { kind: 'browse' };
/** A line under the header after something happened ("Added 3 cards to your cart"). */
let notice = '';
let loading = false;
/** "Add to cart" while buying isn't open yet: the Coming soon message. */
let soon = false;
/**
 * Whether this account can buy: with real payments (Paddle), or a tester's test checkout. Never while BUYING is off
 * (flags.ts): then "Add to cart" always says "Coming soon", whatever the API says.
 */
const canBuy = () => BUYING && (!!payments() || testCheckout());
/** Real money: Paddle takes the payment. Otherwise a tester's test order. */
const paying = () => BUYING && !!payments();

/** The confirmation step, from "Review order" until the order is placed or abandoned. */
let checkout: null | {
  /**
   * pricing → confirm → placing (the API saves the order) → paying (Paddle's window is open) → finishing (Paddle took
   * the money; the API is confirming it) → the reveal. delayed: paid, but not confirmed yet; the cards come later.
   */
  stage: 'pricing' | 'confirm' | 'placing' | 'paying' | 'finishing' | 'delayed' | 'failed';
  quote?: Quote;
  /** The total changed since the player looked: say so above the new one. */
  changedFrom?: number;
  message?: string;
  /** One id per order attempt, so a retry never buys twice. */
  orderId: string;
} = null;
/** After an order: its cards, one at a time, then all together. */
let reveal: null | { cards: string[]; copies: Record<string, number>; index: number; all: boolean } = null;
let resetAsk = false;
/**
 * An order sent without an answer (the connection dropped). It may have gone through, so the next try sends the
 * same id: the API then answers with that order instead of taking a second one.
 */
let unanswered: string | null = null;

// ── Opening ──────────────────────────────────────────────────────────────────────────────────────

/** Open the Store from Home. It shows what it knows at once and asks the API for the latest. */
export function openStore(host: StoreHost) {
  view = { kind: 'browse' };
  notice = '';
  checkout = null;
  reveal = null;
  refresh(host);
}

/** Open the Store on the cards a deck is missing (the deck builder's "Get the missing cards"). */
export function openStoreForDeck(host: StoreHost, deck: DeckList) {
  openStore(host);
  const plan = planForDeck(deck);
  if (plan) view = { kind: 'missing', deck, plan, left: new Set() };
  else notice = 'The Store couldn’t load. Check your connection and try again.';
}

function refresh(host: StoreHost) {
  loading = !catalog();
  void refreshStore().then(() => {
    loading = false;
    // An order paid for earlier whose cards were still on their way: show them now.
    const arrived = takeArrived();
    if (arrived.length && !reveal && !checkout) startReveal(mergeOrders(arrived));
    host.render();
  });
}

/** Several orders' cards, as one reveal. */
function mergeOrders(list: Order[]): Order {
  const grants: Record<string, number> = {};
  for (const o of list) for (const [id, n] of Object.entries(o.grants)) grants[id] = (grants[id] ?? 0) + n;
  return { ...list[0], grants };
}

// ── Clicks: store:<action>:<arg> ─────────────────────────────────────────────────────────────────

export function storeClick(action: string, arg: string, host: StoreHost): void {
  notice = '';
  switch (action) {
    case 'deck': view = { kind: 'deck', product: arg }; break;
    case 'card': view = { kind: 'card', product: arg }; break;
    case 'browse': view = { kind: 'browse' }; break;
    case 'retry': refresh(host); break;
    case 'cart': view = canBuy() ? { kind: 'cart' } : { kind: 'browse' }; break;
    case 'add': {
      if (!canBuy()) { soon = true; break; }
      addToCart(arg, 1);
      const p = catalog()?.products[arg];
      notice = p ? `${p.kind === 'deck' ? p.name : cardName(p.card)} is in your cart.` : '';
      break;
    }
    case 'more': setLineQty(arg, inCart(arg) + 1); break;
    case 'less': setLineQty(arg, inCart(arg) - 1); break;
    case 'remove': removeLine(arg); break;
    case 'empty': clearCart(); break;
    case 'pick':   // a card on the missing-cards page: in or out of the selection
      if (view.kind === 'missing') { if (view.left.has(arg)) view.left.delete(arg); else view.left.add(arg); }
      break;
    case 'pickall': if (view.kind === 'missing') view.left = view.left.size ? new Set() : new Set(view.plan.lines.map((l) => l.product)); break;
    case 'addpicked': {
      if (view.kind !== 'missing') break;
      if (!canBuy()) { soon = true; break; }
      const { left, plan } = view;
      const lines = plan.lines.filter((l) => !left.has(l.product));
      addLinesToCart(lines);
      notice = `Added what “${view.deck.name}” needs to your cart.`;
      view = { kind: 'cart' };
      break;
    }
    case 'builder': host.backToBuilder(); return;
    case 'review': void review(host); return;
    case 'cancel': if (checkout?.stage !== 'paying' && checkout?.stage !== 'finishing') checkout = null; break;
    case 'place': void place(host); return;
    case 'next':
      if (reveal) { if (reveal.index < reveal.cards.length - 1) reveal.index++; else reveal.all = true; }
      break;
    case 'all': if (reveal) reveal.all = true; break;
    case 'done': reveal = null; view = { kind: 'browse' }; break;
    case 'build': reveal = null; host.openDeckBuilder(); return;
    case 'reset': resetAsk = true; break;
    case 'soon': soon = false; break;
    case 'keep': resetAsk = false; break;
    case 'doreset':
      resetAsk = false;
      void resetTestOrders().then((ok) => { notice = ok ? 'Your test purchases were removed.' : 'Couldn’t reset them. Try again.'; host.render(); });
      return;
  }
  host.render();
}

/** Escape: close the topmost thing. True if it did something. */
export function storeEscape(host: StoreHost): boolean {
  if (resetAsk) resetAsk = false;
  else if (checkout && !['placing', 'paying', 'finishing'].includes(checkout.stage)) checkout = null;
  else if (reveal) { if (!reveal.all) reveal.all = true; else reveal = null; }
  else if (view.kind !== 'browse') view = { kind: 'browse' };
  else return false;
  host.render();
  return true;
}

/** Review order: the API prices the cart; the player sees that total and confirms it. */
async function review(host: StoreHost) {
  checkout = { stage: 'pricing', orderId: unanswered ?? newOrderId() };
  host.render();
  const quote = await serverQuote();
  if (!checkout) return;
  checkout = quote
    ? { ...checkout, stage: 'confirm', quote }
    : { ...checkout, stage: 'failed', message: 'The Store couldn’t price your cart. Check your connection and try again.' };
  host.render();
}

async function place(host: StoreHost) {
  if (!checkout?.quote || checkout.stage !== 'confirm') return;
  const agreed = checkout.quote.total;
  checkout = { ...checkout, stage: 'placing' };
  host.render();
  unanswered = checkout.orderId;
  if (paying()) return pay(host, agreed, checkout.orderId);
  const result = await placeTestOrder(agreed, checkout.orderId);
  if (!(!result.ok && result.why === 'offline')) unanswered = null;
  if (result.ok) {
    checkout = null;
    startReveal(result.order);
  } else if (result.why === 'changed') {
    // Never place an order for a total the player didn't see: show the new one, and ask again.
    checkout = { stage: 'confirm', quote: result.quote, changedFrom: agreed, orderId: newOrderId() };
  } else {
    checkout = { ...checkout, stage: 'failed', message: result.message };
  }
  host.render();
}

/**
 * A real order: the API saves it and gives Paddle's transaction; Paddle's window takes the payment; then the API is
 * asked until the order is paid. Closing the window goes back to the confirmation with the same order, so opening it
 * again pays the same transaction, never a second one.
 */
async function pay(host: StoreHost, agreed: number, orderId: string) {
  const fail = (message: string) => { checkout = { ...checkout!, stage: 'failed', message }; host.render(); };
  const started = await startCheckout(agreed, orderId);
  if (!(!started.ok && started.why === 'offline')) unanswered = null;
  if (!started.ok) {
    if (started.why !== 'changed') return fail(started.message);
    checkout = { stage: 'confirm', quote: started.quote, changedFrom: agreed, orderId: newOrderId() };
    host.render();
    return;
  }
  if (started.order.paidAt) { checkout = null; startReveal(started.order); host.render(); return; }
  if (!started.transactionId) return fail('The Store couldn’t start this order. Nothing was charged.');
  checkout = { ...checkout!, stage: 'paying' };
  host.render();
  const how = await payWithPaddle(payments()!, started.transactionId);
  if (how === 'failed') return fail('The payment window couldn’t open. Check your connection and try again. Nothing was charged.');
  if (how === 'closed') {
    // Closed before paying, or so it seems: ask once, in case the payment went through just before.
    const order = await confirmOrder(orderId);
    if (order?.paidAt) { checkout = null; startReveal(order); } else checkout = { ...checkout!, stage: 'confirm', orderId };
    host.render();
    return;
  }
  awaitOrder(orderId);
  checkout = { ...checkout!, stage: 'finishing' };
  host.render();
  // Paddle took the money. The API asks Paddle too, so this is usually one or two tries.
  for (let i = 0; i < 15; i++) {
    const order = await confirmOrder(orderId);
    if (order?.paidAt) {
      takeArrived();
      checkout = null;
      startReveal(order);
      host.render();
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  checkout = { ...checkout!, stage: 'delayed' };
  host.render();
  // Keep asking, less often, for a few minutes: the cards are shown as soon as they arrive while this message is still
  // up. Once it's dismissed, they're shown the next time the Store opens (takeArrived).
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 15_000));
    if (checkout?.stage !== 'delayed' || checkout.orderId !== orderId) return;
    const order = await confirmOrder(orderId);
    if (!order?.paidAt) continue;
    if (checkout?.stage !== 'delayed' || checkout.orderId !== orderId) return;
    takeArrived();
    checkout = null;
    startReveal(order);
    host.render();
    return;
  }
}

function startReveal(order: Order) {
  // Commons first, the rarest last (a Hero Cat last of all): the reveal ends on the best card.
  const cards = Object.keys(order.grants).sort((a, b) =>
    RARITIES.indexOf(rarity(a)) - RARITIES.indexOf(rarity(b)) || (CARDS[a].type === 'Hero Cat' ? 1 : 0) - (CARDS[b].type === 'Hero Cat' ? 1 : 0) || a.localeCompare(b));
  reveal = { cards, copies: order.grants, index: 0, all: false };
  view = { kind: 'browse' };
}

// ── Drawing ──────────────────────────────────────────────────────────────────────────────────────

const price = (cents: number) => formatPrice(cents, catalog()?.currency);
/** On a picture that fails to load: the card back instead of a broken image. */
const FALLBACK = `onerror="this.onerror=null;this.src='${BASE}ui/cardback.webp'"`;
const setName = (set: string) => SETS[set]?.name ?? set;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A shopping bag, for the cart. */
const BAG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.2 12H6.2L5 8z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/></svg>`;

export function renderStore(): string {
  const cat = catalog();
  const access = storeAccess();
  let body: string;
  if (access === 'private') body = renderMessage('The Store is in a private test', 'It opens to everyone later. Your cards and decks are safe in your account meanwhile.');
  else if (!cat) body = loading ? renderMessage('Opening the Store…', '') : renderMessage('The Store couldn’t load', 'Check your connection, then try again.', '<button class="store-btn ghost" data-click="store:retry">Try again</button>');
  else if (view.kind === 'cart') body = renderCart();
  else if (view.kind === 'missing') body = renderMissingCards(view);
  else if (view.kind === 'deck' && cat.products[view.product]?.kind === 'deck') body = renderDeckPage(cat.products[view.product] as DeckProduct);
  else if (view.kind === 'card' && cat.products[view.product]?.kind === 'card') body = renderCardPage(cat.products[view.product] as CardProduct);
  else body = renderShop();

  const count = cartCount();
  const title = view.kind === 'cart' ? 'Your cart' : view.kind === 'missing' ? 'Missing cards' : 'Store';
  const back = view.kind === 'browse' ? backButton()
    : view.kind === 'missing' ? backButton('store:builder', 'Back to your deck') : backButton('store:browse', 'Store');
  // The page scrolls as one: the banner, then the page's content. Bars for buying stay fixed at the bottom.
  return `
  <div class="store-screen" data-keep-scroll="store-${view.kind}">
    <header class="store-banner ${view.kind === 'browse' ? '' : 'slim'}">
      <div class="sb-ground" aria-hidden="true"></div>
      <div class="sb-art" role="img" aria-label="A cat at a market stall"></div>
      <div class="sb-top">
        ${back}
        ${canBuy() ? `<button class="icon-button cart-button ${view.kind === 'cart' ? 'on' : ''}" data-click="store:cart" aria-label="Cart, ${plural(count, 'item')}" title="Your cart">
          ${BAG}${count ? `<span class="cart-badge">${count > 99 ? '99+' : count}</span>` : ''}</button>` : ''}
      </div>
      <div class="sb-inner">
        <div class="sb-eyebrow">Fruitcats</div>
        <h1>${title}</h1>
        ${view.kind === 'browse' ? '<p class="sb-tagline">Decks and cards for your collection.</p>' : ''}
      </div>
    </header>
    ${notice ? `<p class="store-notice" role="status">${esc(notice)}</p>` : ''}
    ${body}
  </div>
  ${renderCheckout()}${renderReveal()}${renderResetDialog()}${renderSoon()}`;
}

/** A card's picture as the Store sells it: the standard print, or the Signature print for a Signature card (its only print). */
const cardUrl = (key: string) => (CARDS[key.replace(/-(kitten|bigcat)$/, '')]?.signature ? finishUrl(key, 'signature') : standardUrl(key));
/** "♛ Legendary", or "✦ Signature". */
const cardGrade = (id: string) => (CARDS[id]?.signature ? '✦ Signature' : `${rarityMark(rarity(id))} ${rarity(id)}`);
/** "♛ Legendary Hero Cat", or "Signature Hero Cat" for a Signature card. */
const cardKind = (id: string) => `${cardGrade(id)} ${esc(CARDS[id].type)}`;
const faceOf = (id: string) => (CARDS[id]?.type === 'Hero Cat' ? `${id}-kitten` : id);

function renderMessage(title: string, text: string, action = ''): string {
  return `<div class="store-message"><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}

// ── The shop: one list of everything for sale, all the same size ────────────────────────────────

function deckFacts(p: DeckProduct) {
  const owned = ownedNow();
  const size = Object.values(p.cards).reduce((a, b) => a + b, 0);
  const newCopies = Object.values(missingForDeck(p, owned)).reduce((a, b) => a + b, 0);
  return { size, newCopies, now: deckPrice(p, owned), complete: newCopies === 0 };
}

/** A price: what you pay, with the full price struck through when yours is lower. */
function priceChip(full: number, now: number): string {
  return `<span class="price-chip">${now < full ? `<s>${price(full)}</s>` : ''}${price(now)}</span>`;
}

/**
 * Everything for sale as one list (the owner's call, 2026-09-25): no banner ads, tabs or filters. Decks first, then the
 * single cards, rarest first. Each tile says what it is ("Deck" or "Card"), and a deck is its cover on real card backs,
 * exactly a card's size.
 */
function renderShop(): string {
  const cat = catalog()!;
  const owned = ownedNow();
  const decks = Object.values(cat.products).filter((p): p is DeckProduct => p.kind === 'deck');
  const cards = Object.values(cat.products).filter((p): p is CardProduct => p.kind === 'card')
    .sort((a, b) => RARITIES.indexOf(rarity(b.card)) - RARITIES.indexOf(rarity(a.card)));
  return `<main class="store-main">
      <div class="offers">${decks.map(renderDeckOffer).join('')}${cards.map((p) => renderCardOffer(p, owned(p.card))).join('')}</div>
      <p class="store-note">${CLOUD}<span>Everything here is digital: it’s added to your Via Mochi account, and it’s yours wherever you play Fruitcats signed in to that account.</span></p>
      ${renderTesterTools()}
    </main>`;
}

/** A small cloud, for "it lives in your account". */
const CLOUD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.5 19H8a5 5 0 1 1 .9-9.9A6 6 0 0 1 20 11a4 4 0 0 1-2.5 8Z"/></svg>`;

/** A deck: its cover (the Hero Cat in its family's colours, the deck's name on a plate) on two real card backs. */
function deckSlot(p: DeckProduct, big = false): string {
  return `<span class="slot ${big ? 'big' : ''} ${famClass(p.hero)}" aria-hidden="true">
      <span class="face back b1"></span><span class="face back b2"></span>
      <span class="face cover">
        <span class="cover-art" style="background-image:url(${artUrl(`${p.hero}-kitten`)})"></span>
        <span class="plate"><b>${esc(p.name)}</b><small>${esc(CARDS[p.hero]?.family ?? '')} deck</small></span>
      </span>
    </span>`;
}

/** A single card, the same footprint as a deck. */
const cardSlot = (id: string, big = false) =>
  `<span class="slot ${big ? 'big' : ''}"><img class="face" src="${cardUrl(faceOf(id))}" alt="" loading="lazy" draggable="false" ${FALLBACK}></span>`;

/** A small cart, on every button that adds to the cart. */
const CART_ICON = `<svg class="cart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h3l2.4 11.2a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.6-1.2L21.5 8H7"/></svg>`;

/**
 * A tile's button: what the price does. It adds to the cart in one tap (the cart is never a purchase: the total is
 * confirmed at checkout); once it's in, it opens the cart. Owned in full: a plain label, nothing to press.
 */
function tileAction(p: DeckProduct | CardProduct, name: string, full: number, now: number, done: string | null): string {
  if (done) return `<span class="buy done">${done}</span>`;
  if (canBuy() && inCart(p.id)) return `<button class="buy in-cart" data-click="store:cart" aria-label="${esc(name)} is in your cart. View cart">✓ In cart</button>`;
  return `<button class="buy" data-click="store:add:${p.id}" aria-label="Add ${esc(name)} to cart, ${price(now)}">${CART_ICON}<span class="add-word">Add</span>${priceChip(full, now)}</button>`;
}

/** A tile: the picture and name open the item's page; the button under them adds it to the cart. */
function offerTile(p: DeckProduct | CardProduct, owned: boolean, slot: string, details: string, action: string): string {
  return `<div class="offer ${owned ? 'owned' : ''}">
      <button class="offer-open" data-click="store:${p.kind}:${p.id}">
        <span class="stage">${slot}${canBuy() && inCart(p.id) ? '<span class="of-flag">In cart</span>' : ''}</span>
        <span class="info">${details}</span>
      </button>
      <div class="offer-buy">${action}</div>
    </div>`;
}

function renderDeckOffer(p: DeckProduct): string {
  const { size, now, complete } = deckFacts(p);
  return offerTile(p, complete, deckSlot(p), `
        <span class="kind">Deck</span>
        <span class="name">${esc(p.name)}</span>
        <span class="sub">${esc(cardName(p.hero))} + ${size} cards</span>`,
    tileAction(p, p.name, p.price, now, complete ? '✓ You have every card' : null));
}

function renderCardOffer(p: CardProduct, have: number): string {
  const full = have >= maxCopies(p.card);
  return offerTile(p, full, cardSlot(p.card), `
        <span class="kind">Card</span>
        <span class="name">${esc(cardName(p.card))}</span>
        <span class="sub">${cardKind(p.card)}</span>`,
    tileAction(p, cardName(p.card), p.price, p.price, full ? '✓ In your collection' : null));
}

// ── A product's page ─────────────────────────────────────────────────────────────────────────────

/** Add to cart, where the eye already is: right under the item's name (and again after a deck's cards). */
function buyButton(p: DeckProduct | CardProduct, full: number, now: number, complete: boolean, where = ''): string {
  const action = complete ? '<span class="owned-pill big">✓ You have it all</span>'
    : canBuy() && inCart(p.id) ? '<button class="store-btn ghost big" data-click="store:cart">✓ In your cart · View cart</button>'
    : `<button class="store-btn buy big" data-click="store:add:${p.id}">${CART_ICON}Add to cart ${priceChip(full, now)}</button>`;
  return `<div class="product-buy ${where}">${action}</div>`;
}

function renderDeckPage(p: DeckProduct): string {
  const owned = ownedNow();
  const { size, newCopies, now, complete } = deckFacts(p);
  const ids = [p.hero, ...Object.keys(p.cards).sort((a, b) =>
    RARITIES.indexOf(rarity(b)) - RARITIES.indexOf(rarity(a)) || (CARDS[a].cost ?? 0) - (CARDS[b].cost ?? 0))];
  return `<main class="store-main product-page">
      <section class="product-top">
        <div class="product-stage">${deckSlot(p, true)}</div>
        <div class="product-info">
          <span class="kind">Deck · ${esc(setName(p.set))}</span>
          <h2>${esc(p.name)}</h2>
          ${buyButton(p, p.price, now, complete)}
          ${p.blurb ? `<p class="blurb">${esc(p.blurb)}</p>` : ''}
          <p class="facts"><span>${esc(cardName(p.hero))} + ${size} cards</span>${complete ? '<span class="good">You have every card</span>'
            : newCopies <= size ? `<span class="good">${newCopies} new for you${now < p.price ? ' · the rest are taken off the price' : ''}</span>` : ''}</p>
        </div>
      </section>
      <h3 class="section-title">What’s inside <span>Tap and hold a card to read it</span></h3>
      <div class="inside">
        ${ids.map((id) => {
          const qty = id === p.hero ? 1 : p.cards[id];
          const have = Math.min(owned(id), qty);
          return `<div class="inside-card" data-zoom="${cardUrl(faceOf(id))}" data-zoom-card="${faceOf(id)}">
            <span class="inside-face"><img src="${cardUrl(faceOf(id))}" alt="${esc(cardName(id))}" loading="lazy" draggable="false" ${FALLBACK}>${qty > 1 ? `<span class="copies">×${qty}</span>` : ''}</span>
            <span class="inside-label">${have >= qty ? '✓ You have it' : have ? `You have ${have}` : '<b>New</b>'}</span>
          </div>`;
        }).join('')}
      </div>
      ${ids.length > 6 ? buyButton(p, p.price, now, complete, 'again') : ''}
    </main>`;
}

function renderCardPage(p: CardProduct): string {
  const have = ownedNow()(p.card);
  const max = maxCopies(p.card);
  return `<main class="store-main product-page">
      <section class="product-top">
        <div class="product-stage" data-zoom="${cardUrl(faceOf(p.card))}" data-zoom-card="${faceOf(p.card)}">${cardSlot(p.card, true)}</div>
        <div class="product-info">
          <span class="kind">Card · ${esc(setName(p.set))}</span>
          <h2>${esc(cardName(p.card))}</h2>
          <p class="facts"><span>${cardKind(p.card)}</span></p>
          ${buyButton(p, p.price, p.price, have >= max)}
          <p class="blurb">${CARDS[p.card].signature ? 'A Signature card: it comes only in this Signature print, and in no deck.' : 'This card comes in no deck: this is the way to get it.'}${max === 1 ? ' One copy is all a deck can hold.' : ''}</p>
          <p class="facts"><span>${have >= max ? 'In your collection' : have ? `You have ${have} of ${max}` : 'Not in your collection yet'}</span></p>
        </div>
      </section>
    </main>`;
}

/** A card the Store doesn't sell on its own, under its picture. (Later, for exclusives: "Find it on the market".) */
function notSoldLabel(u: { card: string; why: NotSold }): string {
  if (u.why === 'in-deck') {
    const deck = deckWith(u.card, catalog()!);
    return deck ? `The ${deck.name} deck has only ${deck.cards[u.card] ?? 1}` : 'Only in a deck';
  }
  return { exclusive: 'Promo · not sold', 'not-yet': 'Not in the Store yet', starter: 'Starter card' }[u.why];
}

// ── A deck's missing cards ───────────────────────────────────────────────────────────────────────

/**
 * What a deck (from a code, say) needs that you don't have, and how to get it: the Store decks that bring those cards,
 * then any single cards sold on their own, all picked to start with. Tap an offer to leave it out; the total and "Add to
 * cart" follow what's picked. Cards that can't be bought are shown apart.
 */
function renderMissingCards(v: Extract<View, { kind: 'missing' }>): string {
  const cat = catalog()!;
  const owned = ownedNow();
  const { plan, left, deck } = v;
  const picked = plan.lines.filter((l) => !left.has(l.product));
  const total = picked.reduce((sum, l) => {
    const p = cat.products[l.product];
    return sum + (p?.kind === 'deck' ? deckPrice(p, owned) : (p?.price ?? 0) * l.qty);
  }, 0);
  const need = Object.values(plan.missing).reduce((a, b) => a + b, 0);
  if (!need) {
    return renderMessage('You have every card', `“${deck.name}” is ready to play with the cards you have.`,
      '<button class="store-btn ghost" data-click="store:builder">Back to your deck</button>');
  }
  const deckLines = plan.decks.map((d) => ({ ...d, p: cat.products[d.product] as DeckProduct }));
  const singles = plan.lines.filter((l) => cat.products[l.product]?.kind === 'card');
  return `<main class="store-main product-page">
      <header class="missing-head">
        <span class="kind">For your deck</span>
        <h2>${esc(deck.name)}</h2>
        <p class="blurb"><b>${plural(need, 'card')}</b> ${need === 1 ? 'isn’t' : 'aren’t'} in your collection yet. Here’s how to get ${need === 1 ? 'it' : 'them'}. Tap one to leave it out.</p>
      </header>
      <div class="offers picks">
        ${deckLines.map(({ p, covers }) => {
          const on = !left.has(p.id);
          return `<button class="offer pick ${on ? 'on' : 'off'}" data-click="store:pick:${p.id}" aria-pressed="${on}">
            <span class="stage">${deckSlot(p)}<span class="pick-check" aria-hidden="true">${on ? '✓' : ''}</span></span>
            <span class="info">
              <span class="kind">Deck</span>
              <span class="name">${esc(p.name)}</span>
              <span class="sub">Brings <b>${covers} of the ${need}</b> cards you need</span>
              <span class="buy">${on ? priceChip(p.price, deckPrice(p, owned)) : 'Left out'}</span>
            </span>
          </button>`;
        }).join('')}
        ${singles.map((l) => {
          const p = cat.products[l.product] as CardProduct;
          const on = !left.has(l.product);
          return `<button class="offer pick ${on ? 'on' : 'off'}" data-click="store:pick:${l.product}" aria-pressed="${on}"
              aria-label="${esc(cardName(p.card))}, ${price(p.price)}${on ? '' : ', left out'}">
            <span class="stage">${cardSlot(p.card)}<span class="pick-check" aria-hidden="true">${on ? '✓' : ''}</span></span>
            <span class="info">
              <span class="kind">Card</span>
              <span class="name">${esc(cardName(p.card))}</span>
              <span class="sub">${cardGrade(p.card)}${l.qty > 1 ? ` · ${l.qty} copies` : ''}</span>
              <span class="buy">${on ? priceChip(p.price * l.qty, p.price * l.qty) : 'Left out'}</span>
            </span>
          </button>`;
        }).join('')}
      </div>
      ${heroLeftOut(v)
        ? `<p class="store-warning">Without ${esc(cardName(deck.hero))}, its Hero Cat, this deck can’t be played.</p>` : ''}
      ${plan.unavailable.length ? `
      <h3 class="section-title">Can’t be bought <span>The deck plays once you have them</span></h3>
      <div class="inside">
        ${plan.unavailable.map((u) => `<div class="inside-card unsold" data-zoom="${cardUrl(faceOf(u.card))}" data-zoom-card="${faceOf(u.card)}">
            <span class="inside-face"><img src="${cardUrl(faceOf(u.card))}" alt="" loading="lazy" draggable="false" ${FALLBACK}>${u.qty > 1 ? `<span class="copies">×${u.qty}</span>` : ''}</span>
            <span class="inside-label">${notSoldLabel(u)}</span>
          </div>`).join('')}
      </div>` : ''}
    </main>
  <div class="buy-bar">
    <span class="bb-total"><small>${picked.length ? plural(picked.length, 'item') : 'Nothing picked'}</small>${price(total)}</span>
    <button class="store-btn buy big" data-click="store:addpicked" ${picked.length ? '' : 'disabled'}>Add to cart</button>
  </div>`;
}

/** Is the line that brings the deck's Hero Cat left out? Then the deck can't be played, and the page says so. */
function heroLeftOut(v: Extract<View, { kind: 'missing' }>): boolean {
  if (!v.plan.missing[v.deck.hero]) return false;
  const cat = catalog()!;
  const line = v.plan.lines.find((l) => {
    const p = cat.products[l.product];
    return p?.kind === 'card' ? p.card === v.deck.hero : p?.kind === 'deck' && !!missingForDeck(p, ownedNow())[v.deck.hero];
  });
  return !!line && v.left.has(line.product);
}

// ── The cart ─────────────────────────────────────────────────────────────────────────────────────

function lineInfo(product: string) {
  const p = catalog()?.products[product];
  if (!p) return { name: 'Not for sale', sub: '', face: '' };
  if (p.kind === 'deck') return { name: p.name, sub: `Deck · ${esc(cardName(p.hero))} + ${Object.values(p.cards).reduce((a, b) => a + b, 0)} cards`, face: `${p.hero}-kitten`, deck: true };
  return { name: cardName(p.card), sub: `${cardGrade(p.card)} · ${price(p.price)} each`, face: CARDS[p.card].type === 'Hero Cat' ? `${p.card}-kitten` : p.card };
}

function renderCart(): string {
  const quote = localQuote();
  if (!quote || !cartLines().length) {
    return `${renderMessage('Your cart is empty', 'Pick a deck, or a card to finish one of yours.', '<button class="store-btn buy" data-click="store:browse">Browse the Store</button>')}<main class="store-main">${renderTesterTools()}</main>`;
  }
  const short = quote.minimumOrder - quote.total;
  return `<main class="store-main">
    <div class="cart">
      <ul class="cart-lines">
        ${quote.lines.map((l) => {
          const info = lineInfo(l.product);
          const p = catalog()!.products[l.product];
          const asked = inCart(l.product);
          const max = p?.kind === 'card' ? maxCopies(p.card) : 1;
          return `<li class="cart-line ${l.qty ? '' : 'idle'}">
            ${info.face ? `<img class="cl-face ${info.deck ? 'deck' : ''}" src="${info.deck ? artUrl(info.face) : cardUrl(info.face)}" alt="" ${info.deck ? '' : `data-zoom="${cardUrl(info.face)}" data-zoom-card="${info.face}"`}>` : '<span class="cl-face"></span>'}
            <div class="cl-text">
              <span class="cl-name">${esc(info.name)}</span>
              <span class="cl-sub">${info.sub}</span>
              ${l.note ? `<span class="cl-note">${esc(l.note)}</span>` : ''}
            </div>
            <div class="cl-side">
              <span class="cl-amount">${l.qty ? price(l.amount) : '—'}</span>
              ${p?.kind === 'card' ? `<span class="stepper">
                <button data-click="store:less:${l.product}" aria-label="One fewer">−</button><b>${asked}</b>
                <button data-click="store:more:${l.product}" aria-label="One more" ${asked >= max ? 'disabled' : ''}>+</button></span>` : ''}
              <button class="link-btn cl-remove" data-click="store:remove:${l.product}">Remove</button>
            </div>
          </li>`;
        }).join('')}
      </ul>
      <div class="cart-total">
        <div class="ct-row"><span>Total</span><b>${price(quote.total)}</b></div>
        <p class="ct-small">${payments()?.taxIncluded ? 'Includes any sales tax or VAT.' : 'Sales tax or VAT, where it applies, is added on the payment page.'}</p>
        ${short > 0 && quote.total > 0 ? `<p class="ct-min">Add ${price(short)} more to order: the smallest order is ${price(quote.minimumOrder)}, because payment fees would eat most of a smaller one.</p>` : ''}
        <button class="store-btn buy wide" data-click="store:review" ${quote.canBuy ? '' : 'disabled'}>Review order</button>
        <button class="link-btn" data-click="store:empty">Empty the cart</button>
      </div>
    </div>
    ${renderTesterTools()}
  </main>`;
}

/** For testers, at the bottom of the page, out of the way of what customers will see: it's a test, and a reset. */
function renderTesterTools(): string {
  if (!BUYING || !testCheckout()) return '';
  return `<footer class="tester-tools">
    <span class="tester-tag">Test store · no money is taken, and no card details are asked for</span>
    <button class="tester-btn" data-click="store:reset">Remove my test purchases</button>
  </footer>`;
}

/** What "Add to cart" says while buying isn't open: everything can be looked at, nothing bought yet. */
function renderSoon(): string {
  if (!soon) return '';
  return `<div class="overlay"><div class="settings delete-dialog soon-dialog" role="dialog" aria-label="Coming soon">
    <h2>Coming soon</h2>
    <p>You can’t buy decks and cards yet. Until then, look around: everything in the Store, and every price, is here to see.</p>
    <div class="delete-buttons"><button class="primary" data-click="store:soon">OK</button></div>
  </div></div>`;
}

function renderResetDialog(): string {
  if (!resetAsk) return '';
  return `<div class="overlay"><div class="settings delete-dialog" role="alertdialog" aria-label="Remove test purchases">
    <h2>Remove your test purchases?</h2>
    <p>The cards your test orders brought leave your collection, so you can try buying them again. Decks that used them stay, but can’t be played until you have the cards again.</p>
    <div class="delete-buttons"><button data-click="store:keep">Keep them</button><button class="danger" data-click="store:doreset">Remove</button></div>
  </div></div>`;
}

// ── Confirming ───────────────────────────────────────────────────────────────────────────────────

function renderCheckout(): string {
  if (!checkout) return '';
  const q = checkout.quote;
  let inner: string;
  if (checkout.stage === 'pricing') inner = '<h2>Checking prices…</h2>';
  else if (checkout.stage === 'paying') inner = '<h2>Paying with Paddle…</h2><p>Finish in the payment window. If you close it, nothing is charged, and you can come back to this order.</p>';
  else if (checkout.stage === 'finishing') inner = '<h2>Payment received</h2><p>Adding the cards to your collection…</p>';
  else if (checkout.stage === 'delayed') {
    inner = `<h2>Payment received</h2>
      <p>Your cards are on their way. Confirming the payment is taking longer than usual; your new cards appear here as soon as it’s done. There’s nothing more to pay.</p>
      <div class="delete-buttons single"><button class="primary" data-click="store:cancel">OK</button></div>`;
  } else if (checkout.stage === 'failed') {
    inner = `<h2>Nothing was ordered</h2><p>${esc(checkout.message ?? '')}</p>
      <div class="delete-buttons single"><button class="primary" data-click="store:cancel">Back to the cart</button></div>`;
  } else {
    const lines = q!.lines.filter((l) => l.qty > 0);
    inner = `<h2>Confirm your order</h2>
      ${checkout.changedFrom !== undefined ? `<p class="ct-min">The total changed from ${price(checkout.changedFrom)} since you looked. Please check it again.</p>` : ''}
      <ul class="confirm-lines ${lines.length > 6 ? 'long' : ''}">${lines.map((l) => {
        const info = lineInfo(l.product);
        return `<li><span>${l.qty > 1 ? `${l.qty} × ` : ''}${esc(info.name)}</span><b>${price(l.amount)}</b></li>`;
      }).join('')}</ul>
      <div class="ct-row"><span>Total</span><b>${price(q!.total)}</b></div>
      ${paying() ? payNote() : '<p class="confirm-test"><b>This is a test order.</b> No money is taken. The cards are added to your Via Mochi account, and you can remove them again from the cart’s tester tools.</p>'}
      <div class="delete-buttons">
        <button data-click="store:cancel" ${checkout.stage === 'placing' ? 'disabled' : ''}>Back</button>
        <button class="primary" data-click="store:place" ${checkout.stage === 'placing' ? 'disabled' : ''}>${checkout.stage === 'placing' ? (paying() ? 'Opening…' : 'Placing…') : paying() ? 'Continue to payment' : 'Place order'}</button>
      </div>`;
  }
  return `<div class="overlay"><div class="settings delete-dialog confirm-dialog" role="dialog" aria-label="Confirm your order">${inner}</div></div>`;
}

/** What the player agrees to before paying: who sells, tax, the terms, and a word for players under 18. */
function payNote(): string {
  const p = payments()!;
  return `${p.environment === 'sandbox' ? '<p class="confirm-test"><b>Test payments.</b> Paddle’s sandbox: use a test card, no real money is taken.</p>' : ''}
    <ul class="confirm-pay">
      <li>You pay on the next screen, to <b>Paddle</b>, who sells on our behalf and emails your receipt.</li>
      <li>${p.taxIncluded ? 'The total includes any sales tax or VAT.' : 'Any sales tax or VAT is added there.'}</li>
      <li>Under 18? Ask a parent first.</li>
    </ul>
    <p class="confirm-agree">By continuing you agree to the <a href="${BASE}terms.html" target="_blank" rel="noopener">Terms</a> and the <a href="${BASE}refunds.html" target="_blank" rel="noopener">Refund policy</a>.</p>`;
}

// ── The reveal ───────────────────────────────────────────────────────────────────────────────────

function renderReveal(): string {
  if (!reveal) return '';
  const { cards, copies, index, all } = reveal;
  const total = Object.values(copies).reduce((a, b) => a + b, 0);
  const face = (id: string) => (CARDS[id]?.type === 'Hero Cat' ? `${id}-kitten` : id);
  if (all) {
    return `<div class="viewer-overlay reveal-screen" role="dialog" aria-label="Your new cards">
      <div class="ambient" aria-hidden="true"><div class="ambient-layer show" style="background-image:url(${artUrl(face(cards[cards.length - 1]))})"></div></div>
      <div class="reveal-all">
        <h2>${plural(total, 'new card')} in your collection</h2>
        <div class="grid">${cards.map((id) => `<div class="tile" data-zoom="${cardUrl(face(id))}" data-zoom-card="${face(id)}">
          <span class="tile-card rv-glow-${rarity(id).toLowerCase()}"><img src="${cardUrl(face(id))}" alt="${esc(cardName(id))}" draggable="false">${copies[id] > 1 ? `<span class="tile-copies">×${copies[id]}</span>` : ''}</span>
          </div>`).join('')}</div>
      </div>
      <div class="reveal-actions">
        <button class="store-btn buy" data-click="store:build">Build a deck with them</button>
        <button class="v-wallpaper" data-click="store:done">Back to the Store</button>
      </div>
    </div>`;
  }
  const id = cards[index];
  const r = rarity(id);
  return `<div class="viewer-overlay reveal-screen" role="dialog" aria-label="Your new cards">
    <div class="ambient" aria-hidden="true"><div class="ambient-layer show" style="background-image:url(${artUrl(face(id))})"></div></div>
    <p class="reveal-count">${index + 1} of ${cards.length}</p>
    <button class="reveal-stage" data-click="store:next" aria-label="Next card">
      <span class="reveal-card rv-glow-${r.toLowerCase()}">
        <img class="rv-back" src="${BASE}ui/cardback.webp" alt="">
        <img class="rv-front" src="${cardUrl(face(id))}" alt="${esc(cardName(id))}" draggable="false">
      </span>
    </button>
    <div class="reveal-info">
      <p class="v-name">${esc(cardName(id))}${copies[id] > 1 ? ` <span class="rv-x">×${copies[id]}</span>` : ''}</p>
      <p class="rv-rarity rv-${r.toLowerCase()}">${rarityMark(r)} ${r}</p>
      <div class="reveal-actions">
        <button class="store-btn buy" data-click="store:next">${index < cards.length - 1 ? 'Next card' : 'See them all'}</button>
        ${index < cards.length - 1 ? '<button class="link-btn" data-click="store:all">Show all at once</button>' : ''}
      </div>
    </div>
  </div>`;
}
