// Find a seed whose game fits script.json: every scripted move is possible when its beat comes up,
// and every `expect` holds. Plays the whole script in Node (no browser), with the same seeded deal
// and the same seeded AI the dev page uses for ?seed=N.
//
//   npx tsx tools/demo/find-seed.mjs            # search seeds 1..20000 against script.json's decks
//   npx tsx tools/demo/find-seed.mjs 42         # replay seed 42 and print every move
//
// Put the seed you like into script.json ("seed"), then record.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScriptError, direct, dryDriver } from './director.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const script = JSON.parse(readFileSync(join(HERE, 'script.json'), 'utf8'));

async function tryScript(seed, verbose) {
  const s = { ...script, seed };
  const log = verbose ? (line) => console.log(line) : () => {};
  const driver = dryDriver(s, log);
  const beatLogger = verbose ? { beginBeat: (b) => console.log(`${b.id}`) } : {};
  try {
    await direct(s, { ...driver, ...beatLogger, get game() { return driver.game; } });
    return { ok: true };
  } catch (error) {
    if (!(error instanceof ScriptError)) throw error;
    return { ok: false, why: error.message };
  }
}

const only = process.argv[2];
if (only) {
  const result = await tryScript(Number(only), true);
  console.log(result.ok ? `\nseed ${only} fits the script` : `\nseed ${only} fails: ${result.why}`);
} else {
  const found = [];
  const reasons = new Map();
  for (let seed = 1; seed <= 20000 && found.length < 10; seed++) {
    const result = await tryScript(seed, false);
    if (result.ok) { found.push(seed); console.log(`seed ${seed} fits`); continue; }
    const why = result.why.replace(/\d+/g, '#');
    reasons.set(why, (reasons.get(why) ?? 0) + 1);
  }
  console.log(`\n${found.length} seeds fit: ${found.join(', ') || 'none'}`);
  console.log('\nmost common reasons a seed failed:');
  for (const [why, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(5)}  ${why}`);
}
