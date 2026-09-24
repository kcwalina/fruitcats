// Runs bot games on every CPU core.
//
// Workers play batches of games and send back their records. Every command's entry goes through
// `runMain`, which sends a worker started from the bundle to `serveWorker` instead of `main`.

import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { playJob, type GameRecord, type MatchJob } from '../balance/match';

const GAMES_PER_TASK = 25;

export function isPoolWorker(): boolean {
  return !isMainThread && (workerData as { role?: string } | null)?.role === 'worker';
}

/** A worker's whole life: play the games it is sent, send back their records. */
export function serveWorker(): void {
  parentPort!.on('message', (task: { id: number; job: MatchJob }) => {
    parentPort!.postMessage({ id: task.id, records: playJob(task.job) });
  });
}

/** The entry of every playtest command: `main` on the main thread, the game loop in a worker. */
export function runMain(main: () => Promise<number | void>): void {
  if (isPoolWorker()) { serveWorker(); return; }
  main().then(
    (code) => { process.exitCode = typeof code === 'number' ? code : 0; },
    (error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; },
  );
}

export interface PoolOptions {
  threads?: number;
  /** Called as games finish: done so far, and the total. */
  progress?: (done: number, total: number) => void;
}

/**
 * Plays every job and returns each job's records, in job order and game order, so a run is the same
 * whether it used one thread or sixteen.
 */
export async function runJobs(jobs: MatchJob[], options: PoolOptions = {}): Promise<GameRecord[][]> {
  const tasks: { id: number; jobIndex: number; job: MatchJob }[] = [];
  jobs.forEach((job, jobIndex) => {
    for (let from = job.from; from < job.to; from += GAMES_PER_TASK) {
      tasks.push({ id: tasks.length, jobIndex, job: { ...job, from, to: Math.min(job.to, from + GAMES_PER_TASK) } });
    }
  });
  const results: GameRecord[][] = new Array(tasks.length);
  const total = jobs.reduce((n, j) => n + j.to - j.from, 0);
  let done = 0;
  const threads = Math.max(1, Math.min(options.threads ?? availableParallelism(), tasks.length));

  if (threads === 1) {
    for (const t of tasks) {
      results[t.id] = playJob(t.job);
      done += t.job.to - t.job.from;
      options.progress?.(done, total);
    }
  } else {
    // From TypeScript a worker starts at worker-entry.ts, through a one-line module that registers tsx
    // first (Node doesn't hand tsx's loader to workers). The bundle is one plain JavaScript file and starts
    // itself: `runMain` sends the copy with `workerData.role = 'worker'` to `serveWorker`.
    const here = fileURLToPath(import.meta.url);
    const entry: string | URL = /\.ts$/.test(here)
      ? new URL(`data:text/javascript,${encodeURIComponent(`import { register } from ${JSON.stringify(import.meta.resolve('tsx/esm/api'))}; register(); await import(${JSON.stringify(new URL('./worker-entry.ts', import.meta.url).href)});`)}`)
      : here;
    let next = 0;
    await Promise.all(Array.from({ length: threads }, () => new Promise<void>((resolve, reject) => {
      const worker = new Worker(entry, { workerData: { role: 'worker' }, argv: [] });
      const feed = () => {
        if (next >= tasks.length) { void worker.terminate(); resolve(); return; }
        const t = tasks[next++];
        worker.postMessage({ id: t.id, job: t.job });
      };
      worker.on('message', (msg: { id: number; records: GameRecord[] }) => {
        results[msg.id] = msg.records;
        done += msg.records.length;
        options.progress?.(done, total);
        feed();
      });
      worker.on('error', reject);
      feed();
    })));
  }

  const byJob: GameRecord[][] = jobs.map(() => []);
  for (const t of tasks) byJob[t.jobIndex].push(...results[t.id]);
  return byJob;
}
