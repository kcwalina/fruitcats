// What every deploy must hold to, so a deploy can never take a live feature (or a security fix) off a live service:
//
//   - one deploy of a service at a time on this machine (every session's worktree is here)
//   - what's deployed is exactly origin/main: pushed first, deployed after. A deploy from a commit that isn't on main
//     yet lets a second session, which doesn't have that commit, deploy right over it.
//   - what's live must already be in the build. A service records the commit it runs; a build that doesn't contain
//     it would take something off.
//
// Used by playtest/deploy/cli.ts (the site) and apps/api/deploy.ps1 (fruitcats-api):
//   node scripts/git/deploy-guard.mjs on-main            fetch; refuse unless HEAD is origin/main, with no changes
//   node scripts/git/deploy-guard.mjs live <commit>      refuse unless <commit> (what's live) is in HEAD
//   node scripts/git/deploy-guard.mjs lock <name> <pid>  take the deploy lock for <name>, held while <pid> runs
//   node scripts/git/deploy-guard.mjs unlock <name>

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const LOCKS = join(homedir(), '.fruitcats-deploy');

function git(args, opts = {}) {
  const r = spawnSync('git', args, { cwd: opts.cwd, encoding: 'utf8' });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr ?? '').trim()}`);
  return r.status === 0 ? r.stdout.trim() : null;
}

export function fetchMain(cwd) {
  git(['fetch', '--quiet', 'origin', 'main'], { cwd });
}

export function requireClean(cwd) {
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], { cwd });
  if (dirty) throw new Error(`Uncommitted changes:\n${dirty}\nCommit them first, so what's live is a commit on main.`);
}

export const head = (cwd) => git(['rev-parse', 'HEAD'], { cwd });

export function isAncestor(older, newer, cwd) {
  return spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd }).status === 0;
}

/** HEAD is exactly origin/main (freshly fetched) and nothing is uncommitted. */
export function requireOnMain(cwd) {
  fetchMain(cwd);
  requireClean(cwd);
  const here = head(cwd);
  const main = git(['rev-parse', 'origin/main'], { cwd });
  if (here === main) return here;
  if (isAncestor(here, main, cwd)) {
    throw new Error(`origin/main has moved past this checkout. Merge origin/main (git merge origin/main), then deploy again.`);
  }
  if (isAncestor(main, here, cwd)) {
    throw new Error('This checkout has commits that are not on origin/main yet. Push them first (git push origin HEAD:main), '
      + 'then deploy: a deploy of commits main doesn\'t have is overwritten by the next session\'s deploy.');
  }
  throw new Error('This checkout and origin/main have both moved. Merge origin/main, push to main, then deploy.');
}

/** What's live (`commit`) is in HEAD. Unknown or missing means the service predates these records. */
export function requireLiveInHead(commit, what, cwd) {
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) {
    console.log(`   ${what} doesn't say which commit it runs (deployed before that was recorded)`);
    return;
  }
  if (git(['cat-file', '-e', `${commit}^{commit}`], { cwd, allowFail: true }) === null) {
    throw new Error(`${what} runs commit ${commit.slice(0, 9)}, which isn't on origin/main: someone deployed work that was never pushed. `
      + 'Find that session and push its work to main (or check what it is), then deploy again. Deploying now would take it off.');
  }
  if (!isAncestor(commit, 'HEAD', cwd)) {
    const newer = git(['log', '--oneline', `HEAD..${commit}`], { cwd }).split('\n');
    throw new Error(`${what} runs ${commit.slice(0, 9)}, which has ${newer.length} commit(s) this build doesn't, for example:\n   `
      + `${newer.slice(0, 5).join('\n   ')}\nDeploying now would take them off. Merge origin/main, then deploy again.`);
  }
  console.log(`   ${what} runs ${commit.slice(0, 9)}, which this build contains`);
}

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

/**
 * Takes the machine-wide deploy lock for `name`, waiting up to `waitMinutes` for another session's deploy to finish.
 * The lock belongs to `pid` (this process unless given): a lock whose process is gone is taken over.
 */
export async function takeLock(name, { pid = process.pid, waitMinutes = 20 } = {}) {
  mkdirSync(LOCKS, { recursive: true });
  const file = join(LOCKS, `${name}.lock`);
  const until = Date.now() + waitMinutes * 60_000;
  let told = false;
  for (;;) {
    try {
      writeFileSync(file, JSON.stringify({ pid, checkout: process.cwd(), since: new Date().toISOString() }), { flag: 'wx' });
      return () => { try { if (JSON.parse(readFileSync(file, 'utf8')).pid === pid) rmSync(file); } catch { /* already gone */ } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let holder = null;
    try { holder = JSON.parse(readFileSync(file, 'utf8')); } catch { /* being written, or unreadable */ }
    if (holder && !alive(holder.pid)) { rmSync(file, { force: true }); continue; }
    if (Date.now() > until) throw new Error(`Another ${name} deploy is still running (${holder?.checkout ?? 'unknown checkout'}, since ${holder?.since ?? '?'}). Try again when it's done.`);
    if (!told) { console.log(`   waiting for another ${name} deploy to finish (${holder?.checkout ?? '?'}, since ${holder?.since ?? '?'})`); told = true; }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

export function releaseLock(name) {
  rmSync(join(LOCKS, `${name}.lock`), { force: true });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'on-main') console.log(`   deploying origin/main ${requireOnMain().slice(0, 9)}`);
    else if (cmd === 'live') requireLiveInHead(a, b ?? 'The live service');
    else if (cmd === 'lock') await takeLock(a, { pid: Number(b) });
    else if (cmd === 'unlock') releaseLock(a);
    else throw new Error('usage: deploy-guard.mjs on-main | live <commit> [what] | lock <name> <pid> | unlock <name>');
  } catch (e) {
    console.error(`\n${e.message}\n`);
    process.exit(1);
  }
}
