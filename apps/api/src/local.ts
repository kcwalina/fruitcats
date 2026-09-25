// The Fruitcats API on your own computer (npm run api:local), to try the Store before any of it goes to Azure.
// Rows are kept in JSON files in .local-api/ (git ignores it); nothing in Azure is read or written, and no Azure
// sign-in is needed. Sign-in itself is real: the game signs in to your Via Mochi account as usual, and this API checks
// the token against viamochi-id's public keys, like the real one.
//
// The Store is open to any signed-in account here, with test checkout on. Point the game at it with
//   VITE_API=http://localhost:8787 npm run dev      then open  http://localhost:5173/?store=1
// Settings already in your environment win, e.g. STORE_TESTERS=<your account id> to try the tester list.

import { fileURLToPath } from 'node:url';

process.env.LOCAL_DATA ??= fileURLToPath(new URL('../../../.local-api', import.meta.url));
process.env.PORT ??= '8787';
process.env.STORE ??= 'testers';
process.env.STORE_TESTERS ??= '*';
process.env.STORE_TEST_CHECKOUT ??= 'on';

await import('./server');
