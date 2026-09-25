import { describe, expect, it } from 'vitest';
import { DECKS, deckCode, deckProblems, parseDeckCode, prototypeDecks, type DeckList } from '../lib/engine';
import { mulberry } from '../lib/rng';
import { fitToSize, playableHeroes, randomDeck } from '../balance/decks';
import { brokenLibraryDecks, loadDeck, loadDecks } from '../decks/library';

const sorted = (d: DeckList) => ({ ...d, cards: Object.fromEntries(Object.entries(d.cards).sort(([a], [b]) => a.localeCompare(b))) });

describe('deck codes', () => {
  it('every starter, prototype and random deck survives a round trip', () => {
    const rng = mulberry(7);
    const decks = [...Object.values(DECKS), ...Object.values(prototypeDecks()), ...playableHeroes().map((h, i) => randomDeck(rng, h, undefined, `random ${i}`))];
    for (const d of decks) {
      const code = deckCode(d);
      // What PC2024's playtester accepts in a run's arguments, and no commas: lists of decks use them.
      expect(code).toMatch(/^[A-Za-z0-9.-]+$/);
      expect(sorted(parseDeckCode(code)!)).toEqual(sorted({ name: d.name, hero: d.hero, cards: d.cards }));
    }
  });

  it('is not fooled by text that is not a code', () => {
    expect(parseDeckCode('zest-rush')).toBeNull();
    expect(parseDeckCode('FC2.x.SB1-H01.SB1-C01x3')).toBeNull();
    expect(parseDeckCode('FC1.Name with spaces.SB1-H01')).toBeNull();
  });
});

describe('deck library', () => {
  it('every library deck still follows the deckbuilding rules', () => {
    expect(brokenLibraryDecks()).toEqual([]);
  });

  it('a deck can be named by key, code, or as a list', () => {
    const code = deckCode({ ...DECKS['zest-rush'], name: 'Copy Cat' });
    expect(loadDeck(code).name).toBe('Copy Cat');
    expect(loadDecks(`starters,${code}`).map((d) => d.name)).toEqual([...Object.values(DECKS).map((d) => d.name), 'Copy Cat']);
    expect(() => loadDeck('no-such-deck')).toThrow(/No deck/);
    const broken = deckCode({ name: 'Too small', hero: DECKS['zest-rush'].hero, cards: { 'SB1-C01': 3 } });
    expect(() => loadDeck(broken)).toThrow(/more cards/);
  });
});

describe('fitToSize', () => {
  it('brings a deck that is only the wrong size to exactly 50, and leaves other problems alone', () => {
    const base = DECKS['orchard-guard'];
    const short: DeckList = { ...base, cards: { ...base.cards } };
    for (const id of Object.keys(short.cards).slice(0, 4)) delete short.cards[id];
    const long: DeckList = { ...base, cards: { ...base.cards, 'SB1-G05': 3, 'SB1-G01': 3 } };
    const tooMany: DeckList = { ...long, cards: { ...long.cards, 'SB1-G02': 9 } };
    for (const d of [short, long]) {
      const fitted = fitToSize(d, mulberry(1));
      expect(fitted).not.toBeNull();
      expect(deckProblems(fitted!.deck)).toEqual([]);
    }
    expect(fitToSize(tooMany, mulberry(1))).toBeNull();
  });
});
