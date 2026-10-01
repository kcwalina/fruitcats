// How fast bots play: 30 seeded games, the first three folk decks. npx tsx packages/engine/scripts/bench.ts
import * as engine from '../src/index';
const e = engine as unknown as Record<string, unknown> & typeof engine;
if (typeof e.registerSet === 'function') {
  const { loadContent } = await import('../../../content/index');
  loadContent(e.registerSet as never, { prototypes: true });
}
function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
const t0 = performance.now();
let actions = 0;
for (let g = 0; g < 30; g++) {
  const decks: [string, string][] = [['domowiki', 'pari'], ['pari', 'aluxes'], ['aluxes', 'domowiki']];
  const s = engine.createGame({ decks: decks[g % 3], seed: 900 + g });
  const random = rng(17 + g);
  for (let p = engine.nextSeat(s); p !== null; p = engine.nextSeat(s)) { engine.apply(s, engine.chooseAction(s, { random, seat: p }), p); actions++; }
}
console.log(`${Math.round(performance.now() - t0)} ms, ${actions} actions`);
