import { describe, expect, it } from 'vitest';
import {
  CARDS, DECKS, apply, chooseAction, createGame, deckCardIds, legalActions, randomAction, keywords,
  type GameState,
} from '../src/index';

function playOut(s: GameState, pick: (s: GameState) => ReturnType<typeof chooseAction>, limit = 5000): GameState {
  for (let i = 0; s.winner === null; i++) {
    if (i > limit) throw new Error('game did not finish');
    apply(s, pick(s));
  }
  return s;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe('card data', () => {
  it('builds legal 50-card decks', () => {
    for (const key of Object.keys(DECKS)) {
      const ids = deckCardIds(key);
      expect(ids).toHaveLength(50);
      const cats = ids.filter((id) => CARDS[id].type === 'Cat');
      expect(cats.length).toBeLessThanOrEqual(6);
      expect(new Set(cats).size).toBe(cats.length);
    }
  });

  it('parses keywords from card text', () => {
    expect(keywords('SB1-O07')).toMatchObject({ guardian: true, tough: 1 });
    expect(keywords('SB1-C09')).toMatchObject({ pounce: true, lucky: true });
    expect(keywords('SB1-O03').guardian).toBe(false); // "If you control a Guardian" is not the keyword
  });
});

describe('setup', () => {
  it('deals 9 Lives, 6 cards, then plants 2', () => {
    const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 7 });
    expect(s.prompt?.kind).toBe('mulligan');
    for (const pl of s.players) {
      expect(pl.lives).toHaveLength(9);
      expect(pl.hand).toHaveLength(6);
    }
    apply(s, { t: 'mulligan', uids: [] });
    apply(s, { t: 'mulligan', uids: [] });
    for (const p of [0, 1] as const) {
      expect(s.prompt).toMatchObject({ kind: 'setupPlant', player: p });
      apply(s, { t: 'setupPlant', uids: s.players[p].hand.slice(0, 2).map((c) => c.uid) });
    }
    expect(s.prompt).toMatchObject({ kind: 'action', player: s.yarn });
    expect(s.players[0].pantry).toHaveLength(2);
  });

  it('rejects illegal actions', () => {
    const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 7 });
    expect(() => apply(s, { t: 'pass' })).toThrow();
  });
});

describe('full games', () => {
  it('random agents always finish a game', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed);
      const s = playOut(createGame({ decks: ['zest-rush', 'orchard-guard'], seed }), (g) => randomAction(g, r));
      expect(s.winner).not.toBeNull();
    }
  });

  it('AI agents finish, and the same seeds replay identically', () => {
    const run = () => {
      const r = rng(99);
      return playOut(createGame({ decks: ['orchard-guard', 'zest-rush'], seed: 5 }), (g) => chooseAction(g, { random: r }));
    };
    const a = run();
    const b = run();
    expect(a.winner).not.toBeNull();
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  });

  it('the AI beats a random player', () => {
    let aiWins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed);
      const s = playOut(createGame({ decks: ['zest-rush', 'orchard-guard'], seed }), (g) =>
        g.prompt!.player === 0 ? chooseAction(g, { random: r }) : randomAction(g, r));
      if (s.winner === 0) aiWins++;
    }
    expect(aiWins).toBeGreaterThanOrEqual(16);
  });

  it('only ever offers legal actions', () => {
    const r = rng(3);
    const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 3 });
    while (s.winner === null) {
      const legal = legalActions(s);
      if (s.prompt!.kind === 'action') expect(legal.some((a) => a.t === 'pass')).toBe(true);
      apply(s, randomAction(s, r));
    }
  });
});
