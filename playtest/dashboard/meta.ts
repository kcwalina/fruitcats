// What the dashboard page needs to know about the game, so it names and colors things from data rather than
// a list written into the page: every deck (a new starter shows up by itself), its family's color and the LLM
// playtester personas, the deck library (custom decks, each with its deck code: a run started from the page is
// given the code, which PC2024 can play before the library reaches it at the next deploy) and the Hero Cats a
// deck can be built around. PC2024's playtester runs `node runner.mjs dashboard-meta` once an hour and sends it to the
// Fruitcats API (docs/playtests.md).
//
// Interim: docs/card-data-architecture.md moves cards, decks and families (with their frame colors) into set
// folders read through packages/content. When that lands, build this from the loaded sets and delete
// FAMILY_COLORS; the shape the page reads can stay the same.

import { CARDS, DECKS, cardName, deckCode } from '../lib/engine';
import { playableHeroes } from '../balance/decks';
import { deckFamilies, libraryDecks } from '../decks/library';
import { averageRate } from '../decks/retention';
import { cardsHash } from '../lib/runs';
import { seedFrom } from '../lib/rng';
import { PERSONAS } from '../llm/personas';

// The card frames' family colors (tools/compose_cards.py), except Tropical in green: its orange frame reads too
// close to Citrus's yellow side by side on a chart. A family missing here gets a stable hue of its own.
const FAMILY_COLORS: Record<string, string> = {
  Citrus: '#E89400', Orchard: '#CC3D3D', Tropical: '#3F8F2F', Berry: '#D6336C', Melon: '#3FA66B', Garden: '#5FA84D',
};
const familyColor = (family: string): string => FAMILY_COLORS[family] ?? `hsl(${seedFrom(family) % 360} 55% 45%)`;

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
