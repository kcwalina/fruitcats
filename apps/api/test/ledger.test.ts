// The order rules (ledger.ts) on their own, and the Paddle settings and signatures (paddle.ts).

import { describe, expect, it } from 'vitest';
import { held, transition, type OrderState } from '../src/ledger';
import { paddleConfig, signFor, verifySignature } from '../src/paddle';

const pending: OrderState = {
  status: 'pending', txn: 'txn_1',
  grants: { a: 2, b: 1 }, lineGrants: { 'deck:x': { a: 2 }, 'card:b': { b: 1 } },
};
const paid = (txn = 'txn_1') => ({ kind: 'paid', txn, at: '2026-09-25T00:00:00Z', amount: 999, currency: 'USD', items: { i1: 'deck:x', i2: 'card:b' } }) as const;

describe('an order', () => {
  it('is owned only once paid', () => {
    expect(held(pending)).toEqual({});
    const { next, changed } = transition(pending, paid());
    expect(changed).toBe(true);
    expect(next.status).toBe('paid');
    expect(held(next)).toEqual({ a: 2, b: 1 });
  });

  it('is paid once: the same payment again changes nothing, and a second payment raises an alert', () => {
    const { next } = transition(pending, paid());
    expect(transition(next, paid()).changed).toBe(false);
    const twice = transition(next, paid('txn_2'));
    expect(twice.changed).toBe(false);
    expect(twice.alert).toContain('paid twice');
  });

  it('becomes paid from abandoned: a payment always counts', () => {
    const { next: gone } = transition(pending, { kind: 'cancelled' });
    expect(gone.status).toBe('abandoned');
    expect(transition(gone, paid()).next.status).toBe('paid');
  });

  it('never turns a test order paid', () => {
    const r = transition({ ...pending, status: 'test' }, paid());
    expect(r.changed).toBe(false);
    expect(r.alert).toBeTruthy();
  });

  it('takes back one line, then the rest, each adjustment once', () => {
    const p = transition(pending, paid()).next;
    const one = transition(p, { kind: 'adjustment', id: 'adj_1', action: 'refund', txn: 'txn_1', lines: [{ item: 'i2', whole: true }] });
    expect(one.next.status).toBe('paid');
    expect(held(one.next)).toEqual({ a: 2 });
    expect(transition(one.next, { kind: 'adjustment', id: 'adj_1', action: 'refund', txn: 'txn_1', lines: [{ item: 'i2', whole: true }] }).changed).toBe(false);
    const all = transition(one.next, { kind: 'adjustment', id: 'adj_2', action: 'refund', txn: 'txn_1', lines: [{ item: 'i1', whole: true }] });
    expect(all.next.status).toBe('refunded');
    expect(held(all.next)).toEqual({});
    // A payment message arriving after the refund doesn't bring anything back.
    expect(transition(all.next, paid()).changed).toBe(false);
  });

  it('refuses a refund for a transaction that didn’t pay it', () => {
    const p = transition(pending, paid()).next;
    const r = transition(p, { kind: 'adjustment', id: 'adj_9', action: 'refund', txn: 'txn_other', lines: [{ item: 'i1', whole: true }] });
    expect(r.changed).toBe(false);
    expect(r.alert).toBeTruthy();
  });
});

describe('Paddle settings', () => {
  const keys = { PADDLE_API_KEY: 'pdl_sdbx_apikey_1', PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_1', PADDLE_CLIENT_TOKEN: 'test_1' };

  it('are off with nothing set', () => expect(paddleConfig({})).toEqual({ config: null }));

  it('know the environment from the keys, and open checkouts only when STORE_PAYMENTS names it', () => {
    expect(paddleConfig({ ...keys }).config).toMatchObject({ environment: 'sandbox', checkouts: false, taxMode: 'internal' });
    expect(paddleConfig({ ...keys, STORE_PAYMENTS: 'sandbox' }).config).toMatchObject({ checkouts: true });
  });

  it('refuse a live key for a sandbox test, and mixed keys', () => {
    expect(paddleConfig({ ...keys, STORE_PAYMENTS: 'live' }).config).toBeNull();
    expect(paddleConfig({ ...keys, PADDLE_CLIENT_TOKEN: 'live_1' }).config).toBeNull();
    expect(paddleConfig({ ...keys, PADDLE_API_KEY: 'old-style-key' }).config).toBeNull();
    const { problem } = paddleConfig({ ...keys, PADDLE_API_KEY: 'pdl_live_apikey_SECRET', STORE_PAYMENTS: 'sandbox' });
    expect(problem).toBeTruthy();
    expect(problem).not.toContain('SECRET');
  });
});

describe('webhook signatures', () => {
  const body = Buffer.from('{"event_id":"evt_1"}');
  const now = Date.parse('2026-09-25T12:00:00Z');

  it('accept Paddle’s, and refuse a changed body, another secret or an old message', () => {
    const sig = signFor(body, 'secret', now);
    expect(verifySignature(sig, body, 'secret', now)).toBe(true);
    expect(verifySignature(sig, Buffer.from('{"event_id":"evt_2"}'), 'secret', now)).toBe(false);
    expect(verifySignature(sig, body, 'other', now)).toBe(false);
    expect(verifySignature(sig, body, 'secret', now + 10 * 60_000)).toBe(false);
    expect(verifySignature(undefined, body, 'secret', now)).toBe(false);
    expect(verifySignature('ts=1;h1=zz', body, 'secret', now)).toBe(false);
  });

  it('accept either signature while a secret is rotated', () => {
    const good = signFor(body, 'secret', now).split(';')[1];
    const header = `ts=${Math.floor(now / 1000)};h1=${'0'.repeat(64)};${good}`;
    expect(verifySignature(header, body, 'secret', now)).toBe(true);
  });
});
