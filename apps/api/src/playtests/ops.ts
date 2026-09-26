// The Accounts tab of the playtest dashboard: both services' health, their totals, and 14 days of sign-ins, syncs,
// errors and request times from their logs (docs/accounts.md, Observability). The API works it out every 10 minutes
// with its managed identity, which may read both services' logs, and saves it as the dashboard's ops.json.
// `node tools/ops.mjs events` reads the same logs for people and agents.
//
// Finished hours of logs don't change, so each hour's events are read once and kept in memory.

import { BlobServiceClient } from '@azure/storage-blob';
import type { TokenCredential } from '@azure/identity';

const SOURCES = [
  { service: 'viamochi-id', account: 'viamochiidstore' },
  { service: 'fruitcats-api', account: 'fruitcatsdata' },
];
const CATEGORIES: Record<string, [string, string]> = { ops: ['logs', 'logs/ops'], security: ['security', 'security'] };
/** Who may read the logs, for "Who read the logs". This API's own identity is added when it starts. */
const IDENTITIES: Record<string, string> = { 'b224f78d-5fdb-49fd-9fa0-0e64fccae134': "Claude's agent" };
const WATCHED_CONTAINERS = ['logs', 'security'];
const DAYS = 14;
const EVERY_MS = 10 * 60_000;

type Kept = { t: string; s: string; e: string; l: string; u: string | null; ms?: number; p?: string; st?: number; m?: string };
type Read = { t: string; a: string; ip: string; ok: boolean; b: number };

/** The hour folders ("2026/09/24/21") from `from` to now. */
function hours(from: number): string[] {
  const out: string[] = [];
  for (let t = Math.floor(from / 3_600_000) * 3_600_000; t <= Date.now(); t += 3_600_000) out.push(new Date(t).toISOString().slice(0, 13).replace(/[-T]/g, '/'));
  return out;
}

export function startOpsSnapshots(opt: { credential: TokenCredential; save: (ops: unknown) => Promise<void>; log: (event: string, fields: Record<string, unknown>, level?: string) => void }) {
  const { credential } = opt;
  const cache = new Map<string, Kept[] | Read[]>();
  const client = (account: string) => new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);

  // This API's own identity, from its own token, so its reads are named on the page too.
  void credential.getToken('https://storage.azure.com/.default').then((t) => {
    const appid = JSON.parse(Buffer.from(t!.token.split('.')[1], 'base64url').toString('utf8')).appid;
    if (typeof appid === 'string') IDENTITIES[appid] = 'fruitcats-api (this page)';
  }).catch(() => {});

  /** Log sources this identity couldn't read this time (say, before it was given access), for the page to say so. */
  let unreadable: string[] = [];

  async function events(from: number, thisHour: string): Promise<Kept[]> {
    const keep = (e: Record<string, unknown>): Kept => ({
      t: String(e.time), s: String(e.service), e: String(e.event ?? ''), l: String(e.level ?? ''), u: (e.userId as string) ?? null,
      ...(e.event === 'http.request' ? { ms: Number(e.ms), p: `${e.method} ${e.path}`, st: Number(e.status) } : {}),
      ...(e.level === 'error' || e.level === 'Error' ? { m: String(e.message ?? e.Error ?? '').replace(String(e.event ?? ''), '').trim().slice(0, 200) } : {}),
    });
    const all: Kept[] = [];
    unreadable = [];
    for (const src of SOURCES) try {
      const blobs = client(src.account);
      for (const [cat, [container, prefix]] of Object.entries(CATEGORIES)) {
        const box = blobs.getContainerClient(container);
        for (const hour of hours(from)) {
          const key = `${src.service}|${cat}|${hour}`;
          const cached = cache.get(key) as Kept[] | undefined;
          if (hour !== thisHour && cached) { all.push(...cached); continue; }
          const got: Kept[] = [];
          for await (const item of box.listBlobsFlat({ prefix: `${prefix}/${src.service}/${hour}` })) {
            const body = await box.getBlobClient(item.name).downloadToBuffer();
            for (const line of body.toString('utf8').split('\n')) {
              if (!line.trim()) continue;
              try { got.push(keep(JSON.parse(line))); } catch { /* a torn line */ }
            }
          }
          if (hour !== thisHour) cache.set(key, got);
          all.push(...got);
        }
      }
    } catch (e) {
      unreadable.push(`${src.service}: ${String((e as Error).message ?? e).split('\n')[0].slice(0, 160)}`);
    }
    return all;
  }

  /** "1.2.3.4:5678" -> "1.2.3.4", "[2001:db8::1]:5678" -> "2001:db8::1"; an IPv6 address without a port stays whole. */
  const withoutPort = (address: string) => address.startsWith('[') ? address.slice(1, address.indexOf(']'))
    : address.indexOf(':') === address.lastIndexOf(':') ? address.replace(/:\d+$/, '') : address;

  // Both storage accounts send their read log to their own insights-logs-storageread container
  // (scripts/setup/log-access-audit.ps1): every read of the logs, by the identity that made it.
  async function logAccess(from: number, thisHour: string) {
    const reads: Read[] = [];
    let found = false;
    try {
      for (const src of SOURCES) {
        const box = client(src.account).getContainerClient('insights-logs-storageread');
        if (!(await box.exists())) continue;
        found = true;
        const names: string[] = [];
        for await (const item of box.listBlobsFlat({ prefix: 'resourceId=' })) names.push(item.name);
        for (const hour of hours(from)) {
          const key = `access|${src.account}|${hour}`;
          const cached = cache.get(key) as Read[] | undefined;
          if (hour !== thisHour && cached) { reads.push(...cached); continue; }
          const [y, mo, d, h] = hour.split('/');
          const folder = `/y=${y}/m=${mo}/d=${d}/h=${h}/`;
          const got: Read[] = [];
          for (const name of names.filter((n) => n.includes(folder))) {
            const body = await box.getBlobClient(name).downloadToBuffer();
            for (const line of body.toString('utf8').split('\n')) {
              if (!line.trim()) continue;
              let parsed: { records?: unknown[] } & Record<string, unknown>;
              try { parsed = JSON.parse(line); } catch { continue; }
              for (const r of (parsed.records ?? [parsed]) as Record<string, any>[]) {
                const container = String(r.properties?.objectKey ?? '').split('/')[2];
                if (!WATCHED_CONTAINERS.includes(container)) continue;
                got.push({ t: r.time, a: r.identity?.requester?.appId ?? r.identity?.type ?? 'unknown', ip: withoutPort(String(r.callerIpAddress ?? '')),
                  ok: Number(r.statusCode) < 400, b: Number(r.properties?.responseBodySize ?? 0) });
              }
            }
          }
          if (hour !== thisHour) cache.set(key, got);
          reads.push(...got);
        }
      }
    } catch (error) {
      return { error: String((error as Error).message ?? error).slice(0, 200) };
    }
    if (!found) return null;
    const byIdentity = new Map<string, { appId: string; name: string | null; reads: number; denied: number; bytes: number; lastAt: string | null; ips: Map<string, number> }>();
    for (const r of reads) {
      let row = byIdentity.get(r.a);
      if (!row) byIdentity.set(r.a, row = { appId: r.a, name: IDENTITIES[r.a] ?? null, reads: 0, denied: 0, bytes: 0, lastAt: null, ips: new Map() });
      row.reads++;
      if (!r.ok) row.denied++;
      row.bytes += r.b;
      if (!row.lastAt || r.t > row.lastAt) row.lastAt = r.t;
      row.ips.set(r.ip, (row.ips.get(r.ip) ?? 0) + 1);
    }
    const readers = [...byIdentity.values()].map((row) => {
      const ips = [...row.ips].sort((x, z) => z[1] - x[1]);
      return { ...row, ipCount: ips.length, ips: ips.slice(0, 5).map(([ip, n]) => ({ ip, reads: n })) };
    }).sort((x, z) => z.reads - x.reads);
    return { readers };
  }

  /** Requests' count, median and 95th-percentile time, and how many took over 2 seconds. */
  function timing(list: Kept[]) {
    const ms = list.map((e) => e.ms!).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    const at = (q: number) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : null);
    return { n: ms.length, p50: at(0.5), p95: at(0.95), slow: ms.filter((x) => x > 2000).length };
  }

  async function snapshot() {
    const now = Date.now();
    const thisHour = new Date(now).toISOString().slice(0, 13).replace(/[-T]/g, '/');
    const from = now - DAYS * 86_400_000;
    const all = await events(from, thisHour);
    const access = await logAccess(from, thisHour);
    for (const key of cache.keys()) {
      const hour = key.split('|')[2];
      if (Date.parse(`${hour.replace(/\//g, '-').replace(/-(\d\d)$/, 'T$1')}:00:00Z`) < from - 86_400_000) cache.delete(key);
    }
    const stat = async (account: string, name: string) => {
      try { return JSON.parse((await client(account).getContainerClient('logs').getBlobClient(`stats/${name}.json`).downloadToBuffer()).toString('utf8')); }
      catch { return null; }
    };
    const health = async (service: string, url: string) => {
      const started = Date.now();
      try { const r = await fetch(url, { signal: AbortSignal.timeout(10_000) }); return { service, ok: r.ok, ms: Date.now() - started }; }
      catch { return { service, ok: false, ms: null }; }
    };
    const id = await stat('viamochiidstore', 'viamochi-id');
    const api = await stat('fruitcatsdata', 'fruitcats-api');
    const isError = (e: Kept) => e.l === 'error' || e.l === 'Error';
    const days = [];
    for (let d = DAYS - 1; d >= 0; d--) {
      const day = new Date(now - d * 86_400_000).toISOString().slice(0, 10);
      const on = all.filter((e) => e.t?.startsWith(day));
      const users = (name: string) => new Set(on.filter((e) => e.e === name && e.u).map((e) => e.u)).size;
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
    const week = all.filter((e) => Date.parse(e.t) >= now - 7 * 86_400_000);
    const active = new Set(week.filter((e) => (e.e === 'signin.completed' || e.e === 'decks.synced') && e.u).map((e) => e.u));
    return {
      updatedAt: new Date(now).toISOString(),
      slowest: all.filter((e) => e.e === 'http.request' && Date.parse(e.t) >= now - 86_400_000).sort((a, b) => b.ms! - a.ms!).slice(0, 10)
        .map((e) => ({ time: e.t, service: e.s, request: e.p, status: e.st, ms: e.ms })),
      health: await Promise.all([health('viamochi-id', 'https://id.viamochi.com/healthz'), health('fruitcats-api', 'https://api.fruitcats.viamochi.com/healthz')]),
      accounts: id?.accounts ?? null, invites: id?.invites ?? [], friendships: id?.friendships ?? null, statsAt: { id: id?.time ?? null, api: api?.time ?? null },
      decks: api ? { decks: api.decks, accountsWithDecks: api.accountsWithDecks, showcases: api.showcases } : null,
      activeLast7Days: active.size,
      days,
      recentErrors: all.filter((e) => isError(e) && Date.parse(e.t) >= now - 86_400_000).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 20)
        .map((e) => ({ time: e.t, service: e.s, event: e.e, message: e.m ?? '' })),
      logAccess: access,
      ...(unreadable.length ? { unreadable } : {}),
    };
  }

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await opt.save(await snapshot()); }
    catch (e) { opt.log('ops.snapshot_failed', { message: (e as Error).message }, 'warning'); }
    finally { running = false; }
  };
  // Not at once: App Service wants a new start answering before anything heavy runs.
  setTimeout(() => { void tick(); setInterval(() => void tick(), EVERY_MS); }, 60_000);
}
