// The Collection: a Display Case of your proudest cards on a wooden shelf, a Binder of the whole set
// (cards you don't have yet are shadows in their pockets), a full-screen look at any card, and a phone
// wallpaper made from it. What you own comes from collection.ts.

import './showcase.css';
import { CARDS, cardName } from '@fruitcats/engine';
import { owned } from './collection';
import { backButton, cardUrl, esc, famClass, settingsButton } from './ui';
import { renderWallpaper, saveWallpaper } from './wallpaper';

/** The Display Case: the three starter Hero Cats, for now. Choosing your own comes with the Store. */
const CASE = ['SB1-H01', 'SB1-H02', 'SB1-H03'];
const FAMILIES = ['all', 'Citrus', 'Orchard', 'Tropical', 'Garden'];

/** Every card in the set, in collector-number order (the order of the set list). */
const SET = Object.keys(CARDS);
const number = (id: string) => `${String(SET.indexOf(id) + 1).padStart(3, '0')}/${String(SET.length).padStart(3, '0')}`;
const isHero = (id: string) => CARDS[id]?.type === 'Hero Cat';

let familyFilter = 'all';
/** The card open full screen, and which face of a Hero Cat is showing. */
let inspecting: string | null = null;
let bigCat = false;
/** The wallpaper sheet, and the picture once it's drawn. */
let wallpaper: { blob: Blob | null; url: string; note: string } | null = null;
let drawing = 0;

export interface ShowcaseHost {
  render(): void;
}

export function openShowcase(): void {
  familyFilter = 'all';
  inspecting = null;
  closeWallpaper();
}

const face = (id: string) => (isHero(id) ? `${id}-${bigCat ? 'bigcat' : 'kitten'}` : id);
/** The Display Case's cards shine like foils. */
const isFoil = (id: string) => CASE.includes(id);

function closeWallpaper() {
  if (wallpaper?.url) URL.revokeObjectURL(wallpaper.url);
  wallpaper = null;
}

async function drawWallpaper(host: ShowcaseHost) {
  if (!inspecting || !wallpaper) return;
  const id = inspecting, ticket = ++drawing;
  if (wallpaper.url) URL.revokeObjectURL(wallpaper.url);
  wallpaper = { ...wallpaper, blob: null, url: '', note: '' };
  host.render();
  try {
    const blob = await renderWallpaper(id, isHero(id) ? (bigCat ? 'bigcat' : 'kitten') : null, isFoil(id), number(id));
    if (ticket !== drawing || !wallpaper) return;   // closed meanwhile
    wallpaper = { ...wallpaper, blob, url: URL.createObjectURL(blob) };
  } catch {
    if (ticket !== drawing || !wallpaper) return;
    wallpaper = { ...wallpaper, note: 'Sorry, the wallpaper couldn’t be drawn.' };
  }
  host.render();
}

/** Clicks on `col:<action>:<arg>`. */
export function showcaseClick(action: string, arg: string, host: ShowcaseHost): void {
  switch (action) {
    case 'filter': if (FAMILIES.includes(arg)) familyFilter = arg; break;
    case 'inspect': if (CARDS[arg] && owned(arg) > 0) { inspecting = arg; bigCat = false; } break;
    case 'face': bigCat = arg === 'bigcat'; break;
    case 'close': inspecting = null; closeWallpaper(); break;
    case 'wallpaper':
      if (!inspecting) break;
      wallpaper = { blob: null, url: '', note: '' };
      void drawWallpaper(host);
      return;
    case 'unwall': closeWallpaper(); break;
    case 'save':
      if (wallpaper?.blob && inspecting) {
        const name = `fruitcats-${cardName(inspecting).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        void saveWallpaper(wallpaper.blob, name).then((how) => {
          if (!wallpaper) return;
          wallpaper.note = how === 'shared' ? 'Now open Photos, tap the picture, then Share → Use as Wallpaper.'
            : how === 'downloaded' ? 'Saved to your downloads.' : '';
          host.render();
        });
      }
      return;
  }
  host.render();
}

/** Escape closes the wallpaper sheet, then the card. */
export function showcaseEscape(host: ShowcaseHost): boolean {
  if (wallpaper) closeWallpaper();
  else if (inspecting) inspecting = null;
  else return false;
  host.render();
  return true;
}

export function renderShowcase(): string {
  const have = SET.filter((id) => owned(id) > 0).length;
  const shown = SET.filter((id) => familyFilter === 'all' || CARDS[id].family === familyFilter);
  return `
  <div class="menu collection">
    <div class="setup-bar">
      ${backButton()}
      <h2>Collection</h2>
      ${settingsButton()}
    </div>
    <div class="collection-body" data-keep-scroll="collection">
      <section class="display-case" aria-label="Display Case">
        <h3 class="case-title">Display Case</h3>
        <div class="case-shelf">
          ${CASE.map((id) => `
            <button class="case-slot" data-click="col:inspect:${id}" aria-label="${esc(cardName(id))}">
              <span class="holo ${famClass(id)}"><img src="${cardUrl(`${id}-kitten`)}" alt="" decoding="async"></span>
            </button>`).join('')}
        </div>
      </section>
      <section class="binder" aria-label="Binder">
        <div class="binder-head">
          <h3>Starter Box</h3>
          <span class="binder-count"><b>${have}</b> / ${SET.length} collected</span>
        </div>
        <div class="chip-row binder-filters" role="group" aria-label="Family" style="--n:${FAMILIES.length}">
          ${FAMILIES.map((f) => `<button class="chip ${f === 'all' ? '' : `fam-${f.toLowerCase()}`} ${familyFilter === f ? 'chosen' : ''}"
            data-click="col:filter:${f}" aria-pressed="${familyFilter === f}">${f === 'all' ? 'All' : f}</button>`).join('')}
        </div>
        <div class="binder-pages">
          ${shown.map(renderPocket).join('')}
        </div>
      </section>
    </div>
  </div>
  ${renderInspect()}`;
}

function renderPocket(id: string): string {
  const img = cardUrl(isHero(id) ? `${id}-kitten` : id);
  const copies = owned(id);
  if (!copies) {
    return `<div class="pocket missing" title="Coming soon">
      <img src="${img}" alt="" decoding="async" loading="lazy">
      <span class="pocket-number">${number(id)}</span><span class="pocket-soon">Coming soon</span></div>`;
  }
  return `<button class="pocket" data-click="col:inspect:${id}" aria-label="${esc(cardName(id))}, ${copies} owned">
      <img src="${img}" alt="" decoding="async" loading="lazy">
      <span class="pocket-number">${number(id)}</span>${copies > 1 ? `<span class="pocket-copies">×${copies}</span>` : ''}</button>`;
}

function renderInspect(): string {
  if (!inspecting) return '';
  const id = inspecting, card = CARDS[id];
  const foil = isFoil(id);
  const faces = isHero(id) ? `
      <div class="face-toggle" role="group" aria-label="Side">
        <button class="chip ${bigCat ? '' : 'chosen'}" data-click="col:face:kitten" aria-pressed="${!bigCat}">Kitten</button>
        <button class="chip ${bigCat ? 'chosen' : ''}" data-click="col:face:bigcat" aria-pressed="${bigCat}">Big Cat</button>
      </div>` : '';
  return `
  <div class="inspect-overlay" role="dialog" aria-label="${esc(cardName(id))}">
    <button class="inspect-close icon-button" data-click="col:close" aria-label="Close" title="Close">✕</button>
    <div class="inspect-card ${foil ? 'holo' : ''} ${famClass(id)}"><img src="${cardUrl(face(id))}" alt="${esc(card.name)}"></div>
    <div class="inspect-info">
      <span class="inspect-meta">${esc(card.family)} · ${esc(card.type)} · Starter Box ${number(id)}${owned(id) > 1 ? ` · ×${owned(id)}` : ''}</span>
      ${faces}
      <button class="primary wallpaper-button" data-click="col:wallpaper">Make wallpaper</button>
    </div>
    ${renderWallpaperSheet()}
  </div>`;
}

function renderWallpaperSheet(): string {
  if (!wallpaper) return '';
  const picture = wallpaper.url
    ? `<img class="wall-preview" src="${wallpaper.url}" alt="Wallpaper preview">`
    : `<div class="wall-preview drawing">${wallpaper.note ? '' : 'Drawing…'}</div>`;
  return `
    <div class="overlay wall-overlay">
      <div class="settings wall-sheet" role="dialog" aria-label="Wallpaper">
        <h2>Phone wallpaper</h2>
        ${picture}
        <p class="wall-how">${esc(wallpaper.note || 'Save the picture, then in Photos choose Share → Use as Wallpaper.')}</p>
        <div class="delete-buttons">
          <button data-click="col:unwall">Close</button>
          <button class="primary" data-click="col:save" ${wallpaper.blob ? '' : 'disabled'}>Save picture</button>
        </div>
      </div>
    </div>`;
}

// Foil cards follow the pointer: the sheen and the tilt move with it.
document.addEventListener('pointermove', (event) => {
  const el = (event.target as HTMLElement).closest?.<HTMLElement>('.holo');
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${((event.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty('--my', `${((event.clientY - r.top) / r.height) * 100}%`);
});
