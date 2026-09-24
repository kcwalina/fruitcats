// What the dashboard needs to know about the game, so it names and colors things from data rather than a
// list written into the page: every deck (a new starter shows up by itself), the families and the LLM
// playtester personas. The relay uploads it as the dashboard's meta/catalog document.

import { CARDS, DECKS, cardName } from './engine';
import { cardsHash } from './runs';
import { PERSONAS } from '../llm/personas';
import { seedFrom } from './rng';

// The card frames' family colors (tools/compose_cards.py), except Tropical in green: its orange frame reads too
// close to Citrus's yellow side by side on a chart. A family missing here gets a stable hue of its own.
const FAMILY_COLORS: Record<string, string> = {
  Citrus: '#E89400', Orchard: '#CC3D3D', Tropical: '#3F8F2F', Berry: '#D6336C', Melon: '#3FA66B', Garden: '#5FA84D',
};
export const familyColor = (family: string): string => FAMILY_COLORS[family] ?? `hsl(${seedFrom(family) % 360} 55% 45%)`;

export interface Catalog {
  updatedAt: string;
  cardsHash: string;
  decks: { key: string; name: string; hero: string; heroName: string; family: string; color: string }[];
  personas: { key: string; name: string }[];
}

export function catalog(): Catalog {
  return {
    updatedAt: new Date().toISOString(),
    cardsHash: cardsHash(),
    decks: Object.entries(DECKS).map(([key, d]) => ({
      key, name: d.name, hero: d.hero, heroName: cardName(d.hero), family: CARDS[d.hero].family, color: familyColor(CARDS[d.hero].family),
    })),
    personas: Object.values(PERSONAS).map((p) => ({ key: p.key, name: p.name })),
  };
}
