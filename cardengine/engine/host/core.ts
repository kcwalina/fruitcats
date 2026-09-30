// The core's WebAssembly module in TypeScript: the host the Artist Studio (in a browser) and the build (in Node) load
// projects with. The module's interface is plain functions over bytes in its own memory (cardengine/engine/src/abi.rs);
// this file copies bytes in and out, and nothing else. No dependencies.

interface Exports {
  memory: WebAssembly.Memory;
  kardix_alloc(length: number): number;
  kardix_free(address: number, length: number): void;
  project_load(address: number, length: number): number;
  project_query(handle: number, address: number, length: number): bigint;
  project_png(handle: number, address: number, length: number): bigint;
  project_add(handle: number, address: number, length: number): number;
  project_free(handle: number): void;
  game_new(project: number, address: number, length: number): number;
  game_error(): bigint;
  game_view(handle: number, seat: number): bigint;
  game_log(handle: number, seat: number, from: number): bigint;
  game_clone(handle: number): number;
  game_free(handle: number): void;
}

/** A seat number that means every seat: a view or log with nothing hidden. */
export const ALL_SEATS = 0xffffffff;

/** One file of a project: its path within the project's folder, with forward slashes, and its bytes. */
export interface ProjectFile {
  path: string;
  bytes: Uint8Array;
}

/** A value as the core writes it (cardengine/engine/src/loader/queries.rs). */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** A reference to a record, map or list: where it is written. */
export interface JsonReference {
  $ref: string;
  $document: string | null;
  $path: string[];
}

export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  start: number;
  length: number;
  severity: 'error' | 'warning';
  message: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class Core {
  private constructor(private readonly exports: Exports) {}

  /** The module from its bytes, compiled at once: for Node, where a large module may be compiled synchronously. */
  static fromBytes(bytes: BufferSource): Core {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
    return new Core(instance.exports as unknown as Exports);
  }

  /** The module from its address: for a browser. */
  static async load(url: string): Promise<Core> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
    return new Core(instance.exports as unknown as Exports);
  }

  /** Loads a project from its files. Free it when done with it. */
  loadProject(files: ProjectFile[]): Project {
    const input = encodeFiles(files);
    const address = this.copyIn(input);
    const handle = this.exports.project_load(address, input.length);
    this.exports.kardix_free(address, input.length);
    return new Project(this, handle);
  }

  /** @internal */
  query(handle: number, question: string): string {
    const input = encoder.encode(question);
    const address = this.copyIn(input);
    const packed = this.exports.project_query(handle, address, input.length);
    this.exports.kardix_free(address, input.length);
    return decoder.decode(this.takeResult(packed));
  }

  /** @internal */
  png(handle: number, question: string): Uint8Array {
    const input = encoder.encode(question);
    const address = this.copyIn(input);
    const packed = this.exports.project_png(handle, address, input.length);
    this.exports.kardix_free(address, input.length);
    return this.takeResult(packed);
  }

  /** @internal */
  add(handle: number, files: ProjectFile[]): void {
    const input = encodeFiles(files);
    const address = this.copyIn(input);
    this.exports.project_add(handle, address, input.length);
    this.exports.kardix_free(address, input.length);
  }

  /** @internal */
  free(handle: number): void {
    this.exports.project_free(handle);
  }

  /** @internal */
  startGame(project: number, setup: string): Game {
    const input = encoder.encode(setup);
    const address = this.copyIn(input);
    const handle = this.exports.game_new(project, address, input.length);
    this.exports.kardix_free(address, input.length);
    if (handle === 0) throw new Error(decoder.decode(this.takeResult(this.exports.game_error())));
    return new Game(this, handle);
  }

  /** @internal */
  gameView(handle: number, seat: number): string {
    return decoder.decode(this.takeResult(this.exports.game_view(handle, seat)));
  }

  /** @internal */
  gameLog(handle: number, seat: number, from: number): string {
    return decoder.decode(this.takeResult(this.exports.game_log(handle, seat, from)));
  }

  /** @internal */
  gameClone(handle: number): Game {
    return new Game(this, this.exports.game_clone(handle));
  }

  /** @internal */
  gameFree(handle: number): void {
    this.exports.game_free(handle);
  }

  private copyIn(bytes: Uint8Array): number {
    const address = this.exports.kardix_alloc(bytes.length);
    new Uint8Array(this.exports.memory.buffer, address, bytes.length).set(bytes);
    return address;
  }

  /** A result is one u64: the buffer's address in the high 32 bits, its length in the low 32. */
  private takeResult(packed: bigint): Uint8Array {
    const value = BigInt.asUintN(64, packed);
    const address = Number(value >> 32n);
    const length = Number(value & 0xffffffffn);
    const bytes = new Uint8Array(this.exports.memory.buffer, address, length).slice();
    this.exports.kardix_free(address, length);
    return bytes;
  }
}

/** A loaded project: ask it questions, then free it. */
export class Project {
  constructor(private readonly core: Core, private readonly handle: number) {}

  /** The answer to a question (cardengine/engine/src/loader/queries.rs), as JSON text. */
  query(question: string): string {
    return this.core.query(this.handle, question);
  }

  /** What is wrong with the project, file by file. */
  diagnostics(): Diagnostic[] {
    return JSON.parse(this.core.query(this.handle, 'diagnostics')) as Diagnostic[];
  }

  /** A document's value as bound, or null when the project has no document of that name. */
  value(document: string): Json {
    return JSON.parse(this.core.query(this.handle, `value ${document}`)) as Json;
  }

  /** Adds fonts and pictures to the project, for drawing its cards. */
  add(files: ProjectFile[]): void {
    this.core.add(this.handle, files);
  }

  /**
   * A face drawn as a PNG: `<set> <card> <front|back> <finish>`, then `bleed`, `frame=<name>` or `no-art`; or a draw list,
   * drawn trimmed. Throws with the
   * core's message when the face can't be drawn (a picture or font the project doesn't hold, a card it doesn't have).
   */
  png(face: string): Uint8Array {
    const bytes = this.core.png(this.handle, face);
    if (bytes[0] === 0x7b) throw new Error((JSON.parse(decoder.decode(bytes)) as { error: string }).error);
    return bytes;
  }

  /** Starts a game: `<seed> <deck> <deck>…`, each seat's deck by its key. Throws with the core's reason when it can't. */
  startGame(setup: string): Game {
    return this.core.startGame(this.handle, setup);
  }

  free(): void {
    this.core.free(this.handle);
  }
}

/** A game in play (cardengine/engine/src/runtime): what each seat sees of it, and its log. Free it when done. */
export class Game {
  constructor(private readonly core: Core, private readonly handle: number) {}

  /** The table as `seat` sees it (`ALL_SEATS`: everything), as JSON text. */
  view(seat: number = ALL_SEATS): string {
    return this.core.gameView(this.handle, seat);
  }

  /** The log from entry `from` on, as `seat` sees it: one JSON object per line. */
  log(seat: number = ALL_SEATS, from = 0): string {
    return this.core.gameLog(this.handle, seat, from);
  }

  /** An independent copy. */
  clone(): Game {
    return this.core.gameClone(this.handle);
  }

  free(): void {
    this.core.gameFree(this.handle);
  }
}

/** The files a face's draw list names: its fonts, pictures, finishes and textures. */
export function drawnFiles(list: string): string[] {
  const files = new Set<string>();
  for (const line of list.split('\n')) {
    const words = line.split(' ');
    if (words[0] === 'image' || words[0] === 'tinted' || words[0] === 'text') files.add(words[1]);
    for (const word of words) {
      const paint = /^(?:finish|texture):(.+)$/.exec(word);
      if (paint) files.add(paint[1]);
    }
  }
  return [...files];
}

/** Where a reference points, when it is one. */
export function referenceOf(value: Json | undefined): JsonReference | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.$ref === 'string'
    ? (value as unknown as JsonReference)
    : null;
}

/** The value a reference to a record, map or list names, found in the documents' values by their names. */
export function follow(value: Json | undefined, documents: Record<string, Json>): Json | undefined {
  const reference = referenceOf(value);
  if (!reference) return value;
  let at: Json | undefined = reference.$document ? documents[reference.$document] : undefined;
  for (const step of reference.$path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = Array.isArray(at) ? at[Number(step)] : at[step];
  }
  return at;
}

function encodeFiles(files: ProjectFile[]): Uint8Array {
  const parts: Uint8Array[] = [number(files.length)];
  for (const file of files) {
    const path = encoder.encode(file.path);
    parts.push(number(path.length), path, number(file.bytes.length), file.bytes);
  }
  return join(parts);
}

function number(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function join(parts: Uint8Array[]): Uint8Array {
  const all = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}
