// Paddle's payment window (Paddle.js v2, docs/store-plan.md, Take the payment). Paddle is the seller: its window
// takes the card, Apple Pay, Google Pay or PayPal, adds any tax and sends the receipt. We never see payment details.
// The script is loaded only when someone pays, from Paddle's own address, and opened on the transaction the API made
// for the order; so nothing here decides a price or grants a card.

import { fakePay, type Payments } from './shop';

/** The local API's pretend Paddle (npm run api:local -- --fake-paddle): dev builds only. */
const FAKE_TOKEN = 'test_local_fake';

interface PaddleEvent { name?: string }
interface PaddleJs {
  Environment: { set(env: 'sandbox'): void };
  Initialize(options: { token: string; eventCallback: (e: PaddleEvent) => void }): void;
  Checkout: {
    open(options: { transactionId: string; settings?: Record<string, unknown>; customer?: { email: string } }): void;
    close(): void;
  };
}

const SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';

let loading: Promise<PaddleJs> | null = null;
let initialized = '';
/** The window that's open now: how it ends. */
let current: ((how: 'paid' | 'closed' | 'failed') => void) | null = null;

function load(): Promise<PaddleJs> {
  return (loading ??= new Promise<PaddleJs>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => {
      window.clearTimeout(slow);
      const p = (window as unknown as { Paddle?: PaddleJs }).Paddle;
      if (p) resolve(p); else reject(new Error('Paddle.js loaded without Paddle'));
    };
    const failed = () => { window.clearTimeout(slow); s.remove(); loading = null; reject(new Error('Paddle.js didn’t load')); };
    s.onerror = failed;
    // A script request lost on a dropped connection never ends by itself: "Opening payment…" would stay up for ever.
    const slow = window.setTimeout(() => { if (!(window as unknown as { Paddle?: PaddleJs }).Paddle) failed(); }, 20_000);
    document.head.appendChild(s);
  }));
}

/**
 * Open Paddle's window on this transaction. Resolves 'paid' when Paddle says the payment went through, 'closed' if the
 * player closed it first, 'failed' if the window couldn't open. Paid means Paddle took the money; the cards come when
 * the API has confirmed it (confirmOrder).
 */
export async function payWithPaddle(payments: Payments, transactionId: string): Promise<'paid' | 'closed' | 'failed'> {
  if (import.meta.env.DEV && payments.clientToken === FAKE_TOKEN) return fakeWindow(transactionId);
  let paddle: PaddleJs;
  try { paddle = await load(); } catch { return 'failed'; }
  if (initialized !== payments.clientToken) {
    if (payments.environment === 'sandbox') paddle.Environment.set('sandbox');
    paddle.Initialize({
      token: payments.clientToken,
      eventCallback(e) {
        if (e.name === 'checkout.completed') {
          // Our own screen takes over from Paddle's thank-you page: the cards being added, then the reveal.
          const done = current;
          current = null;
          paddle.Checkout.close();
          done?.('paid');
        } else if (e.name === 'checkout.closed') {
          const done = current;
          current = null;
          done?.('closed');
        }
      },
    });
    initialized = payments.clientToken;
  }
  return new Promise((resolve) => {
    current = resolve;
    try {
      paddle.Checkout.open({ transactionId, settings: { displayMode: 'overlay', theme: 'light', locale: 'en', variant: 'one-page' } });
    } catch {
      current = null;
      resolve('failed');
    }
  });
}

/** Dev only: a pause where Paddle's window would be, then paid (or closed, with ?fakepay=close). */
async function fakeWindow(txn: string): Promise<'paid' | 'closed' | 'failed'> {
  const how = new URLSearchParams(location.search).get('fakepay');
  await new Promise((r) => setTimeout(r, 1500));
  if (how === 'close') return 'closed';
  return (await fakePay(txn, how === 'slow' ? 40_000 : 300)) ? 'paid' : 'failed';
}
