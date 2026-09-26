// npm run deploy -- [--force-balance] [--dry-run]
//
// The one way to put the game live (fruitcats.viamochi.com, an Azure Static Web App). Each step guards
// against something that has actually shipped broken:
//
//   0. one deploy at a time; origin/main merged in, and no merge dropped work another session put on main (sessions
//      kept losing each other's features, and could lose a security fix, to conflicts resolved as "take mine")
//   1. type-check and tests
//   2. the balance check: a starter deck outside the limits stops the deploy (Zest Rush shipped at 14%
//      against Orchard Guard while the simulator already knew)
//   3. the engine the web app builds against is this checkout's (a worktree build once shipped new card
//      images with the main checkout's old card stats)
//   4. build the site, and the playtest runner bundle PC2024 downloads
//   5. the built bundle carries every card's current cost, Power and Health
//   6. push to main, then upload exactly origin/main, and only if it contains the commit the live site runs (deploying
//      before pushing let a second session, without those commits, deploy right over them)
//   7. the live site serves this build
//
// --force-balance deploys despite a blocking balance problem (say why in the commit); --dry-run stops
// before the push and upload.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBalance } from '../balance/gauntlet';
import { flag } from '../lib/args';
import { CARDS } from '../lib/engine';
import { runMain } from '../lib/pool';
import { buildRunner } from './runner-bundle';
import { fetchMain, requireClean, requireLiveInHead, requireOnMain, takeLock } from '../../scripts/git/deploy-guard.mjs';
import { HOW_TO_FIX, describe, lostInRange } from '../../scripts/git/lost-work.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'apps/web/dist');
const SITE = 'https://fruitcats.viamochi.com';
const AZURE = { name: 'fruitcats', group: 'mochi-tcg', subscription: '57c8ee32-8d62-47b9-9eec-1c0ef6d0e39f' };
/** The site's deployment token, saved once by scripts/setup/site-deploy-token.ps1 so deploys need no `az login`. */
const TOKEN_FILE = join(homedir(), '.fruitcats-deploy', 'swa-token');

const step = (n: number, text: string) => console.log(`\n── ${n}. ${text}`);
/**
 * The token for the upload: from the private file when it's there (no Azure sign-in needed), otherwise read with the
 * owner's own `az login`, as before.
 */
function deploymentToken(): string {
  if (existsSync(TOKEN_FILE)) {
    const saved = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (saved) { console.log(`   deployment token from ${TOKEN_FILE}`); return saved; }
  }
  const token = run('az', ['staticwebapp', 'secrets', 'list', '-n', AZURE.name, '-g', AZURE.group, '--subscription', AZURE.subscription, '--query', 'properties.apiKey', '-o', 'tsv'], { capture: true }).trim();
  if (!token) throw new Error('Could not read the deployment token. Run scripts/setup/site-deploy-token.ps1 once (signed in with az login), so deploys stop needing that sign-in.');
  return token;
}

function run(cmd: string, args: string[], opts: { capture?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { cwd: ROOT, shell: true, encoding: 'utf8', stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  // Never echo the deployment token: an error message ends up in logs and transcripts.
  const shown = args.map((a, i) => (args[i - 1] === '--deployment-token' ? '<token>' : a));
  if (r.status !== 0) throw new Error(`${cmd} ${shown.join(' ')} failed (exit ${r.status})`);
  return r.stdout ?? '';
}

/** origin/main is an ancestor of HEAD. */
const hasMain = () => spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD'], { cwd: ROOT }).status === 0;

/**
 * Brings origin/main in (a merge, which the lost-work check can read, not a rebase), and refuses if any merge not on
 * main yet dropped work that's already there.
 */
function integrate(): void {
  // The pre-push hook runs the same check on every push to main, deploy or not.
  run('git', ['config', 'core.hooksPath', '.githooks']);
  fetchMain(ROOT);
  requireClean(ROOT);
  if (!hasMain()) {
    const merged = spawnSync('git', ['merge', '--no-edit', 'origin/main'], { cwd: ROOT, encoding: 'utf8' });
    if (merged.status !== 0) {
      spawnSync('git', ['merge', '--abort'], { cwd: ROOT });
      throw new Error('Merging origin/main has conflicts. Run git merge origin/main yourself and resolve them keeping BOTH '
        + "sides' changes (the other side is work already on main), commit, then deploy again.");
    }
    console.log('   merged origin/main');
  }
  checkNothingLost();
}

function checkNothingLost(): void {
  const { merges, findings } = lostInRange('origin/main..HEAD', ROOT);
  if (findings.length) throw new Error(`${describe(findings, ROOT)}\n\n${HOW_TO_FIX}`);
  const ahead = run('git', ['rev-list', '--count', 'origin/main..HEAD'], { capture: true }).trim();
  console.log(`   has all of origin/main, ${ahead} commit(s) to add; ${merges} merge(s) checked, none dropped work from main`);
}

/** Just before the push: if main moved during the checks, what was checked and built isn't what would go live. */
function stopIfMainMoved(): void {
  fetchMain(ROOT);
  requireClean(ROOT);
  if (!hasMain()) throw new Error('origin/main moved while the checks ran (another session pushed). Nothing was pushed or uploaded: run npm run deploy again.');
  checkNothingLost();
}

/** The commit the live site was built from (`/version.json`, written by every deploy since 2026-09-25). */
async function liveCommit(): Promise<string | null> {
  try {
    const r = await fetch(`${SITE}/version.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    return ((await r.json()) as { commit?: string }).commit ?? null;
  } catch {
    return null;
  }
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

/**
 * Every card with a cost appears in the build with this checkout's numbers: in the game's JavaScript (the sets
 * built into it) or in the card packs the site publishes (/packs/<set>/set.json). Quotes and escapes are dropped
 * before comparing, since the sets can be inlined as objects, JSON strings or JSON files.
 */
function checkBundle(): string {
  const assets = join(DIST, 'assets');
  const scripts = readdirSync(assets).filter((f) => f.endsWith('.js'));
  // The game's entry is the main-*.js index.html loads (other pages have main-*.js entries of their own).
  const main = /assets\/(main-[A-Za-z0-9_-]+\.js)/.exec(readFileSync(join(DIST, 'index.html'), 'utf8'))?.[1];
  if (!main || !scripts.includes(main)) throw new Error('index.html loads no main-*.js from the build.');
  const packs = join(DIST, 'packs');
  const packFiles = existsSync(packs) ? readdirSync(packs).map((d) => join(packs, d, 'set.json')).filter((f) => existsSync(f)) : [];
  const text = [...scripts.map((f) => join(assets, f)), ...packFiles].map((f) => readFileSync(f, 'utf8')).join('\n')
    .replace(/\\u([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[\\"'`\s]/g, '');
  const wrong: string[] = [];
  let checked = 0;
  for (const c of Object.values(CARDS)) {
    if (c.type === 'Hero Cat' || c.cost === undefined || c.token) continue;
    checked++;
    const stats = [`cost:${c.cost}`, c.power !== undefined && `power:${c.power}`, c.health !== undefined && `health:${c.health}`].filter(Boolean).join(',');
    if (!text.includes(`name:${c.name.replace(/[\\"'`\s]/g, '')},${stats}`)) wrong.push(`${c.name} (${stats})`);
  }
  if (wrong.length) throw new Error(`The build does not carry the current stats of ${wrong.length} card(s): ${wrong.slice(0, 5).join('; ')}`);
  console.log(`   ${scripts.length} script(s) and ${packFiles.length} card pack(s): all ${checked} cards carry their current stats`);
  return main;
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

runMain(async () => {
  step(0, 'Up to date with main');
  // Every session's worktree is on this machine: one deploy at a time, or two could each pass the checks below
  // against the same main and the slower one would take the faster one's work off the site.
  const unlock = await takeLock('site');
  try { return await deploy(); } finally { unlock(); }
});

async function deploy(): Promise<number> {
  integrate();

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

  if (flag('dry-run')) { console.log('\n--dry-run: stopping before the push and upload.'); return 0; }

  step(6, 'Push to main, then upload');
  // Pushed first: a deploy of commits main doesn't have yet is overwritten by the next session's deploy from main.
  // The checks above take minutes, so main may have moved meanwhile. The pre-push hook checks the merges once more.
  stopIfMainMoved();
  run('git', ['push', 'origin', 'HEAD:main']);
  const commit = requireOnMain(ROOT);
  requireLiveInHead(await liveCommit(), SITE, ROOT);
  writeFileSync(join(DIST, 'version.json'), JSON.stringify({ commit, time: new Date().toISOString() }));
  const token = deploymentToken();
  run('npx', ['-y', '@azure/static-web-apps-cli@latest', 'deploy', 'apps/web/dist', '--deployment-token', token, '--env', 'production']);

  step(7, 'Live check');
  for (let attempt = 1; ; attempt++) {
    const html = await fetchText(`${SITE}/?v=${Date.now()}`);
    const live = /main-[A-Za-z0-9_-]+\.js/.exec(html)?.[0];
    const liveRunner = createHash('sha256').update(await fetchText(`${SITE}/playtest/runner.mjs?v=${Date.now()}`)).digest('hex');
    const built = await liveCommit();
    if (live === main && liveRunner === runner.sha256 && built === commit) { console.log(`   ${SITE} serves ${main}, the new runner, and commit ${commit.slice(0, 9)}.`); break; }
    if (attempt >= 6) throw new Error(`The live site serves ${live} (expected ${main}), runner ${liveRunner.slice(0, 12)} (expected ${runner.sha256.slice(0, 12)}) and commit ${built?.slice(0, 9)} (expected ${commit.slice(0, 9)}).`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log('\nDeployed and on main. The iOS home-screen app keeps the old build until it is swiped away and reopened.');
  return 0;
}
