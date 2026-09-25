// npm run deploy -- [--force-balance] [--dry-run]
//
// The one way to put the game live (fruitcats.viamochi.com, an Azure Static Web App). Each step guards
// against something that has actually shipped broken:
//
//   1. type-check and tests
//   2. the balance check: a starter deck outside the limits stops the deploy (Zest Rush shipped at 14%
//      against Orchard Guard while the simulator already knew)
//   3. the engine the web app builds against is this checkout's (a worktree build once shipped new card
//      images with the main checkout's old card stats)
//   4. build the site, and the playtest runner bundle PC2024 downloads
//   5. the built bundle carries every card's current cost, Power and Health
//   6. upload
//   7. the live site serves this build
//
// --force-balance deploys despite a blocking balance problem (say why in the commit); --dry-run stops
// before the upload.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBalance } from '../balance/gauntlet';
import { flag } from '../lib/args';
import { CARDS } from '../lib/engine';
import { runMain } from '../lib/pool';
import { buildRunner } from './runner-bundle';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'apps/web/dist');
const SITE = 'https://fruitcats.viamochi.com';
const AZURE = { name: 'fruitcats', group: 'mochi-tcg', subscription: '57c8ee32-8d62-47b9-9eec-1c0ef6d0e39f' };

const step = (n: number, text: string) => console.log(`\n── ${n}. ${text}`);
function run(cmd: string, args: string[], opts: { capture?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { cwd: ROOT, shell: true, encoding: 'utf8', stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  // Never echo the deployment token: an error message ends up in logs and transcripts.
  const shown = args.map((a, i) => (args[i - 1] === '--deployment-token' ? '<token>' : a));
  if (r.status !== 0) throw new Error(`${cmd} ${shown.join(' ')} failed (exit ${r.status})`);
  return r.stdout ?? '';
}

/** `@fruitcats/engine` as the web app resolves it must be this checkout's packages/engine. */
function checkEngineResolution(): void {
  const expected = realpathSync(join(ROOT, 'packages/engine/src/index.ts'));
  // Asked of a fresh node process each time: Node caches package lookups, so asking again in this process
  // after linking would repeat the old answer.
  const resolveFromWeb = () => {
    const r = spawnSync(process.execPath, ['-e', "process.stdout.write(require('fs').realpathSync(require.resolve('@fruitcats/engine')))"], { cwd: join(ROOT, 'apps/web/src'), encoding: 'utf8' });
    return r.status === 0 ? r.stdout : null;
  };
  let actual = resolveFromWeb();
  if (actual === expected) { console.log(`   @fruitcats/engine → ${expected}`); return; }
  // A git worktree has no node_modules of its own, so the name resolves up to the main checkout. Link
  // this checkout's engine in, the way npm's workspace link would.
  const link = join(ROOT, 'node_modules/@fruitcats/engine');
  console.log(`   @fruitcats/engine resolved to ${actual ?? 'nothing'}; linking ${link} → packages/engine`);
  mkdirSync(dirname(link), { recursive: true });
  if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) rmSync(link, { recursive: false, force: true });
  symlinkSync(join(ROOT, 'packages/engine'), link, 'junction');
  actual = resolveFromWeb();
  if (actual !== expected) throw new Error(`@fruitcats/engine still resolves to ${actual}, not ${expected}. Refusing to build.`);
  console.log(`   @fruitcats/engine → ${expected}`);
}

/** Every card with a cost appears in the built JavaScript with this checkout's numbers. */
function checkBundle(): string {
  const assets = join(DIST, 'assets');
  const main = readdirSync(assets).find((f) => /^main-.*\.js$/.test(f));
  if (!main) throw new Error('No main-*.js in the build.');
  const js = readFileSync(join(assets, main), 'utf8');
  const wrong: string[] = [];
  for (const c of Object.values(CARDS)) {
    if (c.type === 'Hero Cat' || c.cost === undefined) continue;
    const stats = [`cost:${c.cost}`, c.power !== undefined && `power:${c.power}`, c.health !== undefined && `health:${c.health}`].filter(Boolean).join(',');
    if (!js.includes(`name:\`${c.name}\`,${stats}`) && !js.includes(`name:"${c.name}",${stats}`)) wrong.push(`${c.name} (${stats})`);
  }
  if (wrong.length) throw new Error(`The build does not carry the current stats of ${wrong.length} card(s): ${wrong.slice(0, 5).join('; ')}`);
  console.log(`   ${main}: all ${Object.values(CARDS).filter((c) => c.cost !== undefined).length} cards carry their current stats`);
  return main;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

runMain(async () => {
  step(1, 'Type-check and tests');
  run('npm', ['run', 'typecheck']);
  run('npx', ['vitest', 'run']);

  step(2, 'Balance check');
  const balance = await runBalance({ quick: true, quiet: true });
  for (const p of balance.problems) console.log(`   ${p.level}: ${p.text}`);
  console.log(`   ${balance.result.toUpperCase()} (${balance.games} games, report ${balance.id})`);
  if (balance.result === 'block') {
    if (!flag('force-balance')) throw new Error('A starter deck is outside the balance limits. Fix the cards, or deploy with --force-balance and say why.');
    console.log('   ⚠ --force-balance: deploying despite a blocking balance problem.');
  }

  step(3, 'Engine resolution');
  checkEngineResolution();

  step(4, 'Build');
  run('npm', ['run', 'build']);
  const runner = await buildRunner(join(DIST, 'playtest/runner.mjs'));
  console.log(`   playtest/runner.mjs ${(runner.bytes / 1024).toFixed(0)} KB, sha256 ${runner.sha256.slice(0, 12)}`);

  step(5, 'Bundle check');
  const main = checkBundle();

  if (flag('dry-run')) { console.log('\n--dry-run: stopping before the upload.'); return 0; }

  step(6, 'Upload');
  const token = run('az', ['staticwebapp', 'secrets', 'list', '-n', AZURE.name, '-g', AZURE.group, '--subscription', AZURE.subscription, '--query', 'properties.apiKey', '-o', 'tsv'], { capture: true }).trim();
  if (!token) throw new Error('Could not read the deployment token (az login?).');
  run('npx', ['-y', '@azure/static-web-apps-cli@latest', 'deploy', 'apps/web/dist', '--deployment-token', token, '--env', 'production']);

  step(7, 'Live check');
  for (let attempt = 1; ; attempt++) {
    const html = await fetchText(`${SITE}/?v=${Date.now()}`);
    const live = /main-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
    const liveRunner = createHash('sha256').update(await fetchText(`${SITE}/playtest/runner.mjs?v=${Date.now()}`)).digest('hex');
    if (live === main && liveRunner === runner.sha256) { console.log(`   ${SITE} serves ${main} and the new runner.`); break; }
    if (attempt >= 6) throw new Error(`The live site serves ${live} (expected ${main}) and runner ${liveRunner.slice(0, 12)} (expected ${runner.sha256.slice(0, 12)}).`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('\nDeployed. The iOS home-screen app keeps the old build until it is swiped away and reopened.');
  return 0;
});
