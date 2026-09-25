// Small helpers shared by the screens: asset URLs, HTML escaping, family colours, the settings gear.

import { CARDS } from '@fruitcats/engine';

export const BASE = import.meta.env.BASE_URL;
/**
 * Where each set's art is published, by set code ('sb1'). A set built into the game is on this site
 * (/<set>/, /cards/<set>/); a card pack from the pack storage brings its own addresses (content.ts).
 */
export const ART_BASES: Record<string, { art: string; cards: string }> = {};
const setCode = (key: string) => (CARDS[key.replace(/-(kitten|bigcat)$/, '')]?.set ?? 'SB1').toLowerCase();
const bases = (key: string) => {
  const code = setCode(key);
  return ART_BASES[code] ?? { art: `${BASE}${code}/`, cards: `${BASE}cards/${code}/` };
};
/** A card's illustration. `key` is a card id, or a Hero Cat's `<id>-kitten` / `<id>-bigcat`. */
export const artUrl = (key: string) => `${bases(key).art}${key}.webp`;
/** A card's finished picture, standard print. */
export const cardUrl = (key: string) => `${bases(key).cards}${key}.webp`;
/** A card's finished picture in a special finish (foil, gold, prismatic, signature). */
export const finishUrl = (key: string, finish: string) => `${bases(key).cards}${finish}/${key}.webp`;

export const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Each fruit family is a class with its own signature mechanic. */
export const famClass = (id: string) => `fam-${(CARDS[id]?.family ?? 'garden').toLowerCase()}`;

/** The gear that opens Settings: in Home's corner, in the menu headers, and beside Rules in a game. */
export function settingsButton(extraClass = ''): string {
  return `<button data-click="ui:settings" class="icon-button settings-button ${extraClass}" title="Settings" aria-label="Settings">
      <img src="${BASE}ui/icon-settings.webp" alt=""></button>`;
}

/** The button at the left of a menu header: Home (the house icon), or back one step (an arrow). */
export function backButton(click = 'ui:back', label = 'Home'): string {
  const face = click === 'ui:back' ? `<img src="${BASE}ui/icon-home.webp" alt="">` : '<span class="back-arrow" aria-hidden="true">‹</span>';
  return `<button class="icon-button back-button" data-click="${click}" title="${label}" aria-label="${label}">${face}</button>`;
}
