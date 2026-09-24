import { describe, expect, it } from 'vitest';
import {
  CARDS, DECKS, RARITIES, addProblem, apply, chooseAction, createGame, deckCardIds, deckProblems, legalActions, randomAction,
  keywords, unitHealth, unitPower, type DeckList, type GameState,
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
    expect(keywords('SB1-O07')).toMatchObject({ guardian: true, tough: 1 });
    expect(keywords('SB1-C09')).toMatchObject({ pounce: true, lucky: true });
    expect(keywords('SB1-O03').guardian).toBe(false); // "If you control a Guardian" is not the keyword
  });

  it('gives every card a rarity, and every Hero Cat is Legendary', () => {
    for (const card of Object.values(CARDS)) {
      expect(RARITIES).toContain(card.rarity);
      if (card.type === 'Hero Cat') expect(card.rarity).toBe('Legendary');
    }
  });
});

describe('deckbuilding (rulebook 11.1)', () => {
  const withCards = (cards: Record<string, number>, hero = 'SB1-H01'): DeckList => ({ name: 'Test', hero, cards });
  const zest = () => withCards({ ...DECKS['zest-rush'].cards });

  it('needs exactly 50 cards', () => {
    const deck = zest();
    deck.cards['SB1-G05'] = 1;
    expect(deckProblems(deck)).toEqual(['Add 1 more card.']);
    deck.cards['SB1-G05'] = 3;
    expect(deckProblems(deck)).toEqual(['Remove 1 card.']);
  });

  it('allows one family besides the Hero Cat\'s, plus Garden', () => {
    const deck = zest();
    deck.cards['SB1-C01'] = 1;
    deck.cards['SB1-O01'] = 2;
    expect(deckProblems(deck)).toEqual([]);
    expect(addProblem(deck, 'SB1-T01')).toMatch(/already uses Orchard/);
    deck.cards['SB1-O01'] = 1;
    deck.cards['SB1-T01'] = 1;
    expect(deckProblems(deck)[0]).toMatch(/one other family/);
  });

  it('limits copies: 3 of a card, 1 of each Cat, 6 Cats', () => {
    const deck = zest();
    expect(addProblem(deck, 'SB1-C01')).toMatch(/at most 3 copies/);
    expect(addProblem(deck, 'SB1-C13')).toMatch(/one of a kind/);
    deck.cards['SB1-C13'] = 2;
    deck.cards['SB1-C01'] = 2;
    expect(deckProblems(deck)).toEqual([expect.stringMatching(/one of a kind/)]);

    const cats = withCards({ 'SB1-C13': 1, 'SB1-C14': 1, 'SB1-C15': 1, 'SB1-O13': 1, 'SB1-O14': 1, 'SB1-O15': 1 });
    expect(addProblem(cats, 'SB1-T13')).toMatch(/one other family/);
    expect(addProblem(cats, 'SB1-O13')).toMatch(/one of a kind/);
    cats.cards['SB1-O13'] = 0;
    expect(addProblem(cats, 'SB1-O13')).toBeNull();
  });

  it('checks the collection when given one', () => {
    const owned = (id: string) => (id === 'SB1-C08' ? 2 : 3);
    const deck = zest();
    expect(deckProblems(deck, owned)).toEqual([]);
    expect(addProblem(deck, 'SB1-C08', owned)).toMatch(/only 2 copies/);
    deck.cards['SB1-C08'] = 3;
    deck.cards['SB1-C01'] = 2;
    expect(deckProblems(deck, owned)).toEqual([expect.stringMatching(/only 2 copies/)]);
  });

  it('keeps Hero Cats out of the deck', () => {
    expect(addProblem(withCards({}), 'SB1-H02')).toMatch(/Hero Cat/);
  });

  it('starts a game with a deck list', () => {
    const mine = withCards({ ...DECKS['zest-rush'].cards }, 'SB1-H01');
    mine.name = 'My deck';
    const s = createGame({ decks: [mine, 'orchard-guard'], seed: 3 });
    expect(s.players[0].deckName).toBe('My deck');
    expect(s.players[0].hero.id).toBe('SB1-H01');
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

  it('Lychee Sloth can only attack while Lush (7+ Treats)', () => {
    const s = toFirstAction(['mango-tango', 'zest-rush']);
    const me = s.players[0];
    me.yard.push({ uid: 9002, id: 'SB1-T05', damage: 0, exhausted: false, buffPower: 0, buffSneaky: false, buffGuardian: false, usedOnce: false });
    const slothAttacks = () => legalActions(s).filter((a) => a.t === 'attack' && a.attacker.kind === 'unit' && a.attacker.uid === 9002);
    expect(slothAttacks()).toHaveLength(0);
    while (me.pantry.length < 6) me.pantry.push({ card: me.deck.shift()!, exhausted: true });
    expect(slothAttacks()).toHaveLength(0);
    me.pantry.push({ card: me.deck.shift()!, exhausted: true });
    expect(slothAttacks().length).toBeGreaterThan(0);
  });
});

/** Put a card in player 0's hand with enough ready Treats to play it, and play it (declining any Pounce). */
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
  s.players[1].yard.push({ uid, id, damage: 10 - health, exhausted: false, buffPower: 0, buffSneaky: false, buffGuardian: false, usedOnce: false, ripe: 0 });
  return { kind: 'unit' as const, uid };
}

describe('signature mechanics', () => {
  it('Zest: Citron Fox deals 1 as your first card, 2 when it isn\'t', () => {
    const first = toFirstAction(['zest-rush', 'orchard-guard'], 3);
    const t1 = enemyUnit(first, 'SB1-O04'); // Plum Mole: no Tough, so damage lands in full
    playFromHand(first, 'SB1-C06', t1);
    expect(first.players[1].yard.find((u) => u.uid === t1.uid)!.damage).toBe(1);

    const second = toFirstAction(['zest-rush', 'orchard-guard'], 3);
    second.players[0].playedThisRound = 1; // already played a card this round
    const t2 = enemyUnit(second, 'SB1-O04');
    playFromHand(second, 'SB1-C06', t2);
    expect(second.players[1].yard.find((u) => u.uid === t2.uid)!.damage).toBe(2);
  });

  it('Zest: Orange Corgi enters ready only with Zest', () => {
    const a = toFirstAction(['zest-rush', 'orchard-guard'], 4);
    const u1 = playFromHand(a, 'SB1-C04');
    expect(a.players[0].yard.find((u) => u.uid === u1)!.exhausted).toBe(true);
    const b = toFirstAction(['zest-rush', 'orchard-guard'], 4);
    b.players[0].playedThisRound = 1;
    const u2 = playFromHand(b, 'SB1-C04');
    expect(b.players[0].yard.find((u) => u.uid === u2)!.exhausted).toBe(false);
  });

  it('Zest resets at the start of each round', () => {
    const s = toFirstAction(['zest-rush', 'orchard-guard'], 5);
    s.players[0].playedThisRound = 3;
    const round = s.round;
    for (let i = 0; i < 200 && s.round === round; i++) apply(s, chooseAction(s));
    expect(s.players[0].playedThisRound).toBe(0);
  });

  it('Ripen: Plum Mole grows +1/+1 each round, up to +2/+2', () => {
    const s = toFirstAction(['orchard-guard', 'zest-rush'], 6);
    s.players[0].yard.push({ uid: 7777, id: 'SB1-O04', damage: 0, exhausted: false, buffPower: 0, buffSneaky: false, buffGuardian: false, usedOnce: false, ripe: 0 });
    const mole = () => s.players[0].yard.find((u) => u.uid === 7777)!;
    const ripeAtRound: number[] = [];
    // Both players only pass, so nothing can touch the Mole; other prompts (plant, discard) are the AI's.
    while (s.round < 5) {
      const r = s.round;
      apply(s, s.prompt!.kind === 'action' ? { t: 'pass' } : chooseAction(s));
      if (s.round !== r) ripeAtRound.push(mole().ripe ?? 0);
    }
    expect(ripeAtRound).toEqual([1, 2, 2, 2]);
    expect(unitPower(mole())).toBe(2 + 2);
    expect(unitHealth(mole())).toBe(3 + 2);
  });

  it('Sprout counts as Treats and turns Lush on at 7', () => {
    const s = toFirstAction(['mango-tango', 'zest-rush']);
    const me = s.players[0];
    while (me.pantry.length < 5) me.pantry.push({ card: me.deck.shift()!, exhausted: false });
    playFromHand(s, 'SB1-T09'); // Sprout 2
    expect(me.pantry.length).toBeGreaterThanOrEqual(7);
  });
});

describe('events', () => {
  const mine = (s: GameState, uid: number) =>
    s.players[0].yard.push({ uid, id: 'SB1-O04', damage: 0, exhausted: false, buffPower: 0, buffSneaky: false, buffGuardian: false, usedOnce: false, ripe: 0 });
  const attack = (s: GameState, uid: number, target: { kind: 'unit'; uid: number } | { kind: 'hero'; player: 1 }) => {
    const from = s.events.length;
    apply(s, { t: 'attack', attacker: { kind: 'unit', uid }, target });
    while (s.prompt?.player === 1 && s.prompt.kind === 'pounce') apply(s, { t: 'decline' });
    return s.events.slice(from);
  };

  it('an attack that trades reports the attack, the clash, then the defeat', () => {
    const s = toFirstAction(['orchard-guard', 'zest-rush'], 7);
    mine(s, 7001);
    const foe = enemyUnit(s, 'SB1-O04');
    s.players[1].yard.at(-1)!.damage = 1; // Plum Mole 2/3 with 1 damage: the attacking Mole's 2 finishes it
    const events = attack(s, 7001, foe);
    expect(events.map((e) => e.t).slice(0, 3)).toEqual(['attack', 'clash', 'defeated']);
    expect(events[1]).toMatchObject({ target: foe.uid, dealt: 2, taken: 2 });
    expect(events[2]).toMatchObject({ uid: foe.uid, owner: 1 });
  });

  it('a hit on the Hero Cat reports the hit, then the lost Life', () => {
    const s = toFirstAction(['orchard-guard', 'zest-rush'], 8);
    mine(s, 7002);
    const events = attack(s, 7002, { kind: 'hero', player: 1 });
    expect(events.map((e) => e.t).slice(0, 3)).toEqual(['attack', 'heroHit', 'lifeLost']);
    expect(events[2]).toMatchObject({ p: 1, left: 8 });
  });

  it('a Hello that deals damage reports the play, then the damage', () => {
    const s = toFirstAction(['zest-rush', 'orchard-guard'], 3);
    const t = enemyUnit(s, 'SB1-O04');
    const from = s.events.length;
    playFromHand(s, 'SB1-C06', t); // Citron Fox: Hello, deal 1
    const events = s.events.slice(from);
    expect(events[0]).toMatchObject({ t: 'play', p: 0, cardId: 'SB1-C06', target: t });
    expect(events.find((e) => e.t === 'damage')).toMatchObject({ uid: t.uid, amount: 1, p: 0 });
  });

  it('a whole game keeps one event stream that ends with the winner', () => {
    const s = playOut(createGame({ decks: ['zest-rush', 'mango-tango'], seed: 11 }), (g) => randomAction(g, rng(11)));
    expect(s.events.some((e) => e.t === 'round')).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ t: 'win' });
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
