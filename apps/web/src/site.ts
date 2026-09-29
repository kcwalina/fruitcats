// The site's addresses and the smallest helpers, which need nothing of the game: the Artist Studio uses these and
// nothing else of the game's screens, so its page loads none of the game (ui.ts has the rest).

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
export const BUILT_ART: Record<string, { art: string; cards: string }> = import.meta.env.VITE_ART_BASES ?? {};
/** A set's art addresses, by set code: where its illustrations and finished cards are. */
export const artBases = (code: string) => ART_BASES[code] ?? BUILT_ART[code] ?? (LOCAL_ART || SITE_ART.has(code)
  ? { art: `${BASE}${code}/`, cards: `${BASE}cards/${code}/` }
  : { art: `${PACKS}${code}/art/illustrations/`, cards: `${PACKS}${code}/art/cards/` });

export const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
