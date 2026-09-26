// The sign-in steps over a pretend account service: what's retried, what's kept after a failure, and how an expired
// code or sign-in starts again by itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Auth = typeof import('../src/auth');
type Route = (path: string, fields: Record<string, string>, init: RequestInit) => Response | Error | undefined;

const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
const fail = (code: number, json: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(json), { status: code, headers });
const offline = () => new TypeError('Failed to fetch');
const OURS = { access_token: 'ours', expires_in: 3600, user: { id: 'u1', displayName: 'Kim', terms: null } };

let calls: { path: string; fields: Record<string, string>; init: RequestInit }[];
let route: Route;

/** A fresh copy of auth.ts (its sign-in state is per module) over the pretend service. */
async function load(): Promise<Auth> {
  vi.resetModules();
  return import('../src/auth');
}

beforeEach(() => {
  calls = [];
  const store = new Map<string, string>();
  vi.stubGlobal('location', { port: '5173', origin: 'http://localhost:5173', search: '' });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://id.viamochi.com/', '').replace(/^auth\//, '');
    const fields = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : {};
    calls.push({ path, fields, init });
    const answer = route(path, fields, init);
    if (!answer) throw new Error(`nothing answers ${path}`);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Run a call to the end, retries' waits included, and hand back what it resolved or threw. */
async function settle<T>(p: Promise<T>): Promise<T | Error> {
  const out = p.catch((e: Error) => e);
  await vi.runAllTimersAsync();
  return out;
}

const count = (path: string, grant?: string) => calls.filter((c) => c.path === path && (!grant || c.fields.grant_type === grant)).length;

/** Entra's usual answers for signing in to kim@example.com. */
function signInRoutes(overrides: Partial<Record<string, Route>> = {}): Route {
  let challenges = 0;
  const base: Record<string, Route> = {
    'oauth2/v2.0/initiate': () => ok({ continuation_token: 'ct-init' }),
    'oauth2/v2.0/challenge': () => ok({ challenge_type: 'oob', continuation_token: `ct-code-${++challenges}`, challenge_target_label: 'k•••@e•••.com', code_length: 8 }),
    'oauth2/v2.0/token': () => ok({ access_token: 'entra', refresh_token: 'rt' }),
    token: () => ok(OURS),
  };
  return (path, fields, init) => (overrides[path] ?? base[path])?.(path, fields, init);
}

describe('codeDigits', () => {
  it('keeps only the digits of what was pasted', async () => {
    const { codeDigits } = await load();
    expect(codeDigits('tel:12345678', 8)).toBe('12345678');
    expect(codeDigits('1234 5678', 8)).toBe('12345678');
    expect(codeDigits('+112345678', 8)).toBe('12345678');
    expect(codeDigits('123', 8)).toBe('123');
    expect(codeDigits('123456789', 0)).toBe('123456789');
  });
});

describe('signing in', () => {
  it('keeps what Entra accepted when our exchange fails, so the next tap sends no used code', async () => {
    const auth = await load();
    let ours = 0;
    route = signInRoutes({ token: () => (++ours <= 3 ? fail(503) : ok(OURS)) });
    const p = await auth.startSignIn('kim@example.com');

    const first = await settle(auth.submitCode(p, '12345678'));
    expect(first).toBeInstanceOf(auth.AuthError);
    expect((first as InstanceType<Auth['AuthError']>).code).toBe('exchange');
    expect(count('token')).toBe(3);   // our exchange is tried again by itself
    expect(p.entra).toBeTruthy();

    const second = await settle(auth.submitCode(p, '12345678'));
    expect(second).toMatchObject({ userId: 'u1', token: 'ours' });
    expect(count('oauth2/v2.0/token', 'oob')).toBe(1);   // the code went to Entra once
    expect(auth.session()?.refreshToken).toBe('rt');
  });

  it('never repeats the step that uses the code', async () => {
    const auth = await load();
    route = signInRoutes({ 'oauth2/v2.0/token': () => offline() });
    const p = await auth.startSignIn('kim@example.com');
    const e = await settle(auth.submitCode(p, '12345678'));
    expect((e as InstanceType<Auth['AuthError']>).code).toBe('network');
    expect(count('oauth2/v2.0/token', 'oob')).toBe(1);
  });

  it('never repeats the challenge, which emails a code', async () => {
    const auth = await load();
    route = signInRoutes({ 'oauth2/v2.0/challenge': () => fail(503) });
    const e = await settle(auth.startSignIn('kim@example.com'));
    expect((e as InstanceType<Auth['AuthError']>).code).toBe('down');
    expect(count('oauth2/v2.0/challenge')).toBe(1);
  });

  it('tries starting a sign-in again after a dropped connection', async () => {
    const auth = await load();
    let tries = 0;
    route = signInRoutes({ 'oauth2/v2.0/initiate': () => (++tries === 1 ? offline() : ok({ continuation_token: 'ct-init' })) });
    const p = await settle(auth.startSignIn('kim@example.com'));
    expect(p).toMatchObject({ flow: 'signIn', continuationToken: 'ct-code-1' });
    expect(count('oauth2/v2.0/initiate')).toBe(2);
  });

  it('starts again when the sign-in accountExists began has expired, instead of saying the code expired', async () => {
    const auth = await load();
    let starts = 0;
    route = signInRoutes({
      'oauth2/v2.0/initiate': () => ok({ continuation_token: `ct-init-${++starts}` }),
      'oauth2/v2.0/challenge': (_p, f) => f.continuation_token === 'ct-init-1'
        ? fail(400, { error: 'expired_token' })
        : ok({ challenge_type: 'oob', continuation_token: 'ct-code', code_length: 8 }),
    });
    expect(await auth.accountExists('kim@example.com')).toBe(true);
    const p = await settle(auth.startSignIn('kim@example.com'));
    expect(p).toMatchObject({ continuationToken: 'ct-code' });
    expect(count('oauth2/v2.0/initiate')).toBe(2);
  });

  it('sends a new code by itself when the code has expired', async () => {
    const auth = await load();
    route = signInRoutes({ 'oauth2/v2.0/token': () => fail(400, { error: 'expired_token' }) });
    const p = await auth.startSignIn('kim@example.com');
    const e = await settle(auth.submitCode(p, '12345678'));
    expect((e as InstanceType<Auth['AuthError']>).code).toBe('code_resent');
    expect((e as Error).message).toBe('That code has expired. We’ve sent you a new one.');
    expect(p.continuationToken).toBe('ct-code-2');   // the same Pending, now for the new code
  });

  it('"Send a new code" starts the sign-in again once Entra has forgotten it', async () => {
    const auth = await load();
    let challenges = 0;
    route = signInRoutes({
      'oauth2/v2.0/challenge': (_p, f) => f.continuation_token === 'ct-code-old'
        ? fail(400, { error: 'expired_token' })
        : ok({ challenge_type: 'oob', continuation_token: `ct-new-${++challenges}`, code_length: 8 }),
    });
    const stale = { flow: 'signIn' as const, email: 'kim@example.com', continuationToken: 'ct-code-old', sentTo: '', codeLength: 8, newAccount: false };
    const p = await settle(auth.resend(stale));
    expect(p).toMatchObject({ flow: 'signIn', continuationToken: 'ct-new-1' });
    expect(count('oauth2/v2.0/initiate')).toBe(1);
  });

  it('uses the service’s own words when it has sent too many codes', async () => {
    const auth = await load();
    const words = 'We’ve sent several codes to this address. Please wait a few minutes.';
    route = signInRoutes({ 'oauth2/v2.0/challenge': () => fail(429, { error: 'too_many_codes', error_description: words }, { 'Retry-After': '300' }) });
    const e = await settle(auth.startSignIn('kim@example.com'));
    expect((e as InstanceType<Auth['AuthError']>).code).toBe('too_many_codes');
    expect((e as Error).message).toBe(words);
  });
});

describe('creating an account', () => {
  const signUpRoutes = (overrides: Partial<Record<string, Route>> = {}) => signInRoutes({
    'signup/v1.0/start': () => ok({ continuation_token: 'su-start' }),
    'signup/v1.0/challenge': (_p, f) => ok({ challenge_type: 'oob', continuation_token: `su-code-${f.continuation_token}`, code_length: 8 }),
    'signup/v1.0/continue': () => ok({ continuation_token: 'su-confirmed' }),
    ...overrides,
  });

  it('starts the sign-up again with the same name when Entra has forgotten it', async () => {
    const auth = await load();
    route = signUpRoutes({
      'signup/v1.0/challenge': (_p, f) => f.continuation_token === 'stale'
        ? fail(400, { error: 'expired_token' })
        : ok({ challenge_type: 'oob', continuation_token: 'su-fresh', code_length: 8 }),
    });
    const stale = { flow: 'signUp' as const, email: 'kim@example.com', continuationToken: 'stale', sentTo: '', codeLength: 8, newAccount: true, displayName: 'Kim', birthYear: 1990 };
    const p = await settle(auth.resend(stale));
    expect(p).toMatchObject({ flow: 'signUp', continuationToken: 'su-fresh', displayName: 'Kim', birthYear: 1990 });
    const start = calls.find((c) => c.path === 'signup/v1.0/start')!;
    expect(JSON.parse(start.fields.attributes)).toMatchObject({ displayName: 'Kim' });
  });

  it('after the email is confirmed, a failed sign-in tries only what is left', async () => {
    const auth = await load();
    let tokens = 0;
    route = signUpRoutes({ 'oauth2/v2.0/token': () => (++tokens === 1 ? offline() : ok({ access_token: 'entra', refresh_token: 'rt' })) });
    const p = await auth.startSignUp('kim@example.com', 'Kim', 1990);
    expect((await settle(auth.submitCode(p, '12345678')) as InstanceType<Auth['AuthError']>).code).toBe('network');
    expect(p.confirmed).toBe('su-confirmed');
    expect(await settle(auth.submitCode(p, '12345678'))).toMatchObject({ userId: 'u1' });
    expect(count('signup/v1.0/continue')).toBe(1);
  });

  it('signs in to the new account the ordinary way when Entra won’t finish the sign-up', async () => {
    const auth = await load();
    route = signUpRoutes({
      'oauth2/v2.0/token': (_p, f) => f.grant_type === 'continuation_token' ? fail(400, { error: 'expired_token' }) : ok({ access_token: 'entra', refresh_token: 'rt' }),
    });
    const p = await auth.startSignUp('kim@example.com', 'Kim', 1990);
    const e = await settle(auth.submitCode(p, '12345678'));
    expect((e as InstanceType<Auth['AuthError']>).code).toBe('code_resent');
    expect(p).toMatchObject({ flow: 'signIn', newAccount: true, confirmed: undefined });
  });
});

describe('contact us', () => {
  it('sends one message id with every attempt, so a retry is never a second message', async () => {
    const auth = await load();
    let tries = 0;
    route = (path) => (path === 'support' ? (++tries === 1 ? offline() : ok({})) : undefined);
    expect(await settle(auth.sendSupport('Hello', 'kim@example.com', '12345678'))).toBeUndefined();
    const keys = calls.map((c) => (c.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[0]).toBe(keys[1]);
  });

  it('never repeats asking for a code, which emails one', async () => {
    const auth = await load();
    route = (path) => (path === 'support/code' ? offline() : undefined);
    await settle(auth.requestSupportCode('kim@example.com'));
    expect(calls).toHaveLength(1);
  });
});
