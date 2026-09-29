//! Both Hello TCG samples bind with the framework: their card types exist, and the finished game's rules attach to its
//! cards. Whether they bind exactly as the C# Alex binds them, diagnostics included, is `cardengine/conformance`'s
//! question; this is what `cargo test` alone can say.

use std::fs;
use std::path::{Path, PathBuf};

use kardix::alex::binder::{self, Role, Source};
use kardix::loader::card_engine::CardEngineHost;

fn files(folder: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    for entry in fs::read_dir(folder).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            found.extend(files(&path));
        } else if path.extension().is_some_and(|e| e == "alex") {
            found.push(path);
        }
    }
    found.sort();
    found
}

fn source(path: &Path, role: Role) -> Source {
    Source { name: path.file_name().unwrap().to_string_lossy().into_owned(), bytes: fs::read(path).unwrap(), role, check_root_name: true }
}

#[test]
fn the_samples_bind_with_the_framework_and_their_rules_attach() {
    let cardengine = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let framework = files(&cardengine.join("framework"));
    for sample in ["hello-tcg", "hello-tcg-print"] {
        let mut sources: Vec<Source> = framework.iter().map(|f| source(f, Role::Schema)).collect();
        for file in files(&cardengine.join("samples").join(sample)) {
            let role = if file.to_string_lossy().ends_with("-rules.alex") { Role::Any } else { Role::Data };
            sources.push(source(&file, role));
        }

        let compilation = binder::bind(sources, &CardEngineHost::new("hello-tcg"), false);
        assert!(compilation.types.iter().any(|(name, _)| name == "Creature"), "{}: no Creature type", sample);
        let attached: usize = compilation.model.declarations.iter().map(|d| d.attachments.len()).sum();
        if sample == "hello-tcg" {
            assert!(attached >= 3, "hello-tcg: only {} handlers attached to cards", attached);
        }
    }
}
