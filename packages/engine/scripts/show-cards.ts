// Print cards' data: npx tsx packages/engine/scripts/show-cards.ts DW1-D18 PR1-D01 ...
import { CARDS, registerSet } from '../src/index';
import { loadContent } from '../../../content';

loadContent(registerSet);

for (const id of process.argv.slice(2)) {
  const c = CARDS[id];
  console.log(id, c.name, c.type, 'cost', c.cost, 'P/H', c.power, c.health, c.family, '|', c.text, '|', JSON.stringify(c.abilities ?? []));
}
