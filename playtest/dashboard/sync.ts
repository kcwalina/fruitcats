// reports pending [--pc2024 http://192.168.1.74:5280] | reports mark
// reports start <nightly|balance|llm-playtest|deck-hunt|llm-compare> [--args "…"] [--request <id>] [--pc2024 …]
//
// Gets finished runs ready for the dashboard page (a claude.ai Artifact whose database only its owner
// writes). Scripts can't write there, a Claude session can: `pending` gathers the runs the dashboard hasn't
// seen (this checkout's playtest/reports, plus PC2024's playtester through catsitter's forward route) and
// writes one JSON file per run, ready for an ArtifactData batch of `set` writes into the `runs` collection.
// Runs still going on PC2024 come too, as a row with their progress, and are uploaded again each time
// until they finish. `mark` records the finished ones as uploaded once the batch has gone through. `start`
// asks PC2024's playtester to start a run (the dashboard's "Start a run" requests and runs a Claude session
// starts go through it) and writes the new run's row, so the session that started it uploads it at once.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arg } from '../lib/args';
import { reportsRoot, type RunSummary } from '../lib/runs';
import { dashboardMeta } from './meta';

const STATE = fileURLToPath(new URL('../.state/', import.meta.url));
const OUT = join(STATE, 'upload');
const UPLOADED = join(STATE, 'uploaded.json');
/** A db document holds 256 KiB; the report is the only part that grows. */
const REPORT_LIMIT = 120_000;

interface Run { summary: RunSummary; report: string; live?: boolean }
const FINISHED = join(STATE, 'finished.json');
/** The dashboard's meta/dashboard document: decks, family colors and personas, from this checkout's card data. */
const META = join(STATE, 'meta.json');
const COMMANDS = ['nightly', 'balance', 'llm-playtest', 'deck-hunt', 'llm-compare'];

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

/** PC2024's playtester, through catsitter: POST /api/processes/mochi-playtester/forward {method, path, body}. */
const forwarder = (catsitter: string) => async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`${catsitter}/api/processes/mochi-playtester/forward`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, path, body }), signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`catsitter ${path}: HTTP ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
};

async function pc2024Runs(catsitter: string, skip: Set<string>): Promise<Run[]> {
  const forward = forwarder(catsitter);
  const list = (await forward('GET', '/runs')).runs as { id: string; result: string; progress?: Record<string, unknown> }[];
  const runs: Run[] = [];
  for (const r of list.filter((x) => !skip.has(x.id))) {
    if (r.result === 'running' || r.result === 'abandoned') {
      const p = r.progress ?? {};
      runs.push({
        live: r.result === 'running',
        report: '',
        summary: {
          id: r.id, kind: p.kind as RunSummary['kind'], startedAt: String(p.startedAt), host: 'PC2024', cardsHash: '', rulesVersion: 0,
          durationSec: Math.round((Date.parse(String(p.updatedAt)) - Date.parse(String(p.startedAt))) / 1000) || 0,
          games: 0, result: r.result as RunSummary['result'], problems: [], details: {}, request: p.request as string | undefined,
          progress: { phase: p.phase, done: p.done, total: p.total, updatedAt: p.updatedAt },
        } as RunSummary,
      });
      continue;
    }
    const got = await forward('POST', '/runs/get', { id: r.id });
    if (got.summary) runs.push({ summary: got.summary as RunSummary, report: String(got.report ?? '') });
  }
  return runs;
}

export async function reportsCommand(): Promise<number> {
  const sub = process.argv[3];
  mkdirSync(STATE, { recursive: true });
  if (sub === 'mark') {
    const done = uploaded();
    const finished: string[] = existsSync(FINISHED) ? JSON.parse(readFileSync(FINISHED, 'utf8')) : [];
    for (const id of finished) done.add(id);
    writeFileSync(UPLOADED, JSON.stringify([...done].sort(), null, 1));
    rmSync(OUT, { recursive: true, force: true });
    rmSync(FINISHED, { force: true });
    console.log(`Marked ${finished.length} finished run(s) as uploaded.`);
    return 0;
  }
  if (sub === 'start') {
    const command = process.argv[4];
    if (!COMMANDS.includes(command)) { console.error(`start: command must be one of ${COMMANDS.join(', ')}`); return 1; }
    const request = arg('request');
    const args = [arg('args') ?? '', request ? `--request ${request}` : ''].join(' ').trim();
    const catsitter = (arg('pc2024') ?? 'http://192.168.1.74:5280').replace(/\/$/, '');
    const r = await fetch(`${catsitter}/api/processes/mochi-playtester/forward`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'POST', path: '/run', body: { command, args } }), signal: AbortSignal.timeout(60_000),
    });
    const body = await r.text();
    console.log(body);
    if (!(r.ok && JSON.parse(body).started)) return 2;
    // The dashboard must show a run the moment it starts, not a sync later: wait for the runner to register
    // it on PC2024 and write its row for the same session to upload right away.
    const since = Date.now() - 5_000;
    for (let i = 0; i < 20; i++) {
      await new Promise((ok) => setTimeout(ok, 3_000));
      const live = (await pc2024Runs(catsitter, uploaded()).catch(() => []))
        .find((x) => x.live && Date.parse(x.summary.startedAt) >= since);
      if (!live) continue;
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${live.summary.id}.json`), JSON.stringify(live.summary));
      writeFileSync(META, JSON.stringify(dashboardMeta()));
      console.log(`Upload now: ${join(OUT, `${live.summary.id}.json`)} (collection runs, id ${live.summary.id}); meta in ${META}`);
      return 0;
    }
    console.log('Started, but PC2024 has not listed the run yet; the next sync uploads it.');
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
  writeFileSync(META, JSON.stringify(dashboardMeta()));
  writeFileSync(FINISHED, JSON.stringify(runs.filter((r) => !r.live).map((r) => r.summary.id)));
  for (const r of runs) {
    const report = r.report.length > REPORT_LIMIT ? `${r.report.slice(0, REPORT_LIMIT)}\n\n… (cut; the full report is in the run folder)\n` : r.report;
    writeFileSync(join(OUT, `${r.summary.id}.json`), JSON.stringify({ ...r.summary, report }));
  }
  console.log(`${runs.length} run(s) to upload, one file each, in ${OUT}; the page's deck list in ${META}`);
  for (const r of runs) console.log(`  ${r.summary.id}  ${r.summary.result}  ${r.live ? `${(r.summary as { progress?: { done: number; total: number } }).progress?.done}/${(r.summary as { progress?: { done: number; total: number } }).progress?.total}` : `${r.summary.problems.length} problem(s)`}`);
  return 0;
}
