// Calls over the network that give up in time and, when it's safe, try again by themselves. Phones drop off Wi-Fi,
// trains go through tunnels, and a service restarting answers 503 for a few seconds: one failed request shouldn't
// be the player's problem when a second one a moment later would have worked.
//
// Only calls that can safely happen twice are tried again (reading something, or setting a value to the same thing).
// A call that emails a code, or uses one up, is never repeated behind the player's back.
//
// No DOM here beyond fetch and AbortController, so the rules are tested on their own (apps/web/test/net.test.ts).

/** How hard to try. */
export interface RetryPolicy {
  /** How long one attempt may take. */
  attemptMs: number;
  /** The waits before each retry (so its length is the number of retries). */
  delaysMs: number[];
  /** The whole call, retries and waits included, never takes longer than this. */
  budgetMs: number;
  /** Each wait is moved up or down by up to this fraction, so devices that failed together don't all retry together. */
  jitter: number;
  /** A 429 is tried again only when the service asks for a wait this short or shorter. */
  maxRetryAfterMs: number;
}

/** For calls that are safe to repeat: 10 s an attempt, two retries after about 1 s and 3 s, 25 s in all. */
export const SAFE_RETRY: RetryPolicy = { attemptMs: 10_000, delaysMs: [1000, 3000], budgetMs: 25_000, jitter: 0.25, maxRetryAfterMs: 5000 };

/** For calls that must not happen twice: one attempt. */
export const NO_RETRY: RetryPolicy = { ...SAFE_RETRY, delaysMs: [] };

/**
 * The Fruitcats API (the Store, the Studio): 20 s an attempt, as some answers carry a whole catalog or set. A GET
 * only reads, so it's tried once more after about a second; anything else, once.
 */
export function apiPolicy(method: string): RetryPolicy {
  return method === 'GET'
    ? { ...SAFE_RETRY, attemptMs: 20_000, delaysMs: [1000], budgetMs: 42_000 }
    : { ...NO_RETRY, attemptMs: 20_000, budgetMs: 20_000 };
}

/** What went wrong with one attempt. */
export type Failure =
  | { kind: 'network' }
  | { kind: 'timeout' }
  | { kind: 'status'; status: number; retryAfterMs: number | null };

/** The call gave up without an answer: offline, or nothing came back in time. */
export class NetError extends Error {
  constructor(readonly kind: 'network' | 'timeout') { super(kind); }
}

/** A Retry-After header in milliseconds: seconds ("3") or a date. Null when missing or unreadable. */
export function parseRetryAfter(header: string | null | undefined, now = Date.now()): number | null {
  if (header == null || header.trim() === '') return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * How long to wait before trying again after `failure` on attempt `attempt` (0: the first), or null to stop.
 * `elapsedMs` is the time spent so far; a retry that couldn't get a fair attempt inside the budget isn't made.
 */
export function retryDelay(policy: RetryPolicy, attempt: number, failure: Failure, elapsedMs: number, random = Math.random): number | null {
  if (attempt >= policy.delaysMs.length) return null;
  let wait = policy.delaysMs[attempt] * (1 - policy.jitter + 2 * policy.jitter * random());
  if (failure.kind === 'status') {
    const { status, retryAfterMs } = failure;
    if (status === 429) {
      if (retryAfterMs == null || retryAfterMs > policy.maxRetryAfterMs) return null;
      wait = Math.max(wait, retryAfterMs);
    } else if (status === 502 || status === 503 || status === 504) {
      // A 503 that says how long to wait is believed, within the same limit as a 429.
      if (retryAfterMs != null) {
        if (retryAfterMs > policy.maxRetryAfterMs) return null;
        wait = Math.max(wait, retryAfterMs);
      }
    } else return null;
  }
  // At least a second left for the next attempt, or it isn't worth making.
  if (elapsedMs + wait + 1000 > policy.budgetMs) return null;
  return Math.round(wait);
}

/**
 * A signal that aborts after `ms`. AbortSignal.timeout is missing on iPhones and iPads before iOS 16 (and calling it
 * there throws, which read as "offline" on every call), so an AbortController and a timer stand in.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('The request took too long.', 'TimeoutError')), ms);
  return controller.signal;
}

/** Whether an error thrown by fetch was our own timeout (older Safari reports any abort as AbortError). */
function timedOut(e: unknown, signal: AbortSignal): boolean {
  return (e instanceof DOMException && e.name === 'TimeoutError') || signal.aborted;
}

export interface FetchDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
}

const realDeps = (): FetchDeps => ({
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  random: Math.random,
});

/**
 * fetch, with a time limit on every attempt and, as `policy` allows, retries. Resolves with the last answer the
 * service gave, whatever its status (a 503 after the retries is still an answer the caller can explain). Rejects
 * with a NetError only when no answer came at all. `deadline` (ms since epoch) cuts the budget short: one tap in
 * the account window gets one deadline for all its calls.
 */
export async function fetchRetry(url: string, init: RequestInit, policy: RetryPolicy, deadline = 0, deps: FetchDeps = realDeps()): Promise<Response> {
  const start = deps.now();
  const budget = deadline ? Math.min(policy.budgetMs, deadline - start) : policy.budgetMs;
  const limits = { ...policy, budgetMs: budget };
  for (let attempt = 0; ; attempt++) {
    const left = budget - (deps.now() - start);
    if (left <= 0) throw new NetError('timeout');
    const signal = timeoutSignal(Math.min(policy.attemptMs, left));
    let failure: Failure;
    let answer: Response | null = null;
    let error: NetError;
    try {
      answer = await deps.fetch(url, { ...init, signal });
      if (answer.status !== 429 && answer.status !== 502 && answer.status !== 503 && answer.status !== 504) return answer;
      failure = { kind: 'status', status: answer.status, retryAfterMs: parseRetryAfter(answer.headers.get('Retry-After'), deps.now()) };
      error = new NetError('network');
    } catch (e) {
      error = new NetError(timedOut(e, signal) ? 'timeout' : 'network');
      failure = { kind: error.kind };
    }
    const wait = retryDelay(limits, attempt, failure, deps.now() - start, deps.random);
    if (wait == null) {
      if (answer) return answer;
      throw error;
    }
    await deps.sleep(wait);
  }
}

/** A unique id for one request, so a service can tell a retry from a second request. */
export function requestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // iOS before 15.4 has no randomUUID.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

