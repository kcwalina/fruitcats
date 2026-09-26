// The Fruitcats API on your own computer (npm run api:local), to try the Store before any of it goes to Azure.
// Rows are kept in JSON files in .local-api/ (git ignores it); nothing in Azure is read or written, and no Azure
// sign-in is needed. Sign-in itself is real: the game signs in to your Via Mochi account as usual, and this API checks
// the token against viamochi-id's public keys, like the real one.
//
// The Store is open to any signed-in account here, with test checkout on. Point the game's dev server at it:
//   npm run dev, then open  http://localhost:5173/?store=1&buy=1&api=http://localhost:8790
// Settings already in your environment win, e.g. STORE_TESTERS=<your account id> to try the tester list.
//
// `npm run api:local -- --fake-paddle` pays through a pretend Paddle instead of test checkout: the game's whole payment
// flow (pending order, payment window, signed webhook, reveal) with no Paddle account. The game's dev server fakes
// Paddle's window (paddle.ts): it "pays" after a moment; add ?fakepay=close to close it unpaid, ?fakepay=slow for a
// webhook that takes 40 seconds.
//
// `npm run api:local -- --fake-sign-in` also takes "dev-<32 hex digits>" as a token for that account id, so automated
// checks can use the Store without an email code. Only here: the API on Azure never has LOCAL_DATA.

import { fileURLToPath } from 'node:url';

process.env.LOCAL_DATA ??= fileURLToPath(new URL('../../../.local-api', import.meta.url));
process.env.PORT ??= '8790';
process.env.STORE ??= 'testers';
process.env.STORE_TESTERS ??= '*';
const FAKE_PADDLE = process.argv.includes('--fake-paddle');
process.env.STORE_TEST_CHECKOUT ??= FAKE_PADDLE ? 'off' : 'on';
// The old Starter Box decks (free) and Heat Wave: Berry Picnic's art isn't drawn yet, and the Store never sells a card
// you can't see.
process.env.STORE_SETS ??= 'SB1,HW1';
if (process.argv.includes('--fake-sign-in')) process.env.FAKE_SIGN_IN = 'on';
// The playtest dashboard: any signed-in account is its owner here, and a runner may use the key "local-runner".
process.env.PLAYTEST_OWNERS ??= '*';
process.env.PLAYTEST_RUNNERS ??= 'local:65e8b2271188ce8bb781d5246627e2e0b24a984e1ec571b60bc5dc6dc40d156e';


await import('./server');

if (FAKE_PADDLE) {
  const { fakePaddle, FAKE_CONFIG } = await import('./fakepaddle');
  const { signFor } = await import('./paddle');
  const store = await import('./store');
  const fake = fakePaddle();
  store.usePaddle(FAKE_CONFIG, fake.api);
  let events = 0;
  store.useFakePay((txn, delayMs) => setTimeout(() => {
    const raw = Buffer.from(JSON.stringify({ event_id: `evt_local${String(++events).padStart(8, '0')}`, event_type: 'transaction.completed', data: fake.pay(txn) }));
    void store.paddleWebhook(signFor(raw, FAKE_CONFIG.webhookSecret), raw).then(([status]) => console.log(`fake Paddle: ${txn} paid, webhook answered ${status}`));
  }, delayMs));
  console.log('Payments go through a pretend Paddle (--fake-paddle).');
}
