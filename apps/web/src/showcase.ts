// The Collection: a gallery for looking at cards. Showcase is your favourite cards, one at a time and as
// big as the screen allows, swiped through with the phone's own scrolling; the card's art, blurred, fills
// the screen behind it. All cards is the whole set as a grid (cards you don't have yet are shadows), and
// tapping one opens the same full-screen view through the cards you're looking at, which is where cards
// are added to and taken out of the Showcase. Any card can become a wallpaper. What you own comes from collection.ts;
// every card shows its rarity mark, and your copies are shown in their finish (rarity.ts).
//
// A Hero Cat's two sides are two cards here: its Kitten and its Big Cat. So the screens deal in card
// faces: a card's id, or a Hero Cat's `<id>-kitten` / `<id>-bigcat`.

import './showcase.css';
import { CARDS, RARITIES, type Rarity } from '@fruitcats/engine';
import { finish, owned } from './collection';
import { finishClasses, finishName, finishSparks, rarity, rarityMark, yourCardUrl } from './rarity';
import { BASE, artUrl, backButton, cardUrl, esc, famClass, settingsButton } from './ui';
import { DEVICES, renderWallpaper, saveWallpaper, thisDevice, type Device } from './wallpaper';

/** A new player's Showcase: Mochi, as a Kitten and as a Big Cat. */
const DEFAULT_SHOWCASE = ['SB1-H03-kitten', 'SB1-H03-bigcat'];
const SHOWCASE_KEY = 'fruitcats-showcase';
const FAMILIES = ['all', 'Citrus', 'Orchard', 'Tropical', 'Garden'];

/** Every card in the set, in collector-number order (the order of the set list). */
const SET = Object.keys(CARDS);
const isHero = (id: string) => CARDS[id]?.type === 'Hero Cat';
/** A card's faces: a Hero Cat has two. */
const facesOf = (id: string) => (isHero(id) ? [`${id}-kitten`, `${id}-bigcat`] : [id]);
const idOf = (face: string) => face.replace(/-(kitten|bigcat)$/, '');
const sideOf = (face: string) => (face.endsWith('-kitten') ? 'kitten' : face.endsWith('-bigcat') ? 'bigcat' : null);
const sideLabel = (face: string) => (sideOf(face) === 'kitten' ? 'Kitten' : sideOf(face) === 'bigcat' ? 'Big Cat' : '');
const number = (face: string) => `${String(SET.indexOf(idOf(face)) + 1).padStart(3, '0')}/${String(SET.length).padStart(3, '0')}`;
/** The name on this face: a Kitten and its Big Cat are named differently ("Mochi, Sunbeam Kit"). */
const faceName = (face: string) => {
  const card = CARDS[idOf(face)], side = sideOf(face);
  return (side === 'kitten' ? card.kitten?.name : side === 'bigcat' ? card.bigCat?.name : card.name) ?? card.name;
};

export interface ShowcaseHost {
  render(): void;
}

type Tab = 'showcase' | 'all';
let host: ShowcaseHost = { render() {} };
let tab: Tab = 'showcase';
let familyFilter = 'all';
/** All cards shows every rarity, or just one. */
let rarityFilter: Rarity | 'all' = 'all';
/** The cards you've chosen to show off, in the order you added them. Kept on this device, like your decks. */
let showcase: string[] = [];
let showcaseIndex = 0;
/** A card opened from All cards: the cards it swipes through, and which one is showing. */
let browsing: { list: string[]; index: number } | null = null;
/** The wallpaper sheet: the device it's for, and the picture once it's drawn. */
let wallpaper: { device: Device; blob: Blob | null; url: string; note: string } | null = null;
let drawing = 0;
/** The card just taken out of the Showcase, for the Undo bar. */
let undo: { face: string; at: number; timer: number } | null = null;

export function openShowcase(h: ShowcaseHost): void {
  host = h;
  tab = 'showcase';
  familyFilter = 'all';
  rarityFilter = 'all';
  showcase = loadShowcase();
  showcaseIndex = 0;
  browsing = null;
  closeWallpaper();
}

/** The cards being looked at one by one, if any: the one opened from All cards, or the Showcase. */
function viewer(): { list: string[]; index: number } | null {
  if (browsing) return browsing;
  return tab === 'showcase' && showcase.length ? { list: showcase, index: showcaseIndex } : null;
}
function setIndex(index: number) {
  if (browsing) browsing.index = index;
  else showcaseIndex = index;
}
const current = () => { const v = viewer(); return v ? v.list[v.index] : null; };
/** The finish your copy of this card is in. */
const finishOf = (face: string) => finish(idOf(face));
const isFace = (face: string) => !!CARDS[idOf(face)] && facesOf(idOf(face)).includes(face);

function loadShowcase(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(SHOWCASE_KEY) ?? 'null');
    if (Array.isArray(saved)) return saved.filter((face) => typeof face === 'string' && isFace(face) && owned(idOf(face)) > 0);
  } catch { /* unreadable or private mode: start with the default */ }
  return [...DEFAULT_SHOWCASE];
}

function saveShowcase() {
  try { localStorage.setItem(SHOWCASE_KEY, JSON.stringify(showcase)); } catch { /* private mode: kept until the page closes */ }
}

/** Puts a card at the end of the Showcase. */
function addToShowcase(face: string) {
  if (!isFace(face) || owned(idOf(face)) === 0 || showcase.includes(face)) return;
  showcase = [...showcase, face];
  saveShowcase();
}

/** Takes a card out of the Showcase, remembering where it was so Undo can put it back. */
function removeFromShowcase(face: string) {
  const at = showcase.indexOf(face);
  if (at === -1) return;
  showcase = showcase.filter((f) => f !== face);
  // Looking at the Showcase itself: stay on the card that slid into its place (or the new last one).
  if (!browsing && tab === 'showcase') showcaseIndex = Math.min(showcaseIndex, Math.max(0, showcase.length - 1));
  saveShowcase();
  window.clearTimeout(undo?.timer);
  undo = { face, at, timer: window.setTimeout(() => { undo = null; host.render(); }, 6000) };
}

function undoRemove() {
  if (!undo) return;
  window.clearTimeout(undo.timer);
  const { face, at } = undo;
  undo = null;
  if (showcase.includes(face)) return;
  showcase = [...showcase.slice(0, at), face, ...showcase.slice(at)];
  if (!browsing && tab === 'showcase') showcaseIndex = at;
  saveShowcase();
}

/** Whether a card passes All cards' filters: its family and its rarity. */
const shownByFilters = (id: string) =>
  (familyFilter === 'all' || CARDS[id].family === familyFilter) && (rarityFilter === 'all' || rarity(id) === rarityFilter);
const ownedFaces = () => SET.filter((id) => owned(id) > 0 && shownByFilters(id)).flatMap(facesOf);

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
    const blob = await renderWallpaper(idOf(face), sideOf(face), finishOf(face), rarity(idOf(face)), number(face), wallpaper.device);
    if (ticket !== drawing || !wallpaper) return;   // closed, or another device picked meanwhile
    wallpaper = { ...wallpaper, blob, url: URL.createObjectURL(blob) };
  } catch {
    if (ticket !== drawing || !wallpaper) return;
    wallpaper = { ...wallpaper, note: 'Sorry, the wallpaper couldn’t be drawn.' };
  }
  host.render();
}

/** Glides the open viewer to card `index`. */
function scrollToCard(index: number, smooth = true) {
  const v = viewer();
  const track = document.querySelector<HTMLElement>(browsing ? '.viewer-overlay [data-track]' : '[data-track]');
  if (!v || !track) return;
  const slide = track.children[Math.max(0, Math.min(index, v.list.length - 1))] as HTMLElement | undefined;
  if (!slide) return;
  glide(track, slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2, smooth);
}

/**
 * Moves the strip to `left`, easing over a moment unless `smooth` is false. Animated here rather than
 * with the browser's smooth scrolling, which Safari didn't carry through on the strip; snapping is off
 * meanwhile, so it can't pull the strip elsewhere halfway.
 */
function glide(track: HTMLElement, left: number, smooth: boolean) {
  const from = track.scrollLeft, id = ++gliding;
  if (!smooth || Math.abs(left - from) < 1) { track.scrollLeft = left; track.classList.remove('dragging'); return; }
  track.classList.add('dragging');
  const start = performance.now(), ms = 320;
  const frame = (now: number) => {
    if (id !== gliding) return;   // another glide or drag took over
    const t = Math.min(1, (now - start) / ms);
    track.scrollLeft = from + (left - from) * (1 - (1 - t) ** 3);
    if (t < 1) requestAnimationFrame(frame);
    else track.classList.remove('dragging');
  };
  requestAnimationFrame(frame);
}
let gliding = 0;

function step(delta: number) {
  const v = viewer();
  if (!v || wallpaper) return;
  scrollToCard(v.index + delta);
}

/** Clicks on `col:<action>:<arg>`. */
export function showcaseClick(action: string, arg: string, h: ShowcaseHost): void {
  host = h;
  switch (action) {
    case 'tab': if (arg === 'showcase' || arg === 'all') tab = arg; break;
    case 'filter': if (FAMILIES.includes(arg)) familyFilter = arg; break;
    case 'clear': familyFilter = 'all'; rarityFilter = 'all'; break;
    case 'rarity': if (arg === 'all' || (RARITIES as readonly string[]).includes(arg)) rarityFilter = arg as Rarity | 'all'; break;
    case 'go': scrollToCard(Number(arg)); return;   // a card beside the one in the middle: bring it over
    case 'turn': step(Number(arg)); return;
    case 'open': {
      const list = ownedFaces();
      if (list.includes(arg)) browsing = { list, index: list.indexOf(arg) };
      break;
    }
    case 'close': browsing = null; closeWallpaper(); break;
    case 'add': { const face = current(); if (face) addToShowcase(face); break; }
    case 'remove': { const face = current(); if (face) removeFromShowcase(face); break; }
    case 'undo': undoRemove(); break;
    case 'wallpaper':
      if (!current()) break;
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
          wallpaper.note = how === 'shared' ? 'Now set it as your wallpaper: see how below.'
            : how === 'downloaded' ? 'Saved to your downloads.' : '';
          host.render();
        });
      }
      return;
    }
  }
  host.render();
}

/** Escape closes the wallpaper sheet, then a card opened from All cards. */
export function showcaseEscape(h: ShowcaseHost): boolean {
  host = h;
  if (wallpaper) closeWallpaper();
  else if (browsing) browsing = null;
  else return false;
  host.render();
  return true;
}

/** The arrow keys go to the next or previous card. */
export function showcaseArrow(key: string, h: ShowcaseHost): boolean {
  host = h;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
  step(key === 'ArrowRight' ? 1 : -1);
  return true;
}

// ── Screens ──────────────────────────────────────────────────────────────────────────────────────

export function renderShowcase(): string {
  const backdrop = tab === 'showcase' && showcase.length ? showcase[showcaseIndex] : 'SB1-H03-bigcat';
  return `
  <div class="collection-screen">
    ${renderAmbient(backdrop)}
    <div class="collection-top">
      ${backButton()}
      <div class="seg" role="tablist" aria-label="Collection">
        ${(['showcase', 'all'] as Tab[]).map((t) => `<button class="seg-btn ${tab === t ? 'on' : ''}" role="tab" aria-selected="${tab === t}"
          data-click="col:tab:${t}">${t === 'showcase' ? 'Showcase' : 'All cards'}</button>`).join('')}
      </div>
      ${settingsButton()}
    </div>
    ${tab === 'all' ? renderGrid() : showcase.length ? renderViewer(showcase, showcaseIndex) : renderEmptyShowcase()}
  </div>
  ${browsing ? `
  <div class="viewer-overlay" role="dialog" aria-label="Cards">
    ${renderAmbient(browsing.list[browsing.index])}
    <button class="viewer-close" data-click="col:close" aria-label="Close" title="Close">✕</button>
    ${renderViewer(browsing.list, browsing.index)}
  </div>` : ''}
  ${renderUndo()}
  ${renderWallpaperSheet()}`;
}

/** After a card is taken out of the Showcase: what happened, and a way to take it back. */
function renderUndo(): string {
  if (!undo) return '';
  return `<div class="undo-bar" role="status">
      <span>Removed <b>${esc(faceName(undo.face).split(',')[0])}</b> from your Showcase</span>
      <button class="undo-btn" data-click="col:undo">Undo</button>
    </div>`;
}

/** The current card's art, blurred to a glow of its colours, filling the screen. Two layers, to crossfade. */
function renderAmbient(face: string): string {
  return `<div class="ambient" aria-hidden="true">
      <div class="ambient-layer show" style="background-image:url(${artUrl(face)})"></div><div class="ambient-layer"></div>
    </div>`;
}

function renderViewer(list: string[], index: number): string {
  return `
    <div class="viewer">
      <div class="viewer-track" data-track>
        ${list.map((face, i) => `
          <div class="viewer-slide">
            <button class="viewer-card ${finishClasses(idOf(face))}" data-click="col:go:${i}" aria-label="${esc(faceName(face))}">
              <img src="${yourCardUrl(face)}" alt="" draggable="false" ${Math.abs(i - index) > 2 ? 'loading="lazy"' : ''}>${finishSparks(idOf(face))}</button>
          </div>`).join('')}
      </div>
      ${renderInfo(list, index)}
    </div>`;
}

function renderInfo(list: string[], index: number): string {
  const face = list[index], card = CARDS[idOf(face)], f = finishOf(face);
  const kind = sideOf(face) ? sideLabel(face) : card.type;
  // The Showcase is only for looking. Adding and taking out cards happens in All cards, on a card opened there.
  const editing = !!browsing, inShowcase = showcase.includes(face);
  const position = list.length <= 12
    ? `<span class="v-dots">${list.map((_, i) => `<i class="${i === index ? 'on' : ''}"></i>`).join('')}</span>`
    : `<span class="v-count">${index + 1} / ${list.length}</span>`;
  return `
      <div class="viewer-info" aria-live="polite">
        <h2 class="v-name">${esc(faceName(face))}</h2>
        <p class="v-sub">${esc(card.family)} · ${esc(kind)} · ${number(face)}</p>
        <p class="v-rank">${rarityMark(rarity(idOf(face)))} ${rarity(idOf(face))}${f === 'standard' ? '' : `<em class="fin-${f}">${finishName(f)}</em>`}</p>
        ${position}
        <div class="v-actions">
          <button class="v-arrow" data-click="col:turn:-1" aria-label="Previous card" ${index === 0 ? 'disabled' : ''}>‹</button>
          <button class="v-wallpaper" data-click="col:wallpaper">${PHONE_ICON} Make wallpaper</button>
          ${!editing ? '' : inShowcase ? '<span class="v-in">★ In your Showcase</span>'
            : '<button class="v-add" data-click="col:add">＋ Add to Showcase</button>'}
          <button class="v-arrow" data-click="col:turn:1" aria-label="Next card" ${index === list.length - 1 ? 'disabled' : ''}>›</button>
        </div>
        ${editing && inShowcase ? '<button class="v-remove" data-click="col:remove">Remove from Showcase</button>' : ''}
      </div>`;
}

function renderEmptyShowcase(): string {
  return `
    <div class="showcase-empty">
      <p class="empty-star" aria-hidden="true">☆</p>
      <h2>Your Showcase is empty</h2>
      <p>Open any card in All cards and tap <b>＋ Add to Showcase</b> to show it off here.</p>
      <button class="v-wallpaper" data-click="col:tab:all">Browse all cards</button>
    </div>`;
}

const PHONE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10.5 18.5h3"/></svg>`;

function renderGrid(): string {
  const have = SET.filter((id) => owned(id) > 0).length;
  const shown = SET.filter(shownByFilters).flatMap(facesOf);
  // Two rows of the game's own chip buttons: Rarity (each with its mark, and how many of it you have)
  // and Family (each in its colour). The picked chip in each row lights up; the rows combine.
  const rarityChips = [
    `<button class="chip fchip ${rarityFilter === 'all' ? 'chosen' : ''}" data-click="col:rarity:all" aria-pressed="${rarityFilter === 'all'}">All</button>`,
    ...RARITIES.map((r) => {
      const all = SET.filter((id) => rarity(id) === r), got = all.filter((id) => owned(id) > 0).length;
      const done = got === all.length;
      return `<button class="chip fchip ${rarityFilter === r ? 'chosen' : ''}" data-click="col:rarity:${r}" aria-pressed="${rarityFilter === r}"
        aria-label="${r}, ${got} of ${all.length} collected">${rarityMark(r)}<span>${r}</span><small class="${done ? 'done' : ''}">${done ? '✓' : `${got}/${all.length}`}</small></button>`;
    }),
  ].join('');
  const familyChips = FAMILIES.map((f) => `<button class="chip fchip ${f === 'all' ? '' : famClass(SET.find((id) => CARDS[id].family === f)!)} ${familyFilter === f ? 'chosen' : ''}"
      data-click="col:filter:${f}" aria-pressed="${familyFilter === f}">${f === 'all' ? '' : '<i class="fam-dot"></i>'}${f === 'all' ? 'All' : f}</button>`).join('');
  return `
    <div class="collection-grid" data-keep-scroll="grid">
      <div class="grid-head">
        <div class="collect-progress">
          <span class="cp-title">Starter Box</span>
          <span class="cp-count"><b>${have}</b> of ${SET.length} collected</span>
          <span class="cp-bar" aria-hidden="true"><i style="width:${(have / SET.length) * 100}%"></i></span>
        </div>
        <div class="filter-row" role="group" aria-label="Rarity"><span class="filter-label">Rarity</span><div class="filter-chips">${rarityChips}</div></div>
        <div class="filter-row" role="group" aria-label="Family"><span class="filter-label">Family</span><div class="filter-chips">${familyChips}</div></div>
      </div>
      ${shown.length ? `<div class="grid">${shown.map(renderTile).join('')}</div>` : `
      <div class="grid-empty">
        <p>No ${rarityFilter === 'all' ? '' : `${rarityFilter} `}${familyFilter === 'all' ? '' : `${familyFilter} `}cards in the Starter Box.</p>
        <button class="chip fchip" data-click="col:clear">Show all cards</button>
      </div>`}
    </div>`;
}

function renderTile(face: string): string {
  const copies = owned(idOf(face));
  const label = `${rarityMark(rarity(idOf(face)))} ${number(face).split('/')[0]}${sideOf(face) ? ` · ${sideLabel(face)}` : ''}${showcase.includes(face) ? ' <span class="tile-star" title="In your Showcase">★</span>' : ''}`;
  if (!copies) {
    return `<div class="tile missing"><img src="${cardUrl(face)}" alt="" loading="lazy"><span class="tile-soon">Coming soon</span>
      <span class="tile-label">${label}</span></div>`;
  }
  const f = finishOf(face);
  return `<button class="tile" data-click="col:open:${face}"
      aria-label="${esc(faceName(face))}, ${rarity(idOf(face))}${f === 'standard' ? '' : `, ${finishName(f)}`}">
      <span class="tile-card ${finishClasses(idOf(face))}"><img src="${yourCardUrl(face)}" alt="" loading="lazy" draggable="false"></span>${copies > 1 ? `<span class="tile-copies">×${copies}</span>` : ''}
      <span class="tile-label">${label}</span></button>`;
}

/** The preview's shape while the picture is drawn: tall for phones, 3:4 for tablets, wide for computers. */
const PREVIEW_SHAPE: Record<Device, string> = { phone: '9 / 19.5', tablet: '3 / 4', computer: '16 / 9' };

function renderWallpaperSheet(): string {
  if (!wallpaper) return '';
  const { device } = wallpaper;
  const picture = wallpaper.url
    ? `<img class="wall-preview ${device}" src="${wallpaper.url}" alt="Wallpaper preview">`
    : `<div class="wall-preview ${device} drawing" style="aspect-ratio:${PREVIEW_SHAPE[device]}">${wallpaper.note ? '' : 'Drawing…'}</div>`;
  // The documentation's section on setting it, for this device (docs/wallpapers.md).
  const section = device === 'computer' ? 'computer' : /Android/.test(navigator.userAgent) ? 'android' : 'iphone-and-ipad';
  const how = device === 'computer'
    ? 'Save the picture, then set it as your desktop background.'
    : 'Save the picture, then set it as your wallpaper.';
  return `
    <div class="overlay wall-overlay">
      <div class="settings wall-sheet" role="dialog" aria-label="Wallpaper">
        <h2>Wallpaper</h2>
        <div class="chip-row" role="group" aria-label="For" style="--n:${DEVICES.length}">
          ${DEVICES.map(([d, label]) => `<button class="chip ${d === device ? 'chosen' : ''}" data-click="col:device:${d}" aria-pressed="${d === device}">${label}</button>`).join('')}
        </div>
        ${picture}
        <p class="wall-how">${esc(wallpaper.note || how)}</p>
        <a class="wall-guide" href="${BASE}wallpapers.html#${section}" target="_blank" rel="noopener">How do I set it as my wallpaper?</a>
        <div class="delete-buttons">
          <button data-click="col:unwall">Close</button>
          <button class="primary" data-click="col:save" ${wallpaper.blob ? '' : 'disabled'}>Save picture</button>
        </div>
      </div>
    </div>`;
}

// ── The swiping viewer ───────────────────────────────────────────────────────────────────────────

/**
 * Called after every redraw of the Collection: puts the viewer on its card (without animating), and
 * follows its scrolling. Cards turn and fade as they leave the middle, and when another card settles
 * there, its name and the backdrop change without redrawing the screen (which would stop the scroll).
 */
export function showcaseMounted(): void {
  // A filter row too long for a phone scrolls sideways: keep its picked chip in sight.
  document.querySelectorAll<HTMLElement>('.filter-chips').forEach((row) => {
    const picked = row.querySelector<HTMLElement>('.chosen');
    if (picked) row.scrollLeft = picked.offsetLeft - (row.clientWidth - picked.offsetWidth) / 2;
  });
  const track = document.querySelector<HTMLElement>(browsing ? '.viewer-overlay [data-track]' : '.collection-screen [data-track]');
  const v = viewer();
  if (!track || !v) return;
  const container = track.closest('.viewer-overlay, .collection-screen')!;
  const slides = [...track.children] as HTMLElement[];
  scrollToCard(v.index, false);
  let frame = 0;
  const update = () => {
    frame = 0;
    const middle = track.scrollLeft + track.clientWidth / 2;
    let nearest = 0, best = Infinity;
    slides.forEach((slide, i) => {
      const offset = (slide.offsetLeft + slide.offsetWidth / 2 - middle) / slide.offsetWidth;
      const d = Math.max(-1.5, Math.min(1.5, offset));
      slide.style.setProperty('--d', d.toFixed(3));
      slide.style.setProperty('--ad', Math.min(1, Math.abs(d)).toFixed(3));
      if (Math.abs(offset) < best) { best = Math.abs(offset); nearest = i; }
    });
    const now = viewer();
    if (now && nearest !== now.index) {
      setIndex(nearest);
      const info = container.querySelector('.viewer-info');
      if (info) info.outerHTML = renderInfo(now.list, nearest);
      fadeAmbient(container, now.list[nearest]);
    }
  };
  track.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(update); }, { passive: true });
  update();
  followDrags(track);
}

/**
 * Swiping is done here, not by the browser. The strip isn't scrollable to the browser at all (see
 * showcase.css): on iPad, Safari's own scrolling of it failed in the Showcase, and when Safari claims a
 * finger it cancels the pointer events too. So the strip follows the finger itself, then glides to the
 * nearest card, or the next one on a quick flick. A trackpad's sideways swipe turns a card at a time.
 */
function followDrags(track: HTMLElement) {
  const slides = [...track.children] as HTMLElement[];
  const centre = (s: HTMLElement) => s.offsetLeft + s.offsetWidth / 2 - track.scrollLeft - track.clientWidth / 2;
  /** The card nearest the middle right now (the viewer's index only catches up on the next frame). */
  const nearest = () => slides.reduce((best, s, i) => (Math.abs(centre(s)) < Math.abs(centre(slides[best])) ? i : best), 0);
  let drag: { id: number; x0: number; left0: number; from: number; x: number; t: number; vx: number; moved: boolean } | null = null;
  let dragged = false;
  track.addEventListener('pointerdown', (e) => {
    swipeLog(e, track);
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x0: e.clientX, left0: track.scrollLeft, from: nearest(), x: e.clientX, t: e.timeStamp, vx: 0, moved: false };
    dragged = false;
  });
  track.addEventListener('pointermove', (e) => {
    swipeLog(e, track);
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0;
    if (!drag.moved) {
      if (Math.abs(dx) < 8) return;
      drag.moved = true;
      gliding++;   // stop any glide under way
      track.classList.add('dragging');
      try { track.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    }
    if (e.timeStamp > drag.t) drag.vx = 0.6 * drag.vx + 0.4 * ((e.clientX - drag.x) / (e.timeStamp - drag.t));
    drag.x = e.clientX; drag.t = e.timeStamp;
    track.scrollLeft = drag.left0 - dx;
  });
  const end = (e: PointerEvent) => {
    swipeLog(e, track);
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    // Swallow the click that may follow this pointerup, and only that one.
    dragged = true;
    window.setTimeout(() => { dragged = false; }, 0);
    // The card now nearest the middle; a quick flick turns at least one, even if not carried past halfway.
    let to = nearest();
    if (to === d.from && Math.abs(d.vx) > 0.3) to += d.vx < 0 ? 1 : -1;
    scrollToCard(to);
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  // A drag that ends on a card isn't a tap on it.
  track.addEventListener('click', (e) => { if (dragged) { dragged = false; e.stopPropagation(); e.preventDefault(); } }, true);
  let wheeled = 0, resting = 0;
  track.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (e.timeStamp < resting) return;
    wheeled += e.deltaX;
    if (Math.abs(wheeled) < 30) return;
    scrollToCard(nearest() + Math.sign(wheeled));
    wheeled = 0;
    resting = e.timeStamp + 450;
  }, { passive: false });
}

/**
 * With ?debug in the address: a readout of what the strip hears from the finger, for checking swiping
 * on a device we can't test here.
 */
const SWIPE_DEBUG = /[?&]debug(&|=|$)/.test(location.search);
const swipeCounts: Record<string, number> = {};
function swipeLog(e: PointerEvent, track: HTMLElement) {
  if (!SWIPE_DEBUG) return;
  swipeCounts[e.type] = (swipeCounts[e.type] ?? 0) + 1;
  let panel = document.getElementById('swipe-debug');
  if (!panel) {
    panel = document.createElement('pre');
    panel.id = 'swipe-debug';
    panel.style.cssText = 'position:fixed;left:8px;top:60px;z-index:999;margin:0;padding:8px;max-width:60vw;font:11px/1.35 monospace;'
      + 'color:#0f0;background:rgba(0,0,0,.8);border-radius:6px;pointer-events:none;white-space:pre-wrap';
    document.body.appendChild(panel);
  }
  const under = document.elementFromPoint(e.clientX, e.clientY);
  panel.textContent = [
    `build ${document.querySelector<HTMLScriptElement>('script[src*="main-"]')?.src.split('/').pop() ?? '?'}`,
    `last ${e.type} (${e.pointerType}) x=${Math.round(e.clientX)}`,
    Object.entries(swipeCounts).map(([k, n]) => `${k.replace('pointer', '')} ${n}`).join(' · '),
    `scrollLeft ${Math.round(track.scrollLeft)} of ${track.scrollWidth - track.clientWidth}`,
    `touch-action ${getComputedStyle(track).touchAction} · overflow-x ${getComputedStyle(track).overflowX}`,
    `under finger: ${under ? `${under.tagName.toLowerCase()}.${[...under.classList].join('.')}` : 'nothing'}`,
  ].join('\n');
}

function fadeAmbient(container: Element, face: string) {
  const [a, b] = [...container.querySelectorAll<HTMLElement>(':scope > .ambient > .ambient-layer')];
  if (!a || !b) return;
  const [shown, hidden] = a.classList.contains('show') ? [a, b] : [b, a];
  hidden.style.backgroundImage = `url(${artUrl(face)})`;
  hidden.classList.add('show');
  shown.classList.remove('show');
}

// Finishes' sheens follow a mouse or pen. Not a finger: on a touch screen a finger on a card is swiping
// the viewer, and redrawing the sheen under it made iPad Safari drop the swipe.
document.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  const holo = (event.target as HTMLElement).closest?.<HTMLElement>('.holo');
  if (!holo) return;
  const r = holo.getBoundingClientRect();
  holo.style.setProperty('--mx', `${((event.clientX - r.left) / r.width) * 100}%`);
  holo.style.setProperty('--my', `${((event.clientY - r.top) / r.height) * 100}%`);
}, { passive: true });
