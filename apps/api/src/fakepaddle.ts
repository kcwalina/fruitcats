// A pretend Paddle, for tests and for trying the Store's payments on your own computer
// (npm run api:local -- --fake-paddle). It keeps transactions in memory and pays or refunds them when told to. Never
// used on Azure: local.ts is the only place that switches it on, and only with LOCAL_DATA.

import type { Adjustment, Paddle, PaddleConfig, Transaction } from './paddle';

export const FAKE_CONFIG: PaddleConfig = {
  environment: 'sandbox', apiKey: 'pdl_sdbx_apikey_fake', webhookSecret: 'pdl_ntfset_fake', clientToken: 'test_local_fake',
  taxMode: 'internal', checkouts: true,
};

export function fakePaddle() {
  const txns = new Map<string, Transaction>();
  const adjustments: Adjustment[] = [];
  let n = 0;
  const f = {
    txns, adjustments, created: 0,
    /** The next getTransaction calls throw, as if the server crashed or Paddle was down. */
    failGets: 0,
    pay(id: string) {
      const t = txns.get(id);
      if (!t) throw new Error(`no transaction ${id}`);
      t.status = 'completed';
      t.invoice_number = `2026-${id.slice(-4)}`;
      t.updated_at = t.billed_at = new Date().toISOString();
      return structuredClone(t);
    },
    adjust(txn: string, action: Adjustment['action'], lines: number[] | 'all', type: 'full' | 'partial' = 'full', status: Adjustment['status'] = 'approved') {
      const t = txns.get(txn)!;
      const items = (t.details?.line_items ?? []).filter((_, i) => lines === 'all' || lines.includes(i)).map((l) => ({ item_id: l.id, type }));
      const a: Adjustment = { id: `adj_${String(adjustments.length + 1).padStart(12, '0')}`, action, status, transaction_id: txn, created_at: new Date().toISOString(), items };
      adjustments.push(a);
      return structuredClone(a);
    },
    api: {
      async createTransaction({ order, account, currency, items }) {
        f.created++;
        const id = `txn_${String(++n).padStart(12, '0')}`;
        const t: Transaction = {
          id, status: 'ready', currency_code: currency, custom_data: { fruitcats_order: order, fruitcats_account: account },
          items: items.map((it, i) => ({ price: { id: `pri_${n}_${i}`, custom_data: { product: it.product } } })),
          details: {
            totals: { grand_total: String(items.reduce((s, i) => s + i.unit * i.qty, 0)), currency_code: currency },
            line_items: items.map((_, i) => ({ id: `txnitm_${n}_${i}`, price_id: `pri_${n}_${i}` })),
          },
        };
        txns.set(id, t);
        return structuredClone(t);
      },
      async getTransaction(id) {
        if (f.failGets > 0) { f.failGets--; throw new Error('Paddle GET /transactions: 503'); }
        const t = txns.get(id);
        if (!t) throw new Error('not found');
        return structuredClone(t);
      },
      async *paidSince() { for (const t of txns.values()) if (t.status === 'completed') yield structuredClone(t); },
      async *adjustmentsSince() { for (const a of [...adjustments].reverse()) yield structuredClone(a); },
    } as Paddle,
  };
  return f;
}
