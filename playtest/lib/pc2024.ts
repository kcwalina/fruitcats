// Reading runs: this machine's own reports folder (on PC2024, the runs themselves), or, from the laptop, PC2024's
// playtester through catsitter on the home network (`--pc2024 http://192.168.1.74:5280`).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { reportsRoot, type RunSummary } from './runs';

/** The finished runs of these kinds in this machine's reports folder. */
export function localSummaries(kinds: string[]): RunSummary[] {
  const root = reportsRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((id) => kinds.some((k) => id.startsWith(`${k}-`))).flatMap((id) => {
    const f = join(root, id, 'summary.json');
    try { return existsSync(f) ? [JSON.parse(readFileSync(f, 'utf8')) as RunSummary] : []; } catch { return []; }
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

/** The finished runs of these kinds on PC2024, with their summaries (deck hunts and deck builds, for the deck library). */
export async function pc2024Summaries(catsitter: string, kinds: string[]): Promise<RunSummary[]> {
  const forward = forwarder(catsitter.replace(/\/$/, ''));
  const list = (await forward('GET', '/runs')).runs as { id: string; kind: string; result: string }[];
  const out: RunSummary[] = [];
  for (const r of list.filter((x) => kinds.includes(x.kind) && x.result !== 'running' && x.result !== 'abandoned')) {
    const got = await forward('POST', '/runs/get', { id: r.id });
    if (got.summary) out.push(got.summary as RunSummary);
  }
  return out;
}
