// The game's entry point: load the card sets (built in, then any newer card packs on the site), and only
// then start the game, so every screen sees the full catalog from its first render.
//
// Whether the game started is reported to the offline worker (offline.ts, docs/offline.md), which serves the last
// version that started when a new one fails to start twice in a row.
import { loadPacks } from './content';
import { registerWorker, reportBoot } from './offline';
import { afterFailure } from './sw-rules';

const RELOADED = 'fruitcats-boot-reload';
const FELL_BACK = 'folkborn-boot-fell-back';

/**
 * The game itself is a second file. Fetching it can fail: a connection that drops just then, or a new version of the
 * site published while this page was open (its old files are gone). Either way the player would see an empty page, so
 * it's tried again.
 */
async function importMain(tries = 0): Promise<void> {
  try {
    await import('./main');
  } catch (e) {
    if (tries >= 2) throw e;
    await new Promise((r) => setTimeout(r, 1000 * (tries + 1)));
    return importMain(tries + 1);
  }
}

/**
 * Start the game. If it doesn't start (its script fails, or it draws nothing), the page is loaded afresh, once (a fresh
 * page asks for the new version's files); and if the worker then has an older version that did start, once more for
 * that. Only then the "couldn't load" message.
 */
async function start(): Promise<void> {
  try {
    await importMain();
    // The first render: main draws Home as it loads, so an empty page means the game didn't start.
    if (!document.getElementById('app')?.childElementCount) throw new Error('The game loaded but drew nothing.');
  } catch (e) {
    const { fallbackReady } = await reportBoot(false, e);
    let reloaded = true, fellBack = true;
    try { reloaded = sessionStorage.getItem(RELOADED) === '1'; fellBack = sessionStorage.getItem(FELL_BACK) === '1'; } catch { /* no storage: no reloads */ }
    const next = afterFailure({ reloaded, fellBack, fallbackReady });
    if (next !== 'give-up') {
      try { sessionStorage.setItem(next === 'reload' ? RELOADED : FELL_BACK, '1'); } catch { /* fine */ }
      location.reload();
      return;
    }
    document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font:18px system-ui,sans-serif;background:#fff6ea;color:#5a3a1a">
      <div><p>Folkborn couldn’t load. Check your connection, then try again.</p>
      <p><button onclick="location.reload()" style="font:inherit;padding:10px 22px;border-radius:999px;border:0;background:#f08a24;color:#fff">Try again</button></p></div></div>`);
    throw e;
  }
  try { sessionStorage.removeItem(RELOADED); sessionStorage.removeItem(FELL_BACK); } catch { /* fine */ }
  void reportBoot(true);
  registerWorker();
}

loadPacks().catch(() => []).finally(() => void start());
