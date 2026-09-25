// Feature flags, fixed at build time. The public build leaves them off, and because Vite replaces
// import.meta.env.* with constants, the code behind a flag is dropped from that build entirely. The playtest
// build (`npm run build:playtest`, see vite.config.ts) turns them on. In dev, `?accounts=1` does too.
// Keep each flag a plain expression of import.meta.env, so the bundler can fold it to a constant.

/** Via Mochi accounts: sign-in, sync and the Account screen (docs/accounts.md). */
export const ACCOUNTS: boolean = import.meta.env.VITE_ACCOUNTS === 'on'
  || (import.meta.env.DEV && new URLSearchParams(location.search).get('accounts') === '1');

/**
 * The Store (docs/store-plan.md): browsing, the cart and test checkout. Compiled into the playtest build only, and even
 * there the Fruitcats API shows it only to accounts on its tester list. In dev, `?store=1`.
 */
export const STORE: boolean = import.meta.env.VITE_STORE === 'on'
  || (import.meta.env.DEV && new URLSearchParams(location.search).get('store') === '1');
