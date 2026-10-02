// Folkborn 0.6 (docs/folkborn-0.6-design.md): tiers and the shop's odds, copies and stars, copy limits, traits, and the
// Clash's own triggers. On a small set of its own, so these test the rules, not the cards' numbers of the day.
import { describe, expect, it } from 'vitest';
import {
  RULES, TRAITS, apply, copyLimit, createGame, deckProblems, mayAct, registerSet, tierOf, traitsOf, unitHealth, unitPower,
  type DeckList, type GameState, type Unit,
} from '../src/index';

const unit = (id: string, cost: number, power: number, health: number, more: Record<string, unknown> = {}) =>
  ({ id, type: 'Critter' as const, family: 'Testfolk', name: id, rarity: 'Common' as const, cost, power, health, text: '', ...more });

registerSet({
  set: 'T06', name: 'Test 0.6', status: 'prototype',
  families: { Testfolk: {} },
  traits: {
    'Test Kin': {
      family: 'Testfolk',
      tiers: [
        { at: 2, text: 'Your Testfolk get +1 Power.', abilities: [{ static: { grant: { power: 1 }, to: { each: 'own', filter: { family: 'Testfolk' } } } }] },
        { at: 4, text: 'Your Testfolk get +3 Power.', abilities: [{ static: { grant: { power: 3 }, to: { each: 'own', filter: { family: 'Testfolk' } } } }] },
      ],
    },
  },
  cards: [
    { id: 'T06-H', type: 'Hero Cat', family: 'Testfolk', name: 'Test Hero', rarity: 'Rare', kitten: { name: 'Test Hero', text: '' }, bigCat: { name: 'Test Hero', text: '', power: 0 } },
    unit('T06-A', 1, 2, 2),
    unit('T06-B', 1, 1, 4, { keywords: ['Guardian'] }),
    unit('T06-B2', 1, 1, 4, { keywords: ['Guardian'] }),
    unit('T06-C', 2, 0, 20, { abilities: [{ when: 'clashStart', target: { each: 'enemy', range: 0 }, do: [{ damage: 2 }] }] }),
    unit('T06-D', 3, 0, 20, { abilities: [{ when: 'boutStart', target: 'self', do: [{ heal: 1 }] }] }),
    unit('T06-E', 4, 1, 20, { abilities: [{ when: 'everyOtherBout', target: { each: 'own' }, do: [{ buff: { power: 1 } }] }] }),
    unit('T06-F', 5, 1, 1),
    unit('T06-G', 1, 0, 1, { abilities: [{ when: 'goodbye', do: [{ summon: 'T06-K' }] }] }),
  ],
  tokens: [unit('T06-K', 0, 0, 1)],
  decks: {
    t06: { name: 'Test', hero: 'T06-H', cards: { 'T06-A': 6, 'T06-B': 6, 'T06-C': 6, 'T06-D': 4, 'T06-E': 3, 'T06-F': 1, 'T06-G': 6 } },
  },
});

const game = (seed = 1): GameState => createGame({ decks: ['t06', 't06'], seed, firstPlayer: 0 });

function put(s: GameState, p: 0 | 1, id: string, slot: number, extra: Partial<Unit> = {}): Unit {
  const u: Unit = { uid: 8000 + p * 100 + slot, id, slot, damage: 0, exhausted: false, buffPower: 0, usedOnce: false, ...extra };
  s.players[p].yard.push(u);
  s.players[p].yard.sort((a, b) => a.slot - b.slot);
  return u;
}

/** Both players Ready: the Clash plays. Returns what happened in it. */
function clash(s: GameState) {
  const from = s.events.length;
  for (const p of [0, 1] as const) if (mayAct(s, p)) apply(s, { t: 'ready' }, p);
  return s.events.slice(from);
}

describe('tiers and the shop', () => {
  it("a card's tier is its price, 1 to 5", () => {
    expect(['T06-A', 'T06-C', 'T06-D', 'T06-E', 'T06-F'].map(tierOf)).toEqual([1, 2, 3, 4, 5]);
  });

  it('deals by the Level: at Level 2 only tiers 1 and 2; at Level 6 every tier turns up', () => {
    const low = new Set<number>(), high = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) {
      const s = game(seed);
      for (const c of s.players[0].shop) low.add(tierOf(c.id));
      s.players[0].hero.level = 6;
      s.players[0].offerings = 50;
      for (let i = 0; i < 4; i++) {
        apply(s, { t: 'roll' }, 0);
        for (const c of s.players[0].shop) high.add(tierOf(c.id));
      }
    }
    expect([...low].sort()).toEqual([1, 2]);
    expect([...high].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('copies and stars', () => {
  it('3 copies in one unit make it 2★, 6 make it 3★; a seventh is not taken', () => {
    const s = game();
    s.players[0].offerings = 50;
    const first = put(s, 0, 'T06-A', 0, { copies: 1 });
    const buyCopy = () => {
      s.players[0].shop.push({ uid: 9500 + (first.copies ?? 1), id: 'T06-A' });
      apply(s, { t: 'play', uid: 9500 + (first.copies ?? 1) }, 0);
    };
    buyCopy();
    expect([first.copies, first.stars ?? 1, unitPower(first)]).toEqual([2, 1, 2]);
    buyCopy();
    expect([first.copies, first.stars, unitPower(first), unitHealth(first)]).toEqual([3, 2, 4, 4]);
    for (let i = 0; i < 3; i++) buyCopy();
    expect([first.copies, first.stars, unitPower(first)]).toEqual([6, 3, 6]);
    s.players[0].shop.push({ uid: 9600, id: 'T06-A' });
    expect(s.players[0].shop.length).toBeGreaterThan(0);
    expect(() => apply(s, { t: 'play', uid: 9600 }, 0)).toThrow(/illegal/);
  });

  it('a deck holds 6 copies of a tier 1 or 2 card, 4 of tier 3, 3 of tier 4, 1 of tier 5', () => {
    expect(['T06-A', 'T06-C', 'T06-D', 'T06-E', 'T06-F'].map(copyLimit)).toEqual([6, 6, 4, 3, 1]);
    const deck: DeckList = { name: 'Too many', hero: 'T06-H', cards: { 'T06-A': 7, 'T06-B': 6, 'T06-B2': 6, 'T06-C': 6, 'T06-G': 6, 'T06-D': 4, 'T06-E': 3, 'T06-F': 1 } };
    expect(deckProblems(deck).some((p) => /At most 6 copies of T06-A/.test(p))).toBe(true);
  });
});

describe('traits', () => {
  it("a family's trait counts different units, turns on at its tiers, and grants its bonus", () => {
    const s = game();
    const a = put(s, 0, 'T06-A', 0);
    expect(traitsOf(s, 0).find((t) => t.name === 'Test Kin')).toMatchObject({ count: 1, tier: -1 });
    expect(unitPower(a, s)).toBe(2);
    put(s, 0, 'T06-C', 1);
    expect(traitsOf(s, 0).find((t) => t.name === 'Test Kin')).toMatchObject({ count: 2, tier: 0 });
    expect(unitPower(a, s)).toBe(3);
    put(s, 0, 'T06-D', 2);
    put(s, 0, 'T06-E', 3);
    expect(unitPower(a, s)).toBe(5); // the highest tier on, not both
    expect(unitPower(put(s, 1, 'T06-A', 0), s)).toBe(2); // the opponent's units: not theirs
  });

  it('copies merged into one unit count once', () => {
    const s = game();
    put(s, 0, 'T06-A', 0, { copies: 3, stars: 2 });
    expect(traitsOf(s, 0).find((t) => t.name === 'Test Kin')).toMatchObject({ count: 1, tier: -1 });
  });

  it("a role is a trait too: two Guardians turn on the Guardians' bonus", () => {
    const s = game();
    const b = put(s, 0, 'T06-B', 0);
    const health = unitHealth(b, s);
    put(s, 0, 'T06-B2', 1);
    const bonus = TRAITS.Guardian.tiers[0].abilities[0].static!.grant!.health!;
    expect(unitHealth(b, s) - health).toBe(bonus); // Test Kin's bonus, also on now, is Power only
  });
});

describe("the Clash's own triggers", () => {
  it('Clash start: happens once before the first bout, to the enemy across', () => {
    const s = game();
    put(s, 0, 'T06-C', 2);
    const across = put(s, 1, 'T06-A', 2);
    const aside = put(s, 1, 'T06-B', 4, { buffHealth: 10 });
    const events = clash(s);
    const damage = events.filter((e) => e.t === 'damage');
    expect(damage).toEqual([expect.objectContaining({ uid: across.uid, amount: 2 })]);
    expect(events.findIndex((e) => e.t === 'damage')).toBeLessThan(events.findIndex((e) => e.t === 'bout'));
    expect(damage.some((e) => 'uid' in e && e.uid === aside.uid)).toBe(false);
  });

  it('Each bout: happens at the start of every bout', () => {
    const s = game();
    put(s, 0, 'T06-D', 0, { damage: 5 });
    put(s, 1, 'T06-A', 0, { buffHealth: 30 });
    const events = clash(s);
    const bouts = events.filter((e) => e.t === 'bout').length;
    expect(events.filter((e) => e.t === 'heal').length).toBeGreaterThanOrEqual(Math.min(bouts, 5));
  });

  it('Every second bout: bouts 2, 4, 6 and 8 only', () => {
    const s = game();
    put(s, 0, 'T06-E', 0);
    put(s, 1, 'T06-A', 0, { buffHealth: 30, buffPower: -2 });
    put(s, 1, 'T06-C', 1, { buffHealth: 0 });
    const events = clash(s);
    let bout = 0;
    const at: number[] = [];
    for (const e of events) {
      if (e.t === 'bout') bout = e.n;
      if (e.t === 'buff') at.push(bout);
    }
    expect(at.length).toBeGreaterThan(0);
    expect(at.every((n) => n % 2 === 0)).toBe(true);
    expect(RULES.boutCap % 2).toBe(0);
  });

  it('a summoned token going down is not one of the "units gone down in Clashes"', () => {
    const s = game();
    put(s, 0, 'T06-G', 0);
    put(s, 1, 'T06-F', 0, { buffHealth: 20 });
    put(s, 1, 'T06-A', 1, { buffHealth: 20 });
    const events = clash(s);
    expect(events.some((e) => e.t === 'summon' && e.cardId === 'T06-K')).toBe(true);
    expect(events.filter((e) => e.t === 'down' && e.owner === 0).length).toBe(2);
    expect(s.players[0].downed).toBe(1);
  });
});
