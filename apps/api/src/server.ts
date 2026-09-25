// The Fruitcats API (docs/accounts-plan.md): keeps each Via Mochi account's custom decks and Showcase, so they're the
// same on every device. It only trusts Via Mochi tokens from viamochi-id (checked against its public keys), and each
// account's data is keyed by the account id in those tokens. Hosted on App Service ("fruitcats-api").
//
//   GET  /healthz
//   POST /v1/sync   { decks: SyncDeck[], showcase?: SyncShowcase }  →  the merged state, the same shape
//   GET  /v1/export                  →  everything stored for the signed-in account ("Export my data")
//   DELETE /v1/accounts/{id}         →  erase an account's data; only viamochi-id may call it (a service token)
//   /v1/studio/...                   →  the Artist Studio (studio/studio.ts, docs/artist-studio-plan.md)
//
// One call does everything: the game sends what it has, the newest version of each item wins, and the merged state
// comes back for the game to keep. Decks are small, so sending them all is simpler and safer than tracking changes.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { TableClient, TableServiceClient } from '@azure/data-tables';
import { DefaultAzureCredential } from '@azure/identity';
import { CARDS, registerSet } from '@fruitcats/engine';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { loadContent } from '../../../content';
import { log } from './logs';
import { azureStore } from './studio/store';
import { studio } from './studio/studio';

// The engine has no cards of its own: without the sets, every synced deck failed validation and was dropped. Every set,
// prototypes too, so a deck holding cards from a set that isn't released yet is kept as well.
loadContent(registerSet, { prototypes: true });

const ID_SERVICE = process.env.VIAMOCHI_ID ?? 'https://viamochi-id.azurewebsites.net';
const TABLES = process.env.TABLE_ENDPOINT ?? 'https://fruitcatsdata.table.core.windows.net';
const BLOBS = process.env.BLOB_ENDPOINT ?? 'https://fruitcatsdata.blob.core.windows.net';
const ORIGINS = new Set((process.env.ALLOWED_ORIGINS ??
  'https://fruitcats.viamochi.com,https://polite-sea-0773d4b1e.3.azurestaticapps.net,https://playtest.fruitcats.viamochi.com,http://localhost:5173').split(','));
const MAX_DECKS = 200;
const MAX_BODY = 512 * 1024;

const jwks = createRemoteJWKSet(new URL(`${ID_SERVICE}/.well-known/jwks.json`));
const credential = new DefaultAzureCredential();
const decksTable = new TableClient(TABLES, 'decks', credential);
const showcaseTable = new TableClient(TABLES, 'showcase', credential);

/** A deck as the game stores it, with when it last changed. A deleted deck stays as a marker, so it doesn't come back. */
interface SyncDeck { id: string; updatedAt: number; deleted?: boolean; deck?: { name: string; hero: string; cards: Record<string, number> } }
interface SyncShowcase { faces: string[]; updatedAt: number }

async function accountOf(req: IncomingMessage): Promise<string | null> {
  const auth = req.headers.authorization ?? '';
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
  for await (const row of decksTable.listEntities<{ rowKey: string; updatedAt: number; deleted?: boolean; data?: string }>(
    { queryOptions: { filter: `PartitionKey eq '${user}'` } })) {
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
    await decksTable.upsertEntity({
      partitionKey: user, rowKey: incoming.id, updatedAt: incoming.updatedAt, deleted: !!incoming.deleted,
      data: incoming.deleted ? '' : JSON.stringify(incoming.deck),
    }, 'Replace');
  }

  let showcase: SyncShowcase | null = null;
  try {
    const row = await showcaseTable.getEntity<{ faces: string; updatedAt: number }>(user, 'main');
    showcase = { faces: JSON.parse(row.faces), updatedAt: row.updatedAt };
  } catch { /* none yet */ }
  const sent = cleanShowcase(body.showcase);
  if (sent && (!showcase || sent.updatedAt > showcase.updatedAt)) {
    showcase = sent;
    await showcaseTable.upsertEntity({ partitionKey: user, rowKey: 'main', faces: JSON.stringify(sent.faces), updatedAt: sent.updatedAt }, 'Replace');
  }
  return { decks: [...stored.values()], showcase };
}

/** Everything stored for an account. */
async function exportAccount(user: string) {
  const { decks, showcase } = await sync(user, {});
  return { decks: decks.filter((d) => !d.deleted), showcase };
}

/** Erase everything stored for an account. */
async function erase(user: string) {
  for await (const row of decksTable.listEntities({ queryOptions: { filter: `PartitionKey eq '${user}'` } }))
    await decksTable.deleteEntity(user, row.rowKey!);
  await showcaseTable.deleteEntity(user, 'main').catch(() => {});
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
  if (origin && ORIGINS.has(origin)) {
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
// the background, so a fresh storage account needs no setup.
server.listen(Number(process.env.PORT) || 8080, () => console.log('fruitcats-api listening'));
void Promise.all(['decks', 'showcase'].map((t) => new TableServiceClient(TABLES, credential).createTable(t).catch(() => {})));
