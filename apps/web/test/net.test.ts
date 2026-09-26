import { describe, expect, it } from 'vitest';
import { NO_RETRY, NetError, SAFE_RETRY, apiPolicy, fetchRetry, parseRetryAfter, requestId, retryDelay, timeoutSignal, type FetchDeps } from '../src/net';

/** A pretend network: answers in turn, with a clock that moves only when the code sleeps. */
function fakeNet(answers: (Response | Error)[]) {
  let clock = 1_000_000;
  const calls: RequestInit[] = [];
  const waits: number[] = [];
  const deps: FetchDeps = {
    fetch: async (_url, init) => {
      calls.push(init ?? {});
      const next = answers.shift();
      if (!next) throw new Error('no more answers');
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => { waits.push(ms); clock += ms; },
    now: () => clock,
    random: () => 0.5,
  };
  return { deps, calls, waits };
}

const status = (code: number, headers: Record<string, string> = {}) => new Response('{}', { status: code, headers });
const offline = () => new TypeError('Failed to fetch');

describe('parseRetryAfter', () => {
  it('reads seconds and dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4000)).toBe(6000);
  });
  it('ignores what it cannot read', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
  });
});

describe('retryDelay', () => {
  const mid = () => 0.5;
  it('waits about 1 s, then about 3 s, then stops', () => {
    expect(retryDelay(SAFE_RETRY, 0, { kind: 'network' }, 0, mid)).toBe(1000);
    expect(retryDelay(SAFE_RETRY, 1, { kind: 'timeout' }, 0, mid)).toBe(3000);
    expect(retryDelay(SAFE_RETRY, 2, { kind: 'network' }, 0, mid)).toBeNull();
  });
  it('moves each wait by up to 25% either way', () => {
    expect(retryDelay(SAFE_RETRY, 0, { kind: 'network' }, 0, () => 0)).toBe(750);
    expect(retryDelay(SAFE_RETRY, 0, { kind: 'network' }, 0, () => 0.999999)).toBe(1250);
  });
  it('tries again on 502, 503 and 504 only', () => {
    for (const code of [502, 503, 504]) expect(retryDelay(SAFE_RETRY, 0, { kind: 'status', status: code, retryAfterMs: null }, 0, mid)).toBe(1000);
    for (const code of [400, 401, 403, 404, 500]) expect(retryDelay(SAFE_RETRY, 0, { kind: 'status', status: code, retryAfterMs: null }, 0, mid)).toBeNull();
  });
  it('tries a 429 again only when asked to wait 5 s or less', () => {
    expect(retryDelay(SAFE_RETRY, 0, { kind: 'status', status: 429, retryAfterMs: 2000 }, 0, mid)).toBe(2000);
    expect(retryDelay(SAFE_RETRY, 0, { kind: 'status', status: 429, retryAfterMs: 6000 }, 0, mid)).toBeNull();
    expect(retryDelay(SAFE_RETRY, 0, { kind: 'status', status: 429, retryAfterMs: null }, 0, mid)).toBeNull();
  });
  it('believes a 503 that asks for a short wait, and gives up on a long one', () => {
    expect(retryDelay(SAFE_RETRY, 0, { kind: 'status', status: 503, retryAfterMs: 4000 }, 0, mid)).toBe(4000);
    expect(retryDelay(SAFE_RETRY, 0, { kind: 'status', status: 503, retryAfterMs: 60_000 }, 0, mid)).toBeNull();
  });
  it('never retries past the budget', () => {
    expect(retryDelay(SAFE_RETRY, 1, { kind: 'network' }, 21_500, mid)).toBeNull();
    expect(retryDelay(SAFE_RETRY, 1, { kind: 'network' }, 20_000, mid)).toBe(3000);
  });
  it('never retries a call that must not happen twice', () => {
    expect(retryDelay(NO_RETRY, 0, { kind: 'network' }, 0, mid)).toBeNull();
  });
});

describe('fetchRetry', () => {
  it('returns the first good answer', async () => {
    const net = fakeNet([status(200)]);
    expect((await fetchRetry('u', {}, SAFE_RETRY, 0, net.deps)).status).toBe(200);
    expect(net.calls).toHaveLength(1);
  });
  it('tries a safe call again after a dropped connection and a busy service', async () => {
    const net = fakeNet([offline(), status(503), status(200)]);
    expect((await fetchRetry('u', {}, SAFE_RETRY, 0, net.deps)).status).toBe(200);
    expect(net.waits).toEqual([1000, 3000]);
  });
  it('gives the last answer when the retries run out', async () => {
    const net = fakeNet([status(503), status(503), status(503)]);
    expect((await fetchRetry('u', {}, SAFE_RETRY, 0, net.deps)).status).toBe(503);
    expect(net.calls).toHaveLength(3);
  });
  it('throws a NetError when nothing ever answers', async () => {
    const net = fakeNet([offline(), offline(), offline()]);
    await expect(fetchRetry('u', {}, SAFE_RETRY, 0, net.deps)).rejects.toEqual(new NetError('network'));
  });
  it('tells a timeout from being offline', async () => {
    const net = fakeNet([new DOMException('slow', 'TimeoutError')]);
    const e = await fetchRetry('u', {}, NO_RETRY, 0, net.deps).catch((x) => x);
    expect(e).toBeInstanceOf(NetError);
    expect(e.kind).toBe('timeout');
  });
  it('makes one attempt only for a call that must not happen twice', async () => {
    const net = fakeNet([status(503), status(200)]);
    expect((await fetchRetry('u', {}, NO_RETRY, 0, net.deps)).status).toBe(503);
    expect(net.calls).toHaveLength(1);
  });
  it('does not try again after an answer the service meant', async () => {
    const net = fakeNet([status(400), status(200)]);
    expect((await fetchRetry('u', {}, SAFE_RETRY, 0, net.deps)).status).toBe(400);
  });
  it('waits as long as a 429 asks, when that is short', async () => {
    const net = fakeNet([status(429, { 'Retry-After': '2' }), status(200)]);
    expect((await fetchRetry('u', {}, SAFE_RETRY, 0, net.deps)).status).toBe(200);
    expect(net.waits).toEqual([2000]);
  });
  it('hands back a 429 that asks for a long wait', async () => {
    const net = fakeNet([status(429, { 'Retry-After': '60' }), status(200)]);
    expect((await fetchRetry('u', {}, SAFE_RETRY, 0, net.deps)).status).toBe(429);
    expect(net.calls).toHaveLength(1);
  });
  it('keeps to a deadline shorter than the budget', async () => {
    const net = fakeNet([offline(), offline(), status(200)]);
    // 2.5 s left: the first retry (1 s) fits, the second (3 s) doesn't.
    await expect(fetchRetry('u', {}, SAFE_RETRY, net.deps.now() + 2500, net.deps)).rejects.toBeInstanceOf(NetError);
    expect(net.calls).toHaveLength(2);
  });
  it('gives every attempt its own time limit', async () => {
    const net = fakeNet([status(200)]);
    await fetchRetry('u', { method: 'GET' }, SAFE_RETRY, 0, net.deps);
    expect(net.calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(net.calls[0].method).toBe('GET');
  });
});

describe('apiPolicy', () => {
  it('tries a GET once more, anything else once, 20 s an attempt', () => {
    expect(apiPolicy('GET')).toMatchObject({ attemptMs: 20_000, delaysMs: [1000] });
    expect(apiPolicy('POST')).toMatchObject({ attemptMs: 20_000, delaysMs: [] });
  });
});

describe('timeoutSignal', () => {
  it('aborts after the time given, with or without AbortSignal.timeout', async () => {
    const native = AbortSignal.timeout;
    try {
      (AbortSignal as { timeout?: unknown }).timeout = undefined;   // older iPhones and iPads
      const signal = timeoutSignal(10);
      expect(signal.aborted).toBe(false);
      await new Promise((r) => setTimeout(r, 30));
      expect(signal.aborted).toBe(true);
      expect((signal.reason as DOMException).name).toBe('TimeoutError');
    } finally {
      AbortSignal.timeout = native;
    }
  });
});

describe('requestId', () => {
  it('is a fresh UUID each time', () => {
    const a = requestId(), b = requestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
