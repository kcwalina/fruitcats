// The deck builder: your decks, a new deck's Hero Cat, and the builder itself (the cards you have on
// the left, the deck on the right). The rules come from the engine (rulebook §11.1) and the copies you
// have from collection.ts. Every change is saved as it's made, and the header says so, so no work is
// ever lost; Done just goes back to your decks.

import {
  CARDS, DECKS, DECK_RULES, NEUTRAL_FAMILY, addProblem, cardName, catCount, copyLimit, deckSize, otherFamilies,
  type DeckList,
} from '@fruitcats/engine';
import { owned, ownedCards, ownedHeroes } from './collection';
import { deleteDeck, getDeck, isReady, listDecks, newDeck, problems, saveDeck, type MyDeck } from './mydecks';
import { BASE, artUrl, backButton, esc, famClass, settingsButton } from './ui';
import { familyInfo } from './sets';
import { finishFrame, yourCardUrl } from './rarity';

type Page = 'list' | 'new' | 'edit';
const TYPES = [['all', 'All'], ['Cat', 'Cats'], ['Critter', 'Critters'], ['Trick', 'Tricks'], ['Toy', 'Toys']] as const;
type TypeFilter = (typeof TYPES)[number][0];

let page: Page = 'list';
/** The deck being built, or a starter being looked at (read-only). */
let editing: MyDeck | null = null;
/** A new deck isn't stored until its first change, so backing out of an empty one leaves nothing behind. */
let isNew = false;
let starterKey: string | null = null;
let familyFilter = 'all';
let typeFilter: TypeFilter = 'all';
/** Phones: the deck list is a sheet over the cards. */
let sheetOpen = false;
/** The deck the "Delete this deck?" dialog is asking about, if it's open. */
let deleting: string | null = null;
/** What's typed in New deck's name box, used when the Hero Cat is picked (empty: "Sunny's deck"). */
let newName = '';
/** Why the last tapped card couldn't go in. */
let message = '';

export interface BuilderHost {
  render(): void;
}

/** Opening the Deck builder from Home: always your decks first. */
export function openDeckBuilder(): void {
  page = 'list';
  editing = null;
  starterKey = null;
}

const shownDeck = (): DeckList | null => editing ?? (starterKey ? DECKS[starterKey] : null);

function resetView() {
  page = 'edit';
  familyFilter = 'all';
  typeFilter = 'all';
  sheetOpen = false;
  deleting = null;
  message = '';
}

function edit(deck: MyDeck, fresh: boolean) {
  editing = deck;
  isNew = fresh;
  starterKey = null;
  resetView();
}

function leave() {
  page = 'list';
  editing = null;
  starterKey = null;
}

function save() {
  if (!editing) return;
  saveDeck(editing);
  isNew = false;
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
  save();
}

/** Clicks on `deck:<action>:<arg>`. */
export function deckClick(action: string, arg: string, host: BuilderHost): void {
  if (action !== 'add') message = '';
  switch (action) {
    case 'list': leave(); break;
    case 'new': page = 'new'; newName = ''; break;
    case 'hero': {
      if (!ownedHeroes().includes(arg)) break;
      const deck = newDeck(arg);
      const name = newName.trim().slice(0, 40);
      if (name) deck.name = name;
      edit(deck, true);
      if (name) save();   // a deck you've named is kept, even before its first card
      break;
    }
    case 'rename': break;   // the pencil: the name box is focused once the screen is drawn
    case 'open': { const deck = getDeck(arg); if (deck) edit(deck, false); break; }
    case 'starter':
      if (arg in DECKS) { editing = null; starterKey = arg; resetView(); }
      break;
    case 'add': change(arg, 1); break;
    case 'remove': change(arg, -1); break;
    case 'fam': familyFilter = arg; break;
    case 'type': typeFilter = TYPES.some(([t]) => t === arg) ? arg as TypeFilter : 'all'; break;
    case 'sheet': sheetOpen = !sheetOpen; break;
    // Deleting asks first, in a dialog: from a deck's tile in Your decks, or from inside the builder.
    case 'delete': if (getDeck(arg)) deleting = arg; break;
    case 'keep': deleting = null; break;
    case 'confirmdelete':
      if (deleting) {
        deleteDeck(deleting);
        if (editing?.id === deleting) leave();
        deleting = null;
      }
      break;
  }
  host.render();
  if (action === 'rename') {
    const input = document.querySelector<HTMLInputElement>('[data-rename]');
    input?.focus();
    input?.select();
  }
}

/** Typing in a name box: New deck's, or the builder's (which renames the deck as you type). */
export function deckInput(input: HTMLInputElement): void {
  if (input.matches('[data-newname]')) newName = input.value;
  else if (input.matches('[data-rename]')) renameDeck(input.value);
}

// Tapping a name box selects the whole name, so typing replaces it.
document.addEventListener('focusin', (event) => {
  const input = event.target as HTMLElement;
  if (input.matches?.('[data-rename], [data-newname]')) (input as HTMLInputElement).select();
});

/**
 * The deck name box, saved on every keystroke. It doesn't redraw the screen (that would drop the text
 * cursor), so the "saved" line is brought up to date by hand.
 */
export function renameDeck(name: string): void {
  if (!editing) return;
  editing.name = name.trim().slice(0, 40) || `${cardName(editing.hero)}'s deck`;
  save();
  const state = document.querySelector('.save-state');
  if (state) state.outerHTML = saveState();
}

/** Tells the player their work is kept, since there's no Save button to press. */
function saveState(): string {
  return isNew
    ? '<span class="save-state">Changes save as you go</span>'
    : '<span class="save-state saved">All changes saved ✓</span>';
}

export function renderDeckBuilder(): string {
  return renderPage() + renderDeleteDialog();
}

function renderPage(): string {
  if (page === 'new') return renderNewDeck();
  if (page === 'edit' && shownDeck()) return renderBuilder();
  page = 'list';
  return renderDeckList();
}

function renderDeleteDialog(): string {
  const deck = deleting ? getDeck(deleting) : undefined;
  if (!deck) return '';
  return `<div class="overlay">
    <div class="settings delete-dialog" role="alertdialog" aria-label="Delete deck">
      <img class="delete-art" src="${artUrl(`${deck.hero}-kitten`)}" alt="">
      <h2>Delete “${esc(deck.name)}”?</h2>
      <p>${deckSize(deck) ? `Its ${deckSize(deck)} ${deckSize(deck) === 1 ? 'card goes' : 'cards go'} back to your collection. ` : ''}This can't be undone.</p>
      <div class="delete-buttons">
        <button data-click="deck:keep">Keep it</button>
        <button class="danger" data-click="deck:confirmdelete">Delete deck</button>
      </div>
    </div>
  </div>`;
}

/** A small pencil, for renaming. */
const PENCIL = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>`;

/** A small bin, for the Delete buttons. */
const BIN = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`;

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
        <div class="deck-group-head">
          <h3>Your decks</h3>
          <a class="rules-link" href="${BASE}rules.html#11-1-deckbuilding"><img class="btn-ico" src="${BASE}ui/icon-rules.webp" alt="">Deck building rules</a>
        </div>
        <div class="deck-tiles">
          ${mine.map((d) => {
            const ready = isReady(d);
            const status = `<span class="deck-status ${ready ? 'ready' : ''}">${ready ? 'Ready to play ✓' : `${deckSize(d)} / ${DECK_RULES.size} cards`}</span>`;
            return `<div class="deck-tile-wrap">${deckTile(`deck:open:${d.id}`, d, '', status)}
              <button class="tile-delete" data-click="deck:delete:${d.id}" aria-label="Delete ${esc(d.name)}" title="Delete deck">${BIN}</button></div>`;
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
    </div>
  </div>`;
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
      <label class="new-name">
        <span>Deck name</span>
        <input data-newname value="${esc(newName)}" maxlength="40" placeholder="e.g. Citrus Rush" enterkeyhint="done" autocomplete="off">
      </label>
      <section class="picker">
        <h2>Choose its Hero Cat</h2>
        <div class="deck-choices">
          ${ownedHeroes().map((id) => {
            const hero = CARDS[id];
            return `
            <button class="deck-choice" data-click="deck:hero:${id}" data-zoom="${yourCardUrl(`${id}-kitten`)}" data-zoom-card="${id}-kitten">
              <img src="${yourCardUrl(`${id}-kitten`)}" alt="${esc(hero.name)}">
              <img class="deck-art ${finishFrame(id)}" src="${artUrl(`${id}-kitten`)}" alt="">
              <span class="deck-name">${esc(cardName(id))}</span>
              <span class="deck-class ${famClass(id)}">${esc(hero.family)} · ${esc(familyInfo(hero.family)?.mechanic ?? '')}</span>
              <span class="deck-blurb">${esc(capitalize(familyInfo(hero.family)?.hint ?? ''))}.</span>
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

  // Your own deck: its name (tap to rename) with the "saved" line under it, and Done at the top right
  // where a phone's thumb and eye expect it. A starter: a way back, then its name.
  const portrait = `<img class="bar-hero ${famClass(deck.hero)}" src="${artUrl(`${deck.hero}-kitten`)}" alt="${esc(cardName(deck.hero))}"
      data-zoom="${yourCardUrl(`${deck.hero}-kitten`)}" data-zoom-card="${deck.hero}-kitten">`;
  const bar = readOnly
    ? `${backButton('deck:list', 'Your decks')}${portrait}
      <div class="build-title"><h2>${esc(deck.name)}</h2><span class="save-state">Starter deck · can't be changed</span></div>`
    : `${portrait}<div class="build-title">
        <label class="name-edit">
          <input class="deck-name-input" data-rename value="${esc(deck.name)}" maxlength="40" aria-label="Deck name" enterkeyhint="done" autocomplete="off">
          <button class="name-pencil" data-click="deck:rename" aria-label="Rename deck" title="Rename deck">${PENCIL}</button>
        </label>
        ${saveState()}
      </div>
      <button class="primary done-deck" data-click="deck:list">Done</button>`;

  return `
  <div class="menu decks builder ${readOnly ? 'read-only' : ''} ${sheetOpen ? 'sheet-open' : ''}">
    <div class="setup-bar build-bar">${bar}</div>
    <div class="build-head">
      <div class="build-lead">
        <span><b>${esc(cardName(deck.hero))}</b> leads · ${esc([CARDS[deck.hero].family, ...otherFamilies(deck), NEUTRAL_FAMILY].join(' + '))}</span>
      </div>
      <div class="build-count"><b>${size}</b> / ${DECK_RULES.size} cards · Cats <b>${catCount(deck)}</b> / ${DECK_RULES.maxCats}</div>
      ${status}
    </div>
    ${readOnly ? '' : renderFilters(order)}
    ${message ? `<p class="build-message" role="status">${esc(message)}</p>` : ''}
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
  // Two rows of equal buttons (family, then type) that always fit a phone's width.
  return `
    <div class="filters">
      <div class="chip-row" role="group" aria-label="Family" style="--n:${order.length + 1}">${chip('fam', 'all', 'All', familyFilter === 'all')}${order.map((f) =>
        chip('fam', f, f, familyFilter === f, `fam-${f.toLowerCase()}`)).join('')}</div>
      <div class="chip-row" role="group" aria-label="Card type" style="--n:${TYPES.length}">${TYPES.map(([t, label]) => chip('type', t, label, typeFilter === t)).join('')}</div>
    </div>`;
}

function renderPoolCard(deck: DeckList, id: string, readOnly: boolean): string {
  const name = CARDS[id].name;
  const count = deck.cards[id] ?? 0;
  if (readOnly) {
    return `<div class="pool-card"><div class="pool-face" data-zoom="${yourCardUrl(id)}" data-zoom-card="${id}">
      <img src="${yourCardUrl(id)}" alt="${esc(name)}" decoding="async"></div>
      <span class="pool-count">×${count}</span></div>`;
  }
  const usable = Math.min(copyLimit(id), owned(id));
  const maxed = count >= usable;
  const blocked = !maxed && addProblem(deck, id, owned, true) !== null;
  const pips = Array.from({ length: usable }, (_, i) => `<i class="${i < count ? 'on' : ''}"></i>`).join('');
  return `
    <div class="pool-card ${blocked ? 'blocked' : ''} ${maxed ? 'maxed' : ''} ${count ? 'in-deck' : ''}">
      <button class="pool-face" data-click="deck:add:${id}" data-zoom="${yourCardUrl(id)}" data-zoom-card="${id}"
        aria-label="Add ${esc(name)} (${count} of ${usable} in deck)">
        <img src="${yourCardUrl(id)}" alt="" decoding="async"></button>
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
          <span class="toggle-count"><span>Deck <b>${size}</b> / ${DECK_RULES.size}</span><small>Cats ${catCount(deck)} / ${DECK_RULES.maxCats}</small></span>
          <span class="toggle-status ${ready ? 'ready' : ''}">${ready ? 'Ready to play ✓' : size < DECK_RULES.size ? `${DECK_RULES.size - size} to go` : 'Needs a fix'}</span>
          <span class="toggle-arrow" aria-hidden="true">${sheetOpen ? '▼' : '▲'}</span>
        </button>
        <div class="deck-panel-body">
          <p class="sheet-lead"><b>${esc(cardName(deck.hero))}</b> leads · ${esc([CARDS[deck.hero].family, ...otherFamilies(deck), NEUTRAL_FAMILY].join(' + '))}</p>
          <div class="curve" aria-label="Cards by cost">
            ${buckets.map((n, i) => `<div class="curve-col"><span class="curve-n">${n || ''}</span>
              <span class="curve-bar" style="height:${Math.round((n / tallest) * 100)}%"></span><span class="curve-cost">${i === 6 ? '7+' : i + 1}</span></div>`).join('')}
          </div>
          <ul class="deck-lines" data-keep-scroll="deck">
            ${ids.length ? ids.map((id) => `
              <li class="${famClass(id)}" data-zoom="${yourCardUrl(id)}" data-zoom-card="${id}">
                <span class="line-cost">${CARDS[id].cost ?? ''}</span>
                <span class="line-name">${esc(cardName(id))}${CARDS[id].type === 'Cat' ? ' <small>Cat</small>' : ''}</span>
                ${readOnly ? `<span class="line-qty">×${deck.cards[id]}</span>` : `
                <button class="line-btn" data-click="deck:remove:${id}" aria-label="Remove one ${esc(cardName(id))}">−</button>
                <span class="line-qty">${deck.cards[id]}</span>
                <button class="line-btn" data-click="deck:add:${id}" aria-label="Add one ${esc(cardName(id))}" ${addProblem(deck, id, owned, true) ? 'disabled' : ''}>+</button>`}
              </li>`).join('') : '<li class="deck-empty">Tap cards to add them to your deck.</li>'}
          </ul>
          ${readOnly || isNew ? '' : `
          <div class="deck-actions">
            <button class="delete-deck" data-click="deck:delete:${editing!.id}">${BIN} Delete deck</button>
          </div>`}
        </div>
      </aside>`;
}
