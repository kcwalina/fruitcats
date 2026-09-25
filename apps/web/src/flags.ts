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
 * Online play with friends (docs/pvp-plan.md): the Friend tile, Play a friend, online games. On in the playtest build
 * (vite.config.ts) while it's tried out; in dev, `?online=1` turns it on. Off, the Friend tile says "Coming soon".
 */
export const ONLINE: boolean = ACCOUNTS && (import.meta.env.VITE_ONLINE === 'on'
  || (import.meta.env.DEV && new URLSearchParams(location.search).get('online') === '1'));
