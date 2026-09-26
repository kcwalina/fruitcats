// Finds work a merge dropped. When two sessions change the code in parallel and one merges the other's work in,
// resolving a conflict by taking "my side" silently deletes the other session's lines: a feature, or a security fix,
// disappears while git history says it went in. Checked for every merge commit in a range:
//
//   - lost:        a line one side added that the merge result no longer has
//   - resurrected: a line one side deleted that the merge result has again (and the other side never added)
//   - binary:      a binary file only one side changed that the merge didn't take from that side
//
// A line added on one side cannot have been removed on purpose by the other side (it didn't exist there), so every
// finding is either a conflict resolution that dropped work, or a deliberate change made inside the merge. Deliberate
// changes belong in their own commit after the merge; when that's truly impossible, the merge commit's message says so
// with a line "Lost-on-purpose: <why>".
//
//   node scripts/git/lost-work.mjs <from>..<to>     check the merges in that range (exit 1 when something was lost)
//   node scripts/git/lost-work.mjs <merge-commit>   check one merge

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout;
}

function tryGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30 });
  return r.status === 0 ? r.stdout : null;
}

/** Per file: the lines added and deleted between two commits, and the files git calls binary. */
function changes(from, to, cwd) {
  const out = git(['diff', '--no-renames', '--no-color', '--no-ext-diff', '-U0', from, to], cwd);
  const files = new Map();
  let file = null;
  let oldPath = null;
  const entry = (path) => {
    if (!files.has(path)) files.set(path, { added: [], deleted: [], binary: false });
    return files.get(path);
  };
  for (const line of out.split('\n')) {
    if (line.startsWith('diff --git ')) { file = null; oldPath = null; continue; }
    if (line.startsWith('--- ')) { oldPath = line.slice(4) === '/dev/null' ? null : line.slice(6); continue; }
    if (line.startsWith('+++ ')) { file = line.slice(4) === '/dev/null' ? oldPath : line.slice(6); entry(file); continue; }
    const binary = /^Binary files (?:a\/(.+?)|\/dev\/null) and (?:b\/(.+?)|\/dev\/null) differ$/.exec(line);
    if (binary) { entry(binary[2] ?? binary[1]).binary = true; continue; }
    if (!file || line.startsWith('@@')) continue;
    if (line.startsWith('+')) entry(file).added.push(line.slice(1));
    else if (line.startsWith('-')) entry(file).deleted.push(line.slice(1));
  }
  return files;
}

const meaningful = (line) => line.trim().length > 0;

/** What the merge commit `merge` dropped from either parent. */
export function lostInMerge(merge, cwd = process.cwd()) {
  const parents = git(['rev-list', '--parents', '-n', '1', merge], cwd).trim().split(' ').slice(1);
  if (parents.length < 2) return [];
  const [p1, p2] = parents;
  const base = tryGit(['merge-base', p1, p2], cwd)?.trim();
  if (!base) return [];
  const sides = [[p1, changes(base, p1, cwd)], [p2, changes(base, p2, cwd)]];
  const findings = [];
  const contents = new Map();
  const linesAt = (path) => {
    if (!contents.has(path)) {
      const text = tryGit(['show', `${merge}:${path}`], cwd);
      contents.set(path, text === null ? null : new Set(text.split('\n').map((l) => l.trim())));
    }
    return contents.get(path);
  };
  for (const [i, [side, files]] of sides.entries()) {
    const other = sides[1 - i][1];
    for (const [path, change] of files) {
      if (change.binary) {
        if (other.has(path)) continue; // both sides changed it: which one wins is a real decision
        const inSide = tryGit(['rev-parse', `${side}:${path}`], cwd)?.trim() ?? null;
        const inMerge = tryGit(['rev-parse', `${merge}:${path}`], cwd)?.trim() ?? null;
        if (inSide !== inMerge) findings.push({ merge, side, path, kind: 'binary', lines: [] });
        continue;
      }
      const result = linesAt(path);
      const otherAdded = new Set((other.get(path)?.added ?? []).map((l) => l.trim()));
      const lost = change.added.filter(meaningful).filter((l) => result === null || !result.has(l.trim()));
      // A deleted line only counts as back when the file on that side no longer has it anywhere (so it wasn't
      // just moved) and the other side didn't add it itself.
      const sideLines = change.deleted.length ? new Set((tryGit(['show', `${side}:${path}`], cwd) ?? '').split('\n').map((l) => l.trim())) : new Set();
      const back = result === null ? [] : change.deleted.filter(meaningful)
        .filter((l) => result.has(l.trim()) && !sideLines.has(l.trim()) && !otherAdded.has(l.trim()));
      if (lost.length) findings.push({ merge, side, path, kind: result === null ? 'file deleted' : 'lost', lines: lost });
      if (back.length) findings.push({ merge, side, path, kind: 'resurrected', lines: back });
    }
  }
  return findings;
}

/** Findings for every merge in `range` (a `from..to` range or a single merge), skipping merges that say why. */
export function lostInRange(range, cwd = process.cwd()) {
  const merges = range.includes('..')
    ? git(['rev-list', '--merges', range], cwd).split('\n').filter(Boolean)
    : [git(['rev-parse', range], cwd).trim()];
  const findings = [];
  const excused = [];
  for (const merge of merges) {
    const found = lostInMerge(merge, cwd);
    if (!found.length) continue;
    const reason = /^Lost-on-purpose:\s*(.+)$/m.exec(git(['log', '-1', '--format=%B', merge], cwd))?.[1];
    if (reason) excused.push({ merge, reason, count: found.length });
    else findings.push(...found);
  }
  return { merges: merges.length, findings, excused };
}

/** A report a person or an agent can act on. */
export function describe(findings, cwd = process.cwd()) {
  const subject = new Map();
  const title = (c) => {
    if (!subject.has(c)) subject.set(c, git(['log', '-1', '--format=%h %s', c], cwd).trim());
    return subject.get(c);
  };
  const out = [];
  let lastMerge = null;
  for (const f of findings) {
    if (f.merge !== lastMerge) { out.push(`merge ${title(f.merge)}`); lastMerge = f.merge; }
    const what = { lost: 'dropped lines added by', resurrected: 'brought back lines deleted by', binary: "didn't take the binary file from", 'file deleted': 'deleted a file changed by' }[f.kind];
    out.push(`  ${f.path}: ${what} ${title(f.side)}`);
    for (const l of f.lines.slice(0, 6)) out.push(`      ${l.trim().slice(0, 140)}`);
    if (f.lines.length > 6) out.push(`      … and ${f.lines.length - 6} more line(s)`);
  }
  return out.join('\n');
}

export const HOW_TO_FIX = [
  'A merge dropped work another session had already put on main (a lost feature or security fix).',
  'Restore it: redo the merge keeping both sides (git reset --hard <the merge>^1, then git merge origin/main again),',
  'or add the lost lines back in a new commit. If you changed that code on purpose, make the change in its own',
  'commit after the merge. Only if that is impossible, add a line "Lost-on-purpose: <why>" to the merge message.',
].join('\n');

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const range = process.argv[2];
  if (!range) { console.error('usage: node scripts/git/lost-work.mjs <from>..<to> | <merge>'); process.exit(2); }
  const { merges, findings, excused } = lostInRange(range);
  for (const e of excused) console.log(`${e.merge.slice(0, 9)}: ${e.count} change(s) dropped on purpose: ${e.reason}`);
  if (!findings.length) { console.log(`${merges} merge(s) checked: nothing lost.`); process.exit(0); }
  console.log(describe(findings));
  console.log(`\n${HOW_TO_FIX}`);
  process.exit(1);
}
