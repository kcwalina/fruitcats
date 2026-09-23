// The Collection: a Display Case (a velvet showcase whose cards sit in clear collector's slabs and turn
// through the spotlight), a Binder of the whole set (cards you don't have yet are shadows in their
// pockets), a full-screen card you can swipe through, and a wallpaper made from it.
// What you own comes from collection.ts.
//
// A Hero Cat's two sides are two cards here: its Kitten and its Big Cat, each with its own picture,
// pocket and place in the case. So the screens deal in card faces: a card's id, or a Hero Cat's
// `<id>-kitten` / `<id>-bigcat`.

import './showcase.css';
import { CARDS } from '@fruitcats/engine';
import { owned } from './collection';
import { backButton, cardUrl, esc, famClass, settingsButton } from './ui';
import { DEVICES, renderWallpaper, saveWallpaper, thisDevice, type Device } from './wallpaper';

/** The Display Case: each starter Hero Cat as a Kitten and a Big Cat. Choosing your own comes with the Store. */
const CASE = ['SB1-H01-kitten', 'SB1-H01-bigcat', 'SB1-H03-kitten', 'SB1-H03-bigcat', 'SB1-H02-kitten', 'SB1-H02-bigcat'];
/** It opens on Mochi's Big Cat, the mightiest. */
const CASE_START = 3;
const FAMILIES = ['all', 'Citrus', 'Orchard', 'Tropical', 'Garden'];

/** Every card in the set, in collector-number order (the order of the set list). */
const SET = Object.keys(CARDS);
const isHero = (id: string) => CARDS[id]?.type === 'Hero Cat';
/** A card's faces: a Hero Cat has two. */
const facesOf = (id: string) => (isHero(id) ? [`${id}-kitten`, `${id}-bigcat`] : [id]);
const idOf = (face: string) => face.replace(/-(kitten|bigcat)$/, '');
const sideOf = (face: string) => (face.endsWith('-kitten') ? 'kitten' : face.endsWith('-bigcat') ? 'bigcat' : null);
const sideLabel = (face: string) => (sideOf(face) === 'kitten' ? 'Kitten' : sideOf(face) === 'bigcat' ? 'Big Cat' : '');
const number = (id: string) => `${String(SET.indexOf(idOf(id)) + 1).padStart(3, '0')}/${String(SET.length).padStart(3, '0')}`;
/** The name on this face: a Kitten and its Big Cat are named differently ("Mochi, Sunbeam Kit"). */
const faceName = (face: string) => {
  const card = CARDS[idOf(face)], side = sideOf(face);
  return (side === 'kitten' ? card.kitten?.name : side === 'bigcat' ? card.bigCat?.name : card.name) ?? card.name;
};
/** "Mochi", not "Mochi, Sunbeam Kit". */
const shortName = (face: string) => faceName(face).split(',')[0];

export interface ShowcaseHost {
  render(): void;
}

let host: ShowcaseHost = { render() {} };
let familyFilter = 'all';
/** The Display Case card in the spotlight. */
let caseIndex = CASE_START;
/** The full-screen view: the faces it swipes through, which one is showing, and which way it came in. */
let inspecting: { list: string[]; index: number; from: 'left' | 'right' | '' } | null = null;
/** The wallpaper sheet: the device it's for, and the picture once it's drawn. */
let wallpaper: { device: Device; blob: Blob | null; url: string; note: string } | null = null;
let drawing = 0;

export function openShowcase(h: ShowcaseHost): void {
  host = h;
  familyFilter = 'all';
  caseIndex = CASE_START;
  inspecting = null;
  closeWallpaper();
}

const current = () => (inspecting ? inspecting.list[inspecting.index] : null);
/** The Display Case's cards shine like foils. */
const isFoil = (face: string) => CASE.includes(face);
const ownedInFilter = () => SET.filter((id) => owned(id) > 0 && (familyFilter === 'all' || CARDS[id].family === familyFilter)).flatMap(facesOf);
const wrapIndex = (i: number, n: number) => ((i % n) + n) % n;

function closeWallpaper() {
  if (wallpaper?.url) URL.revokeObjectURL(wallpaper.url);
  wallpaper = null;
}

async function drawWallpaper() {
  const face = current();
  if (!face || !wallpaper) return;
  const ticket = ++drawing;
  if (wallpaper.url) URL.revokeObjectURL(wallpaper.url);
  wallpaper = { ...wallpaper, blob: null, url: '', note: '' };
  host.render();
  try {
    const blob = await renderWallpaper(idOf(face), sideOf(face), isFoil(face), number(face), wallpaper.device);
    if (ticket !== drawing || !wallpaper) return;   // closed, or another device picked meanwhile
    wallpaper = { ...wallpaper, blob, url: URL.createObjectURL(blob) };
  } catch {
    if (ticket !== drawing || !wallpaper) return;
    wallpaper = { ...wallpaper, note: 'Sorry, the wallpaper couldn’t be drawn.' };
  }
  host.render();
}

/** Turns the Display Case so card `index` is in the spotlight. Moves the slabs in place, so they glide. */
function turnCase(index: number) {
  caseIndex = wrapIndex(index, CASE.length);
  const stage = document.querySelector('.case-stage');
  if (!stage) { host.render(); return; }
  stage.querySelectorAll<HTMLElement>('.slab-wrap').forEach((el, i) => { el.dataset.pos = slabPosition(i); });
  const caption = document.querySelector('.case-caption');
  if (caption) caption.outerHTML = renderCaseCaption();
}

/** Where a slab stands: in the spotlight, either side of it, or out of sight behind them. */
function slabPosition(i: number): string {
  const offset = wrapIndex(i - caseIndex + 1, CASE.length) - 1;
  return offset === 0 ? 'center' : offset === -1 ? 'left' : offset === 1 ? 'right' : 'hidden';
}

/** Shows the next or previous card: in the full-screen view if it's open, otherwise in the Display Case. */
function step(delta: number) {
  if (wallpaper) return;
  if (inspecting) {
    if (inspecting.list.length < 2) return;
    inspecting = { ...inspecting, index: wrapIndex(inspecting.index + delta, inspecting.list.length), from: delta > 0 ? 'right' : 'left' };
    host.render();
  } else turnCase(caseIndex + delta);
}

/** Clicks on `col:<action>:<arg>`. */
export function showcaseClick(action: string, arg: string, h: ShowcaseHost): void {
  host = h;
  switch (action) {
    case 'filter': if (FAMILIES.includes(arg)) familyFilter = arg; break;
    case 'slab': {
      const i = Number(arg);
      if (i === caseIndex) { inspecting = { list: CASE, index: i, from: '' }; break; }
      turnCase(i);
      return;
    }
    case 'turn': step(Number(arg)); return;
    case 'inspect': {
      const list = ownedInFilter();
      if (list.includes(arg)) inspecting = { list, index: list.indexOf(arg), from: '' };
      break;
    }
    case 'close': inspecting = null; closeWallpaper(); break;
    case 'wallpaper':
      if (!inspecting) break;
      wallpaper = { device: thisDevice(), blob: null, url: '', note: '' };
      void drawWallpaper();
      return;
    case 'device':
      if (wallpaper && DEVICES.some(([d]) => d === arg) && arg !== wallpaper.device) {
        wallpaper.device = arg as Device;
        void drawWallpaper();
        return;
      }
      break;
    case 'unwall': closeWallpaper(); break;
    case 'save': {
      const face = current();
      if (wallpaper?.blob && face) {
        const name = `fruitcats-${faceName(face).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${wallpaper.device}`;
        void saveWallpaper(wallpaper.blob, name).then((how) => {
          if (!wallpaper) return;
          wallpaper.note = how === 'shared' ? 'Now open Photos, tap the picture, then Share → Use as Wallpaper.'
            : how === 'downloaded' ? 'Saved to your downloads.' : '';
          host.render();
        });
      }
      return;
    }
  }
  host.render();
}

/** Escape closes the wallpaper sheet, then the card. */
export function showcaseEscape(h: ShowcaseHost): boolean {
  host = h;
  if (wallpaper) closeWallpaper();
  else if (inspecting) inspecting = null;
  else return false;
  host.render();
  return true;
}

/** The arrow keys turn the case, or page through the full-screen cards. */
export function showcaseArrow(key: string, h: ShowcaseHost): boolean {
  host = h;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
  step(key === 'ArrowRight' ? 1 : -1);
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
      ${renderCase()}
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
          ${shown.flatMap(facesOf).map(renderPocket).join('')}
        </div>
      </section>
    </div>
  </div>
  ${renderInspect()}`;
}

// ── Display Case ─────────────────────────────────────────────────────────────────────────────────

/** Twinkles around the spotlight: [left %, top %, size px, delay s]. */
const SPARKLES = [[22, 18, 10, 0], [78, 14, 8, 1.2], [70, 46, 6, 2.1], [28, 52, 7, 0.7], [50, 6, 9, 1.7], [86, 34, 5, 2.8]];

function renderCase(): string {
  return `
      <section class="display-case" aria-label="Display Case">
        <header class="case-plaque"><span class="plaque-rule"></span><h3>Display Case</h3><span class="plaque-rule"></span></header>
        <div class="case-stage" data-swipe="case">
          <span class="case-lights" aria-hidden="true"></span>
          ${SPARKLES.map(([x, y, size, delay]) => `<i class="sparkle" style="left:${x}%;top:${y}%;--size:${size}px;animation-delay:${delay}s" aria-hidden="true"></i>`).join('')}
          ${CASE.map((face, i) => `
            <button class="slab-wrap" data-pos="${slabPosition(i)}" data-click="col:slab:${i}" aria-label="${esc(faceName(face))}">
              <span class="beam" aria-hidden="true"></span>
              <span class="slab-float" style="animation-delay:${-i * 1.6}s">
                <span class="slab">
                  <span class="slab-label ${famClass(idOf(face))}">
                    <b>${esc(shortName(face))}</b><span class="slab-no">${number(face).split('/')[0]} · ${sideLabel(face)}</span><em>Foil</em>
                  </span>
                  <span class="slab-window holo"><img src="${cardUrl(face)}" alt="" decoding="async" draggable="false"></span>
                </span>
              </span>
            </button>`).join('')}
          <span class="case-floor" aria-hidden="true"></span>
        </div>
        <div class="case-nav">
          <button class="case-arrow" data-click="col:turn:-1" aria-label="Previous card">‹</button>
          ${renderCaseCaption()}
          <button class="case-arrow" data-click="col:turn:1" aria-label="Next card">›</button>
        </div>
      </section>`;
}

function renderCaseCaption(): string {
  const face = CASE[caseIndex];
  return `<div class="case-caption" aria-live="polite">
      <span class="caption-name">${esc(faceName(face))}</span>
      <span class="caption-sub">${esc(CARDS[idOf(face)].family)} · ${sideLabel(face)} · Foil</span>
      <span class="case-dots">${CASE.map((_, i) => `<i class="${i === caseIndex ? 'on' : ''}"></i>`).join('')}</span>
    </div>`;
}

// ── Binder ───────────────────────────────────────────────────────────────────────────────────────

function renderPocket(face: string): string {
  const id = idOf(face);
  const copies = owned(id);
  const label = `${number(face)}${sideOf(face) ? ` · ${sideLabel(face)}` : ''}`;
  if (!copies) {
    return `<div class="pocket missing" title="Coming soon">
      <img src="${cardUrl(face)}" alt="" decoding="async" loading="lazy">
      <span class="pocket-number">${label}</span><span class="pocket-soon">Coming soon</span></div>`;
  }
  return `<button class="pocket" data-click="col:inspect:${face}" aria-label="${esc(faceName(face))}, ${copies} owned">
      <img src="${cardUrl(face)}" alt="" decoding="async" loading="lazy">
      <span class="pocket-number">${label}</span>${copies > 1 ? `<span class="pocket-copies">×${copies}</span>` : ''}</button>`;
}

// ── One card, full screen ────────────────────────────────────────────────────────────────────────

function renderInspect(): string {
  if (!inspecting) return '';
  const face = current()!, id = idOf(face), card = CARDS[id];
  const many = inspecting.list.length > 1;
  const kind = sideOf(face) ? `Hero Cat · ${sideLabel(face)}` : card.type;
  return `
  <div class="inspect-overlay" role="dialog" aria-label="${esc(faceName(face))}">
    <button class="inspect-close icon-button" data-click="col:close" aria-label="Close" title="Close">✕</button>
    <div class="inspect-stage" data-swipe="inspect">
      ${many ? '<button class="case-arrow inspect-prev" data-click="col:turn:-1" aria-label="Previous card">‹</button>' : ''}
      <div class="inspect-card ${isFoil(face) ? 'holo' : ''} ${inspecting.from ? `from-${inspecting.from}` : ''} ${famClass(id)}">
        <img src="${cardUrl(face)}" alt="${esc(faceName(face))}" draggable="false"></div>
      ${many ? '<button class="case-arrow inspect-next" data-click="col:turn:1" aria-label="Next card">›</button>' : ''}
    </div>
    <div class="inspect-info">
      <span class="inspect-meta">${esc(card.family)} · ${esc(kind)} · Starter Box ${number(face)}${owned(id) > 1 ? ` · ×${owned(id)}` : ''}${many ? ` · ${inspecting.index + 1} of ${inspecting.list.length}` : ''}</span>
      <button class="primary wallpaper-button" data-click="col:wallpaper">Make wallpaper</button>
    </div>
    ${renderWallpaperSheet()}
  </div>`;
}

/** The preview's shape while the picture is drawn: tall for phones, 3:4 for tablets, wide for computers. */
const PREVIEW_SHAPE: Record<Device, string> = { phone: '9 / 19.5', tablet: '3 / 4', computer: '16 / 9' };

function renderWallpaperSheet(): string {
  if (!wallpaper) return '';
  const { device } = wallpaper;
  const picture = wallpaper.url
    ? `<img class="wall-preview ${device}" src="${wallpaper.url}" alt="Wallpaper preview">`
    : `<div class="wall-preview ${device} drawing" style="aspect-ratio:${PREVIEW_SHAPE[device]}">${wallpaper.note ? '' : 'Drawing…'}</div>`;
  const how = device === 'computer'
    ? 'Save the picture, then set it as your desktop background.'
    : 'Save the picture, then in Photos choose Share → Use as Wallpaper.';
  return `
    <div class="overlay wall-overlay">
      <div class="settings wall-sheet" role="dialog" aria-label="Wallpaper">
        <h2>Wallpaper</h2>
        <div class="chip-row" role="group" aria-label="For" style="--n:${DEVICES.length}">
          ${DEVICES.map(([d, label]) => `<button class="chip ${d === device ? 'chosen' : ''}" data-click="col:device:${d}" aria-pressed="${d === device}">${label}</button>`).join('')}
        </div>
        ${picture}
        <p class="wall-how">${esc(wallpaper.note || how)}</p>
        <div class="delete-buttons">
          <button data-click="col:unwall">Close</button>
          <button class="primary" data-click="col:save" ${wallpaper.blob ? '' : 'disabled'}>Save picture</button>
        </div>
      </div>
    </div>`;
}

// ── Touch and pointer ────────────────────────────────────────────────────────────────────────────

// Foils follow the pointer, and the slab in the spotlight tilts toward it.
let tilted: HTMLElement | null = null;
document.addEventListener('pointermove', (event) => {
  const target = event.target as HTMLElement;
  const holo = target.closest?.<HTMLElement>('.holo');
  if (holo) {
    const r = holo.getBoundingClientRect();
    holo.style.setProperty('--mx', `${((event.clientX - r.left) / r.width) * 100}%`);
    holo.style.setProperty('--my', `${((event.clientY - r.top) / r.height) * 100}%`);
  }
  const slab = target.closest?.<HTMLElement>('.slab-wrap[data-pos="center"] .slab');
  if (tilted && tilted !== slab) { tilted.style.removeProperty('--tx'); tilted.style.removeProperty('--ty'); }
  tilted = slab ?? null;
  if (slab) {
    const r = slab.getBoundingClientRect();
    slab.style.setProperty('--tx', (((event.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
    slab.style.setProperty('--ty', (((event.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
  }
});

// Swiping sideways over the case (or the full-screen card) turns to the next card. The tap that ends a
// swipe mustn't also count as a click.
let swipe: { x: number; y: number } | null = null;
let swallowClick = false;
document.addEventListener('pointerdown', (event) => {
  swipe = (event.target as HTMLElement).closest?.('[data-swipe]') ? { x: event.clientX, y: event.clientY } : null;
});
document.addEventListener('pointerup', (event) => {
  if (!swipe) return;
  const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 400);
  step(dx < 0 ? 1 : -1);
});
document.addEventListener('pointercancel', () => { swipe = null; });
document.addEventListener('click', (event) => {
  if (!swallowClick) return;
  swallowClick = false;
  event.stopPropagation();
  event.preventDefault();
}, true);
