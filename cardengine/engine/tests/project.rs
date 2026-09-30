//! The loader loads projects from their files: Hello TCG, and a small game written here.

use std::fs;
use std::path::Path;

use kardix::alex::model::ValueKind;
use kardix::loader::project::{self, ProjectFile};
use kardix::loader::queries;

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

fn file(path: &str, text: &str) -> ProjectFile {
    ProjectFile { path: path.to_string(), bytes: text.as_bytes().to_vec() }
}

#[test]
fn a_game_its_cards_and_a_document_that_refers_to_them() {
    let project = project::load(vec![
        file("pocket.alex", "#type Game

name = 'Pocket'
sets = [@first]

type Creature : Card {
  number: text
  power: int
}
type Note {
  card: Card
  words: text
}
"),
        file("sets/first/first.alex", "#type Set

id = 'first'
name = 'First'
cards = [
  owl = Creature {
    name = 'Owl'
    number = 'P-1'
    power = 2
    text = @owl-text
  }
]

@@@ owl-text
Hello: Draw a card.
@@@
"),
        file("sets/first/notes.alex", "#type Note

card = @first.cards.owl
words = 'Keep the owl round.'
"),
    ]);
    assert_eq!(project.game.as_deref(), Some("pocket"));
    let errors: Vec<String> = project.diagnostics.iter().filter(|d| d.is_error).map(|d| format!("{}({},{}): {}", d.file, d.line, d.column, d.message)).collect();
    assert!(errors.iter().all(|e| e.contains("no rules document gives it a handler")), "{}", errors.join("
"));

    let cards = queries::answer(&project, "cards");
    assert!(cards.contains("\"key\":\"owl\"") && cards.contains("\"text\":\"Hello: Draw a card.\""), "{}", cards);
    let note = queries::answer(&project, "value notes");
    assert!(note.contains("\"card\":{\"$ref\":\"first.cards.owl\",\"$document\":\"first\",\"$path\":[\"cards\",\"owl\"]}"), "{}", note);
}

#[test]
fn an_error_names_its_file_line_and_column() {
    let project = project::load(vec![
        file("pocket.alex", "#type Game

name = 'Pocket'
"),
        file("extra.alex", "#type Set

id = 'x'
name = 'X'
nope = 1
"),
    ]);
    let found = project.diagnostics.iter().find(|d| d.message.starts_with("A Set has no field 'nope'")).expect("the unknown field");
    assert_eq!((found.file.as_str(), found.line, found.column), ("extra.alex", 5, 1));
}

#[test]
fn hello_tcg_loads_with_its_rules_attached() {
    let project = project::load(folder(&repository().join("cardengine").join("samples").join("hello-tcg")));
    assert_eq!(project.game.as_deref(), Some("hello-tcg"));
    let attached: usize = project.compilation.model.values.iter().filter_map(|v| match &v.kind {
        ValueKind::Object(o) => Some(o.extensions.len()),
        _ => None,
    }).sum();
    assert!(attached >= 3, "only {} handlers attached", attached);
}

#[test]
fn a_folder_without_a_game_says_so() {
    let project = project::load(vec![ProjectFile { path: "cards.alex".to_string(), bytes: b"#type Cards\n".to_vec() }]);
    assert!(project.diagnostics.iter().any(|d| d.message.starts_with("No file in the project is a Game")));
}

#[test]
fn a_games_own_set_type_is_a_set() {
    let project = project::load(vec![
        file("pocket.alex", "#type Game

name = 'Pocket'
sets = [@first]

type Colours { ink: text }
type ColourSet : Set { colours: Colours }
type Creature : Card { power: int }
"),
        file("first.alex", "#type ColourSet

id = 'first'
name = 'First'
colours = Colours { ink = '#2E1F5C' }
cards = [
  owl = Creature { name = 'Owl', power = 2 }
]
"),
    ]);
    let errors: Vec<&str> = project.diagnostics.iter().filter(|d| d.is_error).map(|d| d.message.as_str()).collect();
    assert!(errors.is_empty(), "{}", errors.join("\n"));
    let cards = queries::answer(&project, "cards");
    assert!(cards.contains("\"document\":\"first\",\"key\":\"owl\""), "{}", cards);
}
