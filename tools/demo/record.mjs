// Record the gameplay footage for the tutorial video.
//
//   npm run dev                                   # the recorder drives the dev server (it needs window.fruitcats)
//   python tools/demo/narrate.py                  # first: each beat lasts as long as its narration
//   npx tsx tools/demo/record.mjs                 # writes frames + a manifest into tools/demo/out/
//
// Headless Edge is driven over the DevTools protocol, so the frames are the page alone: no browser
// chrome, nothing to crop. The director (director.mjs) walks script.json beat by beat and makes every
// one of the human player's moves with real mouse clicks, shown by a drawn cursor that glides to each
// target, a ripple on each click, a label saying what to click, and a spotlight on what the narration
// is talking about. The page's own seeded AI plays the opponent, so the game is the one find-seed.mjs
// checked. Frames come from Page.startScreencast, timestamped, and build.py lays the narration over them.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '@fruitcats/engine';
import { ScriptError, beatsOf, direct, sel } from './director.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out');
const EDGE = process.env.EDGE_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9300 + Math.floor(Math.random() * 400);   // a fresh port per run, so a stale headless Edge cannot block us
const SIZE = { width: 1280, height: 800 };
const MAX_FPS = 30;          // keep at most this many screencast frames a second
const GAP = 0.8;             // seconds of quiet after each beat's narration
const AI_DELAY = 2;          // the opponent "thinks" twice as long as usual, so its moves are easy to follow
const BASE_URL = process.env.DEMO_URL ?? 'http://localhost:5173/';

const script = JSON.parse(readFileSync(join(HERE, 'script.json'), 'utf8'));
const durationsFile = join(OUT, 'durations.json');
const durations = existsSync(durationsFile) ? JSON.parse(readFileSync(durationsFile, 'utf8')) : {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** How long a beat's narration runs: measured by narrate.py, or guessed from its length. */
function narration(beat) {
  const measured = durations[beat.id];
  if (measured && measured.text === beat.say) return measured.seconds;
  return beat.say ? beat.say.split(/\s+/).length / 2.6 : 3;
}

// ── DevTools plumbing ────────────────────────────────────────────────────────────────────────────

async function openBrowser(profile) {
  const proc = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', `--window-size=${SIZE.width},${SIZE.height}`, '--mute-audio',
    // A fresh profile would sign in to Edge with the Windows account and pop up a sync dialog a few
    // seconds in, which steals the window: the page stops painting and the cursor stops moving.
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions',
    '--disable-component-extensions-with-background-pages', '--disable-features=msImplicitSignin,msEdgeSyncConsent,CalculateNativeWinOcclusion',
    // Never treat the page as hidden, for the same reason.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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
  ws.addEventListener('close', () => {
    for (const { reject, method } of pending.values()) reject(new Error(`${method}: Edge closed the connection`));
    pending.clear();
  });
  const on = (method, handler) => listeners.set(method, handler);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mine = ++id;
    pending.set(mine, { resolve, reject, method });
    ws.send(JSON.stringify({ id: mine, method, params }));
  });
  return { proc, ws, send, on };
}

// ── What gets drawn over the game: captions, title cards, cursor, spotlight, click labels ────────

const OVERLAY_CSS = `
  /* The game is scaled down a touch, so the caption sits in its own strip under the hand. */
  #app { transform: scale(0.88); transform-origin: top center; }
  #demo-caption {
    position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 99991;
    max-width: 80vw; padding: 11px 28px; border-radius: 18px; text-align: center; white-space: nowrap;
    font: 700 24px/1.25 Fredoka, Nunito, system-ui, sans-serif; color: #fff9ec;
    background: rgba(48, 24, 8, 0.9); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    opacity: 0; transition: opacity 0.35s ease; pointer-events: none;
  }
  #demo-caption.on { opacity: 1; }
  #demo-title {
    position: fixed; inset: 0; z-index: 99995; display: grid; place-items: center; align-content: center; gap: 18px;
    background: radial-gradient(circle at 50% 40%, rgba(255, 244, 214, 0.98), rgba(243, 194, 122, 0.98));
    font-family: Fredoka, Nunito, sans-serif; text-align: center; animation: demo-fade 0.6s ease; pointer-events: none;
  }
  #demo-title h1 { font-size: 72px; margin: 0; color: #fff7df; max-width: 1100px;
    text-shadow: 0 3px 0 #f29f05, 0 6px 0 #d9641d, 0 10px 0 #8e3b12, 0 16px 26px rgba(60, 20, 0, 0.45); }
  #demo-title p { font-size: 30px; margin: 0; color: #7a4a1c; font-weight: 600; }
  #demo-title img { width: 180px; border-radius: 30px; box-shadow: 0 14px 34px rgba(60, 25, 5, 0.42); }
  @keyframes demo-fade { from { opacity: 0; } to { opacity: 1; } }

  #demo-spot { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 99980; pointer-events: none;
    opacity: 0; transition: opacity 0.45s ease; }
  #demo-spot.on { opacity: 1; }
  #demo-spot .ring { fill: none; stroke: #ffd23f; stroke-width: 4; filter: drop-shadow(0 0 8px rgba(255, 210, 63, 0.9)); }
  .demo-label, .demo-tip {
    position: fixed; z-index: 99985; pointer-events: none; white-space: nowrap;
    font: 700 21px/1.2 Fredoka, Nunito, system-ui, sans-serif; padding: 8px 18px; border-radius: 14px;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4); opacity: 0; transition: opacity 0.3s ease;
  }
  .demo-label { background: #fffaf0; color: #5a2d0c; border: 3px solid #ffd23f; }
  .demo-tip { background: #ffd23f; color: #3a1a00; font-size: 23px; border: 3px solid #fff; z-index: 99986; }
  .demo-label.on, .demo-tip.on { opacity: 1; }
  .demo-label::after, .demo-tip::after {
    content: ''; position: absolute; left: var(--arrow-x, 50%); width: 0; height: 0; transform: translateX(-50%);
    border: 10px solid transparent;
  }
  .demo-label.above::after { top: 100%; border-top-color: #ffd23f; }
  .demo-label.below::after { bottom: 100%; border-bottom-color: #ffd23f; }
  .demo-tip.above::after { top: 100%; border-top-color: #fff; }
  .demo-tip.below::after { bottom: 100%; border-bottom-color: #fff; }

  #demo-cursor { position: fixed; left: 0; top: 0; z-index: 99999; width: 44px; height: 44px; pointer-events: none;
    transform-origin: 6px 4px; transition: opacity 0.3s ease; opacity: 0; filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.5)); }
  #demo-cursor.on { opacity: 1; }
  #demo-cursor svg { width: 100%; height: 100%; transition: transform 0.12s ease; transform-origin: 6px 4px; }
  #demo-cursor.down svg { transform: scale(0.8); }
  .demo-ripple { position: fixed; z-index: 99998; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
    border: 5px solid #ffd23f; pointer-events: none; animation: demo-ripple 0.75s ease-out forwards; }
  @keyframes demo-ripple { from { transform: scale(1); opacity: 1; } to { transform: scale(6); opacity: 0; } }
`;

// Everything here runs in the page. `window.__demo` is what the recorder calls.
const OVERLAY_JS = `(() => {
  if (window.__demo) return true;
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(OVERLAY_CSS)};
  document.head.append(style);
  const add = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstChild; document.body.append(el); return el; };
  const caption = add('<div id="demo-caption"></div>');
  const NS = 'http://www.w3.org/2000/svg';
  const spot = add('<svg id="demo-spot" xmlns="' + NS + '"><defs><mask id="demo-holes"><rect width="100%" height="100%" fill="white"/><g class="holes"></g></mask></defs>'
    + '<rect width="100%" height="100%" fill="rgba(25, 12, 2, 0.55)" mask="url(#demo-holes)"/><g class="rings"></g></svg>');
  const label = add('<div class="demo-label"></div>');
  const tip = add('<div class="demo-tip"></div>');
  const cursor = add('<div id="demo-cursor"><svg viewBox="0 0 44 44"><path d="M6 4 L6 36 L14 28 L20 41 L26 38 L20 26 L32 26 Z" fill="#fff" stroke="#1b0d02" stroke-width="2.5" stroke-linejoin="round"/></svg></div>');

  /** All elements a selector names; "sel@last" / "sel@first" pick one. */
  const all = (selector) => {
    const [css, pick] = selector.split('@');
    const found = [...document.querySelectorAll(css)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    return pick === 'last' ? found.slice(-1) : pick === 'first' ? found.slice(0, 1) : found;
  };
  const PAD = 7;

  let spotSel = [], cur = [], labelText = '';
  let tipSel = null;
  const place = (box, el, text, gap) => {
    if (!box || !text) { el.classList.remove('on'); return; }
    el.textContent = text;
    const w = el.offsetWidth, h = el.offsetHeight;
    const above = box.y - h - gap - 12 > 8;
    let x = box.x + box.w / 2 - w / 2;
    x = Math.max(10, Math.min(innerWidth - w - 10, x));
    el.style.left = x + 'px';
    el.style.top = (above ? box.y - h - gap - 12 : box.y + box.h + gap + 12) + 'px';
    el.style.setProperty('--arrow-x', Math.max(18, Math.min(w - 18, box.x + box.w / 2 - x)) + 'px');
    el.classList.toggle('above', above); el.classList.toggle('below', !above);
    el.classList.add('on');
  };
  const union = (rects) => {
    if (!rects.length) return null;
    const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
    return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
  };
  function frame() {
    // The spotlight follows its targets as the game re-renders, and glides when it moves to new ones.
    const want = spotSel.flatMap(all).map((el) => { const r = el.getBoundingClientRect(); return { x: r.x - PAD, y: r.y - PAD, w: r.width + 2 * PAD, h: r.height + 2 * PAD }; });
    if (want.length !== cur.length) cur = want.map((r) => ({ ...r }));
    else cur.forEach((r, i) => { for (const k of ['x', 'y', 'w', 'h']) r[k] += (want[i][k] - r[k]) * 0.18; });
    spot.classList.toggle('on', cur.length > 0);
    const rect = (r, cls) => '<rect ' + (cls ? 'class="' + cls + '" ' : 'fill="black" ') + 'x="' + r.x + '" y="' + r.y + '" width="' + r.w + '" height="' + r.h + '" rx="14"/>';
    if (cur.length) {
      spot.querySelector('.holes').innerHTML = cur.map((r) => rect(r)).join('');
      spot.querySelector('.rings').innerHTML = cur.map((r) => rect(r, 'ring')).join('');
    }
    place(union(cur), label, labelText, 0);
    const t = tipSel && all(tipSel)[0];
    if (t) { const r = t.getBoundingClientRect(); place({ x: r.x, y: r.y, w: r.width, h: r.height }, tip, tip.dataset.text, 4); }
    else tip.classList.remove('on');
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  let at = { x: innerWidth * 0.7, y: innerHeight * 0.75 };
  const put = () => { cursor.style.transform = 'translate(' + (at.x - 6) + 'px,' + (at.y - 4) + 'px)'; };
  put();

  window.__demo = {
    caption(text) { caption.textContent = text || ''; caption.classList.toggle('on', !!text); },
    title(heading, sub) {
      document.getElementById('demo-title')?.remove();
      if (!heading) return;
      const card = document.createElement('div');
      card.id = 'demo-title';
      card.innerHTML = '<img src="./ui/app-icon.webp" alt=""><h1></h1><p></p>';
      card.querySelector('h1').textContent = heading;
      card.querySelector('p').textContent = sub || '';
      document.body.append(card);
    },
    spot(selectors, text) { spotSel = selectors || []; labelText = text || ''; if (!spotSel.length) cur = []; },
    tip(selector, text) { tipSel = selector; tip.dataset.text = text || ''; },
    /** A point inside the element that really receives a click there (not something covering it). */
    point(selector) {
      const el = all(selector)[0];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const tries = [[0.5, 0.5], [0.5, 0.3], [0.5, 0.7], [0.3, 0.5], [0.7, 0.5], [0.3, 0.25], [0.7, 0.25]];
      for (const [fx, fy] of tries) {
        const x = r.x + r.width * fx, y = r.y + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x: Math.round(x), y: Math.round(y), text: (el.innerText || '').trim().split('\\n')[0] };
      }
      return null;
    },
    showCursor(on) { cursor.classList.toggle('on', on); },
    glide(x, y, ms) {
      cursor.classList.add('on');
      const from = { ...at }, start = performance.now();
      return new Promise((done) => {
        const step = (now) => {
          const t = Math.min(1, (now - start) / ms);
          const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
          at = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
          put();
          if (t < 1) requestAnimationFrame(step); else done(true);
        };
        requestAnimationFrame(step);
        setTimeout(() => { at = { x, y }; put(); done(true); }, ms + 400);   // in case frames stall
      });
    },
    where() { return at; },
    down(on) { cursor.classList.toggle('down', on); },
    ripple(x, y) {
      const r = document.createElement('div');
      r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px';
      document.body.append(r);
      setTimeout(() => r.remove(), 900);
    },
  };
  return true;
})()`;

// ── Capturing ────────────────────────────────────────────────────────────────────────────────────

const frames = [];             // { name, t } — t in ms since the epoch, from the compositor
const beatLog = [];            // { id, start, end, narration } — ms since the epoch

const setSize = (send) => send('Emulation.setDeviceMetricsOverride', { ...SIZE, deviceScaleFactor: 1, mobile: false });

function startCapture(send, on) {
  let last = -Infinity, resized = 0;
  on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    // A display change on the machine can drop the emulated size; put it back rather than record a
    // different-shaped picture.
    if (metadata.deviceWidth !== SIZE.width || metadata.deviceHeight !== SIZE.height) {
      if (Date.now() - resized > 500) { resized = Date.now(); console.log('    (viewport changed size; restoring it)'); setSize(send).catch(() => {}); }
      return;
    }
    const t = (metadata.timestamp ?? Date.now() / 1000) * 1000;
    if (t - last < 1000 / MAX_FPS - 2) return;
    last = t;
    const name = `frame-${String(frames.length).padStart(5, '0')}.jpg`;
    writeFileSync(join(OUT, 'frames', name), Buffer.from(data, 'base64'));
    frames.push({ name, t });
  });
  return send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 });
}

// ── The page driver: the director's moves become visible mouse work ─────────────────────────────

function pageDriver(send) {
  const run = async (expression) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      wait(20000).then(() => { throw new Error(`the page stopped responding to: ${expression.slice(0, 60)}`); }),
    ]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const demo = (call) => run(`window.__demo.${call}`);
  const state = async () => JSON.parse(await run('JSON.stringify(window.fruitcats.game)'));
  let beatStart = 0, beatLength = 0, pressAt = null;

  async function point(selector, timeout = 4000) {
    const until = Date.now() + timeout;
    for (;;) {
      const p = await demo(`point(${JSON.stringify(selector)})`);
      if (p) return p;
      if (Date.now() > until) throw new ScriptError(`target not found: ${selector}`);
      await wait(150);
    }
  }

  async function glideTo(p) {
    const from = await demo('where()');
    const distance = Math.hypot(p.x - from.x, p.y - from.y);
    await demo(`glide(${p.x}, ${p.y}, ${Math.round(Math.min(1500, 650 + distance * 0.9))})`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none', buttons: 0 });
  }

  /** Glide to an element, say what to click, and click it for real. */
  async function click(selector, label) {
    let p = await point(selector);
    const text = label === 'button' ? `Click “${p.text}”` : label;
    await demo(`tip(${JSON.stringify(selector)}, ${JSON.stringify(text ? `👆 ${text}` : '')})`);
    await glideTo(p);
    await wait(650);
    // Hovering can lift a card a little: aim again before pressing.
    const again = await point(selector);
    if (Math.hypot(again.x - p.x, again.y - p.y) > 6) { p = again; await glideTo(p); }
    await demo('down(true)');
    await demo(`ripple(${p.x}, ${p.y})`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await wait(110);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
    await demo('down(false)');
    await wait(350);
    await demo('tip(null)');
    await wait(550);
  }

  async function untilHuman(timeout = 90000) {
    const until = Date.now() + timeout;
    for (;;) {
      const s = await state();
      // The state changes before its animation plays (apps/web/src/fx.ts): wait for that too.
      if (s && (s.winner !== null || s.prompt?.player === 0) && !(await run('!!window.fruitcats.animating'))) return s;
      if (Date.now() > until) throw new ScriptError(`the opponent never handed the turn back (prompt ${s?.prompt?.kind})`);
      await wait(150);
    }
  }

  return {
    async beginBeat(beat) {
      beatStart = Date.now();
      beatLength = narration(beat);
      await demo(`caption(${JSON.stringify(beat.caption ?? '')})`);
      console.log(`  ${beat.id.padEnd(15)} ${beatLength.toFixed(1)}s`);
    },
    async endBeat(beat) {
      const due = beatStart + (beatLength + GAP) * 1000;
      const late = Date.now() - due;
      if (late > 300) console.log(`    (${beat.id} ran ${(late / 1000).toFixed(1)}s past its narration)`);
      if (late < 0) await wait(-late);
      await demo('spot(null)');
      await demo('tip(null)');
      beatLog.push({ id: beat.id, start: beatStart, end: Date.now(), narration: beatLength, say: beat.say });
    },
    state,
    async waitHuman() { await untilHuman(); },
    async startGame(step) {
      await click('[data-click="solo:play"]', step.label ?? 'Click “Play”');
      for (let i = 0; i < 50 && !(await run('!!window.fruitcats.game')); i++) await wait(100);
    },
    async perform(p, step) {
      const before = await state();
      let expected = null;
      if (p.action) { expected = structuredClone(before); apply(expected, p.action); }
      for (const [i, c] of p.clicks.entries()) {
        await click(sel(c.key), c.label);
        if (i < p.clicks.length - 1) await wait(step.gap ?? 500);
      }
      if (!expected) return;
      // The clicks must have made exactly the planned move, or the game has left the script.
      for (let i = 0; i < 40; i++) {
        const now = await state();
        if (now.log.length >= expected.log.length) {
          if (JSON.stringify(now.log.slice(0, expected.log.length)) !== JSON.stringify(expected.log))
            throw new ScriptError(`clicking made a different move than planned: ${JSON.stringify(p.action)}`);
          return;
        }
        await wait(100);
      }
      const flash = await run(`document.querySelector('.flash')?.textContent ?? ''`);
      throw new ScriptError(`the clicks for ${JSON.stringify(p.action)} did nothing${flash ? ` (the game said: ${flash})` : ''}`);
    },
    async ui(step) {
      if ('title' in step) return demo(step.title ? `title(${JSON.stringify(step.title[0])}, ${JSON.stringify(step.title[1] ?? '')})` : 'title(null)');
      if ('spot' in step) return demo(step.spot ? `spot(${JSON.stringify([].concat(step.spot))}, ${JSON.stringify(step.label ?? '')})` : 'spot(null)');
      if ('caption' in step) return demo(`caption(${JSON.stringify(step.caption ?? '')})`);
      if (step.at !== undefined) { const due = beatStart + step.at * beatLength * 1000; if (due > Date.now()) await wait(due - Date.now()); return; }
      if (step.wait) return wait(step.wait);
      if (step.move) return glideTo(await point(step.move));
      if (step.click) return click(step.click, step.label);
      if (step.pressDown) {
        const p = await point(step.pressDown);
        if (step.label) await demo(`tip(${JSON.stringify(step.pressDown)}, ${JSON.stringify(`👆 ${step.label}`)})`);
        await glideTo(p);
        await wait(500);
        await demo('down(true)');
        await demo(`ripple(${p.x}, ${p.y})`);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
        pressAt = p;
        await wait(700);
        await demo('tip(null)');
        if (!(await run('!!document.getElementById("zoom-overlay")'))) throw new ScriptError('holding the card did not open it');
        return;
      }
      if (step.release) {
        const p = pressAt ?? (await demo('where()'));
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
        await demo('down(false)');
        pressAt = null;
        return wait(400);
      }
      throw new ScriptError(`unknown step ${JSON.stringify(step)}`);
    },
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────────

async function main() {
  rmSync(join(OUT, 'frames'), { recursive: true, force: true });
  mkdirSync(join(OUT, 'frames'), { recursive: true });
  const missing = beatsOf(script).filter((b) => b.say && durations[b.id]?.text !== b.say).map((b) => b.id);
  if (missing.length) console.log(`(no narration measured for ${missing.length} beats — run narrate.py first for exact timing; guessing for now)`);

  const profile = join(OUT, `profile-${Date.now()}`);
  const { proc, ws, send, on } = await openBrowser(profile);
  let failure = null;
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await setSize(send);
    // Play as a returning player: a first visit's Play button starts the guided walkthrough instead.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.setItem('fruitcats-played', 'yes'); } catch {}" });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const url = `${BASE_URL}?seed=${script.seed}&foe=${script.foe}`;
    await send('Page.navigate', { url });
    await wait(3500);
    const driver = pageDriver(send);
    const hooked = await send('Runtime.evaluate', { expression: '!!window.fruitcats', returnByValue: true });
    if (!hooked.result.value) throw new Error(`${url} has no window.fruitcats: is it the dev server (npm run dev)?`);
    await send('Runtime.evaluate', { expression: OVERLAY_JS, returnByValue: true });
    await send('Runtime.evaluate', { expression: `window.fruitcats.aiDelay = ${AI_DELAY}` });
    await startCapture(send, on);
    await wait(300);
    console.log(`recording ${url}`);
    await direct(script, driver);
    await wait(600);
  } catch (error) {
    failure = error;
  } finally {
    await send('Page.stopScreencast').catch(() => {});
    ws.close();
    proc.kill();
  }

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ size: SIZE, frames, beats: beatLog }, null, 2));
  const seconds = beatLog.length ? (beatLog.at(-1).end - beatLog[0].start) / 1000 : 0;
  console.log(`\n${frames.length} frames, ${beatLog.length} beats, ${(seconds / 60).toFixed(1)} min -> ${OUT}`);

  // Edge holds its profile for a moment after it exits.
  await new Promise((r) => (proc.exitCode !== null ? r() : proc.once('exit', r)));
  for (let i = 0; i < 10; i++) {
    try { rmSync(profile, { recursive: true, force: true }); break; } catch { await wait(500); }
  }
  if (failure) {
    console.error(`\nFAILED: ${failure.message}`);
    process.exit(1);
  }
}

await main();
