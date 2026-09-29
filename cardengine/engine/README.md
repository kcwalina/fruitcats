# The core

The TCG platform's core: one WebAssembly module that every host runs. The browser (Studio, the game table, the
player app), `kardix.exe` through Wasmtime, and the servers all load the same `kardix.wasm`, so a game behaves
the same everywhere. Why it is built this way is in
[docs/tcg/tcg-developer-platform.md](../../docs/tcg/tcg-developer-platform.md), "The core".

Today it holds Alex's parser and binder, and the game loader (`src/loader/`): a game's folder bound with the
framework, which it carries inside it, and the card engine's host. The runtime, the bots and the card renderer join it.
The Artist Studio and the site's build load projects with it (`host/core.ts`).

## Rules

- **Pure computation.** Bytes in, bytes out. No I/O, no clock, no randomness it wasn't handed, no calls back to
  the host, and no imports: the module must instantiate with an empty linker.
- **No dependencies.** `Cargo.toml` has an empty `[dependencies]`. Adding one is a decision for the platform doc,
  not a convenience.
- **The interface is the contract.** Hosts see only the exports in `src/abi.rs`: plain functions over bytes in
  the module's memory. The language behind them can change; they can't, except by adding.
- **Alex is identical to the C# Alex** (`mochi.agents/alex`) while both are used. The parser is a port of
  `AlexParser.cs` and the binder of `AlexBinder*.cs`, with the same rules, passes and diagnostic messages, and
  `cardengine/conformance` proves it. Change both together.

## Layout

```
src/lib.rs              the crate
src/abi.rs              the exports: tcg_alloc, tcg_free, alex_dump, alex_check, alex_bind_dump, project_load,
                        project_query, project_free
src/alex/lexer.rs       bytes to tokens with trivia; text tables are found here
src/alex/parser.rs      tokens to the concrete syntax tree, with recovery
src/alex/syntax.rs      the tree: tokens, trivia, statements, values, types, bodies
src/alex/tokens.rs      a node's tokens in order: what the writer writes and spans come from
src/alex/writer.rs      the tree back to bytes, byte for byte
src/alex/dump.rs        the canonical dump of a parse, which the conformance check compares
src/alex/model.rs       the bound model: values, types, fields and declarations, in arenas
src/alex/binder.rs      syntax trees to the model: types, the value graph, references, checking (binder_program.rs:
                        extensions, declarations, assignments through references; binder_type_values.rs: `type R`)
src/alex/binder_bodies.rs  bodies checked against the host's environment: names, calls, members, Booleans
src/alex/host.rs        what a host gives binding: kinds of declaration, the scope a body is checked in, validation
src/alex/bound_dump.rs  the canonical dump of a binding, which the conformance check compares
src/loader/card_engine.rs  the card engine's host: the libraries' vocabulary, and the card game's own rules
src/loader/project.rs   a game's folder loaded: its Game, the framework it uses, every file bound, errors by file and line
src/loader/queries.rs   what a host asks a loaded project, answered as JSON
build.rs                embeds cardengine/framework in the module
host/core.ts            the module in TypeScript, for a browser and for Node
examples/check.rs       prints what is wrong with a game's folder: cargo run --release --example check -- <folder>
tests/corpus.rs         every .alex file in fruitcats and mochi round-trips
tests/binding.rs        the Hello TCG samples bind with the framework and their rules attach
tests/project.rs        Folkborn's folder and Hello TCG load, with their cards, brief and rules
web/                    the module in a browser: engine.js (the host, no dependencies) and a check page
```

## Build and test

```bash
rustup target add wasm32-unknown-unknown         # once
cargo build --release --target wasm32-unknown-unknown   # target/wasm32-unknown-unknown/release/kardix.wasm
cargo test --release                             # native: every .alex file round-trips, broken input never panics
```

Then compare it with the C# Alex (needs mochi checked out beside fruitcats):

```bash
cd ../conformance && dotnet run -c Release
```

The browser page: serve the repository root with any static file server and open
`/cardengine/engine/web/index.html`. Pick a game folder; its `.alex` files are parsed in the page and nothing is
uploaded.

## Calling it

Every function takes and returns bytes in the module's own memory. A host:

1. `tcg_alloc(length)` returns an address; it copies its input there.
2. It calls a function, such as `alex_dump(address, length, mode)`.
3. A function that returns bytes returns one `u64`: the address in the high 32 bits, the length in the low 32. The
   host copies them out and frees them with `tcg_free(address, length)`, as it frees its input.

`cardengine/conformance/EngineModule.cs` (C#, Wasmtime) and `web/engine.js` (a browser) are the two hosts so far,
about 60 lines each.
