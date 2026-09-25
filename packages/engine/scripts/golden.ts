// Golden games: a fixed set of seeded bot games, recorded so that a change to how the engine runs cards
// (not to what the cards do) can be checked to play every game exactly the same.
//
//   npx tsx packages/engine/scripts/golden.ts          # (re)record packages/engine/test/golden.json
//
// Each game is recorded as a hash of its actions, in order, plus the winner and the round it ended in.
// The test (test/golden.test.ts) replays the same seeds and compares.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import '../test/setup';
import { playGolden, GOLDEN_GAMES } from '../test/golden-games';

const out = GOLDEN_GAMES.map((g) => ({ ...g, ...playGolden(g) }));
writeFileSync(new URL('../test/golden.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`recorded ${out.length} games, hash of all: ${createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 12)}`);
