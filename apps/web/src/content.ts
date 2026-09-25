// The cards the game plays with. The engine has none of its own: the sets in content/ are handed to it
// here, before anything reads the catalog. The public game loads released sets only; prototypes are for
// playtests.
//
// Card packs: every set is also published as a pack: data (set.json) and art. The site publishes the sets
// it was built with (/packs/index.json), and the pack storage holds sets published on their own with
// `npm run publish-pack` (PACK_INDEXES). At start-up the game registers any released pack it wasn't built
// with, or a newer version of one it was, so new cards reach a running site without a new game build.
// A pack whose cards need plugin code the game doesn't have is skipped: code only arrives with a build.
import { SETS, missingPieces, registerSet, type SetData } from '@fruitcats/engine';
import { loadContent } from '../../../content';
import { ART_BASES, BASE } from './ui';

loadContent(registerSet);

/**
 * Where packs are listed: the pack storage first (sets published on their own, npm run publish-pack), then
 * this site's own list (the sets it was built with). See docs/card-data-architecture.md.
 */
export const PACK_INDEXES = [
  import.meta.env.VITE_PACK_INDEX ?? 'https://fruitcatspacks.blob.core.windows.net/packs/index.json',
  `${BASE}packs/index.json`,
];

interface PackEntry { set: string; name: string; version?: string; status?: string; data: string; art?: string; cards?: string }

/**
 * `?prototypes` also takes prototype packs: a playtester's way to try a set that isn't released, on the real
 * site. They never show without it.
 */
const wantPrototypes = /[?&]prototypes\b/.test(location.search);

/** Compare two dotted versions ('0.3.0' < '0.10.0'); missing parts count as 0. */
function newer(a: string | undefined, b: string | undefined): boolean {
  const pa = (a ?? '0').split('.').map(Number), pb = (b ?? '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** Register the card packs this build doesn't have yet. Never waits more than `timeoutMs` in all. */
export async function loadPacks(timeoutMs = 1500): Promise<string[]> {
  const loaded: string[] = [];
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const fetchJson = <T>(url: string) =>
    Promise.race([fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null), deadline]);
  const indexes = await Promise.all(PACK_INDEXES.map(async (url) => ({ url, index: await fetchJson<{ packs: PackEntry[] }>(url) })));
  for (const { url, index } of indexes) {
    for (const pack of index?.packs ?? []) {
      if (pack.status !== 'released' && !wantPrototypes) continue;
      const have = SETS[pack.set];
      if (have && !newer(pack.version, have.version)) continue;
      const at = (path: string) => new URL(path, new URL(url, location.href)).href;
      const data = await fetchJson<SetData>(at(pack.data));
      if (!data || data.set !== pack.set) continue;
      const missing = missingPieces(data);
      if (missing.length) {
        console.warn(`Card pack ${pack.name} needs a newer game (${missing.join(', ')}); skipped.`);
        continue;
      }
      registerSet(data);
      if (pack.art && pack.cards) ART_BASES[pack.set.toLowerCase()] = { art: at(pack.art), cards: at(pack.cards) };
      loaded.push(pack.set);
    }
  }
  return loaded;
}
