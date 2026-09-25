// Heat Wave (content/2026/09/heat-wave): a set written only as data. These tests check that the engine
// plays each of its new pieces as the set's design says (docs/heat-wave-set.md), with no card code.

import { describe, expect, it } from 'vitest';
import {
  CARDS, DECKS, TRIGGER_CHAIN_LIMIT, apply, chooseAction, createGame, findUnit, heroSide, legalActions, unitKeywords, unitPower,
  type Action, type GameState, type PlayerId, type Unit,
} from '../src/index';

/** A game at its first action, with both hands and Yards cleared so a test can set the table. */
function table(deckA = 'five-alarm', deckB = 'zest-rush'): GameState {
  const s = createGame({ decks: [deckA, deckB], seed: 3, firstPlayer: 0 });
  apply(s, { t: 'mulligan', uids: [] });
  apply(s, { t: 'mulligan', uids: [] });
  apply(s, { t: 'setupPlant', uids: s.players[0].hand.slice(0, 2).map((c) => c.uid) });
  apply(s, { t: 'setupPlant', uids: s.players[1].hand.slice(0, 2).map((c) => c.uid) });
  for (const pl of s.players) {
    pl.hand = [];
    pl.yard = [];
    for (let i = 0; i < 8; i++) pl.pantry.push({ card: { uid: 90000 + i + pl.pantry.length * 100, id: 'SB1-G01' }, exhausted: false });
  }
  return s;
}

let nextUid = 50000;
function put(s: GameState, p: PlayerId, id: string, extra: Partial<Unit> = {}): Unit {
  const u: Unit = { uid: nextUid++, id, damage: 0, exhausted: false, buffPower: 0, usedOnce: false, ...extra };
  s.players[p].yard.push(u);
  return u;
}
function hand(s: GameState, p: PlayerId, id: string): number {
  const uid = nextUid++;
  s.players[p].hand.push({ uid, id });
  return uid;
}
const unitTarget = (u: Unit) => ({ kind: 'unit' as const, uid: u.uid });
/** Play a card as player 0 with these targets, and let the opponent decline any Pounce. */
function play(s: GameState, uid: number, target?: Unit, target2?: Unit): void {
  const action: Action = { t: 'play', uid, ...(target ? { target: unitTarget(target) } : {}), ...(target2 ? { target2: unitTarget(target2) } : {}) };
  apply(s, action);
  while (s.prompt?.kind === 'pounce') apply(s, { t: 'decline' });
}

describe('Heat Wave as data', () => {
  it('registers the set: 19 cards, a token and the Five Alarm deck', () => {
    expect(CARDS['HW1-P07'].name).toBe('Scotch Bonnet Rhino');
    expect(CARDS['HW1-K01'].token).toBe(true);
    expect(Object.values(DECKS['five-alarm'].cards).reduce((a, b) => a + b, 0)).toBe(50);
  });

  it('Heat: a unit dealt damage that survives gets +1 Power, up to +3', () => {
    const s = table();
    const badger = put(s, 0, 'HW1-P03');            // 2/3 Heat
    const sauce = hand(s, 0, 'HW1-P09');            // Hot Sauce: deal 1 to your unit, +3 Power this round
    play(s, sauce, badger);
    expect(badger.damage).toBe(1);
    expect(badger.counters?.heat).toBe(1);
    expect(unitPower(badger, s)).toBe(2 + 1 + 3);
    badger.counters = { heat: 3 };
    badger.damage = 0;
    const sauce2 = hand(s, 0, 'HW1-P09');
    s.prompt = { kind: 'action', player: 0 };
    play(s, sauce2, badger);
    expect(badger.counters?.heat).toBe(3);          // capped
  });

  it('Heat: no Heat for a unit the damage defeats', () => {
    const s = table();
    const bat = put(s, 0, 'HW1-P01');               // 1/2 Heat
    bat.damage = 1;
    const sauce = hand(s, 0, 'HW1-P09');
    play(s, sauce, bat);
    expect(findUnit(s, bat.uid)).toBeNull();
    expect(s.players[0].compost.some((c) => c.id === 'HW1-P01')).toBe(true);
  });

  it('Showdown: two chosen units deal their Power to each other', () => {
    const s = table();
    const bull = put(s, 0, 'HW1-P06');              // 4/4 Heat
    const fox = put(s, 1, 'SB1-C06');               // 3/3
    const showdown = hand(s, 0, 'HW1-P10');
    expect(legalActions(s).some((a) => a.t === 'play' && a.uid === showdown && a.target2)).toBe(true);
    play(s, showdown, bull, fox);
    expect(findUnit(s, fox.uid)).toBeNull();
    expect(bull.damage).toBe(3);
    expect(bull.counters?.heat).toBe(1);
  });

  it('Ring of Fire hits every unit, then the Heat units that survive heat up', () => {
    const s = table();
    const raccoon = put(s, 0, 'HW1-P05');           // 2/4 Guardian Heat
    const mouse = put(s, 1, 'SB1-C01');             // 1/1
    const ring = hand(s, 0, 'HW1-P11');
    play(s, ring);
    expect(findUnit(s, mouse.uid)).toBeNull();
    expect(raccoon.damage).toBe(1);
    expect(raccoon.counters?.heat).toBe(1);
  });

  it('Chili Chihuahua: "you may" — it can be played without hurting anyone', () => {
    const s = table();
    const badger = put(s, 0, 'HW1-P03');
    const chihuahua = hand(s, 0, 'HW1-P02');
    const plays = legalActions(s).filter((a) => a.t === 'play' && a.uid === chihuahua);
    expect(plays.some((a) => !('target' in a))).toBe(true);
    expect(plays.some((a) => a.t === 'play' && a.target?.kind === 'unit' && a.target.uid === badger.uid)).toBe(true);
  });

  it('Spiked Collar gives +1 Power and Heat; Ancho gives other Heat units +1 Power', () => {
    const s = table();
    const hamster = put(s, 0, 'SB1-G01');           // 2/1, no Heat
    const collar = hand(s, 0, 'HW1-P12');
    play(s, collar, hamster);
    expect(unitKeywords(hamster, s).all).toContain('Heat');
    expect(unitPower(hamster, s)).toBe(3);
    put(s, 0, 'HW1-P14');                           // Ancho, Brawl Boss
    expect(unitPower(hamster, s)).toBe(4);          // the Collar's Heat counts for Ancho's aura
  });

  it("Jack, the Pumpkin Knight leaves a Jack-o'-Lantern; a token never goes to the Compost", () => {
    const s = table('zest-rush', 'five-alarm');
    const jack = put(s, 0, 'HW1-X01');
    jack.damage = 3;
    const spray = hand(s, 1, 'SB1-C09');           // not needed: kill Jack directly
    void spray;
    jack.damage = 4;
    s.prompt = { kind: 'action', player: 0 };
    apply(s, { t: 'pass' });
    const lantern = s.players[0].yard.find((u) => u.id === 'HW1-K01');
    expect(lantern).toBeDefined();
    lantern!.damage = 2;
    s.prompt = { kind: 'action', player: 1 };
    apply(s, { t: 'pass' });
    expect(s.players[0].yard.some((u) => u.id === 'HW1-K01')).toBe(false);
    expect(s.players[0].compost.some((c) => c.id === 'HW1-K01')).toBe(false);
  });

  it('Blaze Grows Up once 5 Cats and Critters are in the Composts', () => {
    const s = table();
    expect(s.players[0].hero.grown).toBe(false);
    for (let i = 0; i < 5; i++) s.players[1].compost.push({ uid: 70000 + i, id: 'SB1-G01' });
    apply(s, { t: 'pass' });
    expect(s.players[0].hero.grown).toBe(true);
    expect(heroSide(s, 0).name).toBe('Blaze, Wildfire');
  });

  it("Reaper's Big Cat gives Fierce to units at +3 Heat", () => {
    const s = table();
    const deck = { ...DECKS['five-alarm'], hero: 'HW1-X03' };
    const r = createGame({ decks: [deck, 'zest-rush'], seed: 5, firstPlayer: 0 });
    const rhino = put(r, 0, 'HW1-P06');
    expect(r.players[0].hero.grown).toBe(false);
    rhino.counters = { heat: 3 };
    // Grow Up is checked after any step: the state check flips Reaper now that a unit is at +3 Heat.
    apply(r, { t: 'mulligan', uids: [] });
    expect(r.players[0].hero.grown).toBe(true);
    expect(unitKeywords(rhino, r).fierce).toBe(true);
    void s;
  });

  it('Nova has Sneaky and Fierce only while you are Lush', () => {
    const s = table('mango-tango', 'zest-rush');
    const nova = put(s, 0, 'HW1-X02');
    s.players[0].pantry = s.players[0].pantry.slice(0, 6);
    expect(unitKeywords(nova, s).sneaky).toBe(false);
    s.players[0].pantry.push({ card: { uid: 99999, id: 'SB1-G01' }, exhausted: true });
    expect(unitKeywords(nova, s).sneaky && unitKeywords(nova, s).fierce).toBe(true);
  });

  it('two Nagas scorching each other stop at the chain limit instead of looping forever', () => {
    const s = table('five-alarm', 'five-alarm');
    const a = put(s, 0, 'HW1-P15');
    const b = put(s, 1, 'HW1-P15');
    // Make them unkillable by each other's 1 damage so the chain would never end on its own.
    a.damage = -10_000;
    b.damage = -10_000;
    const sauce = hand(s, 0, 'HW1-P09');
    play(s, sauce, a);
    expect(s.chain).toBeGreaterThan(TRIGGER_CHAIN_LIMIT);
    expect(s.log.some((e) => e.text.includes('chain of effects stops'))).toBe(true);
  });

  it('bots can play whole games with Five Alarm against every Starter Box deck', () => {
    for (const foe of ['zest-rush', 'orchard-guard', 'mango-tango']) {
      for (const seed of [1, 2]) {
        const s = createGame({ decks: ['five-alarm', foe], seed });
        let rnd = seed;
        const random = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
        let guard = 0;
        while (s.winner === null && guard++ < 3000) apply(s, chooseAction(s, { random }));
        expect(s.winner).not.toBeNull();
      }
    }
  });
});
