import { describe, expect, it } from 'vitest';
import { apply, chooseAction, createGame, nextSeat, visibleEvents, type GameEvent, type PlayerId } from '@fruitcats/engine';
import { applyBeat, boardMap, buildReplay, resultLine, summarize, type Replay } from '../src/replay';

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** Every Clash of a bot game, as each player's replay would have it. */
function replays(decks: [string, string], seed: number): Replay[] {
  const s = createGame({ decks, seed });
  const r = rng(seed);
  const out: Replay[] = [];
  let from = 0;
  for (let p = nextSeat(s); p !== null; p = nextSeat(s)) {
    apply(s, chooseAction(s, { random: r, seat: p }), p);
    const seen = visibleEvents(s.events, 0);
    const replay = buildReplay(seen.slice(from) as GameEvent[]);
    if (replay) { out.push(replay); from = seen.length; }
  }
  return out;
}

describe('the Clash, replayed', () => {
  const games = [replays(['domowiki', 'hui-hai'], 3), replays(['pari', 'jiaoren'], 4), replays(['aluxes', 'pari'], 5)].flat();

  it('finds a replay for every Clash of a game', () => {
    expect(games.length).toBeGreaterThan(10);
  });

  // The replay draws each bout from the engine's own board and applies the beats on top. If the beats said anything
  // the engine didn't do, the next bout's board would disagree: the screen would show a fight that didn't happen.
  it('its beats lead from each bout\'s board to the next one: the same damage, the same units down', () => {
    for (const r of games) {
      const boards = [...r.sections.map((x) => x.board), r.end];
      r.sections.forEach((section, i) => {
        const units = boardMap(section.board);
        for (const beat of section.beats) applyBeat(units, beat);
        for (const want of boards[i + 1]) {
          const got = units.get(want.uid);
          expect(got, `round ${r.round}, after section ${i}: unit ${want.id}`).toBeDefined();
          expect([got!.damage, !!got!.down]).toEqual([want.damage, !!want.down]);
        }
      });
    }
  });

  it('adds up: what the units dealt is what the units took, less what Heroes struck and what came from no unit', () => {
    for (const r of games) {
      const sum = summarize(r, 0);
      const dealt = sum.units.reduce((n, u) => n + u.dealt, 0) + sum.heroes[0] + sum.heroes[1];
      const taken = sum.units.reduce((n, u) => n + u.taken, 0);
      expect(dealt).toBeLessThanOrEqual(taken);
      for (const u of sum.units) if (u.fell !== null) expect(u.fell).toBeLessThanOrEqual(r.sections.at(-1)!.bout);
    }
  });

  it('says who won and what it cost, from each side', () => {
    const r = games.find((x) => (x.lost[0] > 0) !== (x.lost[1] > 0))!;
    const loser: PlayerId = r.lost[0] ? 0 : 1;
    expect(resultLine(r, loser)).toMatch(/^You lose the Clash: .* so you lose \d Candles?\.$/);
    expect(resultLine(r, (1 - loser) as PlayerId)).toMatch(/^You win the Clash: .* so they lose \d Candles?\.$/);
  });
});
