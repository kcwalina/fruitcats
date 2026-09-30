//! The operations of `core-operations.alex` part 2, and randomness from part 8: the only ways a game's state changes.
//! Each logs one event, named as the contract names it. The grid operations (`turn`, `create-zone`) come with the
//! first game on a grid.

use super::log::Value;
use super::state::{Game, Object, ObjectId, Outcome, Seat, ZoneId};

type Result<T = ()> = std::result::Result<T, String>;

/// Where in an ordered zone an object goes.
#[derive(Clone, Copy, Debug)]
pub enum Position {
    Top,
    Bottom,
    Index(usize),
}

impl Game {
    fn live(&self, object: ObjectId) -> Result<&Object> {
        match self.objects.get(object) {
            Some(o) if !o.gone => Ok(o),
            Some(_) => Err(format!("Object {} is gone.", object)),
            None => Err(format!("There is no object {}.", object)),
        }
    }

    /// Takes an object out of wherever it sits: its zone's list, the object it is attached to, or the one it is under.
    fn lift(&mut self, object: ObjectId) {
        let zone = self.objects[object].zone;
        self.zones[zone].objects.retain(|&o| o != object);
        if let Some(host) = self.objects[object].attached_to.take() {
            self.objects[host].attachments.retain(|&o| o != object);
        }
        for other in 0..self.objects.len() {
            if self.objects[other].under.contains(&object) {
                self.objects[other].under.retain(|&o| o != object);
            }
        }
    }

    /// Moves an object to a zone. A moved object is in a new place, so what was revealed of it is no longer.
    pub fn move_to(&mut self, object: ObjectId, to: ZoneId, at: Position) -> Result {
        self.live(object)?;
        let before: Vec<bool> = (0..self.players.len()).map(|s| self.sees(s, object)).collect();
        let from = self.objects[object].zone;
        self.lift(object);
        let list = &mut self.zones[to].objects;
        let index = match at {
            Position::Top => 0,
            Position::Bottom => list.len(),
            Position::Index(i) => i.min(list.len()),
        };
        list.insert(index, object);
        self.objects[object].zone = to;
        self.objects[object].revealed_to.clear();
        let mut mention = self.mention(object);
        for (seen, was) in mention.seen_by.iter_mut().zip(before) {
            *seen |= was;
        }
        let (from, to) = (self.zone_label(from), self.zone_label(to));
        self.emit("moved", vec![("object", Value::Object(mention)), ("from", Value::Zone(from)), ("to", Value::Zone(to))]);
        Ok(())
    }

    pub fn set_controller(&mut self, object: ObjectId, seat: Seat) -> Result {
        self.live(object)?;
        self.objects[object].controller = Some(seat);
        let mention = self.mention(object);
        self.emit("controlled", vec![("object", Value::Object(mention)), ("player", Value::Seat(seat))]);
        Ok(())
    }

    /// Shuffles a zone. The new order is in the game's state and never in the log.
    pub fn shuffle(&mut self, zone: ZoneId) {
        let mut objects = std::mem::take(&mut self.zones[zone].objects);
        self.random.shuffle(&mut objects);
        self.zones[zone].objects = objects;
        let label = self.zone_label(zone);
        self.emit("shuffled", vec![("zone", Value::Zone(label))]);
    }

    pub fn flip(&mut self, object: ObjectId, face: u32) -> Result {
        self.live(object)?;
        self.objects[object].face = face;
        let mention = self.mention(object);
        self.emit("flipped", vec![("object", Value::Object(mention)), ("face", Value::Int(face as i64))]);
        Ok(())
    }

    /// Turns a state (`exhausted`, `face-down`…) on or off. Setting it as it already is logs nothing.
    pub fn set_state(&mut self, object: ObjectId, state: &str, on: bool) -> Result {
        self.live(object)?;
        let states = &mut self.objects[object].states;
        let changed = if on { states.insert(state.to_string()) } else { states.remove(state) };
        if changed {
            let mention = self.mention(object);
            self.emit("state-set", vec![("object", Value::Object(mention)), ("state", Value::Text(state.to_string())), ("on", Value::Bool(on))]);
        }
        Ok(())
    }

    /// Adds `n` (which may be negative) to an object's counter; a counter at 0 is removed.
    pub fn add_counter(&mut self, object: ObjectId, counter: &str, n: i64) -> Result {
        self.live(object)?;
        let counters = &mut self.objects[object].counters;
        let value = counters.get(counter).copied().unwrap_or(0) + n;
        if value == 0 {
            counters.remove(counter);
        } else {
            counters.insert(counter.to_string(), value);
        }
        let mention = self.mention(object);
        self.emit(
            "counter-changed",
            vec![("object", Value::Object(mention)), ("counter", Value::Text(counter.to_string())), ("by", Value::Int(n)), ("value", Value::Int(value))],
        );
        Ok(())
    }

    /// Attaches an object to another, which takes it into its zone.
    pub fn attach(&mut self, object: ObjectId, to: ObjectId) -> Result {
        self.live(object)?;
        self.live(to)?;
        if object == to {
            return Err("An object can't be attached to itself.".to_string());
        }
        self.lift(object);
        self.objects[object].zone = self.objects[to].zone;
        self.objects[object].attached_to = Some(to);
        self.objects[to].attachments.push(object);
        let (m, host) = (self.mention(object), self.mention(to));
        self.emit("attached", vec![("object", Value::Object(m)), ("to", Value::Object(host))]);
        Ok(())
    }

    /// Detaches an object; it stays in its zone, on its own.
    pub fn detach(&mut self, object: ObjectId) -> Result {
        self.live(object)?;
        if self.objects[object].attached_to.is_none() {
            return Ok(());
        }
        self.lift(object);
        let zone = self.objects[object].zone;
        self.zones[zone].objects.push(object);
        let m = self.mention(object);
        self.emit("detached", vec![("object", Value::Object(m))]);
        Ok(())
    }

    /// Puts an object under another (evolution, inherited effects).
    pub fn stack_under(&mut self, object: ObjectId, beneath: ObjectId) -> Result {
        self.live(object)?;
        self.live(beneath)?;
        if object == beneath {
            return Err("An object can't be stacked under itself.".to_string());
        }
        self.lift(object);
        self.objects[object].zone = self.objects[beneath].zone;
        self.objects[beneath].under.push(object);
        let (m, top) = (self.mention(object), self.mention(beneath));
        self.emit("stacked", vec![("object", Value::Object(m)), ("beneath", Value::Object(top))]);
        Ok(())
    }

    /// Creates an object for a card (a token) in a zone, on top.
    pub fn create(&mut self, card: usize, owner: Option<Seat>, zone: ZoneId) -> ObjectId {
        let id = self.objects.len();
        self.objects.push(Object {
            id,
            card,
            owner,
            controller: owner,
            zone,
            face: 1,
            states: Default::default(),
            counters: Default::default(),
            attachments: Vec::new(),
            attached_to: None,
            under: Vec::new(),
            revealed_to: Default::default(),
            gone: false,
        });
        self.zones[zone].objects.insert(0, id);
        let (m, label) = (self.mention(id), self.zone_label(zone));
        self.emit("created", vec![("object", Value::Object(m)), ("zone", Value::Zone(label))]);
        id
    }

    /// Removes an object from the game (a token leaving play).
    pub fn destroy(&mut self, object: ObjectId) -> Result {
        self.live(object)?;
        let m = self.mention(object);
        self.lift(object);
        self.objects[object].gone = true;
        self.emit("destroyed", vec![("object", Value::Object(m))]);
        Ok(())
    }

    /// Shows an object to players who couldn't see it, until it moves or is concealed.
    pub fn reveal(&mut self, object: ObjectId, to: &[Seat]) -> Result {
        self.live(object)?;
        self.objects[object].revealed_to.extend(to.iter().copied());
        let m = self.mention(object);
        self.emit("revealed", vec![("object", Value::Object(m)), ("to", Value::Seats(to.to_vec()))]);
        Ok(())
    }

    pub fn conceal(&mut self, object: ObjectId) -> Result {
        self.live(object)?;
        let before = self.mention(object);
        self.objects[object].revealed_to.clear();
        self.emit("concealed", vec![("object", Value::Object(before))]);
        Ok(())
    }

    /// Adds `delta` to a player's counter (life, mana, lore).
    pub fn adjust(&mut self, seat: Seat, counter: &str, delta: i64) {
        let counters = &mut self.players[seat].counters;
        let value = counters.get(counter).copied().unwrap_or(0) + delta;
        counters.insert(counter.to_string(), value);
        self.emit(
            "adjusted",
            vec![("player", Value::Seat(seat)), ("counter", Value::Text(counter.to_string())), ("by", Value::Int(delta)), ("value", Value::Int(value))],
        );
    }

    pub fn set_flag(&mut self, seat: Seat, flag: &str, on: bool) {
        let flags = &mut self.players[seat].flags;
        let changed = if on { flags.insert(flag.to_string()) } else { flags.remove(flag) };
        if changed {
            self.emit("flag-set", vec![("player", Value::Seat(seat)), ("flag", Value::Text(flag.to_string())), ("on", Value::Bool(on))]);
        }
    }

    pub fn adjust_game(&mut self, counter: &str, delta: i64) {
        let value = self.counters.get(counter).copied().unwrap_or(0) + delta;
        self.counters.insert(counter.to_string(), value);
        self.emit("game-adjusted", vec![("counter", Value::Text(counter.to_string())), ("by", Value::Int(delta)), ("value", Value::Int(value))]);
    }

    pub fn set_game_flag(&mut self, flag: &str, on: bool) {
        let changed = if on { self.flags.insert(flag.to_string()) } else { self.flags.remove(flag) };
        if changed {
            self.emit("game-flag-set", vec![("flag", Value::Text(flag.to_string())), ("on", Value::Bool(on))]);
        }
    }

    pub fn eliminate(&mut self, seat: Seat) {
        self.players[seat].flags.insert("eliminated".to_string());
        self.emit("eliminated", vec![("player", Value::Seat(seat))]);
    }

    pub fn end_game(&mut self, outcome: Outcome) {
        let field = match outcome {
            Outcome::Winner(seat) => ("winner", Value::Seat(seat)),
            Outcome::Draw => ("draw", Value::Bool(true)),
        };
        self.outcome = Some(outcome);
        self.emit("game-over", vec![field]);
    }

    /// Rolls a die with these faces; returns the index of the face rolled. Every roll is logged.
    pub fn roll(&mut self, faces: &[String]) -> Result<usize> {
        if faces.is_empty() {
            return Err("A die needs at least one face.".to_string());
        }
        let index = self.random.below(faces.len() as u64) as usize;
        self.emit("rolled", vec![("face", Value::Text(faces[index].clone())), ("index", Value::Int(index as i64))]);
        Ok(index)
    }

    /// Picks one of `count` options at random; returns its index.
    pub fn pick(&mut self, count: usize) -> Result<usize> {
        if count == 0 {
            return Err("There is nothing to pick from.".to_string());
        }
        let index = self.random.below(count as u64) as usize;
        self.emit("picked", vec![("index", Value::Int(index as i64)), ("of", Value::Int(count as i64))]);
        Ok(index)
    }
}
