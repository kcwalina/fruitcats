import { describe, expect, it } from 'vitest';
import { apply, createGame } from '@fruitcats/engine';
import { replayMs } from '../src/index';

describe('the Muster clock after a Clash', () => {
  // The screen replays the Clash bout by bout before the next Muster: the time to watch it is added to that Muster's
  // clock, so nobody loses their Muster time to the replay.
  it('adds time to watch the Clash just fought, by its bouts, and none before the first', () => {
    const s = createGame({ decks: ['domowiki', 'pari'], seed: 2, firstPlayer: 0 });
    expect(replayMs(s)).toBe(0);
    apply(s, { t: 'ready' }, 0);
    apply(s, { t: 'ready' }, 1);
    const bouts = s.events.filter((e) => e.t === 'bout').length;
    expect(replayMs(s)).toBe(Math.min(45_000, 3_000 + bouts * 3_500));
    expect(replayMs(s)).toBeGreaterThanOrEqual(3_000);
  });
});
