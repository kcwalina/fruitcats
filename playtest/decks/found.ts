// Which decks from deck hunts and deck builds are worth keeping in the library: `decks import` on the laptop and the
// library's night on PC2024 (nightly.ts) both use it.

import { parseDeckCode } from '../lib/engine';
import type { RunSummary } from '../lib/runs';
import type { LibraryDeck } from './library';

export type Found = Omit<LibraryDeck, 'addedAt'>;

/** The decks worth keeping from deck hunts (those that beat the starters often enough) and deck builds (the pick). */
export function worthKeeping(runs: RunSummary[], min: number): Found[] {
  const found: Found[] = [];
  // A run with the fake provider (random answers, for trying the pipeline) never made a deck worth keeping.
  for (const r of runs.filter((x) => x.details.provider !== 'fake')) {
    if (r.kind === 'deck-hunt') {
      for (const d of (r.details.decks ?? []) as { name: string; idea: string; hero: string; cards: Record<string, number>; vsStarters: number }[]) {
        if (d.vsStarters < min) continue;
        found.push({ name: d.name.replace(/^hunt: /, ''), hero: d.hero, cards: d.cards, source: 'hunt', about: d.idea, vsStarters: d.vsStarters, from: r.id });
      }
    }
    if (r.kind === 'deck-build') {
      const p = r.details.pick as { name: string; idea: string; code: string; vsStarters?: number } | null;
      const deck = p ? parseDeckCode(p.code) : null;
      if (p && deck) {
        found.push({
          name: p.name, hero: deck.hero, cards: deck.cards, source: 'built', about: p.idea, goal: String(r.details.goal ?? ''),
          ...(p.vsStarters !== undefined ? { vsStarters: p.vsStarters } : {}), from: `${r.id} (${r.details.model})`,
        });
      }
    }
  }
  return found;
}

