// Feature flags, fixed at build time. The public build leaves them off, and because Vite replaces
// import.meta.env.* with constants, the code behind a flag is dropped from that build entirely. The playtest
// build (`npm run build:playtest`, see vite.config.ts) turns them on. In dev, `?accounts=1` does too.
// Keep each flag a plain expression of import.meta.env, so the bundler can fold it to a constant.

/** Via Mochi accounts: sign-in, sync and the Account screen (docs/accounts.md). */
export const ACCOUNTS: boolean = import.meta.env.VITE_ACCOUNTS === 'on'
  || (import.meta.env.DEV && new URLSearchParams(location.search).get('accounts') === '1');

/**
 * The Store (docs/store-plan.md): browsing, the cart and test checkout. In every build (vite.config.ts); what keeps it
 * hidden is the Fruitcats API, which opens it only to the accounts on its tester list. Turning this off removes it.
 */
export const STORE: boolean = import.meta.env.VITE_STORE === 'on'
  || (import.meta.env.DEV && new URLSearchParams(location.search).get('store') === '1');

/**
 * Online play with friends (docs/pvp-plan.md): the Friend tile, Play a friend, online games. On in every build
 * (vite.config.ts): it needs an account, and accounts are invite-only for now. In dev, `?online=1` turns it on. Off,
 * the Friend tile says "Coming soon". To stop online play without a new build: LIVE=off on the API.
 */
export const ONLINE: boolean = ACCOUNTS && (import.meta.env.VITE_ONLINE === 'on'
  || (import.meta.env.DEV && new URLSearchParams(location.search).get('online') === '1'));

/**
 * Buying in the Store: the cart, checkout and payments. **Off in every build**, by the owner's rule (2026-09-25):
 * "Add to cart" says "Coming soon" whatever the API allows, so setting up Paddle or changing an API setting can never
 * open the Store by itself. Opening it is an explicit decision, made by changing this line and releasing a new build.
 * Only the dev server can turn it on (`?buy=1`), to try the flow against a local API (npm run api:local).
 */
export const BUYING: boolean = import.meta.env.DEV && new URLSearchParams(location.search).get('buy') === '1';
