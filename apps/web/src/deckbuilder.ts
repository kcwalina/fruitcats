// The deck builder: your decks, decks to copy (ready-made ones and yours; a copy remembers the deck it came from and
// marks what's different), a new deck's Hero Cat, and the builder itself (the cards you have on
// the left, the deck on the right). The rules come from the engine (rulebook §11.1) and the copies you
// have from collection.ts. Every change is saved as it's made, and the header says so, so no work is
// ever lost; Done just goes back to your decks.

import {
  CARDS, DECKS, DECK_RULES, NEUTRAL_FAMILY, addProblem, builtInTwin, cardName, catCount, copyLimit, deckChanges, deckCode,
  deckSize, otherFamilies, parseDeckCode, sameCards, type DeckList,
} from '@fruitcats/engine';
import { missingForDeck } from '@fruitcats/store';
import { owned, ownedCards, ownedHeroes } from './collection';
import { STORE } from './flags';
import { catalog, storeAccess } from './shop';
import { copyDeck, customKey, deleteDeck, getDeck, isReady, listDecks, newDeck, ownedDeckKeys, problems, saveDeck, type MyDeck } from './mydecks';
import { BASE, artUrl, backButton, esc, famClass, settingsButton } from './ui';
import { familyInfo } from './sets';
import { finishFrame, yourCardUrl } from './rarity';

type Page = 'list' | 'new' | 'edit';
const TYPES = [['all', 'All'], ['Cat', 'Cats'], ['Critter', 'Critters'], ['Trick', 'Tricks'], ['Toy', 'Toys']] as const;
type TypeFilter = (typeof TYPES)[number][0];

let page: Page = 'list';
/** The deck being built. */
let editing: MyDeck | null = null;
/** A new deck isn't stored until its first change, so backing out of an empty one leaves nothing behind. */
let isNew = false;
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
/** "Deck from a code": open, what's typed in it, and why it wasn't taken. */
let importing = false;
let importText = '';
let importError = '';
/** "Copied" under Copy deck code, until the next tap. */
let codeNote = '';
/** Done was tapped on a deck that is the same as a ready-made deck or the deck it was copied from: the dialog saying it isn't kept. */
let twinAsk = false;

export interface BuilderHost {
  render(): void;
  /** Open the Store with this deck's missing cards in the cart. */
  openStore?(deck: DeckList): void;
}

/** Copies of the deck's cards (its Hero Cat too) the player doesn't have yet. */
const missingCopies = (deck: DeckList) => Object.values(missingForDeck(deck, owned)).reduce((a, b) => a + b, 0);
/** The Store can sell cards to this player (it's built in and open to them). */
const canShop = () => STORE && storeAccess() === 'open' && !!catalog();

/** Opening the Deck builder from Home: always your decks first. */
export function openDeckBuilder(): void {
  page = 'list';
  editing = null;
}

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
  resetView();
}

function leave() {
  twinAsk = false;
  page = 'list';
  editing = null;
}

/**
 * The deck this one has exactly the same cards as, so there's no point keeping it: a ready-made deck, or the deck it
 * was copied from (as it was then). Its name, and whether it's ready-made; null when the deck is its own.
 */
function twinOf(deck: MyDeck): { name: string; readyMade: boolean } | null {
  const key = builtInTwin(deck);
  if (key) return { name: DECKS[key].name, readyMade: true };
  if (deck.from && sameCards(deck, { ...deck.from, hero: deck.hero })) return { name: deck.from.name, readyMade: false };
  return null;
}

function save() {
  // A deck that is a copy of another with nothing changed isn't kept. What's stored stays as it was before, until a
  // change makes the deck different again.
  if (!editing || twinOf(editing)) return;
  saveDeck(editing);
  isNew = false;
}

/** Done: back to your decks, unless the deck is only a copy, which gets a word first. */
function done() {
  if (editing && twinOf(editing)) twinAsk = true;
  else leave();
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
  codeNote = '';
  switch (action) {
    case 'list': leave(); break;
    case 'done': done(); break;
    case 'twinstay': twinAsk = false; break;
    case 'twinleave': twinAsk = false; leave(); break;
    // A ready-made deck or one of yours, copied into a new deck to change. It's kept once it's different.
    case 'copy': { const deck = copyDeck(arg); if (deck) edit(deck, true); break; }
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
    case 'add': change(arg, 1); break;
    case 'remove': change(arg, -1); break;
    case 'fam': familyFilter = arg; break;
    case 'type': typeFilter = TYPES.some(([t]) => t === arg) ? arg as TypeFilter : 'all'; break;
    case 'sheet': sheetOpen = !sheetOpen; break;
    // Deleting asks first, in a dialog: from a deck's tile in Your decks, or from inside the builder.
    case 'delete': if (getDeck(arg)) deleting = arg; break;
    case 'keep': deleting = null; break;
    // A deck code (FC1.…) is a whole deck on one line: copied out of the builder, pasted into Your decks.
    case 'copycode': {
      const deck = editing;
      if (!deck) break;
      void copyText(deckCode(deck)).then((ok) => {
        codeNote = ok ? 'Copied. Paste it anywhere to share this deck.' : 'Couldn’t copy it here.';
        host.render();
      });
      return;
    }
    case 'import': importing = true; importText = ''; importError = ''; break;
    // A deck with cards you don't have yet: the Store, with them in the cart.
    case 'shop': { const deck = editing; if (deck && host.openStore) { host.openStore(deck); return; } break; }
    case 'cancelimport': importing = false; break;
    case 'doimport':
      importDeck();
      if (importedWithMissing && editing && host.openStore) { importedWithMissing = false; host.openStore(editing); return; }
      break;
    case 'confirmdelete':
      if (deleting) {
        deleteDeck(deleting);
        if (editing?.id === deleting) leave();
        deleting = null;
      }
      break;
  }
  host.render();
  // The code box is ready for a paste as soon as it opens, and again after a code it couldn't read.
  if (importing && (action === 'import' || action === 'doimport')) document.querySelector<HTMLTextAreaElement>('[data-deckcode]')?.focus();
  if (action === 'rename') {
    const input = document.querySelector<HTMLInputElement>('[data-rename]');
    input?.focus();
    input?.select();
  }
}

/** Typing in a name box: New deck's, or the builder's (which renames the deck as you type); or a deck code. */
export function deckInput(input: HTMLInputElement): void {
  if (input.matches('[data-deckcode]')) { importText = input.value; return; }
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

/** The clipboard API needs permission and a secure context; the old textarea trick works nearly everywhere else. */
function copyText(text: string): Promise<boolean> {
  const legacy = () => {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:none;padding:0';
    document.body.append(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    return ok;
  };
  if (!navigator.clipboard) return Promise.resolve(legacy());
  return navigator.clipboard.writeText(text).then(() => true, () => legacy());
}

/**
 * A pasted deck code becomes one of your decks, opened in the builder. Cards this game doesn't know are left
 * out; cards you don't have yet stay in, and the builder says which (it can't be played until you have them).
 */
function importDeck(): void {
  const parsed = parseDeckCode(importText.replace(/\s+/g, ''));
  if (!parsed) { importError = 'That isn’t a deck code. Copy the whole code and paste it here.'; return; }
  if (CARDS[parsed.hero]?.type !== 'Hero Cat') { importError = 'This deck’s Hero Cat isn’t in the game yet.'; return; }
  const twin = builtInTwin(parsed);
  if (twin) { importError = `That’s ${DECKS[twin].name}, a ready-made deck. It’s already in the game: find it under Start from a deck.`; return; }
  const deck = newDeck(parsed.hero);
  deck.name = parsed.name.slice(0, 40);
  deck.cards = Object.fromEntries(Object.entries(parsed.cards).filter(([id]) => CARDS[id] && CARDS[id].type !== 'Hero Cat'));
  importing = false;
  edit(deck, false);
  save();
  importedWithMissing = canShop() && missingCopies(deck) > 0;
}
/** A deck from a code that needs cards you don't have: the builder goes on to show them in the Store. */
let importedWithMissing = false;

/** Tells the player their work is kept, since there's no Save button to press. */
function saveState(): string {
  const twin = editing && twinOf(editing);
  if (twin) return `<span class="save-state twin">Same as ${esc(twin.name)} · change a card to keep it</span>`;
  return isNew
    ? '<span class="save-state">Changes save as you go</span>'
    : '<span class="save-state saved">All changes saved ✓</span>';
}

export function renderDeckBuilder(): string {
  return renderPage() + renderDeleteDialog() + (importing && page === 'list' ? renderImportDialog() : '')
    + (twinAsk && page === 'edit' ? renderTwinDialog() : '');
}

/** Done on a deck that is only a copy (nothing changed): it isn't kept, and here's why. */
function renderTwinDialog(): string {
  const twin = editing && twinOf(editing);
  if (!editing || !twin) { twinAsk = false; return ''; }
  return `<div class="overlay">
    <div class="settings delete-dialog" role="alertdialog" aria-label="Nothing changed">
      <img class="delete-art" src="${artUrl(`${editing.hero}-kitten`)}" alt="">
      <h2>Same as ${esc(twin.name)}</h2>
      <p>It has the same cards as ${twin.readyMade ? `${esc(twin.name)}, a ready-made deck that’s already in the game`
        : `your deck ${esc(twin.name)}`}, so it isn’t kept. Change a card to make it your own.${isNew ? '' : ' If you leave, your deck stays as it was before.'}</p>
      <div class="delete-buttons">
        <button data-click="deck:twinleave">Leave</button>
        <button class="primary" data-click="deck:twinstay">Change a card</button>
      </div>
    </div>
  </div>`;
}

function renderImportDialog(): string {
  return `<div class="overlay">
    <div class="settings delete-dialog import-dialog" role="dialog" aria-label="Deck from a code">
      <h2>Deck from a code</h2>
      <p>Paste a deck code someone shared. It becomes one of your decks.</p>
      <textarea class="code-box" data-deckcode rows="4" placeholder="FC1.…" spellcheck="false" autocomplete="off" autocapitalize="off">${esc(importText)}</textarea>
      ${importError ? `<p class="import-error" role="alert">${esc(importError)}</p>` : ''}
      <div class="delete-buttons">
        <button data-click="deck:cancelimport">Cancel</button>
        <button class="primary" data-click="deck:doimport">Add deck</button>
      </div>
    </div>
  </div>`;
}

function renderPage(): string {
  if (page === 'new') return renderNewDeck();
  if (page === 'edit' && editing) return renderBuilder(editing);
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

/** Two chain links, for deck codes. */
const CODE = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>`;

/** A small bin, for the Delete buttons. */
const BIN = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`;

// ── Your decks ───────────────────────────────────────────────────────────────────────────────────

/** A deck as a tile: tap it to open it (your decks) or, under Start from a deck, to copy it (`copy`). */
function deckTile(click: string, deck: DeckList, tag: string, status = '', copy = false): string {
  const hero = CARDS[deck.hero];
  const families = [hero.family, ...otherFamilies(deck)].join(' + ');
  return `
    <button class="deck-tile ${famClass(deck.hero)}" data-click="${click}" ${copy ? `aria-label="Copy ${esc(deck.name)}"` : ''}>
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
        <div class="deck-tiles">
          ${mine.map((d) => {
            const ready = isReady(d);
            const missing = ready ? 0 : missingCopies(d);
            const status = `<span class="deck-status ${ready ? 'ready' : ''}">${ready ? 'Ready to play ✓'
              : missing ? `Missing ${missing} ${missing === 1 ? 'card' : 'cards'}` : `${deckSize(d)} / ${DECK_RULES.size} cards`}</span>`;
            const from = d.from ? `<span class="from-tag">From ${esc(d.from.name)}</span>` : '';
            return `<div class="deck-tile-wrap">${deckTile(`deck:open:${d.id}`, d, from, status)}
              <button class="tile-delete" data-click="deck:delete:${d.id}" aria-label="Delete ${esc(d.name)}" title="Delete deck">${BIN}</button></div>`;
          }).join('')}
          <button class="deck-tile new-deck" data-click="deck:new">
            <span class="new-plus" aria-hidden="true">+</span>
            <span class="deck-tile-text"><span class="deck-name">New deck</span>
              <span class="deck-tile-sub">Pick a Hero Cat, then ${DECK_RULES.size} cards</span></span>
          </button>
          <button class="deck-tile new-deck" data-click="deck:import">
            <span class="new-plus code-plus" aria-hidden="true">${CODE}</span>
            <span class="deck-tile-text"><span class="deck-name">Deck from a code</span>
              <span class="deck-tile-sub">Paste a code someone shared</span></span>
          </button>
          <a class="deck-tile new-deck rules-tile" href="${BASE}rules.html#11-1-deckbuilding">
            <img class="new-plus rules-plus" src="${BASE}ui/icon-rules.webp" alt="">
            <span class="deck-tile-text"><span class="deck-name">Deck building rules</span>
              <span class="deck-tile-sub">What a deck can hold</span></span>
          </a>
        </div>
      </section>
      <section class="deck-group">
        <h3>Start from a deck</h3>
        <div class="deck-tiles">
          ${ownedDeckKeys().map((key) => [key, DECKS[key]] as const).map(([key, d]) => deckTile(`deck:copy:${key}`, d, '<span class="starter-tag">Ready-made</span>', '', true)).join('')}
          ${mine.filter((d) => deckSize(d) > 0).map((d) => deckTile(`deck:copy:${customKey(d.id)}`, d, '<span class="mine-tag">Your deck</span>', '', true)).join('')}
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
      ${backButton('deck:list', 'Deck builder')}
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

function renderBuilder(deck: MyDeck): string {
  // A copy of another deck: that deck as it was then, to show what's different from it.
  const base: DeckList | null = deck.from ? { ...deck.from, hero: deck.hero } : null;
  const order = familyOrder(deck);
  const size = deckSize(deck);
  const issues = problems(deck);
  const ready = issues.length === 0;

  const pool = sortCards(ownedCards(), order).filter((id) =>
    (familyFilter === 'all' || CARDS[id].family === familyFilter) && (typeFilter === 'all' || CARDS[id].type === typeFilter));

  const status = `<span class="build-status ${ready ? 'ready' : ''}">${ready ? 'Ready to play ✓' : esc(issues[0])}</span>`;

  // The deck's name (tap to rename) with the "saved" line under it, and Done at the top right where a phone's thumb
  // and eye expect it.
  const portrait = `<img class="bar-hero ${famClass(deck.hero)}" src="${artUrl(`${deck.hero}-kitten`)}" alt="${esc(cardName(deck.hero))}"
      data-zoom="${yourCardUrl(`${deck.hero}-kitten`)}" data-zoom-card="${deck.hero}-kitten">`;
  const bar = `${portrait}<div class="build-title">
        <label class="name-edit">
          <input class="deck-name-input" data-rename value="${esc(deck.name)}" maxlength="40" aria-label="Deck name" enterkeyhint="done" autocomplete="off">
          <button class="name-pencil" data-click="deck:rename" aria-label="Rename deck" title="Rename deck">${PENCIL}</button>
        </label>
        ${saveState()}
      </div>
      <button class="primary done-deck" data-click="deck:done">Done</button>`;

  return `
  <div class="menu decks builder ${sheetOpen ? 'sheet-open' : ''}">
    <div class="setup-bar build-bar">${bar}</div>
    <div class="build-head">
      <div class="build-lead">
        <span><b>${esc(cardName(deck.hero))}</b> leads · ${esc([CARDS[deck.hero].family, ...otherFamilies(deck), NEUTRAL_FAMILY].join(' + '))}</span>
      </div>
      <div class="build-count"><b>${size}</b> / ${DECK_RULES.size} cards · Cats <b>${catCount(deck)}</b> / ${DECK_RULES.maxCats}</div>
      ${status}
    </div>
    ${base ? renderChanges(deck, base) : ''}
    ${renderMissing(deck)}
    ${renderFilters(order)}
    ${message ? `<p class="build-message" role="status">${esc(message)}</p>` : ''}
    <div class="build-main">
      <div class="pool" data-keep-scroll="pool">
        ${pool.length ? pool.map((id) => renderPoolCard(deck, id, base)).join('') : '<p class="pool-empty">No cards match these filters.</p>'}
      </div>
      ${renderDeckPanel(deck, order, ready, base)}
    </div>
  </div>`;
}

/** A copy of another deck: which one, and how many cards differ (the new ones are marked in blue). */
function renderChanges(deck: DeckList, base: DeckList): string {
  const { added, removed } = deckChanges(deck, base);
  const count = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  const put = count(added);
  const out = count(removed);
  const what = put || out
    ? [put ? `<span class="chg-new">${put} new</span>` : '', out ? `${out} taken out` : ''].filter(Boolean).join(' · ')
    : 'no changes yet';
  return `<div class="changes-bar">Made from <b>${esc(base.name)}</b> · ${what}</div>`;
}

/** A card the deck it was copied from doesn't have says "New"; more copies than it has says "+1". */
const newLabel = (count: number, inBase: number) => (inBase ? `+${count - inBase}` : 'New');

/**
 * A deck holding cards you don't have (a deck from a code, or after test purchases were removed) says how many, and
 * where the Store is open to you, offers to get them.
 */
function renderMissing(deck: DeckList): string {
  const n = missingCopies(deck);
  if (!n) return '';
  const what = `${n} ${n === 1 ? 'card' : 'cards'} in this deck ${n === 1 ? 'isn’t' : 'aren’t'} in your collection yet.`;
  return `<div class="missing-bar" role="status">
      <span>${what} ${canShop() ? '' : 'The deck can be played once you have them.'}</span>
      ${canShop() ? '<button class="primary missing-shop" data-click="deck:shop">See the missing cards</button>' : ''}
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

function renderPoolCard(deck: DeckList, id: string, base: DeckList | null): string {
  const name = CARDS[id].name;
  const count = deck.cards[id] ?? 0;
  const usable = Math.min(copyLimit(id), owned(id));
  const maxed = count >= usable;
  const blocked = !maxed && addProblem(deck, id, owned, true) !== null;
  const pips = Array.from({ length: usable }, (_, i) => `<i class="${i < count ? 'on' : ''}"></i>`).join('');
  const added = !!base && count > (base.cards[id] ?? 0);
  return `
    <div class="pool-card ${blocked ? 'blocked' : ''} ${maxed ? 'maxed' : ''} ${count ? 'in-deck' : ''} ${added ? 'added' : ''}">
      <button class="pool-face" data-click="deck:add:${id}" data-zoom="${yourCardUrl(id)}" data-zoom-card="${id}"
        aria-label="Add ${esc(name)} (${count} of ${usable} in deck)">
        <img src="${yourCardUrl(id)}" alt="" decoding="async"></button>
      ${added ? `<span class="new-badge">${newLabel(count, base!.cards[id] ?? 0)}</span>` : ''}
      <div class="pool-foot">
        <span class="pips" title="${count} of ${usable} in your deck">${pips}</span>
        ${count ? `<button class="pool-remove" data-click="deck:remove:${id}" aria-label="Remove one ${esc(name)}">−</button>` : ''}
      </div>
    </div>`;
}

function renderDeckPanel(deck: MyDeck, order: string[], ready: boolean, base: DeckList | null): string {
  // A copy of another deck lists what it took out of it, under its own cards.
  const removed = base ? deckChanges(deck, base).removed : {};
  const out = sortCards(Object.keys(removed), order).sort((a, b) => (CARDS[a].cost ?? 0) - (CARDS[b].cost ?? 0));
  const isAdded = (id: string) => !!base && deck.cards[id] > (base.cards[id] ?? 0);
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
              <li class="${famClass(id)} ${owned(id) < deck.cards[id] ? 'short' : ''} ${isAdded(id) ? 'added' : ''}" data-zoom="${yourCardUrl(id)}" data-zoom-card="${id}">
                <span class="line-cost">${CARDS[id].cost ?? ''}</span>
                <span class="line-name">${esc(cardName(id))}${CARDS[id].type === 'Cat' ? ' <small>Cat</small>' : ''}${isAdded(id)
                  ? ` <small class="line-new">${newLabel(deck.cards[id], base!.cards[id] ?? 0)}</small>` : ''}${owned(id) < deck.cards[id]
                  ? ` <small class="line-short">${owned(id) ? `you have ${owned(id)}` : 'not yours yet'}</small>` : ''}</span>
                <button class="line-btn" data-click="deck:remove:${id}" aria-label="Remove one ${esc(cardName(id))}">−</button>
                <span class="line-qty">${deck.cards[id]}</span>
                <button class="line-btn" data-click="deck:add:${id}" aria-label="Add one ${esc(cardName(id))}" ${addProblem(deck, id, owned, true) ? 'disabled' : ''}>+</button>
              </li>`).join('') : '<li class="deck-empty">Tap cards to add them to your deck.</li>'}
            ${out.length ? `<li class="deck-out-head">Taken out of ${esc(base!.name)}</li>${out.map((id) => `
              <li class="${famClass(id)} taken-out" data-zoom="${yourCardUrl(id)}" data-zoom-card="${id}">
                <span class="line-cost">${CARDS[id].cost ?? ''}</span>
                <span class="line-name">${esc(cardName(id))}</span>
                <span class="line-qty">−${removed[id]}</span>
                <button class="line-btn" data-click="deck:add:${id}" aria-label="Put back one ${esc(cardName(id))}" ${addProblem(deck, id, owned, true) ? 'disabled' : ''}>+</button>
              </li>`).join('')}` : ''}
          </ul>
          <div class="deck-actions">
            ${size ? `<button class="copy-code" data-click="deck:copycode">${CODE} Copy deck code</button>` : ''}
            ${codeNote ? `<p class="code-note" role="status">${esc(codeNote)}</p>` : ''}
            ${isNew ? '' : `<button class="delete-deck" data-click="deck:delete:${deck.id}">${BIN} Delete deck</button>`}
          </div>
        </div>
      </aside>`;
}
