// The core (cardengine/engine), in Node: built from its Rust source when it is out of date, as tcg is built from its C#
// (content/tcg.ts), and loaded once. The build, check-set and the Studio's tools read projects with it; the Studio page
// loads the same module in the browser.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Core } from '../cardengine/engine/host/core';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const ENGINE = join(REPO, 'cardengine', 'engine');

/** Where the build puts the module. */
export const CORE_WASM = join(ENGINE, 'target', 'wasm32-unknown-unknown', 'release', 'tcg_engine.wasm');

let built = false;
let loaded: Core | undefined;

/** Builds the module (quickly, when nothing changed). Throws with cargo's own message when it fails. */
export function buildCore(): string {
  if (built) return CORE_WASM;
  const r = spawnSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: ENGINE, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`The core (cardengine/engine) didn't build: ${(r.stderr || r.stdout || String(r.error)).trim()}\n`
      + '(It needs Rust and its WebAssembly target: rustup target add wasm32-unknown-unknown.)');
  }
  built = true;
  return CORE_WASM;
}

/** The core, built and loaded. */
export function core(): Core {
  return loaded ??= Core.fromBytes(readFileSync(buildCore()));
}
