// The Store screen (docs/store-plan.md, Store experience): a Decks tab and a Cards tab, a deck's page, the cart, an
// explicit confirmation step and, after an order, the new cards revealed one by one. It's built on the Collection's
// dark gallery (showcase.css) with store.css on top.
//
// No dark patterns: nothing is bought in one tap, there are no timers or "limited" offers, the total is always shown
// before confirming, and a deck never costs you for cards you already have. There are no payments yet: a tester's
// order is a test order, and every screen says so.

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
} from './shop';
import { BASE, artUrl, backButton, cardUrl, esc, famClass } from './ui';

export interface StoreHost {
  render(): void;
  /** Leave the Store for the deck builder (after an order: "Build a deck with them"). */
  openDeckBuilder(): void;
  /** Back to the deck being built, as it was (from a deck's missing cards). */
  backToBuilder(): void;
}

/** The shop's one filter: everything, decks, or single cards. */
type Filter = 'all' | 'decks' | 'cards';
/**
 * missing: the cards a deck (from a code, say) needs that you don't have, as a selection: all picked at first, tap one
 * to leave it out, then "Add to cart" below.
 */
type View = { kind: 'browse' } | { kind: 'deck'; product: string } | { kind: 'card'; product: string } | { kind: 'cart' }
  | { kind: 'missing'; deck: DeckList; plan: NonNullable<ReturnType<typeof planForDeck>>; left: Set<string> };
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary'] as const;

let filter: Filter = 'all';
let view: View = { kind: 'browse' };
/** A line under the header after something happened ("Added 3 cards to your cart"). */
let notice = '';
let loading = false;

/** The confirmation step, from "Review order" until the order is placed or abandoned. */
let checkout: null | {
  stage: 'pricing' | 'confirm' | 'placing' | 'failed';
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
  void refreshStore().then(() => { loading = false; host.render(); });
}

// ── Clicks: store:<action>:<arg> ─────────────────────────────────────────────────────────────────

export function storeClick(action: string, arg: string, host: StoreHost): void {
  notice = '';
  switch (action) {
    case 'filter': filter = arg === 'decks' || arg === 'cards' ? arg : 'all'; break;
    case 'deck': view = { kind: 'deck', product: arg }; break;
    case 'card': view = { kind: 'card', product: arg }; break;
    case 'browse': view = { kind: 'browse' }; break;
    case 'retry': refresh(host); break;
    case 'cart': view = { kind: 'cart' }; break;
    case 'add': {
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
      const { left, plan } = view;
      const lines = plan.lines.filter((l) => !left.has(l.product));
      addLinesToCart(lines);
      notice = `Added what “${view.deck.name}” needs to your cart.`;
      view = { kind: 'cart' };
      break;
    }
    case 'builder': host.backToBuilder(); return;
    case 'review': void review(host); return;
    case 'cancel': checkout = null; break;
    case 'place': void place(host); return;
    case 'next':
      if (reveal) { if (reveal.index < reveal.cards.length - 1) reveal.index++; else reveal.all = true; }
      break;
    case 'all': if (reveal) reveal.all = true; break;
    case 'done': reveal = null; view = { kind: 'browse' }; break;
    case 'build': reveal = null; host.openDeckBuilder(); return;
    case 'reset': resetAsk = true; break;
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
  else if (checkout && checkout.stage !== 'placing') checkout = null;
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
  const product = (view.kind === 'deck' || view.kind === 'card') ? cat?.products[view.product] : undefined;
  const backdrop = product ? artOf(product) : view.kind === 'missing' ? `${view.deck.hero}-bigcat` : featured() ? artOf(featured()!) : '';
  return `
  <div class="collection-screen store-screen">
    ${backdrop ? `<div class="ambient" aria-hidden="true"><div class="ambient-layer show" style="background-image:url(${artUrl(backdrop)})"></div></div>` : ''}
    <div class="collection-top store-top">
      ${back}
      <h2 class="store-title">${title}</h2>
      <button class="icon-button cart-button ${view.kind === 'cart' ? 'on' : ''}" data-click="store:cart" aria-label="Cart, ${plural(count, 'item')}" title="Your cart">
        ${BAG}${count ? `<span class="cart-badge">${count > 99 ? '99+' : count}</span>` : ''}</button>
    </div>
    <p class="test-banner" role="note"><b>Test store</b> · no money is taken</p>
    ${notice ? `<p class="store-notice" role="status">${esc(notice)}</p>` : ''}
    ${body}
  </div>
  ${renderCheckout()}${renderReveal()}${renderResetDialog()}`;
}

/** The picture that stands for a product: a deck's Big Cat, a card's own art. */
const artOf = (p: DeckProduct | CardProduct | { kind: string }) =>
  p.kind === 'deck' ? `${(p as DeckProduct).hero}-bigcat` : faceOf((p as CardProduct).card);
const faceOf = (id: string) => (CARDS[id]?.type === 'Hero Cat' ? `${id}-kitten` : id);

/** The deck at the top of the Store: the first one you don't have every card of. */
function featured(): DeckProduct | undefined {
  const decks = Object.values(catalog()?.products ?? {}).filter((p): p is DeckProduct => p.kind === 'deck');
  return decks.find((d) => !deckFacts(d).complete) ?? decks[0];
}

function renderMessage(title: string, text: string, action = ''): string {
  return `<div class="showcase-empty"><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}

// ── The shop: one page, a featured deck, then everything as offers ───────────────────────────────

function deckFacts(p: DeckProduct) {
  const owned = ownedNow();
  const size = Object.values(p.cards).reduce((a, b) => a + b, 0);
  const newCopies = Object.values(missingForDeck(p, owned)).reduce((a, b) => a + b, 0);
  return { size, newCopies, now: deckPrice(p, owned), complete: newCopies === 0 };
}

/** A price as a chip: what you pay, with the full price struck through when yours is lower. */
function priceChip(full: number, now: number): string {
  return `<span class="price-chip">${now < full ? `<s>${price(full)}</s>` : ''}${price(now)}</span>`;
}

function renderShop(): string {
  const cat = catalog()!;
  const owned = ownedNow();
  const decks = Object.values(cat.products).filter((p): p is DeckProduct => p.kind === 'deck');
  const cards = Object.values(cat.products).filter((p): p is CardProduct => p.kind === 'card')
    .sort((a, b) => RARITIES.indexOf(rarity(b.card)) - RARITIES.indexOf(rarity(a.card)));
  const top = featured();
  const chip = (value: Filter, label: string, n: number) =>
    `<button class="store-filter ${filter === value ? 'on' : ''}" data-click="store:filter:${value}" aria-pressed="${filter === value}">${label}<small>${n}</small></button>`;
  const showDecks = filter !== 'cards' && decks.length;
  const showCards = filter !== 'decks' && cards.length;
  return `<div class="collection-grid store-body" data-keep-scroll="store-shop">
    <div class="shop">
      ${top && filter === 'all' ? renderFeatured(top) : ''}
      <div class="store-filters" role="group" aria-label="Show">
        ${chip('all', 'Everything', decks.length + cards.length)}${chip('decks', 'Decks', decks.length)}${chip('cards', 'Single cards', cards.length)}
      </div>
      ${showDecks ? `
      <section class="shelf">
        <h3 class="shelf-title">Decks <span>Ready to play: a Hero Cat and 50 cards</span></h3>
        <div class="offers decks">${decks.map(renderDeckOffer).join('')}</div>
      </section>` : ''}
      ${showCards ? `
      <section class="shelf">
        <h3 class="shelf-title">Single cards <span>Cards that come in no deck</span></h3>
        <div class="offers cards">${cards.map((p) => renderCardOffer(p, owned(p.card))).join('')}</div>
      </section>` : ''}
      <p class="store-foot">Every card plays the same however you get it. A deck never charges you for cards you already have.</p>
    </div>
    ${renderTesterTools()}
  </div>`;
}

function renderFeatured(p: DeckProduct): string {
  const { size, newCopies, now, complete } = deckFacts(p);
  return `
    <section class="featured ${famClass(p.hero)}">
      <div class="ft-art" style="background-image:url(${artUrl(`${p.hero}-bigcat`)})" aria-hidden="true"></div>
      <div class="ft-info">
        <span class="kicker">Featured deck · ${esc(setName(p.set))}</span>
        <h2>${esc(p.name)}</h2>
        ${p.blurb ? `<p class="ft-blurb">${esc(p.blurb)}</p>` : ''}
        <p class="ft-meta"><span>${esc(cardName(p.hero))} + ${size} cards</span>${!complete && newCopies <= size ? `<span class="new-for-you">${newCopies} new for you</span>` : ''}</p>
        <div class="ft-buy">
          ${complete ? '<span class="owned-pill">✓ You have every card</span>'
            : `<button class="store-btn buy big" data-click="store:deck:${p.id}">Get the deck ${priceChip(p.price, now)}</button>`}
          <button class="store-btn ghost" data-click="store:deck:${p.id}">What’s inside</button>
        </div>
      </div>
    </section>`;
}

function renderDeckOffer(p: DeckProduct): string {
  const { size, now, complete } = deckFacts(p);
  return `<button class="offer deck-offer ${famClass(p.hero)} ${complete ? 'owned' : ''}" data-click="store:deck:${p.id}" aria-label="${esc(p.name)}, deck">
      <span class="of-art" style="background-image:url(${artUrl(`${p.hero}-bigcat`)})"></span>
      <span class="of-shade"></span>
      <span class="of-tag">Deck</span>
      ${inCart(p.id) ? '<span class="of-flag">In cart</span>' : ''}
      <span class="of-info">
        <span class="of-name">${esc(p.name)}</span>
        <span class="of-sub">${esc(cardName(p.hero))} + ${size} cards</span>
        ${complete ? '<span class="owned-pill">✓ Owned</span>' : priceChip(p.price, now)}
      </span>
    </button>`;
}

function renderCardOffer(p: CardProduct, have: number): string {
  const r = rarity(p.card);
  const full = have >= maxCopies(p.card);
  return `<button class="offer card-offer rv-${r.toLowerCase()} ${full ? 'owned' : ''}" data-click="store:card:${p.id}" aria-label="${esc(cardName(p.card))}, ${r} card">
      <span class="of-glow"></span>
      <img class="of-card" src="${cardUrl(faceOf(p.card))}" alt="" loading="lazy" draggable="false" ${FALLBACK}>
      ${inCart(p.id) ? '<span class="of-flag">In cart</span>' : ''}
      <span class="of-info">
        <span class="of-name">${esc(cardName(p.card))}</span>
        <span class="of-sub">${rarityMark(r)} ${r} ${esc(CARDS[p.card].type)}</span>
        ${full ? '<span class="owned-pill">✓ Owned</span>' : priceChip(p.price, p.price)}
      </span>
    </button>`;
}

// ── A product's page ─────────────────────────────────────────────────────────────────────────────

function buyBar(p: DeckProduct | CardProduct, full: number, now: number, complete: boolean): string {
  const action = complete ? '<span class="owned-pill big">✓ You have it all</span>'
    : inCart(p.id) ? '<button class="store-btn ghost big" data-click="store:cart">In your cart · View cart</button>'
    : `<button class="store-btn buy big" data-click="store:add:${p.id}">Add to cart ${priceChip(full, now)}</button>`;
  return `<div class="buy-bar">${action}</div>`;
}

function renderDeckPage(p: DeckProduct): string {
  const owned = ownedNow();
  const { size, newCopies, now, complete } = deckFacts(p);
  const ids = [p.hero, ...Object.keys(p.cards).sort((a, b) =>
    RARITIES.indexOf(rarity(b)) - RARITIES.indexOf(rarity(a)) || (CARDS[a].cost ?? 0) - (CARDS[b].cost ?? 0))];
  return `<div class="collection-grid store-body" data-keep-scroll="store-deck">
    <div class="product-page">
      <section class="featured product-hero ${famClass(p.hero)}">
        <div class="ft-art" style="background-image:url(${artUrl(`${p.hero}-bigcat`)})" aria-hidden="true"></div>
        <div class="ft-info">
          <span class="kicker">Deck · ${esc(setName(p.set))}</span>
          <h2>${esc(p.name)}</h2>
          ${p.blurb ? `<p class="ft-blurb">${esc(p.blurb)}</p>` : ''}
          <p class="ft-meta"><span>${esc(cardName(p.hero))} + ${size} cards</span>${complete ? '<span class="new-for-you">You have every card</span>'
            : newCopies <= size ? `<span class="new-for-you">${newCopies} new for you${now < p.price ? ' · the rest are taken off the price' : ''}</span>` : ''}</p>
        </div>
      </section>
      <h3 class="shelf-title">What’s inside <span>Tap and hold a card to read it</span></h3>
      <div class="grid inside">
        ${ids.map((id) => {
          const qty = id === p.hero ? 1 : p.cards[id];
          const have = Math.min(owned(id), qty);
          return `<div class="tile shop-tile" data-zoom="${cardUrl(faceOf(id))}" data-zoom-card="${faceOf(id)}">
            <span class="tile-card"><img src="${cardUrl(faceOf(id))}" alt="${esc(cardName(id))}" loading="lazy" draggable="false" ${FALLBACK}>${qty > 1 ? `<span class="tile-copies">×${qty}</span>` : ''}</span>
            <span class="tile-label">${have >= qty ? '<span class="have">✓ You have it</span>' : have ? `<span class="have">You have ${have}</span>` : '<span class="new">New</span>'}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>
  ${buyBar(p, p.price, now, complete)}`;
}

function renderCardPage(p: CardProduct): string {
  const have = ownedNow()(p.card);
  const max = maxCopies(p.card);
  const r = rarity(p.card);
  return `<div class="collection-grid store-body" data-keep-scroll="store-card">
    <div class="product-page card-page rv-${r.toLowerCase()}">
      <div class="cp-stage" data-zoom="${cardUrl(faceOf(p.card))}" data-zoom-card="${faceOf(p.card)}">
        <span class="of-glow"></span>
        <img class="cp-card" src="${cardUrl(faceOf(p.card))}" alt="${esc(cardName(p.card))}" draggable="false" ${FALLBACK}>
      </div>
      <div class="cp-info">
        <span class="kicker">Single card · ${esc(setName(p.set))}</span>
        <h2>${esc(cardName(p.card))}</h2>
        <p class="rv-rarity rv-${r.toLowerCase()}">${rarityMark(r)} ${r} ${esc(CARDS[p.card].type)}</p>
        <p class="ft-blurb">This card comes in no deck: this is the way to get it.${max === 1 ? ' One copy is all a deck can hold.' : ''}</p>
        <p class="ft-meta"><span>${have >= max ? 'In your collection' : have ? `You have ${have} of ${max}` : 'Not in your collection yet'}</span></p>
      </div>
    </div>
  </div>
  ${buyBar(p, p.price, p.price, have >= max)}`;
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
  return `<div class="collection-grid store-body" data-keep-scroll="store-missing">
    <div class="product-page">
      <header class="missing-head">
        <span class="kicker">For your deck</span>
        <h2>${esc(deck.name)}</h2>
        <p class="ft-blurb"><b>${plural(need, 'card')}</b> ${need === 1 ? 'isn’t' : 'aren’t'} in your collection yet. Here’s how to get ${need === 1 ? 'it' : 'them'}.</p>
      </header>
      ${deckLines.map(({ p, covers }) => {
        const on = !left.has(p.id);
        const { size } = deckFacts(p);
        return `<button class="pick-deck ${famClass(p.hero)} ${on ? 'on' : 'off'}" data-click="store:pick:${p.id}" aria-pressed="${on}">
          <span class="of-art" style="background-image:url(${artUrl(`${p.hero}-bigcat`)})"></span><span class="of-shade"></span>
          <span class="pick-check" aria-hidden="true">${on ? '✓' : ''}</span>
          <span class="pd-info">
            <span class="of-tag">Deck</span>
            <span class="of-name">${esc(p.name)}</span>
            <span class="of-sub">Brings <b>${covers} of the ${need}</b> cards you need · ${esc(cardName(p.hero))} + ${size} cards</span>
            ${priceChip(p.price, deckPrice(p, owned))}
          </span>
        </button>`;
      }).join('')}
      ${singles.length ? `
      <h3 class="shelf-title">Single cards <span>Sold on their own</span></h3>
      <div class="grid missing-grid">
        ${singles.map((l) => {
          const p = cat.products[l.product] as CardProduct;
          const on = !left.has(l.product);
          return `<button class="tile pick-tile ${on ? 'on' : 'off'}" data-click="store:pick:${l.product}" aria-pressed="${on}"
              aria-label="${esc(cardName(p.card))}, ${price(p.price)}${on ? '' : ', left out'}">
            <span class="tile-card"><img src="${cardUrl(faceOf(p.card))}" alt="" loading="lazy" draggable="false" ${FALLBACK}>
              ${l.qty > 1 ? `<span class="tile-copies">×${l.qty}</span>` : ''}<span class="pick-check" aria-hidden="true">${on ? '✓' : ''}</span>
              ${on ? '' : '<span class="pick-out">Left out</span>'}</span>
            <span class="pick-price">${rarityMark(rarity(p.card))} ${l.qty > 1 ? `${l.qty} × ${price(p.price)}` : price(p.price)}</span>
          </button>`;
        }).join('')}
      </div>` : ''}
      ${heroLeftOut(v)
        ? `<p class="ct-min missing-hero">Without ${esc(cardName(deck.hero))}, its Hero Cat, this deck can’t be played.</p>` : ''}
      ${plan.unavailable.length ? `
      <h3 class="shelf-title">Can’t be bought <span>The deck plays once you have them</span></h3>
      <div class="grid missing-grid">
        ${plan.unavailable.map((u) => `<div class="tile pick-tile unsold" data-zoom="${cardUrl(faceOf(u.card))}" data-zoom-card="${faceOf(u.card)}">
            <span class="tile-card"><img src="${cardUrl(faceOf(u.card))}" alt="" loading="lazy" draggable="false" ${FALLBACK}>${u.qty > 1 ? `<span class="tile-copies">×${u.qty}</span>` : ''}</span>
            <span class="pick-price">${notSoldLabel(u)}</span>
          </div>`).join('')}
      </div>` : ''}
    </div>
  </div>
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
  return { name: cardName(p.card), sub: `${rarityMark(rarity(p.card))} ${rarity(p.card)} · ${price(p.price)} each`, face: CARDS[p.card].type === 'Hero Cat' ? `${p.card}-kitten` : p.card };
}

function renderCart(): string {
  const quote = localQuote();
  if (!quote || !cartLines().length) {
    return `${renderMessage('Your cart is empty', 'Pick a deck, or single cards to finish one of yours.', '<button class="v-wallpaper" data-click="store:browse">Browse the Store</button>')}${renderTesterTools()}`;
  }
  const short = quote.minimumOrder - quote.total;
  return `<div class="collection-grid store-body" data-keep-scroll="store-cart">
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
        <p class="ct-small">Sales tax or VAT, where it applies, is added on the payment page.</p>
        ${short > 0 && quote.total > 0 ? `<p class="ct-min">Add ${price(short)} more to order: the smallest order is ${price(quote.minimumOrder)}, because payment fees would eat most of a smaller one.</p>` : ''}
        <button class="store-btn buy wide" data-click="store:review" ${quote.canBuy ? '' : 'disabled'}>Review order</button>
        <button class="link-btn" data-click="store:empty">Empty the cart</button>
      </div>
    </div>
    ${renderTesterTools()}
  </div>`;
}

function renderTesterTools(): string {
  if (!testCheckout()) return '';
  return `<div class="tester-tools"><span>Tester tools</span>
    <button class="link-btn" data-click="store:reset">Remove my test purchases</button></div>`;
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
  else if (checkout.stage === 'failed') {
    inner = `<h2>Nothing was ordered</h2><p>${esc(checkout.message ?? '')}</p>
      <div class="delete-buttons"><button class="primary" data-click="store:cancel">Back to the cart</button></div>`;
  } else {
    const lines = q!.lines.filter((l) => l.qty > 0);
    inner = `<h2>Confirm your order</h2>
      ${checkout.changedFrom !== undefined ? `<p class="ct-min">The total changed from ${price(checkout.changedFrom)} since you looked. Please check it again.</p>` : ''}
      <ul class="confirm-lines ${lines.length > 6 ? 'long' : ''}">${lines.map((l) => {
        const info = lineInfo(l.product);
        return `<li><span>${l.qty > 1 ? `${l.qty} × ` : ''}${esc(info.name)}</span><b>${price(l.amount)}</b></li>`;
      }).join('')}</ul>
      <div class="ct-row"><span>Total</span><b>${price(q!.total)}</b></div>
      <p class="confirm-test"><b>This is a test order.</b> No money is taken. The cards are added to your Via Mochi account, and you can remove them again from the cart’s tester tools.</p>
      <div class="delete-buttons">
        <button data-click="store:cancel" ${checkout.stage === 'placing' ? 'disabled' : ''}>Back</button>
        <button class="primary" data-click="store:place" ${checkout.stage === 'placing' ? 'disabled' : ''}>${checkout.stage === 'placing' ? 'Placing…' : 'Place order'}</button>
      </div>`;
  }
  return `<div class="overlay"><div class="settings delete-dialog confirm-dialog" role="dialog" aria-label="Confirm your order">${inner}</div></div>`;
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
