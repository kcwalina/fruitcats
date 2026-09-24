// reports pending [--pc2024 http://192.168.1.74:5280] | reports mark
//
// Gets finished runs ready for the dashboard page (a claude.ai Artifact whose database only its owner
// writes). Scripts can't write there, a Claude session can: `pending` gathers the runs the dashboard hasn't
// seen (this checkout's playtest/reports, plus PC2024's playtester through catsitter's forward route) and
// writes one JSON file per run, ready for an ArtifactData batch of `set` writes into the `runs` collection.
// `mark` records them as uploaded once the batch has gone through.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg } from '../lib/args';
import { reportsRoot, type RunSummary } from '../lib/runs';

const STATE = fileURLToPath(new URL('../.state/', import.meta.url));
const OUT = join(STATE, 'upload');
const UPLOADED = join(STATE, 'uploaded.json');
/** A db document holds 256 KiB; the report is the only part that grows. */
const REPORT_LIMIT = 120_000;

interface Run { summary: RunSummary; report: string }

function uploaded(): Set<string> {
  try { return new Set(JSON.parse(readFileSync(UPLOADED, 'utf8')) as string[]); } catch { return new Set(); }
}

function localRuns(): Run[] {
  const root = reportsRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((id) => {
    const s = join(root, id, 'summary.json'), r = join(root, id, 'report.md');
    if (!existsSync(s)) return [];
    return [{ summary: JSON.parse(readFileSync(s, 'utf8')) as RunSummary, report: existsSync(r) ? readFileSync(r, 'utf8') : '' }];
  });
}

/** PC2024's runs, through catsitter: POST /api/processes/mochi-playtester/forward {method, path, body}. */
async function pc2024Runs(catsitter: string, skip: Set<string>): Promise<Run[]> {
  const forward = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${catsitter}/api/processes/mochi-playtester/forward`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, path, body }), signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`catsitter ${path}: HTTP ${r.status}`);
    return r.json() as Promise<Record<string, unknown>>;
  };
  const list = (await forward('GET', '/runs')).runs as { id: string }[];
  const runs: Run[] = [];
  for (const { id } of list.filter((x) => !skip.has(x.id))) {
    const got = await forward('POST', '/runs/get', { id });
    if (got.summary) runs.push({ summary: got.summary as RunSummary, report: String(got.report ?? '') });
  }
  return runs;
}

export async function reportsCommand(): Promise<number> {
  const sub = process.argv[3];
  mkdirSync(STATE, { recursive: true });
  if (sub === 'mark') {
    const done = uploaded();
    const files = existsSync(OUT) ? readdirSync(OUT).filter((f) => f.endsWith('.json')) : [];
    for (const f of files) done.add(f.replace(/\.json$/, ''));
    writeFileSync(UPLOADED, JSON.stringify([...done].sort(), null, 1));
    rmSync(OUT, { recursive: true, force: true });
    console.log(`Marked ${files.length} run(s) as uploaded.`);
    return 0;
  }
  if (sub !== 'pending') { console.error('Usage: reports pending [--pc2024 http://192.168.1.74:5280] | reports mark'); return 1; }

  const done = uploaded();
  const runs = localRuns().filter((r) => !done.has(r.summary.id));
  const pc = arg('pc2024');
  if (pc) {
    try { runs.push(...await pc2024Runs(pc.replace(/\/$/, ''), new Set([...done, ...runs.map((r) => r.summary.id)]))); }
    catch (e) { console.error(`PC2024 not reachable (${(e as Error).message}); uploading this machine's runs only.`); }
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const r of runs) {
    const report = r.report.length > REPORT_LIMIT ? `${r.report.slice(0, REPORT_LIMIT)}\n\n… (cut; the full report is in the run folder)\n` : r.report;
    writeFileSync(join(OUT, `${r.summary.id}.json`), JSON.stringify({ ...r.summary, report }));
  }
  console.log(`${runs.length} run(s) to upload, one file each, in ${OUT}`);
  for (const r of runs) console.log(`  ${r.summary.id}  ${r.summary.result}  ${r.summary.problems.length} problem(s)`);
  return 0;
}
