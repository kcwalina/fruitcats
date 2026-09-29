import { describe as suite, expect, it } from 'vitest';
import { apply, chooseAction, createGame, describe, listChoices, other, parseChoice, type GameState, type PlayerId } from '../src/index';
import TERMS from '../src/terms.json';

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** Every decision of a few bot games, with the state it was taken in. */
function* decisions(games: number): Generator<GameState> {
  const keys = ['domowiki', 'pari', 'aluxes'];
  for (let g = 0; g < games; g++) {
    const s = createGame({ decks: [keys[g % 3], keys[(g + 1) % 3]], seed: 700 + g });
    const r = rng(g + 1);
    while (s.winner === null) {
      yield s;
      apply(s, chooseAction(s, { random: r }));
    }
  }
}

suite('text interface', () => {
  it('numbers every legal action, and every number reads back as that action', () => {
    let checked = 0;
    for (const s of decisions(6)) {
      const c = listChoices(s);
      if (c.multi) {
        const hand = s.players[s.prompt!.player].hand;
        const count = c.multi.count ?? 2;
        const reply = Array.from({ length: count }, (_, i) => `H${i + 1}`).join(' ');
        const parsed = parseChoice(s, reply);
        expect('action' in parsed && parsed.action).toEqual({ t: c.multi.kind, uids: hand.slice(0, count).map((h) => h.uid) });
        if (c.multi.kind === 'mulligan') expect('action' in parseChoice(s, 'none') && parseChoice(s, 'none')).toEqual({ action: { t: 'mulligan', uids: [] } });
        continue;
      }
      expect(c.options.length).toBeGreaterThan(0);
      for (const o of c.options) {
        expect(parseChoice(s, `${o.n}`)).toEqual({ action: o.action });
        expect(o.label.length).toBeGreaterThan(2);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('reads the choice out of a reply that reasons first', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 1 });
    while (s.prompt!.kind !== 'action') apply(s, chooseAction(s, { random: rng(1) }));
    const n = listChoices(s).options.length;
    expect(parseChoice(s, `Round 1 with 2 Treats, so I'll pass.\nAnswer: ${n}`)).toEqual({ action: listChoices(s).options[n - 1].action });
    expect('error' in parseChoice(s, `${n + 5}`)).toBe(true);
    expect('error' in parseChoice(s, 'attack!')).toBe(true);
  });

  it('never shows a player what they may not know', () => {
    // Swap every card the player can't see (the opponent's hand and Treats, both decks, both sets of
    // Lives) for other cards: what the player reads must not change.
    let compared = 0;
    for (const s of decisions(3)) {
      const seat = s.prompt!.player as PlayerId;
      const t = structuredClone(s);
      const foe = t.players[other(seat)];
      const swap = (c: { id: string }) => { c.id = c.id === 'DW1-D16' ? 'PR1-D09' : 'DW1-D16'; };
      foe.hand.forEach(swap);
      foe.pantry.forEach((tr) => swap(tr.card));
      for (const pl of t.players) { pl.deck.forEach(swap); pl.lives.forEach(swap); }
      expect(describe(t, seat)).toBe(describe(s, seat));
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  });
});

suite("the game's words", () => {
  // The Story drawer shows the log and the LLM players read the choices: both said "Life" for a Candle until 2026-09-29.
  it("the log, the questions and the choices use players' words, never the retired ones", () => {
    const retired = [...(TERMS.retired as string[]), 'Life'];
    const decks = ['domowiki', 'pari', 'aluxes', 'jiaoren', 'hui-hai'];
    const seen = new Set<string>();
    for (let g = 0; g < decks.length; g++) {
      const s = createGame({ decks: [decks[g], decks[(g + 1) % decks.length]], seed: 900 + g });
      const r = rng(g + 7);
      while (s.winner === null) {
        const c = listChoices(s);
        seen.add(c.question);
        for (const o of c.options) seen.add(o.label);
        apply(s, chooseAction(s, { random: r }));
      }
      for (const line of s.log) seen.add(line.text);
    }
    const bad = [...seen].filter((t) => retired.some((w) => new RegExp(`\\b${w}\\b`).test(t)));
    expect(bad).toEqual([]);
  });
});

suite('what a play says about arriving', () => {
  // Pari at the Pool ("Company: enters ready") was labelled "arrives exhausted" even when it came in ready.
  it('says a unit arrives ready exactly when it does', () => {
    const decks = ['pari', 'domowiki', 'aluxes', 'jiaoren', 'hui-hai'];
    let checked = 0;
    for (let g = 0; g < 10; g++) {
      const s = createGame({ decks: [decks[g % 5], decks[(g + 2) % 5]], seed: 1300 + g });
      const r = rng(g + 3);
      while (s.winner === null) {
        const seat = s.prompt!.player;
        for (const o of listChoices(s, { detail: true }).options) {
          if (o.action.t !== 'play' || !/ arrives (ready|exhausted)/.test(o.label)) continue;
          const w = structuredClone(s);
          apply(w, o.action);
          while (w.prompt?.kind === 'pounce' && w.prompt.player !== seat) apply(w, { t: 'decline' });
          const unit = w.players[seat].yard.find((u) => u.uid === (o.action as { uid: number }).uid);
          if (!unit) continue;
          expect(o.label.includes(' arrives ready'), o.label).toBe(!unit.exhausted);
          checked++;
        }
        apply(s, chooseAction(s, { random: r }));
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
