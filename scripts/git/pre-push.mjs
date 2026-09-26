// Git runs this before every push (.githooks/pre-push; `git config core.hooksPath .githooks` once per clone).
// A push to main must keep everything already on main:
//   - no force push or delete (it would take other sessions' commits off main)
//   - no merge in it may have dropped work other sessions put on main (scripts/git/lost-work.mjs)

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { HOW_TO_FIX, describe, lostInRange } from './lost-work.mjs';

const ZERO = /^0+$/;
const problems = [];
for (const line of readFileSync(0, 'utf8').split('\n').filter(Boolean)) {
  const [, local, remoteRef, remote] = line.split(' ');
  if (remoteRef !== 'refs/heads/main') continue;
  if (ZERO.test(local)) { problems.push('Deleting main is not allowed.'); continue; }
  let from = remote;
  if (!ZERO.test(remote)) {
    const known = spawnSync('git', ['cat-file', '-e', `${remote}^{commit}`]).status === 0;
    if (!known) { problems.push('main moved on the remote since your last fetch: git fetch origin main, merge origin/main, then push.'); continue; }
    if (spawnSync('git', ['merge-base', '--is-ancestor', remote, local]).status !== 0) {
      problems.push('This push would replace main instead of adding to it (a force push takes other sessions\' work off main). Merge origin/main, then push.');
      continue;
    }
  } else {
    from = null;
  }
  const { findings } = lostInRange(from ? `${from}..${local}` : local);
  if (findings.length) problems.push(`${describe(findings)}\n\n${HOW_TO_FIX}`);
}
if (problems.length) {
  console.error(`\nPush to main refused:\n\n${problems.join('\n\n')}\n`);
  process.exit(1);
}
