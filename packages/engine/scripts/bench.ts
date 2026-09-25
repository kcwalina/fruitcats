// How fast bots play: 30 seeded games, Starter Box decks. npx tsx packages/engine/scripts/bench.ts
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
  const decks: [string, string][] = [['zest-rush', 'orchard-guard'], ['orchard-guard', 'mango-tango'], ['mango-tango', 'zest-rush']];
  const s = engine.createGame({ decks: decks[g % 3], seed: 900 + g });
  const random = rng(17 + g);
  while (s.winner === null) { engine.apply(s, engine.chooseAction(s, { random })); actions++; }
}
console.log(`${Math.round(performance.now() - t0)} ms, ${actions} actions`);
