//! What the runtime reads from a loaded game once, when a game starts: its zones, its cards and its decks. A game in
//! play refers to them by index; the project stays the source of everything else (a card's fields, its handlers).

use std::collections::BTreeMap;

use crate::alex::model::{Model, TypeKind, ValueId, ValueKind};
use crate::loader::project::Project;
use crate::loader::queries::is_a;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Visibility {
    None,
    Owner,
    All,
    TopCard,
}

#[derive(Clone, Debug)]
pub struct ZoneDef {
    pub name: String,
    pub role: String,
    pub shape: String,
    pub visible: Visibility,
    pub face_down: bool,
    /// One zone for everyone, instead of one per player.
    pub shared: bool,
}

#[derive(Clone, Debug)]
pub struct CardDef {
    /// The card's key: unique in the game, since a game's cards share one namespace.
    pub key: String,
    pub name: String,
    /// Its type and the types it derives from, most derived first (`Creature`, `Printed`, `Card`).
    pub types: Vec<String>,
    pub value: ValueId,
    /// Its faces: the front, and a back (a Hero's Awakened side) when it has one.
    pub faces: Vec<FaceDef>,
}

/// What a handler reads from the face it is attached to: its constants (`card.damage`) and its numbers (`power`).
#[derive(Clone, Debug, Default)]
pub struct FaceDef {
    pub value: ValueId,
    pub constants: BTreeMap<String, i64>,
    pub numbers: BTreeMap<String, i64>,
    /// Its keywords, by key (`Guardian`, `pearl-tears`), with a number for one like `Tough 1`.
    pub keywords: Vec<(String, Option<i64>)>,
}

#[derive(Clone, Debug)]
pub struct DeckDef {
    pub key: String,
    pub name: String,
    pub hero: Option<usize>,
    /// Each card and how many copies.
    pub cards: Vec<(usize, u32)>,
}

#[derive(Clone, Debug)]
pub struct Catalog {
    pub game: String,
    pub zones: Vec<ZoneDef>,
    pub cards: Vec<CardDef>,
    pub decks: Vec<DeckDef>,
    /// The game's constants (`@starting-life`).
    pub constants: BTreeMap<String, i64>,
    /// The card types the game maps onto the units library's record (`UnitCards { types = [@Creature] }`).
    pub unit_types: Vec<String>,
    /// Words that stand for numbers: the members of number-backed enums (`one`, `two`).
    pub numbers: BTreeMap<String, i64>,
    pub handlers: super::rules::Handlers,
}

impl Catalog {
    pub fn read(project: &Project) -> Result<Catalog, String> {
        let model = &project.compilation.model;
        let game = project.game.clone().ok_or("The project has no Game.")?;
        let (_, game_doc) = project.document(&game).ok_or("The project has no Game.")?;
        let root = game_doc.root;
        let reader = Reader { model };

        let mut zones = Vec::new();
        if let Some(map) = reader.field(root, "zones").and_then(|v| model.object(v)) {
            for entry in &map.properties {
                let zone = final_target(model, entry.value);
                zones.push(ZoneDef {
                    name: reader.text(zone, "name").unwrap_or_else(|| entry.name.clone()),
                    role: reader.word(zone, "role").unwrap_or_else(|| "other".to_string()),
                    shape: reader.word(zone, "shape").unwrap_or_else(|| "pile".to_string()),
                    visible: match reader.word(zone, "visible").as_deref() {
                        Some("none") => Visibility::None,
                        Some("owner") => Visibility::Owner,
                        Some("top-card") => Visibility::TopCard,
                        _ => Visibility::All,
                    },
                    face_down: reader.boolean(zone, "face-down").unwrap_or(false),
                    shared: reader.boolean(zone, "shared").unwrap_or(false),
                });
            }
        }

        // The documents whose cards are the game's: the sets it lists, and every Cards document that isn't a draft.
        let mut documents: Vec<ValueId> = Vec::new();
        if let Some(sets) = reader.field(root, "sets").and_then(|v| reader.array(v)) {
            documents.extend(sets.into_iter().map(|s| final_target(model, s)));
        }
        for (_, document) in project.documents() {
            let record = model.object(document.root).and_then(|o| o.record_type);
            if is_a(project, record, "Cards") && reader.boolean(document.root, "draft") != Some(true) && !documents.contains(&document.root) {
                documents.push(document.root);
            }
        }

        let mut cards: Vec<CardDef> = Vec::new();
        for &document in &documents {
            let Some(map) = reader.field(document, "cards").and_then(|v| model.object(v)) else { continue };
            for entry in &map.properties {
                let card = final_target(model, entry.value);
                let Some(object) = model.object(card) else { continue };
                let mut types = Vec::new();
                let mut current = object.record_type;
                while let Some(t) = current {
                    let Some(record) = model.record(t) else { break };
                    types.push(record.name.clone());
                    current = record.base;
                }
                let mut faces = vec![reader.face(card)];
                if let Some(back) = reader.field(card, "back").filter(|b| model.object(*b).is_some()) {
                    faces.push(reader.face(back));
                }
                cards.push(CardDef {
                    key: entry.name.clone(),
                    name: reader.text(card, "name").unwrap_or_else(|| entry.name.clone()),
                    types,
                    value: card,
                    faces,
                });
            }
        }

        let mut decks = Vec::new();
        for &document in &documents {
            let Some(map) = reader.field(document, "decks").and_then(|v| model.object(v)) else { continue };
            for entry in &map.properties {
                let deck = final_target(model, entry.value);
                let card_index = |value: ValueId| cards.iter().position(|c| c.value == final_target(model, value));
                let hero = reader.field(deck, "hero").and_then(card_index);
                let mut list = Vec::new();
                for pair in reader.field(deck, "cards").and_then(|v| reader.array(v)).unwrap_or_default() {
                    let items = reader.array(pair).unwrap_or_default();
                    let (Some(&card), Some(&count)) = (items.first(), items.get(1)) else { continue };
                    let Some(index) = card_index(card) else {
                        return Err(format!("The deck {} lists a card that isn't one of the game's.", entry.name));
                    };
                    let count = match model.values[final_target(model, count)].kind {
                        ValueKind::Integer(n) if n >= 0 => n as u32,
                        _ => return Err(format!("The deck {} gives a card a count that isn't a number.", entry.name)),
                    };
                    list.push((index, count));
                }
                decks.push(DeckDef { key: entry.name.clone(), name: reader.text(deck, "name").unwrap_or_else(|| entry.name.clone()), hero, cards: list });
            }
        }

        let mut constants = BTreeMap::new();
        if let Some(map) = reader.field(root, "constants").and_then(|v| model.object(v)) {
            for entry in &map.properties {
                if let ValueKind::Integer(n) = model.values[final_target(model, entry.value)].kind {
                    constants.insert(entry.name.clone(), n);
                }
            }
        }

        let mut unit_types = Vec::new();
        for rule in reader.field(root, "units").and_then(|v| reader.array(v)).unwrap_or_default() {
            let rule = final_target(model, rule);
            if model.object(rule).and_then(|o| o.type_name.as_deref()) != Some("UnitCards") {
                continue;
            }
            for t in reader.field(rule, "types").and_then(|v| reader.array(v)).unwrap_or_default() {
                if let ValueKind::TypeValue(t) = model.values[final_target(model, t)].kind {
                    unit_types.push(model.record_name(t).to_string());
                }
            }
        }

        let mut numbers = BTreeMap::new();
        for t in &model.types {
            if let TypeKind::Enum { backing: Some(backing), .. } = &t.kind {
                for (member, value) in &backing.values {
                    if let ValueKind::Integer(n) = model.values[*value].kind {
                        numbers.insert(member.clone(), n);
                    }
                }
            }
        }

        let handlers = super::rules::Handlers::read(project);
        Ok(Catalog { game, zones, cards, decks, constants, unit_types, numbers, handlers })
    }

    pub fn deck(&self, key: &str) -> Option<usize> {
        self.decks.iter().position(|d| d.key == key)
    }

    pub fn zone(&self, name: &str) -> Option<usize> {
        self.zones.iter().position(|z| z.name == name)
    }

    /// The first zone with this role (`deck`, `hand`, `discard`…), as a library finds a game's deck without a parameter.
    pub fn zone_with_role(&self, role: &str) -> Option<usize> {
        self.zones.iter().position(|z| z.role == role)
    }

    pub fn card(&self, key: &str) -> Option<usize> {
        self.cards.iter().position(|c| c.key == key)
    }

    /// Whether a card is a unit: its type, or one it derives from, is a type the game maps onto units.
    pub fn is_unit(&self, card: usize) -> bool {
        self.cards[card].types.iter().any(|t| self.unit_types.contains(t))
    }
}

/// Reads fields of bound values, with each field's schema default when the value doesn't set it.
struct Reader<'m> {
    model: &'m Model,
}

impl Reader<'_> {
    fn field(&self, object: ValueId, name: &str) -> Option<ValueId> {
        let found = self.model.object(object)?;
        let value = match found.get(name) {
            Some(property) => property.value,
            None => {
                let field = self.model.field_of(found.record_type?, name)?;
                self.model.fields[field].default?
            }
        };
        let value = final_target(self.model, value);
        match self.model.values[value].kind {
            ValueKind::Nic | ValueKind::Invalid => None,
            _ => Some(value),
        }
    }

    fn text(&self, object: ValueId, name: &str) -> Option<String> {
        match &self.model.values[self.field(object, name)?].kind {
            ValueKind::String(s) | ValueKind::Text(s) => Some(s.clone()),
            _ => None,
        }
    }

    fn word(&self, object: ValueId, name: &str) -> Option<String> {
        match &self.model.values[self.field(object, name)?].kind {
            ValueKind::Enum { member, .. } => Some(member.clone()),
            ValueKind::String(s) => Some(s.clone()),
            _ => None,
        }
    }

    fn boolean(&self, object: ValueId, name: &str) -> Option<bool> {
        match self.model.values[self.field(object, name)?].kind {
            ValueKind::Boolean(b) => Some(b),
            _ => None,
        }
    }

    fn face(&self, value: ValueId) -> FaceDef {
        let mut face = FaceDef { value, ..Default::default() };
        if let Some(map) = self.field(value, "constants").and_then(|v| self.model.object(v)) {
            for entry in &map.properties {
                if let ValueKind::Integer(n) = self.model.values[final_target(self.model, entry.value)].kind {
                    face.constants.insert(entry.name.clone(), n);
                }
            }
        }
        if let Some(object) = self.model.object(value) {
            for property in &object.properties {
                if let ValueKind::Integer(n) = self.model.values[final_target(self.model, property.value)].kind {
                    face.numbers.insert(property.name.clone(), n);
                }
            }
        }
        for raw in self.field(value, "keywords").and_then(|v| self.array(v)).unwrap_or_default() {
            let keyword = final_target(self.model, raw);
            match self.model.object(keyword) {
                Some(applied) if applied.type_name.as_deref() == Some("Applied") => {
                    let name = applied.get("keyword").map(|p| self.key_of(p.value)).unwrap_or_default();
                    let n = applied.get("n").and_then(|p| match self.model.values[final_target(self.model, p.value)].kind {
                        ValueKind::Integer(n) => Some(n),
                        _ => None,
                    });
                    face.keywords.push((name, n));
                }
                _ => face.keywords.push((self.key_of(raw), None)),
            }
        }
        face
    }

    /// A keyword's key: the last name of the reference to it, as the game's files write it (`@pearl-tears`).
    fn key_of(&self, value: ValueId) -> String {
        match &self.model.values[value].kind {
            ValueKind::Reference { path, .. } => path.last().cloned().unwrap_or_default(),
            _ => self.model.object(final_target(self.model, value)).and_then(|o| o.get("name")).and_then(|p| match &self.model.values[p.value].kind {
                ValueKind::String(s) => Some(s.clone()),
                _ => None,
            }).unwrap_or_default(),
        }
    }

    fn array(&self, value: ValueId) -> Option<Vec<ValueId>> {
        match &self.model.values[final_target(self.model, value)].kind {
            ValueKind::Array(items) => Some(items.clone()),
            ValueKind::Empty => Some(Vec::new()),
            _ => None,
        }
    }
}

fn final_target(model: &Model, value: ValueId) -> ValueId {
    let mut current = value;
    for _ in 0..64 {
        match &model.values[current].kind {
            ValueKind::Reference { target: Some(t), .. } => current = *t,
            _ => break,
        }
    }
    current
}
