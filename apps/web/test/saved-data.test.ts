// What a player kept from before a set was taken out of the game (the Starter Box, 2026-09-29): decks and a game in
// progress with its cards. They must load without failing: what can't be played is left out.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DECKS, RULES_VERSION, createGame } from '@fruitcats/engine';

let saved: Map<string, string>;

beforeEach(() => {
  saved = new Map();
  vi.stubGlobal('location', { port: '5173', origin: 'http://localhost:5173', search: '', href: 'http://localhost:5173/' });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v), removeItem: (k: string) => void saved.delete(k),
  });
});

describe('saved decks with cards of a set that is gone', () => {
  it('leaves out a deck led by a gone Hero Cat, and gone cards from the others', async () => {
    const domowiki = DECKS['domowiki'].cards;
    saved.set('fruitcats-decks', JSON.stringify([
      { id: 'old', name: 'My Zest Rush', hero: 'SB1-H01', cards: { 'SB1-C01': 3, 'SB1-C02': 3 } },
      {
        id: 'mixed', name: 'Mixed', hero: 'DW1-H01', cards: { ...domowiki, 'DW1-D01': 1, 'SB1-C01': 2 },
        from: { name: 'Zest Rush', key: 'zest-rush', cards: { 'SB1-C01': 3, 'DW1-D01': 3 } },
      },
    ]));
    const { listDecks, getDeck, problems } = await import('../src/mydecks');
    const decks = listDecks();
    expect(decks.map((d) => d.id)).toEqual(['mixed']);
    const mixed = getDeck('mixed')!;
    expect(mixed.cards['SB1-C01']).toBeUndefined();
    expect(mixed.cards['DW1-D01']).toBe(1);
    expect(mixed.from!.cards).toEqual({ 'DW1-D01': 3 });
    expect(problems(mixed)).toEqual(['Add 2 more cards.']);
  });

  it('falls back to a ready-made deck when the chosen one was a gone set\'s', async () => {
    saved.set('fruitcats-deck', 'zest-rush');
    const { loadChosenDeck } = await import('../src/mydecks');
    expect(DECKS[loadChosenDeck()]).toBeDefined();
  });
});

describe('a saved game with cards of a set that is gone', () => {
  it('is quietly let go', async () => {
    const game = createGame({ decks: ['domowiki', 'pari'], seed: 1 });
    game.players[1].hand[0].id = 'SB1-C01';
    saved.set('fruitcats-game', JSON.stringify({ rules: RULES_VERSION, game, difficulty: 'normal', unitArrivals: [], foeFrom: 0, foeUnitsBefore: [] }));
    const { loadGame } = await import('../src/save');
    expect(loadGame()).toBeNull();
    expect(saved.has('fruitcats-game')).toBe(false);
  });
});
