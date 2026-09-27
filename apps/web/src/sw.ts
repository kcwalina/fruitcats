// The offline worker (a service worker): it keeps the game's own files on the device, so Folkborn starts and a Solo
// game plays with no connection, or while the site itself is down, like an app installed from a store.
//
// It is built on its own, at the end of the site's build (vite.config.ts, offlineWorker), into dist/sw.js, with the
// build's list of files and a version made from them written in (the three constants below). The page registers it
// (offline.ts) in a production build only, never in `vite dev`. Every decision it makes (what to answer from where,
// which version to serve) is in sw-rules.ts, tested on its own; this file only moves bytes. docs/offline.md has the
// whole picture.
//
// Updates: the page asks for sw.js again at each launch (offline.ts). A new version stores its files in the background,
// in a cache of its own, and then waits. The browser hands over once every window of the game has closed, so the new
// version takes over at the next launch and never in the middle of a game (no skipWaiting: a page running one version
// while another serves its files can fail to load its next script). The previous version's files stay until the new
// version has started once (the last-good fallback).

import {
  EMPTY_STATE, PACKS_TIMEOUT_MS, SHELL_PREFIX, chooseVersion, evictions, failed, needsRefresh, readState, route,
  shellCache, staleCaches, started, versionOfCache, type BootState, type RouteContext,
} from './sw-rules';

declare const __SW_VERSION__: string;
declare const __SW_PRECACHE__: string[];
declare const __SW_PACKS_ORIGIN__: string;

const VERSION = __SW_VERSION__;
const RUNTIME = 'folkborn-runtime';
const PACKS = 'folkborn-packs';
const META = 'folkborn-meta';
/** Stamped on each kept picture: when it was stored, for the daily refresh. */
const STORED_AT = 'x-folkborn-stored';

// The worker's own types, kept small: the project compiles against the page's library (DOM), not the worker's.
interface ExtendableEvent extends Event { waitUntil(p: Promise<unknown>): void }
interface FetchEvent extends ExtendableEvent { request: Request; respondWith(r: Response | Promise<Response>): void }
interface MessageEventLike extends ExtendableEvent { data: unknown; ports: readonly MessagePort[] }
interface WorkerScope {
  registration: ServiceWorkerRegistration;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', fn: (e: MessageEventLike) => void): void;
}
const worker = self as unknown as WorkerScope;

const scope = () => worker.registration.scope;
const ctx = (): RouteContext => ({ scope: scope(), precache: new Set(__SW_PRECACHE__), packsOrigin: __SW_PACKS_ORIGIN__ });
const address = (path: string) => new URL(path, scope()).href;

// ── What the worker remembers between launches (sw-rules.ts, BootState) ───────────────────────────

let state: Promise<BootState> | null = null;
const stateKey = () => address('__folkborn/boot-state.json');

function loadState(): Promise<BootState> {
  state ??= caches.open(META).then((c) => c.match(stateKey())).then((r) => (r ? r.json() : null))
    .then(readState, () => EMPTY_STATE);
  return state;
}

async function saveState(next: BootState): Promise<void> {
  state = Promise.resolve(next);
  const c = await caches.open(META);
  await c.put(stateKey(), new Response(JSON.stringify(next), { headers: { 'content-type': 'application/json' } }));
}

async function storedVersions(): Promise<string[]> {
  return (await caches.keys()).map(versionOfCache).filter((v): v is string => v != null);
}

async function servedVersion(): Promise<string> {
  return chooseVersion(await loadState(), VERSION, await storedVersions(), Date.now());
}

// ── Install, activate ──────────────────────────────────────────────────────────────────────────

/** A response as the browser can hand to any request (one that came through a redirect can't answer a page load). */
async function plain(res: Response): Promise<Response> {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

worker.addEventListener('install', (e) => {
  // Every file, fresh from the site (not the browser's HTTP cache), or the install fails and the old version stays.
  e.waitUntil((async () => {
    const cache = await caches.open(shellCache(VERSION));
    await Promise.all(__SW_PRECACHE__.map(async (path) => {
      const res = await fetch(new Request(address(path), { cache: 'reload' }));
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      await cache.put(address(path), await plain(res));
    }));
  })());
});

worker.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Keep this version and the last one that started (the fallback); drop the rest.
    const { good } = await loadState();
    for (const name of staleCaches(await caches.keys(), VERSION, good)) await caches.delete(name);
    await worker.clients.claim();
  })());
});

// ── Answering requests ─────────────────────────────────────────────────────────────────────────

worker.addEventListener('fetch', (e) => {
  const req = e.request;
  const r = route({ url: req.url, method: req.method, mode: req.mode }, ctx());
  if (r.strategy === 'network') return;   // not answered: the browser goes to the network as if there were no worker
  if (r.strategy === 'shell') e.respondWith(fromShell(r.key, req));
  else if (r.strategy === 'packs') e.respondWith(packs(r.key, req, e));
  else e.respondWith(runtime(req, e));
});

/** A shell file from the version being served; any stored version's copy, or the network, if it's missing. */
async function fromShell(path: string, req: Request): Promise<Response> {
  const url = address(path);
  const own = await (await caches.open(shellCache(await servedVersion()))).match(url);
  if (own) return own;
  for (const name of await caches.keys()) {
    if (!name.startsWith(SHELL_PREFIX)) continue;
    const hit = await (await caches.open(name)).match(url);
    if (hit) return hit;
  }
  return fetch(req);
}

/** Pack lists and set data: the network if it answers within PACKS_TIMEOUT_MS, else the last copy kept. */
async function packs(key: string, req: Request, e: ExtendableEvent): Promise<Response> {
  const cache = await caches.open(PACKS);
  const network = fetch(req).then(async (res) => {
    if (res.ok) await cache.put(key, res.clone());
    return res;
  });
  e.waitUntil(network.catch(() => null));   // a slow answer still updates the kept copy
  const answer = await Promise.race([
    network.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), PACKS_TIMEOUT_MS)),
  ]);
  if (answer?.ok) return answer;
  const kept = await cache.match(key) ?? (key.startsWith(scope()) ? await fromShellOnly(key.slice(scope().length)) : undefined);
  return kept ?? answer ?? Response.error();
}

async function fromShellOnly(path: string): Promise<Response | undefined> {
  return (await caches.open(shellCache(await servedVersion()))).match(address(path));
}

/** Card art and fonts: the kept copy if there is one (refreshed in the background once a day), else the network. */
async function runtime(req: Request, e: ExtendableEvent): Promise<Response> {
  const cache = await caches.open(RUNTIME);
  const kept = await cache.match(req.url);
  if (kept) {
    if (needsRefresh(Number(kept.headers.get(STORED_AT)) || null, Date.now())) e.waitUntil(fetchAndKeep(req, cache).catch(() => null));
    return kept;
  }
  return fetchAndKeep(req, cache, e);
}

async function fetchAndKeep(req: Request, cache: Cache, e?: ExtendableEvent): Promise<Response> {
  // Asked for with CORS (the pack storage and Google's fonts allow it), so the answer can be read and kept at its real
  // size: an <img>'s own request is "no-cors", whose answers can't be checked and count as megabytes against the quota.
  let res: Response;
  try { res = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); } catch { return fetch(req); }
  if (!res.ok) return res;
  const keep = (async () => {
    const headers = new Headers(res.headers);
    headers.set(STORED_AT, String(Date.now()));
    await cache.put(req.url, new Response(await res.clone().blob(), { status: res.status, statusText: res.statusText, headers }));
    for (const old of evictions(await cache.keys())) await cache.delete(old);
  })().catch(() => null);
  if (e) e.waitUntil(keep); else await keep;
  return res;
}

// ── Messages from the page (offline.ts) ────────────────────────────────────────────────────────

worker.addEventListener('message', (e) => {
  const msg = e.data as { type?: string; ok?: boolean; version?: string } | null;
  if (msg?.type !== 'boot' || typeof msg.version !== 'string') return;
  const version = msg.version;
  e.waitUntil((async () => {
    const now = Date.now();
    const before = await loadState();
    const next = msg.ok ? started(before, version) : failed(before, version, now);
    await saveState(next);
    // This version started: the older copies aren't needed as a fallback any more. Not while a newer version is
    // installing or waiting, though: its cache is among the others, and it cleans up itself when it takes over.
    const reg = worker.registration;
    if (msg.ok && version === VERSION && !reg.installing && !reg.waiting)
      for (const name of staleCaches(await caches.keys(), VERSION, VERSION)) await caches.delete(name);
    e.ports[0]?.postMessage({ next: chooseVersion(next, VERSION, await storedVersions(), now), active: VERSION });
  })());
});
