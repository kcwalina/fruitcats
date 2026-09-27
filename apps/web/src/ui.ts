// Small helpers shared by the screens: asset URLs, HTML escaping, family colours, the settings gear.

import { CARDS, TERMS } from '@fruitcats/engine';

export const BASE = import.meta.env.BASE_URL;
/** The pack storage: every set's data and art, published with `npm run publish-pack` (docs/card-data-architecture.md). */
export const PACKS: string = import.meta.env.VITE_PACKS ?? 'https://fruitcatspacks.blob.core.windows.net/packs/';
/**
 * Where each set's art is published, by set code ('sb1'). In dev the set's folder is served on this site
 * (/<set>/, /cards/<set>/, vite.config.ts). A build takes the art from the pack storage instead, so the site
 * stays small enough to deploy: Azure takes the whole site as one upload in a two-minute window, and card art
 * (over 100 MB by the third deck) doesn't fit. A card pack from the storage brings its own addresses (content.ts).
 */
export const ART_BASES: Record<string, { art: string; cards: string }> = {};
const LOCAL_ART: boolean = import.meta.env.VITE_LOCAL_ART === 'on';
/** Set folders the game isn't built with (the Studio's practice sets): their few frames stay on the site. */
const SITE_ART = new Set<string>(import.meta.env.VITE_SITE_ART_SETS ?? []);
/** A set's art addresses, by set code: where its illustrations and finished cards are. */
export const artBases = (code: string) => ART_BASES[code] ?? (LOCAL_ART || SITE_ART.has(code)
  ? { art: `${BASE}${code}/`, cards: `${BASE}cards/${code}/` }
  : { art: `${PACKS}${code}/art/illustrations/`, cards: `${PACKS}${code}/art/cards/` });
const setCode = (key: string) => (CARDS[key.replace(/-(kitten|bigcat)$/, '')]?.set ?? 'SB1').toLowerCase();
const bases = (key: string) => artBases(setCode(key));
/** A card's illustration. `key` is a card id, or a Hero Cat's `<id>-kitten` / `<id>-bigcat`. */
export const artUrl = (key: string) => `${bases(key).art}${key}.webp`;
/** A card's finished picture, standard print. */
export const cardUrl = (key: string) => `${bases(key).cards}${key}.webp`;
/** A card's finished picture in a special finish (foil, gold, prismatic, signature). */
export const finishUrl = (key: string, finish: string) => `${bases(key).cards}${finish}/${key}.webp`;

export const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A family's name as players read it (the data keeps its own names, e.g. Garden is shown as Wildfolk). */
export const familyName = (family?: string) => (family ? TERMS.families[family as keyof typeof TERMS.families] ?? family : '');

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
