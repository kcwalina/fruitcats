import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { artHash } from './art-hash';
import { artPaths, artPublished, dataPath, differsFrom, updateIndex, withEntry, type IndexStore, type PackEntry, type PackIndex } from './pack-storage';

// On 2026-09-27 several sessions published art from their own branches to one address per set: the storage flipped
// between them, and every deploy's build refused until it republished, 3–4 rounds running. Each version of a set's art
// now has its own folder, so they coexist, and the index running games read is written only from main, and never over
// another session's write.

const made: string[] = [];
const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); made.push(d); return d; };
afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });

function setFolder(files: Record<string, string>, root = temp('fruitcats-set-')): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A pack storage in memory: blob name → text. Its fetch answers like the public one. */
function storage(): { blobs: Map<string, string>; get: typeof fetch } {
  const blobs = new Map<string, string>();
  const get = (async (url: string | URL | Request) => {
    const name = String(url).replace('https://packs.test/', '');
    const text = blobs.get(name);
    return new Response(text ?? 'not found', { status: text === undefined ? 404 : 200 });
  }) as typeof fetch;
  return { blobs, get };
}

/** A set as tcg renders it (content/tcg.ts): its cards in Alex and their paintings, in a game folder. [set, game]. */
function tcgSet(paintings: Record<string, string>): [string, string] {
  const root = setFolder({
    'game/folkborn.alex': '#type Game\n', 'game/sets/x/x.alex': "#type Set\n\nname = 'X'\n", 'content/x/set.json': '{}',
    ...Object.fromEntries(Object.entries(paintings).map(([file, text]) => [`game/sets/x/art/${file}`, text])),
  });
  return [join(root, 'content', 'x'), join(root, 'game')];
}

/** What publish-pack puts on the storage for a set's art: every picture, then the marker. */
function publish(blobs: Map<string, string>, code: string, set: [string, string], paintings: Record<string, string>): void {
  const hash = artHash(...set)!;
  const p = artPaths(code, hash);
  for (const [file, text] of Object.entries(paintings)) blobs.set(`${p.art}${file}`, text);
  blobs.set(p.marker, JSON.stringify({ hash }));
}

describe('art at its fingerprint\'s address', () => {
  it('puts each version of a set\'s art in its own folder, and the same art always in the same one', () => {
    const a = artHash(...tcgSet({ 'DW1-D01.webp': 'one' }))!;
    const b = artHash(...tcgSet({ 'DW1-D01.webp': 'two' }))!;
    expect(artPaths('dw1', a)).toEqual(artPaths('dw1', artHash(...tcgSet({ 'DW1-D01.webp': 'one' }))!));
    expect(artPaths('dw1', a).dir).not.toBe(artPaths('dw1', b).dir);
    expect(artPaths('dw1', a)).toEqual({
      dir: `dw1/art/${a.slice(0, 16)}/`, art: `dw1/art/${a.slice(0, 16)}/illustrations/`,
      cards: `dw1/art/${a.slice(0, 16)}/cards/`, marker: `dw1/art/${a.slice(0, 16)}/art.json`,
    });
  });

  it('never takes the place of the old one-folder addresses, which games built before stay on', () => {
    const p = artPaths('dw1', 'f'.repeat(64));
    for (const old of ['dw1/art/illustrations/', 'dw1/art/cards/', 'dw1/art.json']) expect(Object.values(p)).not.toContain(old);
  });

  it('lets two branches publish different art for one set, and each build still finds its own', async () => {
    const { blobs, get } = storage();
    const mainFiles = { 'PA1-D01.webp': 'main' }, branchFiles = { 'PA1-D01.webp': 'redrawn' };
    const onMain = tcgSet(mainFiles), onBranch = tcgSet(branchFiles);
    publish(blobs, 'pa1', onMain, mainFiles);
    expect(await artPublished('https://packs.test/', 'pa1', artHash(...onBranch)!, get)).toBe(false);
    publish(blobs, 'pa1', onBranch, branchFiles);
    // The branch's publish didn't touch main's: both builds find their art, however often either publishes.
    expect(await artPublished('https://packs.test/', 'pa1', artHash(...onMain)!, get)).toBe(true);
    expect(await artPublished('https://packs.test/', 'pa1', artHash(...onBranch)!, get)).toBe(true);
    expect(blobs.get(`${artPaths('pa1', artHash(...onMain)!).art}PA1-D01.webp`)).toBe('main');
  });

  it('counts art as there only once its marker names this very fingerprint', async () => {
    const { blobs, get } = storage();
    const hash = 'a'.repeat(64);
    expect(await artPublished('https://packs.test/', 'x1', hash, get)).toBe(false);
    blobs.set(artPaths('x1', hash).marker, JSON.stringify({ hash: `${'a'.repeat(16)}${'b'.repeat(48)}` }));
    expect(await artPublished('https://packs.test/', 'x1', hash, get)).toBe(false);
    blobs.set(artPaths('x1', hash).marker, 'not json');
    expect(await artPublished('https://packs.test/', 'x1', hash, get)).toBe(false);
    blobs.set(artPaths('x1', hash).marker, JSON.stringify({ hash }));
    expect(await artPublished('https://packs.test/', 'x1', hash, get)).toBe(true);
  });

  it('gives each version of a set\'s data its own address too', () => {
    expect(dataPath('dw1', '{"a":1}')).toBe(dataPath('dw1', '{"a":1}'));
    expect(dataPath('dw1', '{"a":1}')).not.toBe(dataPath('dw1', '{"a":2}'));
    expect(dataPath('dw1', '{"a":1}')).toMatch(/^dw1\/data\/[0-9a-f]{16}\.json$/);
  });
});

const entry = (set: string, version = '1.0.0'): PackEntry =>
  ({ set, name: set, version, status: 'released', data: `${set}/data/x.json`, art: '', cards: '', published: '' });

/** index.json in memory, with ETags; `meddle` runs between a read and the write that follows it (another session). */
function indexFile(meddle?: (store: IndexStore) => Promise<void>): IndexStore & { current: () => PackIndex | null; writes: number } {
  let index: PackIndex | null = null, version = 0, writes = 0, busy = false;
  const store = {
    current: () => index,
    get writes() { return writes; },
    async read() { return index ? { index: structuredClone(index), etag: `v${version}` } : null; },
    async write(next: PackIndex, etag: string | null) {
      if (meddle && !busy) { busy = true; await meddle(store); busy = false; }
      if ((index ? `v${version}` : null) !== etag) return false;
      index = structuredClone(next); version++; writes++;
      return true;
    },
  };
  return store;
}

describe('the index running games read', () => {
  it('replaces only the published set\'s entry', () => {
    expect(withEntry({ packs: [entry('PR1'), entry('DW1')] }, entry('DW1', '1.1.0')).packs)
      .toEqual([entry('PR1'), entry('DW1', '1.1.0')]);
  });

  it('keeps an entry another session wrote while this one was publishing', async () => {
    let once = true;
    const store = indexFile(async (s) => {
      if (!once) return;
      once = false;
      await updateIndex(s, (i) => withEntry(i, entry('JR1')));
    });
    await updateIndex(store, (i) => withEntry(i, entry('PR1')));
    await updateIndex(store, (i) => withEntry(i, entry('AX1')));
    expect(store.current()!.packs.map((p) => p.set).sort()).toEqual(['AX1', 'JR1', 'PR1']);
  });

  it('gives up, saying so, when the index never holds still', async () => {
    const store = indexFile(async (s) => { await updateIndex(s, (i) => withEntry(i, entry(`Z${Math.random()}`))); });
    await expect(updateIndex(store, (i) => withEntry(i, entry('PR1')), 3)).rejects.toThrow(/kept changing/);
  });
});

// These make real git repositories and run git dozens of times: on Windows, while other sessions build and test on the
// same machine, that takes 5-8 s, and the default 5 s limit failed deploys with nothing wrong.
describe('only a set that is on origin/main goes into the index', { timeout: 30_000 }, () => {
  const git = (repo: string, ...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  function repo(): string {
    const dir = temp('fruitcats-repo-');
    git(dir, 'init', '-q');
    setFolder({ 'content/2026/10/set/set.json': '{}', 'content/2026/10/set/art/cards/A.webp': 'a', 'content/2026/10/other/set.json': '{}' }, dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'main');
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    return dir;
  }

  it('lets it in when the folder is exactly main\'s', () => {
    const dir = repo();
    expect(differsFrom(dir, 'content/2026/10/set')).toBeNull();
    // Changes elsewhere don't matter.
    writeFileSync(join(dir, 'content/2026/10/other/set.json'), '{"x":1}');
    expect(differsFrom(dir, 'content/2026/10/set')).toBeNull();
  });

  it('keeps it out with changed art, committed or not, and with a new file', () => {
    const dir = repo();
    writeFileSync(join(dir, 'content/2026/10/set/art/cards/A.webp'), 'redrawn');
    expect(differsFrom(dir, 'content/2026/10/set')).toMatch(/1 file\(s\) differ from origin\/main, e.g. content\/2026\/10\/set\/art\/cards\/A.webp/);
    git(dir, 'commit', '-qam', 'redraw on a branch');
    expect(differsFrom(dir, 'content/2026/10/set')).toMatch(/differ from origin\/main/);
    git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    expect(differsFrom(dir, 'content/2026/10/set')).toBeNull();
    writeFileSync(join(dir, 'content/2026/10/set/art/cards/B.webp'), 'new');
    expect(differsFrom(dir, 'content/2026/10/set')).toMatch(/B\.webp/);
  });

  it('keeps it out when there is no origin/main to compare with', () => {
    const dir = repo();
    git(dir, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(differsFrom(dir, 'content/2026/10/set')).toMatch(/no origin\/main/);
  });
});
