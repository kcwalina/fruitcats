// The Fruitcats API on your own computer (npm run api:local), to try the Store before any of it goes to Azure.
// Rows are kept in JSON files in .local-api/ (git ignores it); nothing in Azure is read or written, and no Azure
// sign-in is needed. Sign-in itself is real: the game signs in to your Via Mochi account as usual, and this API checks
// the token against viamochi-id's public keys, like the real one.
//
// The Store is open to any signed-in account here, with test checkout on. Point the game's dev server at it:
//   npm run dev, then open  http://localhost:5173/?store=1&api=http://localhost:8790
// Settings already in your environment win, e.g. STORE_TESTERS=<your account id> to try the tester list.
//
// `npm run api:local -- --fake-sign-in` also takes "dev-<32 hex digits>" as a token for that account id, so automated
// checks can use the Store without an email code. Only here: the API on Azure never has LOCAL_DATA.

import { fileURLToPath } from 'node:url';

process.env.LOCAL_DATA ??= fileURLToPath(new URL('../../../.local-api', import.meta.url));
process.env.PORT ??= '8790';
process.env.STORE ??= 'testers';
process.env.STORE_TESTERS ??= '*';
process.env.STORE_TEST_CHECKOUT ??= 'on';
// Heat Wave only: Berry Picnic's art isn't drawn yet, and the Store never sells a card you can't see.
process.env.STORE_SETS ??= 'HW1';
if (process.argv.includes('--fake-sign-in')) process.env.FAKE_SIGN_IN = 'on';

await import('./server');
