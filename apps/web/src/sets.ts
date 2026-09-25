// What the game shows about the loaded card sets, read from their data (content/…/set.json) rather than
// written into the client: families' one-line hints, mechanics' plain-language reminders and badges, deck
// blurbs, and which Hero Cat is the face of the game.

import { CARDS, DECKS, FAMILIES, MECHANICS, SETS, type MechanicDef } from '@fruitcats/engine';

/** A family's signature mechanic and its one-line hint (deck picker, deck builder). */
export function familyInfo(family: string): { mechanic: string; hint: string } | undefined {
  const f = FAMILIES[family] as (typeof FAMILIES)[string] & { hint?: string } | undefined;
  return f?.mechanic ? { mechanic: f.mechanic, hint: f.hint ?? '' } : undefined;
}

/** Colours of a family (main, dark, tint), as compose_cards.py prints them; Garden's when unknown. */
export function familyColors(family: string): [string, string, string] {
  const c = FAMILIES[family]?.colors ?? FAMILIES.Garden?.colors ?? ['#5FA84D', '#3B7430', '#E3F2DC'];
  return [c[0], c[1], c[2]];
}

/** Every set mechanic as a glossary entry: its name, how to spot it in rules text, and its reminder. */
export function mechanicGlossary(): { name: string; test: RegExp; text: string }[] {
  return Object.entries(MECHANICS).map(([name, m]) => ({
    name,
    test: new RegExp(`\\b${name}s?\\b`),
    text: m.family ? `${m.reminder} (${m.family})` : m.reminder,
  }));
}

type Badge = { icon?: string; title?: string };
/** The mechanics that show a badge on a player's panel while they hold (Tropical's Lush). */
export function badgeMechanics(family: string): [string, MechanicDef & { badge: Badge }][] {
  return Object.entries(MECHANICS)
    .filter(([, m]) => m.kind === 'condition' && m.family === family && (m as { badge?: Badge }).badge)
    .map(([name, m]) => [name, m as MechanicDef & { badge: Badge }]);
}

/** A deck's one-line description, from its set's data. */
export const deckBlurb = (key: string): string => (DECKS[key] as { blurb?: string } | undefined)?.blurb ?? '';

/** The Hero Cats of released sets (previews included), for the home screen. */
function releasedHeroes(): string[] {
  return Object.values(CARDS)
    .filter((c) => c.type === 'Hero Cat' && c.set && SETS[c.set]?.status === 'released')
    .map((c) => c.id);
}

/** The face of the game: the mightiest Big Cat (most Power, Fierce breaking ties). Tango, today. */
export function featuredHero(): string {
  const score = (id: string) => (CARDS[id].bigCat?.power ?? 0) * 2 + (CARDS[id].bigCat?.keywords?.includes('Fierce') ? 1 : 0);
  return [...releasedHeroes()].sort((a, b) => score(b) - score(a))[0] ?? Object.keys(CARDS)[0];
}

/** Up to five pictures for the home screen's parade: the featured Hero Cat in the middle, then the others, then `extras`. */
export function heroParade(extras: string[], picture: (id: string) => string): string[] {
  const star = picture(featuredHero());
  const rest = [...releasedHeroes().filter((id) => id !== featuredHero()).map(picture), ...extras].slice(0, 4);
  const half = Math.ceil(rest.length / 2);
  return [...rest.slice(0, half), star, ...rest.slice(half)];
}

/** The families that have cards among these (previews aside), in the order the sets define them. */
export function familiesOf(ids: string[]): string[] {
  const present = new Set(ids.filter((id) => !CARDS[id]?.preview).map((id) => CARDS[id]?.family));
  return Object.keys(FAMILIES).filter((f) => present.has(f));
}
