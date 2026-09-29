// The engine's WebAssembly module in a browser: the same file kardix.exe runs through Wasmtime. No dependencies and no
// bindings: the module's interface is plain functions over bytes in its own memory (cardengine/engine/src/abi.rs).

export async function loadEngine(url) {
  const started = performance.now();
  const response = await fetch(url);
  const { instance } = await WebAssembly.instantiateStreaming(response);
  return new Engine(instance.exports, performance.now() - started);
}

const decoder = new TextDecoder();

export class Engine {
  constructor(exports, loadMilliseconds) {
    this.exports = exports;
    this.loadMilliseconds = loadMilliseconds;
  }

  // The canonical dump of a file: mode 0 for a program document, 1 for a data one.
  dump(bytes, mode = 0) {
    const input = this.copyIn(bytes);
    const packed = this.exports.alex_dump(input, bytes.length, mode);
    this.exports.kardix_free(input, bytes.length);
    return decoder.decode(this.takeResult(packed));
  }

  // Parses a file and returns how many diagnostics it has.
  check(bytes) {
    const input = this.copyIn(bytes);
    const count = this.exports.alex_check(input, bytes.length);
    this.exports.kardix_free(input, bytes.length);
    return count;
  }

  copyIn(bytes) {
    const address = this.exports.kardix_alloc(bytes.length);
    new Uint8Array(this.exports.memory.buffer, address, bytes.length).set(bytes);
    return address;
  }

  // A result is one u64: the buffer's address in the high 32 bits, its length in the low 32.
  takeResult(packed) {
    const address = Number(BigInt.asUintN(64, packed) >> 32n);
    const length = Number(BigInt.asUintN(64, packed) & 0xffffffffn);
    const bytes = new Uint8Array(this.exports.memory.buffer, address, length).slice();
    this.exports.kardix_free(address, length);
    return bytes;
  }
}
