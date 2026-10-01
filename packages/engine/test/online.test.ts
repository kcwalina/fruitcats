import { describe, expect, it } from 'vitest';
import { LIVES, apply, createGame, nextSeat, randomAction, viewFor, type GameState, type PlayerId } from '../src/index';

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** Plays a random game to the end. */
function playOut(s: GameState, seed: number): GameState {
  const r = rng(seed);
  for (let p = nextSeat(s); p !== null; p = nextSeat(s)) apply(s, randomAction(s, r, p), p);
  return s;
}

describe('handicap: starting with fewer Candles', () => {
  it('starts each player with the Candles they chose, and the same deck', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 5, lives: [6, 9] });
    expect(s.players[0].lives).toBe(6);
    expect(s.players[1].lives).toBe(LIVES);
    expect(s.players[0].handicap).toBe(3);
    expect(s.players[1].handicap).toBeUndefined();
    const cards = (p: PlayerId) => s.players[p].deck.length + s.players[p].shop.length;
    expect(cards(0)).toBe(cards(1));
  });

  it('keeps Candles between 1 and 9', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 5, lives: [0, 20] });
    expect(s.players[0].lives).toBe(1);
    expect(s.players[1].lives).toBe(LIVES);
  });

  it('plays to the end', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = playOut(createGame({ decks: ['domowiki', 'pari'], seed, lives: [4, 9] }), seed);
      expect(s.winner).not.toBeNull();
    }
  });

  it('shows the handicap to both players', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 5, lives: [7, 9] });
    expect(viewFor(s, 1).players[0].handicap).toBe(2);
    expect(viewFor(s, 1).players[0].lives).toBe(7);
  });
});

describe('rules a game was made with', () => {
  it('are kept in the game, so a saved game or a match plays on with them', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 5, rules: { clashCandleCap: 1, startOfferings: 9 } });
    expect(s.rules.clashCandleCap).toBe(1);
    expect(s.players[0].offerings).toBe(9);
    const again = structuredClone(s);
    expect(again.rules).toEqual(s.rules);
  });
});
