import { describe, expect, it } from 'vitest';
import { CARDS, DECKS, deckCode, deckProblems, parseDeckCode, prototypeDecks, type DeckList } from '../lib/engine';
import { mulberry } from '../lib/rng';
import { assembleDeck, playableHeroes, randomDeck } from '../balance/decks';
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
    const first = Object.values(DECKS)[0];
    const code = deckCode({ ...first, name: 'Copy Cat' });
    expect(loadDeck(code).name).toBe('Copy Cat');
    expect(loadDecks(`starters,${code}`).map((d) => d.name)).toEqual([...Object.values(DECKS).map((d) => d.name), 'Copy Cat']);
    expect(() => loadDeck('no-such-deck')).toThrow(/No deck/);
    const broken = deckCode({ name: 'Too small', hero: first.hero, cards: { [Object.keys(first.cards)[0]]: 3 } });
    expect(() => loadDeck(broken)).toThrow(/more cards/);
  });
});

describe('assembleDeck', () => {
  it('makes a legal deck from a sloppy wish list, and says what it changed', () => {
    const [base, partner, third] = Object.values(DECKS);
    const familyCard = (d: DeckList) => Object.keys(d.cards).find((id) => CARDS[id].family === CARDS[d.hero].family && CARDS[id].type !== 'Cat')!;
    // Names instead of ids, a Hero by name, too many copies, a third family, and too few cards.
    const wish: Record<string, number> = {};
    for (const id of Object.keys(base.cards).slice(0, 10)) wish[CARDS[id].name] = 5;
    wish['No Such Card'] = 3;
    const other = familyCard(partner), extra = familyCard(third);
    wish[other] = 3; wish[CARDS[extra].name] = 1;
    const made = assembleDeck('Sloppy', CARDS[base.hero].name.split(',')[0], wish, mulberry(1))!;
    expect(deckProblems(made.deck)).toEqual([]);
    expect(made.deck.cards[extra]).toBeUndefined();
    expect(made.notes.join(' ')).toMatch(/unknown card/);
    expect(made.notes.join(' ')).toMatch(new RegExp(`${CARDS[third.hero].family} left out`));
    expect(made.chosen).toBeGreaterThan(20);
  });

  it('turns down a deck without a Hero Cat it can use', () => {
    expect(assembleDeck('x', 'Nobody', { 'SB1-G01': 3 }, mulberry(1))).toBeNull();
  });
});

describe('tokens', () => {
  it('are never put in a deck, by the rules or by the playtest card pools', () => {
    const tokens = Object.values(CARDS).filter((c) => c.token).map((c) => c.id);
    expect(tokens.length).toBeGreaterThan(0);
    for (const id of tokens) {
      expect(deckProblems({ name: 't', hero: Object.values(DECKS)[0].hero, cards: { [id]: 1 } }).join(' ')).toMatch(/can't be put in a deck/);
      for (const h of playableHeroes()) expect(randomDeck(mulberry(1), h, undefined, 'r').cards[id]).toBeUndefined();
    }
  });
});
