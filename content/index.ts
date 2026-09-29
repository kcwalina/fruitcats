// Every card set, in release folders: content/<year>/<month>/<set>/set.json, with plugin.ts when the set
// needs code the engine doesn't have. Sets are imported statically (the playtest runner is bundled into
// one file that runs far from this repo) and handed to an engine with `loadContent(registerSet)`, so this
// file imports nothing from the engine and the engine knows nothing of the sets.
//
// Released sets are for everyone. Prototypes (designed, not released) are only for playtests and tools:
// the public game loads released sets alone.

import type { Plugin, SetData } from '../packages/engine/src/cards';
import mochi from './2026/12/mochi/set.json';
import domowiki from './2026/10/domowiki/set.json';
import pari from './2026/10/pari/set.json';
import aluxes from './2026/11/aluxes/set.json';
import jiaoren from './2026/12/jiaoren/set.json';
import flowerSouls from './2027/01/flower-souls/set.json';
import huiHai from './2027/01/hui-hai/set.json';

/**
 * Sets taken out of the game, by code: the Starter Box (the original fruit-cat cards, the owner's call, 2026-09-29).
 * A card pack of one still listed in the pack storage is never loaded (apps/web/src/content.ts).
 */
export const RETIRED_SETS = ['SB1'];

export interface ContentSet {
  data: SetData;
  plugin?: Plugin;
  /** Where the set lives: content/<folder>/set.json. */
  folder: string;
}

export const CONTENT: ContentSet[] = [
  { data: domowiki as unknown as SetData, folder: '2026/10/domowiki' },
  { data: pari as unknown as SetData, folder: '2026/10/pari' },
  { data: aluxes as unknown as SetData, folder: '2026/11/aluxes' },
  { data: mochi as unknown as SetData, folder: '2026/12/mochi' },
  { data: jiaoren as unknown as SetData, folder: '2026/12/jiaoren' },
  { data: flowerSouls as unknown as SetData, folder: '2027/01/flower-souls' },
  { data: huiHai as unknown as SetData, folder: '2027/01/hui-hai' },
];

export interface LoadOptions {
  /** Also load prototype sets (playtests, simulations, tools). Default: released sets only. */
  prototypes?: boolean;
  /**
   * With `prototypes`, whether their decks join the registered decks too (default true). The playtest
   * harness's balance gate treats every registered deck as a starter deck, so it loads prototype cards
   * without their decks and plays those decks as extra contestants (see prototypeDecks).
   */
  prototypeDecks?: boolean;
}

/** Register the sets with an engine: pass its `registerSet`. Returns the sets it loaded. */
export function loadContent(register: (data: SetData, plugin?: Plugin) => void, options: LoadOptions = {}): ContentSet[] {
  const chosen = CONTENT.filter((c) => c.data.status === 'released' || options.prototypes);
  // Sets are listed in release order, so one that builds on another (its `requires`) is registered after it.
  for (const c of chosen) {
    const keepDecks = c.data.status === 'released' || options.prototypeDecks !== false;
    register(keepDecks ? c.data : { ...c.data, decks: {} }, c.plugin);
  }
  return chosen;
}

/** The decks of prototype sets, by key: to playtest them against the released decks. */
export function prototypeDecks(): Record<string, NonNullable<SetData['decks']>[string]> {
  return Object.assign({}, ...CONTENT.filter((c) => c.data.status !== 'released').map((c) => c.data.decks ?? {}));
}
