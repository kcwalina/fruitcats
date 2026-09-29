//! The module's interface: plain functions over bytes in the module's own memory, so any WebAssembly host can call
//! them without bindings. A host allocates a buffer with `tcg_alloc`, copies its input in, calls a function, reads
//! the result it names, and frees both with `tcg_free`.
//!
//! A result is returned as one `u64`: the buffer's address in the high 32 bits and its length in the low 32.

use crate::alex::dump;
use crate::alex::parser::ParseMode;

/// Allocates `length` bytes in the module's memory for the host to write into.
#[unsafe(no_mangle)]
pub extern "C" fn tcg_alloc(length: u32) -> *mut u8 {
    let buffer: Box<[u8]> = vec![0u8; length as usize].into_boxed_slice();
    Box::into_raw(buffer) as *mut u8
}

/// Frees a buffer `tcg_alloc` or a result handed out.
///
/// # Safety
/// `pointer` and `length` must describe a buffer this module handed out and that has not been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn tcg_free(pointer: *mut u8, length: u32) {
    if pointer.is_null() {
        return;
    }
    let slice = std::ptr::slice_from_raw_parts_mut(pointer, length as usize);
    drop(unsafe { Box::from_raw(slice) });
}

/// Parses the UTF-8 Alex source at `pointer` and returns its canonical dump (`alex::dump`). `mode` is 0 for a
/// program document, 1 for a data document.
///
/// # Safety
/// `pointer` and `length` must describe readable memory in this module.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn alex_dump(pointer: *const u8, length: u32, mode: u32) -> u64 {
    let source = unsafe { std::slice::from_raw_parts(pointer, length as usize) };
    let parse_mode = if mode == 1 { ParseMode::Data } else { ParseMode::Program };
    let text = dump::dump(source, parse_mode);
    hand_out(text.into_bytes())
}

/// Parses the UTF-8 Alex source at `pointer` and returns how many diagnostics it has: the cheapest call that still
/// parses the whole file, for measuring.
///
/// # Safety
/// `pointer` and `length` must describe readable memory in this module.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn alex_check(pointer: *const u8, length: u32) -> u32 {
    let source = unsafe { std::slice::from_raw_parts(pointer, length as usize) };
    let tree = crate::alex::parser::parse(source, ParseMode::Program);
    tree.diagnostics.len() as u32
}

fn hand_out(bytes: Vec<u8>) -> u64 {
    let length = bytes.len() as u64;
    let buffer: Box<[u8]> = bytes.into_boxed_slice();
    let address = Box::into_raw(buffer) as *mut u8 as usize as u64;
    (address << 32) | length
}
