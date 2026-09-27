// The page's side of the offline worker (sw.ts): it registers the worker, and tells it whether this version started,
// so a version that fails to start gives way to the last one that did (sw-rules.ts, the last-good fallback). It also
// has the worker keep a Solo game's card pictures for the next game offline. docs/offline.md explains it all.
//
// A new version never takes over a page that is open. The browser installs it in the background and hands over once
// every window of the game has closed: the next launch. (Handing over earlier, with skipWaiting, can break a game in
// progress, whose next script would come from another version.)
//
// Only in a production build: `vite dev` never registers a worker (a stored copy of the game would hide every change
// you make). The build writes its version into index.html (<meta name="folkborn-version">); without it there is no
// worker to talk to.
//
// There's no telemetry service, so each start that fails is logged to the console and noted on the device
// (localStorage 'folkborn-boot-log', the last ten), with the version that started last ('folkborn-good-version').

const LOG_KEY = 'folkborn-boot-log';
const GOOD_KEY = 'folkborn-good-version';

/** This page's version, as the build wrote it into index.html; 'dev' when there is none. */
export function pageVersion(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="folkborn-version"]')?.content || 'dev';
}

const workerWanted = () => import.meta.env.PROD && 'serviceWorker' in navigator && pageVersion() !== 'dev';

/** Register the worker (after the game has started, so it doesn't compete with it for the connection). */
export function registerWorker(): void {
  if (!workerWanted()) return;
  // update(): ask for a new version at every launch (register() alone doesn't, once registered). Offline, it can't.
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => reg.update().catch(() => null))
    .catch((e) => console.warn('The offline worker could not be registered:', e));
}

/**
 * Fetch these pictures quietly, a few at a time, so the worker keeps them: when a Solo game starts, both decks' cards,
 * so the next game with them shows every card even offline (not only the ones this game happened to draw). Only while
 * the worker is running and the device is online; a picture already kept costs nothing.
 */
export function keepPictures(urls: string[]): void {
  if (!workerWanted() || !navigator.serviceWorker.controller || !navigator.onLine) return;
  const queue = [...new Set(urls)];
  const next = async (): Promise<void> => {
    const url = queue.shift();
    if (!url) return;
    await fetch(url, { mode: 'cors', credentials: 'omit' }).then((r) => r.blob()).catch(() => null);
    return next();
  };
  // After the game's first screen has drawn, so the fetches don't compete with it.
  setTimeout(() => { for (let i = 0; i < 3; i++) void next(); }, 2000);
}

/** Keep a note of this start on the device: the good version, or the failure (the last ten). */
function note(ok: boolean, version: string, error?: unknown): void {
  try {
    if (ok) { localStorage.setItem(GOOD_KEY, JSON.stringify({ version, at: new Date().toISOString() })); return; }
    const log = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as unknown[];
    log.push({ version, at: new Date().toISOString(), error: String((error as Error)?.stack ?? error).slice(0, 500) });
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-10)));
  } catch { /* storage full or blocked: the console still has it */ }
}

/**
 * Tell the worker (and the device's notes) whether this version started. Resolves with `fallbackReady`: the next load
 * will be served an older version that did start. Never waits more than a second for the worker's answer.
 */
export async function reportBoot(ok: boolean, error?: unknown): Promise<{ fallbackReady: boolean }> {
  const version = pageVersion();
  note(ok, version, error);
  if (!ok) console.error(`Folkborn ${version} failed to start:`, error);
  const worker = workerWanted() ? navigator.serviceWorker.controller : null;
  if (!worker) {
    // The very first visit isn't served by the worker yet; it learns this version started once it's running.
    if (ok && workerWanted()) void navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage({ type: 'boot', ok, version }));
    return { fallbackReady: false };
  }
  const answer = await new Promise<{ next?: string } | null>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => resolve(e.data as { next?: string });
    setTimeout(() => resolve(null), 1000);
    worker.postMessage({ type: 'boot', ok, version }, [channel.port2]);
  });
  return { fallbackReady: !ok && !!answer?.next && answer.next !== version };
}
