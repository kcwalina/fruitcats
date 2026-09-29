// The TypeScript Alex must read every file the way the C# Alex does. The C# side is conformance/Program.cs, built from
// the mochi repository beside this one; it prints each file's value as JSON, and so does `asJson` here.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { AlexError, AlexFolder, AlexObject, parseAlex, type AlexDocument, type AlexValue } from './alex';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

function alexFiles(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ['bin', 'obj', 'node_modules', 'survey'].includes(name) ? [] : alexFiles(path);
    return name.endsWith('.alex') ? [relative(REPO, path).replace(/\\/g, '/')] : [];
  });
}

/** Lines outside text tables. */
function statementLines(file: string): string[] {
  let inTable = false;
  return readFileSync(join(REPO, file), 'utf8').split(/\r?\n/).filter((line) => {
    if (line.startsWith('@@@')) { inTable = line.slice(3).trim() !== ''; return false; }
    return !inTable;
  });
}

/** A program document: declarations with bodies, extensions or assignments through references, which this reader refuses. */
const isProgram = (file: string) => statementLines(file).some((l) => /^((?!type |enum )[a-z][\w-]* [\w']|extension |@)/.test(l));
const ALL = [...alexFiles(join(REPO, 'games')), ...alexFiles(join(REPO, 'cardengine'))];
const DATA = ALL.filter((f) => !isProgram(f));
const PROGRAMS = ALL.filter(isProgram);
/** The schema the C# side binds each file with, as tcg does: the framework's core. */
const CORE = 'cardengine/framework/core.alex';

function valueJson(v: AlexValue): unknown {
  if (v instanceof AlexObject) {
    return { [v.isMap ? 'map' : 'record']: v.isMap ? null : v.type, entries: [...v.entries].map(([k, x]) => [k, valueJson(x)]) };
  }
  switch (v.kind) {
    case 'nic': return null;
    case 'bool': case 'int': return v.value;
    case 'float': return { float: v.value };
    case 'text': return v.table ? { table: v.value } : v.value;
    case 'empty': return { empty: true };
    case 'enum': return { enum: v.member };
    case 'ref': return { ref: v.path.join('.') };
    case 'list': return v.items.map(valueJson);
  }
}

function asJson(file: string, doc: AlexDocument) {
  const types: Record<string, unknown> = {};
  for (const name of [...doc.types.keys()].sort()) {
    const t = doc.types.get(name)!;
    types[name] = t.kind === 'record' ? { record: t.base ?? null, fields: t.fields.map((f) => f.name), fixed: [...t.fixed.keys()] }
      : t.kind === 'enum' ? { enum: t.members } : { alias: true };
  }
  return { file, type: doc.type ?? doc.root.type ?? null, root: valueJson(doc.root), texts: [...doc.texts].map(([k, v]) => [k, valueJson(v)]), types };
}

describe('the TypeScript Alex reads files as the C# Alex does', () => {
  let csharp: { file: string }[] = [];

  beforeAll(() => {
    const r = spawnSync('dotnet', ['run', '--project', 'cardengine/alex/conformance', '-c', 'Release', '--', '--schema', CORE, '--', ...DATA], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) throw new Error(`The C# Alex couldn't read the files: ${(r.stderr || r.stdout || String(r.error)).trim()}`);
    csharp = JSON.parse(r.stdout);
  }, 240_000);

  it('finds the files', () => {
    expect(DATA).toContain('games/folkborn/folkborn.alex');
    expect(DATA.length).toBeGreaterThan(10);
  });

  it.each(DATA)('%s', (file) => {
    const doc = parseAlex(readFileSync(join(REPO, file), 'utf8'), file);
    const expected = csharp.find((c) => c.file === file) as ReturnType<typeof asJson>;
    const actual = asJson(file, doc);
    // A base the core doesn't declare (a library's UnitCard) is one the C# side can't name without the library, nor the
    // fields it passes on: that's binding, not reading, so there the bases and fixed fields aren't compared.
    type TypeJson = { record?: string | null; fixed?: string[] };
    for (const [name, t] of Object.entries(expected.types) as [string, TypeJson][]) {
      const mine = actual.types[name] as TypeJson | undefined;
      if (t.record === null && mine?.record) Object.assign(mine, { record: null, fixed: t.fixed });
    }
    expect(actual).toEqual(expected);
  });

  it.each(PROGRAMS)('refuses the program document %s clearly', (file) => {
    expect(() => parseAlex(readFileSync(join(REPO, file), 'utf8'), file)).toThrow(/program/);
  });
});

describe('the reader', () => {
  const read = (text: string) => parseAlex(text, 'test.alex');

  it('reads a text table to the next marker, keeping every line as written', () => {
    const doc = read("#type Set\n\n@@@ .blurb\nFirst // not a comment\n\n\\@@@ kept\n@@@ other\nSecond\n@@@\nname = 'x'\n");
    expect(doc.root.get('blurb')).toMatchObject({ kind: 'text', value: 'First // not a comment\n\n@@@ kept' });
    expect(doc.texts.get('other')?.value).toBe('Second');
    expect(doc.root.get('name')).toMatchObject({ value: 'x' });
  });

  it('reads doubled quotes, numbers and qualified members', () => {
    const doc = read("#type T\na = 'Kris''s'\nb = -2\nc = +1.5\nd = Rarity.rare\ne = [x = 1, y = [1, 2]]\n");
    expect(doc.root.get('a')).toMatchObject({ value: "Kris's" });
    expect(doc.root.get('b')).toMatchObject({ kind: 'int', value: -2 });
    expect(doc.root.get('c')).toMatchObject({ kind: 'float', value: 1.5 });
    expect(doc.root.get('d')).toMatchObject({ kind: 'enum', type: 'Rarity', member: 'rare' });
    expect((doc.root.get('e') as AlexObject).isMap).toBe(true);
  });

  it('builds maps from statement paths and fills open instances', () => {
    const doc = read('#type Game\nsetup = Setup\nsetup.hand = 6\nzones.Deck = Zone {}\n');
    expect((doc.root.get('setup') as AlexObject).get('hand')).toMatchObject({ value: 6 });
    expect((doc.root.get('zones') as AlexObject).get('Deck')).toBeInstanceOf(AlexObject);
  });

  it('says where a file is wrong', () => {
    expect(() => read('#type Set\nname = \'open\n')).toThrow(/test.alex:2:8: This text isn't closed/);
    expect(() => read('#type Set\nx = Set { a = 1 }\nx.b = 2\n')).toThrow(/closed/);
    expect(() => read('#type Set\na = 1\na = 2\n')).toThrow(/set twice/);
    expect(() => read('name = 1\n#type Set\n')).toThrow(/top of the file/);
    expect(() => read('#type Set\nx = [a = 1, 2]\n')).toThrow(AlexError);
  });

  it('resolves references across a folder', () => {
    const folder = new AlexFolder(new Map([
      ['game', read('#type Game\nsets = [@cats]\n')],
      ['cats', read("#type Set\ncards = [\n  tom = Card { name = 'Tom' }\n]\ntext = @tom-text\n@@@ tom-text\nMeow.\n@@@\n")],
    ]));
    expect(folder.resolve({ kind: 'ref', path: ['cats', 'cards', 'tom'], line: 1 })).toBeInstanceOf(AlexObject);
    expect(folder.resolve({ kind: 'ref', path: ['tom'], line: 1 })).toBe(folder.lookup(['cats', 'cards', 'tom']));
    expect(folder.resolve(folder.documents.get('cats')!.root.get('text'))).toMatchObject({ value: 'Meow.' });
  });
});
