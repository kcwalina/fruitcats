// Store codes (store.ts, Codes): a code gives its deck to each account that types it, once, up to its uses; it works
// while buying is off (STORE=preview); wrong codes are limited; and the tables never hold a code itself.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { deckProduct } from '@fruitcats/store';

const [ANA, BEN, CID, DOT, EVE, FAY] = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => x.repeat(32));
type Store = typeof import('../src/store');
let store: Store;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fruitcats-codes-'));
  process.env.LOCAL_DATA = dir;
  process.env.STORE = 'preview';
  process.env.STORE_TEST_CHECKOUT = 'off';
  store = await import('../src/store');
});

const redeem = (user: string, code: unknown) => store.storeRequest(user, 'POST', '/v1/store/redeem', async () => ({ code }));
const owned = async (user: string) => ((await store.storeRequest(user, 'GET', '/v1/store', async () => ({})))[1] as { owned: Record<string, number> }).owned;

describe('making a code', () => {
  it('gives a code in groups of four, for a deck on sale only', async () => {
    expect(await store.createCode(deckProduct('jiaoren'))).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    await expect(store.createCode('deck:nope')).rejects.toThrow();
    await expect(store.createCode('card:JR1-D01')).rejects.toThrow();
  });

  it('keeps only the code’s hash', async () => {
    const code = await store.createCode(deckProduct('jiaoren'), { note: 'hash check' });
    const saved = readFileSync(join(dir, 'storecodes.json'), 'utf8');
    expect(saved).not.toContain(code);
    expect(saved).not.toContain(store.normalizeCode(code));
  });
});

describe('taking a code’s deck', () => {
  it('works while buying is off, and gives the whole deck for nothing', async () => {
    const code = await store.createCode(deckProduct('jiaoren'));
    const [status, body] = await redeem(ANA, code) as [number, { order: { status: string; total: number } }];
    expect(status).toBe(200);
    expect(body.order).toMatchObject({ status: 'code', total: 0 });
    const have = await owned(ANA);
    expect(have['JR1-H01']).toBe(1);
    expect(have['JR1-D01']).toBe(3);
    expect(await store.hasPaid(ANA)).toBe(false);
  });

  it('gives it once per account, however the code is typed', async () => {
    const code = await store.createCode(deckProduct('jiaoren'), { uses: 5 });
    expect((await redeem(BEN, code))[0]).toBe(200);
    const before = await owned(BEN);
    expect(await redeem(BEN, code)).toMatchObject([200, { repeated: true }]);
    expect(await redeem(BEN, ` ${code.toLowerCase().replace(/-/g, ' ')} `)).toMatchObject([200, { repeated: true }]);
    expect(await owned(BEN)).toEqual(before);
  });

  it('serves no more accounts than it allows, even two at once', async () => {
    const code = await store.createCode(deckProduct('jiaoren'), { uses: 1 });
    const [a, b] = await Promise.all([redeem(CID, code), redeem(DOT, code)]);
    expect([a[0], b[0]].sort()).toEqual([200, 400]);
    expect([a, b].find((r) => r[0] === 400)).toEqual([400, { error: 'code_used_up' }]);
    const winners = [await owned(CID), await owned(DOT)].filter((o) => o['JR1-H01'] === 1);
    expect(winners).toHaveLength(1);
  });

  it('doesn’t use up a code on an account that has the deck already', async () => {
    const code = await store.createCode(deckProduct('jiaoren'), { uses: 1 });
    expect(await redeem(ANA, code)).toEqual([400, { error: 'already_owned' }]);
    expect((await redeem(EVE, code))[0]).toBe(200);
  });
});

describe('wrong codes', () => {
  it('are refused without saying more, and only a few an hour', async () => {
    const good = await store.createCode(deckProduct('jiaoren'));
    expect(await redeem(FAY, 'NOPE-NOPE-NOPE')).toEqual([400, { error: 'bad_code' }]);
    expect(await redeem(FAY, '')).toEqual([400, { error: 'bad_code' }]);
    expect(await redeem(FAY, { code: 1 })).toEqual([400, { error: 'bad_code' }]);
    for (let i = 0; i < 7; i++) await redeem(FAY, `WRONG${i}WRONG`);
    // Ten wrong codes: now even the right one waits, so codes can't be guessed.
    expect(await redeem(FAY, good)).toEqual([429, { error: 'too_many_codes' }]);
    expect(await owned(FAY)).toEqual({});
  });
});
