// What happens to an order (docs/store-plan.md, Requirements for the payment work). Pure: no storage, no network.
// store.ts reads the order, asks `transition` what it becomes, and writes the result together with the account's
// owned total in one batch; so an order is changed entirely or not at all.
//
//   test        a tester's order: cards, no money (counted only while test checkout is on)
//   pending     saved before paying, with our order id; Paddle's transaction names it
//   abandoned   pending for a long time, or Paddle cancelled the transaction. Only a label: a payment still makes it paid
//   paid        Paddle took the money. This is the grant: the order's cards are owned from now on
//   refunded    every line refunded (by Paddle, or taken back by hand): its cards are gone
//   charged_back  the same, after a chargeback
//   granted     given by hand, for support (the permanent log says who and why)
//   free        a free deck the player took from the Store (a $0 deck): cards, no money
//
// Rules the tests hold it to:
//   - One Paddle transaction marks one order paid, once. The same payment again changes nothing; a second payment for
//     an order already paid changes nothing either, and raises an alert (someone must refund it).
//   - A payment always counts, whatever else happened: a late webhook turns an abandoned order paid.
//   - A refund or chargeback is applied once per Paddle adjustment. A payment that arrives after its refund changes
//     nothing (webhooks can come in any order).
//   - A refund of part of an amount (not whole lines) takes no cards and raises an alert: the owner decides.

export type Status = 'test' | 'pending' | 'abandoned' | 'paid' | 'refunded' | 'charged_back' | 'granted' | 'free';

/** What an order holds, as store.ts keeps it. */
export interface OrderState {
  status: Status;
  /** Card id → copies the order brings. */
  grants: Record<string, number>;
  /** Product → the copies that line brings (so a refund of one line takes only its cards). */
  lineGrants: Record<string, Record<string, number>>;
  /** Paddle's transaction for this order, once checkout started. */
  txn?: string;
  /** Card id → copies taken back by refunds of single lines. */
  revoked?: Record<string, number>;
  /** Products whose lines were refunded. */
  refundedLines?: string[];
  /** Paddle adjustments already applied. */
  adjustments?: string[];
  paidAt?: string;
  /** What Paddle charged, tax included, in its smallest unit, and in what currency. */
  charged?: { amount: number; currency: string };
  /** Paddle's number on the receipt, so support can find the order. */
  receipt?: string;
  /** Paddle's line item id → our product, from the paid transaction (refunds name Paddle's lines). */
  items?: Record<string, string>;
}

export type Event =
  | { kind: 'checkout'; txn: string }
  | { kind: 'paid'; txn: string; at: string; amount: number; currency: string; receipt?: string; items: Record<string, string> }
  | { kind: 'cancelled' }
  | { kind: 'adjustment'; id: string; action: 'refund' | 'chargeback'; txn: string; lines: { item: string; whole: boolean }[] };

export interface Outcome {
  next: OrderState;
  changed: boolean;
  /** Something a person must look at. */
  alert?: string;
}

const same = (s: OrderState): Outcome => ({ next: s, changed: false });

export function transition(s: OrderState, e: Event): Outcome {
  switch (e.kind) {
    case 'checkout':
      if (s.status !== 'pending' || s.txn === e.txn) return same(s);
      // A new transaction for an order already waiting on one: only while the first was never paid (a retry after a
      // lost answer). The old one can't be paid any more once the player has the new one.
      return { next: { ...s, txn: e.txn }, changed: true };

    case 'paid': {
      if (s.status === 'test' || s.status === 'granted' || s.status === 'free') return { ...same(s), alert: `payment ${e.txn} names a ${s.status} order` };
      if (s.txn && s.txn !== e.txn && s.paidAt) return { ...same(s), alert: `order paid twice: ${s.txn} and ${e.txn}; refund ${e.txn}` };
      if (s.paidAt) return same(s);   // paid, refunded or charged back already: the same payment again
      return {
        next: {
          ...s, status: 'paid', txn: e.txn, paidAt: e.at, charged: { amount: e.amount, currency: e.currency },
          items: e.items, ...(e.receipt ? { receipt: e.receipt } : {}),
        },
        changed: true,
      };
    }

    case 'cancelled':
      return s.status === 'pending' ? { next: { ...s, status: 'abandoned' }, changed: true } : same(s);

    case 'adjustment': {
      if (s.adjustments?.includes(e.id)) return same(s);
      if (!s.paidAt || s.txn !== e.txn) return { ...same(s), alert: `${e.action} ${e.id} for ${e.txn}, which hasn't paid this order` };
      const done = [...(s.adjustments ?? []), e.id];
      const partial = e.lines.some((l) => !l.whole);
      const products = e.lines.filter((l) => l.whole).map((l) => s.items?.[l.item]).filter((p): p is string => !!p);
      const unknown = e.lines.some((l) => l.whole && !s.items?.[l.item]);
      if (partial || unknown || !products.length) {
        return {
          next: { ...s, adjustments: done }, changed: true,
          alert: `${e.action} ${e.id} of part of an amount on order paid by ${e.txn}: no cards taken; decide by hand`,
        };
      }
      const refundedLines = [...new Set([...(s.refundedLines ?? []), ...products])];
      const all = Object.keys(s.lineGrants).every((p) => refundedLines.includes(p));
      const revoked: Record<string, number> = {};
      for (const p of refundedLines) for (const [id, n] of Object.entries(s.lineGrants[p] ?? {})) revoked[id] = (revoked[id] ?? 0) + n;
      const status: Status = all ? (e.action === 'chargeback' ? 'charged_back' : 'refunded') : s.status;
      return { next: { ...s, status, adjustments: done, refundedLines, revoked }, changed: true };
    }
  }
}

/** Card id → copies this order gives its account now. */
export function held(s: OrderState, countTests = false): Record<string, number> {
  if (!(s.status === 'paid' || s.status === 'granted' || s.status === 'free' || (s.status === 'test' && countTests))) return {};
  const have: Record<string, number> = {};
  for (const [id, n] of Object.entries(s.grants)) {
    const left = n - (s.revoked?.[id] ?? 0);
    if (left > 0) have[id] = left;
  }
  return have;
}

/** Everything these orders give, added up. */
export function total(orders: OrderState[], countTests = false): Record<string, number> {
  const sum: Record<string, number> = {};
  for (const o of orders) for (const [id, n] of Object.entries(held(o, countTests))) sum[id] = (sum[id] ?? 0) + n;
  return sum;
}
