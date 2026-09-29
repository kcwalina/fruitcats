import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAW_LISTS, drawLists } from './draw-lists';

// The core draws every Folkborn card exactly as its committed draw list says: the same font sizes, line breaks and
// glyph positions, whatever the core is written in. A difference is a change to a card, the layout or the renderer.
// When that change is meant, `npm run draw-lists` writes the lists again, and they are committed with it.

describe('draw lists', () => {
  it('match what the core draws', () => {
    const lists = drawLists();
    const committed = existsSync(DRAW_LISTS) ? readdirSync(DRAW_LISTS).filter((f) => f.endsWith('.txt')).map((f) => f.slice(0, -4)).sort() : [];
    expect(committed, 'The sets with draw lists; run npm run draw-lists if a set was added or removed.').toEqual([...lists.keys()].sort());
    for (const [set, text] of lists) {
      const golden = readFileSync(join(DRAW_LISTS, `${set}.txt`), 'utf8').replace(/\r\n/g, '\n');
      if (golden !== text) {
        const a = golden.split('\n'), b = text.split('\n');
        const at = a.findIndex((line, i) => line !== b[i]);
        const face = a.slice(0, at + 1).reverse().find((line) => line.startsWith('=== ')) ?? '';
        expect.fail(`${set}: the core draws ${face.slice(4) || 'a face'} differently from its draw list, at line ${at + 1}:\n`
          + `  was: ${a[at]?.slice(0, 200)}\n  now: ${b[at]?.slice(0, 200)}\n`
          + 'If the change is meant (a card, the layout or the renderer), run npm run draw-lists and commit the lists with it.');
      }
    }
  }, 120_000);
});
