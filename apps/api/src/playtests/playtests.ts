// The playtest dashboard's server side (docs/playtests.md). Two kinds of callers:
//
//   the owner  (a Via Mochi account listed in PLAYTEST_OWNERS) reads everything on fruitcats.viamochi.com/playtests.html
//              and queues runs;
//   a runner   (PC2024's playtester, with its runner key) reports its runs as they go and picks up queued runs.
//
// PC2024 only ever calls out to this API; nothing here calls PC2024. When it's off, the page still works and new
// requests wait until it asks for work again.
//
//   GET    /v1/playtests                        owner   runs (newest 300, without reports), requests, meta, ops, runner
//   GET    /v1/playtests/runs/{id}              owner   one run with its report
//   POST   /v1/playtests/requests               owner   { command, args, label, name? } → the queued request
//   DELETE /v1/playtests/requests/{id}          owner   cancel a request that hasn't started
//   POST   /v1/playtests/runner/poll            runner  { busy, running?, version? } → { request | null }: the oldest
//                                                       queued request, now "starting", when the runner is free
//   POST   /v1/playtests/runner/requests/{id}   runner  { status: started | failed | queued, note?, run? }
//   PUT    /v1/playtests/runs/{id}              runner  a run's summary (and report), sent while it runs and when it ends
//   PUT    /v1/playtests/meta                   runner  decks, families, personas, library and Hero Cats, from the runner
//   PUT    /v1/playtests/library                runner  the deck library after PC2024's library night
//   GET    /v1/playtests/library                anyone  the deck library every runner reads (server.ts answers it)
//   GET    /v1/playtests/runner/keys            runner  the paid LLM provider keys deck builds use (FIREWORKS_API_KEY)

import type { Docs } from './docs';

export type Caller = { kind: 'owner' } | { kind: 'runner'; name: string } | null;
type Answer = [number, unknown];

export const COMMANDS = ['nightly', 'balance', 'llm-playtest', 'deck-hunt', 'deck-build', 'llm-compare'] as const;
/** What the playtester accepts as runner arguments (playtest/paw/PlaytesterServer.cs, SafeArgs). */
const SAFE_ARGS = /^[A-Za-z0-9 .,-]*$/;
const RUN_ID = /^[a-z-]+-\d{8}-\d{6}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RESULTS = new Set(['pass', 'warn', 'block', 'running', 'abandoned']);
/** A request handed to the runner that it never confirmed goes back in the queue after this long. */
const STARTING_TIMEOUT_MS = 10 * 60_000;
const MAX_TRIES = 3;
/** Finished requests are deleted after this long; runs are never deleted. */
const REQUEST_KEEP_MS = 14 * 86_400_000;
const REPORT_LIMIT = 200_000;

export interface PlaytestRequest {
  id: string; command: string; args: string; label: string; name?: string;
  status: 'queued' | 'starting' | 'started' | 'failed';
  createdAt: string; startedAt?: string; note?: string; tries?: number; run?: string;
}

/** A run as the page lists it: the summary every kind of run shares (playtest/lib/runs.ts), without the report. */
export type RunDoc = { id: string; startedAt: string; result: string; request?: string; name?: string } & Record<string, unknown>;

export interface RunnerState { name: string; lastSeen: string; busy: boolean; running?: unknown; version?: string }

export interface PlaytestOptions {
  docs: Docs;
  /** Where the deck library was published before the API kept it, read until PC2024 first sends one. */
  libraryFallback?: () => Promise<unknown>;
  /** Provider keys handed to the runner for deck builds; only the ones that are set. */
  keys?: () => Record<string, string>;
  log?: (event: string, fields: Record<string, unknown>) => void;
  now?: () => number;
}

/** Why a request can't be run, or null: the same rules the old relay applied (paid models capped, arguments plain). */
export function requestProblem(command: unknown, args: unknown): string | null {
  if (typeof command !== 'string' || !(COMMANDS as readonly string[]).includes(command)) return `The run must be one of ${COMMANDS.join(', ')}.`;
  if (typeof args !== 'string' || args.length > 600 || !SAFE_ARGS.test(args)) return 'Arguments may only hold letters, digits, spaces, dots, commas and dashes.';
  const words = args.split(' ').filter(Boolean);
  const value = (flag: string) => { const i = words.indexOf(flag); return i >= 0 ? words[i + 1] : undefined; };
  const provider = value('--provider');
  if (command === 'deck-build' || command === 'deck-hunt') {
    if (provider !== 'fireworks-k3') return 'Deck builds and deck hunts use Kimi K3: --provider fireworks-k3.';
    if (command === 'deck-build' && !(Number(value('--max-usd')) > 0 && Number(value('--max-usd')) <= 1)) return 'A deck build needs --max-usd of at most 1.';
  } else if (provider && provider !== 'pc2024') {
    return 'Playtests use PC2024’s own model (--provider pc2024), never a paid one.';
  }
  return null;
}

export function playtests(opt: PlaytestOptions) {
  const { docs } = opt;
  const now = opt.now ?? Date.now;
  const log = opt.log ?? (() => {});
  const iso = () => new Date(now()).toISOString();

  // Everything but the reports is small, so it's kept in memory and written through. One instance serves the API.
  let state: Promise<{ runs: Map<string, RunDoc>; requests: Map<string, PlaytestRequest> }> | null = null;
  const load = () => (state ??= (async () => {
    const runs = new Map<string, RunDoc>(), requests = new Map<string, PlaytestRequest>();
    const read = async <T>(names: string[], into: Map<string, T>) => {
      for (const name of names) { const doc = await docs.get<T & { id: string }>(name); if (doc?.id) into.set(doc.id, doc); }
    };
    await Promise.all([read(await docs.list('runs/'), runs), read(await docs.list('requests/'), requests)]);
    return { runs, requests };
  })().catch((e) => { state = null; throw e; }));
  let runner: RunnerState | null = null;
  let lastCleanup = 0;

  // Writes one at a time, so two calls can't both claim the same request.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = queue.then(work); queue = next.catch(() => {}); return next; };

  const saveRequest = async (requests: Map<string, PlaytestRequest>, q: PlaytestRequest) => {
    requests.set(q.id, q);
    await docs.put(`requests/${q.id}.json`, q);
  };

  /** Requests the runner took but never confirmed go back in the queue; old finished ones are deleted. */
  async function tidy(requests: Map<string, PlaytestRequest>) {
    for (const q of requests.values()) {
      if (q.status !== 'starting' || now() - Date.parse(q.startedAt ?? q.createdAt) < STARTING_TIMEOUT_MS) continue;
      const tries = (q.tries ?? 0) + 1;
      await saveRequest(requests, tries >= MAX_TRIES
        ? { ...q, status: 'failed', tries, note: 'PC2024 took it but never started it, three times.' }
        : { ...q, status: 'queued', tries, note: 'PC2024 took it but didn’t start it; it will try again.' });
    }
    if (now() - lastCleanup < 3_600_000) return;
    lastCleanup = now();
    for (const q of [...requests.values()]) {
      if (q.status === 'queued' || q.status === 'starting' || now() - Date.parse(q.createdAt) < REQUEST_KEEP_MS) continue;
      requests.delete(q.id);
      await docs.remove(`requests/${q.id}.json`);
    }
  }

  const newest = <T>(list: T[], key: (x: T) => string, n: number) => list.sort((a, b) => key(b).localeCompare(key(a))).slice(0, n);

  async function forOwner(method: string, path: string, body: () => Promise<unknown>): Promise<Answer> {
    const { runs, requests } = await load();
    if (method === 'GET' && path === '/v1/playtests') {
      const [meta, ops] = await Promise.all([docs.get('meta.json'), docs.get('ops.json')]);
      return [200, {
        runs: newest([...runs.values()], (r) => r.startedAt, 300),
        requests: newest([...requests.values()], (q) => q.createdAt, 40),
        meta, ops, runner,
      }];
    }
    const run = /^\/v1\/playtests\/runs\/([^/]+)$/.exec(path);
    if (method === 'GET' && run) {
      const summary = runs.get(run[1]);
      if (!summary) return [404, { error: 'no_such_run' }];
      const report = await docs.get<{ report: string }>(`reports/${run[1]}.json`);
      return [200, { ...summary, report: report?.report ?? '' }];
    }
    if (method === 'POST' && path === '/v1/playtests/requests') {
      const b = (await body()) as { command?: unknown; args?: unknown; label?: unknown; name?: unknown };
      const problem = requestProblem(b.command, b.args);
      if (problem) return [400, { error: 'bad_request', message: problem }];
      const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
      return serial(async () => {
        const id = `req-${now()}`;
        const q: PlaytestRequest = {
          id, command: b.command as string, args: (b.args as string).trim(), label: typeof b.label === 'string' ? b.label.slice(0, 200) : String(b.command),
          ...(name ? { name } : {}), status: 'queued', createdAt: iso(),
        };
        await saveRequest(requests, q);
        log('playtests.request_queued', { request: id, command: q.command });
        return [200, q] as Answer;
      });
    }
    const cancel = /^\/v1\/playtests\/requests\/([^/]+)$/.exec(path);
    if (method === 'DELETE' && cancel) {
      return serial(async () => {
        const q = requests.get(cancel[1]);
        if (!q) return [404, { error: 'no_such_request' }] as Answer;
        if (q.status !== 'queued' && q.status !== 'failed') return [409, { error: 'already_started' }] as Answer;
        requests.delete(q.id);
        await docs.remove(`requests/${q.id}.json`);
        return [200, { deleted: true }] as Answer;
      });
    }
    return [404, { error: 'not_found' }];
  }

  async function forRunner(name: string, method: string, path: string, body: () => Promise<unknown>): Promise<Answer> {
    const { runs, requests } = await load();
    if (method === 'POST' && path === '/v1/playtests/runner/poll') {
      const b = (await body()) as { busy?: unknown; running?: unknown; version?: unknown };
      const busy = b.busy === true;
      runner = { name, lastSeen: iso(), busy, ...(b.running ? { running: b.running } : {}), ...(typeof b.version === 'string' ? { version: b.version.slice(0, 40) } : {}) };
      return serial(async () => {
        await tidy(requests);
        if (busy) return [200, { request: null }] as Answer;
        const next = [...requests.values()].filter((q) => q.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        if (!next) return [200, { request: null }] as Answer;
        // Checked again here: a request is data from a web page, and the runner runs what it's given.
        const problem = requestProblem(next.command, next.args);
        if (problem) {
          await saveRequest(requests, { ...next, status: 'failed', note: problem });
          return [200, { request: null }] as Answer;
        }
        const claimed: PlaytestRequest = { ...next, status: 'starting', startedAt: iso(), note: 'Starting on PC2024.' };
        await saveRequest(requests, claimed);
        log('playtests.request_claimed', { request: claimed.id, runner: name });
        return [200, { request: claimed }] as Answer;
      });
    }
    const update = /^\/v1\/playtests\/runner\/requests\/([^/]+)$/.exec(path);
    if (method === 'POST' && update) {
      const b = (await body()) as { status?: unknown; note?: unknown; run?: unknown };
      if (b.status !== 'started' && b.status !== 'failed' && b.status !== 'queued') return [400, { error: 'bad_status' }];
      return serial(async () => {
        const q = requests.get(update[1]);
        if (!q) return [404, { error: 'no_such_request' }] as Answer;
        const note = typeof b.note === 'string' ? b.note.slice(0, 300) : undefined;
        await saveRequest(requests, {
          ...q, status: b.status as PlaytestRequest['status'], ...(note !== undefined ? { note } : {}),
          ...(b.status === 'started' ? { startedAt: iso() } : {}),
          ...(typeof b.run === 'string' && RUN_ID.test(b.run) ? { run: b.run } : {}),
        });
        return [200, { ok: true }] as Answer;
      });
    }
    const run = /^\/v1\/playtests\/runs\/([^/]+)$/.exec(path);
    if (method === 'PUT' && run) {
      const id = run[1];
      if (!RUN_ID.test(id)) return [400, { error: 'bad_run_id' }];
      const b = (await body()) as Record<string, unknown>;
      if (!b || typeof b !== 'object' || b.id !== id || typeof b.startedAt !== 'string' || Number.isNaN(Date.parse(b.startedAt))
        || typeof b.result !== 'string' || !RESULTS.has(b.result)) return [400, { error: 'bad_run' }];
      const { report, ...summary } = b;
      return serial(async () => {
        const request = typeof summary.request === 'string' && REQUEST_ID.test(summary.request) ? requests.get(summary.request) : undefined;
        // A run keeps the name it was started with, after its request is gone.
        const doc = { ...summary, host: typeof summary.host === 'string' ? summary.host : name,
          ...(request?.name && !summary.name ? { name: request.name } : {}), receivedAt: iso() } as unknown as RunDoc;
        if (typeof report === 'string' && report) {
          await docs.put(`reports/${id}.json`, { report: report.length > REPORT_LIMIT ? `${report.slice(0, REPORT_LIMIT)}\n\n… (cut; the full report is on PC2024)\n` : report });
        }
        await docs.put(`runs/${id}.json`, doc);
        const first = !runs.has(id);
        runs.set(id, doc);
        if (request && (request.status === 'starting' || request.status === 'queued' || !request.run)) {
          await saveRequest(requests, { ...request, status: 'started', run: id, startedAt: request.startedAt ?? iso(), note: 'Started on PC2024.' });
        }
        if (first || doc.result !== 'running') log('playtests.run_saved', { run: id, result: doc.result, runner: name });
        return [200, { ok: true }] as Answer;
      });
    }
    if (method === 'PUT' && path === '/v1/playtests/meta') {
      const b = (await body()) as Record<string, unknown>;
      if (!b || typeof b !== 'object' || !Array.isArray(b.decks)) return [400, { error: 'bad_meta' }];
      await docs.put('meta.json', { ...b, updatedAt: iso() });
      return [200, { ok: true }];
    }
    if (method === 'PUT' && path === '/v1/playtests/library') {
      const b = (await body()) as { decks?: unknown };
      const decks = b?.decks;
      if (!decks || typeof decks !== 'object' || Array.isArray(decks) || !Object.keys(decks).length) return [400, { error: 'bad_library' }];
      await docs.put('library.json', b);
      log('playtests.library_published', { decks: Object.keys(decks).length, runner: name });
      return [200, { ok: true }];
    }
    if (method === 'GET' && path === '/v1/playtests/runner/keys') return [200, opt.keys?.() ?? {}];
    return [404, { error: 'not_found' }];
  }

  return {
    async request(caller: Caller, method: string, path: string, body: () => Promise<unknown>): Promise<Answer> {
      if (!caller) return [401, { error: 'signed_out' }];
      const runnerPath = path.startsWith('/v1/playtests/runner/') || path === '/v1/playtests/meta' || path === '/v1/playtests/library'
        || (method === 'PUT' && path.startsWith('/v1/playtests/runs/'));
      if (caller.kind === 'runner') return runnerPath ? forRunner(caller.name, method, path, body) : [403, { error: 'not_allowed' }];
      return runnerPath ? [403, { error: 'not_allowed' }] : forOwner(method, path, body);
    },
    /** The deck library, as PC2024 last sent it (or where it was published before). */
    async library(): Promise<unknown> {
      return (await docs.get('library.json')) ?? (await opt.libraryFallback?.()) ?? { decks: {} };
    },
    /** For the ops snapshot (ops.ts): the Accounts tab's numbers, written every few minutes. */
    saveOps: (ops: unknown) => docs.put('ops.json', ops),
    runner: () => runner,
  };
}
