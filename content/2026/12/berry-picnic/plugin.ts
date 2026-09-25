// Berry Picnic's plugin: what its data can't say. It imports only types from the engine, so the engine runs
// without it and the set is the only thing that knows it exists.

import type { Plugin, PluginContext } from '../../../../packages/engine/src/cards';

/**
 * The Gooseberry Goose steals a snack: take 1 from the target's biggest counter (a Crumb, Ripen's ripeness,
 * Heat) and put it on the Goose as a counter of the given name, up to `max`.
 */
function stealCounter(ctx: PluginContext, value: unknown): void {
  const { as, max } = value as { as: string; max: number };
  const from = ctx.unit, to = ctx.self;
  if (!from || !to || from === to) return;
  const [name, n] = Object.entries(from.counters ?? {}).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  if (!name || n <= 0) return;
  from.counters = { ...from.counters, [name]: n - 1 };
  const now = to.counters?.[as] ?? 0;
  if (now >= max) return;
  to.counters = { ...to.counters, [as]: now + 1 };
  ctx.log(`The Goose steals a snack (${name}).`);
}

const plugin: Plugin = {
  id: 'berry-picnic',
  actions: { stealCounter },
  texts: {
    stealCounter: (value, on, self) => `take a counter from ${on} and put it on ${self} as a ${(value as { as: string }).as[0].toUpperCase()}${(value as { as: string }).as.slice(1)}`,
  },
};
export default plugin;
