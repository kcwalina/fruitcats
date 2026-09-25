// Paddle Billing, the Merchant of Record for the web Store (docs/store-plan.md, Take the payment). Only what the
// Store needs: create a transaction for an order, read one back, list recent ones and their refunds, and check a
// webhook's signature. The API key never leaves the server; the game gets only the client-side token.
//
// Settings (app settings on fruitcats-api; never printed or logged):
//   PADDLE_API_KEY          pdl_sdbx_apikey_… (sandbox) or pdl_live_apikey_… (live): the keys say which Paddle they're for
//   PADDLE_WEBHOOK_SECRET   the notification destination's secret key (pdl_ntfset_…)
//   PADDLE_CLIENT_TOKEN     test_… (sandbox) or live_… (live): public, handed to Paddle.js in the game
//   PADDLE_TAX_MODE         internal (the shown price includes any tax; the default) | external (tax added at checkout)
//   STORE_PAYMENTS          off (default) | sandbox | live: whether new checkouts may start. It must name the keys'
//                           environment, so a sandbox test can never charge a real card, and a live key is never used
//                           by accident.
// With the keys set, webhooks and the regular check keep working even with STORE_PAYMENTS=off (or STORE=off): a
// refund or a late payment for an order already made must always land.

import { createHmac, timingSafeEqual } from 'node:crypto';

export type Environment = 'sandbox' | 'live';

export interface PaddleConfig {
  environment: Environment;
  apiKey: string;
  webhookSecret: string;
  clientToken: string;
  taxMode: 'internal' | 'external';
  /** New checkouts may start (STORE_PAYMENTS names this environment). */
  checkouts: boolean;
}

/** The configured payments, or why there are none. Never includes a secret in `problem`. */
export function paddleConfig(env: NodeJS.ProcessEnv = process.env): { config: PaddleConfig | null; problem?: string } {
  const mode = env.STORE_PAYMENTS ?? 'off';
  if (mode !== 'off' && mode !== 'sandbox' && mode !== 'live') return { config: null, problem: `STORE_PAYMENTS=${mode} isn't off, sandbox or live` };
  const apiKey = env.PADDLE_API_KEY ?? '', webhookSecret = env.PADDLE_WEBHOOK_SECRET ?? '', clientToken = env.PADDLE_CLIENT_TOKEN ?? '';
  if (!apiKey && !webhookSecret && !clientToken) return { config: null, ...(mode !== 'off' ? { problem: `STORE_PAYMENTS=${mode} but no Paddle keys are set` } : {}) };
  if (!apiKey || !webhookSecret || !clientToken) return { config: null, problem: 'a Paddle setting is missing (PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET, PADDLE_CLIENT_TOKEN)' };
  // Paddle's keys say which environment they're for. Older API keys have no prefix; only the new kind is accepted.
  const environment: Environment | null = apiKey.startsWith('pdl_sdbx_') ? 'sandbox' : apiKey.startsWith('pdl_live_') ? 'live' : null;
  if (!environment) return { config: null, problem: 'PADDLE_API_KEY is neither a sandbox (pdl_sdbx_) nor a live (pdl_live_) key' };
  if (!clientToken.startsWith(environment === 'sandbox' ? 'test_' : 'live_')) return { config: null, problem: `PADDLE_CLIENT_TOKEN isn't a ${environment} token, like PADDLE_API_KEY` };
  if (mode !== 'off' && mode !== environment) return { config: null, problem: `STORE_PAYMENTS=${mode}, but the Paddle keys are ${environment} keys` };
  const taxMode = env.PADDLE_TAX_MODE === 'external' ? 'external' : 'internal';
  return { config: { environment, apiKey, webhookSecret, clientToken, taxMode, checkouts: mode === environment } };
}

// ── Webhook signatures ───────────────────────────────────────────────────────────────────────────

/**
 * Is this webhook from Paddle? The header is "ts=<unix seconds>;h1=<hex HMAC-SHA256 of `${ts}:${body}`>", with more
 * than one h1 while a secret is being rotated. The body must be exactly the bytes received. `toleranceSeconds` refuses
 * an old message sent again (a replay would change nothing anyway: every event is applied once).
 */
export function verifySignature(header: string | undefined, body: Buffer, secret: string, now = Date.now(), toleranceSeconds = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(';').map((p) => p.trim().split('='));
  const ts = parts.find(([k]) => k === 'ts')?.[1];
  const sigs = parts.filter(([k]) => k === 'h1').map(([, v]) => v ?? '');
  if (!ts || !/^\d{1,12}$/.test(ts) || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(ts)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${ts}:`).update(body).digest();
  return sigs.some((s) => {
    if (!/^[0-9a-f]{64}$/i.test(s)) return false;
    return timingSafeEqual(Buffer.from(s, 'hex'), expected);
  });
}

/** For tests and drills: the header Paddle would send. */
export function signFor(body: string | Buffer, secret: string, now = Date.now()): string {
  const ts = Math.floor(now / 1000);
  return `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:`).update(body).digest('hex')}`;
}

// ── What Paddle sends back (only the fields we use) ──────────────────────────────────────────────

export interface Transaction {
  id: string;
  status: 'draft' | 'ready' | 'billed' | 'paid' | 'completed' | 'canceled' | 'past_due';
  custom_data?: { fruitcats_order?: string; fruitcats_account?: string } | null;
  currency_code?: string;
  invoice_number?: string | null;
  updated_at?: string;
  billed_at?: string | null;
  items?: { price?: { id?: string; custom_data?: { product?: string } | null } }[];
  details?: {
    totals?: { grand_total?: string; total?: string; currency_code?: string };
    line_items?: { id: string; price_id: string }[];
  };
}

export interface Adjustment {
  id: string;
  action: 'refund' | 'chargeback' | 'chargeback_reverse' | 'chargeback_warning' | 'credit' | 'credit_reverse';
  status: 'pending_approval' | 'approved' | 'rejected' | 'reversed';
  transaction_id: string;
  created_at?: string;
  items?: { item_id: string; type: 'full' | 'partial' | 'tax' | 'proration' }[];
}

/** Money: paid (or completed, which comes just after). */
export const isPaid = (t: Transaction) => t.status === 'paid' || t.status === 'completed';

/** Paddle's line item id → our product, from the transaction's own items. */
export function itemProducts(t: Transaction): Record<string, string> {
  const byPrice = new Map((t.items ?? []).map((i) => [i.price?.id, i.price?.custom_data?.product]));
  const map: Record<string, string> = {};
  for (const line of t.details?.line_items ?? []) {
    const product = byPrice.get(line.price_id);
    if (product) map[line.id] = product;
  }
  return map;
}

// ── The API ──────────────────────────────────────────────────────────────────────────────────────

export interface NewItem { product: string; name: string; description: string; unit: number; qty: number }

export interface Paddle {
  createTransaction(input: { order: string; account: string; currency: string; items: NewItem[] }): Promise<Transaction>;
  getTransaction(id: string): Promise<Transaction>;
  /** Paid or completed transactions changed since this time, oldest first. */
  paidSince(since: string): AsyncIterable<Transaction>;
  /** Adjustments created since this time, newest first. */
  adjustmentsSince(since: string): AsyncIterable<Adjustment>;
}

export class PaddleError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function paddleApi(config: PaddleConfig, fetchImpl: typeof fetch = fetch): Paddle {
  const base = config.environment === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
  async function call<T>(method: string, pathOrUrl: string, body?: unknown): Promise<{ data: T; meta?: { pagination?: { next?: string; has_more?: boolean } } }> {
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${base}${pathOrUrl}`;
    if (!url.startsWith(base)) throw new Error('Paddle link outside the API');
    const res = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({})) as { data?: T; meta?: never; error?: { code?: string; detail?: string } };
    // The error's own words, never the request (which carries no secret anyway: the key is only in the header).
    if (!res.ok) throw new PaddleError(res.status, json.error?.code ?? 'unknown', `Paddle ${method} ${url.slice(base.length).split('?')[0]}: ${res.status} ${json.error?.code ?? ''}`);
    return { data: json.data as T, meta: json.meta };
  }
  async function* pages<T>(first: string): AsyncIterable<T> {
    let next: string | undefined = first;
    for (let page = 0; next && page < 50; page++) {
      const r: { data: T[]; meta?: { pagination?: { next?: string; has_more?: boolean } } } = await call<T[]>('GET', next);
      yield* r.data;
      next = r.meta?.pagination?.has_more ? r.meta.pagination.next : undefined;
    }
  }
  return {
    async createTransaction({ order, account, currency, items }) {
      const r = await call<Transaction>('POST', '/transactions', {
        // Priced here, from the Store's own rules: Paddle never takes a price from the game, and nothing is set up
        // in Paddle's catalog to drift from ours.
        items: items.map((i) => ({
          quantity: i.qty,
          price: {
            description: i.description, name: i.name,
            unit_price: { amount: String(i.unit), currency_code: currency },
            tax_mode: config.taxMode,
            product: { name: i.name, description: i.description, tax_category: 'standard' },
            custom_data: { product: i.product },
          },
        })),
        currency_code: currency,
        collection_mode: 'automatic',
        custom_data: { fruitcats_order: order, fruitcats_account: account },
      });
      return r.data;
    },
    async getTransaction(id) {
      if (!/^txn_[a-z0-9]{10,40}$/.test(id)) throw new Error('not a transaction id');
      return (await call<Transaction>('GET', `/transactions/${id}`)).data;
    },
    async *paidSince(since) {
      const q = new URLSearchParams({ status: 'paid,completed', 'updated_at[GTE]': since, order_by: 'updated_at[ASC]', per_page: '100' });
      yield* pages<Transaction>(`/transactions?${q}`);
    },
    async *adjustmentsSince(since) {
      const q = new URLSearchParams({ action: 'refund,chargeback,chargeback_reverse,chargeback_warning', order_by: 'id[DESC]', per_page: '50' });
      for await (const a of pages<Adjustment>(`/adjustments?${q}`)) {
        if (a.created_at && a.created_at < since) return;
        yield a;
      }
    },
  };
}
