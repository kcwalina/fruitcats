// The game's entry point: load the card sets (built in, then any newer card packs on the site), and only
// then start the game, so every screen sees the full catalog from its first render.
import { loadPacks } from './content';

/**
 * The game itself is a second file. Fetching it can fail: a connection that drops just then, or a new version of the
 * site published while this page was open (its old files are gone). Either way the player would see an empty page, so
 * it's tried again, and then the page is loaded afresh, once (a fresh page asks for the new version's files).
 */
async function start(tries = 0): Promise<void> {
  try {
    await import('./main');
  } catch (e) {
    if (tries < 2) { await new Promise((r) => setTimeout(r, 1000 * (tries + 1))); return start(tries + 1); }
    let reloaded = false;
    try { reloaded = sessionStorage.getItem('fruitcats-boot-reload') === '1'; sessionStorage.setItem('fruitcats-boot-reload', '1'); } catch { reloaded = true; }
    if (!reloaded) { location.reload(); return; }
    document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font:18px system-ui,sans-serif;background:#fff6ea;color:#5a3a1a">
      <div><p>Fruitcats couldn’t load. Check your connection, then try again.</p>
      <p><button onclick="location.reload()" style="font:inherit;padding:10px 22px;border-radius:999px;border:0;background:#f08a24;color:#fff">Try again</button></p></div></div>`);
    throw e;
  }
  try { sessionStorage.removeItem('fruitcats-boot-reload'); } catch { /* fine */ }
}

loadPacks().catch(() => []).finally(() => void start());
