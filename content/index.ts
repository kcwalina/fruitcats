// Every card set, in release folders: content/<year>/<month>/<set>/set.json, with plugin.ts when the set
// needs code the engine doesn't have. Sets are imported statically (the playtest runner is bundled into
// one file that runs far from this repo) and handed to an engine with `loadContent(registerSet)`, so this
// file imports nothing from the engine and the engine knows nothing of the sets.
//
// Released sets are for everyone. Prototypes (designed, not released) are only for playtests and tools:
// the public game loads released sets alone.

import type { Plugin, SetData } from '../packages/engine/src/cards';
import starterBox from './2026/09/starter-box/set.json';
import starterBoxPlugin from './2026/09/starter-box/plugin';
import heatWave from './2026/09/heat-wave/set.json';
import berryPicnic from './2026/12/berry-picnic/set.json';
import berryPicnicPlugin from './2026/12/berry-picnic/plugin';

export interface ContentSet {
  data: SetData;
  plugin?: Plugin;
  /** Where the set lives: content/<folder>/set.json. */
  folder: string;
}

export const CONTENT: ContentSet[] = [
  { data: starterBox as unknown as SetData, plugin: starterBoxPlugin, folder: '2026/09/starter-box' },
  { data: heatWave as unknown as SetData, folder: '2026/09/heat-wave' },
  { data: berryPicnic as unknown as SetData, plugin: berryPicnicPlugin, folder: '2026/12/berry-picnic' },
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
  // Sets are listed in release order, so one that builds on another (Heat Wave uses the Starter Box's
  // Garden cards and mechanics) is registered after it.
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
