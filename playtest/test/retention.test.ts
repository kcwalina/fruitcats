import { describe, expect, it } from 'vitest';
import { DECKS } from '../lib/engine';
import type { LibraryDeck, LibraryFile } from '../decks/library';
import { retention, type RetentionConfig } from '../decks/retention';

const NOW = Date.parse('2027-01-01T00:00:00Z');
const cfg: RetentionConfig = { cap: 4, graceDays: 14, dropBelow: 0.35, keepAbove: 0.6, agePenaltyPerMonth: 0.02, gamesPerStarter: 40 };

function deck(name: string, daysOld: number, rates: number[], extra: Partial<LibraryDeck> = {}): LibraryDeck {
  const base = DECKS['zest-rush'];
  return {
    name, hero: base.hero, cards: base.cards, source: 'built', about: '', addedAt: new Date(NOW - daysOld * 86400e3).toISOString(),
    stats: { bot: rates.map((rate, i) => ({ date: `2026-12-${String(i + 1).padStart(2, '0')}`, rate })) }, ...extra,
  };
}
const keys = (file: LibraryFile) => retention(file, NOW, cfg).filter((v) => !v.keep).map((v) => v.key).sort();

describe('deck retention', () => {
  it('drops a deck that keeps losing once its grace period is over, even with room to spare', () => {
    const file: LibraryFile = { decks: { loser: deck('Loser', 30, [0.3, 0.28, 0.32]), fresh: deck('Fresh loser', 3, [0.2]), ok: deck('OK', 30, [0.5]) } };
    expect(keys(file)).toEqual(['loser']);
  });

  it('over the cap, drops the lowest score (win rate less age), keeping strong old decks and pinned ones', () => {
    const file: LibraryFile = {
      decks: {
        champion: deck('Champion', 1000, [0.72, 0.7]), // three years old, still a keeper
        oldMiddling: deck('Old middling', 300, [0.5]),
        newMiddling: deck('New middling', 20, [0.5]),
        good: deck('Good', 60, [0.56]),
        mine: deck('Mine', 900, [0.4], { pinned: true }),
        young: deck('Young', 2, [0.45]),
      },
    };
    // Six decks, cap four: the two lowest scores that aren't keepers, new or pinned go.
    expect(keys(file)).toEqual(['newMiddling', 'oldMiddling']);
  });

  it('judges on recent results: a deck that got stronger with card changes is kept', () => {
    const file: LibraryFile = { decks: { better: deck('Better', 40, [0.2, 0.2, 0.2, 0.2, 0.2, 0.5, 0.5, 0.5, 0.5, 0.5]) } };
    expect(keys(file)).toEqual([]);
  });
});
