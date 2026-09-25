import { describe, expect, it } from 'vitest';
import { DECKS, deckProblems, deckSize } from '../lib/engine';
import { runJobs } from '../lib/pool';
import { mulberry } from '../lib/rng';
import { cardPool, families, mutateDeck, playableHeroes, randomDeck } from '../balance/decks';
import type { MatchJob } from '../balance/match';
import { matchups } from '../balance/stats';

describe('generated decks', () => {
  it('1,000 random and mutated decks are all legal', () => {
    const rng = mulberry(42);
    const heroes = playableHeroes();
    expect(heroes.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < 500; i++) {
      const hero = heroes[i % heroes.length];
      const partners = [undefined, ...families().filter((f) => f !== undefined)];
      const deck = randomDeck(rng, hero, partners[i % partners.length], `r${i}`);
      expect(deckProblems(deck)).toEqual([]);
      expect(deckSize(deck)).toBe(50);
    }
    const keys = Object.keys(DECKS);
    for (let i = 0; i < 500; i++) {
      const deck = mutateDeck(rng, DECKS[keys[i % keys.length]], 1 + (i % 10), `m${i}`);
      expect(deckProblems(deck)).toEqual([]);
    }
  }, 60_000); // 1,000 decks: over the default 5 s when the whole suite runs at once

  it('a card pool holds only the hero family, Garden and the partner', () => {
    const pool = cardPool('SB1-H01', 'Orchard');
    expect(pool.some((id) => id.startsWith('SB1-O'))).toBe(true);
    expect(pool.some((id) => id.startsWith('SB1-T'))).toBe(false);
  });
});

describe('worker pool', () => {
  it('plays the same games on four threads as on one', async () => {
    const job: MatchJob = {
      a: { key: 'zest-rush', deck: DECKS['zest-rush'] },
      b: { key: 'mango-tango', deck: DECKS['mango-tango'] },
      seed: 1234, from: 0, to: 40,
    };
    const [single] = await runJobs([job], { threads: 1 });
    const [multi] = await runJobs([job], { threads: 4 });
    expect(multi).toEqual(single);
    expect(matchups(single).overall['zest-rush'].games).toBe(40);
  }, 120_000);
});
