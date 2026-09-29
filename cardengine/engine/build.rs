//! Embeds the card-engine framework (`cardengine/framework/`: the core and its libraries) in the module, so the core
//! loads a game with nothing from outside it. The files are listed by name in `framework.rs` in the build's output.

use std::fs;
use std::path::Path;

fn main() {
    let framework = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("framework");
    let mut files: Vec<(String, String)> = Vec::new();
    collect(&framework, &framework, &mut files);
    files.sort();

    let mut source = String::from("/// The framework's files: (the path within cardengine/framework, its bytes).\npub static FILES: &[(&str, &[u8])] = &[\n");
    for (name, path) in &files {
        source.push_str(&format!("    ({:?}, include_bytes!({:?})),\n", name, path));
    }
    source.push_str("];\n");
    let out = Path::new(&std::env::var("OUT_DIR").unwrap()).join("framework.rs");
    fs::write(out, source).unwrap();
    println!("cargo:rerun-if-changed={}", framework.display());
}

fn collect(root: &Path, folder: &Path, files: &mut Vec<(String, String)>) {
    for entry in fs::read_dir(folder).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            collect(root, &path, files);
        } else if path.extension().is_some_and(|e| e == "alex") {
            let name = path.strip_prefix(root).unwrap().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
            println!("cargo:rerun-if-changed={}", path.display());
            files.push((name, path.canonicalize().unwrap().to_string_lossy().into_owned()));
        }
    }
}
