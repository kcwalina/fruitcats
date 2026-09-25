// Where a run's report goes, and the summary every kind of run shares: the dashboard shows these rows.

import { mkdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARDS, DECKS, RULES_VERSION } from './engine';
import { seedFrom } from './rng';

export type RunKind = 'balance-check' | 'balance' | 'llm-playtest' | 'deck-hunt' | 'nightly' | 'llm-compare';
export type Verdict = 'pass' | 'warn' | 'block';

export interface Problem { level: 'warn' | 'block'; text: string }

export interface RunSummary {
  /** `<kind>-<yyyymmdd-hhmmss>`, also the report folder's name. */
  id: string;
  kind: RunKind;
  startedAt: string;
  durationSec: number;
  host: string;
  /** Which cards were tested: a hash of the card data and deck lists, and the engine's rules version. */
  cardsHash: string;
  rulesVersion: number;
  games: number;
  result: Verdict;
  problems: Problem[];
  /** Kind-specific numbers (matchups, card outliers, LLM findings); the dashboard reads these too. */
  details: Record<string, unknown>;
  /** The dashboard request that started this run (`--request <id>`), if one did. */
  request?: string;
}

/** How far a run has got, written to progress.json while it runs; PC2024's paw lists it and the dashboard
 * shows it as a progress bar. */
export interface RunProgress { id: string; kind: RunKind; startedAt: string; phase: string; done: number; total: number; updatedAt: string; request?: string }

const requestArg = (): string | undefined => {
  const i = process.argv.indexOf('--request');
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined;
};

const lastWrite = new Map<string, number>();
/** Records progress, at most every 5 seconds per run (always when a phase completes). */
export function reportProgress(run: { id: string; startedAt: Date; dir: string }, kind: RunKind, phase: string, done: number, total: number): void {
  const now = Date.now();
  if (done < total && now - (lastWrite.get(run.id) ?? 0) < 5000) return;
  lastWrite.set(run.id, now);
  const p: RunProgress = { id: run.id, kind, startedAt: run.startedAt.toISOString(), phase, done, total, updatedAt: new Date(now).toISOString(), request: requestArg() };
  try { writeFileSync(join(run.dir, 'progress.json'), JSON.stringify(p)); } catch { /* progress is a courtesy */ }
}

export const cardsHash = (): string => seedFrom(JSON.stringify([CARDS, DECKS])).toString(16).padStart(8, '0');

/** `PLAYTEST_REPORTS` (PC2024's paw sets it), else `playtest/reports` in this checkout. */
export function reportsRoot(): string {
  if (process.env.PLAYTEST_REPORTS) return resolve(process.env.PLAYTEST_REPORTS);
  return fileURLToPath(new URL('../reports', import.meta.url));
}

export function newRun(kind: RunKind): { id: string; startedAt: Date; dir: string } {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const id = `${kind}-${stamp}`;
  const dir = join(reportsRoot(), id);
  mkdirSync(dir, { recursive: true });
  return { id, startedAt, dir };
}

export function verdictOf(problems: Problem[]): Verdict {
  return problems.some((p) => p.level === 'block') ? 'block' : problems.length ? 'warn' : 'pass';
}

export function finishRun(
  run: { id: string; startedAt: Date; dir: string },
  kind: RunKind,
  games: number,
  problems: Problem[],
  details: Record<string, unknown>,
  markdown: string,
): RunSummary {
  const summary: RunSummary = {
    id: run.id,
    kind,
    startedAt: run.startedAt.toISOString(),
    durationSec: Math.round((Date.now() - run.startedAt.getTime()) / 1000),
    host: hostname(),
    cardsHash: cardsHash(),
    rulesVersion: RULES_VERSION,
    games,
    result: verdictOf(problems),
    problems,
    details,
    request: requestArg(),
  };
  writeFileSync(join(run.dir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(run.dir, 'report.md'), markdown);
  return summary;
}

export const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
