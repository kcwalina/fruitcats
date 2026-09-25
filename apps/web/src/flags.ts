// Feature flags, fixed at build time. The public build leaves them off, and because Vite replaces
// import.meta.env.* with constants, the code behind a flag is dropped from that build entirely. The playtest
// build (`npm run build:playtest`, see vite.config.ts) turns them on. In dev, `?accounts=1` does too.
// Keep each flag a plain expression of import.meta.env, so the bundler can fold it to a constant.

/** Via Mochi accounts: sign-in, sync and the Account screen (docs/accounts.md). */
export const ACCOUNTS: boolean = import.meta.env.VITE_ACCOUNTS === 'on'
  || (import.meta.env.DEV && new URLSearchParams(location.search).get('accounts') === '1');
