// Our own logs (docs/accounts.md, Observability): JSON lines in append blobs, one file per category, hour and
// instance, flushed every ~10 seconds. "ops" is kept 30 days; "security" a year, tamper-proof. Same layout as
// viamochi-id's, so tools/ops reads both:
//   logs/logs/ops/fruitcats-api/2026/09/24/21-<instance>.jsonl    security/security/fruitcats-api/2026/09/24/21-<instance>.jsonl
// Account ids appear; emails, deck names and other text players type never do. Run locally (LOCAL_DATA set), events
// are only printed.

import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const SERVICE = 'fruitcats-api';
const endpoint = process.env.BLOB_ENDPOINT ?? 'https://fruitcatsdata.blob.core.windows.net';
const local = !!process.env.LOCAL_DATA;
const blobs = local ? null : new BlobServiceClient(endpoint, new DefaultAzureCredential());
const instance = (process.env.WEBSITE_INSTANCE_ID ?? 'local').slice(0, 8);
const queue: { category: string; line: string }[] = [];
const created = new Set<string>();

export type Category = 'ops' | 'security';

/** Record an event, e.g. log('ops', 'decks.synced', { userId, decks: 3 }). Also printed, for App Service's log stream. */
export function log(category: Category, event: string, fields: Record<string, unknown> = {}, level = 'info') {
  const line = JSON.stringify({ time: new Date().toISOString(), service: SERVICE, level, event, ...fields });
  (level === 'error' ? console.error : console.log)(line);
  if (!blobs) return;
  // Runaway protection: past the day's ceiling, only security events, warnings and errors are kept, until midnight UTC.
  const day = new Date().toISOString().slice(0, 10);
  if (today.day !== day) today = { day, bytes: 0, over: false };
  if (today.bytes > DAILY_CEILING && category !== 'security' && level !== 'warning' && level !== 'error') return;
  today.bytes += line.length;
  queue.push({ category, line });
  if (today.bytes > DAILY_CEILING && !today.over) {
    today.over = true;
    queue.push({ category: 'ops', line: JSON.stringify({ time: new Date().toISOString(), service: SERVICE, level: 'error', event: 'logs.ceiling_reached',
      message: `More than ${DAILY_CEILING / 1048576} MB of logs today: only security events, warnings and errors until midnight UTC.` }) });
  }
}

const DAILY_CEILING = Number(process.env.LOG_DAILY_MB ?? 100) * 1048576;
let today = { day: '', bytes: 0, over: false };

async function flush() {
  if (!queue.length || !blobs) return;
  const batch = queue.splice(0);
  const hour = new Date().toISOString().slice(0, 13).replace(/[-T]/g, '/');   // 2026/09/24/21
  for (const category of new Set(batch.map((b) => b.category))) {
    const text = batch.filter((b) => b.category === category).map((b) => b.line + '\n').join('');
    const [container, prefix] = category === 'security' ? ['security', 'security'] : ['logs', `logs/${category}`];
    const name = `${prefix}/${SERVICE}/${hour}-${instance}.jsonl`;
    try {
      const blob = blobs.getContainerClient(container).getAppendBlobClient(name);
      if (!created.has(name)) { await blob.createIfNotExists(); created.add(name); }
      await blob.appendBlock(text, Buffer.byteLength(text));
    } catch (e) {
      console.error(`log flush failed: ${(e as Error).message}`);
    }
  }
}

setInterval(() => void flush(), 10_000).unref();
