import { describe, expect, it } from 'vitest';
import {
  CARDS, DECKS, HIDDEN, SETS, apply, createGame, legalActions, mayAct, nextSeat, other, randomAction, viewFor,
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
  foe.ambushes = (foe.ambushes ?? []).map((a) => ({ ...a, card: { uid: a.card.uid, id: any() } }));
  for (const pl of c.players) {
    const pool = shuffled([...pl.deck, ...pl.lives], r);
    pl.lives = pool.slice(0, pl.lives.length);
    pl.deck = pool.slice(pl.lives.length);
  }
  c.seed = Math.floor(r() * 2 ** 31);
  return c;
}

/** The released decks: what these tests check is a rule about views, so it needn't grow with every new set. */
const released = () => Object.keys(DECKS).filter((k) => SETS[CARDS[DECKS[k].hero]?.set ?? '']?.status === 'released');

/** Every step of a random game, for each pair of decks. */
function* states(gamesPerPairing: number): Generator<GameState> {
  let seed = 1;
  const decks = released();
  for (const [i, a] of decks.entries()) for (const b of decks.slice(i)) {
    for (let g = 0; g < gamesPerPairing; g++, seed++) {
      const r = rng(seed);
      const s = createGame({ decks: [a, b], seed });
      for (let p = nextSeat(s); p !== null; p = nextSeat(s)) {
        yield s;
        apply(s, randomAction(s, r, p), p);
      }
      yield s;
    }
  }
}

describe('player views (online play)', () => {
  it('card uids say nothing about which card they are', () => {
    const firstCard = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = createGame({ decks: ['domowiki', 'pari'], seed });
      const all = s.players[0].deck.concat(s.players[0].hand, s.players[0].lives);
      firstCard.add(all.find((c) => c.uid === 1)!.id);
    }
    expect(firstCard.size).toBeGreaterThan(8);
  });

  it('never depends on hidden information', () => {
    const r = rng(7);
    let checked = 0;
    for (const s of states(2)) {
      for (const seat of [0, 1] as PlayerId[]) {
        expect(viewFor(scramble(s, seat, r), seat)).toEqual(viewFor(s, seat));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  }, 120_000);

  it("doesn't move with the opponent's moves during the Muster: not their plays, their Ready, or their log", () => {
    const r = rng(11);
    let checked = 0;
    for (const s of states(1)) {
      if (s.prompt?.kind !== 'muster') continue;
      for (const seat of [0, 1] as PlayerId[]) {
        const foe = other(seat);
        if (!mayAct(s, foe) || !mayAct(s, seat)) continue;
        const before = viewFor(s, seat);
        const after = structuredClone(s);
        // A few moves of theirs, Ready included: with this seat still deciding, the Clash can't start.
        for (let i = 0; i < 4 && mayAct(after, foe); i++) apply(after, randomAction(after, r, foe), foe);
        expect(viewFor(after, seat)).toEqual(before);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 120_000);

  it("hides the seed, decks, Candles, the opponent's hand and Ambushes, and the opponent's decision", () => {
    for (const s of states(1)) {
      for (const seat of [0, 1] as PlayerId[]) {
        const v = viewFor(s, seat);
        const foe = v.players[other(seat)];
        expect(v.seed).toBe(0);
        expect(v.queue).toEqual([]);
        for (const pl of v.players) {
          expect(pl.deck.every((c) => c.id === HIDDEN && c.uid === 0)).toBe(true);
          expect(pl.lives.every((c) => c.id === HIDDEN && c.uid === 0)).toBe(true);
          expect(pl.shown).toBeUndefined();
        }
        expect(foe.hand.every((c) => c.id === HIDDEN)).toBe(true);
        expect((foe.ambushes ?? []).every((a) => a.card.id === HIDDEN)).toBe(true);
        expect(foe.pending ?? []).toEqual([]);
        expect(v.events.every((e) => e.secret === undefined || e.secret === seat)).toBe(true);
        expect(v.log.every((e) => e.secret === undefined || e.secret === seat)).toBe(true);
        // Your own hand is yours to see.
        expect(v.players[seat].hand).toEqual(s.players[seat].hand);
        if (s.prompt?.kind === 'mulligan') expect(v.prompt).toEqual(s.prompt.player === seat ? s.prompt : null);
        if (s.prompt?.kind === 'muster') expect(v.prompt).toEqual(mayAct(s, seat) ? { kind: 'muster', player: seat } : null);
      }
    }
  }, 60_000);

  it('offers the same choices as the full game, so a screen can work from its view', () => {
    for (const s of states(1)) {
      for (const seat of [0, 1] as PlayerId[]) {
        if (!mayAct(s, seat)) continue;
        expect(legalActions(viewFor(s, seat), seat)).toEqual(legalActions(s, seat));
      }
    }
  }, 60_000);
});
