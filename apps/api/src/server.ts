// The Fruitcats API (docs/accounts.md): keeps each Via Mochi account's custom decks and Showcase, so they're the
// same on every device. It only trusts Via Mochi tokens from viamochi-id (checked against its public keys), and each
// account's data is keyed by the account id in those tokens. Hosted on App Service ("fruitcats-api").
//
//   GET  /healthz
//   GET  /version                    →  the commit this build is from (deploy.ps1 checks it before replacing it)
//   POST /v1/sync   { decks: SyncDeck[], showcase?: SyncShowcase }  →  the merged state, the same shape
//   GET  /v1/export                  →  everything stored for the signed-in account ("Export my data")
//   DELETE /v1/accounts/{id}         →  erase an account's data; only viamochi-id may call it (a service token)
//   /v1/store…                       →  the Store (store.ts)
//   POST /v1/webhooks/paddle         →  Paddle's signed payment events (store.ts, paddle.ts)
//   /v1/studio/...                   →  the Artist Studio (studio/studio.ts, docs/artist-studio-plan.md)
//   /v1/playtests...                 →  the playtest dashboard: the owner's page and PC2024's playtester (playtests/, docs/playtests.md)
//   /v1/live  (WebSocket)            →  online play: presence, friend codes, challenges, matches (live/, docs/pvp-plan.md)
//   POST /v1/live/here               →  "I'm here": challenges waiting, a game going (the game isn't playing online)
//   POST /v1/live/enter              →  "let me in": in, a place in the waiting line, or closed
//
// Online play's settings: LIVE=off turns it off (docs/emergency-stop.md); LIVE_MAX_PLAYERS is how many may be connected
// at once (default 300: App Service's Basic plan allows 350 WebSockets per instance).
//
// One call does everything: the game sends what it has, the newest version of each item wins, and the merged state
// comes back for the game to keep. Decks are small, so sending them all is simpler and safer than tracking changes.

import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TableClient } from '@azure/data-tables';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { CARDS, DECKS, deckProblems, registerSet, type DeckList } from '@fruitcats/engine';
import { ENTER_PATH, HERE_PATH } from '@fruitcats/match';
import { collectionOf, isStarterSet } from '@fruitcats/store';
import { createLocalJWKSet, createRemoteJWKSet, jwksCache, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { loadContent } from '../../../content';
import { log } from './logs';
import { createHub } from './live/hub';
import { tableStore } from './live/records';
import { attachLive } from './live/socket';
import { eraseOrders, exportOrders, paddleWebhook, purchasedCards, reconcile, storeRequest } from './store';
import { azureStore } from './studio/store';
import { azureDocs, folderDocs } from './playtests/docs';
import { startOpsSnapshots } from './playtests/ops';
import { playtests, type Caller } from './playtests/playtests';
import { studio } from './studio/studio';
import { LOCAL_DATA, table, writeIf } from './tables';

/** Written next to server.mjs by deploy.ps1. */
const COMMIT = (() => { try { return readFileSync(new URL('./commit.txt', import.meta.url), 'utf8').trim(); } catch { return 'unknown'; } })();

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

// viamochi-id's public keys. They're fetched again every 10 minutes (so a key it withdraws stops working soon), but a
// restart or outage of viamochi-id must not sign anyone out: when the keys can't be fetched, the last ones it gave us
// still check tokens, for up to a week. They're kept on disk too ($HOME persists on App Service), so a restart of this
// API while viamochi-id is down doesn't lose them.
const KEYS_FILE = join(process.env.HOME ?? tmpdir(), 'viamochi-id-keys.json');
const KEYS_KEPT_FOR = 7 * 86_400_000;
const lastKeys: { jwks?: JSONWebKeySet; uat?: number } = (() => {
  try { return JSON.parse(readFileSync(KEYS_FILE, 'utf8')); } catch { return {}; }
})();
let keysSavedAt = lastKeys.uat;
const jwks = createRemoteJWKSet(new URL(`${ID_SERVICE}/.well-known/jwks.json`), { [jwksCache]: lastKeys } as never);

/** Thrown when a token can't be checked right now (viamochi-id's keys can't be had): the game should try again, not sign out. */
class CantCheckTokens extends Error { readonly statusCode = 503; }   // 503: "try again" wherever it lands (the Studio too)
/** jose's answers that mean the token itself is no good. Anything else (a timeout, a failed fetch) means "can't tell now". */
const BAD_TOKEN = new Set(['ERR_JWT_EXPIRED', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED', 'ERR_JWT_INVALID',
  'ERR_JWS_INVALID', 'ERR_JOSE_NOT_SUPPORTED', 'ERR_JOSE_ALG_NOT_ALLOWED', 'ERR_JWK_INVALID', 'ERR_JWKS_NO_MATCHING_KEY', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS']);
const badToken = (e: unknown) => BAD_TOKEN.has((e as { code?: string }).code ?? '');

/** A viamochi-id token's claims, or null if it isn't a valid token for `audience`. Throws CantCheckTokens if it can't tell now. */
async function verifyToken(token: string, audience: string): Promise<JWTPayload | null> {
  const expect = { issuer: ID_SERVICE, audience };
  try {
    const { payload } = await jwtVerify(token, jwks, expect);
    if (lastKeys.uat !== keysSavedAt) {
      keysSavedAt = lastKeys.uat;
      try { writeFileSync(KEYS_FILE, JSON.stringify(lastKeys)); } catch { /* kept in memory still */ }
    }
    return payload;
  } catch (e) {
    if (badToken(e)) return null;
    // viamochi-id didn't answer for its keys: check the token with the last ones it gave.
    if (lastKeys.jwks && Date.now() - (lastKeys.uat ?? 0) < KEYS_KEPT_FOR) {
      try {
        return (await jwtVerify(token, createLocalJWKSet(lastKeys.jwks), expect)).payload;
      } catch (e2) {
        // A key we don't have may be a new one viamochi-id made while we couldn't ask it.
        if (badToken(e2) && (e2 as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') return null;
      }
    }
    log('ops', 'auth.keys_unavailable', { message: (e as Error).message }, 'warning');
    throw new CantCheckTokens('viamochi-id keys unavailable');
  }
}
const decksTable = table('decks');
const showcaseTable = table('showcase');
const live = tableStore(table('matches'), table('rivals'), table('seen'));

/** A deck as the game stores it, with when it last changed. A deleted deck stays as a marker, so it doesn't come back. */
interface SyncDeck {
  id: string; updatedAt: number; deleted?: boolean;
  /** `from`: the deck it was copied from (name, key and cards then), so the game can show what changed. */
  deck?: { name: string; hero: string; cards: Record<string, number>; from?: { name: string; key: string; cards: Record<string, number> } };
}
interface SyncShowcase { faces: string[]; updatedAt: number }

/** Local only (npm run api:local -- --fake-sign-in): "Bearer dev-<account id>" is that account, no email code needed. */
const FAKE_SIGN_IN = !!LOCAL_DATA && process.env.FAKE_SIGN_IN === 'on';

/**
 * Tokens already checked, until they expire: every open game says "I'm here" every 20 seconds, and checking a token's
 * signature each time would be most of what that costs.
 */
const checked = new Map<string, { sub: string; name: string; exp: number }>();

/** The signed-in account and the display name in its token. */
async function whoOf(req: IncomingMessage): Promise<{ id: string; name: string } | null> {
  const auth = req.headers.authorization ?? '';
  if (FAKE_SIGN_IN && /^Bearer dev-[0-9a-f]{32}$/.test(auth)) {
    const id = auth.slice('Bearer dev-'.length);
    fakeAccounts.add(id);
    return { id, name: '' };
  }
  if (!auth.startsWith('Bearer ')) return null;
  const known = checked.get(auth);
  if (known && known.exp > Date.now()) return { id: known.sub, name: known.name };
  // Can't check it right now: CantCheckTokens goes up to the request, which answers 503 ("try again"), not 401.
  const payload = await verifyToken(auth.slice(7), 'viamochi');
  if (!payload || typeof payload.sub !== 'string' || !/^[0-9a-f]{32}$/.test(payload.sub)) return null;
  const name = typeof payload.name === 'string' ? payload.name.slice(0, 40) : '';
  if (checked.size > 50_000) checked.clear();
  checked.set(auth, { sub: payload.sub, name, exp: (payload.exp ?? 0) * 1000 });
  return { id: payload.sub, name };
}

async function accountOf(req: IncomingMessage): Promise<string | null> {
  return (await whoOf(req))?.id ?? null;
}

/** The signed-in account and its display name, for the Artist Studio. */
async function userOf(req: IncomingMessage): Promise<{ id: string; name: string } | null> {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const payload = await verifyToken(auth.slice(7), 'viamochi');
  if (!payload || typeof payload.sub !== 'string' || !/^[0-9a-f]{32}$/.test(payload.sub)) return null;
  return { id: payload.sub, name: typeof payload.name === 'string' && payload.name ? payload.name.slice(0, 40) : 'Artist' };
}

// The Artist Studio. Owners are Via Mochi account ids; agents are "Name:sha256-of-key" pairs (tools/studio.ts).
const serveStudio = studio({
  store: azureStore(TABLES, BLOBS, credential),
  account: userOf,
  // viamochi-id checks that the caller is a reviewer too (ViaMochi:Reviewers), and returns only the one account.
  async findByEmail(req, email) {
    // Never waits long for viamochi-id; its failing is a status the Studio turns into "try again" (a 5xx).
    const res = await fetch(`${ID_SERVICE}/accounts/by-email?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: req.headers.authorization ?? '' }, signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw Object.assign(new Error(`account lookup: ${res.status}`), { statusCode: res.status });
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

// The playtest dashboard (playtests/, docs/playtests.md). The owner signs in with a Via Mochi account; PC2024's
// playtester sends "Bearer runner-<key>", checked against PLAYTEST_RUNNERS ("PC2024:<sha256 of the key>", comma-separated).
// The hashes aren't secret, so the runners known today are written here; the setting replaces them. PC2024's is in its
// /health; "laptop" (~/.fruitcats-playtests/runner.key) brought over the runs the old dashboard had.
const KNOWN_RUNNERS = 'PC2024:9669627a20837bb85f124a6d528227dfda3e83ac980d2457ae4a8a4dce004ab2,laptop:b5b7f687de7b022850598615791300b446c7c451cfc2590c057da0ecd8453403';
const PLAYTEST_OWNERS = (process.env.PLAYTEST_OWNERS ?? process.env.STUDIO_OWNERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const PLAYTEST_RUNNERS = (process.env.PLAYTEST_RUNNERS ?? (LOCAL_DATA ? '' : KNOWN_RUNNERS)).split(',').filter(Boolean).map((pair) => {
  const [name, hash] = pair.split(':');
  return { name: name.trim(), hash: (hash ?? '').trim().toLowerCase() };
});
const playtestDocs = LOCAL_DATA ? folderDocs(`${LOCAL_DATA}/playtests`) : azureDocs(BLOBS, credential);
const dashboard = playtests({
  docs: playtestDocs,
  // Until PC2024's first library night: the copy published next to the card packs (public).
  libraryFallback: async () => (await fetch('https://fruitcatspacks.blob.core.windows.net/packs/playtest/decks.json', { signal: AbortSignal.timeout(8000) })).json(),
  keys: (): Record<string, string> => (process.env.FIREWORKS_API_KEY ? { FIREWORKS_API_KEY: process.env.FIREWORKS_API_KEY } : {}),
  log: (event, fields) => log('ops', event, fields),
});

/** The playtest dashboard's caller: a runner with its key, the owner, or 'stranger' for anyone else signed in. */
async function playtestCaller(req: IncomingMessage): Promise<Caller | 'stranger'> {
  const auth = req.headers.authorization ?? '';
  if (auth.startsWith('Bearer runner-')) {
    const hash = createHash('sha256').update(auth.slice('Bearer runner-'.length).trim()).digest();
    const runner = PLAYTEST_RUNNERS.find((r) => r.hash.length === 64 && timingSafeEqual(Buffer.from(r.hash, 'hex'), hash));
    return runner ? { kind: 'runner', name: runner.name } : null;
  }
  const who = await whoOf(req);
  if (!who) return null;
  return PLAYTEST_OWNERS.includes(who.id) || (!!LOCAL_DATA && PLAYTEST_OWNERS.includes('*')) ? { kind: 'owner' } : 'stranger';
}

/** A service token from viamochi-id about one account and one purpose (e.g. deleting it). */
async function serviceCall(req: IncomingMessage, userId: string, purpose: string): Promise<boolean> {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const payload = await verifyToken(auth.slice(7), 'fruitcats-api');
  return !!payload && payload.sub === userId && payload.purpose === purpose;
}

// ── Keeping the data honest ───────────────────────────────────────────────────────────────────────

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]{1,24}$/i.test(id);
const validTime = (t: unknown): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0 && t < Date.now() + 86_400_000;

const cleanCards = (cards: Record<string, unknown>) => Object.fromEntries(Object.entries(cards)
  .filter(([id, n]) => CARDS[id] && Number.isInteger(n) && (n as number) > 0 && (n as number) <= 9)) as Record<string, number>;

function cleanDeck(d: unknown): SyncDeck | null {
  const x = d as SyncDeck;
  if (!x || !validId(x.id) || !validTime(x.updatedAt)) return null;
  if (x.deleted) return { id: x.id, updatedAt: x.updatedAt, deleted: true };
  const deck = x.deck;
  if (!deck || typeof deck.name !== 'string' || !CARDS[deck.hero] || typeof deck.cards !== 'object') return null;
  const cards = cleanCards(deck.cards);
  const f = deck.from;
  const from = f && typeof f.name === 'string' && typeof f.key === 'string' && f.key.length <= 64 && f.cards && typeof f.cards === 'object'
    ? { name: f.name.slice(0, 40), key: f.key, cards: cleanCards(f.cards) } : undefined;
  return { id: x.id, updatedAt: x.updatedAt, deck: { name: deck.name.slice(0, 40), hero: deck.hero, cards, ...(from ? { from } : {}) } };
}

function cleanShowcase(s: unknown): SyncShowcase | null {
  const x = s as SyncShowcase;
  if (!x || !Array.isArray(x.faces) || !validTime(x.updatedAt)) return null;
  return { faces: x.faces.filter((f) => typeof f === 'string' && f.length < 40).slice(0, 60), updatedAt: x.updatedAt };
}

// ── Sync ─────────────────────────────────────────────────────────────────────────────────────────

async function sync(user: string, body: { decks?: unknown[]; showcase?: unknown }) {
  type DeckRow = { partitionKey: string; rowKey: string; updatedAt: number; deleted?: boolean; data?: string; etag?: string };
  const deckOf = (row: DeckRow): SyncDeck => row.deleted ? { id: row.rowKey, updatedAt: row.updatedAt, deleted: true }
    : { id: row.rowKey, updatedAt: row.updatedAt, deck: JSON.parse(row.data ?? '{}') };
  // What the account has.
  const rows = new Map((await decksTable.list<DeckRow>(user)).map((row) => [row.rowKey, row]));
  const stored = new Map([...rows.values()].map((row) => [row.rowKey, deckOf(row)]));
  // What the game sent: the newer version of each deck wins, and is written back. Each write only happens if the
  // stored deck is still older (writeIf): another device syncing at the same moment can't have its newer deck undone.
  for (const incoming of (body.decks ?? []).slice(0, MAX_DECKS).map(cleanDeck)) {
    if (!incoming) continue;
    const have = stored.get(incoming.id);
    if (have && have.updatedAt >= incoming.updatedAt) continue;
    if (!incoming.deleted && [...stored.values()].filter((d) => !d.deleted).length >= MAX_DECKS && !have) continue;
    const now = await writeIf<DeckRow>(decksTable, {
      partitionKey: user, rowKey: incoming.id, updatedAt: incoming.updatedAt, deleted: !!incoming.deleted,
      data: incoming.deleted ? '' : JSON.stringify(incoming.deck),
    }, (s) => !s || s.updatedAt < incoming.updatedAt, rows.get(incoming.id) ?? null);
    if (now) stored.set(incoming.id, deckOf(now as DeckRow));
  }

  type ShowcaseRow = { partitionKey: string; rowKey: string; faces: string; updatedAt: number; etag?: string };
  const row = await showcaseTable.get<ShowcaseRow>(user, 'main');
  let showcase: SyncShowcase | null = row ? { faces: JSON.parse(row.faces), updatedAt: row.updatedAt } : null;
  const sent = cleanShowcase(body.showcase);
  if (sent && (!showcase || sent.updatedAt > showcase.updatedAt)) {
    const now = await writeIf<ShowcaseRow>(showcaseTable, { partitionKey: user, rowKey: 'main', faces: JSON.stringify(sent.faces), updatedAt: sent.updatedAt },
      (s) => !s || s.updatedAt < sent.updatedAt, row);
    if (now) showcase = { faces: JSON.parse(String(now.faces)), updatedAt: Number(now.updatedAt) };
  }
  return { decks: [...stored.values()], showcase };
}

/** Everything stored for an account. */
async function exportAccount(user: string) {
  const { decks, showcase } = await sync(user, {});
  return { decks: decks.filter((d) => !d.deleted), showcase, orders: await exportOrders(user), online: await live.exportFor(user) };
}

/** Erase everything stored for an account. */
async function erase(user: string) {
  await eraseOrders(user);
  await live.erase(user);
  for (const row of await decksTable.list(user)) await decksTable.remove(user, row.rowKey);
  await showcaseTable.remove(user, 'main');
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return JSON.parse((await readRaw(req)).toString('utf8') || '{}');
}

const server = createServer(async (req, res) => {
  // Every request's time, so slow steps show up as facts (the owner's dashboard). The path only, never the query.
  const started = performance.now();
  res.on('finish', () => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'OPTIONS' || path === '/healthz' || path === '/version') return;
    log('ops', 'http.request', { method: req.method, path: path.replace(/\/[0-9a-f]{32}(?=\/|$)/g, '/{id}'), status: res.statusCode, ms: Math.round(performance.now() - started) });
  });
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  try {
    if (req.url === '/healthz') return send(res, 200, 'ok');
    if (req.url === '/version') return send(res, 200, { commit: COMMIT });
    if (req.url?.startsWith('/v1/studio/')) return await serveStudio(req, res);
    // The deck library every playtest runner reads (playtest/decks/library.ts, LIBRARY_URL): public, decks aren't secret.
    if (req.url === '/v1/playtests/library' && req.method === 'GET') return send(res, 200, await dashboard.library());
    if (req.url === '/v1/playtests' || req.url?.startsWith('/v1/playtests/')) {
      const caller = await playtestCaller(req);
      if (caller === 'stranger') return send(res, 403, { error: 'not_owner' });
      const [status, body] = await dashboard.request(caller, req.method ?? 'GET', req.url, () => readJson(req));
      return send(res, status, body);
    }
    if (req.url === '/v1/webhooks/paddle' && req.method === 'POST') {
      // Signed by Paddle over the exact bytes, so the body is read raw. Answered 200 only once the event is saved.
      const sig = req.headers['paddle-signature'];
      const [status, body] = await paddleWebhook(Array.isArray(sig) ? sig[0] : sig, await readRaw(req));
      return send(res, status, body);
    }
    if ((req.url === HERE_PATH || req.url === ENTER_PATH) && req.method === 'POST') {
      const who = await whoOf(req);
      if (!who) return send(res, 401, { error: 'signed_out' });
      if (req.url === ENTER_PATH) return send(res, 200, await hub.enter(who.id));
      // The Pawtrait comes from the game (it's only a picture); the name from the token, or, faked locally, from the game.
      const body = await readJson(req).catch(() => ({})) as { avatar?: unknown; name?: unknown };
      const avatar = typeof body.avatar === 'string' && /^[a-z0-9-]{1,40}$/.test(body.avatar) ? body.avatar : 'cat';
      const name = (FAKE_SIGN_IN && typeof body.name === 'string' ? body.name.slice(0, 40) : who.name) || 'A friend';
      return send(res, 200, hub.here(who.id, { id: who.id, name, avatar }));
    }
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
    // A token that can't be checked right now is "try again", never "signed out".
    if (e instanceof CantCheckTokens) { res.setHeader('Retry-After', '5'); return send(res, 503, { error: 'try_again' }); }
    log('ops', 'error', { url: req.url, message: (e as Error).message }, 'error');
    send(res, 500, { error: 'server' });
  }
});

// ── Online play ──────────────────────────────────────────────────────────────────────────────────

/** Pages that may call the API. Run locally, any page on this computer or the home network (the game's dev server picks its own port). */
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  return ORIGINS.has(origin) || (!!LOCAL_DATA && /^http:\/\/(localhost|127\.0\.0\.1|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}):\d+$/.test(origin));
}

/** Fake sign-in (local only): everyone who has connected is everyone's friend, so two browsers can play each other. */
const fakeAccounts = new Set<string>();

const hub = createHub({
  store: live,
  async verify(token, name) {
    if (FAKE_SIGN_IN && /^dev-[0-9a-f]{32}$/.test(token)) {
      const id = token.slice('dev-'.length);
      fakeAccounts.add(id);
      return { id, name: name?.trim().slice(0, 40) || `Player ${id.slice(0, 4)}` };
    }
    try {
      const payload = await verifyToken(token, 'viamochi');
      if (!payload || typeof payload.sub !== 'string' || !/^[0-9a-f]{32}$/.test(payload.sub)) return null;
      return { id: payload.sub, name: typeof payload.name === 'string' ? payload.name : '' };
    } catch {
      return null;   // can't check it now: the game reconnects and tries again
    }
  },
  // viamochi-id knows who is friends with whom; we ask it with the player's own token.
  async friendsOf(account, token) {
    if (FAKE_SIGN_IN && token.startsWith('dev-')) return [...fakeAccounts].filter((a) => a !== account);
    // Not answering in time is a failure like any other: the hub keeps the friends it last had (live/hub.ts).
    const res = await fetch(`${ID_SERVICE}/friends`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`friends: ${res.status}`);
    const json = (await res.json()) as { friends?: { id?: unknown }[] };
    return (json.friends ?? []).map((f) => f.id).filter((id): id is string => typeof id === 'string');
  },
  // Each player plays their own deck: finished, legal, and every card owned by their own account.
  async checkDeck(account, deck, startersOnly) {
    if (startersOnly) {
      const same = (a: DeckList, b: DeckList) => a.hero === b.hero
        && Object.keys(a.cards).length === Object.keys(b.cards).length && Object.entries(a.cards).every(([id, n]) => b.cards[id] === n);
      const starter = Object.values(DECKS).some((d) => isStarterSet(CARDS[d.hero]?.set ?? '') && same(d, deck));
      return starter ? null : 'This game is for starter decks only.';
    }
    const owned = collectionOf(await purchasedCards(account));
    const problems = deckProblems(deck, owned);
    return problems.length ? `That deck can’t be played: ${problems[0]}` : null;
  },
  async paid(account) { return Object.keys(await purchasedCards(account)).length > 0; },
  maxPlayers: Number(process.env.LIVE_MAX_PLAYERS) || 300,
  open: () => process.env.LIVE !== 'off',
  log: (event, fields) => log('ops', event, fields),
});
attachLive(server, hub, originAllowed);
// Storage not answering at start-up (both restarting at once) mustn't lose the games that were going: try again until
// it answers, sooner at first. Nothing is picked up twice: a failure here means no game was read.
const restore = (tries = 0): void => void hub.restore().catch((e) => {
  log('ops', 'live.restore_failed', { message: (e as Error).message, tries }, tries < 3 ? 'warning' : 'error');
  setTimeout(() => restore(tries + 1), Math.min(60_000, 5_000 * 2 ** tries));
});
restore();

// Listen first: App Service gives up on a container that doesn't answer soon after starting. The tables are made in
// the background (tables.ts), so a fresh storage account needs no setup.
const port = Number(process.env.PORT) || 8080;
server.listen(port, () => console.log(`fruitcats-api listening on ${port}${LOCAL_DATA ? ` (local data in ${LOCAL_DATA})` : ''}`));

// Every 15 minutes, the totals for the owner's dashboard (the Accounts tab of the playtest dashboard):
// logs/stats/fruitcats-api.json, read by the Accounts tab's snapshot (playtests/ops.ts). Counts only, no ids or deck contents.
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

// The Accounts tab of the playtest dashboard: health, totals and 14 days of the services' logs, every 10 minutes.
if (!LOCAL_DATA) startOpsSnapshots({ credential, save: dashboard.saveOps, log: (event, fields, level) => log('ops', event, fields, level) });

// The Store's regular check against Paddle (store.ts, reconcile): every hour, and once a day also every account's owned
// total. Does nothing without Paddle keys.
let checks = 0;
const check = () => void reconcile({ deep: checks++ % 24 === 0 }).catch((e) => log('ops', 'store.alert', { what: 'the regular check failed', message: (e as Error).message }, 'error'));
setTimeout(() => { check(); setInterval(check, 60 * 60_000); }, 5 * 60_000);
