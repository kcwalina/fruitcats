// Small helpers shared by the screens: asset URLs, HTML escaping, family colours, the settings gear.

import { CARDS, TERMS } from '@fruitcats/engine';

export const BASE = import.meta.env.BASE_URL;
/** The pack storage: every set's data and art, published with `npm run publish-pack` (docs/card-data-architecture.md). */
export const PACKS: string = import.meta.env.VITE_PACKS ?? 'https://fruitcatspacks.blob.core.windows.net/packs/';
/**
 * Where each set's art is published, by set code ('dw1'). In dev the set's folder is served on this site
 * (/<set>/, /cards/<set>/, vite.config.ts). A build takes the art from the pack storage instead, so the site
 * stays small enough to deploy: Azure takes the whole site as one upload in a two-minute window, and card art
 * (over 100 MB by the third deck) doesn't fit. A card pack from the storage brings its own addresses (content.ts).
 */
export const ART_BASES: Record<string, { art: string; cards: string }> = {};
const LOCAL_ART: boolean = import.meta.env.VITE_LOCAL_ART === 'on';
/** Set folders the game isn't built with (such as a Studio practice set): their few frames stay on the site. */
const SITE_ART = new Set<string>(import.meta.env.VITE_SITE_ART_SETS ?? []);
/**
 * Where a build found each built-in set's art on the pack storage: a folder named by the art's fingerprint
 * (vite.config.ts, content/pack-storage.ts). What is there never changes, so another checkout publishing its own
 * art can't change what this build shows.
 */
const BUILT_ART: Record<string, { art: string; cards: string }> = import.meta.env.VITE_ART_BASES ?? {};
/** A set's art addresses, by set code: where its illustrations and finished cards are. */
export const artBases = (code: string) => ART_BASES[code] ?? BUILT_ART[code] ?? (LOCAL_ART || SITE_ART.has(code)
  ? { art: `${BASE}${code}/`, cards: `${BASE}cards/${code}/` }
  : { art: `${PACKS}${code}/art/illustrations/`, cards: `${PACKS}${code}/art/cards/` });
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

export const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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
