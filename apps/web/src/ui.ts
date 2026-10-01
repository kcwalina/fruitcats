// Small helpers shared by the screens: asset URLs, HTML escaping, family colours, the settings gear.

import { CARDS, TERMS } from '@fruitcats/engine';

export { ART_BASES, BASE, PACKS, artBases, esc } from './site';
import { ART_BASES, BASE, BUILT_ART, artBases } from './site';

/**
 * When each set's art was last published, by set code (content.ts reads it from the pack list). It's added to the set's
 * picture addresses, so redrawn art reaches every device at once: the offline worker and the browser keep a picture by
 * its address (for a day or more), and a republished set has new addresses.
 */
export const ART_STAMPS: Record<string, string> = {};
/** A card's set, by code; for a card the game doesn't know, the code its id starts with ('DW1-D01': dw1). */
const setCode = (key: string) => (CARDS[key.replace(/-(kitten|bigcat)$/, '')]?.set ?? key.split('-')[0]).toLowerCase();
const bases = (key: string) => artBases(setCode(key));
/** The stamp for a set's pictures; none for a build's own fingerprinted art, whose addresses already change with it. */
const stampOf = (set: string) => { const v = !ART_BASES[set] && BUILT_ART[set] ? undefined : ART_STAMPS[set]; return v ? `?v=${encodeURIComponent(v)}` : ''; };
const stamp = (key: string) => stampOf(setCode(key));
/** A card's illustration. `key` is a card id, or a Hero Cat's `<id>-kitten` / `<id>-bigcat`. */
export const artUrl = (key: string) => `${bases(key).art}${key}.webp${stamp(key)}`;
/** One of a set's own pictures that isn't a card's (its tale's banner), by the set's code and the picture's name. */
export const setArtUrl = (code: string, name: string) => {
  const set = code.toLowerCase();
  return `${artBases(set).art}${name}.webp${stampOf(set)}`;
};
/** A card's finished picture, standard print. */
export const cardUrl = (key: string) => `${bases(key).cards}${key}.webp${stamp(key)}`;
/** A card's finished picture in a special finish (foil, gold, prismatic, signature). */
export const finishUrl = (key: string, finish: string) => `${bases(key).cards}${finish}/${key}.webp${stamp(key)}`;


/** A family's name as players read it (the data keeps its own names, e.g. Garden is shown as Wildfolk). */
export const familyName = (family?: string) => (family ? TERMS.families[family as keyof typeof TERMS.families] ?? family : '');

/** Each fruit family is a class with its own signature mechanic. */
export const famClass = (id: string) => `fam-${(CARDS[id]?.family ?? 'none').toLowerCase().replace(/\s+/g, '-')}`;

/** The gear that opens Settings: in Home's corner, in the menu headers, and beside Rules in a game. */
export function settingsButton(extraClass = ''): string {
  return `<button data-click="ui:settings" class="icon-button settings-button ${extraClass}" title="Settings" aria-label="Settings">
      <img src="${BASE}ui/icon-settings.webp" alt=""></button>`;
}

/** The button at the left of a menu header: Home (the house icon, wherever Home is; in a game too, so players
 *  find the same icon everywhere), or back one step (an arrow). */
export function backButton(click = 'ui:back', label = 'Home'): string {
  const face = label === 'Home' ? `<img src="${BASE}ui/icon-home.webp" alt="">` : '<span class="back-arrow" aria-hidden="true">‹</span>';
  return `<button class="icon-button back-button" data-click="${click}" title="${label}" aria-label="${label}">${face}</button>`;
}

/** The click key of a selection's other choice (Offer it, set it face-down), by its place among them. */
export const altKey = (i: number) => `btn:alt:${i}`;
/** Which of a selection's other choices a click key names (`btn:alt:<i>`): the third part, not the second. */
export const altOf = (key: string) => Number(key.split(':')[2]);
