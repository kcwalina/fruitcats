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
