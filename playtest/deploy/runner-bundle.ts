// The playtest runner as one JavaScript file: engine, cards and every playtest command. `npm run deploy`
// publishes it next to the game (/playtest/runner.mjs), and PC2024's playtester downloads it at the start of
// each run, so the nightly games always test the cards that are live without redeploying anything there.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildRunner(outfile: string): Promise<{ bytes: number; sha256: string }> {
  const { build } = await import('esbuild');
  mkdirSync(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL('../runner.ts', import.meta.url))],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    legalComments: 'none',
    logLevel: 'warning',
  });
  const bytes = readFileSync(outfile);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
