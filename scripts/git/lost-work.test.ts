// A merge that resolves a conflict as "take mine" silently drops the other session's work. These build a tiny repo
// with two sessions changing the same file, and check what scripts/git/lost-work.mjs and the pre-push hook say.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lostInRange } from './lost-work.mjs';

const HOOK = fileURLToPath(new URL('./pre-push.mjs', import.meta.url));
let dir: string;

function git(...args: string[]): string {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const write = (text: string) => writeFileSync(join(dir, 'auth.ts'), text);
const commit = (message: string) => { git('add', '-A'); git('commit', '-q', '-m', message); return git('rev-parse', 'HEAD'); };

const BASE = 'export function signIn(user) {\n  return session(user);\n}\n';
// Main gets a security fix while a session changes the same lines.
const FIXED = 'export function signIn(user) {\n  if (!user.verified) throw new Error("not verified");\n  return session(user);\n}\n';
const MINE = 'export function signIn(user) {\n  return session(user, { remember: true });\n}\n';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lost-work-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  write(BASE); commit('base');
  git('checkout', '-q', '-b', 'session');
  write(MINE); commit('remember me');
  git('checkout', '-q', 'main');
  write(FIXED); commit('security fix: only verified users sign in');
  git('checkout', '-q', 'session');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Merges main into the session, resolving the conflict with `resolved`. */
function mergeMain(resolved: string, message = 'Merge main') {
  spawnSync('git', ['merge', 'main'], { cwd: dir });
  write(resolved);
  return commit(message);
}

describe('lost-work', () => {
  it('passes a merge that keeps both sides', () => {
    mergeMain('export function signIn(user) {\n  if (!user.verified) throw new Error("not verified");\n  return session(user, { remember: true });\n}\n');
    expect(lostInRange('main..session', dir).findings).toEqual([]);
  });

  it('catches a merge that took "mine" and dropped the security fix', () => {
    mergeMain(MINE);
    const { findings } = lostInRange('main..session', dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: 'auth.ts', kind: 'lost' });
    expect(findings[0].lines.join('\n')).toContain('not verified');
  });

  it('catches a merge that brought back a line the other side deleted', () => {
    git('checkout', '-q', 'main');
    const LOGGING = 'export function signIn(user) {\n  audit(user.password);\n  return session(user);\n}\n';
    write(LOGGING); commit('audit sign-ins');
    git('checkout', '-q', '-b', 'session2');
    const MINE2 = 'export function signIn(user) {\n  audit(user.password);\n  return session(user, { remember: true });\n}\n';
    write(MINE2); commit('remember me');
    git('checkout', '-q', 'main');
    write(BASE); commit('security fix: never log passwords');
    git('checkout', '-q', 'session2');
    mergeMain(MINE2);
    const { findings } = lostInRange('main..session2', dir);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: 'resurrected', lines: ['  audit(user.password);'] });
  });

  it('lets a merge that says why through', () => {
    mergeMain(MINE, 'Merge main\n\nLost-on-purpose: the check moved to session()');
    const { findings, excused } = lostInRange('main..session', dir);
    expect(findings).toEqual([]);
    expect(excused).toHaveLength(1);
  });

  it('pre-push refuses such a merge on its way to main, and a force push', () => {
    const main = git('rev-parse', 'main');
    const bad = mergeMain(MINE);
    const push = (local: string, remote: string) =>
      spawnSync(process.execPath, [HOOK, 'origin', 'url'], { cwd: dir, input: `refs/heads/session ${local} refs/heads/main ${remote}\n`, encoding: 'utf8' });
    const refused = push(bad, main);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('not verified');
    git('checkout', '-q', '-b', 'stale', 'main~1');
    const force = push(git('rev-parse', 'HEAD'), main);
    expect(force.status).toBe(1);
    expect(force.stderr).toContain('force push');
    expect(push(main, git('rev-parse', 'main~1')).status).toBe(0);
  });
});
