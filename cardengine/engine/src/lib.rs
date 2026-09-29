//! The TCG platform's core, compiled to one WebAssembly module that every host runs: the browser, `tcg.exe` (through
//! Wasmtime) and the servers. It is pure computation: bytes in, bytes out, no I/O, no clock, no host calls. Today it
//! holds Alex's parser; the game loader, the runtime and the card renderer join it.

pub mod abi;
pub mod alex;
pub mod loader;
