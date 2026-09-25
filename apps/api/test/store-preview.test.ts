// STORE=preview: everyone signed in may look around the Store, nobody can buy, and test orders placed earlier (while
// the Store was in its tester test) no longer count as owned cards.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { cardProduct, deckProduct } from '@fruitcats/store';

const ALICE = 'a'.repeat(32);   // was a tester, with a test order
const BOB = 'b'.repeat(32);     // never a tester
type Store = typeof import('../src/store');
let preview: Store;

const call = (s: Store, user: string, method: string, path: string, body: unknown = {}) => s.storeRequest(user, method, path, async () => body);

beforeAll(async () => {
  process.env.LOCAL_DATA = mkdtempSync(join(tmpdir(), 'fruitcats-preview-'));
  process.env.STORE = 'preview';
  process.env.STORE_TESTERS = ALICE;
  process.env.STORE_TEST_CHECKOUT = 'on';
  // A test order Alice placed while the Store was in its tester test.
  const { table } = await import('../src/tables');
  await table('orders').add({
    partitionKey: ALICE, rowKey: 'earlier-test-order', status: 'test', createdAt: new Date().toISOString(),
    total: 999, currency: 'USD', lines: '[]', grants: JSON.stringify({ 'HW1-X01': 1 }),
  });
  preview = await import('../src/store');
});

describe('STORE=preview', () => {
  it('lets any account look around, with no test checkout', async () => {
    for (const user of [ALICE, BOB]) {
      const [status, body] = await call(preview, user, 'GET', '/v1/store') as [number, { catalog: { products: object }; testCheckout: boolean }];
      expect(status).toBe(200);
      expect(Object.keys(body.catalog.products)).toContain(deckProduct('five-alarm'));
      expect(body.testCheckout).toBe(false);
    }
  });

  it('refuses every checkout and reset, testers included', async () => {
    const cart = [{ product: cardProduct('HW1-X01'), qty: 1 }];
    for (const user of [ALICE, BOB]) {
      expect((await call(preview, user, 'POST', '/v1/store/test-checkout', { orderId: `preview-${user.slice(0, 4)}`, cart, total: 49 }))[0]).toBe(403);
      expect((await call(preview, user, 'POST', '/v1/store/test-reset'))[0]).toBe(403);
    }
  });

  it('offers no way to pay, even with Paddle set up and checkouts on: Add to cart stays "Coming soon"', async () => {
    const { FAKE_CONFIG, fakePaddle } = await import('../src/fakepaddle');
    const fake = fakePaddle();
    preview.usePaddle(FAKE_CONFIG, fake.api);
    const cart = [{ product: deckProduct('five-alarm'), qty: 1 }];
    for (const user of [ALICE, BOB]) {
      const [, body] = await call(preview, user, 'GET', '/v1/store') as [number, { payments?: unknown; testCheckout: boolean }];
      expect(body.payments).toBeUndefined();
      expect(body.testCheckout).toBe(false);
      expect(await call(preview, user, 'POST', '/v1/store/checkout', { orderId: `preview-pay-${user.slice(0, 4)}`, cart, total: 999 })).toEqual([403, { error: 'payments_off' }]);
    }
    expect(fake.created).toBe(0);
    preview.usePaddle(null, null);
  });

  it('no longer counts the test orders as owned cards', async () => {
    expect(await preview.purchasedCards(ALICE)).toEqual({});
    const [, body] = await call(preview, ALICE, 'GET', '/v1/store') as [number, { owned: object; orders: unknown[] }];
    expect(body.owned).toEqual({});
    expect(body.orders).toEqual([]);
  });
});
