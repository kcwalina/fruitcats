// Make Store codes (store.ts, Codes): a code gives one deck from the Store, without paying, to each account that types
// it in, up to its number of uses. The code is printed once: the tables keep only its hash.
//
//   npm run store-code -w @fruitcats/api -- jiaoren                          one code for the Jiaoren deck, one use
//   npm run store-code -w @fruitcats/api -- jiaoren --uses 20 --note "playtest night"
//   npm run store-code -w @fruitcats/api -- jiaoren --local                  for the local API (npm run api:local)
//
// The deck is named by its key (as in set.json's "decks"). It writes the live tables as Claude's agent identity (its own
// CLI folder, ~/.azure-viamochi-agent); your own `az` login isn't used.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const deck = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!deck) {
  console.error('Which deck? npm run store-code -w @fruitcats/api -- <deck key> [--uses N] [--note "why"] [--local]');
  process.exit(1);
}
if (args.includes('--local')) process.env.LOCAL_DATA ??= fileURLToPath(new URL('../../../.local-api', import.meta.url));
else process.env.AZURE_CONFIG_DIR ??= join(homedir(), '.azure-viamochi-agent');

const { registerSet } = await import('@fruitcats/engine');
const { loadContent } = await import('../../../content');
loadContent(registerSet, { prototypes: true });
const { createCode } = await import('./store');
const { flushLogs } = await import('./logs');

const uses = Number(opt('uses') ?? 1);
const code = await createCode(`deck:${deck}`, { uses, note: opt('note') ?? '' });
await flushLogs();
console.log(`\n  ${code}\n\n  The ${deck} deck, for ${uses === 1 ? 'one account' : `up to ${uses} accounts`}${args.includes('--local') ? ' (local API)' : ''}. Type it in the Store: "Have a code?".\n`);
process.exit(0);
