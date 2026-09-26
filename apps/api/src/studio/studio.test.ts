// The Artist Studio's API, end to end over HTTP, with its data in a temporary folder.

import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sniff } from './images';
import { folderStore, sha256 } from './store';
import { studio } from './studio';

let server: Server;
let base = '';
const dir = mkdtempSync(join(tmpdir(), 'studio-test-'));

beforeAll(async () => {
  const serve = studio({
    store: folderStore(dir),
    async account(req) {
      const m = /^Dev ([a-z0-9-]+):(.+)$/.exec(req.headers.authorization ?? '');
      return m ? { id: m[1], name: m[2] } : null;
    },
    owners: ['owner'],
    agents: [{ name: 'Claude', hash: sha256(Buffer.from('secret-key')) }],
    studioUrl: 'http://studio.test/studio.html',
    findByEmail: async (_req, email) => (email === 'wanda@example.com' ? { id: 'wanda', name: 'Wanda', email } : null),
  });
  server = createServer((req, res) => void serve(req, res));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}/v1/studio`;
});
afterAll(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const OWNER = 'Dev owner:Reviewer';
const ARTIST = 'Dev basil:Basil';
const STRANGER = 'Dev nobody:Nobody';
const AGENT = 'Studio-Agent secret-key';

async function call(auth: string | null, path: string, init: { method?: string; json?: unknown; body?: Buffer } = {}) {
  const res = await fetch(base + path, {
    method: init.method ?? (init.json || init.body ? 'POST' : 'GET'),
    headers: { ...(auth ? { Authorization: auth } : {}), ...(init.json ? { 'Content-Type': 'application/json' } : {}) },
    body: init.json ? JSON.stringify(init.json) : init.body && new Uint8Array(init.body),
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

/** A tiny but real PNG header of the given size: enough for the Studio to read its size. */
function png(width: number, height: number, salt = 0): Buffer {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  b[40] = salt;
  return b;
}

describe('images', () => {
  it('reads the size of PNG, WebP and JPEG files', () => {
    expect(sniff(png(1536, 1024))).toEqual({ format: 'png', width: 1536, height: 1024 });
    const vp8x = Buffer.alloc(40);
    vp8x.write('RIFF', 0, 'ascii'); vp8x.write('WEBP', 8, 'ascii'); vp8x.write('VP8X', 12, 'ascii');
    vp8x.writeUIntLE(1535, 24, 3); vp8x.writeUIntLE(1023, 27, 3);
    expect(sniff(vp8x)).toEqual({ format: 'webp', width: 1536, height: 1024 });
    const jpeg = Buffer.alloc(40);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08]);
    jpeg.writeUInt16BE(1024, 13); jpeg.writeUInt16BE(1536, 15);
    expect(sniff(jpeg)).toEqual({ format: 'jpeg', width: 1536, height: 1024 });
    expect(sniff(Buffer.from('this is not a picture, just some text'))).toBeNull();
  });
});

describe('studio', () => {
  it('asks who you are', async () => {
    expect((await call(null, '/me')).status).toBe(401);
    expect((await call(OWNER, '/me')).body).toMatchObject({ role: 'owner', sets: '*' });
    expect((await call(ARTIST, '/me')).body).toMatchObject({ role: 'artist', sets: [] });
    expect((await call(AGENT, '/me')).body).toMatchObject({ role: 'agent', name: 'Claude' });
    expect((await call('Studio-Agent wrong', '/me')).status).toBe(401);
  });

  it('lets an invited artist in, and no one else', async () => {
    expect((await call(ARTIST, '/bp1')).status).toBe(403);
    expect((await call(ARTIST, '/bp1/invites', { json: {} })).status).toBe(403);
    const invite = await call(OWNER, '/bp1/invites', { json: { note: 'Basil' } });
    expect(invite.status).toBe(201);
    expect(invite.body.url).toContain('studio.html?invite=');
    // A reviewer or an agent opening the link uses nothing up and becomes no one's artist.
    expect((await call(OWNER, `/invites/${invite.body.code}`, { json: {} })).body).toEqual({ set: 'bp1', reviewer: true });
    expect((await call(AGENT, `/invites/${invite.body.code}`, { json: {} })).status).toBe(403);
    expect((await call(OWNER, '/bp1/artists')).body.artists).toEqual([]);
    expect((await call(ARTIST, `/invites/${invite.body.code}`, { json: {} })).body).toEqual({ set: 'bp1' });
    expect((await call(STRANGER, `/invites/${invite.body.code}`, { json: {} })).status).toBe(409);
    expect((await call(ARTIST, '/me')).body.sets).toEqual(['bp1']);
    expect((await call(ARTIST, '/bp1')).body.role).toBe('artist');
    expect((await call(STRANGER, '/bp1')).status).toBe(403);
    expect((await call(OWNER, '/bp1/artists')).body.artists).toMatchObject([{ id: 'basil', name: 'Basil' }]);
  });

  it('asks an artist to accept the Studio’s terms before uploading', async () => {
    expect((await call(ARTIST, '/me')).body.terms).toBeNull();
    expect((await call(ARTIST, '/bp1/pictures/BP1-X01', { body: png(1536, 1024, 9) })).body).toEqual({ error: 'terms' });
    expect((await call(ARTIST, '/terms', { json: { version: 'studio-1' } })).status).toBe(422);
    expect((await call(ARTIST, '/terms', { json: { version: 'studio-1', adult: true } })).status).toBe(200);
    expect((await call(ARTIST, '/me')).body.terms).toBe('studio-1');
  });

  it('keeps every upload, checks it and serves it back', async () => {
    const first = await call(ARTIST, '/bp1/pictures/BP1-X01?kind=sketch&note=first%20idea', { body: png(1536, 1024, 1) });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ kind: 'sketch', format: 'png', width: 1536, height: 1024, byName: 'Basil', note: 'first idea' });
    const second = await call(ARTIST, '/bp1/pictures/BP1-X01', { body: png(1536, 1024, 2) });
    expect(second.body.kind).toBe('final');
    const view = await call(OWNER, '/bp1');
    expect(view.body.pictures['BP1-X01'].versions.map((v: { id: string }) => v.id)).toEqual([first.body.id, second.body.id]);
    expect(view.body.pictures['BP1-X01'].state).toBe('waiting');
    const got = await call(AGENT, `/bp1/pictures/BP1-X01/${first.body.id}`);
    expect(sha256(got.body as Buffer)).toBe(sha256(png(1536, 1024, 1)));
    expect((await call(ARTIST, '/bp1/pictures/BP1-X01', { body: Buffer.from('not a picture at all, sorry about that') })).status).toBe(415);
    expect((await call(AGENT, '/bp1/pictures/BP1-X01', { body: png(1536, 1024, 3) })).status).toBe(403);
    expect((await call(ARTIST, '/bp1/pictures/..%2Fescape', { body: png(1536, 1024, 4) })).status).toBe(404);
  });

  it('labels comments by who wrote them', async () => {
    const view = await call(ARTIST, '/bp1');
    const version = view.body.pictures['BP1-X01'].versions[0].id;
    const ai = await call(AGENT, '/bp1/pictures/BP1-X01/comments', { json: { text: 'The star is cut off on a phone.', version, pin: { x: 0.9, y: 0.2 } } });
    expect(ai.body).toMatchObject({ author: 'ai', authorName: 'Claude', pinX: 0.9, pinY: 0.2, version });
    const mine = await call(OWNER, '/bp1/pictures/BP1-X01/comments', { json: { text: 'Love the colours.' } });
    expect(mine.body).toMatchObject({ author: 'owner', authorName: 'Reviewer' });
    const reply = await call(ARTIST, '/bp1/pictures/BP1-X01/comments', { json: { text: 'Moving it left.', replyTo: ai.body.id } });
    expect(reply.body).toMatchObject({ author: 'artist', replyTo: ai.body.id });
    expect((await call(ARTIST, `/bp1/comments/${ai.body.id}`, { json: { done: true } })).body.done).toBe(true);
    expect((await call(ARTIST, '/bp1/pictures/BP1-X01/comments', { json: { text: '  ' } })).status).toBe(422);
    const changes = await call(AGENT, '/bp1/changes?since=2000-01-01');
    expect(changes.body.items.filter((i: { type: string }) => i.type === 'comment')).toHaveLength(3);
  });

  it('adds a comment sent twice with the same request id once, and a new one again', async () => {
    const say = (requestId: string) => call(ARTIST, '/bp1/pictures/BP1-X01/comments', { json: { text: 'Sent twice?', requestId } });
    const first = await say('0123456789abcdef');
    const again = await say('0123456789abcdef');
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    const other = await say('fedcba9876543210');
    expect(other.body.id).not.toBe(first.body.id);
    const view = await call(OWNER, '/bp1');
    expect(view.body.comments.filter((c: { text: string }) => c.text === 'Sent twice?')).toHaveLength(2);
  });

  it('keeps one version when the same picture is sent again as the newest', async () => {
    const first = await call(ARTIST, '/bp1/pictures/BP1-X02', { body: png(1536, 1024, 42) });
    const again = await call(ARTIST, '/bp1/pictures/BP1-X02', { body: png(1536, 1024, 42) });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect((await call(OWNER, '/bp1')).body.pictures['BP1-X02'].versions).toHaveLength(1);
  });

  it('lets only the owner review, open steps and decide suggestions', async () => {
    expect((await call(ARTIST, '/bp1/pictures/BP1-X01/review', { json: { state: 'approved' } })).status).toBe(403);
    expect((await call(AGENT, '/bp1/pictures/BP1-X01/review', { json: { state: 'approved' } })).status).toBe(403);
    expect((await call(OWNER, '/bp1/pictures/BP1-X01/review', { json: { state: 'approved' } })).body.state).toBe('approved');
    expect((await call(OWNER, '/bp1')).body.pictures['BP1-X01'].state).toBe('approved');
    expect((await call(ARTIST, '/bp1/milestones/3', { json: { open: true } })).status).toBe(403);
    expect((await call(OWNER, '/bp1/milestones/3', { json: { open: true } })).status).toBe(200);
    expect((await call(ARTIST, '/bp1')).body.milestones).toEqual({ 3: true });
    const s = await call(ARTIST, '/bp1/suggestions', { json: { picture: 'BP1-X01', field: 'name', value: 'Snap, the Gingerbread Cat', why: 'fits the pose' } });
    expect(s.body).toMatchObject({ state: 'open', value: 'Snap, the Gingerbread Cat' });
    expect((await call(ARTIST, `/bp1/suggestions/${s.body.id}`, { json: { state: 'accepted' } })).status).toBe(403);
    expect((await call(OWNER, `/bp1/suggestions/${s.body.id}`, { json: { state: 'accepted', reply: 'Yes!' } })).body.state).toBe('accepted');
  });

  it('lets the reviewer give a set to a game account by its email', async () => {
    const WANDA = 'Dev wanda:Wanda';
    expect((await call(WANDA, '/me')).body.sets).toEqual([]);
    expect((await call(ARTIST, '/bp1/artists', { json: { email: 'wanda@example.com' } })).status).toBe(403);
    expect((await call(OWNER, '/bp1/artists', { json: { email: 'nobody@example.com' } })).body).toEqual({ error: 'no_account' });
    expect((await call(OWNER, '/bp1/artists', { json: { email: 'not an email' } })).status).toBe(422);
    expect((await call(OWNER, '/bp1/artists', { json: { email: 'wanda@example.com' } })).body).toMatchObject({ id: 'wanda', name: 'Wanda' });
    expect((await call(WANDA, '/me')).body.sets).toEqual(['bp1']);
    expect((await call(OWNER, '/bp1/artists')).body.artists).toContainEqual(expect.objectContaining({ id: 'wanda', email: 'wanda@example.com' }));
  });

  it('keeps the frame colour an artist chose', async () => {
    const view = await call(OWNER, '/bp1/pictures/BP1-X01/frame', { json: { palette: 'midnight' } });
    expect(view.body).toEqual({ palette: 'midnight' });
    expect((await call(OWNER, '/bp1')).body.pictures['BP1-X01'].frame).toBe('midnight');
    expect((await call(OWNER, '/bp1/pictures/BP1-X01/frame', { json: { palette: 'Not a name!' } })).status).toBe(422);
  });

  it('keeps an image an artist chose for the frame, without touching the card picture’s review', async () => {
    const before = (await call(OWNER, '/bp1')).body.pictures['BP1-X01'].state;
    const up = await call(ARTIST, '/bp1/pictures/BP1-X01-frame?kind=frame', { body: png(1200, 800, 7) });
    expect(up.status).toBe(201);
    expect(up.body.kind).toBe('frame');
    expect((await call(ARTIST, '/bp1/pictures/BP1-X01/frame', { json: { palette: `image:${up.body.id}` } })).status).toBe(200);
    const view = (await call(OWNER, '/bp1')).body;
    expect(view.pictures['BP1-X01'].frame).toBe(`image:${up.body.id}`);
    expect(view.pictures['BP1-X01'].state).toBe(before);
    expect(view.pictures['BP1-X01-frame'].state).toBe('none');
    // Only an image that was uploaded for this card's frame.
    expect((await call(ARTIST, '/bp1/pictures/BP1-X01/frame', { json: { palette: 'image:20260101T000000000Z-deadbeef' } })).status).toBe(422);
  });

  it('removes an artist without losing their pictures', async () => {
    expect((await call(OWNER, '/bp1/artists/basil', { method: 'DELETE' })).status).toBe(200);
    expect((await call(ARTIST, '/bp1')).status).toBe(403);
    expect((await call(OWNER, '/bp1')).body.pictures['BP1-X01'].versions).toHaveLength(2);
  });
});
