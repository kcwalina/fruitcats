//! Behaviour on a keyword: a keyword has a unit's slots, a set's keywords are words in handlers,
//! text made only of keywords needs no handler, and a card's constants stay the card's.

use kardix::loader::project::{self, ProjectFile};

fn file(path: &str, text: &str) -> ProjectFile {
    ProjectFile { path: path.to_string(), bytes: text.as_bytes().to_vec() }
}

fn errors(rules: &str, cards: &str) -> Vec<String> {
    let project = project::load(vec![
        file("pocket.alex", "#type Game

name = 'Pocket'
schema-version = 1
sets = [@first]
uses = [@common, @units, @combat, @turns]
keywords = [
  Guardian = Keyword {}
  Tough = Keyword {}
]
constants = [candles = 6]

type Creature : UnitCard {}
"),
        file("sets/first/first.alex", &format!("#type Set

id = 'first'
name = 'First'
keywords = [
  nimble-footed = Keyword {{ name = 'Nimble-Footed' }}
]
cards = [
{}
]
", cards)),
        file("first-rules.alex", &format!("#type Rules

{}
", rules)),
    ]);
    project.diagnostics.iter().filter(|d| d.is_error).map(|d| format!("{}({},{}): {}", d.file, d.line, d.column, d.message)).collect()
}

const OWL: &str = "  owl = Creature {
    name = 'Owl', power = 2
    text = 'Hello: Deal {candles} damage to a unit.'
    constants = [candles = 1]
  }";

#[test]
fn a_keyword_has_a_units_slots() {
    let found = errors(
        "@nimble-footed.on-defeated = Draw()
@nimble-footed.on-defeats-in-combat = Ready()
@owl.on-enter = Damage(card.candles, target: Choose(all))",
        OWL,
    );
    assert!(found.is_empty(), "{}", found.join("\n"));
}

#[test]
fn a_sets_keyword_is_a_word_in_a_handler() {
    let found = errors(
        "@owl.static = Grant(units(own), keywords: [@nimble-footed])",
        "  owl = Creature { name = 'Owl', power = 2, text = 'Your units have Nimble-Footed.' }",
    );
    assert!(found.is_empty(), "{}", found.join("\n"));
}

#[test]
fn once_per_round_is_a_field_of_every_effect() {
    let found = errors(
        "@owl.on-defeats-in-combat = Ready(once-per-round: true)",
        "  owl = Creature { name = 'Owl', power = 2, text = 'Once per round, after Owl defeats a unit in combat, ready it.' }",
    );
    assert!(found.is_empty(), "{}", found.join("\n"));
}

#[test]
fn text_made_only_of_keywords_needs_no_handler() {
    let found = errors(
        "",
        "  bear = Creature {
    name = 'Bear', power = 3
    keywords = [@Guardian, Applied { keyword = @Tough, n = 1 }]
    text = 'Guardian. Tough 1.'
  }
  frog = Creature {
    name = 'Frog', power = 1
    keywords = [@nimble-footed]
    text = 'Nimble-Footed.'
  }
  fox = Creature {
    name = 'Fox', power = 2
    keywords = [@Guardian]
    text = 'Guardian. Hello: Draw a card.'
  }
  hare = Creature {
    name = 'Hare', power = 1
    text = 'Guardian.'
  }",
    );
    assert!(found.iter().any(|e| e.contains("Fox has text, and no rules document gives it a handler")), "{}", found.join("\n"));
    assert!(found.iter().any(|e| e.contains("Hare has text, and no rules document gives it a handler")), "{}", found.join("\n"));
    assert_eq!(found.len(), 2, "{}", found.join("\n"));
}

#[test]
fn a_cards_constants_are_not_the_games() {
    let found = errors("@owl.on-enter = choose(all).damage(@candles)", OWL);
    assert!(found.is_empty(), "{}", found.join("\n"));
}
