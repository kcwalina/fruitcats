//! The log: the runtime's only output (`core-operations.alex` part 7). Each event says what happened, which rule
//! caused it, and, for each object it mentions, which seats may see which card that object is. A seat's log is the
//! events with what that seat may not see left out: a card drawn into the opponent's hand is "an object moved from
//! Deck/1 to Hand/1", with no card and no id, since an id seen once would follow the card.

use super::state::{Game, ObjectId, Seat, Setup};
use crate::loader::queries::string;

#[derive(Clone, Debug)]
pub struct Event {
    pub name: String,
    pub cause: Option<String>,
    pub fields: Vec<(String, Value)>,
    /// Who sees the event at all; none means everyone.
    pub only_to: Option<Vec<Seat>>,
}

#[derive(Clone, Debug)]
pub enum Value {
    Int(i64),
    Bool(bool),
    Text(String),
    Seat(Seat),
    Zone(String),
    Object(Mention),
    Objects(Vec<Mention>),
    Seats(Vec<Seat>),
}

/// An object as an event mentions it, with who may see which card it is.
#[derive(Clone, Debug)]
pub struct Mention {
    pub id: ObjectId,
    pub card: String,
    pub seen_by: Vec<bool>,
}

impl Game {
    /// An object as seen now, by each seat.
    pub fn mention(&self, object: ObjectId) -> Mention {
        Mention {
            id: object,
            card: self.card_key(object).to_string(),
            seen_by: (0..self.players.len()).map(|seat| self.sees(seat, object)).collect(),
        }
    }

    pub fn emit(&mut self, name: &str, fields: Vec<(&str, Value)>) {
        self.log.push(Event {
            name: name.to_string(),
            cause: self.cause.clone(),
            fields: fields.into_iter().map(|(k, v)| (k.to_string(), v)).collect(),
            only_to: None,
        });
    }

    pub(super) fn log_started(&mut self, setup: &Setup) {
        let decks: Vec<String> = setup.seats.iter().map(|s| s.deck.clone()).collect();
        self.emit(
            "game-started",
            vec![("game", Value::Text(self.catalog.game.clone())), ("seats", Value::Int(setup.seats.len() as i64)), ("decks", Value::Text(decks.join(",")))],
        );
    }

    /// The log from entry `from` on, as `seat` sees it (`None`: everything, for a replay or a judge), as JSON lines.
    pub fn log_json(&self, seat: Option<Seat>, from: usize) -> String {
        let mut out = String::new();
        for (index, event) in self.log.iter().enumerate().skip(from) {
            if let (Some(seat), Some(only)) = (seat, &event.only_to) {
                if !only.contains(&seat) {
                    continue;
                }
            }
            out.push_str(&event_json(index, event, seat));
            out.push('\n');
        }
        out
    }
}

fn event_json(index: usize, event: &Event, seat: Option<Seat>) -> String {
    let mut out = format!("{{\"n\":{},\"event\":{}", index, string(&event.name));
    for (name, value) in &event.fields {
        out.push(',');
        out.push_str(&string(name));
        out.push(':');
        out.push_str(&value_json(value, seat));
    }
    if let Some(cause) = &event.cause {
        out.push_str(",\"cause\":");
        out.push_str(&string(cause));
    }
    out.push('}');
    out
}

fn value_json(value: &Value, seat: Option<Seat>) -> String {
    match value {
        Value::Int(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Text(t) | Value::Zone(t) => string(t),
        Value::Seat(s) => s.to_string(),
        Value::Seats(list) => format!("[{}]", list.iter().map(|s| s.to_string()).collect::<Vec<_>>().join(",")),
        Value::Object(m) => mention_json(m, seat),
        Value::Objects(list) => format!("[{}]", list.iter().map(|m| mention_json(m, seat)).collect::<Vec<_>>().join(",")),
    }
}

fn mention_json(mention: &Mention, seat: Option<Seat>) -> String {
    let sees = seat.is_none_or(|s| mention.seen_by.get(s).copied().unwrap_or(false));
    if sees {
        format!("{{\"id\":{},\"card\":{}}}", mention.id, string(&mention.card))
    } else {
        "{\"hidden\":true}".to_string()
    }
}
