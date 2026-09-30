//! Alex as a data language (cardengine/decisions.md, "Alex is a purely data modelling language"): a record written as a
//! constructor call.

use kardix::alex::binder::{self, Compilation, Role, Source};
use kardix::alex::host::KindsHost;
use kardix::alex::model::ValueKind;

fn bind(schema: &str, data: &str) -> Compilation {
    let sources = vec![
        Source { name: "schema.alex".to_string(), bytes: schema.as_bytes().to_vec(), role: Role::Schema, check_root_name: true },
        Source { name: "data.alex".to_string(), bytes: data.as_bytes().to_vec(), role: Role::Data, check_root_name: true },
    ];
    binder::bind(sources, &KindsHost { kinds: Vec::new(), routines: Vec::new() }, false)
}

fn errors(compilation: &Compilation) -> Vec<String> {
    compilation.documents.iter().flat_map(|d| d.diagnostics.iter().map(|x| x.message.clone())).collect()
}

/// The fields of the record `name` in the data document, as `field=value`.
fn fields(compilation: &Compilation, name: &str) -> Vec<String> {
    let model = &compilation.model;
    let root = compilation.documents.iter().find(|d| !d.is_schema).unwrap().root;
    let value = model.object(root).unwrap().get(name).unwrap().value;
    let record = model.object(value).unwrap();
    record
        .properties
        .iter()
        .filter(|p| !p.is_default)
        .map(|p| {
            let shown = match &model.values[p.value].kind {
                ValueKind::Integer(n) => n.to_string(),
                ValueKind::String(t) => t.clone(),
                ValueKind::Object(o) => o.type_name.clone().unwrap_or_default(),
                other => format!("{:?}", other),
            };
            format!("{}={}", p.name, shown)
        })
        .collect()
}

const SCHEMA: &str = "#type Schema

type Schema { hit: Damage?, heal: Damage?, target: Choose? }
type Effect { only-if: text? }
type Damage : Effect { amount: int, target: Choose? }
type Choose { from: text, filter: text? }
";

#[test]
fn a_construction_fills_fields_in_the_order_the_type_declares_them() {
    let compilation = bind(SCHEMA, "#type Schema\n\nhit = Damage(3, target: Choose('all'))\n");
    assert_eq!(errors(&compilation), Vec::<String>::new());
    assert_eq!(fields(&compilation, "hit"), ["amount=3", "target=Choose"]);
}

#[test]
fn unnamed_arguments_fill_the_types_own_fields_first_then_its_bases() {
    let compilation = bind(SCHEMA, "#type Schema\n\nhit = Damage(3, Choose('own', 'exhausted'), 'x')\n");
    assert_eq!(errors(&compilation), Vec::<String>::new());
    assert_eq!(fields(&compilation, "hit"), ["amount=3", "target=Choose", "only-if=x"]);
}

#[test]
fn a_construction_and_a_record_are_the_same_record() {
    let compilation = bind(SCHEMA, "#type Schema\n\nhit = Damage(3, target: Choose('all'))\nheal = Damage { amount = 3, target = Choose { from = 'all' } }\n");
    assert_eq!(errors(&compilation), Vec::<String>::new());
    assert_eq!(fields(&compilation, "hit"), fields(&compilation, "heal"));
}

#[test]
fn a_construction_with_no_arguments_is_a_record_with_nothing_set() {
    let compilation = bind("#type Schema\n\ntype Schema { draw: Draw? }\ntype Draw { count: int = 1 }\n", "#type Schema\n\ndraw = Draw()\n");
    assert_eq!(errors(&compilation), Vec::<String>::new());
}

#[test]
fn an_unnamed_argument_after_a_named_one_is_an_error() {
    let compilation = bind(SCHEMA, "#type Schema\n\nhit = Damage(target: Choose('all'), 3)\n");
    assert!(errors(&compilation).iter().any(|e| e.contains("An argument without a name comes before the named ones")), "{:?}", errors(&compilation));
}

#[test]
fn too_many_unnamed_arguments_are_an_error() {
    let compilation = bind(SCHEMA, "#type Schema\n\ntarget = Choose('all', 'ready', 'extra')\n");
    assert!(errors(&compilation).iter().any(|e| e.contains("has no field left for this argument")), "{:?}", errors(&compilation));
}

#[test]
fn a_named_argument_the_type_lacks_is_an_error_as_in_a_record() {
    let compilation = bind(SCHEMA, "#type Schema\n\nhit = Damage(3, power: 2)\n");
    assert!(errors(&compilation).iter().any(|e| e.contains("has no field 'power'")), "{:?}", errors(&compilation));
}

// ── formulas ─────────────────────────────────────────────────────────────────────────────────────

const RULES: &str = "#type Schema

type Schema { awaken: formula?, hit: Damage?, name: text?, pick: Choose? }
type Effect { only-if: formula? }
type Damage : Effect { amount: int | formula, target: Choose | formula | nic }
type Choose { from: formula, filter: formula? }
";

fn kind(compilation: &Compilation, name: &str) -> String {
    let model = &compilation.model;
    let root = compilation.documents.iter().find(|d| !d.is_schema).unwrap().root;
    let value = model.object(root).unwrap().get(name).unwrap().value;
    match &model.values[value].kind {
        ValueKind::Formula { .. } => "formula".to_string(),
        other => format!("{:?}", other).split([' ', '(', '{']).next().unwrap().to_string(),
    }
}

#[test]
fn a_formula_is_the_value_of_a_formula_field() {
    let compilation = bind(RULES, "#type Schema\n\nawaken = units(own).count >= card.units\n");
    assert_eq!(errors(&compilation), Vec::<String>::new());
    assert_eq!(kind(&compilation, "awaken"), "formula");
}

#[test]
fn a_formula_chooses_a_value_with_if_then_else() {
    let compilation = bind(RULES, "#type Schema\n\nhit = Damage(if @x then card.company-damage else card.damage, target: Choose(all))\n");
    assert!(errors(&compilation).iter().all(|e| e.contains("'x'") || e.contains("@x")), "{:?}", errors(&compilation));
}

#[test]
fn then_and_else_may_start_their_own_lines() {
    let compilation = bind(RULES, "#type Schema\n\nawaken = if not attacker.is-unit then false\n  else if this.ready then true\n  else false\n");
    assert_eq!(errors(&compilation), Vec::<String>::new());
    assert_eq!(kind(&compilation, "awaken"), "formula");
}

#[test]
fn a_formula_field_takes_a_bare_word_a_number_or_a_formula() {
    let compilation = bind(RULES, "#type Schema\n\npick = Choose(own, filter: exhausted)\nhit = Damage(3, only-if: own.played-this-round <= card.others + 1)\n");
    assert_eq!(errors(&compilation), Vec::<String>::new());
}

#[test]
fn a_formula_anywhere_else_is_an_error() {
    let compilation = bind(RULES, "#type Schema\n\nname = card.name\n");
    assert!(errors(&compilation).iter().any(|e| e.contains("only a field whose type is formula holds one")), "{:?}", errors(&compilation));
}

#[test]
fn a_plain_value_stays_a_plain_value() {
    let compilation = bind(RULES, "#type Schema\n\nname = 'Kłobuk'\n");
    assert_eq!(errors(&compilation), Vec::<String>::new());
    assert_eq!(kind(&compilation, "name"), "String");
}

// ── several bases ────────────────────────────────────────────────────────────────────────────────

const CARDS: &str = "#type Schema

type Schema { cards: [text: Card] = empty }
type Card { name: text? }
type Printed : Card { number: text, rarity: text? }
type UnitCard : Card { cost: int | formula | nic, power: int, health: int? }
type Creature : Printed, UnitCard { cost: int, health: int }
";

#[test]
fn a_type_has_every_field_of_every_base() {
    let compilation = bind(CARDS, "#type Schema\n\ncards = [\n  klobuk = Creature { name = 'Kłobuk', number = 'DW1-D18', cost = 3, power = 2, health = 3 }\n]\n");
    assert_eq!(errors(&compilation), Vec::<String>::new());
}

#[test]
fn a_type_is_each_of_its_bases() {
    let compilation = bind(CARDS, "#type Schema\n\ncards = []\n");
    let model = &compilation.model;
    let find = |name: &str| compilation.types.iter().find(|(n, _)| n == name).unwrap().1;
    let creature = find("Creature");
    assert!(model.is_or_extends(creature, find("Printed")));
    assert!(model.is_or_extends(creature, find("UnitCard")));
    assert!(model.is_or_extends(creature, find("Card")));
    let names: Vec<&str> = model.chain(creature).iter().map(|t| model.record_name(*t)).collect();
    assert_eq!(names, ["Creature", "Printed", "Card", "UnitCard"], "each once, the first base's chain first");
}

#[test]
fn a_field_the_type_lacks_is_still_an_error() {
    let compilation = bind(CARDS, "#type Schema\n\ncards = [\n  klobuk = Creature { number = 'x', cost = 3, power = 2, health = 3, flavor = 'hi' }\n]\n");
    assert!(errors(&compilation).iter().any(|e| e.contains("has no field 'flavor'")), "{:?}", errors(&compilation));
}

#[test]
fn a_type_may_narrow_an_inherited_field_but_not_change_it() {
    let schema = "#type Schema\n\ntype Schema { cards: [text: Card] = empty }\ntype Card { name: text? }\ntype UnitCard : Card { power: int }\ntype Odd : Card, UnitCard { power: text }\n";
    let compilation = bind(schema, "#type Schema\n\ncards = []\n");
    assert!(errors(&compilation).iter().any(|e| e.contains("may narrow an inherited field's type, not change it")), "{:?}", errors(&compilation));
}

#[test]
fn two_bases_that_disagree_about_a_field_are_an_error() {
    let schema = "#type Schema\n\ntype Schema { cards: [text: Card] = empty }\ntype Card {}\ntype A : Card { size: int }\ntype B : Card { size: text }\ntype Both : A, B {}\n";
    let compilation = bind(schema, "#type Schema\n\ncards = []\n");
    assert!(errors(&compilation).iter().any(|e| e.contains("both declare 'size'")), "{:?}", errors(&compilation));
}

#[test]
fn bases_that_extend_each_other_in_a_circle_are_an_error() {
    let schema = "#type Schema\n\ntype Schema { cards: [text: A] = empty }\ntype A : B {}\ntype B : C, A {}\ntype C {}\n";
    let compilation = bind(schema, "#type Schema\n\ncards = []\n");
    assert!(errors(&compilation).iter().any(|e| e.contains("extends itself through its bases")), "{:?}", errors(&compilation));
}
