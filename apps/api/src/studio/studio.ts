// The Artist Studio's API (docs/artist-studio-plan.md): artists upload their pictures for a set, see them on cards,
// and talk about them with us in comments. Mounted by server.ts under /v1/studio/.
//
// Who may do what:
//   owner   (a reviewer: a Via Mochi account listed in STUDIO_OWNERS): everything, in every set; the only one who approves.
//   artist  (an account invited to a set): in that set, upload pictures, comment, suggest changes.
//   agent   (an AI, with an agent key): read everything and comment. Its comments are always labelled AI.
// The server decides the label on every comment from who signed in, so no one can post as someone else.
//
//   GET  /v1/studio/me                                   who you are, your role, your sets, and the Studio terms you accepted
//   POST /v1/studio/terms                                { version, adult: true }  accept the Studio's own terms (not the game's)
//   POST /v1/studio/invites/{code}                       accept an invite: join its set
//   GET  /v1/studio/{set}                                everything about the set's pictures: versions, states, comments, suggestions
//   GET  /v1/studio/{set}/changes?since={iso}            what happened since then, newest first
//   POST /v1/studio/{set}/pictures/{key}?kind=&note=     upload a new version (the body is the picture)
//   GET  /v1/studio/{set}/pictures/{key}/{version}       a stored version
//   POST /v1/studio/{set}/pictures/{key}/comments        { text, version?, pin?: {x, y}, replyTo? }
//   POST /v1/studio/{set}/comments/{id}                  { done }  mark a comment done (or not)
//   POST /v1/studio/{set}/pictures/{key}/review          owner: { state: changes | sketch-ok | approved | waiting }
//   POST /v1/studio/{set}/milestones/{id}                owner: { open } open a step early, or close it again
//   POST /v1/studio/{set}/suggestions                    { picture, field, value, why? }
//   POST /v1/studio/{set}/suggestions/{id}               owner: { state: accepted | declined, reply? }
//   GET  /v1/studio/{set}/artists                        owner: the set's artists and open invites
//   POST /v1/studio/{set}/artists                        owner: { email } give the set to the game account with this email
//   POST /v1/studio/{set}/invites                        owner: a new invite link
//   DELETE /v1/studio/{set}/artists/{id}                 owner: remove an artist (their pictures stay)
//
// Rows, all in one table (partition | row key):
//   artists|{set} | {userId}      invites | {code}      versions|{set} | {key}|{version}      states|{set} | {key}
//   comments|{set} | {id}         suggestions|{set} | {id}      milestones|{set} | {id}      memberships | {userId}|{set}      terms | {userId}
// Pictures are blobs named {set}/{key}/{version}.{ext}, where a version is its upload time and the start of its hash.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONTENT_TYPES, sniff } from './images';
import { sha256, type Row, type Store } from './store';

export type Role = 'owner' | 'artist' | 'agent';

/** Who's calling: a Via Mochi account, or an AI agent with a key. */
export type Caller = { kind: 'account'; id: string; name: string } | { kind: 'agent'; name: string };

export interface StudioOptions {
  store: Store;
  /** The Via Mochi account a request is signed in as (server.ts checks the token), or null. */
  account(req: IncomingMessage): Promise<{ id: string; name: string } | null>;
  /** The account with this email, asked of the account service as the signed-in reviewer; null if there's none. */
  findByEmail(req: IncomingMessage, email: string): Promise<{ id: string; name: string; email: string } | null>;
  /** Account ids that own the Studio. */
  owners: string[];
  /** Agent keys: a name and the SHA-256 of its key, e.g. { name: 'Claude', hash: '9f86…' }. */
  agents: { name: string; hash: string }[];
  log?(event: string, fields: Record<string, unknown>): void;
  /** Where invite links point: the Studio page. */
  studioUrl: string;
  /** Via Mochi's invite code for new accounts, added to the Studio's invite links so an artist types no code. */
  accountInvite?: string;
}

const MAX_PICTURE = 30 * 1024 * 1024;
const MAX_JSON = 64 * 1024;
const MAX_SIDE = 12000;
const INVITE_DAYS = 30;

export const validSet = (s: string) => /^[a-z0-9]{2,12}$/.test(s);
export const validKey = (k: string) => /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(k);
const validVersion = (v: string) => /^\d{8}T\d{9}Z-[0-9a-f]{8}$/.test(v);
const REVIEW_STATES = ['changes', 'sketch-ok', 'approved', 'waiting'] as const;

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

/** A stored row as the Studio hands it out: its row key becomes its id. */
function withId(r: Row & { rk: string }): Row & { id: string } {
  const { rk, ...rest } = r;
  return { ...(rest as Row), id: rk };
}

/** An id that sorts by time: 20260924T171900123Z plus a few random letters. */
const stamp = (d = new Date()) => d.toISOString().replace(/[-:.]/g, '');
const randomId = (n = 6) => randomBytes(n).toString('base64url').replace(/[-_]/g, 'x').slice(0, n);

export function studio(opt: StudioOptions) {
  const { store } = opt;
  const log = opt.log ?? (() => {});

  // ── Who's calling ──────────────────────────────────────────────────────────────────────────────

  async function caller(req: IncomingMessage): Promise<Caller | null> {
    const auth = req.headers.authorization ?? '';
    if (auth.startsWith('Studio-Agent ')) {
      const hash = Buffer.from(sha256(Buffer.from(auth.slice(13).trim())), 'hex');
      const agent = opt.agents.find((a) => a.hash.length === 64 && timingSafeEqual(Buffer.from(a.hash, 'hex'), hash));
      return agent ? { kind: 'agent', name: agent.name } : null;
    }
    const account = await opt.account(req);
    return account ? { kind: 'account', ...account } : null;
  }

  const isOwner = (c: Caller) => c.kind === 'account' && opt.owners.includes(c.id);

  async function roleIn(c: Caller, set: string): Promise<Role | null> {
    if (c.kind === 'agent') return 'agent';
    if (isOwner(c)) return 'owner';
    return (await store.get(`artists|${set}`, c.id)) ? 'artist' : null;
  }

  async function mySets(c: Caller): Promise<string[] | '*'> {
    if (c.kind === 'agent' || isOwner(c)) return '*';
    return (await store.list(`memberships`)).filter((r) => r.userId === c.id).map((r) => String(r.set));
  }

  // ── The set, as the Studio shows it ────────────────────────────────────────────────────────────

  async function setView(set: string) {
    const [versions, states, comments, suggestions, milestones] = await Promise.all(
      ['versions', 'states', 'comments', 'suggestions', 'milestones'].map((t) => store.list(`${t}|${set}`)));
    const pictures: Record<string, { state: string; stateAt?: string; stateBy?: string; versions: Row[] }> = {};
    const picture = (key: string) => (pictures[key] ??= { state: 'none', versions: [] });
    for (const v of versions) {
      const [key, version] = v.rk.split('|');
      const { rk: _, ...row } = v;
      picture(key).versions.push({ ...row, id: version });
    }
    for (const s of states) Object.assign(picture(s.rk), { state: s.state, stateAt: s.at, stateBy: s.byName });
    return {
      set,
      pictures,
      comments: comments.map(withId),
      suggestions: suggestions.map(withId),
      milestones: Object.fromEntries(milestones.map((m) => [m.rk, m.open === true])),
    };
  }

  // ── Uploads ────────────────────────────────────────────────────────────────────────────────────

  async function upload(c: Caller & { kind: 'account' }, set: string, key: string, bytes: Buffer, kind: string, note: string) {
    const picture = sniff(bytes);
    if (!picture) throw new HttpError(415, 'not_a_picture');
    if (picture.width > MAX_SIDE || picture.height > MAX_SIDE || picture.width < 16 || picture.height < 16)
      throw new HttpError(422, 'bad_size');
    const hash = sha256(bytes);
    const version = `${stamp()}-${hash.slice(0, 8)}`;
    const blob = `${set}/${key}/${version}.${picture.format}`;
    await store.putBlob(blob, bytes, CONTENT_TYPES[picture.format]);
    // Only counts once it's stored: read it back and check it's the same picture.
    const back = await store.getBlob(blob);
    if (!back || sha256(back.bytes) !== hash) {
      log('studio.upload_mismatch', { set, key, version });
      throw new HttpError(500, 'not_stored');
    }
    const row: Row = {
      blob, kind: kind === 'sketch' ? 'sketch' : 'final', format: picture.format, width: picture.width, height: picture.height,
      bytes: bytes.length, sha256: hash, by: c.id, byName: c.name, at: new Date().toISOString(), note: note.slice(0, 500),
    };
    await store.insert(`versions|${set}`, `${key}|${version}`, row);
    await store.upsert(`states|${set}`, key, { state: 'waiting', at: row.at as string, by: c.id, byName: c.name });
    log('studio.uploaded', { set, key, version, userId: c.id, bytes: bytes.length });
    return { ...row, id: version };
  }

  // ── Requests ───────────────────────────────────────────────────────────────────────────────────

  async function handle(req: IncomingMessage, res: ServerResponse, path: string, query: URLSearchParams): Promise<void> {
    const c = await caller(req);
    if (!c) throw new HttpError(401, 'signed_out');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);   // after /v1/studio/
    const method = req.method ?? 'GET';

    if (parts[0] === 'me' && parts.length === 1 && method === 'GET') {
      const role = c.kind === 'agent' ? 'agent' : isOwner(c) ? 'owner' : 'artist';
      const terms = c.kind === 'account' ? await store.get('terms', c.id) : null;
      return send(res, 200, { id: c.kind === 'account' ? c.id : null, name: c.name, role, sets: await mySets(c), terms: terms ? String(terms.version) : null });
    }

    // The Studio's own terms, accepted once per account and version: separate from the game's Terms of Use.
    if (parts[0] === 'terms' && parts.length === 1 && method === 'POST') {
      if (c.kind !== 'account') throw new HttpError(403, 'accounts_only');
      const { version, adult } = await readJson(req) as { version?: string; adult?: boolean };
      if (typeof version !== 'string' || !/^[\w.-]{1,40}$/.test(version)) throw new HttpError(422, 'bad_version');
      if (adult !== true) throw new HttpError(422, 'adults_only');
      await store.upsert('terms', c.id, { version, adult: true, at: new Date().toISOString() });
      log('studio.terms_accepted', { userId: c.id, version });
      return send(res, 200, { terms: version });
    }

    if (parts[0] === 'invites' && parts.length === 2 && method === 'POST') {
      if (c.kind !== 'account') throw new HttpError(403, 'accounts_only');
      const invite = await store.get('invites', parts[1]);
      if (!invite || Date.parse(String(invite.expires)) < Date.now()) throw new HttpError(404, 'invite_not_found');
      if (invite.usedBy && invite.usedBy !== c.id) throw new HttpError(409, 'invite_used');
      const set = String(invite.set);
      const at = new Date().toISOString();
      await store.upsert(`artists|${set}`, c.id, { name: c.name, joined: at, invite: parts[1] });
      await store.upsert('memberships', `${c.id}|${set}`, { userId: c.id, set });
      await store.upsert('invites', parts[1], { ...invite, usedBy: c.id, usedByName: c.name, usedAt: at });
      log('studio.joined', { set, userId: c.id });
      return send(res, 200, { set });
    }

    const set = parts[0];
    if (!set || !validSet(set)) throw new HttpError(404, 'not_found');
    const role = await roleIn(c, set);
    if (!role) throw new HttpError(403, 'not_invited');
    const owner = role === 'owner';
    const rest = parts.slice(1);
    const [a, b, cc] = rest;

    if (rest.length === 0 && method === 'GET') {
      const artist = c.kind === 'account' && !!(await store.get(`artists|${set}`, c.id));
      return send(res, 200, { role, artist, ...(await setView(set)) });
    }

    if (a === 'changes' && rest.length === 1 && method === 'GET') {
      const since = query.get('since') ?? '';
      const view = await setView(set);
      const items: Record<string, unknown>[] = [];
      for (const [key, p] of Object.entries(view.pictures)) {
        for (const v of p.versions) items.push({ type: 'upload', picture: key, at: v.at, by: v.byName, version: v.id, kind: v.kind });
        if (p.stateAt && p.state !== 'waiting') items.push({ type: 'review', picture: key, at: p.stateAt, by: p.stateBy, state: p.state });
      }
      for (const cm of view.comments) items.push({ type: 'comment', picture: cm.picture, at: cm.at, by: cm.authorName, author: cm.author, text: cm.text, id: cm.id });
      for (const s of view.suggestions) items.push({ type: 'suggestion', picture: s.picture, at: s.at, by: s.byName, field: s.field, value: s.value, state: s.state, id: s.id });
      const recent = items.filter((i) => String(i.at) > since).sort((x, y) => String(y.at).localeCompare(String(x.at)));
      return send(res, 200, { now: new Date().toISOString(), items: recent.slice(0, 500) });
    }

    if (a === 'pictures' && b && validKey(b)) {
      if (rest.length === 2 && method === 'POST') {
        if (c.kind !== 'account') throw new HttpError(403, 'agents_cannot_upload');
        if (!owner && !(await store.get('terms', c.id))) throw new HttpError(403, 'terms');
        const bytes = await readBody(req, MAX_PICTURE);
        return send(res, 201, await upload(c, set, b, bytes, query.get('kind') ?? 'final', query.get('note') ?? ''));
      }
      if (rest.length === 3 && method === 'GET' && validVersion(cc)) {
        const v = await store.get(`versions|${set}`, `${b}|${cc}`);
        const blob = v && await store.getBlob(String(v.blob));
        if (!blob) throw new HttpError(404, 'not_found');
        res.writeHead(200, { 'Content-Type': blob.contentType, 'Cache-Control': 'private, max-age=31536000, immutable' });
        res.end(blob.bytes);
        return;
      }
      if (cc === 'comments' && rest.length === 3 && method === 'POST') {
        const body = await readJson(req) as { text?: unknown; version?: unknown; pin?: { x?: unknown; y?: unknown }; replyTo?: unknown };
        const text = typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
        if (!text) throw new HttpError(422, 'empty');
        const at = new Date().toISOString();
        const id = `${stamp()}-${randomId()}`;
        const row: Row = {
          picture: b, text, at,
          author: c.kind === 'agent' ? 'ai' : owner ? 'owner' : 'artist',
          authorName: c.name,
          ...(c.kind === 'account' ? { authorId: c.id } : {}),
          done: false,
        };
        if (typeof body.version === 'string' && validVersion(body.version)) row.version = body.version;
        const x = Number(body.pin?.x), y = Number(body.pin?.y);
        if (body.pin && x >= 0 && x <= 1 && y >= 0 && y <= 1) { row.pinX = x; row.pinY = y; }
        if (typeof body.replyTo === 'string' && body.replyTo.length < 60) row.replyTo = body.replyTo;
        await store.insert(`comments|${set}`, id, row);
        log('studio.commented', { set, key: b, author: row.author });
        return send(res, 201, { ...row, id });
      }
      if (cc === 'review' && rest.length === 3 && method === 'POST') {
        if (!owner || c.kind !== 'account') throw new HttpError(403, 'owner_only');
        const { state } = await readJson(req) as { state?: string };
        if (!REVIEW_STATES.includes(state as typeof REVIEW_STATES[number])) throw new HttpError(422, 'bad_state');
        const row = { state: state!, at: new Date().toISOString(), by: c.id, byName: c.name };
        await store.upsert(`states|${set}`, b, row);
        log('studio.reviewed', { set, key: b, state });
        return send(res, 200, row);
      }
    }

    if (a === 'comments' && b && rest.length === 2 && method === 'POST') {
      if (c.kind === 'agent') throw new HttpError(403, 'people_only');
      const { done } = await readJson(req) as { done?: boolean };
      const row = await store.get(`comments|${set}`, b);
      if (!row) throw new HttpError(404, 'not_found');
      await store.upsert(`comments|${set}`, b, { ...row, done: !!done, doneBy: c.name });
      return send(res, 200, { ...row, done: !!done, doneBy: c.name, id: b });
    }

    if (a === 'milestones' && b && rest.length === 2 && method === 'POST') {
      if (!owner) throw new HttpError(403, 'owner_only');
      const { open } = await readJson(req) as { open?: boolean };
      await store.upsert(`milestones|${set}`, b, { open: !!open });
      return send(res, 200, { id: b, open: !!open });
    }

    if (a === 'suggestions' && rest.length === 1 && method === 'POST') {
      if (c.kind === 'agent') throw new HttpError(403, 'people_only');
      const body = await readJson(req) as { picture?: string; field?: string; value?: string; why?: string };
      if (!body.picture || !validKey(body.picture) || !body.field || !/^[a-z]{2,20}$/.test(body.field)) throw new HttpError(422, 'bad_suggestion');
      const value = String(body.value ?? '').trim().slice(0, 300);
      if (!value) throw new HttpError(422, 'empty');
      const at = new Date().toISOString();
      const id = `${stamp()}-${randomId()}`;
      const row: Row = { picture: body.picture, field: body.field, value, why: String(body.why ?? '').slice(0, 1000), state: 'open', at, by: c.id, byName: c.name };
      await store.insert(`suggestions|${set}`, id, row);
      return send(res, 201, { ...row, id });
    }

    if (a === 'suggestions' && b && rest.length === 2 && method === 'POST') {
      if (!owner || c.kind !== 'account') throw new HttpError(403, 'owner_only');
      const { state, reply } = await readJson(req) as { state?: string; reply?: string };
      if (state !== 'accepted' && state !== 'declined' && state !== 'open') throw new HttpError(422, 'bad_state');
      const row = await store.get(`suggestions|${set}`, b);
      if (!row) throw new HttpError(404, 'not_found');
      const next = { ...row, state, reply: String(reply ?? '').slice(0, 1000), decidedAt: new Date().toISOString(), decidedBy: c.name };
      await store.upsert(`suggestions|${set}`, b, next);
      return send(res, 200, { ...next, id: b });
    }

    if (a === 'artists' && rest.length === 1 && method === 'GET') {
      if (!owner) throw new HttpError(403, 'owner_only');
      const artists = (await store.list(`artists|${set}`)).map(withId);
      const invites = (await store.list('invites'))
        .filter((i) => i.set === set && !i.usedBy && Date.parse(String(i.expires)) > Date.now())
        .map((i) => ({ ...withId(i), code: i.rk, url: inviteUrl(i.rk) }));
      return send(res, 200, { artists, invites });
    }

    if (a === 'artists' && rest.length === 1 && method === 'POST') {
      if (!owner) throw new HttpError(403, 'owner_only');
      const { email } = await readJson(req) as { email?: string };
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new HttpError(422, 'bad_email');
      const who = await opt.findByEmail(req, email.trim());
      if (!who) throw new HttpError(404, 'no_account');
      await store.upsert(`artists|${set}`, who.id, { name: who.name, email: who.email, joined: new Date().toISOString() });
      await store.upsert('memberships', `${who.id}|${set}`, { userId: who.id, set });
      log('studio.artist_added', { set, userId: who.id });
      return send(res, 200, { id: who.id, name: who.name, email: who.email });
    }

    if (a === 'invites' && rest.length === 1 && method === 'POST') {
      if (!owner || c.kind !== 'account') throw new HttpError(403, 'owner_only');
      const { note } = await readJson(req) as { note?: string };
      const code = randomBytes(12).toString('base64url');
      const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
      await store.insert('invites', code, { set, by: c.id, at: new Date().toISOString(), expires, note: String(note ?? '').slice(0, 200) });
      log('studio.invited', { set });
      return send(res, 201, { code, set, expires, url: inviteUrl(code) });
    }

    if (a === 'artists' && b && rest.length === 2 && method === 'DELETE') {
      if (!owner) throw new HttpError(403, 'owner_only');
      await store.remove(`artists|${set}`, b);
      await store.remove('memberships', `${b}|${set}`);
      log('studio.artist_removed', { set, userId: b });
      return send(res, 200, { removed: b });
    }

    throw new HttpError(404, 'not_found');
  }

  const inviteUrl = (code: string) =>
    `${opt.studioUrl}?invite=${encodeURIComponent(code)}${opt.accountInvite ? `&account=${encodeURIComponent(opt.accountInvite)}` : ''}`;

  /** Handle a request under /v1/studio/. */
  return async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://studio');
    try {
      await handle(req, res, url.pathname.replace(/^\/v1\/studio\/?/, ''), url.searchParams);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code });
      if ((e as { statusCode?: number }).statusCode === 409 || (e as { code?: string }).code === 'EEXIST')
        return send(res, 409, { error: 'exists' });
      log('studio.error', { url: req.url, message: (e as Error).message });
      send(res, 500, { error: 'server' });
    }
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'too_large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  try { return JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}'); }
  catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'bad_json'); }
}
