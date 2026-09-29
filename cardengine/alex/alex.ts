// Alex in TypeScript: the reader. It parses one .alex file into its value, as the language specification says
// (mochi.agents/alex/docs/language-specification.md), and reads it the way the C# Alex does: alex.test.ts checks both
// on the same files.
//
// It reads the data layer only: documents (`#type`, a named root, statements, open instances), records, lists, maps,
// references, `nameof`, enum members, text tables, and type and enum declarations. It doesn't bind: references stay
// paths, enum members stay words, and a field a schema would default is simply absent. A program document
// (declarations with bodies, extensions, assignments through references) is refused with a clear error.

export type AlexValue =
  | AlexNic | AlexBoolean | AlexInteger | AlexFloat | AlexString | AlexEmpty | AlexEnum | AlexReference | AlexList | AlexObject;

interface At { line: number }
export interface AlexNic extends At { kind: 'nic' }
export interface AlexBoolean extends At { kind: 'bool'; value: boolean }
export interface AlexInteger extends At { kind: 'int'; value: number }
export interface AlexFloat extends At { kind: 'float'; value: number }
/** Text. `table`: written as a text table rather than in quotes. */
export interface AlexString extends At { kind: 'text'; value: string; table?: boolean }
export interface AlexEmpty extends At { kind: 'empty' }
/** An enum member as written: `legendary`, or `Rarity.legendary` (`type` is then `Rarity`). */
export interface AlexEnum extends At { kind: 'enum'; member: string; type?: string }
export interface AlexReference extends At { kind: 'ref'; path: string[] }
export interface AlexList extends At { kind: 'list'; items: AlexValue[] }

/** A record (`Type { ... }`) or a map (`[key = value]`): named values in the order they were written. */
export class AlexObject implements At {
  readonly kind = 'object';
  readonly entries = new Map<string, AlexValue>();
  /** Later statements and tables may still add to it: an open instance, or a map made by a statement's path. */
  open = false;
  constructor(readonly isMap: boolean, readonly type: string | undefined, readonly line: number) {}
  get(name: string): AlexValue | undefined { return this.entries.get(name); }
}

/** A type expression, as written: `text`, `Card?`, `[Finish]`, `[text: Card]`, `[Card, int]`, `A | B`, `type R`. */
export type AlexTypeExpr =
  | { kind: 'name'; name: string }
  | { kind: 'optional'; of: AlexTypeExpr }
  | { kind: 'list'; of: AlexTypeExpr }
  | { kind: 'map'; key: AlexTypeExpr; value: AlexTypeExpr }
  | { kind: 'tuple'; items: AlexTypeExpr[] }
  | { kind: 'union'; of: AlexTypeExpr[] }
  | { kind: 'type'; name: string };

export interface AlexField { name: string; type: AlexTypeExpr; default?: AlexValue }
export type AlexTypeDecl =
  | { kind: 'record'; name: string; base?: string; fields: AlexField[]; fixed: Map<string, AlexValue>; line: number }
  | { kind: 'union'; name: string; type: AlexTypeExpr; line: number }
  | { kind: 'enum'; name: string; members: string[]; line: number };

export interface AlexDocument {
  /** What the file says it is (`#type Game`), if it says. */
  type?: string;
  /** The root's name in a file that declares it by its first statement (`folkborn = Game`). */
  rootName?: string;
  root: AlexObject;
  /** Top-level texts (`@@@ name`), by name. */
  texts: Map<string, AlexString>;
  /** The types and enums it declares, by name. */
  types: Map<string, AlexTypeDecl>;
}

export class AlexError extends Error {
  constructor(readonly source: string, readonly line: number, readonly column: number, readonly reason: string) {
    super(`${source}:${line}:${column}: ${reason}`);
  }
}

// ── Tokens ───────────────────────────────────────────────────────────────────────────────────────

type TokenKind = 'word' | 'number' | 'string' | 'punct' | 'newline' | 'directive' | 'table' | 'eof';
interface Token { kind: TokenKind; text: string; line: number; column: number; value?: string; float?: boolean }

const WORD = /^[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*/;
const NUMBER = /^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/;
const isType = (w: string) => /^[A-Z]/.test(w);

function tokenize(text: string, source: string): Token[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (/\r(?!\n)/.test(text)) {
    const at = text.slice(0, text.search(/\r(?!\n)/)).split('\n');
    throw new AlexError(source, at.length, at[at.length - 1].length + 1, 'A carriage return must be followed by a line feed.');
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const tokens: Token[] = [];
  const fail = (line: number, column: number, reason: string): never => { throw new AlexError(source, line, column, reason); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], n = i + 1;
    if (line.startsWith('@@@')) {
      // A text table: every line up to the next line that starts with @@@ belongs to it, exactly as written.
      const name = line.slice(3).trimEnd();
      if (!name) fail(n, 1, 'A text table ends here, but none was open.');
      if (!/^ +\.?[A-Za-z_]/.test(name)) fail(n, 4, 'A text table\'s marker is @@@, a space, and its name.');
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && !lines[j].startsWith('@@@'); j++) body.push(lines[j].startsWith('\\@@@') ? lines[j].slice(1) : lines[j]);
      let value = body.join('\n');
      // The text is the lines between the markers with exactly one trailing line break removed. At the end of the file
      // the file's own last line break is that one.
      const closed = j < lines.length;
      if (!closed && body.length && body[body.length - 1] === '') value = body.slice(0, -1).join('\n');
      tokens.push({ kind: 'table', text: name.trim(), line: n, column: 1, value });
      tokens.push({ kind: 'newline', text: '\n', line: n, column: line.length + 1 });
      // A bare @@@ ends the table; `@@@ other` starts the next one, so it's read again.
      i = closed && lines[j].slice(3).trim() === '' ? j : j - 1;
      continue;
    }
    let c = 0;
    while (c < line.length) {
      const ch = line[c];
      if (ch === ' ' || ch === '\t') { c++; continue; }
      if (line.startsWith('//', c)) break;
      const rest = line.slice(c);
      if (ch === "'") {
        let value = '', k = c + 1;
        for (;;) {
          if (k >= line.length) fail(n, c + 1, 'This text isn\'t closed: a quoted text ends on its own line with \'.');
          if (line[k] === "'") {
            if (line[k + 1] === "'") { value += "'"; k += 2; continue; }
            break;
          }
          value += line[k++];
        }
        tokens.push({ kind: 'string', text: line.slice(c, k + 1), line: n, column: c + 1, value });
        c = k + 1;
        continue;
      }
      if (ch === '#') {
        const m = WORD.exec(rest.slice(1));
        if (!m) fail(n, c + 1, '# is only used by a directive such as #type, with no space after it.');
        tokens.push({ kind: 'directive', text: m![0], line: n, column: c + 1 });
        c += 1 + m![0].length;
        continue;
      }
      const num = /^[0-9]/.test(ch) || ((ch === '-' || ch === '+') && /^[0-9]/.test(line[c + 1] ?? '')) ? NUMBER.exec(rest) : null;
      if (num) {
        tokens.push({ kind: 'number', text: num[0], line: n, column: c + 1, float: !!(num[1] || num[2]) });
        c += num[0].length;
        continue;
      }
      const word = WORD.exec(rest);
      if (word) {
        if (rest[word[0].length] === '-' && WORD.test(rest.slice(word[0].length + 1)) === false)
          fail(n, c + word[0].length + 1, 'A name can\'t end with - or have -- in it.');
        tokens.push({ kind: 'word', text: word[0], line: n, column: c + 1 });
        c += word[0].length;
        continue;
      }
      // The program layer's operators are read too, so a program document is refused by what it is, not by a character.
      const op = /^(==|!=|<=|>=|\+=|-=)/.exec(rest)?.[0];
      if (op) {
        tokens.push({ kind: 'punct', text: op, line: n, column: c + 1 });
        c += 2;
        continue;
      }
      if ('{}[]()=,.:|?@+-<>'.includes(ch)) {
        tokens.push({ kind: 'punct', text: ch, line: n, column: c + 1 });
        c++;
        continue;
      }
      fail(n, c + 1, `Alex has no meaning for '${ch}' here.`);
    }
    tokens.push({ kind: 'newline', text: '\n', line: n, column: line.length + 1 });
  }
  tokens.push({ kind: 'eof', text: '', line: lines.length, column: 1 });
  return tokens;
}

// ── Parser ───────────────────────────────────────────────────────────────────────────────────────


class Parser {
  private at = 0;
  constructor(private readonly tokens: Token[], private readonly source: string) {}

  get peek(): Token { return this.tokens[this.at]; }
  peekAt(offset: number): Token { return this.tokens[Math.min(this.at + offset, this.tokens.length - 1)]; }
  next(): Token { return this.tokens[this.at++]; }
  is(text: string, t = this.peek) { return t.kind === 'punct' && t.text === text; }

  fail(reason: string, t = this.peek): never { throw new AlexError(this.source, t.line, t.column, reason); }

  expect(text: string, what = `'${text}'`): Token {
    if (!this.is(text)) this.fail(`Expected ${what} here${this.peek.kind === 'eof' ? ', at the end of the file' : `, not '${this.peek.text}'`}.`);
    return this.next();
  }

  skipNewlines() { while (this.peek.kind === 'newline') this.at++; }

  /** Between the items of braces or brackets: a comma, line breaks, or both. Whether one was there. */
  separator(): boolean {
    let seen = false;
    while (this.peek.kind === 'newline' || this.is(',')) {
      if (this.is(',')) { if (seen && this.tokens[this.at - 1]?.text === ',') this.fail('Two commas in a row.'); }
      seen = true;
      this.at++;
    }
    return seen;
  }

  word(what: string): Token {
    if (this.peek.kind !== 'word') this.fail(`Expected ${what} here, not '${this.peek.text || 'the end of the file'}'.`);
    return this.next();
  }

  lowerName(what: string): string {
    const t = this.word(what);
    if (isType(t.text)) this.fail(`${what[0].toUpperCase()}${what.slice(1)} starts with a lowercase letter: '${t.text}' is a type name.`, t);
    return t.text;
  }

  path(): string[] {
    const parts = [this.word('a name').text];
    while (this.is('.')) { this.next(); this.skipNewlines(); parts.push(this.word('a name').text); }
    return parts;
  }

  value(): AlexValue {
    this.skipNewlines();
    const t = this.peek;
    const line = t.line;
    if (t.kind === 'string') { this.next(); return { kind: 'text', value: t.value!, line }; }
    if (t.kind === 'number') {
      this.next();
      const value = Number(t.text);
      return t.float ? { kind: 'float', value, line } : { kind: 'int', value, line };
    }
    if (this.is('@')) {
      this.next();
      return { kind: 'ref', path: this.path(), line };
    }
    if (this.is('[')) return this.collection();
    if (t.kind === 'word') {
      this.next();
      switch (t.text) {
        case 'nic': return { kind: 'nic', line };
        case 'empty': return { kind: 'empty', line };
        case 'true': return { kind: 'bool', value: true, line };
        case 'false': return { kind: 'bool', value: false, line };
        case 'nameof': {
          this.expect('(');
          // nameof(x) is x's last segment, as text.
          const path = this.path();
          this.expect(')');
          return { kind: 'text', value: path[path.length - 1], line };
        }
      }
      if (isType(t.text)) {
        if (this.is('{')) return this.record(t.text, line);
        if (this.is('.')) {
          this.next();
          return { kind: 'enum', type: t.text, member: this.lowerName('an enum member'), line };
        }
        this.fail(`A type name alone is an open instance, which only stands as the whole value of a top-level statement; write ${t.text} {} here.`, t);
      }
      return { kind: 'enum', member: t.text, line };
    }
    return this.fail(`Expected a value here, not '${t.text || 'the end of the file'}'.`);
  }

  record(type: string, line: number): AlexObject {
    this.expect('{');
    const record = new AlexObject(false, type, line);
    this.separator();
    while (!this.is('}')) {
      const name = this.word('a field name');
      if (isType(name.text)) this.fail(`A field's name starts with a lowercase letter: '${name.text}' is a type name.`, name);
      this.expect('=', `'=' after the field '${name.text}'`);
      if (record.entries.has(name.text)) this.fail(`'${name.text}' is written twice in this ${type}.`, name);
      record.entries.set(name.text, this.value());
      if (!this.separator() && !this.is('}')) this.fail(`Expected a comma, a new line or '}' after the field '${name.text}'.`);
    }
    this.next();
    return record;
  }

  collection(): AlexList | AlexObject {
    const open = this.expect('[');
    this.separator();
    const isMap = this.peek.kind === 'word' && this.is('=', this.peekAt(1));
    const list: AlexValue[] = [];
    const map = new AlexObject(true, undefined, open.line);
    while (!this.is(']')) {
      const entry = this.peek.kind === 'word' && this.is('=', this.peekAt(1));
      if (entry !== isMap) this.fail(isMap ? 'This is a map ([key = value]), so every item needs a key.' : 'This is a list, so its items can\'t have keys.');
      if (isMap) {
        const key = this.next();
        this.next();
        if (map.entries.has(key.text)) this.fail(`The key '${key.text}' is written twice in this map.`, key);
        map.entries.set(key.text, this.value());
      } else list.push(this.value());
      if (!this.separator() && !this.is(']')) this.fail('Expected a comma, a new line or \']\' after this item.');
    }
    this.next();
    return isMap ? map : { kind: 'list', items: list, line: open.line };
  }

  typeExpr(): AlexTypeExpr {
    const alternatives = [this.typeTerm()];
    while (this.is('|')) { this.next(); this.skipNewlines(); alternatives.push(this.typeTerm()); }
    return alternatives.length === 1 ? alternatives[0] : { kind: 'union', of: alternatives };
  }

  typeTerm(): AlexTypeExpr {
    let term: AlexTypeExpr;
    if (this.is('[')) {
      this.next();
      const first = this.typeExpr();
      if (this.is(':')) { this.next(); term = { kind: 'map', key: first, value: this.typeExpr() }; }
      else if (this.is(',')) {
        const items = [first];
        while (this.is(',')) { this.next(); items.push(this.typeExpr()); }
        term = { kind: 'tuple', items };
      } else term = { kind: 'list', of: first };
      this.expect(']');
    } else {
      const name = this.word('a type').text;
      term = name === 'type' && this.peek.kind === 'word' ? { kind: 'type', name: this.next().text } : { kind: 'name', name };
    }
    if (this.is('?')) { this.next(); term = { kind: 'optional', of: term }; }
    return term;
  }

  /** `type Name : Base { ... }`, `type Name = A | B`, after `type`. */
  typeDecl(line: number): AlexTypeDecl {
    const name = this.word('a type name').text;
    if (this.is('=')) { this.next(); this.skipNewlines(); return { kind: 'union', name, type: this.typeExpr(), line }; }
    let base: string | undefined;
    if (this.is(':')) { this.next(); base = this.word('a base type').text; }
    this.expect('{');
    const fields: AlexField[] = [];
    const fixed = new Map<string, AlexValue>();
    this.separator();
    while (!this.is('}')) {
      const field = this.lowerName('a field name');
      if (this.is(':')) {
        this.next();
        const decl: AlexField = { name: field, type: this.typeExpr() };
        if (this.is('=')) { this.next(); decl.default = this.value(); }
        fields.push(decl);
      } else {
        this.expect('=', `':' or '=' after '${field}'`);
        fixed.set(field, this.value());
      }
      if (!this.separator() && !this.is('}')) this.fail(`Expected a comma, a new line or '}' after '${field}'.`);
    }
    this.next();
    return { kind: 'record', name, base: base === 'data' ? undefined : base, fields, fixed, line };
  }

  enumDecl(line: number): AlexTypeDecl {
    const name = this.word('an enum name').text;
    this.expect('{');
    const members: string[] = [];
    this.separator();
    while (!this.is('}')) {
      const m = this.lowerName('an enum member');
      if (members.includes(m)) this.fail(`'${m}' is written twice in ${name}.`);
      members.push(m);
      if (!this.separator() && !this.is('}')) this.fail(`Expected a comma, a new line or '}' after '${m}'.`);
    }
    this.next();
    return { kind: 'enum', name, members, line };
  }

  endOfStatement() {
    if (this.peek.kind !== 'newline' && this.peek.kind !== 'eof') this.fail(`A statement ends at the end of its line; '${this.peek.text}' is left over.`);
  }
}

/** Reads one .alex file. `source` names it in errors. Throws an AlexError at the first thing that isn't valid Alex. */
export function parseAlex(text: string, source = 'the file'): AlexDocument {
  const p: Parser = new Parser(tokenize(text, source), source);
  const doc: AlexDocument = { root: new AlexObject(false, undefined, 1), texts: new Map(), types: new Map() };
  doc.root.open = true;
  const set = new Set<string>();

  const declareType = (decl: AlexTypeDecl, t: Token) => {
    if (doc.types.has(decl.name)) p.fail(`The type ${decl.name} is declared twice.`, t);
    doc.types.set(decl.name, decl);
  };

  /** The object a statement's path walks to, making maps on the way as statements do, and the name it sets there. */
  const target = (path: string[], t: Token): [AlexObject, string] => {
    let at = doc.root;
    const parts = doc.rootName && path.length > 1 && path[0] === doc.rootName ? path.slice(1) : path;
    for (const part of parts.slice(0, -1)) {
      let next = at.get(part);
      if (!next) {
        const made = new AlexObject(true, undefined, t.line);
        made.open = true;
        at.entries.set(part, made);
        next = made;
      }
      if (!(next instanceof AlexObject)) p.fail(`'${part}' isn't a record or a map, so nothing can be set inside it.`, t);
      if (!next.open) p.fail(`'${part}' is closed: everything in it is written in its braces or brackets.`, t);
      at = next;
    }
    return [at, parts[parts.length - 1]];
  };

  const assign = (path: string[], value: AlexValue, t: Token) => {
    const key = (doc.rootName && path[0] === doc.rootName && path.length > 1 ? path.slice(1) : path).join('.');
    if (set.has(key)) p.fail(`${key} is set twice.`, t);
    set.add(key);
    const [at, name] = target(path, t);
    at.entries.set(name, value);
  };

  let directives = true, statements = 0;
  p.skipNewlines();
  while (p.peek.kind !== 'eof') {
    const t = p.peek;
    if (t.kind === 'directive') {
      if (!directives) p.fail('A directive goes at the top of the file, before every statement.');
      p.next();
      if (t.text !== 'type') p.fail(`Alex has no directive #${t.text}; the one directive is #type.`, t);
      if (doc.type) p.fail('The file already said its type.', t);
      const name = p.word('the type the file holds');
      if (!isType(name.text)) p.fail(`#type names a type, which starts with a capital letter: '${name.text}'.`, name);
      doc.type = name.text;
      doc.root = new AlexObject(false, name.text, t.line);
      doc.root.open = true;
      p.endOfStatement();
    } else if (t.kind === 'table') {
      directives = false;
      p.next();
      const value: AlexString = { kind: 'text', value: t.value!, table: true, line: t.line };
      if (t.text.startsWith('.')) assign(t.text.slice(1).split('.'), value, t);
      else if (!t.text.includes('.')) {
        if (doc.texts.has(t.text)) p.fail(`There are two texts named ${t.text}.`, t);
        doc.texts.set(t.text, value);
      } else assign(t.text.split('.'), value, t);
    } else if (t.kind === 'word') {
      directives = false;
      const second = p.peekAt(1);
      if ((t.text === 'type' || t.text === 'enum') && second.kind === 'word' && isType(second.text)) {
        p.next();
        declareType(t.text === 'type' ? p.typeDecl(t.line) : p.enumDecl(t.line), t);
      } else if (t.text === 'extension' && second.kind === 'word' && isType(second.text)) {
        p.fail('This reader reads data documents; an extension belongs to a program document.');
      } else if (second.kind === 'word' || second.kind === 'string') {
        p.fail(`'${t.text} ${second.text}' is a declaration of the program layer; this reader reads data documents.`);
      } else {
        const path = p.path();
        p.expect('=', `'=' after ${path.join('.')}`);
        p.skipNewlines();
        const rhs = p.peek;
        let value: AlexValue;
        const openInstance = rhs.kind === 'word' && isType(rhs.text) && !p.is('{', p.peekAt(1)) && !p.is('.', p.peekAt(1));
        if (openInstance) {
          p.next();
          const record = new AlexObject(false, rhs.text, rhs.line);
          record.open = true;
          value = record;
        } else value = p.value();
        if (statements === 0 && !doc.type && openInstance && path.length === 1) {
          // The named root: `folkborn = Game` as the first statement.
          doc.rootName = path[0];
          doc.root = value as AlexObject;
        } else assign(path, value, t);
        statements++;
      }
      p.endOfStatement();
    } else if (p.is('@')) {
      p.fail('An assignment through a reference belongs to a program document; this reader reads data documents.');
    } else {
      p.fail(`A statement starts with a name, not '${t.text}'.`);
    }
    p.skipNewlines();
  }
  return doc;
}

// ── Reading values ───────────────────────────────────────────────────────────────────────────────

/** A text's words, or undefined when the value isn't text. */
export const textOf = (v: AlexValue | undefined): string | undefined => (v?.kind === 'text' ? v.value : undefined);

export const intOf = (v: AlexValue | undefined): number | undefined => (v?.kind === 'int' ? v.value : undefined);

export const boolOf = (v: AlexValue | undefined): boolean | undefined => (v?.kind === 'bool' ? v.value : undefined);

/** An enum member's word, or undefined. */
export const memberOf = (v: AlexValue | undefined): string | undefined => (v?.kind === 'enum' ? v.member : undefined);

export const itemsOf = (v: AlexValue | undefined): AlexValue[] => (v?.kind === 'list' ? v.items : []);

export const objectOf = (v: AlexValue | undefined): AlexObject | undefined => (v instanceof AlexObject ? v : undefined);

/**
 * The documents of a folder, read together: `@name` finds a document by its name (the file's name, or a named root),
 * one of its root's fields, a map entry at any depth, or a top-level text, as the language's named members are.
 */
export class AlexFolder {
  constructor(readonly documents: Map<string, AlexDocument>) {}

  /** The value a reference names, following references on the way; undefined when nothing has that name. */
  resolve(value: AlexValue | undefined, from?: string): AlexValue | undefined {
    for (let hops = 0; value?.kind === 'ref' && hops < 32; hops++) value = this.lookup(value.path, from);
    return value?.kind === 'ref' ? undefined : value;
  }

  lookup(path: string[], from?: string): AlexValue | undefined {
    const [first, ...rest] = path;
    const found = this.named(first, from);
    let at: AlexValue | undefined = found;
    for (const part of rest) at = objectOf(this.resolve(at, from))?.get(part);
    return at;
  }

  /** The one named member called `name`. A document's root wins over other members; otherwise it must be unique. */
  private named(name: string, from?: string): AlexValue | undefined {
    const doc = this.documents.get(name);
    if (doc) return doc.root;
    const hits: AlexValue[] = [];
    const docs = [...this.documents.values()];
    // A document's own members come first, so a set's card isn't made ambiguous by another set's.
    const own = from ? this.documents.get(from) : undefined;
    for (const d of own ? [own] : docs) collect(d, name, hits);
    if (!hits.length && own) for (const d of docs) if (d !== own) collect(d, name, hits);
    if (hits.length > 1) throw new Error(`@${name} is ambiguous: more than one value is named ${name}.`);
    return hits[0];
  }
}

function collect(doc: AlexDocument, name: string, hits: AlexValue[]) {
  const text = doc.texts.get(name);
  if (text) hits.push(text);
  const field = doc.root.get(name);
  if (field) hits.push(field);
  const walk = (v: AlexValue) => {
    if (v instanceof AlexObject) {
      for (const [k, x] of v.entries) {
        if (v.isMap && k === name) hits.push(x);
        walk(x);
      }
    } else if (v.kind === 'list') v.items.forEach(walk);
  };
  walk(doc.root);
}
