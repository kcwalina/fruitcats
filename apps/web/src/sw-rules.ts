// The offline worker's decisions, on their own. The worker itself (sw.ts) only moves bytes between the network and the
// caches; every choice it makes is a small function here, so the choices are tested without a browser
// (apps/web/test/sw-rules.test.ts). docs/offline.md explains the whole thing for someone new to it.
//
// Four kinds of answer, one per request:
//   - shell:    the game's own files (index.html, its scripts and styles, interface art, sounds, icons, the
//               manifest). Listed when the site is built, stored when the worker installs, always read from that
//               store. A new version of the site arrives as a new worker with a new list.
//   - packs:    card pack lists and set data (packs/index.json, set.json, on this site or the pack storage). They
//               change without a new build, so the network is asked first, briefly, and the stored copy is the
//               fallback when it doesn't answer.
//   - runtime:  card art from the pack storage and Google's fonts. Stored the first time they're seen, read from the
//               store after that (and quietly refreshed once a day), so an offline game still shows its cards.
//   - network:  everything else, untouched: the Fruitcats API, the sign-in service, Paddle, any other page of the
//               site, and anything that isn't a GET. The worker doesn't answer these at all.
//
// And the last-good fallback: when a new version fails to start twice in a row, the version that last started is
// served instead, for a while. A version that starts even once is the good one from then on, so no player is ever
// held on an old version for good.

/** How the worker answers one request. `key`: the address it is stored under (shell and packs). */
export type Route =
  | { strategy: 'shell'; key: string }
  /** The game's page: the site's, if it answers within PAGE_TIMEOUT_MS; else the stored one. */
  | { strategy: 'page'; key: string }
  | { strategy: 'packs'; key: string }
  | { strategy: 'runtime' }
  | { strategy: 'network' };

/** The parts of a request the route depends on. `mode` is 'navigate' when the browser is opening a page. */
export interface RequestInfo { url: string; method: string; mode?: string }

/** The worker's surroundings: where the game lives, what the build stored, and where the card packs are. */
export interface RouteContext {
  /** The worker's scope, e.g. https://fruitcats.viamochi.com/ (always ends in /). */
  scope: string;
  /** The shell files, as paths relative to the scope ('index.html', 'assets/main-abc.js'). */
  precache: ReadonlySet<string>;
  /** The pack storage's origin, e.g. https://fruitcatspacks.blob.core.windows.net. */
  packsOrigin: string;
}

/** Hosts whose files are kept once seen. Only what the game draws with: Google's fonts. (The pack storage is added.) */
export const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const IMAGE = /\.(webp|png|jpe?g|gif|svg|avif)$/i;

/** Which of the four answers `req` gets. */
export function route(req: RequestInfo, ctx: RouteContext): Route {
  if (req.method !== 'GET') return { strategy: 'network' };
  let url: URL;
  try { url = new URL(req.url); } catch { return { strategy: 'network' }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { strategy: 'network' };
  const scope = new URL(ctx.scope);

  if (url.origin === scope.origin) {
    if (!url.pathname.startsWith(scope.pathname)) return { strategy: 'network' };
    const path = decodeURIComponent(url.pathname.slice(scope.pathname.length));
    // The game's page, however it's opened (?mute, ?invite=…, ?prototypes): from the site when it answers in time, so a
    // reload always brings the newest version as it did before the worker; the stored index.html when it doesn't
    // (offline, or the site down). Other pages (the Studio, the Portal, the docs) aren't the game's: the network.
    if (req.mode === 'navigate') {
      return (path === '' || path === 'index.html') && ctx.precache.has('index.html')
        ? { strategy: 'page', key: 'index.html' } : { strategy: 'network' };
    }
    if (/^packs\/.+\.json$/.test(path)) return { strategy: 'packs', key: url.origin + url.pathname };
    // Built scripts and styles (assets/, named by their contents) and the game's other files are looked up in every
    // stored version, not only in this one's list: the last-good fallback serves an older version, whose scripts this
    // worker's list doesn't name. One that no stored version has comes from the network.
    if (ctx.precache.has(path) || path.startsWith('assets/') || isShellFile(path)) return { strategy: 'shell', key: path };
    return { strategy: 'network' };
  }

  if (url.origin === ctx.packsOrigin) {
    // Pack lists and set data change without a build; the art at an address rarely does.
    if (url.pathname.endsWith('.json')) return { strategy: 'packs', key: url.origin + url.pathname };
    if (IMAGE.test(url.pathname)) return { strategy: 'runtime' };
    return { strategy: 'network' };
  }

  if (FONT_HOSTS.includes(url.hostname)) return { strategy: 'runtime' };
  return { strategy: 'network' };
}

// ── The runtime store ───────────────────────────────────────────────────────────────────────────

/** At most this many pictures and font files are kept. Card art is 50–150 KB, so the store stays under ~60 MB. */
export const RUNTIME_MAX_ENTRIES = 500;
/** A kept picture is fetched again in the background once it's older than this, so new art reaches the player. */
export const RUNTIME_REFRESH_MS = 24 * 60 * 60 * 1000;
/** How long the site gets to send the game's page before the stored copy is served. */
export const PAGE_TIMEOUT_MS = 3000;

/** The version a page from the site runs, as the build wrote it into its index.html; null when it has none. */
export const versionInPage = (html: string): string | null =>
  /<meta name="folkborn-version" content="([^"]+)"/.exec(html)?.[1] ?? null;

/**
 * The game's page came from the site: serve it, or the stored page of the last version that started? The site's page
 * runs the site's version, so the same rule as chooseVersion applies to it: once that version has failed to start
 * twice lately and a version that started is stored, the stored one.
 */
export function pageToServe(state: BootState, siteVersion: string | null, stored: readonly string[], now: number): 'site' | string {
  if (!siteVersion) return 'site';
  const pick = chooseVersion(state, siteVersion, stored, now);
  return pick === siteVersion ? 'site' : pick;
}

/** How long the network gets to answer for a pack list before the stored copy is used (content.ts gives up at 1.5 s). */
export const PACKS_TIMEOUT_MS = 1000;

/** The oldest entries to drop so that `count` entries fit under `max` (entries come oldest first). */
export function evictions<T>(entries: readonly T[], max = RUNTIME_MAX_ENTRIES): T[] {
  return entries.length > max ? entries.slice(0, entries.length - max) : [];
}

/** Whether a kept entry stored at `storedAt` (ms, or null when unknown) should be refreshed in the background. */
export function needsRefresh(storedAt: number | null, now: number, maxAge = RUNTIME_REFRESH_MS): boolean {
  return storedAt == null || !Number.isFinite(storedAt) || now - storedAt > maxAge;
}

// ── Versions and the last-good fallback ─────────────────────────────────────────────────────────

/** Each version of the site's shell is stored in a cache of its own, named with this prefix and the version. */
export const SHELL_PREFIX = 'folkborn-shell-';
export const shellCache = (version: string) => SHELL_PREFIX + version;
export const versionOfCache = (name: string) => (name.startsWith(SHELL_PREFIX) ? name.slice(SHELL_PREFIX.length) : null);

/** A new version that fails to start this many times in a row gives way to the last good one. */
export const FAILURES_TO_FALL_BACK = 2;
/** For this long after its last failure. Then the new version is tried again (a failure can be the device's). */
export const FALLBACK_FOR_MS = 24 * 60 * 60 * 1000;

/** What the worker remembers between launches. */
export interface BootState {
  /** The last version that started. */
  good: string | null;
  /** Failed starts in a row, by version. A start clears its version's count. */
  failures: Record<string, number>;
  /** When the last failure was (ms). */
  lastFailureAt: number;
}

export const EMPTY_STATE: BootState = { good: null, failures: {}, lastFailureAt: 0 };

/** Read a stored state, tolerating anything (a state the worker can't read is a fresh one). */
export function readState(value: unknown): BootState {
  const v = (value ?? {}) as Partial<BootState>;
  const failures: Record<string, number> = {};
  if (v.failures && typeof v.failures === 'object')
    for (const [k, n] of Object.entries(v.failures)) if (typeof n === 'number' && n > 0) failures[k] = n;
  return {
    good: typeof v.good === 'string' ? v.good : null,
    failures,
    lastFailureAt: typeof v.lastFailureAt === 'number' ? v.lastFailureAt : 0,
  };
}

/** `version` started: it's the good one now, and its failures are forgotten. */
export function started(state: BootState, version: string): BootState {
  const failures = { ...state.failures };
  delete failures[version];
  return { ...state, good: version, failures };
}

/** `version` failed to start once more. */
export function failed(state: BootState, version: string, now: number): BootState {
  return { ...state, failures: { ...state.failures, [version]: (state.failures[version] ?? 0) + 1 }, lastFailureAt: now };
}

/**
 * Which version's shell to serve. The active worker's own `version`, unless it has failed to start twice in a row
 * (and not long ago) while an older version that did start is still stored: then that one.
 */
export function chooseVersion(state: BootState, version: string, stored: readonly string[], now: number): string {
  const good = state.good;
  if (!good || good === version || !stored.includes(good)) return version;
  if ((state.failures[version] ?? 0) < FAILURES_TO_FALL_BACK) return version;
  if (now - state.lastFailureAt > FALLBACK_FOR_MS) return version;
  return good;
}

/**
 * The shell caches to delete. While the active version hasn't started yet, the good one stays (it's the fallback);
 * everything else goes. Other caches (pictures, packs) are never touched here.
 */
export function staleCaches(names: readonly string[], version: string, good: string | null): string[] {
  return names.filter((n) => {
    const v = versionOfCache(n);
    return v != null && v !== version && v !== good;
  });
}

/**
 * What the page does after the game failed to start. Reload once (it may have been a passing hiccup); if the worker
 * then says an older version will be served, reload once more to get it; otherwise show the "couldn't load" message.
 */
export function afterFailure(opts: { reloaded: boolean; fellBack: boolean; fallbackReady: boolean }): 'reload' | 'fall-back' | 'give-up' {
  if (!opts.reloaded) return 'reload';
  if (opts.fallbackReady && !opts.fellBack) return 'fall-back';
  return 'give-up';
}

// ── The build's list ────────────────────────────────────────────────────────────────────────────

/**
 * The site's own files (not built from code) that the game needs: its page, interface art, sounds, icons, the
 * manifest and the card packs it ships with. Not the other pages (the Studio, the Portal, the docs) or their pictures
 * (guide/, studio/, the practice sets' cards), and not the Pawtraits (the sign-in service serves those).
 */
const SHELL_FILES = [
  /^index\.html$/, /^manifest\.webmanifest$/, /^apple-touch-icon\.png$/,
  /^ui\/[^/]+\.(webp|png|svg)$/, /^icons\/[^/]+\.png$/, /^sounds\/[^/]+\.(mp3|wav)$/, /^packs\/.+\.json$/,
];

/** In those folders but not the game's: the large painting the app icons are cut from (tools/make_icons.py). */
const NOT_SHELL = new Set(['ui/app-icon.webp']);

/** Whether a file of the built site (a path relative to dist, with /) is one of the game's own, not built from code. */
export const isShellFile = (path: string) => !NOT_SHELL.has(path) && SHELL_FILES.some((re) => re.test(path));

/**
 * Problems with a build's precache list: the page, its entry script (from index.html) and the pack list must all be
 * in it, or the game can't start offline. Empty when it's fine.
 */
export function precacheProblems(list: readonly string[], indexHtml: string): string[] {
  const problems: string[] = [];
  const have = new Set(list);
  if (!have.has('index.html')) problems.push('index.html is not in the precache list');
  if (!have.has('packs/index.json')) problems.push('packs/index.json is not in the precache list');
  const entry = /<script[^>]*type="module"[^>]*src="\.?\/?([^"]+)"/.exec(indexHtml)?.[1];
  if (!entry) problems.push('index.html loads no entry script');
  else if (!have.has(entry)) problems.push(`the entry script ${entry} is not in the precache list`);
  return problems;
}
