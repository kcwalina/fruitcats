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
  cardProduct, deckPrice, formatPrice, maxCopies, missingForDeck,
  type CardProduct, type DeckProduct, type NotSold, type Quote,
} from '@fruitcats/store';
import { rarity, rarityMark } from './rarity';
import {
  addLinesToCart, addToCart, planForDeck, cartCount, cartLines, catalog, clearCart, inCart, localQuote, ownedNow, placeTestOrder,
  newOrderId, refreshStore, removeLine, resetTestOrders, serverQuote, setLineQty, storeAccess, swapForDeck, testCheckout, type Order,
} from './shop';
import { BASE, artUrl, backButton, cardUrl, esc, famClass } from './ui';

export interface StoreHost {
  render(): void;
  /** Leave the Store for the deck builder (after an order: "Build a deck with them"). */
  openDeckBuilder(): void;
  /** Back to the deck being built, as it was (from a deck's missing cards). */
  backToBuilder(): void;
}

type Tab = 'decks' | 'cards';
/**
 * missing: the cards a deck (from a code, say) needs that you don't have, as a selection: all picked at first, tap one
 * to leave it out, then "Add to cart" below.
 */
type View = { kind: 'browse' } | { kind: 'deck'; product: string } | { kind: 'cart' }
  | { kind: 'missing'; deck: DeckList; plan: NonNullable<ReturnType<typeof planForDeck>>; left: Set<string> };
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary'] as const;

let tab: Tab = 'decks';
let view: View = { kind: 'browse' };
let setFilter = 'all';
let rarityFilter = 'all';
let hideOwned = false;
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
    case 'tab': tab = arg === 'cards' ? 'cards' : 'decks'; view = { kind: 'browse' }; break;
    case 'deck': view = { kind: 'deck', product: arg }; break;
    case 'browse': view = { kind: 'browse' }; break;
    case 'retry': refresh(host); break;
    case 'cart': view = { kind: 'cart' }; break;
    case 'set': setFilter = arg; break;
    case 'rarity': rarityFilter = arg; break;
    case 'owned': hideOwned = !hideOwned; break;
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
    case 'swap': swapForDeck(arg); notice = 'Swapped the singles for the deck.'; break;
    case 'pick':   // a card on the missing-cards page: in or out of the selection
      if (view.kind === 'missing') { if (view.left.has(arg)) view.left.delete(arg); else view.left.add(arg); }
      break;
    case 'pickall': if (view.kind === 'missing') view.left = view.left.size ? new Set() : new Set(view.plan.lines.map((l) => l.product)); break;
    case 'addpicked': {
      if (view.kind !== 'missing') break;
      const { left, plan } = view;
      const lines = plan.lines.filter((l) => !left.has(l.product));
      addLinesToCart(lines);
      notice = `Added ${plural(lines.reduce((n, l) => n + l.qty, 0), 'card')} for “${view.deck.name}” to your cart.`;
      view = { kind: 'cart' };
      break;
    }
    case 'dealdeck':   // the missing-cards page's "better deal": that deck, in the cart instead
      addToCart(arg, inCart(arg) ? 0 : 1);
      notice = `${catalog()?.products[arg]?.kind === 'deck' ? (catalog()!.products[arg] as DeckProduct).name : 'The deck'} is in your cart.`;
      view = { kind: 'cart' };
      break;
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
  else if (!cat) body = loading ? renderMessage('Opening the Store…', '') : renderMessage('The Store couldn’t load', 'Check your connection, then try again.', '<button class="v-wallpaper" data-click="store:retry">Try again</button>');
  else if (view.kind === 'cart') body = renderCart();
  else if (view.kind === 'missing') body = renderMissingCards(view);
  else if (view.kind === 'deck' && cat.products[view.product]?.kind === 'deck') body = renderDeckPage(cat.products[view.product] as DeckProduct);
  else body = tab === 'decks' ? renderDecks() : renderCards();

  const count = cartCount();
  const inCartView = view.kind === 'cart';
  const top = view.kind === 'browse'
    ? `<div class="seg" role="tablist" aria-label="Store">
        ${(['decks', 'cards'] as Tab[]).map((t) => `<button class="seg-btn ${tab === t ? 'on' : ''}" role="tab" aria-selected="${tab === t}"
          data-click="store:tab:${t}">${t === 'decks' ? 'Decks' : 'Cards'}</button>`).join('')}
      </div>`
    : `<h2 class="store-title">${inCartView ? 'Your cart' : view.kind === 'missing' ? 'Missing cards' : 'Deck'}</h2>`;
  const backdrop = view.kind === 'deck' ? `${(cat?.products[view.product] as DeckProduct | undefined)?.hero ?? ''}-bigcat`
    : view.kind === 'missing' ? `${view.deck.hero}-bigcat` : featuredStoreHero();
  return `
  <div class="collection-screen store-screen">
    ${backdrop ? `<div class="ambient" aria-hidden="true"><div class="ambient-layer show" style="background-image:url(${artUrl(backdrop)})"></div></div>` : ''}
    <div class="collection-top">
      ${view.kind === 'browse' ? backButton() : view.kind === 'missing' ? backButton('store:builder', 'Back to your deck') : backButton('store:browse', 'Store')}
      ${top}
      <button class="icon-button cart-button ${inCartView ? 'on' : ''}" data-click="store:cart" aria-label="Cart, ${plural(count, 'item')}" title="Your cart">
        ${BAG}${count ? `<span class="cart-badge">${count > 99 ? '99+' : count}</span>` : ''}</button>
    </div>
    <p class="test-banner" role="note"><b>Test store</b> · no money is taken</p>
    ${notice ? `<p class="store-notice" role="status">${esc(notice)}</p>` : ''}
    ${body}
  </div>
  ${renderCheckout()}${renderReveal()}${renderResetDialog()}`;
}

function featuredStoreHero(): string {
  const deck = Object.values(catalog()?.products ?? {}).find((p): p is DeckProduct => p.kind === 'deck');
  return deck ? `${deck.hero}-bigcat` : '';
}

function renderMessage(title: string, text: string, action = ''): string {
  return `<div class="showcase-empty"><h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`;
}

// ── Decks ────────────────────────────────────────────────────────────────────────────────────────

function deckFacts(p: DeckProduct) {
  const owned = ownedNow();
  const size = Object.values(p.cards).reduce((a, b) => a + b, 0);
  const missing = missingForDeck(p, owned);
  const newCopies = Object.values(missing).reduce((a, b) => a + b, 0);
  return { size, newCopies, now: deckPrice(p, owned), complete: newCopies === 0 };
}

/** The deck's button: add it, or say it's in the cart, or that you have it all. */
function deckAction(p: DeckProduct, now: number, complete: boolean): string {
  if (complete) return '<span class="owned-note">You have every card ✓</span>';
  if (inCart(p.id)) return `<button class="store-btn ghost" data-click="store:cart">In your cart ✓</button>`;
  return `<button class="store-btn buy" data-click="store:add:${p.id}">Add to cart${now < p.price ? '' : ` · ${price(now)}`}</button>`;
}

/** The deck's price beside its button, only when it's lower for you (the button says the price otherwise). */
function priceTag(p: DeckProduct, now: number): string {
  return now < p.price && now > 0 ? `<span class="price"><s>${price(p.price)}</s> ${price(now)}</span>` : '';
}

function renderDecks(): string {
  const decks = Object.values(catalog()!.products).filter((p): p is DeckProduct => p.kind === 'deck');
  if (!decks.length) return renderMessage('No decks yet', 'New decks arrive with each set.');
  return `<div class="collection-grid store-body" data-keep-scroll="store-decks">
    <div class="store-decks">
      ${decks.map((p) => {
        const { size, newCopies, now, complete } = deckFacts(p);
        return `
        <article class="store-deck ${famClass(p.hero)}">
          <button class="sd-art" data-click="store:deck:${p.id}" aria-label="See the cards in ${esc(p.name)}">
            <img src="${artUrl(`${p.hero}-bigcat`)}" alt="" loading="lazy" ${FALLBACK}>
          </button>
          <div class="sd-text">
            <span class="sd-set">${esc(setName(p.set))} · Deck</span>
            <h3>${esc(p.name)}</h3>
            ${p.blurb ? `<p class="sd-blurb">${esc(p.blurb)}</p>` : ''}
            <p class="sd-meta">${esc(cardName(p.hero))} + ${size} cards${!complete && newCopies < size + 1 ? ` · <b>${newCopies} new for you</b>` : ''}</p>
            <div class="sd-buy">${complete ? '' : priceTag(p, now)}${deckAction(p, now, complete)}</div>
            <button class="link-btn" data-click="store:deck:${p.id}">See all ${size + 1} cards ›</button>
          </div>
        </article>`;
      }).join('')}
    </div>
    <p class="store-foot">A deck costs less than its cards bought one by one, and never charges you for cards you already have.</p>
  </div>`;
}

function renderDeckPage(p: DeckProduct): string {
  const owned = ownedNow();
  const { size, newCopies, now, complete } = deckFacts(p);
  const ids = [p.hero, ...Object.keys(p.cards).sort((a, b) =>
    RARITIES.indexOf(rarity(b)) - RARITIES.indexOf(rarity(a)) || (CARDS[a].cost ?? 0) - (CARDS[b].cost ?? 0))];
  return `<div class="collection-grid store-body" data-keep-scroll="store-deck">
    <div class="deck-page">
      <header class="dp-head">
        <span class="sd-set">${esc(setName(p.set))} · Deck</span>
        <h2>${esc(p.name)}</h2>
        ${p.blurb ? `<p class="sd-blurb">${esc(p.blurb)}</p>` : ''}
        <p class="sd-meta">${complete ? 'You have every card in this deck.'
          : newCopies === size + 1 ? `${esc(cardName(p.hero))} and ${size} cards, all new for you.`
          : `<b>${plural(newCopies, 'card')} new for you.</b> You already have the rest${now < p.price ? ', so the price is lower for you' : ''}.`}</p>
      </header>
      <div class="grid">
        ${ids.map((id) => {
          const qty = id === p.hero ? 1 : p.cards[id];
          const have = Math.min(owned(id), qty);
          const face = id === p.hero ? `${id}-kitten` : id;
          return `<div class="tile shop-tile" data-zoom="${cardUrl(face)}" data-zoom-card="${face}">
            <span class="tile-card"><img src="${cardUrl(face)}" alt="${esc(cardName(id))}" loading="lazy" draggable="false" ${FALLBACK}>${qty > 1 ? `<span class="tile-copies">×${qty}</span>` : ''}</span>
            <span class="tile-label">${rarityMark(rarity(id))} ${have >= qty ? '<span class="have">You have it</span>' : have ? `<span class="have">You have ${have}</span>` : '<span class="new">New</span>'}</span>
          </div>`;
        }).join('')}
      </div>
    </div>
  </div>
  <div class="buy-bar">
    ${complete ? '<span class="owned-note">You have every card ✓</span>' : `${priceTag(p, now)}${deckAction(p, now, complete)}`}
  </div>`;
}

// ── Cards ────────────────────────────────────────────────────────────────────────────────────────

function renderCards(): string {
  const cat = catalog()!;
  const owned = ownedNow();
  const all = Object.values(cat.products).filter((p): p is CardProduct => p.kind === 'card');
  const shown = all.filter((p) => (setFilter === 'all' || p.set === setFilter)
    && (rarityFilter === 'all' || rarity(p.card) === rarityFilter)
    && (!hideOwned || owned(p.card) < maxCopies(p.card)));
  const chip = (group: string, value: string, label: string, on: boolean) =>
    `<button class="chip fchip ${on ? 'chosen' : ''}" data-click="store:${group}:${value}" aria-pressed="${on}">${label}</button>`;
  const sets = cat.sets.length > 1 ? `<div class="filter-row" role="group" aria-label="Set"><span class="filter-label">Set</span><div class="filter-chips">
      ${chip('set', 'all', 'All', setFilter === 'all')}${cat.sets.map((s) => chip('set', s, esc(setName(s)), setFilter === s)).join('')}</div></div>` : '';
  return `<div class="collection-grid store-body" data-keep-scroll="store-cards">
    <div class="grid-head">
      ${sets}
      <div class="filter-row" role="group" aria-label="Rarity"><span class="filter-label">Rarity</span><div class="filter-chips">
        ${chip('rarity', 'all', 'All', rarityFilter === 'all')}${RARITIES.map((r) => chip('rarity', r, `${rarityMark(r)}<span>${r}</span> <small>${price(cat.products[cardProduct(all.find((p) => rarity(p.card) === r)?.card ?? '')]?.price ?? 0)}</small>`, rarityFilter === r)).join('')}
      </div></div>
      <div class="filter-row"><span class="filter-label">Show</span><div class="filter-chips">
        ${chip('owned', 'toggle', 'Only cards I can still use', hideOwned)}</div></div>
    </div>
    ${shown.length ? `<div class="grid">${shown.map((p) => renderCardTile(p, owned(p.card))).join('')}</div>`
      : `<div class="grid-empty"><p>No cards match these filters.</p></div>`}
    <p class="store-foot">Every card plays the same however you get it. A deck holds up to 3 copies of a card, and 1 of each Cat, so the Store never sells you more than that.</p>
  </div>`;
}

function renderCardTile(p: CardProduct, have: number): string {
  const max = maxCopies(p.card);
  const want = inCart(p.id);
  const full = have >= max;
  const face = CARDS[p.card].type === 'Hero Cat' ? `${p.card}-kitten` : p.card;
  const action = full ? '<span class="have">You have them all</span>'
    : have + want >= max ? `<button class="store-btn small ghost" data-click="store:cart">In cart ✓</button>`
    : `<button class="store-btn small buy" data-click="store:add:${p.id}" aria-label="Add ${esc(cardName(p.card))} to your cart, ${price(p.price)}">
        ${want ? `+1 more` : 'Add'} · ${price(p.price)}</button>`;
  return `<div class="tile shop-tile ${full ? 'full' : ''}">
    <span class="tile-card" data-zoom="${cardUrl(face)}" data-zoom-card="${face}"><img src="${cardUrl(face)}" alt="${esc(cardName(p.card))}" loading="lazy" draggable="false" ${FALLBACK}></span>
    <span class="tile-label">${rarityMark(rarity(p.card))} Owned ${Math.min(have, max)}/${max}${want ? ` · <b>${want} in cart</b>` : ''}</span>
    ${action}
  </div>`;
}

/** A card the Store doesn't sell, under its picture. (Later, for exclusives: "Find it on the market".) */
const NOT_SOLD: Record<NotSold, string> = { exclusive: 'Promo · not sold', 'not-yet': 'Not in the Store yet', starter: 'Starter card' };

// ── A deck's missing cards ───────────────────────────────────────────────────────────────────────

/**
 * The cards a deck needs that you don't have, each with its picture and price, all picked to start with. Tap a card
 * to leave it out (or back in); the total and "Add to cart" follow what's picked.
 */
function renderMissingCards(v: Extract<View, { kind: 'missing' }>): string {
  const cat = catalog()!;
  const { plan, left, deck } = v;
  const picked = plan.lines.filter((l) => !left.has(l.product));
  const copies = picked.reduce((n, l) => n + l.qty, 0);
  const total = picked.reduce((sum, l) => sum + (cat.products[l.product]?.price ?? 0) * l.qty, 0);
  const all = plan.lines.reduce((n, l) => n + l.qty, 0);
  if (!plan.lines.length && !plan.unavailable.length) {
    return renderMessage('You have every card', `“${deck.name}” is ready to play with the cards you have.`,
      '<button class="v-wallpaper" data-click="store:builder">Back to your deck</button>');
  }
  const deal = plan.deals[0];
  return `<div class="collection-grid store-body" data-keep-scroll="store-missing">
    <div class="deck-page">
      <header class="dp-head">
        <span class="sd-set">For your deck</span>
        <h2>${esc(deck.name)}</h2>
        <p class="sd-meta">${all ? `<b>${plural(all, 'card')}</b> for sale ${all === 1 ? 'isn’t' : 'aren’t'} in your collection yet. Tap a card to leave it out.` : ''}
          ${plan.lines.length > 1 ? `<button class="link-btn inline" data-click="store:pickall">${left.size ? 'Pick them all' : 'Pick none'}</button>` : ''}</p>
      </header>
      ${deal ? `<div class="deal">
          <p><b>Better deal:</b> the ${esc(deal.name)} deck brings ${deal.covered} of these cards for ${price(deal.price)}
            <span class="deal-was">(${price(deal.singles)} one by one)</span>, plus the rest of the deck.</p>
          <button class="store-btn small buy" data-click="store:dealdeck:${deal.product}">Get the deck instead</button>
        </div>` : ''}
      <div class="grid missing-grid">
        ${plan.lines.map((l) => {
          const p = cat.products[l.product];
          if (p?.kind !== 'card') return '';
          const on = !left.has(l.product);
          const face = CARDS[p.card].type === 'Hero Cat' ? `${p.card}-kitten` : p.card;
          return `<button class="tile pick-tile ${on ? 'on' : 'off'}" data-click="store:pick:${l.product}" aria-pressed="${on}"
              aria-label="${esc(cardName(p.card))}, ${l.qty} × ${price(p.price)}${on ? '' : ', left out'}">
            <span class="tile-card"><img src="${cardUrl(face)}" alt="" loading="lazy" draggable="false" ${FALLBACK}>
              ${l.qty > 1 ? `<span class="tile-copies">×${l.qty}</span>` : ''}<span class="pick-check" aria-hidden="true">${on ? '✓' : ''}</span>
              ${on ? '' : '<span class="pick-out">Left out</span>'}</span>
            <span class="pick-price">${rarityMark(rarity(p.card))} ${l.qty > 1 ? `${l.qty} × ${price(p.price)}` : price(p.price)}</span>
          </button>`;
        }).join('')}
      </div>
      ${left.has(cardProduct(deck.hero)) ? `<p class="ct-min missing-hero">Without ${esc(cardName(deck.hero))}, its Hero Cat, this deck can’t be played.</p>` : ''}
      ${plan.unavailable.length ? `
      <h3 class="missing-sub">Not sold in the Store</h3>
      <p class="cart-note">${plan.unavailable.some((u) => u.why === 'exclusive')
        ? 'Promo and event cards are never sold. The deck can be played once you have them.'
        : 'These cards aren’t in the Store yet. The deck can be played once you have them.'}</p>
      <div class="grid missing-grid">
        ${plan.unavailable.map((u) => {
          const face = CARDS[u.card]?.type === 'Hero Cat' ? `${u.card}-kitten` : u.card;
          return `<div class="tile pick-tile unsold" data-zoom="${cardUrl(face)}" data-zoom-card="${face}">
            <span class="tile-card"><img src="${cardUrl(face)}" alt="" loading="lazy" draggable="false" ${FALLBACK}>${u.qty > 1 ? `<span class="tile-copies">×${u.qty}</span>` : ''}</span>
            <span class="pick-price">${NOT_SOLD[u.why]}</span>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>
  </div>
  <div class="buy-bar missing-bar-bottom">
    <span class="bb-total"><small>${plural(copies, 'card')}</small>${price(total)}</span>
    <button class="store-btn buy" data-click="store:addpicked" ${copies ? '' : 'disabled'}>Add to cart</button>
  </div>`;
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
