import { describe as suite, expect, it } from 'vitest';
import {
  RULES, apply, chooseAction, createGame, describe, listChoices, nextSeat, other, parseChoice, rulesPrimer, type GameState, type PlayerId,
} from '../src/index';
import TERMS from '../src/terms.json';

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** Every decision of a few bot games, with the state and the seat deciding. */
function* decisions(games: number, decks = ['domowiki', 'pari', 'aluxes']): Generator<[GameState, PlayerId]> {
  for (let g = 0; g < games; g++) {
    const s = createGame({ decks: [decks[g % decks.length], decks[(g + 1) % decks.length]], seed: 700 + g });
    const r = rng(g + 1);
    for (let p = nextSeat(s); p !== null; p = nextSeat(s)) {
      yield [s, p];
      apply(s, chooseAction(s, { random: r, seat: p }), p);
    }
  }
}

/** Bot games played to the end. */
function games(n: number, decks: string[]): GameState[] {
  return Array.from({ length: n }, (_, g) => {
    const s = createGame({ decks: [decks[g % decks.length], decks[(g + 1) % decks.length]], seed: 900 + g });
    const r = rng(g + 7);
    for (let p = nextSeat(s); p !== null; p = nextSeat(s)) apply(s, chooseAction(s, { random: r, seat: p }), p);
    return s;
  });
}

suite('text interface', () => {
  it('numbers every legal action, and every number reads back as that action', () => {
    let checked = 0;
    for (const [s, seat] of decisions(4)) {
      const c = listChoices(s, {}, seat);
      expect(c.options.length).toBeGreaterThan(0);
      for (const o of c.options) {
        expect(parseChoice(s, `${o.n}`, seat)).toEqual({ action: o.action });
        expect(o.label.length).toBeGreaterThan(2);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  }, 60_000);

  it('reads the choice out of a reply that reasons first', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 1 });
    const seat = nextSeat(s)!;
    const options = listChoices(s, {}, seat).options;
    const n = options.length;
    expect(parseChoice(s, `Round 1 with 3 Offerings, so I'll be Ready.\nAnswer: ${n}`, seat)).toEqual({ action: options[n - 1].action });
    expect('error' in parseChoice(s, `${n + 5}`, seat)).toBe(true);
    expect('error' in parseChoice(s, 'attack!', seat)).toBe(true);
  });

  it('never shows a player what they may not know', () => {
    // Swap every card the player can't see (the opponent's shop and Ambushes, both decks) for other cards: what the
    // player reads must not change.
    let compared = 0;
    for (const [s, seat] of decisions(3)) {
      const t = structuredClone(s);
      const foe = t.players[other(seat)];
      const swap = (c: { id: string }) => { c.id = c.id === 'DW1-D16' ? 'PR1-D09' : 'DW1-D16'; };
      foe.shop.forEach(swap);
      (foe.ambushes ?? []).forEach((a) => swap(a.card));
      for (const pl of t.players) pl.deck.forEach(swap);
      expect(describe(t, seat)).toBe(describe(s, seat));
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  }, 60_000);

  it("during the Muster, what a player reads doesn't change with the opponent's moves", () => {
    let compared = 0;
    for (const [s, seat] of decisions(2)) {
      if (s.prompt?.kind !== 'muster' || !s.muster!.open[other(seat)] || compared > 60) continue;
      const before = describe(s, other(seat));
      const t = structuredClone(s);
      apply(t, chooseAction(t, { random: rng(3), seat }), seat);
      if (t.phase !== 'muster') continue; // that Ready started the Clash: public from then on
      expect(describe(t, other(seat))).toBe(before);
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
  }, 60_000);

  it('teaches the rules with the numbers of the game in front of it', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 1, rules: { startOfferings: 7 } });
    expect(rulesPrimer(s)).toContain('You start with 7.');
  });

  // The LLM players read rulesPrimer() without a game, and were told "at most 3" Candles a Clash when the rule was 2.
  it('without a game, teaches the default numbers', () => {
    expect(rulesPrimer()).toContain(`at most ${RULES.clashCandleCap}.`);
    expect(rulesPrimer()).toContain(`after ${RULES.boutCap} bouts`);
  });

  // A Level is room for one more unit; there are always six lanes. "Level 3: 3 lanes" read as if lanes were locked.
  it('says a Level is room for units, not lanes', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 3 });
    const r = rng(3);
    while (s.prompt?.kind !== 'muster') apply(s, chooseAction(s, { random: r, seat: nextSeat(s)! }), nextSeat(s)!);
    const seat = nextSeat(s)!;
    const level = listChoices(s, { detail: true }, seat).options.find((o) => o.action.t === 'levelUp')!;
    expect(level.label).toMatch(/room for 3 units/);
    apply(s, level.action, seat);
    expect(s.log.at(-1)!.text).toMatch(/reaches Level 3: room for 3 units\.$/);
    expect(rulesPrimer()).not.toMatch(/more lanes/);
  });
});

suite("the game's words", () => {
  // The Story drawer shows the log and the LLM players read the choices: they said "Life" for a Candle until 2026-09-29.
  it("the log, the questions and the choices use players' words, never the retired ones", () => {
    const retired = [...(TERMS.retired as string[]), 'Life'];
    const seen = new Set<string>();
    for (const [s, seat] of decisions(5, ['domowiki', 'pari', 'aluxes', 'jiaoren', 'hui-hai'])) {
      const c = listChoices(s, { detail: true }, seat);
      seen.add(c.question);
      for (const o of c.options) seen.add(o.label);
      if (s.winner === null) for (const line of s.log.slice(-3)) seen.add(line.text);
    }
    const bad = [...seen].filter((t) => retired.some((w) => new RegExp(`\\b${w}\\b`).test(t)));
    expect(bad).toEqual([]);
  }, 60_000);
});

suite('what the log says', () => {
  it('opens each round with who holds the Lantern, and reports every Clash with how it ended', () => {
    const s = createGame({ decks: ['pari', 'aluxes'], seed: 1800 });
    const r = rng(5);
    for (let p = nextSeat(s); p !== null; p = nextSeat(s)) apply(s, chooseAction(s, { random: r, seat: p }), p);
    const lines = s.log.map((e) => e.text);
    let rounds = 0, clashes = 0;
    lines.forEach((t, i) => {
      if (/^— Round \d+ —$/.test(t)) { expect(lines[i + 1]).toMatch(/holds the Lantern\.$/); rounds++; }
      if (t === '— Clash —') clashes++;
    });
    expect(rounds).toBeGreaterThan(3);
    expect(clashes).toBe(rounds + (s.winner === null ? 0 : 1) - (lines.includes('Round limit reached.') ? 1 : 0));
    expect(lines.filter((t) => / wins the Clash with | still stand: |Nobody wins the Clash/.test(t)).length).toBe(clashes);
  }, 60_000);

  it('logs damage from cards and abilities, and hits in the Clash', () => {
    let hurt = 0;
    for (const [s] of decisions(4, ['hui-hai', 'pari', 'domowiki'])) {
      if (s.winner === null) continue;
      const damaged = s.events.filter((e) => e.t === 'damage').length;
      const lines = s.log.filter((e) => / takes \d+( \(Tough \d+\))?\.$/.test(e.text)).length;
      expect(lines).toBeGreaterThanOrEqual(damaged);
      hurt += damaged;
    }
    const s = createGame({ decks: ['hui-hai', 'pari'], seed: 4 });
    const r = rng(9);
    for (let p = nextSeat(s); p !== null; p = nextSeat(s)) apply(s, chooseAction(s, { random: r, seat: p }), p);
    expect(s.log.some((e) => / hits .* for \d+\.$/.test(e.text))).toBe(true);
    void hurt;
  }, 60_000);

  // "The House Snake hits Alux of the Old Stones for 0" read as a bug: the log now says why.
  it('says when Tough took damage off a hit', () => {
    let reduced = 0;
    for (const s of games(6, ['aluxes', 'domowiki', 'hui-hai'])) {
      for (const e of s.log) {
        if (/ for 0\.$| takes 0\.$/.test(e.text)) throw new Error(`no reason given: ${e.text}`);
        if (/ \(Tough \d+\)\.$/.test(e.text)) reduced++;
      }
    }
    expect(reduced).toBeGreaterThan(0);
  }, 60_000);

  // "Kikimora is exhausted" came with no cause: an effect aimed at a lane in the Muster now says what it found there.
  it('names the card and the owner when an effect aimed at a lane finds its unit', () => {
    let found = 0;
    for (const s of games(16, ['domowiki', 'jiaoren', 'pari', 'aluxes', 'hui-hai'])) {
      s.log.forEach((e, i) => {
        if (/'s .+ finds .+'s .+ in lane \d\.$/.test(e.text)) found++;
        if (/ is (exhausted|stunned): it deals no damage/.test(e.text)) {
          expect(s.log[i - 1].text).toMatch(/ finds .+ in lane \d\.$|'s Ambush in lane \d: |uses their ability|exhausts|plays /);
        }
      });
    }
    expect(found).toBeGreaterThan(0);
  }, 60_000);

  // Aluxes against Aluxes: "Night Patrol Alux is exhausted", then "Night Patrol Alux hits Night Patrol Alux" read as an
  // exhausted unit hitting. When both sides have the card, the log says whose unit it is.
  it('names the owner when both sides have a unit of the same card, and whose effect fizzled', () => {
    let owned = 0;
    for (const s of games(4, ['aluxes', 'aluxes'])) {
      for (const e of s.log) {
        const m = /^(.+?) hits (.+?) for \d/.exec(e.text);
        if (m && /^Player \d's /.test(m[1])) owned++;
        if (m) expect(m[1] === m[2] && !/^Player \d's /.test(m[1])).toBe(false);
        if (/ finds nobody in /.test(e.text)) expect(e.text).toMatch(/^Player \d's /);
      }
    }
    expect(owned).toBeGreaterThan(0);
  }, 60_000);

  // The LLM answered "S1" (a shop card) and got choice 1 (a swap), eight times in a round.
  it('reads a number glued to a letter as a lane or shop card, not as the choice', () => {
    const s = createGame({ decks: ['aluxes', 'pari'], seed: 3 });
    const p = nextSeat(s)!;
    const c = listChoices(s, {}, p);
    expect(c.options.length).toBeGreaterThanOrEqual(3);
    expect(parseChoice(s, 'Buy S1 into Y2: choice 3', p)).toEqual({ action: c.options[2].action });
  });

  it("marks the shop cards that can't be bought now, and why", () => {
    const s = createGame({ decks: ['aluxes', 'pari'], seed: 3 });
    const p = nextSeat(s)!;
    s.players[p].offerings = 0;
    const shop = describe(s, p).split('\n').filter((l) => /^ {2}S\d /.test(l));
    expect(shop.length).toBeGreaterThan(0);
    for (const line of shop) expect(line).toMatch(/\[can't buy now: costs \d+, you have 0\]$/);
  });

  it('says when a Rain-Fed gain would be lost, and when an Ambush card is played now', () => {
    const s = createGame({ decks: ['aluxes', 'pari'], seed: 3 });
    const p = s.players.findIndex((x) => x.hero.id === 'AL1-H01') as PlayerId;
    s.players[p].yard.push({ uid: 7001, id: 'AL1-D04', slot: 0, damage: 0, exhausted: false, buffPower: 0, usedOnce: false, counters: { rain: 3 } });
    s.players[p].shop.push({ uid: 7002, id: 'AL1-D18' });
    s.players[p].offerings = 5;
    const labels = listChoices(s, {}, p).options.map((o) => o.label);
    expect(labels.filter((l) => /^Use your Hero's ability/.test(l))).toEqual([expect.stringMatching(/already at Rain-Fed \+3, the most: it gains nothing\)$/)]);
    expect(labels.some((l) => /^Buy A Sweet on the Doorstep and play it now, not as an Ambush, \(cost 1\)/.test(l))).toBe(true);
    expect(labels.some((l) => /^Buy A Sweet on the Doorstep and set it face-down as an Ambush/.test(l))).toBe(true);
  });
});
