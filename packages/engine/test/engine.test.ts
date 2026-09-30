import { describe, expect, it } from 'vitest';
import {
  CARDS, DECKS, RARITIES, addProblem, apply, chooseAction, createGame, builtInTwin, deckCardIds, deckChanges, deckProblems, legalActions, randomAction,
  keywords, otherFamilies, registerSet, unitHealth, unitPower, type DeckList, type GameState,
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
      expect(deckCardIds(key)).toHaveLength(50);
      expect(deckProblems(DECKS[key])).toEqual([]);
    }
  });

  it('parses keywords from card text', () => {
    expect(keywords('AL1-D07')).toMatchObject({ guardian: true, tough: 1 });
    expect(keywords('PR1-D12')).toMatchObject({ pounce: true, lucky: true });
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

  it('needs exactly 50 cards', () => {
    const deck = domowiki();
    deck.cards['DW1-D08'] = 1;
    expect(deckProblems(deck)).toEqual(['Add 1 more card.']);
    deck.cards['DW1-D08'] = 3;
    expect(deckProblems(deck)).toEqual(['Remove 1 card.']);
  });

  it("allows one family besides the Hero Cat's", () => {
    const deck = domowiki();
    deck.cards['DW1-D01'] = 1;
    deck.cards['PR1-D01'] = 2;
    expect(deckProblems(deck)).toEqual([]);
    expect(addProblem(deck, 'AL1-D01')).toMatch(/already uses Pari/);
    deck.cards['PR1-D01'] = 1;
    deck.cards['AL1-D01'] = 1;
    expect(deckProblems(deck)[0]).toMatch(/one other family/);
  });

  it('limits copies: 3 of a card, 1 of each Cat, 6 Cats', () => {
    const deck = domowiki();
    expect(addProblem(deck, 'DW1-D01')).toMatch(/at most 3 copies/);
    expect(addProblem(deck, 'DW1-D13')).toMatch(/one of a kind/);
    deck.cards['DW1-D13'] = 2;
    deck.cards['DW1-D01'] = 2;
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
    const owned = (id: string) => (id === 'DW1-D08' ? 2 : 3);
    const deck = domowiki();
    expect(deckProblems(deck, owned)).toEqual([]);
    expect(addProblem(deck, 'DW1-D08', owned)).toMatch(/only 2 copies/);
    deck.cards['DW1-D08'] = 3;
    deck.cards['DW1-D01'] = 2;
    expect(deckProblems(deck, owned)).toEqual([expect.stringMatching(/only 2 copies/)]);
  });

  it('keeps Hero Cats out of the deck', () => {
    expect(addProblem(withCards({}), 'PR1-H01')).toMatch(/is a Hero:/);
  });

  it("names cards it doesn't know (a retired set's) instead of failing", () => {
    const deck = domowiki();
    deck.cards['DW1-D01'] = 2;
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
  it('lets a mulligan swap at most 3 cards, for players and the computer alike', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 7 });
    const hand = s.players[s.prompt!.player].hand.map((c) => c.uid);
    expect(() => apply(structuredClone(s), { t: 'mulligan', uids: hand })).toThrow(/at most 3/);
    expect(() => apply(structuredClone(s), { t: 'mulligan', uids: hand.slice(0, 4) })).toThrow(/at most 3/);
    apply(s, { t: 'mulligan', uids: hand.slice(0, 3) });
    expect(s.prompt?.kind).toBe('mulligan');
    for (let seed = 1; seed <= 200; seed++) {
      const g = createGame({ decks: ['domowiki', 'pari'], seed });
      const a = chooseAction(g);
      expect(a.t === 'mulligan' && a.uids.length).toBeLessThanOrEqual(3);
    }
  });

  it('deals 9 Lives, 6 cards, then plants 2', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 7 });
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
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 7 });
    expect(() => apply(s, { t: 'pass' })).toThrow();
  });

  it('refuses a deck with cards of a set that is gone (the Starter Box) before the game starts', () => {
    const old: DeckList = { name: 'Zest Rush', hero: 'SB1-H01', cards: { 'SB1-C01': 3, 'SB1-C02': 3 } };
    expect(() => createGame({ decks: [old, 'pari'], seed: 1 })).toThrow(/Unknown card SB1-H01/);
    const mixed: DeckList = { name: 'Mixed', hero: 'DW1-H01', cards: { ...DECKS['domowiki'].cards, 'DW1-D01': 2, 'SB1-C01': 1 } };
    expect(() => createGame({ decks: ['pari', mixed], seed: 1 })).toThrow(/Unknown card SB1-C01/);
    expect(() => createGame({ decks: [{ ...mixed, cards: { ...mixed.cards, 'SB1-C01': 0, 'DW1-D01': 3 } }, 'pari'], seed: 1 })).not.toThrow();
  });
});

/** Play until it's player 0's action phase, then return the state (setup handled by the AI). */
function toFirstAction(decks: [string, string], seed = 1): GameState {
  const s = createGame({ decks, seed, firstPlayer: 0 });
  while (!(s.prompt?.kind === 'action' && s.prompt.player === 0)) apply(s, chooseAction(s));
  return s;
}

describe('Domowiki: Offerings', () => {
  it('Dziadziuś readies an Offering, and Awakens at 8 Offerings', () => {
    const s = toFirstAction(['domowiki', 'pari']);
    const me = s.players[0];
    expect(me.hero.id).toBe('DW1-H01');
    me.pantry.forEach((t) => (t.exhausted = true));
    apply(s, { t: 'ability' });
    expect(me.pantry.filter((t) => !t.exhausted)).toHaveLength(1);
    // Awaken is checked after every step: give him 8 Offerings and let the opponent act.
    while (me.pantry.length < 8) me.pantry.push({ card: me.deck.shift()!, exhausted: true });
    apply(s, legalActions(s).find((a) => a.t === 'pass' || a.t === 'decline')!);
    expect(me.hero.grown).toBe(true);
  });

  it('Bowl of Kasha (Sprout 2) puts two cards from the deck into the Offerings, exhausted', () => {
    const s = toFirstAction(['domowiki', 'pari']);
    const me = s.players[0];
    me.hand.push({ uid: 9001, id: 'DW1-D09' });
    while (me.pantry.length < 3) me.pantry.push({ card: me.deck.shift()!, exhausted: false });
    me.pantry.forEach((t) => (t.exhausted = false));
    const before = { pantry: me.pantry.length, deck: me.deck.length };
    apply(s, { t: 'play', uid: 9001 });
    while (s.prompt?.player === 1 && s.prompt.kind === 'pounce') apply(s, { t: 'decline' });
    expect(me.pantry.length).toBe(before.pantry + 2);
    expect(me.deck.length).toBe(before.deck - 2);
    expect(me.pantry.slice(-2).every((t) => t.exhausted)).toBe(true);
  });

  it('Ovinnik can only attack while Well-Fed (7+ Offerings)', () => {
    const s = toFirstAction(['domowiki', 'pari']);
    const me = s.players[0];
    me.yard.push({ uid: 9002, id: 'DW1-D05', damage: 0, exhausted: false, buffPower: 0, usedOnce: false });
    const ovinnikAttacks = () => legalActions(s).filter((a) => a.t === 'attack' && a.attacker.kind === 'unit' && a.attacker.uid === 9002);
    expect(ovinnikAttacks()).toHaveLength(0);
    while (me.pantry.length < 6) me.pantry.push({ card: me.deck.shift()!, exhausted: true });
    expect(ovinnikAttacks()).toHaveLength(0);
    me.pantry.push({ card: me.deck.shift()!, exhausted: true });
    expect(ovinnikAttacks().length).toBeGreaterThan(0);
  });
});

/** Put a card in player 0's hand with enough ready Offerings to play it, and play it (declining any Ambush). */
function playFromHand(s: GameState, id: string, target?: { kind: 'unit'; uid: number }) {
  const me = s.players[0];
  const uid = 9000 + s.actions;
  me.hand.push({ uid, id });
  while (me.pantry.filter((t) => !t.exhausted).length < (CARDS[id].cost ?? 0)) me.pantry.push({ card: me.deck.shift()!, exhausted: false });
  apply(s, target ? { t: 'play', uid, target } : { t: 'play', uid });
  while (s.prompt?.player === 1 && s.prompt.kind === 'pounce') apply(s, { t: 'decline' });
  return uid;
}

function enemyUnit(s: GameState, id: string, health = 10) {
  const uid = 8000 + s.players[1].yard.length;
  s.players[1].yard.push({ uid, id, damage: 10 - health, exhausted: false, buffPower: 0, usedOnce: false });
  return { kind: 'unit' as const, uid };
}

/** A unit of player 0's, put straight into play (no Hello): Kłobuk, a plain 2/3 once it's there. */
function myUnit(s: GameState, uid: number, id = 'DW1-D18') {
  s.players[0].yard.push({ uid, id, damage: 0, exhausted: false, buffPower: 0, usedOnce: false });
}

describe('signature mechanics', () => {
  it('Company: Súči of the Hunt deals 1 on its own, 2 when you control 3 units', () => {
    const alone = toFirstAction(['pari', 'domowiki'], 3);
    const t1 = enemyUnit(alone, 'DW1-D18'); // Kłobuk: no Tough, so damage lands in full
    playFromHand(alone, 'PR1-D06', t1);
    expect(alone.players[1].yard.find((u) => u.uid === t1.uid)!.damage).toBe(1);

    const company = toFirstAction(['pari', 'domowiki'], 3);
    myUnit(company, 7101);
    myUnit(company, 7102);
    const t2 = enemyUnit(company, 'DW1-D18');
    playFromHand(company, 'PR1-D06', t2);
    expect(company.players[1].yard.find((u) => u.uid === t2.uid)!.damage).toBe(2);
  });

  it('Company: Pari at the Pool enters ready only with Company', () => {
    const a = toFirstAction(['pari', 'domowiki'], 4);
    const u1 = playFromHand(a, 'PR1-D04');
    expect(a.players[0].yard.find((u) => u.uid === u1)!.exhausted).toBe(true);
    const b = toFirstAction(['pari', 'domowiki'], 4);
    myUnit(b, 7201);
    myUnit(b, 7202);
    const u2 = playFromHand(b, 'PR1-D04');
    expect(b.players[0].yard.find((u) => u.uid === u2)!.exhausted).toBe(false);
  });

  it("Orange-Peri (3/1) hurts itself unless you've played 2 other cards this round", () => {
    const first = toFirstAction(['pari', 'domowiki'], 5);
    const u1 = playFromHand(first, 'PR1-D02');
    expect(first.players[0].yard.find((u) => u.uid === u1)).toBeUndefined();
    expect(first.players[0].compost.some((c) => c.uid === u1)).toBe(true);
    const third = toFirstAction(['pari', 'domowiki'], 5);
    third.players[0].playedThisRound = 2; // already played two cards this round
    const u2 = playFromHand(third, 'PR1-D02');
    expect(third.players[0].yard.find((u) => u.uid === u2)!.damage).toBe(0);
  });

  it('counts the cards played afresh each round', () => {
    const s = toFirstAction(['pari', 'domowiki'], 5);
    s.players[0].playedThisRound = 3;
    const round = s.round;
    for (let i = 0; i < 200 && s.round === round; i++) apply(s, chooseAction(s));
    expect(s.players[0].playedThisRound).toBe(0);
  });

  it('Rain-Fed: Clay Alux grows +1/+1 each round, up to +2/+2', () => {
    const s = toFirstAction(['aluxes', 'domowiki'], 6);
    s.players[0].yard.push({ uid: 7777, id: 'AL1-D04', damage: 0, exhausted: false, buffPower: 0, usedOnce: false });
    const alux = () => s.players[0].yard.find((u) => u.uid === 7777)!;
    const rainAtRound: number[] = [];
    // Both players only pass, so nothing can touch the Alux; other prompts (plant, discard) are the AI's.
    while (s.round < 5) {
      const r = s.round;
      apply(s, s.prompt!.kind === 'action' ? { t: 'pass' } : chooseAction(s));
      if (s.round !== r) rainAtRound.push(alux().counters?.rain ?? 0);
    }
    expect(rainAtRound).toEqual([1, 2, 2, 2]);
    expect(unitPower(alux())).toBe(2 + 2);
    expect(unitHealth(alux())).toBe(3 + 2);
  });

  it('Sprout counts as Offerings and turns Well-Fed on at 7', () => {
    const s = toFirstAction(['domowiki', 'pari']);
    const me = s.players[0];
    while (me.pantry.length < 5) me.pantry.push({ card: me.deck.shift()!, exhausted: false });
    playFromHand(s, 'DW1-D09'); // Bowl of Kasha: Sprout 2
    expect(me.pantry.length).toBeGreaterThanOrEqual(7);
  });
});

describe('events', () => {
  const attack = (s: GameState, uid: number, target: { kind: 'unit'; uid: number } | { kind: 'hero'; player: 1 }) => {
    const from = s.events.length;
    apply(s, { t: 'attack', attacker: { kind: 'unit', uid }, target });
    while (s.prompt?.player === 1 && s.prompt.kind === 'pounce') apply(s, { t: 'decline' });
    return s.events.slice(from);
  };

  it('an attack that trades reports the attack, the clash, then the defeat', () => {
    const s = toFirstAction(['domowiki', 'pari'], 7);
    myUnit(s, 7001);
    const foe = enemyUnit(s, 'DW1-D18');
    s.players[1].yard.at(-1)!.damage = 1; // Kłobuk 2/3 with 1 damage: the attacking Kłobuk's 2 finishes it
    const events = attack(s, 7001, foe);
    expect(events.map((e) => e.t).slice(0, 3)).toEqual(['attack', 'clash', 'defeated']);
    expect(events[1]).toMatchObject({ target: foe.uid, dealt: 2, taken: 2 });
    expect(events[2]).toMatchObject({ uid: foe.uid, owner: 1 });
  });

  it('a hit on the Hero Cat reports the hit, then the lost Life', () => {
    const s = toFirstAction(['domowiki', 'pari'], 8);
    myUnit(s, 7002);
    const events = attack(s, 7002, { kind: 'hero', player: 1 });
    expect(events.map((e) => e.t).slice(0, 3)).toEqual(['attack', 'heroHit', 'lifeLost']);
    expect(events[2]).toMatchObject({ p: 1, left: 8 });
  });

  it('a Hello that deals damage reports the play, then the damage', () => {
    const s = toFirstAction(['pari', 'domowiki'], 3);
    const t = enemyUnit(s, 'DW1-D18');
    const from = s.events.length;
    playFromHand(s, 'PR1-D06', t); // Súči of the Hunt: Hello, deal 1
    const events = s.events.slice(from);
    expect(events[0]).toMatchObject({ t: 'play', p: 0, cardId: 'PR1-D06', target: t });
    expect(events.find((e) => e.t === 'damage')).toMatchObject({ uid: t.uid, amount: 1, p: 0 });
  });

  it('a whole game keeps one event stream that ends with the winner', () => {
    const s = playOut(createGame({ decks: ['domowiki', 'aluxes'], seed: 11 }), (g) => randomAction(g, rng(11)));
    expect(s.events.some((e) => e.t === 'round')).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ t: 'win' });
  });
});

describe('round limit (rulebook 300.7)', () => {
  /** Both players at round 40 with 5 Candles each and one Kłobuk (2/3) apiece, damaged as given; then both pass. */
  const endAfterRound40 = (myDamage: number, theirDamage: number) => {
    const s = toFirstAction(['domowiki', 'pari'], 9);
    s.round = 40;
    for (const pl of s.players) { pl.lives = pl.lives.slice(0, 5); pl.yard = []; }
    myUnit(s, 7301);
    enemyUnit(s, 'DW1-D18', 3);
    s.players[0].yard[0].damage = myDamage;
    s.players[1].yard[0].damage = theirDamage;
    for (let i = 0; i < 200 && s.winner === null; i++) apply(s, s.prompt!.kind === 'action' ? { t: 'pass' } : chooseAction(s));
    return s;
  };

  it('with the same Candles, the side with more Health left on its units wins', () => {
    const s = endAfterRound40(0, 1);
    expect(s.winner).toBe(0);
    expect(s.log.at(-1)!.text).toContain('more Health left (3 to 2)');
    expect(endAfterRound40(2, 0).winner).toBe(1);
  });

  it('with the same Candles and the same Health left, the game is a draw', () => {
    expect(endAfterRound40(1, 1).winner).toBe('draw');
  });

  it('more Candles still wins, whatever the Health', () => {
    const s = toFirstAction(['domowiki', 'pari'], 9);
    s.round = 40;
    s.players[0].lives = s.players[0].lives.slice(0, 4);
    s.players[1].lives = s.players[1].lives.slice(0, 5);
    s.players[0].yard = [];
    for (let i = 0; i < 200 && s.winner === null; i++) apply(s, s.prompt!.kind === 'action' ? { t: 'pass' } : chooseAction(s));
    expect(s.winner).toBe(1);
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
  }, 60_000); // 12 random games per ordered pairing: grows with every deck

  it('AI agents finish, and the same seeds replay identically', () => {
    const run = () => {
      const r = rng(99);
      return playOut(createGame({ decks: ['pari', 'domowiki'], seed: 5 }), (g) => chooseAction(g, { random: r }));
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
      const s = playOut(createGame({ decks: ['domowiki', 'pari'], seed }), (g) =>
        g.prompt!.player === 0 ? chooseAction(g, { random: r }) : randomAction(g, r));
      if (s.winner === 0) aiWins++;
    }
    expect(aiWins).toBeGreaterThanOrEqual(16);
  });

  it('only ever offers legal actions', () => {
    const r = rng(3);
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 3 });
    while (s.winner === null) {
      const legal = legalActions(s);
      if (s.prompt!.kind === 'action') expect(legal.some((a) => a.t === 'pass')).toBe(true);
      apply(s, randomAction(s, r));
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
    deck.cards['DW1-D01'] = 1;
    deck.cards['PR1-D01'] = 1;
    deck.cards['TST-N01'] = 1;
    expect(deckProblems(deck)).toEqual([]);
    expect(otherFamilies(deck)).toEqual(['Pari']);
    expect(addProblem(deck, 'TST-N01', undefined, true)).toBeNull();
    expect(addProblem(deck, 'AL1-D01', undefined, true)).toMatch(/already uses Pari/);
  });
});
