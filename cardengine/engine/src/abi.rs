//! The module's interface: plain functions over bytes in the module's own memory, so any WebAssembly host can call
//! them without bindings. A host allocates a buffer with `tcg_alloc`, copies its input in, calls a function, reads
//! the result it names, and frees both with `tcg_free`.
//!
//! A result is returned as one `u64`: the buffer's address in the high 32 bits and its length in the low 32.

use crate::alex::dump;
use crate::alex::host::{Host, KindsHost};
use crate::loader::card_engine::CardEngineHost;
use crate::alex::{binder, bound_dump};
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

/// Binds the sources at `pointer` together and returns their canonical bound dump (`alex::bound_dump`). The input is
/// little-endian: a u32 host (0 none; 1 the card engine's kinds of declaration and nothing else; 2 the card engine's
/// host for the game named next, as a u32 length and its bytes), a u32 count, then for each source a u32 role (0 schema,
/// 1 data, 2 any), the file name and the bytes, each as a u32 length and its bytes.
///
/// # Safety
/// `pointer` and `length` must describe readable memory in this module.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn alex_bind_dump(pointer: *const u8, length: u32) -> u64 {
    let input = unsafe { std::slice::from_raw_parts(pointer, length as usize) };
    let text = match read_sources(input) {
        Some((host, sources)) => bound_dump::dump(&binder::bind(sources, host.as_ref(), false)),
        None => "unreadable input\n".to_string(),
    };
    hand_out(text.into_bytes())
}

fn read_sources(input: &[u8]) -> Option<(Box<dyn Host>, Vec<binder::Source>)> {
    struct Reader<'i> {
        input: &'i [u8],
        at: usize,
    }
    impl<'i> Reader<'i> {
        fn bytes(&mut self, length: usize) -> Option<&'i [u8]> {
            let slice = self.input.get(self.at..self.at.checked_add(length)?)?;
            self.at += length;
            Some(slice)
        }
        fn number(&mut self) -> Option<u32> {
            let bytes = self.bytes(4)?;
            Some(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
        }
    }

    let mut reader = Reader { input, at: 0 };
    let host: Box<dyn Host> = match reader.number()? {
        0 => Box::new(KindsHost { kinds: Vec::new() }),
        1 => Box::new(KindsHost { kinds: CardEngineHost::new("").kinds() }),
        _ => {
            let length = reader.number()? as usize;
            let game = String::from_utf8_lossy(reader.bytes(length)?).into_owned();
            Box::new(CardEngineHost::new(&game))
        }
    };
    let count = reader.number()?;
    let mut sources = Vec::new();
    for _ in 0..count {
        let role = match reader.number()? {
            0 => binder::Role::Schema,
            1 => binder::Role::Data,
            _ => binder::Role::Any,
        };
        let name_length = reader.number()? as usize;
        let name = String::from_utf8_lossy(reader.bytes(name_length)?).into_owned();
        let bytes_length = reader.number()? as usize;
        let bytes = reader.bytes(bytes_length)?.to_vec();
        sources.push(binder::Source { name, bytes, role, check_root_name: true });
    }
    Some((host, sources))
}

fn hand_out(bytes: Vec<u8>) -> u64 {
    let length = bytes.len() as u64;
    let buffer: Box<[u8]> = bytes.into_boxed_slice();
    let address = Box::into_raw(buffer) as *mut u8 as usize as u64;
    (address << 32) | length
}
