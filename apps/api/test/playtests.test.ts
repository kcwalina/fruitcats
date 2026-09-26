// The playtest dashboard's server side, on documents in a temporary folder: who may do what, how a request travels
// from the page to PC2024 and back, and that a run keeps its request's name.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { folderDocs } from '../src/playtests/docs';
import { playtests, requestProblem, type PlaytestRequest } from '../src/playtests/playtests';

const OWNER = { kind: 'owner' } as const;
const PC = { kind: 'runner', name: 'PC2024' } as const;

function setup() {
  let clock = Date.parse('2026-09-26T10:00:00Z');
  const api = playtests({ docs: folderDocs(mkdtempSync(join(tmpdir(), 'fruitcats-playtests-'))), now: () => clock, keys: () => ({ FIREWORKS_API_KEY: 'k' }) });
  const call = (caller: Parameters<typeof api.request>[0], method: string, path: string, body: unknown = {}) => api.request(caller, method, path, async () => body);
  return { api, call, tick: (ms: number) => { clock += ms; } };
}
const queue = (call: ReturnType<typeof setup>['call'], extra: object = {}) =>
  call(OWNER, 'POST', '/v1/playtests/requests', { command: 'balance', args: '--scale 1 --quiet', label: 'Bot gauntlet', ...extra });
const run = (id: string, fields: object = {}) => ({ id, kind: 'balance', startedAt: '2026-09-26T10:01:00Z', result: 'running', problems: [], details: {}, ...fields });

describe('who may do what', () => {
  it('turns away the signed-out, and keeps owner and runner routes apart', async () => {
    const { call } = setup();
    expect((await call(null, 'GET', '/v1/playtests'))[0]).toBe(401);
    expect((await call(PC, 'GET', '/v1/playtests'))[0]).toBe(403);
    expect((await call(OWNER, 'POST', '/v1/playtests/runner/poll', { busy: false }))[0]).toBe(403);
    expect((await call(OWNER, 'PUT', '/v1/playtests/runs/balance-20260926-100100', run('balance-20260926-100100')))[0]).toBe(403);
    expect((await call(OWNER, 'GET', '/v1/playtests/runner/keys'))[0]).toBe(403);
    expect(await call(PC, 'GET', '/v1/playtests/runner/keys')).toEqual([200, { FIREWORKS_API_KEY: 'k' }]);
  });

  it('refuses requests the runner must not run', () => {
    expect(requestProblem('rm', '')).toMatch(/must be one of/);
    expect(requestProblem('balance', '--scale 1; del C:')).toMatch(/letters, digits/);
    expect(requestProblem('deck-build', '--provider fireworks-k3 --max-usd 5 --goal x')).toMatch(/at most 1/);
    expect(requestProblem('deck-build', '--provider openai --max-usd 1')).toMatch(/Kimi K3/);
    expect(requestProblem('llm-playtest', '--provider fireworks-k3')).toMatch(/never a paid one/);
    expect(requestProblem('deck-build', '--provider fireworks-k3 --max-usd 1 --goal an aggressive deck')).toBeNull();
    expect(requestProblem('llm-playtest', '--provider pc2024 --games 4 --deck FC1.Fort.MOCHI.c1x2')).toBeNull();
  });
});

describe('a request, from the page to PC2024', () => {
  it('is handed out once, oldest first, only to a free runner', async () => {
    const { call, tick } = setup();
    const [, first] = await queue(call, { name: 'First' }) as [number, PlaytestRequest];
    tick(1000);
    await queue(call);
    expect(await call(PC, 'POST', '/v1/playtests/runner/poll', { busy: true })).toEqual([200, { request: null }]);
    const [, got] = await call(PC, 'POST', '/v1/playtests/runner/poll', { busy: false }) as [number, { request: PlaytestRequest }];
    expect(got.request).toMatchObject({ id: first.id, status: 'starting', name: 'First' });
    // Starting doesn't hand it out again.
    const [, second] = await call(PC, 'POST', '/v1/playtests/runner/poll', { busy: false }) as [number, { request: PlaytestRequest }];
    expect(second.request.id).not.toBe(first.id);
  });

  it('gives the run its request’s name and marks the request started', async () => {
    const { call } = setup();
    const [, q] = await queue(call, { name: 'After the Heat buff' }) as [number, PlaytestRequest];
    await call(PC, 'POST', '/v1/playtests/runner/poll', { busy: false });
    const id = 'balance-20260926-100100';
    expect((await call(PC, 'PUT', `/v1/playtests/runs/${id}`, run(id, { request: q.id })))[0]).toBe(200);
    expect((await call(PC, 'PUT', `/v1/playtests/runs/${id}`, run(id, { request: q.id, result: 'warn', report: '# Report' })))[0]).toBe(200);
    const [, page] = await call(OWNER, 'GET', '/v1/playtests') as [number, { runs: { id: string; name: string; result: string; report?: string }[]; requests: PlaytestRequest[]; runner: { busy: boolean } }];
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]).toMatchObject({ id, name: 'After the Heat buff', result: 'warn' });
    expect(page.runs[0].report).toBeUndefined();
    expect(page.requests[0]).toMatchObject({ status: 'started', run: id });
    expect(page.runner.busy).toBe(false);
    expect((await call(OWNER, 'GET', `/v1/playtests/runs/${id}`))[1]).toMatchObject({ id, report: '# Report' });
  });

  it('puts back a request the runner took but never started, and gives up after three tries', async () => {
    const { call, tick } = setup();
    await queue(call);
    for (let i = 0; i < 3; i++) {
      const [, got] = await call(PC, 'POST', '/v1/playtests/runner/poll', { busy: false }) as [number, { request: PlaytestRequest | null }];
      expect(got.request?.status).toBe('starting');
      tick(11 * 60_000);
    }
    await call(PC, 'POST', '/v1/playtests/runner/poll', { busy: true });
    const [, page] = await call(OWNER, 'GET', '/v1/playtests') as [number, { requests: PlaytestRequest[] }];
    expect(page.requests[0]).toMatchObject({ status: 'failed', tries: 3 });
  });

  it('lets the owner cancel a queued request but not a started one', async () => {
    const { call } = setup();
    const [, a] = await queue(call) as [number, PlaytestRequest];
    expect(await call(OWNER, 'DELETE', `/v1/playtests/requests/${a.id}`)).toEqual([200, { deleted: true }]);
    const [, b] = await queue(call) as [number, PlaytestRequest];
    await call(PC, 'POST', '/v1/playtests/runner/poll', { busy: false });
    await call(PC, 'POST', `/v1/playtests/runner/requests/${b.id}`, { status: 'started' });
    expect((await call(OWNER, 'DELETE', `/v1/playtests/requests/${b.id}`))[0]).toBe(409);
  });

  it('keeps the library PC2024 sends, and serves the old published copy until then', async () => {
    const api = playtests({ docs: folderDocs(mkdtempSync(join(tmpdir(), 'fruitcats-playtests-'))), libraryFallback: async () => ({ decks: { old: {} } }) });
    const put = (caller: Parameters<typeof api.request>[0], body: unknown) => api.request(caller, 'PUT', '/v1/playtests/library', async () => body);
    expect(await api.library()).toEqual({ decks: { old: {} } });
    expect((await put(OWNER, { decks: { a: {} } }))[0]).toBe(403);
    expect((await put(PC, { decks: {} }))[0]).toBe(400);
    expect((await put(PC, { decks: { fort: { name: 'Fruit Fortress' } }, lastNightly: '2026-09-26' }))[0]).toBe(200);
    expect(await api.library()).toMatchObject({ decks: { fort: { name: 'Fruit Fortress' } }, lastNightly: '2026-09-26' });
  });

  it('refuses a malformed run', async () => {
    const { call } = setup();
    expect((await call(PC, 'PUT', '/v1/playtests/runs/..%2Fx', run('..%2Fx')))[0]).toBe(400);
    expect((await call(PC, 'PUT', '/v1/playtests/runs/balance-20260926-100100', run('balance-20260926-100101')))[0]).toBe(400);
    expect((await call(PC, 'PUT', '/v1/playtests/runs/balance-20260926-100100', run('balance-20260926-100100', { result: 'great' })))[0]).toBe(400);
  });
});
