//! The project loader (L1 in docs/tcg/tcg-developer-platform.md): a game's folder, handed in as files, bound into one
//! compilation the runtime and the tools read. The core does no I/O: a host reads the folder and passes its files in.
//!
//! A project holds exactly one `Game`. Every other `.alex` file joins it: its card sets, cards files, rulebook, card
//! layout, and rules documents (`#type Rules`, read in program mode, since they hold code). The framework's core is the
//! schema every game is written against; the libraries the game lists in `uses`, with what they require, join it. A
//! printable game lists none, so the engine's concepts never reach it. Every file is bound with the card engine's host,
//! which gives rule bodies their vocabulary and checks the card game's own rules.

use std::collections::HashSet;

use crate::alex::binder::{self, BoundDocument, Compilation, Role, Source};
use crate::alex::model::{Severity, ValueId, ValueKind};
use crate::alex::parser::{self, ParseMode};
use crate::alex::syntax::{Element, Statement, TextSpan, Value};
use crate::loader::card_engine::{CardEngineHost, LIBRARIES};

mod framework {
    include!(concat!(env!("OUT_DIR"), "/framework.rs"));
}

/// One file of a project: its path within the project's folder (forward slashes) and its bytes.
#[derive(Clone)]
pub struct ProjectFile {
    pub path: String,
    pub bytes: Vec<u8>,
}

/// Something wrong with a project, and where.
#[derive(Clone, Debug)]
pub struct ProjectDiagnostic {
    /// The file's path within the project, or empty for a problem with the project as a whole.
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub span: TextSpan,
    pub is_error: bool,
    pub message: String,
}

/// A loaded project: its files bound together.
pub struct Project {
    pub compilation: Compilation,
    /// Each document's file path (project files) or framework path, by the compilation's document index.
    pub paths: Vec<String>,
    /// Each document's bytes, by the compilation's document index, for positions.
    pub sources: Vec<Vec<u8>>,
    pub game: Option<String>,
    pub diagnostics: Vec<ProjectDiagnostic>,
    /// The project's other files the host passed in (fonts), by path.
    pub assets: Vec<ProjectFile>,
}

impl Project {
    /// The project's own documents: its files, not the framework's.
    /// A file of the project that isn't Alex, by its path.
    pub fn asset(&self, path: &str) -> Option<&[u8]> {
        self.assets.iter().find(|f| f.path == path).map(|f| f.bytes.as_slice())
    }

    pub fn documents(&self) -> impl Iterator<Item = (usize, &BoundDocument)> {
        self.compilation.documents.iter().enumerate().filter(|(_, d)| !d.is_schema)
    }

    /// The document named `name` (the file's name up to its first dot).
    pub fn document(&self, name: &str) -> Option<(usize, &BoundDocument)> {
        self.documents().find(|(_, d)| d.name.as_deref() == Some(name))
    }

    /// The document a value is written in, by index, and its path from that document's root.
    pub fn locate(&self, value: ValueId) -> Option<(usize, Vec<String>)> {
        for (index, document) in self.compilation.documents.iter().enumerate() {
            if document.root == value {
                return Some((index, Vec::new()));
            }
            if let Some(path) = find_path(&self.compilation, document.root, value, &mut Vec::new(), &mut HashSet::new()) {
                return Some((index, path));
            }
        }
        None
    }
}

fn find_path(compilation: &Compilation, at: ValueId, wanted: ValueId, path: &mut Vec<String>, seen: &mut HashSet<ValueId>) -> Option<Vec<String>> {
    if !seen.insert(at) {
        return None;
    }
    match &compilation.model.values[at].kind {
        ValueKind::Object(object) => {
            for property in &object.properties {
                path.push(property.name.clone());
                if property.value == wanted {
                    return Some(path.clone());
                }
                if let Some(found) = find_path(compilation, property.value, wanted, path, seen) {
                    return Some(found);
                }
                path.pop();
            }
            None
        }
        ValueKind::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                path.push(i.to_string());
                if *item == wanted {
                    return Some(path.clone());
                }
                if let Some(found) = find_path(compilation, *item, wanted, path, seen) {
                    return Some(found);
                }
                path.pop();
            }
            None
        }
        _ => None,
    }
}

/// What a file says it is: the type its `#type` directive names, when it has one.
pub fn declared_type(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    for line in text.lines() {
        let line = line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() || line.starts_with("//") {
            continue;
        }
        return line.strip_prefix("#type ").map(|t| t.trim().to_string());
    }
    None
}

fn base_name(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    match file.find('.') {
        Some(dot) => file[..dot].to_string(),
        None => file.to_string(),
    }
}

/// The names a list of references in a document's own statement names: `uses = [@common, @units]`.
fn referenced_names(bytes: &[u8], field: &str) -> Vec<String> {
    let tree = parser::parse(bytes, ParseMode::Program);
    let mut names = Vec::new();
    for statement in &tree.root.statements {
        let Statement::Assignment { target, value: Value::List { items, .. }, .. } = statement else { continue };
        let segments: Vec<&[u8]> = target.segments.elements.iter().filter_map(|e| if let Element::Item(t) = e { Some(t.text(bytes)) } else { None }).collect();
        if segments != [field.as_bytes()] {
            continue;
        }
        for item in &items.elements {
            let Element::Item(Value::Reference { path, .. }) = item else { continue };
            let first = path.segments.elements.iter().find_map(|e| if let Element::Item(t) = e { Some(t.text(bytes)) } else { None });
            if let Some(first) = first {
                names.push(String::from_utf8_lossy(first).into_owned());
            }
        }
    }
    names
}

fn framework_file(path: &str) -> Option<&'static [u8]> {
    framework::FILES.iter().find(|(p, _)| *p == path).map(|(_, b)| *b)
}

/// The libraries `uses` names, with what each requires, transitively, in the framework's order.
fn used_libraries(uses: &[String]) -> Vec<String> {
    let mut used: HashSet<String> = HashSet::new();
    let mut pending: Vec<String> = uses.to_vec();
    while let Some(name) = pending.pop() {
        if !LIBRARIES.contains(&name.as_str()) || !used.insert(name.clone()) {
            continue;
        }
        if let Some(bytes) = framework_file(&format!("lib/{}.alex", name)) {
            pending.extend(referenced_names(bytes, "requires"));
        }
    }
    LIBRARIES.iter().filter(|l| used.contains(**l)).map(|l| l.to_string()).collect()
}

/// Loads a project from its files.
pub fn load(files: Vec<ProjectFile>) -> Project {
    let mut problems: Vec<ProjectDiagnostic> = Vec::new();
    let whole = |message: String| ProjectDiagnostic { file: String::new(), line: 0, column: 0, span: TextSpan::default(), is_error: true, message };

    let (alex, assets): (Vec<ProjectFile>, Vec<ProjectFile>) = files.into_iter().partition(|f| f.path.ends_with(".alex"));
    let mut seen_names: Vec<(String, String)> = Vec::new();
    for file in &alex {
        let name = base_name(&file.path);
        if let Some((_, first)) = seen_names.iter().find(|(n, _)| *n == name) {
            problems.push(whole(format!(
                "Two files are named {}.alex ({} and {}); a document's name is its file's name, so it must be unique.",
                name, first, file.path
            )));
        } else {
            seen_names.push((name, file.path.clone()));
        }
    }

    let games: Vec<&ProjectFile> = alex.iter().filter(|f| declared_type(&f.bytes).as_deref() == Some("Game")).collect();
    let game = match games.len() {
        1 => Some(base_name(&games[0].path)),
        0 => {
            problems.push(whole("No file in the project is a Game: one file starts '#type Game'.".to_string()));
            None
        }
        _ => {
            let listed: Vec<&str> = games.iter().map(|g| g.path.as_str()).collect();
            problems.push(whole(format!("A project holds exactly one Game; these are all Games: {}.", listed.join(", "))));
            None
        }
    };

    // The schemas: the core, and the libraries the game uses with what they require.
    let uses = if games.len() == 1 { referenced_names(&games[0].bytes, "uses") } else { Vec::new() };
    let libraries = used_libraries(&uses);
    let mut schemas: Vec<String> = vec!["core.alex".to_string()];
    if !libraries.is_empty() {
        schemas.push("core-operations.alex".to_string());
        schemas.extend(libraries.iter().map(|l| format!("lib/{}.alex", l)));
    }

    let mut sources: Vec<Source> = Vec::new();
    let mut paths: Vec<String> = Vec::new();
    let mut bytes: Vec<Vec<u8>> = Vec::new();
    for schema in &schemas {
        let content = framework_file(schema).unwrap_or_default().to_vec();
        sources.push(Source { name: schema.rsplit('/').next().unwrap().to_string(), bytes: content.clone(), role: Role::Schema, check_root_name: true });
        paths.push(format!("framework/{}", schema));
        bytes.push(content);
    }
    for file in &alex {
        let role = if declared_type(&file.bytes).as_deref() == Some("Rules") { Role::Any } else { Role::Data };
        let name = file.path.rsplit('/').next().unwrap().to_string();
        sources.push(Source { name, bytes: file.bytes.clone(), role, check_root_name: true });
        paths.push(file.path.clone());
        bytes.push(file.bytes.clone());
    }

    let host = CardEngineHost::new(game.as_deref().unwrap_or(""));
    let compilation = binder::bind(sources, &host, false);

    let mut diagnostics = problems;
    for (index, document) in compilation.documents.iter().enumerate() {
        let mut ordered = document.diagnostics.clone();
        ordered.sort_by(|a, b| a.span.start.cmp(&b.span.start).then(a.span.length.cmp(&b.span.length)).then(a.message.cmp(&b.message)));
        for diagnostic in ordered {
            let (line, column) = line_and_column(&bytes[index], diagnostic.span.start as usize);
            diagnostics.push(ProjectDiagnostic {
                file: paths[index].clone(),
                line,
                column,
                span: diagnostic.span,
                is_error: diagnostic.severity == Severity::Error,
                message: diagnostic.message,
            });
        }
    }

    Project { compilation, paths, sources: bytes, game, diagnostics, assets }
}

/// The one-based line and column of a byte offset, counting characters rather than bytes.
pub fn line_and_column(bytes: &[u8], offset: usize) -> (usize, usize) {
    let mut line = 1;
    let mut column = 1;
    for byte in &bytes[..offset.min(bytes.len())] {
        if *byte == b'\n' {
            line += 1;
            column = 1;
        } else if byte & 0xC0 != 0x80 {
            column += 1;
        }
    }
    (line, column)
}
