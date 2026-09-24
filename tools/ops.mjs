#!/usr/bin/env node
// Read the Via Mochi services' logs (docs/accounts-plan.md, Observability), for people and agents:
//
//   node tools/ops.mjs events                          last hour, every service, ops + security
//   node tools/ops.mjs events --since 6h --level error errors in the last 6 hours
//   node tools/ops.mjs events --service viamochi-id --category security --since 1d
//   node tools/ops.mjs events --user <account id> --since 7d     one player's timeline
//   node tools/ops.mjs events --grep code_sent         events whose line contains the text
//   node tools/ops.mjs tail                            follow new events as they arrive (Ctrl+C to stop)
//
// It signs in as Claude's agent identity (its own CLI folder, ~/.azure-viamochi-agent), which may read the logs but
// not change them. Your own `az` login isn't used.

import { homedir } from 'node:os';
import { join } from 'node:path';
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
} else {
  console.log('Usage: node tools/ops.mjs events|tail [--since 1h] [--service name] [--category ops|security] [--level error] [--user id] [--grep text]');
}
