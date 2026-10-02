import { describe, expect, it } from 'vitest';
import {
  CARDS, DECKS, RARITIES, RULES, addProblem, apply, attackTarget, chooseAction, clockFor, createGame, builtInTwin, deckCardIds, deckChanges,
  deckProblems, evaluateCondition, keywords, legalActions, mayAct, nextSeat, other, otherFamilies, randomAction, registerSet, unitHealth, unitPower,
  type Action, type DeckList, type GameState, type PlayerId, type Unit,
} from '../src/index';

/** Play a game to its end: during the Muster the players take turns, the Lantern holder first. */
function playOut(s: GameState, pick: (s: GameState, p: PlayerId) => Action, limit = 20000): GameState {
  for (let i = 0, p = nextSeat(s); p !== null; i++, p = nextSeat(s)) {
    if (i > limit) throw new Error('game did not finish');
    apply(s, pick(s, p), p);
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
      expect(deckCardIds(key)).toHaveLength(50);
      expect(deckProblems(DECKS[key])).toEqual([]);
    }
  });

  it('parses keywords from card text', () => {
    expect(keywords('AL1-D07')).toMatchObject({ guardian: true, tough: 1 });
    expect(keywords('PR1-D12')).toMatchObject({ pounce: true });
    expect(keywords('AL1-D03').guardian).toBe(false); // "If you control a Guardian" is not the keyword
  });

  it('gives every card a rarity, and every Hero Cat is Rare or Legendary', () => {
    // Tokens are summoned, never collected, and the engine's own blank card is in no set: no rarity.
    for (const card of Object.values(CARDS).filter((c) => !c.token && c.set)) {
      expect(RARITIES).toContain(card.rarity);
      if (card.type === 'Hero Cat') expect(['Rare', 'Legendary']).toContain(card.rarity);
    }
  });
});

describe('decks made from a starter', () => {
  it('knows a copy of a starter, and what changed from it', () => {
    const starter = DECKS['domowiki'];
    const copy: DeckList = { name: 'Mine', hero: starter.hero, cards: { ...starter.cards } };
    expect(builtInTwin(copy)).toBe('domowiki');
    const [out] = Object.keys(starter.cards);
    const other = Object.keys(DECKS['pari'].cards).find((id) => !(id in starter.cards))!;
    copy.cards[out] -= 1;
    if (!copy.cards[out]) delete copy.cards[out];
    copy.cards[other] = 1;
    expect(builtInTwin(copy)).toBeNull();
    expect(deckChanges(copy, starter)).toEqual({ added: { [other]: 1 }, removed: { [out]: 1 } });
  });
});

describe('deckbuilding (rulebook 11.1)', () => {
  const withCards = (cards: Record<string, number>, hero = 'DW1-H01'): DeckList => ({ name: 'Test', hero, cards });
  const domowiki = () => withCards({ ...DECKS['domowiki'].cards });

  // The Domowiki starter has 5 Hearth Crickets (tier 1: up to 6).
  const crickets = (deck: DeckList, n: number) => { deck.cards['DW1-D16'] = n; return deck; };

  it('needs exactly 50 cards', () => {
    expect(deckProblems(crickets(domowiki(), 4))).toEqual(['Add 1 more card.']);
    expect(deckProblems(crickets(domowiki(), 6))).toEqual(['Remove 1 card.']);
  });

  it("allows one family besides the Hero Cat's", () => {
    const deck = crickets(domowiki(), 3);
    deck.cards['PR1-D01'] = 2;
    expect(deckProblems(deck)).toEqual([]);
    expect(addProblem(deck, 'AL1-D01')).toMatch(/already uses Pari/);
    deck.cards['PR1-D01'] = 1;
    deck.cards['AL1-D01'] = 1;
    expect(deckProblems(deck)[0]).toMatch(/one other family/);
  });

  it('limits copies by tier (6 of a tier 1 card), 1 of each Fabled, 6 Fabled', () => {
    const deck = crickets(domowiki(), 6);
    expect(addProblem(deck, 'DW1-D16')).toMatch(/at most 6 copies/);
    expect(addProblem(deck, 'DW1-D13')).toMatch(/one of a kind/);
    deck.cards['DW1-D13'] = 2;
    crickets(deck, 4);
    expect(deckProblems(deck)).toEqual([expect.stringMatching(/one of a kind/)]);

    const cats = withCards({ 'DW1-D13': 1, 'DW1-D14': 1, 'DW1-D15': 1, 'PR1-D18': 1, 'PR1-D19': 1, 'PR1-D20': 1 });
    expect(addProblem(cats, 'AL1-D13')).toMatch(/one other family/);
    expect(addProblem(cats, 'PR1-D18')).toMatch(/one of a kind/);
    cats.cards['PR1-D18'] = 0;
    expect(addProblem(cats, 'PR1-D18')).toBeNull();
    cats.cards['PR1-D18'] = 1;
    expect(addProblem(cats, 'DW1-D13', undefined, true)).toMatch(/one of a kind/);
    cats.cards['DW1-D13'] = 2;
    expect(deckProblems(cats)).toContainEqual(expect.stringMatching(/Too many Fabled \(7 of 6\)/));
  });

  it('checks the collection when given one', () => {
    const owned = (id: string) => (id === 'DW1-D07' ? 2 : 6);
    const deck = domowiki();
    expect(deck.cards['DW1-D07']).toBe(2);
    expect(deckProblems(deck, owned)).toEqual([]);
    expect(addProblem(deck, 'DW1-D07', owned)).toMatch(/only 2 copies/);
    deck.cards['DW1-D07'] = 3;
    crickets(deck, 4);
    expect(deckProblems(deck, owned)).toEqual([expect.stringMatching(/only 2 copies/)]);
  });

  it('keeps Hero Cats out of the deck', () => {
    expect(addProblem(withCards({}), 'PR1-H01')).toMatch(/is a Hero:/);
  });

  it("names cards it doesn't know (a retired set's) instead of failing", () => {
    const deck = crickets(domowiki(), 4);
    deck.cards['SB1-C01'] = 1;
    expect(deckProblems(deck)).toEqual(['Unknown card SB1-C01.']);
    expect(addProblem(deck, 'SB1-C01')).toBe('That card is not available.');
    expect(addProblem(withCards({}, 'SB1-H01'), 'DW1-D01')).toBe('That card is not available.');
    expect(deckProblems(withCards({ ...DECKS['domowiki'].cards }, 'SB1-H01'))).toEqual(['Choose a Hero to lead the deck.']);
  });

  it('starts a game with a deck list', () => {
    const mine = withCards({ ...DECKS['domowiki'].cards }, 'DW1-H01');
    mine.name = 'My deck';
    const s = createGame({ decks: [mine, 'pari'], seed: 3 });
    expect(s.players[0].deckName).toBe('My deck');
    expect(s.players[0].hero.id).toBe('DW1-H01');
  });
});

describe('setup', () => {
  it('gives 9 Candles, the starting Offerings and a shop dealt from the deck, then opens the Muster for both: no mulligan', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 7 });
    for (const pl of s.players) {
      expect(pl.lives).toBe(9);
      expect(pl.shop).toHaveLength(RULES.shopSize);
      expect(pl.deck).toHaveLength(50 - RULES.shopSize);
      expect(pl.offerings).toBe(RULES.startOfferings);
      expect(pl.hero.level).toBe(RULES.levelStart);
    }
    expect(s.prompt?.kind).toBe('muster');
    expect(s.muster?.open).toEqual([true, true]);
    expect(mayAct(s, 0) && mayAct(s, 1)).toBe(true);
  });

  it('rejects illegal actions, and actions from a player who is already Ready', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 7 });
    expect(() => apply(s, { t: 'sell', uid: 1 }, 0)).toThrow(/illegal/);
    apply(s, { t: 'ready' }, 0);
    expect(() => apply(s, { t: 'ready' }, 0)).toThrow(/not waiting/);
    expect(other(0)).toBe(1);
  });

  it('refuses a deck with cards of a set that is gone (the Starter Box) before the game starts', () => {
    const old: DeckList = { name: 'Zest Rush', hero: 'SB1-H01', cards: { 'SB1-C01': 3, 'SB1-C02': 3 } };
    expect(() => createGame({ decks: [old, 'pari'], seed: 1 })).toThrow(/Unknown card SB1-H01/);
    const mixed: DeckList = { name: 'Mixed', hero: 'DW1-H01', cards: { ...DECKS['domowiki'].cards, 'DW1-D01': 2, 'SB1-C01': 1 } };
    expect(() => createGame({ decks: ['pari', mixed], seed: 1 })).toThrow(/Unknown card SB1-C01/);
    expect(() => createGame({ decks: [{ ...mixed, cards: { ...mixed.cards, 'SB1-C01': 0, 'DW1-D01': 3 } }, 'pari'], seed: 1 })).not.toThrow();
  });
});

/** A game at its first Muster, player 0 holding the Lantern. */
function toMuster(decks: [string, string] = ['domowiki', 'domowiki'], seed = 1): GameState {
  return createGame({ decks, seed, firstPlayer: 0 });
}

/** A unit put straight onto a player's board (no Hello). */
function put(s: GameState, p: 0 | 1, id: string, slot: number, extra: Partial<Unit> = {}): Unit {
  const u: Unit = { uid: 7000 + p * 100 + slot, id, slot, damage: 0, exhausted: false, buffPower: 0, usedOnce: false, ...extra };
  s.players[p].yard.push(u);
  s.players[p].yard.sort((a, b) => a.slot - b.slot);
  return u;
}

/** A card put into a player's shop. */
function give(s: GameState, p: 0 | 1, id: string): number {
  const uid = 9000 + s.players[p].shop.length + p * 50;
  s.players[p].shop.push({ uid, id });
  return uid;
}

/** Both players Ready: the Clash plays. Returns what happened in it. */
function clash(s: GameState) {
  const from = s.events.length;
  for (const p of [0, 1] as const) {
    if (!mayAct(s, p)) continue;
    apply(s, { t: 'ready' }, p);
  }
  return s.events.slice(from);
}

const hits = (events: GameState['events'], uid: number) =>
  events.filter((e): e is Extract<typeof e, { t: 'hit' }> => e.t === 'hit' && e.from.kind === 'unit' && e.from.uid === uid);

describe('the economy', () => {
  it('income grows with the rounds, and saved Offerings earn interest (1 per 5, at most 3)', () => {
    const s = toMuster();
    s.players[0].offerings = 12;
    s.players[1].offerings = 0;
    clash(s);
    expect(s.round).toBe(2);
    expect(s.players[0].offerings).toBe(12 + RULES.income[0] + 2);
    expect(s.players[1].offerings).toBe(RULES.income[0]);
    s.players[0].offerings = 40;
    clash(s);
    expect(s.players[0].offerings).toBe(40 + RULES.income[1] + RULES.interestMax);
  });

  it('losing Clashes in a row earns Offerings: nothing for one, +1 for two', () => {
    const s = toMuster();
    put(s, 0, 'DW1-D18', 0);
    s.players[1].offerings = 0;
    clash(s);
    expect(s.players[1].streak).toBe(1);
    expect(s.players[0].streak).toBe(0);
    expect(s.players[1].offerings).toBe(RULES.income[0]);
    s.players[1].offerings = 0;
    clash(s);
    expect(s.players[1].streak).toBe(2);
    expect(s.players[1].offerings).toBe(RULES.income[1] + RULES.streak[2]);
  });

  it('selling a unit gives back what was paid, less 1 for each copy in it; its card goes back into the deck', () => {
    const s = toMuster();
    const me = s.players[0];
    me.offerings = 10;
    const cost = CARDS['DW1-D18'].cost!;
    const uid = give(s, 0, 'DW1-D18'); // Kłobuk
    apply(s, { t: 'play', uid, slot: 0 }, 0);
    const deck = me.deck.length;
    apply(s, { t: 'sell', uid }, 0);
    expect(me.offerings).toBe(10 - cost + cost - RULES.sellLoss);
    expect(me.yard).toHaveLength(0);
    expect(me.deck).toHaveLength(deck + 1);
    const merged = put(s, 0, 'DW1-D18', 1, { stars: 3, paid: 9 });
    apply(s, { t: 'sell', uid: merged.uid }, 0);
    expect(me.offerings).toBe(10 - RULES.sellLoss + 9 - 3 * RULES.sellLoss);
  });

  it('a roll puts the shop back into the deck and deals a new one; a free roll costs nothing', () => {
    const s = toMuster();
    const me = s.players[0];
    const cards = me.deck.length + me.shop.length;
    apply(s, { t: 'roll' }, 0);
    expect(me.offerings).toBe(RULES.startOfferings - RULES.rollCost);
    expect(me.shop).toHaveLength(RULES.shopSize);
    expect(me.deck.length + me.shop.length).toBe(cards);
    me.freeRolls = 1;
    apply(s, { t: 'roll' }, 0);
    expect(me.offerings).toBe(RULES.startOfferings - RULES.rollCost);
    expect(me.freeRolls).toBe(0);
    me.offerings = 0;
    expect(legalActions(s, 0).some((a) => a.t === 'roll')).toBe(false);
  });

  it('what is not bought goes back into the deck at the Start, so the deck never runs out', () => {
    const s = toMuster();
    for (let i = 0; i < 12; i++) clash(s);
    for (const pl of s.players) {
      expect(pl.shop).toHaveLength(RULES.shopSize);
      expect(pl.deck.length + pl.shop.length).toBe(50);
    }
  });

  it('a Level costs Offerings and opens one more lane', () => {
    const s = toMuster();
    const me = s.players[0];
    me.offerings = 2;
    expect(legalActions(s, 0).some((a) => a.t === 'levelUp')).toBe(false);
    me.offerings = 10;
    apply(s, { t: 'levelUp' }, 0);
    expect(me.hero.level).toBe(3);
    expect(me.offerings).toBe(10 - RULES.levelCost[2]);
  });

  it('a unit costs its price, and goes only into a lane the Level has opened', () => {
    const s = toMuster();
    const me = s.players[0];
    me.offerings = 20;
    put(s, 0, 'DW1-D18', 0);
    put(s, 0, 'DW1-D16', 1);
    const uid = give(s, 0, 'DW1-D07');
    expect(legalActions(s, 0).some((a) => a.t === 'play' && a.uid === uid)).toBe(false);
    apply(s, { t: 'levelUp' }, 0);
    // Level 3 opens lanes 1 to 3: the only empty one is the third.
    const plays = legalActions(s, 0).filter((a) => a.t === 'play' && a.uid === uid);
    expect(plays.map((a) => (a as { slot: number }).slot)).toEqual([2]);
    apply(s, plays[0], 0);
    expect(me.offerings).toBe(20 - RULES.levelCost[2] - CARDS['DW1-D07'].cost!);
    expect(me.yard.find((u) => u.uid === uid)).toMatchObject({ slot: 2, exhausted: false });
  });

  it('Sprout and "gain an Offering" add Offerings; Well-Fed counts what is saved', () => {
    const s = toMuster();
    const me = s.players[0];
    me.offerings = 6;
    apply(s, { t: 'play', uid: give(s, 0, 'DW1-D09') }, 0); // Bowl of Kasha: Sprout 2
    expect(me.offerings).toBe(6 - CARDS['DW1-D09'].cost! + 2);
    expect(evaluateCondition(s, 0, 'Well-Fed')).toBe(false);
    apply(s, { t: 'ability' }, 0); // Dziadziuś: gain an Offering
    expect(me.offerings).toBe(7);
    expect(evaluateCondition(s, 0, 'Well-Fed')).toBe(true);
  });

});

describe('the Muster', () => {
  it('both players act in any order until both are Ready, then the Clash plays', () => {
    const s = toMuster();
    apply(s, { t: 'roll' }, 1);
    apply(s, { t: 'roll' }, 0);
    apply(s, { t: 'ready' }, 1);
    expect(mayAct(s, 1)).toBe(false);
    expect(() => apply(s, { t: 'roll' }, 1)).toThrow(/not waiting/);
    expect(s.prompt).toEqual({ kind: 'muster', player: 0 });
    apply(s, { t: 'ready' }, 0);
    expect(s.round).toBe(2);
    expect(s.muster?.open).toEqual([true, true]);
  });

  it("each player's clock counts their own moves, and both move at every public turn", () => {
    const s = toMuster();
    const [a, b] = s.clock;
    apply(s, { t: 'roll' }, 0);
    expect(s.clock).toEqual([a + 1, b]);
    expect(clockFor(s, 1)).toBe(b);
    clash(s);
    expect(s.clock[1]).toBeGreaterThan(b + 1);
  });

  it('moves only into an open lane: Level 2 opens lanes 1 and 2, each Level one more to the right', () => {
    const s = toMuster();
    const a = put(s, 0, 'DW1-D18', 0);
    expect(legalActions(s, 0).filter((x) => x.t === 'move').map((x) => (x as { slot: number }).slot)).toEqual([1]);
    s.players[0].hero.level = 4;
    expect(legalActions(s, 0).filter((x) => x.t === 'move').map((x) => (x as { slot: number }).slot)).toEqual([1, 2, 3]);
    const warm = give(s, 0, 'DW1-D19');
    s.players[0].offerings = 10;
    expect(legalActions(s, 0).filter((x) => x.t === 'ambush' && x.uid === warm).map((x) => (x as { lane: number }).lane)).toEqual([0, 1, 2, 3]);
    expect(a.slot).toBe(0);
  });

  it('moving a unit to a lane another unit stands in swaps them', () => {
    const s = toMuster();
    s.players[0].hero.level = 6;
    const a = put(s, 0, 'DW1-D18', 0);
    const b = put(s, 0, 'DW1-D16', 3);
    apply(s, { t: 'move', uid: a.uid, slot: 3 }, 0);
    expect([a.slot, b.slot]).toEqual([3, 0]);
    expect(s.players[0].yard.map((u) => u.uid)).toEqual([b.uid, a.uid]);
  });

  it('copies of a Creature merge into the first: the third makes it 2 stars, its printed stats twice', () => {
    const s = toMuster();
    s.players[0].offerings = 10;
    const { power, health } = CARDS['DW1-D18'];
    const first = put(s, 0, 'DW1-D18', 1);
    apply(s, { t: 'play', uid: give(s, 0, 'DW1-D18') }, 0);
    expect(s.players[0].yard).toHaveLength(1);
    expect([first.copies, first.stars ?? 1]).toEqual([2, 1]);
    const uid = give(s, 0, 'DW1-D18');
    const plays = legalActions(s, 0).filter((a) => a.t === 'play' && a.uid === uid);
    expect(plays).toEqual([{ t: 'play', uid }]);
    apply(s, plays[0], 0);
    expect([first.copies, first.stars]).toEqual([3, 2]);
    expect([unitPower(first), unitHealth(first)]).toEqual([2 * power!, 2 * health!]);
    expect(s.players[0].compost.some((c) => c.uid === uid)).toBe(true);
  });

  it('a copy merges even when every lane the Level allows is taken; a new unit needs a lane sold first', () => {
    const s = toMuster();
    s.players[0].offerings = 20;
    const first = put(s, 0, 'DW1-D18', 0);
    const other = put(s, 0, 'DW1-D16', 1);
    const copy = give(s, 0, 'DW1-D18');
    const fresh = give(s, 0, 'DW1-D07');
    expect(legalActions(s, 0).some((a) => a.t === 'play' && a.uid === fresh)).toBe(false);
    apply(s, { t: 'play', uid: copy }, 0);
    expect(first.copies).toBe(2);
    apply(s, { t: 'sell', uid: other.uid }, 0);
    expect(legalActions(s, 0).some((a) => a.t === 'play' && a.uid === fresh)).toBe(true);
  });

  it('a Fabled never merges: a second copy is not even legal', () => {
    const s = toMuster();
    s.players[0].offerings = 10;
    put(s, 0, 'DW1-D13', 0);
    const uid = give(s, 0, 'DW1-D13');
    expect(legalActions(s, 0).some((a) => a.t === 'play' && a.uid === uid)).toBe(false);
  });

  it('an effect aimed at the enemy waits for the Clash and hits whoever stands in that lane then', () => {
    const s = toMuster();
    s.players[0].offerings = 10;
    const mane = give(s, 0, 'DW1-D20'); // Knotted Mane: exhaust an enemy unit
    const lanes = legalActions(s, 0).filter((a) => a.t === 'play' && a.uid === mane).map((a) => (a as { target: { lane: number } }).target.lane);
    expect(lanes).toEqual([0, 1, 2, 3, 4, 5]);
    apply(s, { t: 'play', uid: mane, target: { kind: 'lane', player: 1, lane: 2 } }, 0);
    expect(s.players[0].pending).toHaveLength(1);
    const foe = put(s, 1, 'DW1-D18', 2);
    put(s, 0, 'DW1-D18', 2);
    const events = clash(s);
    expect(hits(events, foe.uid)).toHaveLength(0); // exhausted: it dealt no damage
    expect(s.players[0].compost.some((c) => c.uid === mane)).toBe(true);
  });

  it('a harmful effect on "a unit" is aimed only at the enemy: your own units never go down in the Muster', () => {
    const s = toMuster();
    s.players[0].offerings = 10;
    put(s, 0, 'DW1-D18', 0);
    const temper = give(s, 0, 'DW1-D10'); // A Domowik's Temper: deal 5 damage to a unit
    const targets = legalActions(s, 0).filter((a) => a.t === 'play' && a.uid === temper).map((a) => (a as { target: { kind: string; player?: number } }).target);
    expect(targets).toHaveLength(6);
    expect(targets.every((t) => t.kind === 'lane' && t.player === 1)).toBe(true);
    // A helpful one still picks your own units (Warm Hand in the Night: a unit you control gains Tough 1).
    const warm = give(s, 0, 'DW1-D19');
    expect(legalActions(s, 0).some((a) => a.t === 'play' && a.uid === warm && a.target?.kind === 'unit')).toBe(true);
  });

  it('with nobody in the lane, the effect fizzles', () => {
    const s = toMuster();
    s.players[0].offerings = 10;
    const mane = give(s, 0, 'DW1-D20');
    apply(s, { t: 'play', uid: mane, target: { kind: 'lane', player: 1, lane: 4 } }, 0);
    const events = clash(s);
    expect(events.some((e) => e.t === 'fizzled' && e.cardId === 'DW1-D20')).toBe(true);
  });

  it('an Ambush waits face-down until its lane holds what it needs', () => {
    const s = toMuster();
    s.players[0].offerings = 10;
    s.players[0].hero.level = 6;
    const saucer = give(s, 0, 'DW1-D11'); // Saucer of Milk: a unit you control gets +2 Power this round
    apply(s, { t: 'ambush', uid: saucer, lane: 4 }, 0);
    expect(s.players[0].ambushes).toHaveLength(1);
    const first = clash(s);
    expect(first.some((e) => e.t === 'ambush')).toBe(false);
    expect(s.players[0].ambushes).toHaveLength(1);
    const mine = put(s, 0, 'DW1-D18', 4);
    put(s, 1, 'DW1-D04', 4);
    const second = clash(s);
    expect(second.find((e) => e.t === 'ambush')).toMatchObject({ p: 0, lane: 4, cardId: 'DW1-D11' });
    expect(hits(second, mine.uid)[0].dealt).toBe(CARDS['DW1-D18'].power! + 2);
    expect(s.players[0].ambushes).toHaveLength(0);
  });

  it('A Whistle in the Dark makes the enemy unit across from it deal no damage', () => {
    const s = toMuster(['aluxes', 'domowiki']);
    s.players[0].offerings = 10;
    apply(s, { t: 'ambush', uid: give(s, 0, 'AL1-D09'), lane: 1 }, 0);
    const foe = put(s, 1, 'DW1-D07', 1);
    put(s, 0, 'AL1-D07', 1);
    const events = clash(s);
    expect(events.some((e) => e.t === 'ambush' && e.cardId === 'AL1-D09')).toBe(true);
    expect(hits(events, foe.uid)).toHaveLength(0);
  });

});

describe('the Clash', () => {
  it('a unit hits the enemy across from it; the side left standing wins and the loser loses a Candle per survivor', () => {
    const s = toMuster();
    const mine = put(s, 0, 'DW1-D15', 0); // Bannik of the Bathhouse: Sneaky, Fierce, and nothing at Clash start
    const theirs = put(s, 1, 'DW1-D18', 0);
    const events = clash(s);
    expect(hits(events, mine.uid)[0]).toMatchObject({ uid: theirs.uid, dealt: CARDS['DW1-D15'].power });
    expect(events.find((e) => e.t === 'clashEnd')).toMatchObject({ standing: [1, 0], lost: [0, 2] }); // Fierce: 2
    expect(s.players[1].lives).toBe(7);
  });

  it('the loser loses at most the cap', () => {
    const s = toMuster();
    for (let lane = 0; lane < 4; lane++) put(s, 0, 'DW1-D18', lane);
    const events = clash(s);
    expect(events.find((e) => e.t === 'clashEnd')).toMatchObject({ lost: [0, RULES.clashCandleCap] });
  });

  it('Guardians are hit first, then plain units, then Elusive ones, Lures last', () => {
    const s = toMuster();
    const attacker = put(s, 0, 'DW1-D16', 5, { buffHealth: 50 }); // Hearth Cricket, made to last
    const lure = put(s, 1, 'DW1-D02', 5, { buffHealth: 50 });
    const elusive = put(s, 1, 'DW1-D07', 4, { buffHealth: 50 });
    const plain = put(s, 1, 'DW1-D18', 3, { buffHealth: 50 });
    const guardian = put(s, 1, 'DW1-D04', 0, { buffHealth: 50 });
    const order = () => attackTarget(s, 0, attacker)?.uid;
    expect(order()).toBe(guardian.uid);
    s.players[1].yard = s.players[1].yard.filter((u) => u !== guardian);
    expect(order()).toBe(plain.uid);
    s.players[1].yard = s.players[1].yard.filter((u) => u !== plain);
    expect(order()).toBe(elusive.uid);
    s.players[1].yard = s.players[1].yard.filter((u) => u !== elusive);
    expect(order()).toBe(lure.uid);
  });

  it('Sneaky units go the other way: Lures first, Guardians last', () => {
    const s = toMuster();
    const bannik = put(s, 0, 'DW1-D15', 0);
    put(s, 1, 'DW1-D04', 0);
    put(s, 1, 'DW1-D18', 1);
    const elusive = put(s, 1, 'DW1-D07', 2);
    const lure = put(s, 1, 'DW1-D02', 3);
    expect(attackTarget(s, 0, bannik)?.uid).toBe(lure.uid);
    s.players[1].yard = s.players[1].yard.filter((u) => u !== lure);
    expect(attackTarget(s, 0, bannik)?.uid).toBe(elusive.uid);
  });

  it('among equals: the unit across first, then the nearest, then the leftmost', () => {
    const s = toMuster();
    const attacker = put(s, 0, 'DW1-D16', 3);
    const left = put(s, 1, 'DW1-D18', 1);
    const right = put(s, 1, 'DW1-D18', 5);
    expect(attackTarget(s, 0, attacker)?.uid).toBe(left.uid); // both two lanes away: the leftmost
    const across = put(s, 1, 'DW1-D18', 3);
    expect(attackTarget(s, 0, attacker)?.uid).toBe(across.uid);
    s.players[1].yard = [left, right].map((u) => ({ ...u, slot: u === left ? 0 : 4 }));
    expect(attackTarget(s, 0, attacker)?.uid).toBe(right.uid + 0); // lane 5 (index 4) is nearer than lane 1
  });

  it('Swift units strike first: a unit that goes down to them hits nothing', () => {
    const s = toMuster();
    const swift = put(s, 0, 'DW1-D03', 0); // Mane-Braiding Domowik 2/2, Swift
    const slow = put(s, 1, 'DW1-D16', 0); // Hearth Cricket 2/1
    const events = clash(s);
    expect(hits(events, swift.uid)).toHaveLength(1);
    expect(hits(events, slow.uid)).toHaveLength(0);
    expect(events.find((e) => e.t === 'clashEnd')).toMatchObject({ standing: [1, 0] });
  });

  it('Tough reduces each hit, and both sides hit at the same time', () => {
    const s = toMuster(['aluxes', 'domowiki']);
    const stones = put(s, 0, 'AL1-D07', 0); // Guardian, Tough 1
    const cricket = put(s, 1, 'DW1-D16', 0);
    const events = clash(s);
    expect(hits(events, cricket.uid)[0]).toMatchObject({ uid: stones.uid, dealt: CARDS['DW1-D16'].power! - 1 });
    expect(hits(events, stones.uid)[0]).toMatchObject({ uid: cricket.uid, dealt: CARDS['AL1-D07'].power });
  });

  it('after the Clash every unit stands up again, with no damage; tokens are gone', () => {
    const s = toMuster(['pari', 'domowiki']);
    const dove = put(s, 0, 'PR1-D01', 0); // Feather Coat: when it goes down, a Dove token
    put(s, 1, 'DW1-D08', 0);
    const events = clash(s);
    expect(events.some((e) => e.t === 'down' && e.uid === dove.uid)).toBe(true);
    expect(events.some((e) => e.t === 'summon' && e.cardId === 'PR1-K01')).toBe(true);
    expect(s.players[0].yard.map((u) => [u.id, u.damage])).toEqual([['PR1-D01', 0]]);
    expect(s.players[1].yard.map((u) => u.damage)).toEqual([0]);
    expect(s.players[0].downed).toBe(1); // the Dove, a token, doesn't count
  });

  it('both sides still standing at the bout cap lose Candles for the other\'s units', () => {
    const s = toMuster();
    put(s, 0, 'DW1-D04', 0, { buffHealth: 100 });
    put(s, 1, 'DW1-D04', 0, { buffHealth: 100 });
    const events = clash(s);
    expect(events.filter((e) => e.t === 'bout')).toHaveLength(RULES.boutCap);
    expect(events.find((e) => e.t === 'clashEnd')).toMatchObject({ standing: [1, 1], lost: [1, 1] });
  });

  it('an Awakened Hero that was not exhausted strikes first, and counts as a survivor', () => {
    const s = toMuster();
    const me = s.players[0];
    me.hero.grown = true; // Dziadziuś, Awakened: Power 4, Fierce
    put(s, 0, 'DW1-D18', 0);
    const foe = put(s, 1, 'DW1-D16', 3);
    const events = clash(s);
    expect(events.find((e) => e.t === 'hit')).toMatchObject({ from: { kind: 'hero', player: 0 }, uid: foe.uid });
    expect(events.find((e) => e.t === 'clashEnd')).toMatchObject({ lost: [0, RULES.clashCandleCap] });
  });

  it('Ovinnik gets +2 Power while you are Well-Fed', () => {
    const s = toMuster();
    const ovinnik = put(s, 0, 'DW1-D05', 0);
    put(s, 1, 'DW1-D04', 0);
    s.players[0].offerings = 0;
    expect(hits(clash(s), ovinnik.uid)[0].dealt).toBe(CARDS['DW1-D05'].power);
    s.players[0].offerings = 7;
    expect(hits(clash(s), ovinnik.uid)[0].dealt).toBe(CARDS['DW1-D05'].power! + 2);
  });

  it('Rain-Fed units grow +1/+1 each round, up to +3/+3, and keep it', () => {
    const s = toMuster(['aluxes', 'domowiki']);
    const clay = put(s, 0, 'AL1-D04', 0);
    const rain: number[] = [];
    for (let i = 0; i < 4; i++) { clash(s); rain.push(clay.counters?.rain ?? 0); }
    expect(rain).toEqual([1, 2, 3, 3]);
    expect([unitPower(clay), unitHealth(clay)]).toEqual([CARDS['AL1-D04'].power! + 3, CARDS['AL1-D04'].health! + 3]);
  });

  it('Company: at Clash start Súči of the Hunt deals 1 to the enemy across, 3 when you control 3 units', () => {
    for (const [company, dealt] of [[false, 1], [true, 3]] as const) {
      const s = toMuster(['pari', 'domowiki'], 3);
      if (company) { put(s, 0, 'PR1-D09', 0); put(s, 0, 'PR1-D09', 1); }
      const foe = put(s, 1, 'DW1-D04', 4);
      put(s, 0, 'PR1-D06', 4);
      const events = clash(s);
      expect(events.find((e) => e.t === 'damage')).toMatchObject({ uid: foe.uid, amount: dealt });
    }
  });
});

describe('events', () => {
  it('a Clash reports its start, its bouts and hits, who went down, and how it ended', () => {
    const s = toMuster();
    put(s, 0, 'DW1-D18', 0);
    put(s, 1, 'DW1-D16', 0);
    const kinds = clash(s).map((e) => e.t);
    expect(kinds.slice(0, 2)).toEqual(['readyUp', 'readyUp']);
    expect(kinds.indexOf('clash')).toBeLessThan(kinds.indexOf('bout'));
    expect(kinds.indexOf('hit')).toBeLessThan(kinds.indexOf('down'));
    expect(kinds.indexOf('down')).toBeLessThan(kinds.indexOf('clashEnd'));
    expect(kinds.indexOf('clashEnd')).toBeLessThan(kinds.indexOf('lifeLost'));
  });

  it('a Clash shows the board at its start, at each bout and at its end, and says where each effect came from', () => {
    const s = toMuster(['pari', 'domowiki']);
    const dvorovoi = put(s, 1, 'DW1-D08', 0);   // Clash start: 2 damage to the enemy across and the ones next to it
    const swift = put(s, 1, 'DW1-D03', 1);      // Swift
    const dove = put(s, 0, 'PR1-D01', 0);       // Goodbye: a Dove
    const events = clash(s);
    const at = (t: string) => events.findIndex((e) => e.t === t);
    const boards = events.filter((e): e is Extract<typeof e, { t: 'board' }> => e.t === 'board');
    expect(events[at('clash') + 1].t).toBe('board');
    expect(events[at('bout') + 1].t).toBe('board');
    expect(events[at('clashEnd') - 1].t).toBe('board');
    expect(boards).toHaveLength(events.filter((e) => e.t === 'bout').length + 2);
    expect(boards[0].units.find((u) => u.uid === dvorovoi.uid)).toMatchObject({ p: 1, slot: 0, id: 'DW1-D08', damage: 0, power: unitPower(dvorovoi, s) });
    expect(boards.at(-1)!.units.find((u) => u.uid === dove.uid)).toMatchObject({ down: true });
    expect(events.find((e) => e.t === 'damage' && e.uid === dove.uid)).toMatchObject({ src: { p: 1, id: 'DW1-D08', uid: dvorovoi.uid } });
    expect(events.filter((e) => e.t === 'hit' && e.from.kind === 'unit' && e.from.uid === swift.uid).every((e) => e.t === 'hit' && e.swift)).toBe(true);
    // The fallen Pari still holds its lane until the Clash ends: the Dove comes down in the next one.
    expect(events.find((e) => e.t === 'summon')).toMatchObject({ cardId: 'PR1-K01', slot: 1, src: { p: 0, id: 'PR1-D01', uid: dove.uid } });
    expect(s.effect).toBeUndefined();
  });

  it('what a player does in the Muster is secret to them until the Clash', () => {
    const s = toMuster();
    apply(s, { t: 'roll' }, 0);
    expect(s.events.at(-1)).toMatchObject({ t: 'roll', secret: 0 });
    expect(s.log.at(-1)).toMatchObject({ secret: 0 });
    const events = clash(s);
    expect(events.filter((e) => e.t === 'clash' || e.t === 'clashEnd').every((e) => e.secret === undefined)).toBe(true);
  });

  it('a whole game keeps one event stream that ends with the winner', () => {
    const s = playOut(createGame({ decks: ['domowiki', 'aluxes'], seed: 11 }), (g, p) => randomAction(g, rng(11), p));
    expect(s.events.some((e) => e.t === 'round')).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ t: 'win' });
  });
});

describe('round limit (rulebook 300.7)', () => {
  it('more Candles wins; with the same Candles, more Health on the board; otherwise a draw', () => {
    const at = (candles: [number, number], boards: [number, number]) => {
      const s = toMuster();
      s.round = RULES.maxRounds;
      s.players.forEach((pl, p) => { pl.lives = candles[p]; });
      for (const p of [0, 1] as const) if (boards[p]) put(s, p, 'DW1-D04', p === 0 ? 0 : 5, { buffHealth: 0, exhausted: true });
      clash(s);
      return s;
    };
    expect(at([4, 5], [0, 0]).winner).toBe(1);
    expect(at([5, 5], [0, 0]).winner).toBe('draw');
  });
});

describe('full games', () => {
  it('random agents always finish a game, for every deck pairing', () => {
    const keys = Object.keys(DECKS);
    let seed = 1;
    for (const a of keys) for (const b of keys) {
      for (let i = 0; i < 6; i++, seed++) {
        const r = rng(seed);
        const s = playOut(createGame({ decks: [a, b], seed }), (g, p) => randomAction(g, r, p));
        expect(s.winner).not.toBeNull();
      }
    }
  }, 120_000);

  it('AI agents finish, and the same seeds replay identically', () => {
    const run = () => {
      const r = rng(99);
      return playOut(createGame({ decks: ['pari', 'domowiki'], seed: 5 }), (g, p) => chooseAction(g, { random: r, seat: p }));
    };
    const a = run();
    const b = run();
    expect(a.winner).not.toBeNull();
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  }, 60_000);

  it('a game replays from its seed and its (seat, action) list', () => {
    const r = rng(7);
    const played: [0 | 1, Action][] = [];
    const s = playOut(createGame({ decks: ['jiaoren', 'hui-hai'], seed: 8 }), (g, p) => {
      const a = chooseAction(g, { random: r, seat: p });
      played.push([p, a]);
      return a;
    });
    const again = createGame({ decks: ['jiaoren', 'hui-hai'], seed: 8 });
    for (const [p, a] of played) apply(again, a, p);
    expect(JSON.stringify(again)).toBe(JSON.stringify(s));
  }, 60_000);

  it('the AI beats a random player', () => {
    let aiWins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed);
      const s = playOut(createGame({ decks: ['domowiki', 'pari'], seed }), (g, p) =>
        p === 0 ? chooseAction(g, { random: r, seat: p }) : randomAction(g, r, p));
      if (s.winner === 0) aiWins++;
    }
    expect(aiWins).toBeGreaterThanOrEqual(16);
  }, 60_000);

  it('after every Muster move the engine has nothing left to do: no move ever waits on another', () => {
    const r = rng(3);
    const s = createGame({ decks: ['pari', 'hui-hai'], seed: 3 });
    for (let p = nextSeat(s); p !== null; p = nextSeat(s)) {
      const mustering = s.prompt!.kind === 'muster';
      if (mustering) expect(legalActions(s, p).length).toBeGreaterThan(0);
      apply(s, randomAction(s, r, p), p);
      if (mustering && s.winner === null) expect(s.queue).toEqual([]);
    }
  });
});

// Last, since it adds a set to the catalog the tests above share.
describe('neutral families', () => {
  it('go in any deck, and are not its one other family', () => {
    registerSet({
      set: 'TST', name: 'Test', families: { Hedge: { neutral: true } },
      cards: [{ id: 'TST-N01', type: 'Critter', rarity: 'Common', family: 'Hedge', name: 'Hedge Sprite', cost: 1, power: 1, health: 1, text: '' }],
    });
    const deck: DeckList = { name: 'Test', hero: 'DW1-H01', cards: { ...DECKS['domowiki'].cards } };
    deck.cards['DW1-D16'] -= 2;
    deck.cards['PR1-D01'] = 1;
    deck.cards['TST-N01'] = 1;
    expect(deckProblems(deck)).toEqual([]);
    expect(otherFamilies(deck)).toEqual(['Pari']);
    expect(addProblem(deck, 'TST-N01', undefined, true)).toBeNull();
    expect(addProblem(deck, 'AL1-D01', undefined, true)).toMatch(/already uses Pari/);
  });
});
