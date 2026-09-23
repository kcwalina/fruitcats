import { describe, expect, it } from 'vitest';
import {
  CARDS, DECKS, HIDDEN, apply, createGame, legalActions, other, randomAction, viewFor,
  type GameState, type PlayerId,
} from '../src/index';

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

function shuffled<T>(items: T[], r: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The same game with everything `seat` may not know changed: what their view must not depend on. */
function scramble(s: GameState, seat: PlayerId, r: () => number): GameState {
  const c = structuredClone(s);
  const ids = Object.keys(CARDS);
  const any = () => ids[Math.floor(r() * ids.length)];
  const foe = c.players[other(seat)];
  foe.hand = foe.hand.map((h) => ({ uid: h.uid, id: any() }));
  foe.pantry = foe.pantry.map((t) => ({ ...t, card: { uid: t.card.uid, id: any() } }));
  for (const pl of c.players) {
    const pool = shuffled([...pl.deck, ...pl.lives], r);
    pl.lives = pool.slice(0, pl.lives.length);
    pl.deck = pool.slice(pl.lives.length);
  }
  c.seed = Math.floor(r() * 2 ** 31);
  return c;
}

/** Every step of a random game, for each deck pairing. */
function* states(gamesPerPairing: number): Generator<GameState> {
  let seed = 1;
  for (const a of Object.keys(DECKS)) for (const b of Object.keys(DECKS)) {
    for (let i = 0; i < gamesPerPairing; i++, seed++) {
      const r = rng(seed);
      const s = createGame({ decks: [a, b], seed });
      while (s.winner === null) {
        yield s;
        apply(s, randomAction(s, r));
      }
      yield s;
    }
  }
}

describe('player views (online play)', () => {
  it('card uids say nothing about which card they are', () => {
    const firstCard = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed });
      const all = s.players[0].deck.concat(s.players[0].hand, s.players[0].lives, s.players[0].pantry.map((t) => t.card));
      firstCard.add(all.find((c) => c.uid === 1)!.id);
    }
    expect(firstCard.size).toBeGreaterThan(8);
  });

  it('never depends on hidden information', () => {
    const r = rng(7);
    let checked = 0;
    for (const s of states(3)) {
      for (const seat of [0, 1] as PlayerId[]) {
        expect(viewFor(scramble(s, seat, r), seat)).toEqual(viewFor(s, seat));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  }, 30_000); // thousands of clones and deep compares: ~5s, more on a busy machine

  it('hides the seed, decks, Lives, the opponent\'s hand and Treats, and the opponent\'s decision', () => {
    for (const s of states(1)) {
      for (const seat of [0, 1] as PlayerId[]) {
        const v = viewFor(s, seat);
        const foe = v.players[other(seat)];
        expect(v.seed).toBe(0);
        expect(v.queue).toEqual([]);
        for (const pl of v.players) {
          expect(pl.deck.every((c) => c.id === HIDDEN && c.uid === 0)).toBe(true);
          expect(pl.lives.every((c) => c.id === HIDDEN && c.uid === 0)).toBe(true);
        }
        expect(foe.hand.every((c) => c.id === HIDDEN)).toBe(true);
        expect(foe.pantry.every((t) => t.card.id === HIDDEN)).toBe(true);
        // Counts stay public (rule 100.5).
        expect(foe.hand.length).toBe(s.players[other(seat)].hand.length);
        expect(v.players[seat].deck.length).toBe(s.players[seat].deck.length);
        // Your own hand and Treats are yours to see.
        expect(v.players[seat].hand).toEqual(s.players[seat].hand);
        expect(v.waitingOn).toBe(s.winner === null ? s.prompt!.player : null);
        expect(v.prompt).toEqual(s.prompt?.player === seat ? s.prompt : null);
      }
    }
  });

  it('offers the same choices as the full game, so a screen can work from its view', () => {
    for (const s of states(1)) {
      if (s.winner !== null) continue;
      const seat = s.prompt!.player;
      expect(legalActions(viewFor(s, seat))).toEqual(legalActions(s));
    }
  });
});
