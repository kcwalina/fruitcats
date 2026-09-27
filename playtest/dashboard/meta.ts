// What the dashboard page needs to know about the game, so it names and colors things from data rather than
// a list written into the page: every deck (a new starter shows up by itself), its family's color and the LLM
// playtester personas, the deck library (custom decks, each with its deck code: a run started from the page is
// given the code, which PC2024 can play before the library reaches it at the next deploy) and the Hero Cats a
// deck can be built around. PC2024's playtester runs `node runner.mjs dashboard-meta` once an hour and sends it to the
// Fruitcats API (docs/playtests.md).
//
// Colors come from the sets: each family's first color (its card frame) in its set.json.

import { CARDS, DECKS, FAMILIES, cardName, deckCode } from '../lib/engine';
import { playableHeroes } from '../balance/decks';
import { deckFamilies, libraryDecks } from '../decks/library';
import { averageRate } from '../decks/retention';
import { cardsHash } from '../lib/runs';
import { seedFrom } from '../lib/rng';
import { PERSONAS } from '../llm/personas';

/** A family's frame color from its set, or a stable hue of its own for a family that has none. */
const familyColor = (family: string): string => FAMILIES[family]?.colors?.[0] ?? `hsl(${seedFrom(family) % 360} 55% 45%)`;

export interface DashboardMeta {
  updatedAt: string;
  cardsHash: string;
  decks: { key: string; name: string; hero: string; heroName: string; family: string; color: string }[];
  personas: { key: string; name: string }[];
  library: {
    key: string; name: string; hero: string; heroName: string; families: string[]; color: string; source: string; about: string;
    goal?: string; vsStarters?: number; llm?: { games: number; won: number }; pinned?: boolean; addedAt: string; code: string;
  }[];
  heroes: { id: string; name: string; family: string }[];
}

export function dashboardMeta(): DashboardMeta {
  return {
    updatedAt: new Date().toISOString(),
    cardsHash: cardsHash(),
    decks: Object.entries(DECKS).map(([key, d]) => ({
      key, name: d.name, hero: d.hero, heroName: cardName(d.hero), family: CARDS[d.hero].family, color: familyColor(CARDS[d.hero].family),
    })),
    personas: Object.values(PERSONAS).map((p) => ({ key: p.key, name: p.name })),
    library: Object.entries(libraryDecks()).map(([key, d]) => ({
      key, name: d.name, hero: d.hero, heroName: cardName(d.hero), families: deckFamilies(d), color: familyColor(CARDS[d.hero].family),
      source: d.source, about: d.about, ...(d.goal ? { goal: d.goal } : {}), ...(averageRate(d) !== undefined ? { vsStarters: averageRate(d) } : {}), ...(d.stats?.llm ? { llm: d.stats.llm } : {}), ...(d.pinned ? { pinned: true } : {}),
      addedAt: d.addedAt, code: deckCode(d),
    })),
    heroes: playableHeroes().map((id) => ({ id, name: cardName(id), family: CARDS[id].family })),
  };
}

/** `node runner.mjs dashboard-meta`: prints the document, one line of JSON, for PC2024's playtester to send the API. */
export async function metaCommand(): Promise<number> {
  console.log(JSON.stringify(dashboardMeta()));
  return 0;
}
