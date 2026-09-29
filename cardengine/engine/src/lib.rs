//! The TCG platform's core, compiled to one WebAssembly module that every host runs: the browser, `kardix.exe` (through
//! Wasmtime) and the servers. It is pure computation: bytes in, bytes out, no I/O, no clock, no host calls. It holds
//! Alex, the game loader and the card renderer; the runtime joins them.

pub mod abi;
pub mod alex;
pub mod loader;
pub mod render;
