// What the dashboard page needs to know about the game, so it names and colors things from data rather than
// a list written into the page: every deck (a new starter shows up by itself), its family's color and the LLM
// playtester personas. The relay uploads it as the dashboard's meta/dashboard document.
//
// Interim: docs/card-data-architecture.md moves cards, decks and families (with their frame colors) into set
// folders read through packages/content. When that lands, build this from the loaded sets and delete
// FAMILY_COLORS; the shape the page reads can stay the same.

import { CARDS, DECKS, cardName } from '../lib/engine';
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
}

export function dashboardMeta(): DashboardMeta {
  return {
    updatedAt: new Date().toISOString(),
    cardsHash: cardsHash(),
    decks: Object.entries(DECKS).map(([key, d]) => ({
      key, name: d.name, hero: d.hero, heroName: cardName(d.hero), family: CARDS[d.hero].family, color: familyColor(CARDS[d.hero].family),
    })),
    personas: Object.values(PERSONAS).map((p) => ({ key: p.key, name: p.name })),
  };
}
