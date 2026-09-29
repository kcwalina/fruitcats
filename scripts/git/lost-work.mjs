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
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * Objects read in one `git cat-file` call, by `<rev>:<path>` spec: the file's text (`--batch`), or with `check` only its
 * object id (`--batch-check`); null when that commit has no such file. One process instead of one per file: on
 * Windows each git start costs 50-150 ms, and a merge that brings in a busy main touches hundreds of files.
 */
function readObjects(specs, cwd, check = false) {
  const found = new Map();
  if (!specs.length) return found;
  const r = spawnSync('git', ['cat-file', check ? '--batch-check' : '--batch'], { cwd, input: `${specs.join('\n')}\n`, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git cat-file: ${r.stderr.toString().trim()}`);
  const out = r.stdout;
  let at = 0;
  for (const spec of specs) {
    const eol = out.indexOf(10, at);
    const header = out.toString('utf8', at, eol);
    at = eol + 1;
    const m = /^([0-9a-f]+) \S+ (\d+)$/.exec(header);
    if (!m) { found.set(spec, null); continue; }  // "<spec> missing", or a path that isn't a file there
    if (check) { found.set(spec, m[1]); continue; }
    const size = Number(m[2]);
    found.set(spec, out.toString('utf8', at, at + size));
    at += size + 1;
  }
  return found;
}

const trimmedLines = (text) => new Set(text.split('\n').map((l) => l.trim()));

/** What the merge commit `merge` dropped from either parent. */
export function lostInMerge(merge, cwd = process.cwd()) {
  const parents = git(['rev-list', '--parents', '-n', '1', merge], cwd).trim().split(' ').slice(1);
  if (parents.length < 2) return [];
  const [p1, p2] = parents;
  const base = tryGit(['merge-base', p1, p2], cwd)?.trim();
  if (!base) return [];
  const sides = [[p1, changes(base, p1, cwd)], [p2, changes(base, p2, cwd)]];

  // Every file version the checks below read, fetched up front in two git calls.
  const texts = [];
  const ids = [];
  for (const [i, [side, files]] of sides.entries()) {
    for (const [path, change] of files) {
      if (change.binary) {
        if (!sides[1 - i][1].has(path)) ids.push(`${side}:${path}`, `${merge}:${path}`);
        continue;
      }
      texts.push(`${merge}:${path}`);
      if (change.deleted.length) texts.push(`${side}:${path}`);
    }
  }
  const text = readObjects([...new Set(texts)], cwd);
  const id = readObjects([...new Set(ids)], cwd, true);
  const lineSets = new Map();
  const linesOf = (spec) => {
    if (!lineSets.has(spec)) lineSets.set(spec, text.get(spec) == null ? null : trimmedLines(text.get(spec)));
    return lineSets.get(spec);
  };

  const findings = [];
  for (const [i, [side, files]] of sides.entries()) {
    const other = sides[1 - i][1];
    for (const [path, change] of files) {
      if (change.binary) {
        if (other.has(path)) continue; // both sides changed it: which one wins is a real decision
        if (id.get(`${side}:${path}`) !== id.get(`${merge}:${path}`)) findings.push({ merge, side, path, kind: 'binary', lines: [] });
        continue;
      }
      const result = linesOf(`${merge}:${path}`);
      const otherAdded = new Set((other.get(path)?.added ?? []).map((l) => l.trim()));
      const lost = change.added.filter(meaningful).filter((l) => result === null || !result.has(l.trim()));
      // A deleted line only counts as back when the file on that side no longer has it anywhere (so it wasn't
      // just moved) and the other side didn't add it itself.
      const sideLines = change.deleted.length ? (linesOf(`${side}:${path}`) ?? new Set()) : new Set();
      const back = result === null ? [] : change.deleted.filter(meaningful)
        .filter((l) => result.has(l.trim()) && !sideLines.has(l.trim()) && !otherAdded.has(l.trim()));
      if (lost.length) findings.push({ merge, side, path, kind: result === null ? 'file deleted' : 'lost', lines: lost });
      if (back.length) findings.push({ merge, side, path, kind: 'resurrected', lines: back });
    }
  }
  return findings;
}

/**
 * The findings for a merge, remembered in the repository's git folder by the merge's commit id: a commit never changes,
 * so neither does what it dropped. A deploy checks the same merges up to four times (after merging main, in its fresh
 * process, before the push, and in the pre-push hook), and every later deploy of the branch checks them again.
 */
const CACHE_VERSION = 1;
function cachedLostInMerge(merge, cwd) {
  const file = join(git(['rev-parse', '--git-common-dir'], cwd).trim().replace(/^(?![A-Za-z]:|\/)/, `${cwd}/`), 'lost-work-cache.json');
  let cache = {};
  try { cache = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none yet, or unreadable: start over */ }
  if (cache.version !== CACHE_VERSION) cache = { version: CACHE_VERSION, merges: {} };
  const sha = git(['rev-parse', merge], cwd).trim();
  if (!cache.merges[sha]) {
    cache.merges[sha] = lostInMerge(sha, cwd);
    try { writeFileSync(file, JSON.stringify(cache)); } catch { /* read-only: just don't remember */ }
  }
  return cache.merges[sha];
}

/** Findings for every merge in `range` (a `from..to` range or a single merge), skipping merges that say why. */
export function lostInRange(range, cwd = process.cwd()) {
  const merges = range.includes('..')
    ? git(['rev-list', '--merges', range], cwd).split('\n').filter(Boolean)
    : [git(['rev-parse', range], cwd).trim()];
  const findings = [];
  const excused = [];
  for (const merge of merges) {
    const found = cachedLostInMerge(merge, cwd);
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
