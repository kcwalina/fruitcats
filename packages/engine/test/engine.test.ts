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

/** Play until it's player 0's action phase, then return the state (setup handled by the AI). */
function toFirstAction(decks: [string, string], seed = 1): GameState {
  const s = createGame({ decks, seed, firstPlayer: 0 });
  while (!(s.prompt?.kind === 'action' && s.prompt.player === 0)) apply(s, chooseAction(s));
  return s;
}

describe('Mango Tango (Tropical)', () => {
  it('Mochi readies a Treat, and Grows Up at 8 Treats', () => {
    const s = toFirstAction(['mango-tango', 'zest-rush']);
    const me = s.players[0];
    expect(me.hero.id).toBe('SB1-H03');
    me.pantry.forEach((t) => (t.exhausted = true));
    apply(s, { t: 'ability' });
    expect(me.pantry.filter((t) => !t.exhausted)).toHaveLength(1);
    // Grow Up is checked after every step: give her 8 Treats and let the opponent act.
    while (me.pantry.length < 8) me.pantry.push({ card: me.deck.shift()!, exhausted: true });
    apply(s, legalActions(s).find((a) => a.t === 'pass' || a.t === 'decline')!);
    expect(me.hero.grown).toBe(true);
  });

  it('Tropical Rain puts two cards from the deck into the Pantry, exhausted', () => {
    const s = toFirstAction(['mango-tango', 'zest-rush']);
    const me = s.players[0];
    me.hand.push({ uid: 9001, id: 'SB1-T09' });
    while (me.pantry.length < 3) me.pantry.push({ card: me.deck.shift()!, exhausted: false });
    me.pantry.forEach((t) => (t.exhausted = false));
    const before = { pantry: me.pantry.length, deck: me.deck.length };
    apply(s, { t: 'play', uid: 9001 });
    while (s.prompt?.player === 1 && s.prompt.kind === 'pounce') apply(s, { t: 'decline' });
    expect(me.pantry.length).toBe(before.pantry + 2);
    expect(me.deck.length).toBe(before.deck - 2);
    expect(me.pantry.slice(-2).every((t) => t.exhausted)).toBe(true);
  });

  it('Lychee Sloth cannot attack with fewer than 6 Treats', () => {
    const s = toFirstAction(['mango-tango', 'zest-rush']);
    const me = s.players[0];
    me.yard.push({ uid: 9002, id: 'SB1-T05', damage: 0, exhausted: false, buffPower: 0, buffSneaky: false, buffGuardian: false, usedOnce: false });
    const slothAttacks = () => legalActions(s).filter((a) => a.t === 'attack' && a.attacker.kind === 'unit' && a.attacker.uid === 9002);
    expect(slothAttacks()).toHaveLength(0);
    while (me.pantry.length < 6) me.pantry.push({ card: me.deck.shift()!, exhausted: true });
    expect(slothAttacks().length).toBeGreaterThan(0);
  });
});

describe('full games', () => {
  it('random agents always finish a game, for every deck pairing', () => {
    const keys = Object.keys(DECKS);
    let seed = 1;
    for (const a of keys) for (const b of keys) {
      for (let i = 0; i < 12; i++, seed++) {
        const r = rng(seed);
        const s = playOut(createGame({ decks: [a, b], seed }), (g) => randomAction(g, r));
        expect(s.winner).not.toBeNull();
      }
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
