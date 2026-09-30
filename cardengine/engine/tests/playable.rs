//! Handlers are required only of the game's cards: those of the sets it lists and of `Cards` documents that aren't
//! drafts. A prototype set may have cards whose rules are not written yet; what isn't about playing is still checked.

use kardix::loader::project::{self, ProjectFile};

fn file(path: &str, text: &str) -> ProjectFile {
    ProjectFile { path: path.to_string(), bytes: text.as_bytes().to_vec() }
}

fn errors(sets: &str, cards: &str, draft: bool) -> Vec<String> {
    let project = project::load(vec![
        file("pocket.alex", &format!("#type Game

name = 'Pocket'
schema-version = 1
sets = [{}]
uses = [@common, @units, @spells, @combat]

type Creature : UnitCard {{}}
type Spell : SpellCard {{}}
", sets)),
        file("sets/first/first.alex", &format!("#type Set

id = 'first'
name = 'First'
cards = [
{}
]
", cards)),
        file("more.alex", &format!("#type Cards

draft = {}
cards = [
  hare = Creature {{ name = 'Hare', power = 1, text = 'Hello: Draw a card.' }}
]
", draft)),
        file("pocket-rules.alex", "#type Rules

@owl.on-enter = draw()
"),
    ]);
    project.diagnostics.iter().filter(|d| d.is_error).map(|d| format!("{}({},{}): {}", d.file, d.line, d.column, d.message)).collect()
}

const CARDS: &str = "  owl = Creature { name = 'Owl', power = 2, text = 'Hello: Draw a card.' }
  fox = Creature { name = 'Fox', power = 2, text = 'Hello: Draw a card.' }
  spark = Spell { name = 'Spark', text = 'Draw a card.' }";

#[test]
fn a_set_the_game_does_not_list_needs_no_handlers() {
    let found = errors("", CARDS, true);
    assert!(found.is_empty(), "{}", found.join("\n"));
}

#[test]
fn a_set_the_game_lists_needs_its_handlers() {
    let found = errors("@first", CARDS, true);
    assert!(found.iter().any(|e| e.contains("Fox has text, and no rules document gives it a handler")), "{}", found.join("\n"));
    assert!(found.iter().any(|e| e.contains("'spark' is a Spell, and a SpellCard requires 'on-play' (effect), which no program document assigns")), "{}", found.join("\n"));
    assert!(!found.iter().any(|e| e.contains("Owl")), "{}", found.join("\n"));
    assert!(!found.iter().any(|e| e.contains("Hare")), "{}", found.join("\n"));
}

#[test]
fn a_cards_document_that_is_not_a_draft_needs_its_handlers() {
    let found = errors("", CARDS, false);
    assert_eq!(found.len(), 1, "{}", found.join("\n"));
    assert!(found[0].contains("Hare has text, and no rules document gives it a handler"), "{}", found[0]);
}

#[test]
fn a_set_the_game_does_not_list_is_still_checked() {
    let found = errors("", "  owl = Creature { name = 'Owl', power = 2, text = 'Hello: Draw a card.', constants = [candles = 1] }", true);
    assert!(found.iter().any(|e| e.contains("candles")), "{}", found.join("\n"));
}
