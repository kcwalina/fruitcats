#!/usr/bin/env node
// Read the Via Mochi services' logs (docs/accounts.md, Observability), for people and agents:
//
//   node tools/ops.mjs events                          last hour, every service, ops + security
//   node tools/ops.mjs events --since 6h --level error errors in the last 6 hours
//   node tools/ops.mjs events --service viamochi-id --category security --since 1d
//   node tools/ops.mjs events --user <account id> --since 7d     one player's timeline
//   node tools/ops.mjs events --grep code_sent         events whose line contains the text
//   node tools/ops.mjs tail                            follow new events as they arrive (Ctrl+C to stop)
//   node tools/ops.mjs snapshot [--out file]           the Accounts tab of the playtest dashboard: health, totals and
//                                                      14 days of sign-ins, syncs and errors, as JSON (see below)
//
// It signs in as Claude's agent identity (its own CLI folder, ~/.azure-viamochi-agent), which may read the logs but
// not change them. Your own `az` login isn't used.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AzureCliCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

process.env.AZURE_CONFIG_DIR ??= join(homedir(), '.azure-viamochi-agent');
const credential = new AzureCliCredential();
const SOURCES = [
  { service: 'viamochi-id', account: 'viamochiidstore' },
  { service: 'fruitcats-api', account: 'fruitcatsdata' },
];
const CATEGORIES = { ops: ['logs', 'logs/ops'], security: ['security', 'security'] };

const args = process.argv.slice(2);
const command = args[0] ?? 'events';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const since = parseDuration(opt('since', '1h'));
const service = opt('service');
const category = opt('category');
const level = opt('level');
const user = opt('user');
const grep = opt('grep');

function parseDuration(text) {
  const m = /^(\d+)([mhd])$/.exec(text);
  if (!m) throw new Error(`--since wants something like 30m, 6h or 7d, not "${text}"`);
  return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
}

/** The hour folders ("2026/09/24/21") from `from` to now. */
function hours(from) {
  const out = [];
  for (let t = Math.floor(from / 3_600_000) * 3_600_000; t <= Date.now(); t += 3_600_000)
    out.push(new Date(t).toISOString().slice(0, 13).replace(/[-T]/g, '/'));
  return out;
}

const seen = new Map();   // blob name -> bytes already read (for tail)

async function read(from, { onlyNew = false } = {}) {
  const events = [];
  for (const src of SOURCES.filter((s) => !service || s.service === service)) {
    const blobs = new BlobServiceClient(`https://${src.account}.blob.core.windows.net`, credential);
    for (const [cat, [container, prefix]] of Object.entries(CATEGORIES)) {
      if (category && category !== cat) continue;
      const box = blobs.getContainerClient(container);
      for (const hour of hours(from)) {
        for await (const item of box.listBlobsFlat({ prefix: `${prefix}/${src.service}/${hour}` })) {
          const already = onlyNew ? seen.get(item.name) ?? 0 : 0;
          if (item.properties.contentLength <= already) continue;
          const body = await box.getBlobClient(item.name).downloadToBuffer(already);
          seen.set(item.name, item.properties.contentLength);
          for (const line of body.toString('utf8').split('\n')) {
            if (!line.trim()) continue;
            let e; try { e = JSON.parse(line); } catch { continue; }
            if (Date.parse(e.time) < from) continue;
            if (level && e.level !== level) continue;
            if (user && e.userId !== user) continue;
            if (grep && !line.includes(grep)) continue;
            events.push({ ...e, category: cat });
          }
        }
      }
    }
  }
  return events.sort((a, b) => a.time.localeCompare(b.time));
}

function print(e) {
  const { time, service: s, category: c, level: l, event, message, ...rest } = e;
  delete rest.source;
  const extra = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
  console.log(`${time.slice(0, 19).replace('T', ' ')}  ${s.padEnd(13)} ${c.padEnd(8)} ${(l ?? '').padEnd(5)} ${event ?? ''}  ${extra}`);
}

if (command === 'events') {
  const events = await read(Date.now() - since);
  events.forEach(print);
  console.log(`\n${events.length} event(s)`);
} else if (command === 'tail') {
  const start = Date.now() - 60_000;
  (await read(start)).forEach(print);
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    (await read(Date.now() - 2 * 3_600_000, { onlyNew: true })).forEach(print);
  }
} else if (command === 'snapshot') {
  const out = opt('out', fileURLToPath(new URL('../playtest/.state/ops.json', import.meta.url)));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(await snapshot(), null, 1));
  console.log(`Wrote ${out}`);
} else {
  console.log('Usage: node tools/ops.mjs events|tail|snapshot [--since 1h] [--service name] [--category ops|security] [--level error] [--user id] [--grep text]');
}

// ── snapshot: the Accounts tab ───────────────────────────────────────────────────────────────────────────────────────
//
// The dashboard relay (playtest/dashboard/RELAY.md) runs this every 10 minutes and uploads the file as ops/accounts.
// Finished hours of logs don't change, so each hour's events are read once and kept in playtest/.state/ops-cache.json
// (account ids only, like the logs). Totals come from the stats files the services write every 15 minutes.

async function snapshot() {
  const DAYS = 14;
  const now = Date.now();
  const cacheFile = fileURLToPath(new URL('../playtest/.state/ops-cache.json', import.meta.url));
  let cache = {};
  try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { /* first run */ }
  const thisHour = new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, '/');
  const from = now - DAYS * 86_400_000;
  const keep = (e) => ({ t: e.time, s: e.service, e: e.event ?? '', l: e.level ?? '', u: e.userId ?? null,
    ...(e.event === 'http.request' ? { ms: Number(e.ms), p: `${e.method} ${e.path}`, st: Number(e.status) } : {}),
    ...(e.level === 'error' || e.level === 'Error'
      ? { m: String(e.message ?? e.Error ?? '').replace(e.event ?? '', '').trim().slice(0, 200) } : {}) });
  const events = [];
  for (const src of SOURCES) {
    const blobs = new BlobServiceClient(`https://${src.account}.blob.core.windows.net`, credential);
    for (const [cat, [container, prefix]] of Object.entries(CATEGORIES)) {
      const box = blobs.getContainerClient(container);
      for (const hour of hours(from)) {
        const key = `${src.service}|${cat}|${hour}`;
        if (hour !== thisHour && cache[key]) { events.push(...cache[key]); continue; }
        const got = [];
        for await (const item of box.listBlobsFlat({ prefix: `${prefix}/${src.service}/${hour}` })) {
          const body = await box.getBlobClient(item.name).downloadToBuffer();
          for (const line of body.toString('utf8').split('\n')) {
            if (!line.trim()) continue;
            try { got.push(keep(JSON.parse(line))); } catch { /* a torn line */ }
          }
        }
        if (hour !== thisHour) cache[key] = got;
        events.push(...got);
      }
    }
  }
  for (const key of Object.keys(cache)) {
    const hour = key.split('|')[2];
    if (Date.parse(`${hour.replace(/\//g, '-').replace(/-(\d\d)$/, 'T$1')}:00:00Z`) < from - 86_400_000) delete cache[key];
  }
  writeFileSync(cacheFile, JSON.stringify(cache));

  const stat = async (account, name) => {
    try {
      const blob = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential)
        .getContainerClient('logs').getBlobClient(`stats/${name}.json`);
      return JSON.parse((await blob.downloadToBuffer()).toString('utf8'));
    } catch { return null; }
  };
  const health = async (service, url) => {
    const started = Date.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      return { service, ok: r.ok, ms: Date.now() - started };
    } catch { return { service, ok: false, ms: null }; }
  };

  const id = await stat('viamochiidstore', 'viamochi-id');
  const api = await stat('fruitcatsdata', 'fruitcats-api');
  const isError = (e) => e.l === 'error' || e.l === 'Error';
  const days = [];
  for (let d = DAYS - 1; d >= 0; d--) {
    const day = new Date(now - d * 86_400_000).toISOString().slice(0, 10);
    const on = events.filter((e) => e.t?.startsWith(day));
    const users = (name) => new Set(on.filter((e) => e.e === name && e.u).map((e) => e.u)).size;
    days.push({
      day,
      newAccounts: id?.accounts?.createdPerDay?.[day] ?? 0,
      signins: on.filter((e) => e.e === 'signin.completed').length,
      signinUsers: users('signin.completed'),
      codes: on.filter((e) => e.e === 'signin.code_sent').length,
      syncs: on.filter((e) => e.e === 'decks.synced').length,
      syncUsers: users('decks.synced'),
      support: on.filter((e) => e.e === 'support.message_sent').length,
      errors: on.filter(isError).length,
      requests: Object.fromEntries(SOURCES.map(({ service }) => [service, timing(on.filter((e) => e.e === 'http.request' && e.s === service))])),
    });
  }
  const week = events.filter((e) => Date.parse(e.t) >= now - 7 * 86_400_000);
  const active = new Set(week.filter((e) => (e.e === 'signin.completed' || e.e === 'decks.synced') && e.u).map((e) => e.u));
  const recentErrors = events.filter((e) => isError(e) && Date.parse(e.t) >= now - 86_400_000)
    .sort((a, b) => b.t.localeCompare(a.t)).slice(0, 20)
    .map((e) => ({ time: e.t, service: e.s, event: e.e, message: e.m ?? '' }));
  const slowest = events.filter((e) => e.e === 'http.request' && Date.parse(e.t) >= now - 86_400_000)
    .sort((a, b) => b.ms - a.ms).slice(0, 10)
    .map((e) => ({ time: e.t, service: e.s, request: e.p, status: e.st, ms: e.ms }));
  return {
    updatedAt: new Date(now).toISOString(),
    slowest,
    health: await Promise.all([health('viamochi-id', 'https://id.viamochi.com/healthz'), health('fruitcats-api', 'https://api.fruitcats.viamochi.com/healthz')]),
    accounts: id?.accounts ?? null, invites: id?.invites ?? [], friendships: id?.friendships ?? null, statsAt: { id: id?.time ?? null, api: api?.time ?? null },
    decks: api ? { decks: api.decks, accountsWithDecks: api.accountsWithDecks, showcases: api.showcases } : null,
    activeLast7Days: active.size,
    days,
    recentErrors,
  };
}

/** Requests' count, median and 95th-percentile time, and how many took over 2 seconds. */
function timing(list) {
  const ms = list.map((e) => e.ms).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const at = (q) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : null);
  return { n: ms.length, p50: at(0.5), p95: at(0.95), slow: ms.filter((x) => x > SLOW_MS).length };
}
const SLOW_MS = 2000;
