// The playtest dashboard (docs/playtests.md): everything comes from the Fruitcats API, which PC2024's playtester keeps up
// to date (data.ts). Only the owner's Via Mochi account may read it.
import { DashboardError, cancelRequest, loadDashboard, queueRun, runWithReport } from './data';

// Decks, family colors and personas come from the meta document PC2024's runner sends, built from the card
// data, so a new deck appears here by itself. Until it loads, or for a deck it doesn't know, the key stands in.
let meta = { decks: [], personas: [], library: [], heroes: [] };
function decks() {
  const known = meta.decks.map((d) => ({ key: d.key, name: d.name, color: d.color }));
  const seen = new Set(known.map((d) => d.key));
  for (const r of runs) for (const key of Object.keys(starters(r) ?? {})) {
    if (!seen.has(key)) { seen.add(key); known.push({ key, name: key, color: 'var(--muted)' }); }
  }
  return known;
}
const KIND = { 'balance-check': 'Deploy check', balance: 'Bot gauntlet', 'llm-playtest': 'LLM playtest', 'deck-hunt': 'Deck hunt', 'deck-build': 'Deck build', 'llm-compare': 'LLM player comparison', nightly: 'Nightly run', weekly: 'Weekly run' };
let runs = [];
let requests = [];
let online = false;
/** PC2024's playtester: when it last asked the API for work, and whether it was busy. */
let runner = null;
/** Reports, fetched when a run is opened (the list comes without them). */
const reports = new Map();
let selected = null;
try { selected = location.hash.slice(1) || localStorage.getItem('fc-playtest-run'); } catch { /* storage may be blocked */ }

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
const when = (iso) => new Date(iso);
const timeOf = (iso) => when(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayOf = (iso) => when(iso).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
const dur = (s) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);
const starters = (r) => r.details?.starters?.overall ?? (r.kind === 'nightly' || r.kind === 'weekly' ? r.details?.starters : null);

// A small Markdown reader for the reports the playtest scripts write: headings, lists, tables, quotes, bold.
function inline(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
}
function markdown(md) {
  const out = [];
  const lines = md.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r, k) => !(k === 1 && /^\|[-| :]+\|$/.test(r)));
      out.push(`<div class="table"><table><thead><tr>${cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      i--;
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (line.startsWith('> ')) { out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  return out.join('');
}

function renderDecks() {
  const latest = runs.find((r) => (r.kind === 'balance' || r.kind === 'balance-check') && starters(r));
  if (!latest) { $('decks').innerHTML = '<div class="empty">No bot runs yet.</div>'; return; }
  const o = starters(latest);
  $('decks').innerHTML = decks().filter((d) => o[d.key] !== undefined).map((d) => {
    const r = o[d.key];
    const state = r < 0.4 || r > 0.6 ? 'block' : r < 0.45 || r > 0.55 ? 'warn' : 'pass';
    return `<div class="deck"><span class="name">${esc(d.name)}</span>
      <div class="bar" role="img" aria-label="${esc(d.name)} ${pct(r)}"><span class="target"></span><span class="fill" style="width:${(r * 100).toFixed(1)}%;background:${d.color}"></span><span class="mid"></span></div>
      <span class="num" style="color:var(--${state === 'pass' ? 'ink' : state})">${pct(r)}</span></div>`;
  }).join('') + `<div class="note">${esc(KIND[latest.kind])}, ${esc(dayOf(latest.startedAt))} ${esc(timeOf(latest.startedAt))} · ${latest.games.toLocaleString()} games</div>`;
}

function renderIssues() {
  // The same problem text, with its numbers blanked, seen in two or more of the last 20 runs.
  const seen = new Map();
  for (const r of runs.slice(0, 20)) {
    const inRun = new Set();
    for (const p of r.problems ?? []) {
      const key = p.text.replace(/[+-]?\d+(\.\d+)?%?/g, '#');
      if (inRun.has(key)) continue; // e.g. two generated decks in one run: one issue, not two runs
      inRun.add(key);
      const e = seen.get(key) ?? { text: p.text, level: p.level, count: 0 };
      e.count++;
      seen.set(key, e);
    }
  }
  const list = [...seen.values()].filter((e) => e.count > 1).sort((a, b) => (a.level === b.level ? b.count - a.count : a.level === 'block' ? -1 : 1));
  $('issues').innerHTML = list.length
    ? list.slice(0, 8).map((e) => `<li><span class="pill ${e.level}">${e.level}</span><span>${esc(e.text)} <span class="times">×${e.count}</span></span></li>`).join('')
    : '<li class="note">Nothing flagged twice.</li>';
}

function renderTrend() {
  const points = runs.filter((r) => (r.kind === 'balance' || r.kind === 'balance-check') && starters(r)).slice().reverse();
  if (points.length < 2) { $('trend').innerHTML = `<div class="empty">${points.length ? 'One bot run so far: the trend appears after the next one.' : 'No bot runs yet.'}</div>`; return; }
  const W = Math.max(300, Math.round($('trend').clientWidth || 1100)), H = W < 600 ? 200 : 240, L = 44, R = 16, T = 12, B = 30;
  const lo = 0.3, hi = 0.7;
  const t0 = when(points[0].startedAt).getTime(), t1 = when(points[points.length - 1].startedAt).getTime();
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - T - B);
  const grid = [0.3, 0.4, 0.5, 0.6, 0.7].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1" ${v === 0.5 ? '' : 'stroke-dasharray="3 4"'}/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${pct(v)}</text>`).join('');
  const band = `<rect x="${L}" y="${y(0.55)}" width="${W - L - R}" height="${y(0.45) - y(0.55)}" fill="var(--band)"/>`;
  const lines = decks().map((d) => {
    const pts = points.filter((p) => starters(p)[d.key] !== undefined).map((p) => [x(when(p.startedAt).getTime()), y(starters(p)[d.key])]);
    if (!pts.length) return '';
    const last = pts[pts.length - 1];
    return `<polyline fill="none" stroke="${d.color}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map((p) => p.join(',')).join(' ')}"/>` +
      pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${d.color}"/>`).join('') +
      `<circle cx="${last[0]}" cy="${last[1]}" r="5" fill="${d.color}" stroke="var(--surface)" stroke-width="2"/>`;
  }).join('');
  const sameDay = dayOf(points[0].startedAt) === dayOf(points[points.length - 1].startedAt);
  const stamp = (iso) => (sameDay ? timeOf(iso) : when(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }));
  const labels = [points[0], points[points.length - 1]].map((p, i) => `<text x="${i ? W - R : L}" y="${H - 8}" text-anchor="${i ? 'end' : 'start'}">${esc(stamp(p.startedAt))}</text>`).join('');
  const key = decks().map((d) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px"><span class="dot" style="background:${d.color}"></span>${esc(d.name)}</span>`).join('');
  $('trend').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Starter deck win rates over time">${band}${grid}${lines}${labels}</svg><div class="legend">${key}</div>`;
}

// A run's name: the one given when it was started (the API copies it onto the run), or its request's.
const requestOf = (r) => requests.find((q) => q.id === r.request || q.run === r.id);
const runName = (r) => r.name || requestOf(r)?.name || '';
const runTitle = (r) => runName(r) || KIND[r.kind] || r.kind;
function renderRuns() {
  if (!runs.length) { $('runs').innerHTML = '<div class="empty">No runs uploaded yet.</div>'; return; }
  const q = $('runfilter').value.trim().toLowerCase();
  const shown = q ? runs.filter((r) => [runName(r), KIND[r.kind] ?? r.kind, r.id, dayOf(r.startedAt), requestOf(r)?.label ?? '', r.result]
    .join(' ').toLowerCase().includes(q)) : runs;
  if (!shown.length) { $('runs').innerHTML = '<div class="empty">No run matches.</div>'; return; }
  const days = new Map();
  for (const r of shown) { const d = dayOf(r.startedAt); if (!days.has(d)) days.set(d, []); days.get(d).push(r); }
  $('runs').innerHTML = [...days.entries()].map(([day, list]) => `<div class="day"><h3>${esc(day)}</h3>${list.map((r) => `
    <button class="run" data-id="${esc(r.id)}" aria-current="${r.id === selected}">
      <span class="dot ${esc(r.result)}"></span>
      <span>${runName(r) ? `<span class="name">${esc(runName(r))}</span><br><span class="meta">${esc(KIND[r.kind] ?? r.kind)}</span>` : `<span class="kind">${esc(KIND[r.kind] ?? r.kind)}</span>`}<br><span class="meta">${r.progress ? progressText(r) : `${r.games ? `${r.games.toLocaleString()} games · ` : ''}${dur(r.durationSec)}${r.problems?.length ? ` · ${r.problems.length} flagged` : ''}`}</span>${r.result === 'running' ? progressBar(r) : ''}</span>
      <span class="time">${esc(timeOf(r.startedAt))}</span>
    </button>`).join('')}</div>`).join('');
}

const progressText = (r) => {
  const p = r.progress;
  return `${p.total ? `${p.phase}: ${p.done} of ${p.total}` : p.phase}${r.result === 'running' && p.updatedAt ? ` · as of ${timeOf(p.updatedAt)}` : ''}`;
};

// How fresh the page is: PC2024's playtester asks the API for work every minute. Say plainly when it hasn't: the page
// still works, and queued runs wait until it's back.
function renderSynced() {
  const el = $('synced');
  if (!runner?.lastSeen) { el.className = 'synced stale'; el.textContent = online ? 'PC2024 hasn’t checked in since the API last started. Queued runs wait until it does.' : ''; return; }
  const ago = Math.max(0, Math.round((Date.now() - when(runner.lastSeen).getTime()) / 60000));
  const stale = ago > 5;
  el.className = `synced${stale ? ' stale' : ''}`;
  el.textContent = stale
    ? `PC2024 last checked in ${ago >= 120 ? `${Math.round(ago / 60)} h` : `${ago} min`} ago, at ${timeOf(runner.lastSeen)}. Is it off? Everything here still works; queued runs wait until it's back.`
    : `PC2024 checked in ${ago ? `${ago} min ago` : 'just now'}${runner.busy ? ', busy with a run' : ', free'}. Runs and their progress show up within a minute.`;
}
setInterval(renderSynced, 30_000);
const progressBar = (r) => `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${r.progress.total}" aria-valuenow="${r.progress.done}"><span style="width:${r.progress.total ? Math.min(100, (100 * r.progress.done) / r.progress.total).toFixed(1) : 0}%"></span></div>`;

// ── Starting runs: the form queues a request with the API; PC2024 takes it when it's free ───────────────
const starterOptions = () => meta.decks.map((d) => [d.key, d.name]);
// Custom decks: the library's (from meta/dashboard) and the ones recent runs found (deck hunts that beat the
// starters, deck builds' picks), newest first. A run is given a custom deck as its deck code, which PC2024 can
// play whether or not the deck has reached its copy of the library yet.
const SOURCE = { hunt: 'deck hunt', built: 'built by the LLM', imported: 'imported', generated: 'generated', found: 'found in a run' };
function customDecks() {
  const out = (meta.library ?? []).map((d) => ({ ...d, inLibrary: true }));
  const seen = new Set(out.map((d) => d.code.split('.').slice(2).join('.')));
  for (const r of runs) {
    const d = r.details ?? {};
    const found = r.kind === 'deck-hunt' ? (d.decks ?? []).filter((x) => x.code && x.vsStarters >= 0.5)
      : r.kind === 'deck-build' && d.pick?.code ? [{ ...d.pick, vsStarters: d.pick.vsStarters }] : [];
    for (const x of found) {
      const body = x.code.split('.').slice(2).join('.');
      if (seen.has(body)) continue;
      seen.add(body);
      const hero = meta.heroes?.find((h) => h.id === x.hero);
      out.push({ name: x.name.replace(/^hunt: /, ''), code: x.code, hero: x.hero, heroName: hero?.name ?? x.hero, families: hero ? [hero.family] : [],
        source: r.kind === 'deck-hunt' ? 'hunt' : 'built', about: x.idea ?? '', goal: d.goal, vsStarters: x.vsStarters, run: r.id, addedAt: r.startedAt });
    }
  }
  return out;
}
const customOptions = () => customDecks().slice(0, 40).map((d) => [d.code, d.name]);
const deckName = (v) => meta.decks.find((d) => d.key === v)?.name ?? customDecks().find((d) => d.code === v)?.name ?? v;
const groups = (...gs) => gs.filter(([, opts]) => opts.length);
const num = (id, label, value, min, max, step = 1) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" inputmode="decimal" value="${value}" min="${min}" max="${max}" step="${step}" required></div>`;
const opt = ([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`;
const select = (id, label, options) => `<div class="field"><label for="${id}">${label}</label><select id="${id}">${options.map(opt).join('')}</select></div>`;
/** A select with option groups: [[group label, options], …]; a group labelled '' has no heading. */
const groupSelect = (id, label, gs) => `<div class="field"><label for="${id}">${label}</label><select id="${id}">${gs.map(([g, options]) =>
  g ? `<optgroup label="${esc(g)}">${options.map(opt).join('')}</optgroup>` : options.map(opt).join('')).join('')}</select></div>`;
/** What PC2024's playtester lets through in a run's arguments: letters, digits, spaces, dots, commas, dashes. */
const safeText = (t) => t.replace(/[’']/g, '').replace(/[^A-Za-z0-9 .,-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
function renderOptions() {
  const kind = $('kind').value;
  $('opts').innerHTML = {
    'llm-playtest': `<div class="row">${num('games', 'Games', 20, 1, 200)}${select('persona', 'Playtester', [['all', 'Each in turn'], ...meta.personas.map((p) => [p.key, p.name])])}</div>
      <div class="row">${groupSelect('deck', 'LLM plays', groups(['', [['', 'Every matchup, in turn']]], ['Starter decks', starterOptions()], ['Custom decks', customOptions()]))}${groupSelect('vs', 'Against', groups(['', [['starters', 'Every starter deck']]], ['Starter decks', starterOptions().slice().reverse()], ['Custom decks', customOptions()]))}</div>`,
    balance: `<div class="row">${num('scale', 'Size (1 = about 20,000 games)', 1, 0.2, 5, 0.1)}${groupSelect('extra', 'Also against the starters', groups(['', [['', 'No other decks'], ['library', 'Every library deck']]], ['Custom decks', customOptions()]))}</div>`,
    'deck-build': `<div class="field"><label for="goal">What the deck is for</label><textarea id="goal" rows="2" maxlength="200" required placeholder="e.g. an aggressive Pepper deck, or a fun deck for a beginner"></textarea><span class="hint">Letters, numbers and plain punctuation. Built on the laptop with Kimi K3 on Fireworks (about $0.10–0.40, never more than $1); the good ones go in the deck library.</span></div>
      <div class="row">${select('hero', 'Hero Cat', [['', 'The LLM chooses'], ...(meta.heroes ?? []).map((h) => [h.id, `${h.name} (${h.family})`])])}${groupSelect('bvs', 'Tested against', groups(['', [['starters', 'Every starter deck']]], ['Starter decks', starterOptions()], ['Custom decks', customOptions()]))}</div>
      <div class="row">${num('candidates', 'Decks a round', 3, 1, 6)}${num('rounds', 'Rounds', 2, 1, 4)}</div>`,
    'deck-hunt': `<div class="row">${num('ideas', 'Deck ideas', 6, 1, 12)}</div>`,
    nightly: `<div class="row">${num('hours', 'Hours of LLM games', 2, 0.5, 8, 0.5)}</div>`,
  }[kind];
  const deck = $('deck');
  if (deck) { const sync = () => { $('vs').closest('.field').hidden = !deck.value; }; deck.addEventListener('change', sync); sync(); }
}
function buildRequest() {
  const kind = $('kind').value;
  const n = (id) => Number($(id).value);
  if (kind === 'llm-playtest') {
    const deck = $('deck').value, vs = $('vs').value, persona = $('persona').value;
    const vsName = vs === 'starters' ? 'every starter' : deckName(vs);
    return {
      args: `--provider pc2024 --parallel 8 --games ${n('games')} --persona ${persona}${deck ? ` --deck ${deck} --vs ${vs}` : ''}`,
      label: `${n('games')} LLM games${deck ? `, ${deckName(deck)} vs ${vsName}` : ''}${persona === 'all' ? '' : `, ${$('persona').selectedOptions[0].text.toLowerCase()}`}`,
    };
  }
  if (kind === 'balance') {
    const extra = $('extra').value;
    return {
      args: `--scale ${n('scale')} --quiet${extra ? ` --${extra === 'library' ? 'library' : `deck ${extra}`}` : ''}`,
      label: `Bot gauntlet at size ${n('scale')}${extra ? `, with ${extra === 'library' ? 'the library decks' : deckName(extra)}` : ''}`,
    };
  }
  if (kind === 'deck-build') {
    const goal = safeText($('goal').value), hero = $('hero').value, vs = $('bvs').value;
    return {
      args: `--provider fireworks-k3 --max-usd 1 --candidates ${n('candidates')} --rounds ${n('rounds')} --vs ${vs}${hero ? ` --hero ${hero}` : ''} --goal ${goal}`,
      label: `Build a deck: ${goal}${vs === 'starters' ? '' : `, against ${deckName(vs)}`}`,
      invalid: goal.length < 3 ? 'Say what the deck is for.' : '',
    };
  }
  if (kind === 'deck-hunt') return { args: `--provider fireworks-k3 --ideas ${n('ideas')}`, label: `Deck hunt, ${n('ideas')} ideas, Kimi K3` };
  return { args: `--provider pc2024 --hours ${n('hours')}`, label: `Nightly run with ${n('hours')} h of LLM games` };
}
$('kind').addEventListener('change', renderOptions);
renderOptions();
$('runform').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!online) return;
  const { args, label, invalid } = buildRequest();
  if (invalid) { $('formnote').textContent = invalid; return; }
  const name = $('runname').value.trim().slice(0, 60);
  $('formnote').textContent = 'Queuing…';
  try {
    await queueRun({ command: $('kind').value, args, label, ...(name ? { name } : {}) });
    $('formnote').textContent = `Queued: ${name || label}.`;
    $('runname').value = '';
    void refresh();
  } catch (err) {
    $('formnote').textContent = err instanceof DashboardError && err.code === 'refused' ? err.message : 'The request could not be saved. Try again in a moment.';
  }
});
// A request's state comes from its run once there is one: "started" alone would go stale the moment the
// run finishes. Finished requests drop out after 3 days (the API deletes them after 14); runs stay.
const REQUEST_DAYS = 3;
function requestState(q) {
  const run = runs.find((r) => r.request === q.id || r.id === q.run);
  if (q.status === 'queued' || q.status === 'failed') return { run, status: q.status, text: q.status };
  if (q.status === 'starting' && !run) return { run, status: 'queued', text: 'starting' };
  if (run?.result === 'running') return { run, status: 'running', text: 'running' };
  if (run?.result === 'abandoned') return { run, status: 'abandoned', text: 'stopped' };
  if (run) return { run, status: run.result, text: `done · ${run.result}` };
  const age = Date.now() - when(q.startedAt ?? q.createdAt).getTime();
  return { run, status: age > 12 * 3600e3 ? 'unknown' : 'started', text: age > 12 * 3600e3 ? 'no run found' : 'started' };
}
function renderRequests() {
  const cutoff = Date.now() - REQUEST_DAYS * 86400e3;
  const shown = requests.map((q) => ({ q, ...requestState(q) }))
    .filter(({ q, status }) => status === 'queued' || status === 'running' || status === 'started' || when(q.createdAt).getTime() > cutoff);
  if (!shown.length) { $('requests').innerHTML = `<li class="note">No requests in the last ${REQUEST_DAYS} days.</li>`; return; }
  $('requests').innerHTML = shown.map(({ q, run, status, text }) => {
    const note = run && run.result !== 'running' ? '' : q.note;
    const progress = run?.result === 'running' && run.progress ? progressText(run) : '';
    return `<li><span class="pill ${esc(status)}">${esc(text)}</span><span>${esc(q.name || q.label)}${q.name ? ` <span class="note">(${esc(q.label)})</span>` : ''} <span class="times">${esc(dayOf(q.createdAt) === dayOf(new Date().toISOString()) ? timeOf(q.createdAt) : `${when(q.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${timeOf(q.createdAt)}`)}</span>${progress ? `<br><span class="note">${esc(progress)}</span>` : note ? `<br><span class="note">${esc(note)}</span>` : ''}${run ? `<br><button class="link" data-run="${esc(run.id)}">See the run</button>` : ''}${q.status === 'queued' ? ` <button class="link" data-cancel="${esc(q.id)}">Cancel</button>` : ''}</span></li>`;
  }).join('');
}
$('customs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-run]');
  if (b) { selected = b.dataset.run; renderRuns(); renderDetail(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
$('requests').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.run) { selected = b.dataset.run; renderRuns(); renderDetail(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  if (b.dataset.cancel && online) { try { await cancelRequest(b.dataset.cancel); void refresh(); } catch { /* the list shows it is still there */ } }
});

function renderDetail() {
  const r = runs.find((x) => x.id === selected) ?? runs[0];
  if (!r) { $('detail').innerHTML = '<div class="empty">No runs yet. They appear here once a run is uploaded.</div>'; return; }
  selected = r.id;
  const d = r.details ?? {};
  const facts = [
    ['When', `${dayOf(r.startedAt)} ${timeOf(r.startedAt)}`], [r.progress ? 'Running for' : 'Took', dur(r.durationSec)], r.progress ? null : ['Games', (r.games ?? 0).toLocaleString()],
    ['Machine', r.host], ['Cards', r.cardsHash],
    d.model ? ['Model', `${d.provider} ${d.model}`] : null,
    typeof d.costUsd === 'number' ? ['Cost', `$${d.costUsd.toFixed(2)}`] : null,
  ].filter(Boolean);
  $('detail').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
      <h2>${esc(runTitle(r))}${runName(r) ? ` <span class="note">${esc(KIND[r.kind] ?? r.kind)}</span>` : ''}</h2><span class="pill ${esc(r.result)}">${esc(r.result)}</span>
    </div>
    <div class="facts">${facts.map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join('')}</div>
    ${r.progress ? `<div><div class="note">${esc(progressText(r))} · updated ${esc(timeOf(r.progress.updatedAt))}${r.result === 'abandoned' ? ' · the runner stopped before finishing' : ''}</div>${progressBar(r)}</div>` : ''}
    <div class="report">${reportHtml(r)}</div>
    <div class="note mono">${esc(r.id)}</div>`;
  for (const b of document.querySelectorAll('.run')) b.setAttribute('aria-current', String(b.dataset.id === selected));
}

/** The run's report, fetched the first time the run is opened. */
function reportHtml(r) {
  if (r.result === 'running') return '<p class="note">The report appears here when the run finishes.</p>';
  const got = reports.get(r.id);
  if (got === null) return '<p class="note">Loading the report…</p>';
  if (got !== undefined) return got ? markdown(got) : '';
  reports.set(r.id, null);
  runWithReport(r.id).then((full) => { reports.set(r.id, full.report ?? ''); if (selected === r.id) renderDetail(); })
    .catch(() => { reports.delete(r.id); });
  return '<p class="note">Loading the report…</p>';
}

function renderCustoms() {
  const all = customDecks();
  if (!all.length) { $('customs').innerHTML = '<li class="note">No custom decks yet. Deck hunts and deck builds find them; <span class="mono">npm run decks -- import</span> keeps the good ones.</li>'; return; }
  $('customs').innerHTML = all.slice(0, 24).map((d) => {
    const color = meta.decks.find((x) => x.hero === d.hero)?.color ?? d.color ?? 'var(--muted)';
    const where = d.inLibrary ? `library: ${esc(d.key)}` : `<button class="link" data-run="${esc(d.run)}">${esc(SOURCE[d.source] ?? d.source)}</button>`;
    return `<li><span class="dot" style="background:${esc(color)}"></span><span class="name">${esc(d.name)}</span>
      <span class="rate">${typeof d.vsStarters === 'number' ? `${Math.round(d.vsStarters * 100)}%` : ''}</span>
      <span class="sub">${esc(d.heroName)}${d.families?.length ? ` · ${esc(d.families.join(' + '))}` : ''} · ${d.inLibrary ? `${esc(SOURCE[d.source] ?? d.source)} · ` : ''}${where}${d.llm ? ` · LLM player won ${d.llm.won} of ${d.llm.games}` : ''}${d.pinned ? ' · pinned' : ''}</span>
      ${d.goal || d.about ? `<span class="about">${esc(d.goal ? `For: ${d.goal}. ` : '')}${esc(d.about)}</span>` : ''}</li>`;
  }).join('');
}

function renderAll() {
  const latest = runs[0];
  const pill = $('latest-pill');
  if (latest) {
    pill.hidden = false;
    pill.className = `pill ${latest.result}`;
    pill.textContent = `Latest: ${latest.result}`;
    $('subtitle').textContent = `${runs.length} runs · last one ${dayOf(latest.startedAt)} at ${timeOf(latest.startedAt)}.`;
  }
  renderDecks(); renderIssues(); renderTrend(); renderRuns(); renderDetail(); renderRequests(); renderSynced(); renderCustoms();
}

// ── Accounts tab: the Via Mochi services (worked out by the API every 10 minutes, apps/api/src/playtests/ops.ts) ──
let ops = null;
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());
/** Today's request times for one service: typical (median), 95% under, and how many took over 2 seconds. */
function speedToday(service) {
  const t = ops.days?.[ops.days.length - 1]?.requests?.[service];
  if (!t?.n) return '<div class="note">No requests timed yet today.</div>';
  return `<div class="note">Today: typical <b>${t.p50} ms</b> · 95% under <b>${t.p95} ms</b> · <span class="${t.slow ? 'slow' : ''}">${t.slow} over 2 s</span> (${t.n} requests)</div>`;
}
function renderAccounts() {
  if (!ops) return;
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  const names = { 'viamochi-id': ['Account service', 'id.viamochi.com: sign-in, friends, Pawtraits'], 'fruitcats-api': ['Deck sync', 'api.fruitcats.viamochi.com: decks and Showcase'] };
  $('acct-health').innerHTML = ops.health.map((h) => `<div class="panel svc">
      <div><b>${esc(names[h.service]?.[0] ?? h.service)}</b><div class="note">${esc(names[h.service]?.[1] ?? '')}</div>${speedToday(h.service)}</div>
      <span class="pill ${h.ok ? 'pass' : 'block'}">${h.ok ? `Up · ${h.ms} ms` : 'Down'}</span>
    </div>`).join('') + `<div class="panel svc"><div><b>Checked</b><div class="note">${esc(dayOf(ops.updatedAt))} at ${esc(timeOf(ops.updatedAt))}</div></div><span class="pill ${Date.now() - Date.parse(ops.updatedAt) > 30 * 60000 ? 'warn' : 'pass'}">${esc(ago(ops.updatedAt))}</span></div>`;
  if (ops.unreadable?.length) $('acct-health').innerHTML += `<div class="panel"><div class="note">Some logs couldn’t be read, so their numbers are missing: ${esc(ops.unreadable.join('; '))}</div></div>`;
  const week = ops.days.slice(-7);
  const sum = (k) => week.reduce((t, d) => t + (d[k] ?? 0), 0);
  const a = ops.accounts;
  const kpis = [
    ['Accounts', a?.total, a ? `${a.deleting} being deleted` : 'waiting for the service’s totals'],
    ['New this week', sum('newAccounts'), 'accounts created'],
    ['Active this week', ops.activeLast7Days, 'signed in or synced'],
    ['Sign-ins this week', sum('signins'), `${sum('codes')} code emails sent`],
    ['Saved decks', ops.decks?.decks, ops.decks ? `in ${ops.decks.accountsWithDecks} account${ops.decks.accountsWithDecks === 1 ? '' : 's'}` : ''],
    ['Friendships', ops.friendships, ''],
    ['Contact us', sum('support'), 'messages this week'],
    ['Errors', sum('errors'), 'this week'],
  ];
  $('acct-kpis').innerHTML = kpis.map(([label, n, sub]) => `<div class="kpi"><small>${esc(label)}</small><span class="num">${fmtNum(n)}</span><small>${esc(sub)}</small></div>`).join('');
  const max = Math.max(1, ...ops.days.map((d) => d.signins + d.syncs));
  const cell = (n, bad = false) => `<td class="${n ? (bad ? 'bad' : '') : 'zero'}">${n}</td>`;
  $('acct-days').innerHTML = `<thead><tr><th>Day</th><th>New</th><th>Sign-ins</th><th>Syncs</th><th>Contact</th><th title="Requests that took over 2 seconds">Slow</th><th>Errors</th><th class="barcell">Activity</th></tr></thead><tbody>${
    [...ops.days].reverse().map((d) => `<tr><td>${esc(new Date(d.day + 'T12:00:00Z').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }))}</td>${cell(d.newAccounts)}<td class="${d.signins ? '' : 'zero'}">${d.signins}${d.signins ? ` <span class="note">(${d.signinUsers})</span>` : ''}</td>${cell(d.syncs)}${cell(d.support)}${cell(Object.values(d.requests ?? {}).reduce((t, r) => t + (r?.slow ?? 0), 0), true)}${cell(d.errors, true)}<td class="barcell"><div class="minibar" style="width:${((d.signins + d.syncs) / max) * 100}%"></div></td></tr>`).join('')}</tbody>`;
  $('acct-invites').innerHTML = ops.invites?.length ? ops.invites.map((i) => `<div class="invite"><span class="mono">${esc(i.code)}</span><span class="track"><span style="width:${Math.min(100, (i.used / i.size) * 100)}%"></span></span><span class="num">${i.used} / ${i.size}</span></div>`).join('')
    : `<p class="note">${a ? 'No invite codes: sign-up is open to everyone.' : 'Waiting for the service’s totals.'}</p>`;
  $('acct-errors').innerHTML = ops.recentErrors?.length ? ops.recentErrors.map((e) => `<li><span class="times">${esc(timeOf(e.time))}</span><span><b>${esc(e.event || 'error')}</b> <span class="note">${esc(e.service)}</span>${e.message ? `<br><span class="note">${esc(e.message)}</span>` : ''}</span></li>`).join('')
    : '<li class="note">None.</li>';
  $('acct-slowest').innerHTML = ops.slowest?.length ? ops.slowest.map((r) => `<li><span class="times">${esc(timeOf(r.time))}</span><span><b class="${r.ms > 2000 ? 'slow' : ''}">${(r.ms / 1000).toFixed(1)} s</b> ${esc(r.request)} <span class="note">${esc(r.service)} · ${esc(r.status)}</span></span></li>`).join('')
    : '<li class="note">No requests timed yet.</li>';
  const access = ops.logAccess;
  const size = (b) => (b < 1e6 ? `${Math.round(b / 1e3)} KB` : `${(b / 1e6).toFixed(1)} MB`);
  if (!access) {
    $('acct-access').innerHTML = '<tbody><tr><td class="zero">Not recording yet: run scripts/setup/log-access-audit.ps1 (docs/accounts.md).</td></tr></tbody>';
  } else if (access.error) {
    $('acct-access').innerHTML = `<tbody><tr><td class="bad">Couldn’t read the access log: ${esc(access.error)}</td></tr></tbody>`;
  } else {
    $('acct-access').innerHTML = `<thead><tr><th>Identity</th><th>Reads</th><th>Refused</th><th>Data</th><th>From</th><th>Last read</th></tr></thead><tbody>${
      access.readers.length ? access.readers.map((r) => `<tr>
        <td class="${r.name ? '' : 'bad'}">${esc(r.name ?? 'Unknown identity')}<br><span class="note mono">${esc(r.appId)}</span></td>
        <td>${fmtNum(r.reads)}</td>${cell(r.denied, true)}<td>${esc(size(r.bytes))}</td>
        <td>${r.ips.map((i) => `<span class="mono">${esc(i.ip)}</span> <span class="note">(${fmtNum(i.reads)})</span>`).join('<br>')}${r.ipCount > r.ips.length ? `<br><span class="note">and ${r.ipCount - r.ips.length} more</span>` : ''}</td>
        <td>${esc(dayOf(r.lastAt))} ${esc(timeOf(r.lastAt))}</td></tr>`).join('')
      : '<tr><td class="zero" colspan="6">No reads.</td></tr>'}</tbody>`;
  }
}

function showTab(tab) {
  for (const t of ['playtests', 'accounts']) {
    $(`tab-${t}`).hidden = t !== tab;
    $(`tabbtn-${t}`).setAttribute('aria-selected', String(t === tab));
  }
  $('latest-pill').style.visibility = tab === 'playtests' ? '' : 'hidden';
  $('eyebrow').textContent = tab === 'playtests' ? 'Fruitcats · automated playtesting' : 'Fruitcats · Via Mochi services';
  $('title').textContent = tab === 'playtests' ? 'Playtests' : 'Accounts';
  for (const id of ['subtitle', 'synced']) $(id).hidden = tab !== 'playtests';
  try { localStorage.setItem('fc-dashboard-tab', tab); } catch { /* fine without it */ }
  if (tab === 'playtests') renderTrend();
}
document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const next = $('tabbtn-playtests').getAttribute('aria-selected') === 'true' ? 'accounts' : 'playtests';
  showTab(next); $(`tabbtn-${next}`).focus();
});
try { if (localStorage.getItem('fc-dashboard-tab') === 'accounts') showTab('accounts'); } catch { /* storage may be blocked */ }

let resizeTimer;
addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderTrend, 150); });

$('runfilter').addEventListener('input', renderRuns);
$('runs').addEventListener('click', (e) => {
  const b = e.target.closest('.run');
  if (!b) return;
  selected = b.dataset.id;
  try { localStorage.setItem('fc-playtest-run', selected); } catch { /* fine without it */ }
  renderDetail();
  if (matchMedia('(max-width: 860px)').matches) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Every 20 seconds while the page is open and showing; at once when it comes back into view.
function showProblem(err) {
  const signIn = err instanceof DashboardError && err.code === 'signed_out';
  const text = err instanceof DashboardError ? err.message : 'Something went wrong loading the playtests.';
  const html = `<div class="empty">${esc(text)}${signIn ? ' <a href="/account.html">Sign in on your Account page</a>, then come back.' : ''}</div>`;
  if (!online) {
    $('runform').querySelector('button').disabled = true;
    $('formnote').textContent = signIn ? 'Sign in to start runs.' : '';
    for (const id of ['decks', 'runs']) $(id).innerHTML = html;
    $('requests').innerHTML = '<li class="note">—</li>';
    $('issues').innerHTML = '<li class="note">—</li>';
    $('trend').innerHTML = '';
    $('acct-health').innerHTML = `<div class="panel">${html}</div>`;
  } else {
    $('synced').className = 'synced stale';
    $('synced').textContent = `${text} Showing what was loaded at ${timeOf(new Date().toISOString())}.`;
  }
}
let loading = false;
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const data = await loadDashboard();
    online = true;
    $('runform').querySelector('button').disabled = false;
    if ($('formnote').textContent === 'Sign in to start runs.') $('formnote').textContent = '';
    runner = data.runner;
    requests = data.requests ?? [];
    const firstRuns = !runs.length;
    runs = data.runs ?? [];
    if (data.meta) {
      meta = data.meta;
      const kind = $('kind').value;
      renderOptions();
      $('kind').value = kind;
    } else if (firstRuns) renderOptions();
    renderAll();
    if (data.ops) { ops = data.ops; renderAccounts(); }
    else $('acct-health').innerHTML = '<div class="panel"><div class="empty">No account data yet: the API works it out every 10 minutes.</div></div>';
  } catch (err) {
    showProblem(err);
  } finally {
    loading = false;
  }
}
void refresh();
setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 20_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refresh(); });
