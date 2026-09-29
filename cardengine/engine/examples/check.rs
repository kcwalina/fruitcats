//! Loads a game's folder with the core and prints what is wrong with it: `cargo run --release --example check -- <folder>`.
//! With a question after the folder (`cards`, `value <document>`), prints the core's answer instead.
//! What `kardix check` will say once kardix runs the core (Stage 2 of docs/tcg/tcg-developer-platform.md).

use std::fs;
use std::path::Path;

use kardix::loader::project::{self, ProjectFile};
use kardix::loader::queries;

fn main() {
    let folder = std::env::args().nth(1).unwrap_or_else(|| ".".to_string());
    let root = Path::new(&folder);
    let mut files = Vec::new();
    collect(root, root, &mut files);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let loaded = project::load(files);
    let question: Vec<String> = std::env::args().skip(2).collect();
    if !question.is_empty() {
        println!("{}", queries::answer(&loaded, &question.join(" ")));
        return;
    }
    for d in &loaded.diagnostics {
        let place = if d.file.is_empty() { String::new() } else { format!("{}({},{}): ", d.file, d.line, d.column) };
        println!("{}{}: {}", place, if d.is_error { "error" } else { "warning" }, d.message);
    }
    println!("{} problem(s); game {}", loaded.diagnostics.len(), loaded.game.as_deref().unwrap_or("none"));
}

fn collect(root: &Path, at: &Path, files: &mut Vec<ProjectFile>) {
    for entry in fs::read_dir(at).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect(root, &path, files);
        } else if path.extension().is_some_and(|e| e == "alex") {
            let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
            files.push(ProjectFile { path: relative, bytes: fs::read(&path).unwrap() });
        }
    }
}
