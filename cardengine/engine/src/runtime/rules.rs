//! The game's handlers, found once when a game starts. A handler is data (docs/tcg/library-rules-on-paper.md): an
//! effect record, a list of them, or a formula, set on a card face's or a keyword's slot by a rules file
//! (`@klobuk.on-enter = Draw()`). The runtime keeps the bound model they are values in, and the rules files' text a
//! formula's tokens point into, so a game in play needs nothing else from the project.

use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;

use crate::alex::model::{Model, ValueId, ValueKind};
use crate::loader::project::Project;

#[derive(Clone)]
pub struct Handlers {
    pub model: Rc<Model>,
    /// Each document's text, by its index in the compilation: what a formula's tokens are read from.
    pub sources: Rc<Vec<Vec<u8>>>,
    /// The handler on a slot of a value (a card face, a keyword): `(its value, "on-enter")`.
    pub slots: HashMap<(ValueId, String), ValueId>,
    /// The effects and formulas rules files name in their `values` (`@sprout`, `@is-well-fed`).
    pub named: BTreeMap<String, ValueId>,
}

impl std::fmt::Debug for Handlers {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Handlers({} slots, {} named)", self.slots.len(), self.named.len())
    }
}

impl Default for Handlers {
    fn default() -> Handlers {
        Handlers { model: Rc::new(Model::default()), sources: Rc::new(Vec::new()), slots: HashMap::new(), named: BTreeMap::new() }
    }
}

impl Handlers {
    pub fn read(project: &Project) -> Handlers {
        let model = &project.compilation.model;
        let mut slots = HashMap::new();
        for (id, value) in model.values.iter().enumerate() {
            if let ValueKind::Object(object) = &value.kind {
                for (member, handler) in &object.extensions {
                    slots.insert((id, member.clone()), *handler);
                }
            }
        }
        let mut named = BTreeMap::new();
        for (_, document) in project.documents() {
            let Some(root) = model.object(document.root) else { continue };
            if root.type_name.as_deref() != Some("Rules") {
                continue;
            }
            let Some(values) = root.get("values").and_then(|p| model.object(p.value)) else { continue };
            for entry in &values.properties {
                named.insert(entry.name.clone(), entry.value);
            }
        }
        Handlers { model: Rc::new(model.clone()), sources: Rc::new(project.sources.clone()), slots, named }
    }

    pub fn attached(&self, value: ValueId, slot: &str) -> Option<ValueId> {
        self.slots.get(&(value, slot.to_string())).copied()
    }
}
