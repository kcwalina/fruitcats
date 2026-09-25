// write-text: write every card's rules text from its data (content/rules-text.ts) into its set.json.
// Rules text is never written by hand: change a card's keywords or abilities, run this, and the text
// follows. check-set fails if a set's text and data disagree.
//
//   npm run write-text                 # every set
//   npm run write-text -- heat-wave    # one set, by folder name or code (hw1)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardDef } from '../packages/engine/src/types';
import { CONTENT } from './index';
import { heroTexts, suggestText } from './rules-text';

const HERE = dirname(fileURLToPath(import.meta.url));
const which = process.argv.slice(2).find((a) => !a.startsWith('--'));

for (const set of CONTENT.filter((c) => !which || c.folder.endsWith(which) || c.data.set.toLowerCase() === which.toLowerCase())) {
  const file = join(HERE, set.folder, 'set.json');
  const data = JSON.parse(readFileSync(file, 'utf8')) as { cards: CardDef[]; tokens?: CardDef[] };
  let changed = 0;
  for (const card of [...data.cards, ...(data.tokens ?? [])]) {
    if (card.preview) continue;
    if (card.type === 'Hero Cat') {
      const t = heroTexts(card);
      if (card.kitten && card.kitten.text !== t.kitten) { card.kitten.text = t.kitten; changed++; }
      if (card.bigCat && card.bigCat.text !== t.bigCat) { card.bigCat.text = t.bigCat; changed++; }
    } else {
      const t = suggestText(card);
      if ((card.text ?? '') !== t) { card.text = t; changed++; }
    }
  }
  if (changed) writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`${set.data.name}: ${changed ? `${changed} text(s) written` : 'every text already matches its data'}.`);
}
