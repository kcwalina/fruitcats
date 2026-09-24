// The cards the game plays with. The engine has none of its own: the sets in content/ are handed to it
// here, before anything reads the catalog. The public game loads released sets only; prototypes are for
// playtests.
//
// Card packs: the site also publishes every set as a pack (/packs/index.json, /packs/<set>/set.json; see
// contentAssets in vite.config.ts). At start-up the game registers any released pack it wasn't built with,
// or a newer version of one it was, so new cards and art can reach a running site without a new game build.
// A pack whose cards need plugin code the game doesn't have is skipped: code only arrives with a build.
import { SETS, missingPieces, registerSet, type SetData } from '@fruitcats/engine';
import { loadContent } from '../../../content';
import { BASE } from './ui';

loadContent(registerSet);

interface PackEntry { set: string; name: string; version?: string; status?: string; data: string }

/** Packs to take besides released ones: dev only, `?prototypes` (to see a prototype set in the game). */
const wantPrototypes = import.meta.env.DEV && /[?&]prototypes\b/.test(location.search);

/** Register the site's card packs that this build doesn't have yet. Never waits more than `timeoutMs`. */
export async function loadPacks(timeoutMs = 1500): Promise<string[]> {
  const loaded: string[] = [];
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const fetchJson = <T>(url: string) =>
    Promise.race([fetch(url, { cache: 'no-cache' }).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null), timeout]);
  const index = await fetchJson<{ packs: PackEntry[] }>(`${BASE}packs/index.json`);
  for (const pack of index?.packs ?? []) {
    if (pack.status !== 'released' && !wantPrototypes) continue;
    const have = SETS[pack.set];
    if (have && have.version === pack.version) continue;
    const data = await fetchJson<SetData>(`${BASE}${pack.data}`);
    if (!data || data.set !== pack.set) continue;
    const missing = missingPieces(data);
    if (missing.length) {
      console.warn(`Card pack ${pack.name} needs a newer game (${missing.join(', ')}); skipped.`);
      continue;
    }
    registerSet(data);
    loaded.push(pack.set);
  }
  return loaded;
}
