//! The module's interface: plain functions over bytes in the module's own memory, so any WebAssembly host can call
//! them without bindings. A host allocates a buffer with `kardix_alloc`, copies its input in, calls a function, reads
//! the result it names, and frees both with `kardix_free`.
//!
//! A result is returned as one `u64`: the buffer's address in the high 32 bits and its length in the low 32.

use crate::alex::dump;
use crate::alex::host::{Host, KindsHost};
use crate::loader::card_engine::CardEngineHost;
use crate::loader::{project, queries};
use crate::alex::{binder, bound_dump};
use crate::alex::parser::ParseMode;

/// Allocates `length` bytes in the module's memory for the host to write into.
#[unsafe(no_mangle)]
pub extern "C" fn kardix_alloc(length: u32) -> *mut u8 {
    let buffer: Box<[u8]> = vec![0u8; length as usize].into_boxed_slice();
    Box::into_raw(buffer) as *mut u8
}

/// Frees a buffer `kardix_alloc` or a result handed out.
///
/// # Safety
/// `pointer` and `length` must describe a buffer this module handed out and that has not been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn kardix_free(pointer: *mut u8, length: u32) {
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

// ── projects ─────────────────────────────────────────────────────────────────────────────────────

thread_local! {
    static PROJECTS: std::cell::RefCell<Vec<Option<project::Project>>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Loads a project from the files at `pointer` and returns a handle to ask it questions with (`project_query`) and to
/// free it (`project_free`). The input is little-endian: a u32 count, then for each file its path within the project's
/// folder and its bytes, each as a u32 length and its bytes. A handle is never 0.
///
/// # Safety
/// `pointer` and `length` must describe readable memory in this module.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn project_load(pointer: *const u8, length: u32) -> u32 {
    let input = unsafe { std::slice::from_raw_parts(pointer, length as usize) };
    let files = read_project_files(input).unwrap_or_default();
    let loaded = project::load(files);
    PROJECTS.with(|projects| {
        let mut projects = projects.borrow_mut();
        projects.push(Some(loaded));
        projects.len() as u32
    })
}

/// Answers a question about a loaded project (`loader::queries::answer`), as UTF-8 JSON.
///
/// # Safety
/// `pointer` and `length` must describe readable memory in this module.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn project_query(handle: u32, pointer: *const u8, length: u32) -> u64 {
    let question = String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(pointer, length as usize) }).into_owned();
    let answer = PROJECTS.with(|projects| {
        let projects = projects.borrow();
        match projects.get((handle as usize).wrapping_sub(1)).and_then(|p| p.as_ref()) {
            Some(project) => queries::answer(project, &question),
            None => "{\"error\":\"No project has that handle.\"}".to_string(),
        }
    });
    hand_out(answer.into_bytes())
}

/// Draws a face of a loaded project as a PNG (`loader::queries::png`): `<set> <card> <front|back> <finish>`, then
/// `bleed`, `frame=<name>` or `no-art`; or a draw list the project's files draw. The answer is the PNG's bytes, or, when the face can't be drawn, UTF-8 JSON
/// `{"error": ...}`, which a PNG never starts with.
///
/// # Safety
/// `pointer` and `length` must describe readable memory in this module.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn project_png(handle: u32, pointer: *const u8, length: u32) -> u64 {
    let question = String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(pointer, length as usize) }).into_owned();
    let answer = PROJECTS.with(|projects| {
        let projects = projects.borrow();
        match projects.get((handle as usize).wrapping_sub(1)).and_then(|p| p.as_ref()) {
            Some(project) => queries::png(project, &question).unwrap_or_else(|e| format!("{{\"error\":{}}}", queries::string(&e)).into_bytes()),
            None => b"{\"error\":\"No project has that handle.\"}".to_vec(),
        }
    });
    hand_out(answer)
}

/// Adds files that aren't Alex (fonts, pictures) to a loaded project, in `project_load`'s format, so a host can hand
/// the core the pictures a face draws only when it draws it. A file already there is replaced. Answers 1, or 0 for a
/// bad handle or input.
///
/// # Safety
/// `pointer` and `length` must describe readable memory in this module.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn project_add(handle: u32, pointer: *const u8, length: u32) -> u32 {
    let input = unsafe { std::slice::from_raw_parts(pointer, length as usize) };
    let Some(files) = read_project_files(input) else { return 0 };
    PROJECTS.with(|projects| {
        let mut projects = projects.borrow_mut();
        let Some(project) = projects.get_mut((handle as usize).wrapping_sub(1)).and_then(|p| p.as_mut()) else { return 0 };
        for file in files.into_iter().filter(|f| !f.path.ends_with(".alex")) {
            project.assets.retain(|a| a.path != file.path);
            project.decoded.borrow_mut().remove(&file.path);
            project.assets.push(file);
        }
        1
    })
}

/// Frees a loaded project.
#[unsafe(no_mangle)]
pub extern "C" fn project_free(handle: u32) {
    PROJECTS.with(|projects| {
        if let Some(slot) = projects.borrow_mut().get_mut((handle as usize).wrapping_sub(1)) {
            *slot = None;
        }
    });
}

fn read_project_files(input: &[u8]) -> Option<Vec<project::ProjectFile>> {
    let mut at = 0usize;
    let mut take = |length: usize| -> Option<&[u8]> {
        let slice = input.get(at..at.checked_add(length)?)?;
        at += length;
        Some(slice)
    };
    let count = u32::from_le_bytes(take(4)?.try_into().ok()?);
    let mut files = Vec::new();
    for _ in 0..count {
        let path_length = u32::from_le_bytes(take(4)?.try_into().ok()?) as usize;
        let path = String::from_utf8_lossy(take(path_length)?).into_owned();
        let bytes_length = u32::from_le_bytes(take(4)?.try_into().ok()?) as usize;
        let bytes = take(bytes_length)?.to_vec();
        files.push(project::ProjectFile { path, bytes });
    }
    Some(files)
}

fn hand_out(bytes: Vec<u8>) -> u64 {
    let length = bytes.len() as u64;
    let buffer: Box<[u8]> = bytes.into_boxed_slice();
    let address = Box::into_raw(buffer) as *mut u8 as usize as u64;
    (address << 32) | length
}
