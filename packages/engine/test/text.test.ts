import { describe as suite, expect, it } from 'vitest';
import {
  apply, chooseAction, createGame, describe, listChoices, nextSeat, other, parseChoice, rulesPrimer, type GameState, type PlayerId,
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
  });

  it('logs damage from cards and abilities, and hits in the Clash', () => {
    let hurt = 0;
    for (const [s] of decisions(4, ['hui-hai', 'pari', 'domowiki'])) {
      if (s.winner === null) continue;
      const damaged = s.events.filter((e) => e.t === 'damage').length;
      const lines = s.log.filter((e) => / takes \d+\.$/.test(e.text)).length;
      expect(lines).toBeGreaterThanOrEqual(damaged);
      hurt += damaged;
    }
    const s = createGame({ decks: ['hui-hai', 'pari'], seed: 4 });
    const r = rng(9);
    for (let p = nextSeat(s); p !== null; p = nextSeat(s)) apply(s, chooseAction(s, { random: r, seat: p }), p);
    expect(s.log.some((e) => / hits .* for \d+\.$/.test(e.text))).toBe(true);
    void hurt;
  }, 60_000);
});
