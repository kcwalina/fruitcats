import { describe, expect, it } from 'vitest';
import { CARDS, DECKS, deckSize } from '../lib/engine';
import { runJobs } from '../lib/pool';
import { seedFrom } from '../lib/rng';
import type { GameRecord, MatchJob } from '../balance/match';
import { removalResult, removalTest, vanillaFor, withoutCard } from '../balance/removal';
import { cardImpact } from '../balance/stats';

const game = (rounds: number, winner: 0 | 1, played: Record<string, number>): GameRecord => ({
  seats: ['a', 'b'], winner, starting: 0, rounds, actions: 0, grewUp: [0, 0], played: [played, {}], levelEnd: [0, 0],
});

describe('card screen', () => {
  it("doesn't reward a late card for the games it merely survived to", () => {
    // Deck a wins every long game and loses every short one; the late card, played in round 8 of every long
    // game, does nothing for it. The old measure called it +50 points.
    const records: GameRecord[] = [];
    for (let i = 0; i < 50; i++) {
      records.push(game(3, 1, { early: 1 }));
      records.push(game(10, 0, { early: 1, late: 8 }));
    }
    const late = cardImpact(records).find((c) => c.id === 'late')!;
    expect(late.raw).toBeCloseTo(0.5);
    expect(late.delta).toBeCloseTo(0);
  });
});

describe('removal tests', () => {
  it('every starter deck has a plain 2/1 to put in a removed card\'s place', () => {
    for (const d of Object.values(DECKS)) {
      const v = vanillaFor(d)!;
      expect(v).toBeDefined();
      expect([CARDS[v].cost, CARDS[v].power, CARDS[v].health]).toEqual([1, 2, 1]);
    }
  });

  it('swaps every copy in the deck list and leaves the card itself alone', () => {
    const [key] = Object.keys(DECKS);
    const deck = DECKS[key];
    const id = Object.keys(deck.cards).find((c) => c !== vanillaFor(deck))!;
    const before = JSON.stringify(CARDS[id]);
    const changed = withoutCard(deck, id)!;
    expect(changed.cards[id]).toBeUndefined();
    expect(changed.cards[vanillaFor(deck)!]).toBe((deck.cards[vanillaFor(deck)!] ?? 0) + deck.cards[id]);
    expect(deckSize(changed)).toBe(deckSize(deck));
    expect(JSON.stringify(CARDS[id])).toBe(before);
    expect(withoutCard(deck, vanillaFor(deck)!)).toBeUndefined();
  });

  it('plays the starters\' own seeds, so a card that changes nothing is worth exactly 0', async () => {
    const keys = Object.keys(DECKS);
    const base: MatchJob[] = keys.flatMap((a, i) => keys.slice(i + 1).map((b) => ({ a: { key: a, deck: DECKS[a] }, b: { key: b, deck: DECKS[b] }, seed: seedFrom(`t:${a}:${b}`), from: 0, to: 6 })));
    const deck = keys[0];
    const t = removalTest(Object.keys(DECKS[deck].cards).find((c) => c !== vanillaFor(DECKS[deck]))!, base, 4)!;
    expect(t.jobs).toHaveLength(keys.length - 1);
    expect(t.jobs.every((j) => j.to - j.from === 4)).toBe(true);
    // Stand-in for "removed": the unchanged deck under the removal key.
    const same = t.jobs.map((j) => ({ ...j, a: j.a.key === t.key ? { key: t.key, deck: DECKS[deck] } : j.a, b: j.b.key === t.key ? { key: t.key, deck: DECKS[deck] } : j.b }));
    const [baseRecords, sameRecords] = await Promise.all([runJobs(t.base, { threads: 1 }), runJobs(same, { threads: 1 })]);
    const r = removalResult(t, baseRecords, sameRecords);
    expect(r.games).toBe(4 * (keys.length - 1));
    expect(r.worth).toBe(0);
    expect(r.error).toBe(0);
  }, 60_000);
});
