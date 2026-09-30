//! What the runtime reads from a loaded game once, when a game starts: its zones, its cards and its decks. A game in
//! play refers to them by index; the project stays the source of everything else (a card's fields, its handlers).

use crate::alex::model::{Model, ValueId, ValueKind};
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
                cards.push(CardDef {
                    key: entry.name.clone(),
                    name: reader.text(card, "name").unwrap_or_else(|| entry.name.clone()),
                    types,
                    value: card,
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

        Ok(Catalog { game, zones, cards, decks })
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
