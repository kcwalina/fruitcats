//! A game in play: the state model of `core-operations.alex` part 1. Objects, players, zones and the game's own
//! counters and flags, plus the random generator and the log. It is plain data: a clone is an independent game, which
//! is what a bot searches with. It changes only through the operations (`ops.rs`).

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;

use super::catalog::Catalog;
use super::log::Event;
use super::random::Random;

pub type Seat = usize;
pub type ObjectId = usize;
pub type ZoneId = usize;

#[derive(Clone, Debug)]
pub struct Object {
    pub id: ObjectId,
    /// The card it is, by its index in the catalog.
    pub card: usize,
    pub owner: Option<Seat>,
    pub controller: Option<Seat>,
    pub zone: ZoneId,
    /// Which face is up: 1 the front, 2 the back (a Hero's Awakened side).
    pub face: u32,
    pub states: BTreeSet<String>,
    pub counters: BTreeMap<String, i64>,
    pub attachments: Vec<ObjectId>,
    pub attached_to: Option<ObjectId>,
    pub under: Vec<ObjectId>,
    /// Who else may see it, beyond what its zone shows: set by `reveal`, cleared by `conceal`.
    pub revealed_to: BTreeSet<Seat>,
    /// Destroyed objects keep their id, so the log's mentions of them stay valid, but are in no zone.
    pub gone: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Player {
    pub seat: Seat,
    pub team: usize,
    pub counters: BTreeMap<String, i64>,
    pub flags: BTreeSet<String>,
}

#[derive(Clone, Debug)]
pub struct Zone {
    /// Its definition, by index in the catalog.
    pub def: usize,
    /// Whose it is; none for a shared zone.
    pub owner: Option<Seat>,
    /// Its objects in order: for a pile, the first is the top.
    pub objects: Vec<ObjectId>,
}

#[derive(Clone, Debug)]
pub struct SeatSetup {
    /// The deck's key, as the game's files name it.
    pub deck: String,
}

#[derive(Clone, Debug)]
pub struct Setup {
    pub seats: Vec<SeatSetup>,
    pub seed: u64,
}

#[derive(Clone, Debug)]
pub enum Outcome {
    Winner(Seat),
    Draw,
}

#[derive(Clone, Debug)]
pub struct Game {
    pub catalog: Rc<Catalog>,
    pub seed: u64,
    pub random: Random,
    pub players: Vec<Player>,
    pub zones: Vec<Zone>,
    pub objects: Vec<Object>,
    pub round: u32,
    pub turn: u32,
    pub actor: Option<Seat>,
    pub counters: BTreeMap<String, i64>,
    pub flags: BTreeSet<String>,
    pub outcome: Option<Outcome>,
    pub log: Vec<Event>,
    /// The rule the operations now running carry out, and its citation: written into every event they log, the
    /// answer to "why did that happen?".
    pub cause: Option<String>,
}

impl Game {
    /// A new game: each seat's zones, and each seat's deck (its hero included) as objects in its deck zone, in the
    /// order the deck lists them. Nothing is shuffled or dealt: that is setup, done by the game's rules.
    pub fn new(catalog: Rc<Catalog>, setup: &Setup) -> Result<Game, String> {
        if setup.seats.is_empty() {
            return Err("A game needs at least one seat.".to_string());
        }
        let deck_zone = catalog.zone_with_role("deck").ok_or("The game has no zone with role = deck to put the decks in.")?;
        let mut game = Game {
            catalog: catalog.clone(),
            seed: setup.seed,
            random: Random::new(setup.seed),
            players: (0..setup.seats.len()).map(|seat| Player { seat, team: seat, ..Default::default() }).collect(),
            zones: Vec::new(),
            objects: Vec::new(),
            round: 0,
            turn: 0,
            actor: None,
            counters: BTreeMap::new(),
            flags: BTreeSet::new(),
            outcome: None,
            log: Vec::new(),
            cause: None,
        };
        for (def, zone) in catalog.zones.iter().enumerate() {
            if zone.shared {
                game.zones.push(Zone { def, owner: None, objects: Vec::new() });
            } else {
                for seat in 0..setup.seats.len() {
                    game.zones.push(Zone { def, owner: Some(seat), objects: Vec::new() });
                }
            }
        }
        for (seat, seat_setup) in setup.seats.iter().enumerate() {
            let deck = catalog.deck(&seat_setup.deck).ok_or_else(|| format!("The game has no deck {}.", seat_setup.deck))?;
            let zone = game.zone_of(deck_zone, Some(seat)).expect("every seat has the deck zone");
            let deck = &catalog.decks[deck];
            let mut cards: Vec<usize> = deck.hero.into_iter().collect();
            for &(card, count) in &deck.cards {
                cards.extend(std::iter::repeat_n(card, count as usize));
            }
            for card in cards {
                let id = game.objects.len();
                game.objects.push(Object {
                    id,
                    card,
                    owner: Some(seat),
                    controller: Some(seat),
                    zone,
                    face: 1,
                    states: BTreeSet::new(),
                    counters: BTreeMap::new(),
                    attachments: Vec::new(),
                    attached_to: None,
                    under: Vec::new(),
                    revealed_to: BTreeSet::new(),
                    gone: false,
                });
                game.zones[zone].objects.push(id);
            }
        }
        game.log_started(setup);
        Ok(game)
    }

    /// The zone made from definition `def` for `owner` (none for a shared zone).
    pub fn zone_of(&self, def: usize, owner: Option<Seat>) -> Option<ZoneId> {
        let shared = self.catalog.zones[def].shared;
        self.zones.iter().position(|z| z.def == def && (shared || z.owner == owner))
    }

    /// The zone named `name` (a definition's name) of `owner`.
    pub fn zone_named(&self, name: &str, owner: Option<Seat>) -> Option<ZoneId> {
        self.zone_of(self.catalog.zone(name)?, owner)
    }

    /// A zone as the log and views name it: `Hand/0` for seat 0's hand, `Discard` for a shared one.
    pub fn zone_label(&self, zone: ZoneId) -> String {
        let z = &self.zones[zone];
        let name = &self.catalog.zones[z.def].name;
        match z.owner {
            Some(seat) => format!("{}/{}", name, seat),
            None => name.clone(),
        }
    }

    /// Whether `seat` may see which card `object` is, where it is now: its zone's visibility, a face-down zone's
    /// cards only to their owner, the top card of a `top-card` pile, and whatever `reveal` added.
    pub fn sees(&self, seat: Seat, object: ObjectId) -> bool {
        let o = &self.objects[object];
        if o.gone {
            return true;
        }
        if o.revealed_to.contains(&seat) {
            return true;
        }
        self.zone_shows(seat, o.zone, Some(object))
    }

    /// Whether a zone shows `seat` its objects' identities; for a `top-card` zone, only its top object.
    pub fn zone_shows(&self, seat: Seat, zone: ZoneId, object: Option<ObjectId>) -> bool {
        let z = &self.zones[zone];
        let def = &self.catalog.zones[z.def];
        let owner_sees = z.owner.is_none_or(|owner| owner == seat);
        let shown = match def.visible {
            super::catalog::Visibility::None => false,
            super::catalog::Visibility::Owner => owner_sees,
            super::catalog::Visibility::All => !def.face_down || owner_sees,
            super::catalog::Visibility::TopCard => object.is_some_and(|o| z.objects.first() == Some(&o)),
        };
        shown && (!def.face_down || owner_sees)
    }

    /// The card an object is, by key.
    pub fn card_key(&self, object: ObjectId) -> &str {
        &self.catalog.cards[self.objects[object].card].key
    }
}
