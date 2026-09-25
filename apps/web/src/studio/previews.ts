// The artist's picture where players will see it. Every preview uses the game's own pieces, so it shows the real
// thing, not an imitation of it:
//  - on the card: the card's frame from tools/compose_cards.py --frames, with the picture in its see-through window
//    (stretched to 666 × 444 there, exactly as compose_cards.py does);
//  - in the game: the board's unit and hero tiles, at their sizes in apps/web/src/style.css;
//  - as a wallpaper: the game's own wallpaper maker (src/wallpaper.ts).

import { CARDS, type Rarity } from '@fruitcats/engine';
import { esc, BASE } from '../ui';
import { renderWallpaper, type Device } from '../wallpaper';
import type { Finish } from '../collection';
import type { BriefPicture } from './brief';

/** The card's picture window, as fractions of the 750 × 1050 card (compose_cards.py ART_BOX). */
const ART = { left: 42 / 750, top: 138 / 1050, width: 666 / 750, height: 444 / 1050 };

/**
 * The prints this image's card appears in: the standard print, and its paid finish. A card designed as a Signature
 * card appears only in its Signature print, so that's all the Studio shows.
 */
export function finishesOf(p: BriefPicture): { finish: string; label: string }[] {
  if (p.tier === 'signature') return [{ finish: 'signature', label: 'Signature' }];
  const list = [{ finish: 'standard', label: 'Standard' }];
  if (p.tier === 'foil') list.push({ finish: 'foil', label: 'Foil' });
  if (p.tier === 'gold') list.push({ finish: 'gold', label: 'Gold' });
  return list;
}

/** Frame colours an artist may choose (compose_cards.py PALETTES): the name, and the colours shown on its swatch. */
export const PALETTES: [string, string, string][] = [
  ['midnight', '#2B3A55', '#141C2B'], ['sky', '#3B82C4', '#1D4A78'], ['violet', '#4A2F7A', '#1E1236'], ['berry', '#D6336C', '#8F1D46'],
  ['orchard', '#D64545', '#8E2A2A'], ['pepper', '#D7261E', '#5A0E0A'], ['tropical', '#F2780C', '#A24E05'], ['citrus', '#F29F05', '#A86400'],
  ['gold', '#C8961E', '#7A5A0C'], ['garden', '#5FA84D', '#3B7430'], ['melon', '#3FA66B', '#25714A'], ['ink', '#3A3A3A', '#161616'],
];

/** The frame colour each card is shown in, for cards whose artist chooses it: set by the Studio as it draws a page.
 * "image:<version>" (or "image:local") is the artist's own image instead of a colour. */
export const framePalettes = new Map<string, string>();
/** The artist's own frame images, as addresses for <img>, by set/key. */
export const frameImages = new Map<string, string>();

const isImage = (palette?: string) => !!palette?.startsWith('image:');

const frameUrl = (code: string, key: string, finish: string) => {
  const palette = framePalettes.get(`${code}/${key}`);
  const dir = isImage(palette) ? 'p-image/' : palette ? `p-${palette}/` : '';
  return `${BASE}cards/${code}/frames/${dir}${finish === 'standard' ? '' : `${finish}/`}${key}.webp`;
};

/** The picture on its card. With no picture yet, the window shows where it will go. */
export function cardPreview(code: string, key: string, finish: string, art: string | null, width: number, pins = ''): string {
  const window = `left:${ART.left * 100}%;top:${ART.top * 100}%;width:${ART.width * 100}%;height:${ART.height * 100}%`;
  // The artist's own frame image goes under the frame, which is see-through where it shows (p-image frames).
  const own = isImage(framePalettes.get(`${code}/${key}`)) ? frameImages.get(`${code}/${key}`) : undefined;
  return `<div class="pv-card" style="width:${width}px">
    ${own ? `<img class="pv-card-bg" src="${own}" alt="">` : ''}
    ${art ? `<img class="pv-card-art" src="${art}" alt="" style="${window}">`
      : `<div class="pv-card-empty" style="${window}"><span>Your image goes here</span></div>`}
    <img class="pv-card-frame" src="${frameUrl(code, key, finish)}" alt="">
    ${pins ? `<div class="pv-pins" style="${window}">${pins}</div>` : ''}
  </div>`;
}

/** Where a card's face is on the board: a unit tile (Critters, Cats, tokens) or the hero tile (Hero Cats). */
function boardShape(p: BriefPicture): 'unit' | 'hero' | null {
  if (!p.card) return null;
  const card = CARDS[p.card];
  if (!card) return p.kind === 'token' ? 'unit' : null;
  if (card.type === 'Hero Cat') return 'hero';
  return card.type === 'Critter' || card.type === 'Cat' || p.kind === 'token' ? 'unit' : null;
}

function faceOf(p: BriefPicture) {
  const card = p.card ? CARDS[p.card] : undefined;
  const face = p.side === 'kitten' ? card?.kitten : p.side === 'bigcat' ? card?.bigCat : card;
  return { card, name: face?.name ?? p.workingName ?? p.file, power: face?.power ?? card?.power, health: p.side ? undefined : card?.health };
}

/** The picture as the game shows it during play, on a phone and on a computer. */
export function gamePreview(p: BriefPicture, art: string | null, code: string, key: string): string {
  const shape = boardShape(p);
  const { card, name, power, health } = faceOf(p);
  const family = (p.family ?? card?.family ?? 'garden').toLowerCase();
  const bg = art ? `background-image:url(${art})` : '';
  const tile = (height: number) => shape === 'hero'
    ? `<div class="pv-hero fam-${family}" style="height:${height}px;width:${height * 1.4}px"><div class="pv-tile-art" style="${bg}"></div>
        ${power !== undefined ? `<div class="pv-pow">${power}</div>` : ''}</div>`
    : `<div class="pv-unit fam-${family}" style="height:${height}px;width:${height * 0.76}px"><div class="pv-tile-art" style="${bg}"></div>
        <div class="pv-uname">${esc(name)}</div>
        ${power !== undefined ? `<div class="pv-pow">${power}</div>` : ''}${health !== undefined ? `<div class="pv-hp">${health}</div>` : ''}</div>`;
  const hand = (w: number) => `<div class="pv-hand">${cardPreview(code, key, p.tier === 'signature' ? 'signature' : 'standard', art, w)}</div>`;
  const shapeName = shape === 'hero' ? 'the Hero Cat’s tile' : 'a unit on the board';
  return `<div class="pv-game">
    <figure><div class="pv-stage">${hand(92)}</div><figcaption>In a player’s hand, on a phone</figcaption></figure>
    ${shape ? `<figure><div class="pv-stage pv-yard">${tile(shape === 'hero' ? 56 : 104)}</div><figcaption>As ${shapeName}, on a phone</figcaption></figure>
    <figure><div class="pv-stage pv-yard">${tile(shape === 'hero' ? 96 : 160)}</div><figcaption>As ${shapeName}, on a computer</figcaption></figure>` : ''}
  </div>
  ${shape ? `<p class="pv-note">${shape === 'hero'
    ? 'The Hero Cat’s tile is a little wider than tall, so the top and bottom of your image are trimmed.'
    : 'A unit’s tile is taller than wide, so the left and right of your image are cut off. The character in the middle stays.'}</p>` : ''}`;
}

/** A Pawtrait in the circles the game shows it in. */
export function pawtraitPreview(art: string | null): string {
  const face = (size: number, label: string) => `<figure><div class="pv-paw" style="width:${size}px;height:${size}px;${art ? `background-image:url(${art})` : ''}"></div><figcaption>${label}</figcaption></figure>`;
  return `<div class="pv-paws">${face(200, 'Account screen')}${face(72, 'Friends list')}${face(40, 'On the board')}</div>`;
}

/** Announcement key art: as a link preview when the announcement is shared, and at the top of its page. */
export function announcementPreview(art: string | null, setName: string): string {
  const bg = art ? `background-image:url(${art})` : '';
  return `<div class="pv-announce">
    <figure><div class="pv-share"><div class="pv-share-art" style="${bg}"></div>
      <div class="pv-share-text"><small>fruitcats.viamochi.com</small><b>${esc(setName)}: coming soon to Fruitcats</b><span>New cards, a new deck and new friends.</span></div></div>
      <figcaption>Shared as a link, in a chat or on social media</figcaption></figure>
    <figure><div class="pv-banner" style="${bg}"><b>${esc(setName)}</b></div><figcaption>At the top of the announcement page</figcaption></figure>
  </div>`;
}

// ── Wallpapers ───────────────────────────────────────────────────────────────────────────────────

const wallpapers = new Map<string, Promise<string>>();

/** A wallpaper made by the game's own wallpaper maker, as an image address. Made once per picture and device. */
export function wallpaper(p: BriefPicture, art: string, artId: string, device: Device): Promise<string> | null {
  if (!p.card || !CARDS[p.card]) return null;
  const finish: Finish = p.tier === 'foil' ? 'foil' : p.tier === 'gold' ? 'gold' : p.tier === 'signature' ? 'signature' : 'standard';
  const id = `${artId}|${device}|${finish}`;
  let url = wallpapers.get(id);
  if (!url) {
    const rarity = (CARDS[p.card].rarity ?? 'Common') as Rarity;
    url = renderWallpaper(p.card, p.side ?? null, finish, rarity, p.card, device, art).then((b) => URL.createObjectURL(b));
    url.catch(() => wallpapers.delete(id));
    wallpapers.set(id, url);
  }
  return url;
}

export const DEVICES: [Device, string][] = [['phone', 'Phone lock screen'], ['tablet', 'Tablet'], ['computer', 'Computer']];

/** The clock a phone's lock screen draws over the wallpaper, roughly where an iPhone puts it. */
export const LOCK_CLOCK = `<div class="pv-lock"><small>Wednesday, 24 September</small><b>9:41</b></div>`;
