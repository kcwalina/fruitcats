import { describe as suite, expect, it } from 'vitest';
import { apply, chooseAction, createGame, describe, listChoices, other, parseChoice, type GameState, type PlayerId } from '../src/index';

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** Every decision of a few bot games, with the state it was taken in. */
function* decisions(games: number): Generator<GameState> {
  const keys = ['zest-rush', 'orchard-guard', 'mango-tango'];
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
    const s = createGame({ decks: ['zest-rush', 'orchard-guard'], seed: 1 });
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
      const swap = (c: { id: string }) => { c.id = c.id === 'SB1-G01' ? 'SB1-G03' : 'SB1-G01'; };
      foe.hand.forEach(swap);
      foe.pantry.forEach((tr) => swap(tr.card));
      for (const pl of t.players) { pl.deck.forEach(swap); pl.lives.forEach(swap); }
      expect(describe(t, seat)).toBe(describe(s, seat));
      compared++;
    }
    expect(compared).toBeGreaterThan(100);
  });
});
