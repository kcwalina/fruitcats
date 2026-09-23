// Record the gameplay footage for the tutorial video.
//
//   npm run dev                       # the recorder drives the dev server (it needs window.fruitcats)
//   node tools/demo/record.mjs        # writes frames + a manifest into tools/demo/out/
//
// Headless Edge is driven over the DevTools protocol, so the frames are the page alone: no browser
// chrome, no cursor, nothing to crop. Each scene in script.json is played out, captured at CAPTURE_FPS,
// and the assembler (build.py) holds the last frame of a scene until its narration finishes.

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9300 + Math.floor(Math.random() * 400);   // a fresh port per run, so a stale headless Edge cannot block us
const SIZE = { width: 1280, height: 800 };
const CAPTURE_FPS = 8;
const URL = process.env.FRUITCATS_URL ?? 'http://localhost:5173/';

const script = JSON.parse(readFileSync(join(HERE, 'script.json'), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── DevTools plumbing ────────────────────────────────────────────────────────────────────────────

async function openBrowser() {
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=${SIZE.width},${SIZE.height}`,
    '--user-data-dir=' + join(OUT, `profile-${Date.now()}`), 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 80 && !targets; i++) {
    await wait(300);
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* not up yet */ }
  }
  if (!targets) throw new Error('Edge did not start a DevTools endpoint');
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  // One dispatcher for everything: a listener per call would pile up under the screencast's firehose.
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject, method } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result);
    } else if (message.method) {
      listeners.get(message.method)?.(message.params);
    }
  });
  const on = (method, handler) => listeners.set(method, handler);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mine = ++id;
    pending.set(mine, { resolve, reject, method });
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
  return { proc, ws, send, on };
}

/** Run an expression in the page and return its value (awaits promises). */
const run = (send, expression) => Promise.race([
  send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    .then((r) => { if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page error'); return r.result.value; }),
  new Promise((resolve) => setTimeout(() => resolve('(page call timed out)'), 25000)),
]);

// ── The caption bar, drawn into the page so it is part of the footage ────────────────────────────

const CAPTION_CSS = `
  /* The game is scaled up a touch and lifted, so the caption sits in its own strip. */
  #app { transform: scale(0.88); transform-origin: top center; }
  #demo-caption {
    position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 9999;
    max-width: 78vw; padding: 12px 30px; border-radius: 18px; text-align: center;
    font: 700 25px/1.25 Fredoka, Nunito, system-ui, sans-serif; color: #fff9ec;
    background: rgba(48, 24, 8, 0.88); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    opacity: 0; transition: opacity 0.35s ease;
  }
  #demo-caption.on { opacity: 1; }
  #demo-title {
    position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; align-content: center; gap: 18px;
    background: radial-gradient(circle at 50% 40%, rgba(255, 244, 214, 0.97), rgba(243, 194, 122, 0.97));
    font-family: Fredoka, Nunito, sans-serif; text-align: center; transition: opacity 0.6s ease;
  }
  #demo-title h1 { font-size: 76px; margin: 0; color: #fff7df;
    text-shadow: 0 3px 0 #f29f05, 0 6px 0 #d9641d, 0 10px 0 #8e3b12, 0 16px 26px rgba(60, 20, 0, 0.45); }
  #demo-title p { font-size: 27px; margin: 0; color: #7a4a1c; font-weight: 600; }
  #demo-title img { width: 190px; border-radius: 30px; box-shadow: 0 14px 34px rgba(60, 25, 5, 0.42); }
`;

const setup = `(() => {
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(CAPTION_CSS)};
  document.head.append(style);
  const caption = document.createElement('div');
  caption.id = 'demo-caption';
  document.body.append(caption);
  window.__caption = (text) => {
    caption.textContent = text ?? '';
    caption.classList.toggle('on', !!text);
  };
  window.__title = (show, heading, sub) => {
    document.getElementById('demo-title')?.remove();
    if (!show) return;
    const card = document.createElement('div');
    card.id = 'demo-title';
    card.innerHTML = '<img src="/ui/app-icon.webp" alt=""><h1>' + heading + '</h1><p>' + sub + '</p>';
    document.body.append(card);
  };
  return true;
})()`;

// ── Capturing ────────────────────────────────────────────────────────────────────────────────────

let frameNo = 0;
const frames = [];          // { name, t } for every frame the compositor sent us
const manifest = [];

const limit = (promise, ms, what) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(() => { console.log(`    (${what} timed out after ${ms / 1000}s)`); resolve(null); }, ms)),
]);

/** Grab frames by asking for screenshots: slower than a screencast, but it never stops mid-scene. */
async function shoot(send) {
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, captureBeyondViewport: false });
  const name = `frame-${String(frameNo++).padStart(5, '0')}.jpg`;
  writeFileSync(join(OUT, 'frames', name), Buffer.from(shot.data, 'base64'));
  frames.push({ name, t: Date.now() });
}

/** Play out one scene, capturing all the way through it. */
async function capture(send, scene, seconds, action) {
  const from = Date.now();
  let acting = true;
  const running = (action ? limit(action(), (seconds + 20) * 1000, scene) : Promise.resolve())
    .then(() => { acting = false; }, (error) => { console.log(`    (${scene} failed: ${error.message})`); acting = false; });
  while (acting || (Date.now() - from) / 1000 < seconds) {
    await shoot(send);
    await wait(1000 / CAPTURE_FPS);   // leave the connection free for the moves the scene is making
    if ((Date.now() - from) / 1000 > seconds + 25) break;
  }
  await running;
  const to = Date.now();
  const mine = frames.filter((f) => f.t >= from && f.t <= to);
  manifest.push({ id: scene, from, to, frames: mine.map((f) => f.name) });
  console.log(`  ${scene}: ${mine.length} frames over ${((to - from) / 1000).toFixed(1)}s`);
}

// ── The playthrough ──────────────────────────────────────────────────────────────────────────────

const click = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;

/** Let the AI pick the human's move too, so the demo game plays sensibly. */
const autoMove = `(() => {
  const fc = window.fruitcats, g = fc.game;
  if (!g || g.winner !== null || g.prompt?.player !== 0) return false;
  fc.apply(g, fc.chooseAction(g, { skill: 0.5 })); fc.render(); return true;
})()`;

/** Wait until the game is asking the human for `kind` (and the UI has rendered it). */
const waitFor = (kind) => `(async () => {
  const fc = window.fruitcats;
  for (let i = 0; i < 100; i++) {
    const p = fc.game?.prompt;
    if (p?.player === 0 && p.kind === ${JSON.stringify('KIND')}.replace('KIND', ${JSON.stringify(kind)})) return 'ready';
    await new Promise((r) => setTimeout(r, 100));
  }
  return 'timeout:' + (fc.game?.prompt?.kind ?? 'none');
})()`;

const waitForHuman = `(async () => {
  const fc = window.fruitcats;
  for (let i = 0; i < 120; i++) {
    if (fc.game?.prompt?.player === 0 || fc.game?.winner !== null) return fc.game?.prompt?.kind ?? 'over';
    await new Promise((r) => setTimeout(r, 100));
  }
  return 'timeout';
})()`;

async function main() {
  // Only the frames are cleared: the browser profile beside them stays locked for a while after a run.
  rmSync(join(OUT, 'frames'), { recursive: true, force: true });
  mkdirSync(join(OUT, 'frames'), { recursive: true });
  const { proc, ws, send } = await openBrowser();
  const scene = Object.fromEntries(script.scenes.map((s) => [s.id, s]));
  const caption = (text) => run(send, `window.__caption(${JSON.stringify(text)})`);

  try {
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { ...SIZE, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: URL });
    await wait(4000);
    await run(send, setup);

    // 1. Title card over the menu
    await run(send, `window.__title(true, 'Fruitcats', 'How to play')`);
    await caption('');
    await capture(send, 'intro', 7, async () => {
      // A normal game, not the walkthrough: the video is the walkthrough's trailer, not a copy of it.
      await run(send, `(() => { try { localStorage.setItem('fruitcats-played', 'yes'); } catch {} return true; })()`);
      await wait(1500);
      await run(send, `window.__title(false)`);
      await run(send, click('[data-click="menu:zest-rush"]'));
      await wait(700);
      await run(send, click('[data-click="menu:kitten"]'));   // the gentle opponent keeps the page responsive
      await wait(700);
    });

    // 2. Treats: keep the hand, then bury the two priciest cards
    await caption(scene.plant.caption);
    await capture(send, 'plant', 12, async () => {
      await run(send, click('[data-click="menu:play"]'));
      console.log('    mulligan:', await run(send, waitFor('mulligan')));
      await run(send, click('[data-click="btn:confirm"]'));
      console.log('    plant:', await run(send, waitFor('setupPlant')));
      await wait(900);
      // The two priciest, which is what the game now teaches.
      await run(send, `(async () => {
        const fc = window.fruitcats;
        const priced = [...fc.game.players[0].hand].map((c) => [c.uid, fc.CARDS?.[c.id]?.cost ?? 0]).sort((a, b) => b[1] - a[1]);
        for (const [uid] of priced.slice(0, 2)) {
          document.querySelector('[data-click="hand:' + uid + '"]')?.click();
          await new Promise((r) => setTimeout(r, 900));
        }
        return true; })()`);
      await wait(700);
      await run(send, click('[data-click="btn:confirm"]'));
      await wait(1800);
    });

    // 3. Spending Treats to put a cat down
    await caption(scene.play.caption);
    await capture(send, 'play', 10, async () => {
      console.log('    action:', await run(send, waitFor('action')));
      await wait(900);
      await run(send, `(async () => {
        const fc = window.fruitcats;
        for (let i = 0; i < 40; i++) {
          const g = fc.game;
          if (g.prompt?.player === 0 && g.prompt.kind === 'action') {
            for (const play of fc.legalActions(g).filter((a) => a.t === 'play')) {
              const before = g.players[0].yard.length;
              fc.apply(g, play); fc.render();
              if (g.players[0].yard.length > before) return 'unit down';
              break;
            }
          }
          fc.apply(g, fc.chooseAction(g, { skill: 0.5 })); fc.render();
          await new Promise((r) => setTimeout(r, 140));
        }
        return 'none'; })()`);
      await wait(2200);
    });

    // 4. The back-and-forth
    await caption(scene.turns.caption);
    await capture(send, 'turns', 9, async () => {
      for (let i = 0; i < 5; i++) { await run(send, autoMove); await wait(900); }
      await run(send, waitForHuman);
    });

    // 5. An attack, and a heart going out
    await caption(scene.attack.caption);
    await capture(send, 'attack', 14, async () => {
      await run(send, `(async () => {
        const fc = window.fruitcats;
        const lives = () => fc.game.players.map((p) => p.lives.length).join('-');
        const before = lives();
        for (let i = 0; i < 90; i++) {
          const g = fc.game;
          if (g.winner !== null) return 'over';
          if (lives() !== before) return 'a heart went out';
          if (g.prompt?.player === 0 && g.prompt.kind === 'action') {
            const atk = fc.legalActions(g).find((a) => a.t === 'attack');
            if (atk) { fc.apply(g, atk); fc.render(); await new Promise((r) => setTimeout(r, 900)); continue; }
          }
          fc.apply(g, fc.chooseAction(g, { skill: 0.5 })); fc.render();
          await new Promise((r) => setTimeout(r, 130));
        }
        return 'none'; })()`);
      await wait(2000);
    });

    // 6. Sign-off
    await caption('');
    await run(send, `window.__title(true, 'Fruitcats', 'fruitcats.viamochi.com')`);
    await capture(send, 'outro', 7);

    writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ size: SIZE, scenes: manifest }, null, 2));
    console.log(`\n${frameNo} frames -> ${join(OUT, 'frames')}`);
  } finally {
    ws.close();
    proc.kill();
  }
}

await main();
