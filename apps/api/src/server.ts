// The Fruitcats API (docs/accounts.md): keeps each Via Mochi account's custom decks and Showcase, so they're the
// same on every device. It only trusts Via Mochi tokens from viamochi-id (checked against its public keys), and each
// account's data is keyed by the account id in those tokens. Hosted on App Service ("fruitcats-api").
//
//   GET  /healthz
//   POST /v1/sync   { decks: SyncDeck[], showcase?: SyncShowcase }  →  the merged state, the same shape
//   GET  /v1/export                  →  everything stored for the signed-in account ("Export my data")
//   DELETE /v1/accounts/{id}         →  erase an account's data; only viamochi-id may call it (a service token)
//   /v1/store…                       →  the Store, while it's only for testers (store.ts)
//   /v1/studio/...                   →  the Artist Studio (studio/studio.ts, docs/artist-studio-plan.md)
//
// One call does everything: the game sends what it has, the newest version of each item wins, and the merged state
// comes back for the game to keep. Decks are small, so sending them all is simpler and safer than tracking changes.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { TableClient } from '@azure/data-tables';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { CARDS, registerSet } from '@fruitcats/engine';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { loadContent } from '../../../content';
import { log } from './logs';
import { eraseOrders, exportOrders, storeRequest } from './store';
import { azureStore } from './studio/store';
import { studio } from './studio/studio';
import { LOCAL_DATA, table } from './tables';

// The engine has no cards of its own: without the sets, every synced deck failed validation and was dropped. Every set,
// prototypes too: a deck may hold cards from a set the Store sells before it's released, and it's kept as well.
loadContent(registerSet, { prototypes: true });

const ID_SERVICE = process.env.VIAMOCHI_ID ?? 'https://viamochi-id.azurewebsites.net';
const TABLES = process.env.TABLE_ENDPOINT ?? 'https://fruitcatsdata.table.core.windows.net';
const BLOBS = process.env.BLOB_ENDPOINT ?? 'https://fruitcatsdata.blob.core.windows.net';
const credential = new DefaultAzureCredential();
const ORIGINS = new Set((process.env.ALLOWED_ORIGINS ??
  'https://fruitcats.viamochi.com,https://polite-sea-0773d4b1e.3.azurestaticapps.net,https://playtest.fruitcats.viamochi.com,http://localhost:5173').split(','));
const MAX_DECKS = 200;
const MAX_BODY = 512 * 1024;

const jwks = createRemoteJWKSet(new URL(`${ID_SERVICE}/.well-known/jwks.json`));
const decksTable = table('decks');
const showcaseTable = table('showcase');

/** A deck as the game stores it, with when it last changed. A deleted deck stays as a marker, so it doesn't come back. */
interface SyncDeck { id: string; updatedAt: number; deleted?: boolean; deck?: { name: string; hero: string; cards: Record<string, number> } }
interface SyncShowcase { faces: string[]; updatedAt: number }

/** Local only (npm run api:local -- --fake-sign-in): "Bearer dev-<account id>" is that account, no email code needed. */
const FAKE_SIGN_IN = !!LOCAL_DATA && process.env.FAKE_SIGN_IN === 'on';

async function accountOf(req: IncomingMessage): Promise<string | null> {
  const auth = req.headers.authorization ?? '';
  if (FAKE_SIGN_IN && /^Bearer dev-[0-9a-f]{32}$/.test(auth)) return auth.slice('Bearer dev-'.length);
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwks, { issuer: ID_SERVICE, audience: 'viamochi' });
    return typeof payload.sub === 'string' && /^[0-9a-f]{32}$/.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

/** The signed-in account and its display name, for the Artist Studio. */
async function userOf(req: IncomingMessage): Promise<{ id: string; name: string } | null> {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwks, { issuer: ID_SERVICE, audience: 'viamochi' });
    if (typeof payload.sub !== 'string' || !/^[0-9a-f]{32}$/.test(payload.sub)) return null;
    return { id: payload.sub, name: typeof payload.name === 'string' && payload.name ? payload.name.slice(0, 40) : 'Artist' };
  } catch {
    return null;
  }
}

// The Artist Studio. Owners are Via Mochi account ids; agents are "Name:sha256-of-key" pairs (tools/studio.ts).
const serveStudio = studio({
  store: azureStore(TABLES, BLOBS, credential),
  account: userOf,
  // viamochi-id checks that the caller is a reviewer too (ViaMochi:Reviewers), and returns only the one account.
  async findByEmail(req, email) {
    const res = await fetch(`${ID_SERVICE}/accounts/by-email?email=${encodeURIComponent(email)}`, { headers: { Authorization: req.headers.authorization ?? '' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`account lookup: ${res.status}`);
    const a = (await res.json()) as { id: string; displayName?: string; email?: string };
    return { id: a.id, name: a.displayName || 'Artist', email: a.email ?? email };
  },
  owners: (process.env.STUDIO_OWNERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  agents: (process.env.STUDIO_AGENTS ?? '').split(',').filter(Boolean).map((pair) => {
    const [name, hash] = pair.split(':');
    return { name: name.trim(), hash: (hash ?? '').trim().toLowerCase() };
  }),
  log: (event, fields) => log(event.includes('error') || event.includes('mismatch') ? 'ops' : 'security', event, fields),
  studioUrl: process.env.STUDIO_URL ?? 'https://fruitcats.viamochi.com/studio.html',
  accountInvite: process.env.STUDIO_ACCOUNT_INVITE,
});

/** A service token from viamochi-id about one account and one purpose (e.g. deleting it). */
async function serviceCall(req: IncomingMessage, userId: string, purpose: string): Promise<boolean> {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwks, { issuer: ID_SERVICE, audience: 'fruitcats-api' });
    return payload.sub === userId && payload.purpose === purpose;
  } catch {
    return false;
  }
}

// ── Keeping the data honest ───────────────────────────────────────────────────────────────────────

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]{1,24}$/i.test(id);
const validTime = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0 && t < Date.now() + 86_400_000;

function cleanDeck(d: unknown): SyncDeck | null {
  const x = d as SyncDeck;
  if (!x || !validId(x.id) || !validTime(x.updatedAt)) return null;
  if (x.deleted) return { id: x.id, updatedAt: x.updatedAt, deleted: true };
  const deck = x.deck;
  if (!deck || typeof deck.name !== 'string' || !CARDS[deck.hero] || typeof deck.cards !== 'object') return null;
  const cards = Object.fromEntries(Object.entries(deck.cards)
    .filter(([id, n]) => CARDS[id] && Number.isInteger(n) && n > 0 && n <= 9));
  return { id: x.id, updatedAt: x.updatedAt, deck: { name: deck.name.slice(0, 40), hero: deck.hero, cards } };
}

function cleanShowcase(s: unknown): SyncShowcase | null {
  const x = s as SyncShowcase;
  if (!x || !Array.isArray(x.faces) || !validTime(x.updatedAt)) return null;
  return { faces: x.faces.filter((f) => typeof f === 'string' && f.length < 40).slice(0, 60), updatedAt: x.updatedAt };
}

// ── Sync ─────────────────────────────────────────────────────────────────────────────────────────

async function sync(user: string, body: { decks?: unknown[]; showcase?: unknown }) {
  // What the account has.
  const stored = new Map<string, SyncDeck>();
  for (const row of await decksTable.list<{ partitionKey: string; rowKey: string; updatedAt: number; deleted?: boolean; data?: string }>(user)) {
    stored.set(row.rowKey, row.deleted ? { id: row.rowKey, updatedAt: row.updatedAt, deleted: true }
      : { id: row.rowKey, updatedAt: row.updatedAt, deck: JSON.parse(row.data ?? '{}') });
  }
  // What the game sent: the newer version of each deck wins, and is written back.
  for (const incoming of (body.decks ?? []).slice(0, MAX_DECKS).map(cleanDeck)) {
    if (!incoming) continue;
    const have = stored.get(incoming.id);
    if (have && have.updatedAt >= incoming.updatedAt) continue;
    if (!incoming.deleted && [...stored.values()].filter((d) => !d.deleted).length >= MAX_DECKS && !have) continue;
    stored.set(incoming.id, incoming);
    await decksTable.put({
      partitionKey: user, rowKey: incoming.id, updatedAt: incoming.updatedAt, deleted: !!incoming.deleted,
      data: incoming.deleted ? '' : JSON.stringify(incoming.deck),
    });
  }

  let showcase: SyncShowcase | null = null;
  const row = await showcaseTable.get<{ partitionKey: string; rowKey: string; faces: string; updatedAt: number }>(user, 'main');
  if (row) showcase = { faces: JSON.parse(row.faces), updatedAt: row.updatedAt };
  const sent = cleanShowcase(body.showcase);
  if (sent && (!showcase || sent.updatedAt > showcase.updatedAt)) {
    showcase = sent;
    await showcaseTable.put({ partitionKey: user, rowKey: 'main', faces: JSON.stringify(sent.faces), updatedAt: sent.updatedAt });
  }
  return { decks: [...stored.values()], showcase };
}

/** Everything stored for an account. */
async function exportAccount(user: string) {
  const { decks, showcase } = await sync(user, {});
  return { decks: decks.filter((d) => !d.deleted), showcase, orders: await exportOrders(user) };
}

/** Erase everything stored for an account. */
async function erase(user: string) {
  await eraseOrders(user);
  for (const row of await decksTable.list(user)) await decksTable.remove(user, row.rowKey);
  await showcaseTable.remove(user, 'main');
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  // Run locally, any page on this computer or the home network may call it (the game's dev server picks its own port).
  if (origin && (ORIGINS.has(origin) || (LOCAL_DATA && /^http:\/\/(localhost|127\.0\.0\.1|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}):\d+$/.test(origin)))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    if (req.url === '/healthz') return send(res, 200, 'ok');
    if (req.url?.startsWith('/v1/studio/')) return await serveStudio(req, res);
    if (req.url === '/v1/sync' && req.method === 'POST') {
      const user = await accountOf(req);
      if (!user) return send(res, 401, { error: 'signed_out' });
      const body = await readJson(req) as { decks?: unknown[]; showcase?: unknown };
      const merged = await sync(user, body);
      log('ops', 'decks.synced', { userId: user, decks: merged.decks.length });
      return send(res, 200, merged);
    }
    if (req.url === '/v1/export' && req.method === 'GET') {
      const user = await accountOf(req);
      if (!user) return send(res, 401, { error: 'signed_out' });
      log('security', 'account.exported', { userId: user });
      return send(res, 200, await exportAccount(user));
    }
    if (req.url === '/v1/store' || req.url?.startsWith('/v1/store/')) {
      const user = await accountOf(req);
      if (!user) return send(res, 401, { error: 'signed_out' });
      const [status, body] = await storeRequest(user, req.method ?? 'GET', req.url, () => readJson(req));
      return send(res, status, body);
    }
    const deleting = /^\/v1\/accounts\/([0-9a-f]{32})$/.exec(req.url ?? '');
    if (deleting && req.method === 'DELETE') {
      if (!await serviceCall(req, deleting[1], 'delete-account')) return send(res, 401, { error: 'not_allowed' });
      await erase(deleting[1]);
      log('security', 'account.data_deleted', { userId: deleting[1] });
      return send(res, 200, { deleted: true });
    }
    send(res, 404, { error: 'not_found' });
  } catch (e) {
    log('ops', 'error', { url: req.url, message: (e as Error).message }, 'error');
    send(res, 500, { error: 'server' });
  }
});

// Listen first: App Service gives up on a container that doesn't answer soon after starting. The tables are made in
// the background (tables.ts), so a fresh storage account needs no setup.
const port = Number(process.env.PORT) || 8080;
server.listen(port, () => console.log(`fruitcats-api listening on ${port}${LOCAL_DATA ? ` (local data in ${LOCAL_DATA})` : ''}`));

// Every 15 minutes, the totals for the owner's dashboard (the Accounts tab of the playtest dashboard):
// logs/stats/fruitcats-api.json, read by `node tools/ops.mjs snapshot`. Counts only, no ids or deck contents.
async function writeStats() {
  try {
    let decks = 0, deleted = 0, showcases = 0;
    const accounts = new Set<string>();
    for await (const row of new TableClient(TABLES, 'decks', credential).listEntities<{ deleted?: boolean }>({ queryOptions: { select: ['PartitionKey', 'deleted'] } })) {
      if (row.deleted) { deleted++; continue; }
      decks++;
      accounts.add(row.partitionKey!);
    }
    for await (const _ of new TableClient(TABLES, 'showcase', credential).listEntities({ queryOptions: { select: ['PartitionKey'] } })) showcases++;
    const stats = { service: 'fruitcats-api', time: new Date().toISOString(), decks, deletedDecks: deleted, accountsWithDecks: accounts.size, showcases };
    const body = JSON.stringify(stats);
    await statsBlob.upload(body, Buffer.byteLength(body), { blobHTTPHeaders: { blobContentType: 'application/json' } });
  } catch (e) {
    log('ops', 'stats.write_failed', { message: (e as Error).message }, 'warning');
  }
}
const statsBlob = new BlobServiceClient(process.env.BLOB_ENDPOINT ?? 'https://fruitcatsdata.blob.core.windows.net', credential)
  .getContainerClient('logs').getBlockBlobClient('stats/fruitcats-api.json');
// Not for the API run locally (LOCAL_DATA): its rows aren't in Azure.
if (!LOCAL_DATA) setTimeout(() => { void writeStats(); setInterval(() => void writeStats(), 15 * 60_000); }, 3 * 60_000);
