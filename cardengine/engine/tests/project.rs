//! The loader loads real projects: Folkborn's game folder and the Hello TCG samples, from their files.

use std::fs;
use std::path::Path;

use tcg_engine::loader::project::{self, ProjectFile};
use tcg_engine::loader::queries;

fn folder(root: &Path) -> Vec<ProjectFile> {
    fn walk(root: &Path, at: &Path, files: &mut Vec<ProjectFile>) {
        for entry in fs::read_dir(at).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(root, &path, files);
            } else if path.extension().is_some_and(|e| e == "alex") {
                let relative = path.strip_prefix(root).unwrap().to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/");
                files.push(ProjectFile { path: relative, bytes: fs::read(&path).unwrap() });
            }
        }
    }
    let mut files = Vec::new();
    walk(root, root, &mut files);
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}

fn repository() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

#[test]
fn folkborn_loads_with_its_cards_and_brief() {
    let project = project::load(folder(&repository().join("games").join("folkborn")));
    assert_eq!(project.game.as_deref(), Some("folkborn"));
    let cards = queries::answer(&project, "cards");
    assert!(cards.contains("\"key\":\"mochi\""), "no Mochi card in {}", &cards[..cards.len().min(400)]);
    assert!(cards.contains("\"number\":\"DW1-D01\""), "no Domowiki card");
    let brief = queries::answer(&project, "value mochi-brief");
    assert!(brief.contains("\"$ref\":\"mochi.cards.mochi\""), "the brief's card isn't a reference: {}", &brief[..brief.len().min(600)]);
    assert!(brief.contains("\"file\":\"MC1-X01.webp\""));
}

#[test]
fn hello_tcg_loads_with_its_rules_attached() {
    let project = project::load(folder(&repository().join("cardengine").join("samples").join("hello-tcg")));
    assert_eq!(project.game.as_deref(), Some("hello-tcg"));
    let attached: usize = project.compilation.model.declarations.iter().map(|d| d.attachments.len()).sum();
    assert!(attached >= 3, "only {} handlers attached", attached);
}

#[test]
fn a_folder_without_a_game_says_so() {
    let project = project::load(vec![ProjectFile { path: "cards.alex".to_string(), bytes: b"#type Cards\n".to_vec() }]);
    assert!(project.diagnostics.iter().any(|d| d.message.starts_with("No file in the project is a Game")));
}
