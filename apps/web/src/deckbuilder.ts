// The deck builder: your decks, a new deck's Hero Cat, and the builder itself (the cards you have on
// the left, the deck on the right). The rules come from the engine (rulebook §11.1) and the copies you
// have from collection.ts; decks are saved as you go.

import {
  CARDS, DECKS, DECK_RULES, NEUTRAL_FAMILY, addProblem, cardName, catCount, copyLimit, deckSize, otherFamilies,
  type DeckList,
} from '@fruitcats/engine';
import { owned, ownedCards, ownedHeroes } from './collection';
import { createDeck, customKey, deleteDeck, getDeck, isReady, listDecks, problems, saveDeck, type MyDeck } from './mydecks';
import { FAMILY_INFO, artUrl, backButton, cardUrl, esc, famClass, settingsButton } from './ui';

type Page = 'list' | 'new' | 'edit';
const TYPES = [['all', 'All types'], ['Cat', 'Cats'], ['Critter', 'Critters'], ['Trick', 'Tricks'], ['Toy', 'Toys']] as const;
type TypeFilter = (typeof TYPES)[number][0];

let page: Page = 'list';
/** The deck being built, or a starter being looked at (read-only). */
let editing: MyDeck | null = null;
let starterKey: string | null = null;
let familyFilter = 'all';
let typeFilter: TypeFilter = 'all';
/** Phones: the deck list is a sheet over the cards. */
let sheetOpen = false;
let confirmingDelete = false;
/** Why the last tapped card couldn't go in. */
let message = '';

export interface BuilderHost {
  render(): void;
  /** Leave for the Solo screen with this deck chosen. */
  playWith(key: string): void;
}

/** Opening the Deck builder from Home: always your decks first. */
export function openDeckBuilder(): void {
  page = 'list';
  editing = null;
  starterKey = null;
}

const shownDeck = (): DeckList | null => editing ?? (starterKey ? DECKS[starterKey] : null);

function edit(deck: MyDeck) {
  editing = deck;
  starterKey = null;
  page = 'edit';
  familyFilter = 'all';
  typeFilter = 'all';
  sheetOpen = false;
  confirmingDelete = false;
  message = '';
}

function change(id: string, delta: number) {
  if (!editing) return;
  if (delta > 0) {
    const why = addProblem(editing, id, owned);
    if (why) { message = why; return; }
  }
  const qty = (editing.cards[id] ?? 0) + delta;
  if (qty > 0) editing.cards[id] = qty;
  else delete editing.cards[id];
  message = '';
  saveDeck(editing);
}

/** Clicks on `deck:<action>:<arg>`. */
export function deckClick(action: string, arg: string, host: BuilderHost): void {
  if (action !== 'delete') confirmingDelete = false;
  switch (action) {
    case 'list': page = 'list'; editing = null; starterKey = null; break;
    case 'new': page = 'new'; break;
    case 'hero': if (ownedHeroes().includes(arg)) edit(createDeck(arg)); break;
    case 'open': { const deck = getDeck(arg); if (deck) edit(deck); break; }
    case 'starter':
      if (arg in DECKS) { editing = null; starterKey = arg; page = 'edit'; familyFilter = 'all'; typeFilter = 'all'; sheetOpen = false; message = ''; }
      break;
    case 'add': change(arg, 1); break;
    case 'remove': change(arg, -1); break;
    case 'fam': familyFilter = arg; break;
    case 'type': typeFilter = TYPES.some(([t]) => t === arg) ? arg as TypeFilter : 'all'; break;
    case 'sheet': sheetOpen = !sheetOpen; break;
    case 'delete':
      if (!editing) break;
      if (!confirmingDelete) { confirmingDelete = true; break; }
      deleteDeck(editing.id);
      confirmingDelete = false;
      page = 'list';
      editing = null;
      break;
    case 'play': {
      const key = editing ? customKey(editing.id) : starterKey;
      const deck = shownDeck();
      if (key && deck && isReady(deck)) { host.playWith(key); return; }
      break;
    }
  }
  host.render();
}

/** The deck name box: saved when you leave it, without redrawing (you may be tapping a card). */
export function renameDeck(name: string): void {
  if (!editing) return;
  editing.name = name.trim().slice(0, 40) || `${cardName(editing.hero)}'s deck`;
  saveDeck(editing);
}

export function renderDeckBuilder(): string {
  if (page === 'new') return renderNewDeck();
  if (page === 'edit' && shownDeck()) return renderBuilder();
  page = 'list';
  return renderDeckList();
}

// ── Your decks ───────────────────────────────────────────────────────────────────────────────────

function deckTile(click: string, deck: DeckList, tag: string, status = ''): string {
  const hero = CARDS[deck.hero];
  const families = [hero.family, ...otherFamilies(deck)].join(' + ');
  return `
    <button class="deck-tile ${famClass(deck.hero)}" data-click="${click}">
      <img class="deck-tile-art" src="${artUrl(`${deck.hero}-kitten`)}" alt="">
      <span class="deck-tile-text">
        <span class="deck-name">${esc(deck.name)}</span>
        <span class="deck-tile-sub"><span class="deck-class">${esc(families)}</span> ${tag}</span>
        ${status}
      </span>
    </button>`;
}

function renderDeckList(): string {
  const mine = listDecks();
  return `
  <div class="menu decks">
    <div class="setup-bar">
      ${backButton()}
      <h2>Deck builder</h2>
      ${settingsButton()}
    </div>
    <div class="decks-body">
      <section class="deck-group">
        <h3>Your decks</h3>
        <div class="deck-tiles">
          ${mine.map((d) => {
            const ready = isReady(d);
            const status = `<span class="deck-status ${ready ? 'ready' : ''}">${ready ? 'Ready to play ✓' : `${deckSize(d)} / ${DECK_RULES.size} cards`}</span>`;
            return deckTile(`deck:open:${d.id}`, d, '', status);
          }).join('')}
          <button class="deck-tile new-deck" data-click="deck:new">
            <span class="new-plus" aria-hidden="true">+</span>
            <span class="deck-tile-text"><span class="deck-name">New deck</span>
              <span class="deck-tile-sub">Pick a Hero Cat, then ${DECK_RULES.size} cards</span></span>
          </button>
        </div>
      </section>
      <section class="deck-group">
        <h3>Starter decks</h3>
        <div class="deck-tiles">
          ${Object.entries(DECKS).map(([key, d]) => deckTile(`deck:starter:${key}`, d, '<span class="starter-tag">Starter</span>')).join('')}
        </div>
      </section>
      ${renderRules()}
    </div>
  </div>`;
}

/** The deck rules in a few lines, for anyone who hasn't built a deck before. */
function renderRules(): string {
  return `
      <details class="deck-rules">
        <summary>How deck building works</summary>
        <ul>
          <li>A deck is <b>1 Hero Cat</b> and exactly <b>${DECK_RULES.size} cards</b>.</li>
          <li>Cards come from your Hero Cat's family, <b>one other family</b> if you like, and <b>Garden</b>, which fits every deck.</li>
          <li>Up to <b>${DECK_RULES.copies} copies</b> of a card. <b>Cats</b> are one of a kind: 1 copy each, and at most ${DECK_RULES.maxCats} Cats.</li>
          <li>You can use only the copies you have. You start with the cards from all three starter decks.</li>
        </ul>
      </details>`;
}

// ── New deck: choose its Hero Cat ────────────────────────────────────────────────────────────────

function renderNewDeck(): string {
  return `
  <div class="menu decks newdeck">
    <div class="setup-bar">
      ${backButton('deck:list', 'Your decks')}
      <h2>New deck</h2>
      ${settingsButton()}
    </div>
    <div class="setup-body">
      <section class="picker">
        <h2>Choose its Hero Cat</h2>
        <div class="deck-choices">
          ${ownedHeroes().map((id) => {
            const hero = CARDS[id];
            return `
            <button class="deck-choice" data-click="deck:hero:${id}" data-zoom="${cardUrl(`${id}-kitten`)}" data-zoom-card="${id}-kitten">
              <img src="${cardUrl(`${id}-kitten`)}" alt="${esc(hero.name)}">
              <img class="deck-art" src="${artUrl(`${id}-kitten`)}" alt="">
              <span class="deck-name">${esc(cardName(id))}</span>
              <span class="deck-class ${famClass(id)}">${esc(hero.family)} · ${esc(FAMILY_INFO[hero.family]?.mechanic ?? '')}</span>
              <span class="deck-blurb">${esc(capitalize(FAMILY_INFO[hero.family]?.hint ?? ''))}.</span>
            </button>`;
          }).join('')}
        </div>
      </section>
    </div>
  </div>`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── The builder ──────────────────────────────────────────────────────────────────────────────────

/** Hero Cat's family first, then the other fruit families, then Garden. */
function familyOrder(deck: DeckList): string[] {
  const heroFamily = CARDS[deck.hero].family;
  const families = [...new Set(ownedCards().map((id) => CARDS[id].family))];
  const fruit = families.filter((f) => f !== heroFamily && f !== NEUTRAL_FAMILY);
  return [heroFamily, ...fruit, ...(families.includes(NEUTRAL_FAMILY) ? [NEUTRAL_FAMILY] : [])];
}

function sortCards(ids: string[], order: string[]): string[] {
  return [...ids].sort((a, b) => order.indexOf(CARDS[a].family) - order.indexOf(CARDS[b].family)
    || (CARDS[a].cost ?? 0) - (CARDS[b].cost ?? 0) || a.localeCompare(b));
}

function renderBuilder(): string {
  const deck = shownDeck()!;
  const readOnly = !editing;
  const order = familyOrder(deck);
  const size = deckSize(deck);
  const issues = problems(deck);
  const ready = issues.length === 0;

  const pool = readOnly
    ? sortCards(Object.keys(deck.cards), order)
    : sortCards(ownedCards(), order).filter((id) =>
      (familyFilter === 'all' || CARDS[id].family === familyFilter) && (typeFilter === 'all' || CARDS[id].type === typeFilter));

  const status = readOnly
    ? `<span class="build-status ready">Starter deck · ${size} cards · fixed</span>`
    : `<span class="build-status ${ready ? 'ready' : ''}">${ready ? 'Ready to play ✓' : esc(issues[0])}</span>`;

  const title = readOnly
    ? `<h2>${esc(deck.name)}</h2>`
    : `<input class="deck-name-input" data-rename value="${esc(deck.name)}" maxlength="40" aria-label="Deck name" enterkeyhint="done">`;

  return `
  <div class="menu decks builder ${readOnly ? 'read-only' : ''} ${sheetOpen ? 'sheet-open' : ''}">
    <div class="setup-bar">
      ${backButton('deck:list', 'Your decks')}
      ${title}
      ${settingsButton()}
    </div>
    <div class="build-head">
      <div class="build-lead ${famClass(deck.hero)}">
        <img src="${artUrl(`${deck.hero}-kitten`)}" alt="" data-zoom="${cardUrl(`${deck.hero}-kitten`)}" data-zoom-card="${deck.hero}-kitten">
        <span><b>${esc(cardName(deck.hero))}</b> leads · ${esc([CARDS[deck.hero].family, ...otherFamilies(deck), NEUTRAL_FAMILY].join(' + '))}</span>
      </div>
      <div class="build-count"><b>${size}</b> / ${DECK_RULES.size} cards · Cats <b>${catCount(deck)}</b> / ${DECK_RULES.maxCats}</div>
      ${status}
      ${message ? `<p class="flash build-message" role="status">${esc(message)}</p>` : ''}
    </div>
    ${readOnly ? '' : renderFilters(order)}
    <div class="build-main">
      <div class="pool" data-keep-scroll="pool">
        ${pool.length ? pool.map((id) => renderPoolCard(deck, id, readOnly)).join('') : '<p class="pool-empty">No cards match these filters.</p>'}
      </div>
      ${renderDeckPanel(deck, order, readOnly, ready)}
    </div>
  </div>`;
}

function renderFilters(order: string[]): string {
  const chip = (group: string, value: string, label: string, active: boolean, cls = '') =>
    `<button class="chip ${cls} ${active ? 'chosen' : ''}" data-click="deck:${group}:${value}" aria-pressed="${active}">${esc(label)}</button>`;
  return `
    <div class="filters">
      <div class="chip-row">${chip('fam', 'all', 'All families', familyFilter === 'all')}${order.map((f) =>
        chip('fam', f, f, familyFilter === f, `fam-${f.toLowerCase()}`)).join('')}</div>
      <div class="chip-row">${TYPES.map(([t, label]) => chip('type', t, label, typeFilter === t)).join('')}</div>
    </div>`;
}

function renderPoolCard(deck: DeckList, id: string, readOnly: boolean): string {
  const name = CARDS[id].name;
  const count = deck.cards[id] ?? 0;
  if (readOnly) {
    return `<div class="pool-card"><div class="pool-face" data-zoom="${cardUrl(id)}" data-zoom-card="${id}">
      <img src="${cardUrl(id)}" alt="${esc(name)}" decoding="async"></div>
      <span class="pool-count">×${count}</span></div>`;
  }
  const usable = Math.min(copyLimit(id), owned(id));
  const blocked = addProblem(deck, id, owned, true) !== null;
  const pips = Array.from({ length: usable }, (_, i) => `<i class="${i < count ? 'on' : ''}"></i>`).join('');
  return `
    <div class="pool-card ${blocked ? 'blocked' : ''} ${count ? 'in-deck' : ''}">
      <button class="pool-face" data-click="deck:add:${id}" data-zoom="${cardUrl(id)}" data-zoom-card="${id}"
        aria-label="Add ${esc(name)} (${count} of ${usable} in deck)">
        <img src="${cardUrl(id)}" alt="" decoding="async"></button>
      <div class="pool-foot">
        <span class="pips" title="${count} of ${usable} in your deck">${pips}</span>
        ${count ? `<button class="pool-remove" data-click="deck:remove:${id}" aria-label="Remove one ${esc(name)}">−</button>` : ''}
      </div>
    </div>`;
}

function renderDeckPanel(deck: DeckList, order: string[], readOnly: boolean, ready: boolean): string {
  const ids = sortCards(Object.keys(deck.cards), order).sort((a, b) => (CARDS[a].cost ?? 0) - (CARDS[b].cost ?? 0));
  const size = deckSize(deck);
  // The cost curve: how many cards at each cost, 7 and up together.
  const buckets = Array.from({ length: 7 }, () => 0);
  for (const id of ids) buckets[Math.min(Math.max(CARDS[id].cost ?? 0, 1), 7) - 1] += deck.cards[id];
  const tallest = Math.max(1, ...buckets);
  return `
      <aside class="deck-panel">
        <button class="deck-toggle" data-click="deck:sheet" aria-expanded="${sheetOpen}">
          <span>Deck <b>${size}</b> / ${DECK_RULES.size}</span><span class="toggle-arrow" aria-hidden="true">${sheetOpen ? '▼' : '▲'}</span>
        </button>
        <div class="deck-panel-body">
          <div class="curve" aria-label="Cards by cost">
            ${buckets.map((n, i) => `<div class="curve-col"><span class="curve-n">${n || ''}</span>
              <span class="curve-bar" style="height:${Math.round((n / tallest) * 100)}%"></span><span class="curve-cost">${i === 6 ? '7+' : i + 1}</span></div>`).join('')}
          </div>
          <ul class="deck-lines" data-keep-scroll="deck">
            ${ids.length ? ids.map((id) => `
              <li class="${famClass(id)}" data-zoom="${cardUrl(id)}" data-zoom-card="${id}">
                <span class="line-cost">${CARDS[id].cost ?? ''}</span>
                <span class="line-name">${esc(cardName(id))}${CARDS[id].type === 'Cat' ? ' <small>Cat</small>' : ''}</span>
                ${readOnly ? `<span class="line-qty">×${deck.cards[id]}</span>` : `
                <button class="line-btn" data-click="deck:remove:${id}" aria-label="Remove one ${esc(cardName(id))}">−</button>
                <span class="line-qty">${deck.cards[id]}</span>
                <button class="line-btn" data-click="deck:add:${id}" aria-label="Add one ${esc(cardName(id))}">+</button>`}
              </li>`).join('') : '<li class="deck-empty">Tap cards to add them to your deck.</li>'}
          </ul>
          <div class="deck-actions">
            <button class="play-button" data-click="deck:play" ${ready ? '' : 'disabled'}>Play Solo with this deck</button>
            ${readOnly ? '' : `<button class="delete-deck ${confirmingDelete ? 'confirming' : ''}" data-click="deck:delete">${confirmingDelete ? 'Tap again to delete' : 'Delete deck'}</button>`}
          </div>
        </div>
      </aside>`;
}
