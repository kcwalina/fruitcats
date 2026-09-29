// The core's WebAssembly module in TypeScript: the host the Artist Studio (in a browser) and the build (in Node) load
// projects with. The module's interface is plain functions over bytes in its own memory (cardengine/engine/src/abi.rs);
// this file copies bytes in and out, and nothing else. No dependencies.

interface Exports {
  memory: WebAssembly.Memory;
  kardix_alloc(length: number): number;
  kardix_free(address: number, length: number): void;
  project_load(address: number, length: number): number;
  project_query(handle: number, address: number, length: number): bigint;
  project_free(handle: number): void;
}

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
    const parts: Uint8Array[] = [number(files.length)];
    for (const file of files) {
      const path = encoder.encode(file.path);
      parts.push(number(path.length), path, number(file.bytes.length), file.bytes);
    }
    const input = join(parts);
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
  free(handle: number): void {
    this.exports.project_free(handle);
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

  free(): void {
    this.core.free(this.handle);
  }
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
