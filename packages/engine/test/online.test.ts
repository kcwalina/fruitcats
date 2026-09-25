import { describe, expect, it } from 'vitest';
import { LIVES, apply, createGame, legalActions, randomAction, viewFor, type GameState, type PlayerId } from '../src/index';

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** Plays a random game to the end, calling `each` before every action. */
function playOut(s: GameState, seed: number, each: (s: GameState) => void = () => {}): GameState {
  const r = rng(seed);
  while (s.winner === null) { each(s); apply(s, randomAction(s, r)); }
  return s;
}

describe('handicap: starting with fewer Lives', () => {
  it('starts each player with the Lives they chose, and keeps the rest in the deck', () => {
    const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 5, lives: [6, 9] });
    expect(s.players[0].lives.length).toBe(6);
    expect(s.players[1].lives.length).toBe(LIVES);
    expect(s.players[0].handicap).toBe(3);
    expect(s.players[1].handicap).toBeUndefined();
    const cards = (p: PlayerId) => s.players[p].deck.length + s.players[p].hand.length + s.players[p].lives.length;
    expect(cards(0)).toBe(cards(1));
  });

  it('keeps Lives between 1 and 9', () => {
    const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 5, lives: [0, 20] });
    expect(s.players[0].lives.length).toBe(1);
    expect(s.players[1].lives.length).toBe(LIVES);
  });

  it('plays to the end', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = playOut(createGame({ decks: ['zest-rush', 'orchard-guard'], seed, lives: [4, 9] }), seed);
      expect(s.winner).not.toBeNull();
    }
  });

  it('shows the handicap to both players', () => {
    const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 5, lives: [7, 9] });
    expect(viewFor(s, 1).players[0].handicap).toBe(2);
    expect(viewFor(s, 1).players[0].lives.length).toBe(7);
  });
});

describe('alwaysAsk: Pounce and Lucky prompts that give nothing away', () => {
  it('asks the defender after every play and attack, with only "let it happen" when they hold no Pounce', () => {
    let windows = 0, empty = 0;
    for (let seed = 1; seed <= 20; seed++) {
      playOut(createGame({ decks: ['zest-rush', 'orchard-guard'], seed, alwaysAsk: true }), seed, (s) => {
        if (s.window && s.prompt?.kind !== 'pounce' && s.prompt?.kind !== 'choose' && s.prompt?.kind !== 'lucky')
          throw new Error(`an open window without a Pounce prompt (${s.prompt?.kind})`);
        if (s.prompt?.kind === 'pounce') {
          windows++;
          if (legalActions(s).length === 1) { empty++; expect(legalActions(s)).toEqual([{ t: 'decline' }]); }
        }
      });
    }
    expect(windows).toBeGreaterThan(100);
    expect(empty).toBeGreaterThan(50);
  });

  it('asks about every lost Life, and a Life that isn\'t Lucky can only be kept', () => {
    let asked = 0;
    for (let seed = 1; seed <= 20; seed++) {
      playOut(createGame({ decks: ['zest-rush', 'orchard-guard'], seed, alwaysAsk: true }), seed, (s) => {
        if (s.prompt?.kind !== 'lucky') return;
        asked++;
        const card = s.players[s.prompt.player].hand.find((c) => c.uid === (s.prompt as { uid: number }).uid)!;
        expect(card).toBeDefined();
        if (!legalActions(s).some((a) => a.t === 'lucky')) expect(legalActions(s)).toEqual([{ t: 'keepLucky' }]);
      });
    }
    expect(asked).toBeGreaterThan(100);
  });

  it('is off unless asked for, so Solo plays as before', () => {
    const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 3 });
    expect(s.alwaysAsk).toBeUndefined();
  });
});
