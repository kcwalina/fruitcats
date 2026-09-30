//! Runs a handler against a game. A handler is data (docs/tcg/library-rules-on-paper.md): an effect record
//! (`Draw()`, `Damage(card.damage, target: Choose(all))`), a list of them, which happen in order, or a formula, a pure
//! expression read from the game. Every change goes through the core's operations (`ops.rs`), so it is logged with its
//! cause. A `Choose` the handler reaches before it has an answer stops it (`Stop::Need`); the scheduler
//! (`schedule.rs`) runs it on a copy of the game, so a stopped handler has changed nothing, and runs it again with the
//! answers once they are given.
//!
//! What each effect does is Rust here for now; the libraries will define theirs from the core's effects (an effect
//! type's `do`) once the runtime reads them (docs/tcg/runtime-design.md, step 3).

use std::collections::BTreeMap;
use std::rc::Rc;

use super::catalog::Catalog;
use super::state::{Game, ObjectId, Seat};
use super::Position;
use crate::alex::model::{Model, ValueId, ValueKind};
use crate::alex::syntax::{Argument, Element, Expression, LiteralKind, Separated, Token};

/// What a handler runs for: the object it is attached to, the card face whose numbers it reads (`card.damage`), the
/// player it acts for (`own`), and, inside a `With`, the target its effects share.
#[derive(Clone, Debug)]
pub struct Context {
    pub this: Option<ObjectId>,
    /// The card, by its index in the catalog, and which of its faces: 0 the front, 1 the back.
    pub card: Option<(usize, usize)>,
    pub controller: Seat,
    pub target: Option<Vec<ObjectId>>,
}

/// A decision a handler is waiting for: which object `seat` picks, from `options`; with `optional`, answering
/// `options.len()` declines.
#[derive(Clone, Debug)]
pub struct Decision {
    pub seat: Seat,
    pub question: String,
    pub options: Vec<ObjectId>,
    pub optional: bool,
}

pub enum Stop {
    Need(Decision),
    Fail(String),
}

#[derive(Clone, Debug)]
pub enum Val {
    Nothing,
    Int(i64),
    Bool(bool),
    Text(String),
    /// A bare word the reader gives a meaning: a filter (`exhausted`), a keyword (`guardian`), a duration.
    Word(String),
    Player(Seat),
    Players(Vec<Seat>),
    Object(ObjectId),
    Objects(Vec<ObjectId>),
    Card(usize),
    /// A card's face, as `card` is in a handler: its constants and numbers.
    Face(usize, usize),
    /// A zone definition, by index in the catalog: `@Mist`.
    Zone(usize),
    List(Vec<Val>),
    /// A value of the model a formula named: an effect (`this.on-play`) or a record.
    Value(ValueId),
}

type Eval = Result<Val, Stop>;

fn fail<T>(message: impl Into<String>) -> Result<T, Stop> {
    Err(Stop::Fail(message.into()))
}

pub struct Run<'g> {
    pub game: &'g mut Game,
    catalog: Rc<Catalog>,
    model: Rc<Model>,
    context: Context,
    handler: ValueId,
    answers: Vec<usize>,
    next_answer: usize,
    /// The document whose text the formula being read comes from.
    document: usize,
    /// Reading a formula: nothing may change the game.
    reading: bool,
}

impl<'g> Run<'g> {
    pub fn new(game: &'g mut Game, handler: ValueId, context: Context, answers: Vec<usize>) -> Run<'g> {
        let catalog = game.catalog.clone();
        let model = catalog.handlers.model.clone();
        Run { game, catalog, model, context, handler, answers, next_answer: 0, document: 0, reading: false }
    }

    /// Runs the handler: nothing for effects, the formula's value for a question (`awaken`).
    pub fn run(&mut self) -> Eval {
        self.run_value(self.handler)
    }

    fn run_value(&mut self, value: ValueId) -> Eval {
        match &self.model.values[value].kind {
            ValueKind::Reference { target: Some(target), .. } => self.run_value(*target),
            ValueKind::Array(items) => {
                for item in items.clone() {
                    self.run_value(item)?;
                }
                Ok(Val::Nothing)
            }
            ValueKind::Object(object) if !object.is_map => self.run_effect(value),
            ValueKind::Formula { expression, document } => {
                let result = self.read(&expression.clone(), *document)?;
                match result {
                    Val::Value(named) => self.run_value(named),
                    other => Ok(other),
                }
            }
            _ => self.value(value),
        }
    }

    // ── effects ────────────────────────────────────────────────────────────────────────────────

    fn run_effect(&mut self, effect: ValueId) -> Eval {
        let types = self.types_of(effect);
        if let Some(condition) = self.field(effect, "only-if") {
            let met = self.value(condition)?;
            if !self.truthy(&met) {
                return Ok(Val::Nothing);
            }
        }
        if let Some(once) = self.field(effect, "once-per-round") {
            if matches!(self.model.values[once].kind, ValueKind::Boolean(true)) {
                let key = (self.context.this.unwrap_or(usize::MAX), effect);
                if !self.game.used_once.insert(key) {
                    return Ok(Val::Nothing);
                }
            }
        }
        let kind = types.iter().find(|t| KNOWN.contains(&t.as_str())).cloned().unwrap_or_default();
        match kind.as_str() {
            "With" => {
                let target = self.targets(effect)?;
                let saved = self.context.target.replace(target);
                let result = match self.field(effect, "do") {
                    Some(effects) => self.run_value(effects),
                    None => Ok(Val::Nothing),
                };
                self.context.target = saved;
                result?;
            }
            "Draw" => {
                let count = self.int_field(effect, "count", 1)?;
                for seat in self.players(effect)? {
                    self.draw(seat, count)?;
                }
            }
            "Damage" => {
                let amount = self.int_field(effect, "amount", 1)?;
                for object in self.targets(effect)? {
                    if amount > 0 {
                        self.op(|g| g.add_counter(object, "damage", amount))?;
                    }
                }
            }
            "Heal" => {
                let amount = self.int_field(effect, "amount", 1)?;
                for object in self.targets(effect)? {
                    let damage = self.game.objects[object].counters.get("damage").copied().unwrap_or(0);
                    let healed = amount.min(damage);
                    if healed > 0 {
                        self.op(|g| g.add_counter(object, "damage", -healed))?;
                    }
                }
            }
            "Exhaust" | "Ready" => {
                for object in self.targets(effect)? {
                    self.op(|g| g.set_state(object, "exhausted", kind == "Exhaust"))?;
                }
            }
            "Gain" => {
                let power = self.int_field(effect, "power", 0)?;
                let health = self.int_field(effect, "health", 0)?;
                let keywords = self.words_field(effect, "keywords")?;
                for object in self.targets(effect)? {
                    if power != 0 {
                        self.op(|g| g.add_counter(object, "this-round-power", power))?;
                    }
                    if health != 0 {
                        self.op(|g| g.add_counter(object, "this-round-health", health))?;
                    }
                    for keyword in &keywords {
                        self.op(|g| g.set_state(object, &format!("this-round:{}", keyword), true))?;
                    }
                }
            }
            // Statics hold while their card is in play; the runtime applies them when it works out a unit's stats and
            // keywords, not when a handler runs.
            "Grant" | "CantAttack" => {}
            "ReadyResources" => {
                let count = self.int_field(effect, "count", 1)?;
                for seat in self.players(effect)? {
                    let exhausted: Vec<ObjectId> = match self.player_property(seat, "resources")? {
                        Val::Objects(list) => list.into_iter().filter(|&o| self.game.objects[o].states.contains("exhausted")).collect(),
                        _ => Vec::new(),
                    };
                    for object in exhausted.into_iter().take(count.max(0) as usize) {
                        self.op(|g| g.set_state(object, "exhausted", false))?;
                    }
                }
            }
            "OfferFromDeck" => {
                let count = self.int_field(effect, "count", 1)?;
                let exhausted = self.field(effect, "exhausted").is_some_and(|v| matches!(self.model.values[v].kind, ValueKind::Boolean(true)));
                for seat in self.players(effect)? {
                    let (Some(deck), Some(resources)) = (self.zone(seat, "deck"), self.zone(seat, "resource")) else {
                        return fail("OfferFromDeck needs a deck and a resource zone.");
                    };
                    for _ in 0..count {
                        let Some(&top) = self.game.zones[deck].objects.first() else { break };
                        self.op(|g| g.move_to(top, resources, Position::Bottom))?;
                        if exhausted {
                            self.op(|g| g.set_state(top, "exhausted", true))?;
                        }
                    }
                }
            }
            "Summon" => {
                let Some(card) = self.field(effect, "card") else { return fail("Summon names a card: Summon(@dove).") };
                let Val::Card(card) = self.value(card)? else { return fail("Summon names a card: Summon(@dove).") };
                for seat in self.players(effect)? {
                    let Some(board) = self.zone(seat, "board") else { return fail("Summon needs a zone with role = board.") };
                    self.game.create(card, Some(seat), board);
                }
            }
            "AddCounter" => {
                let counter = self.name_field(effect, "counter")?;
                let by = self.int_field(effect, "by", 1)?;
                match self.field(effect, "target").map(|t| self.value(t)).transpose()? {
                    Some(Val::Player(seat)) => self.game.adjust(seat, &counter, by),
                    Some(Val::Players(seats)) => seats.into_iter().for_each(|seat| self.game.adjust(seat, &counter, by)),
                    _ => {
                        for object in self.targets(effect)? {
                            self.op(|g| g.add_counter(object, &counter, by))?;
                        }
                    }
                }
            }
            // The attack a card answers comes with events, in the next step; until then there is none to cancel.
            "CancelAttack" => {}
            "" => return fail(format!("The runtime doesn't do a {} yet.", types.first().cloned().unwrap_or_default())),
            other => return fail(format!("The runtime doesn't do a {} yet.", other)),
        }
        Ok(Val::Nothing)
    }

    /// The effect's record type and every type it derives from.
    fn types_of(&self, value: ValueId) -> Vec<String> {
        let Some(object) = self.model.object(value) else { return Vec::new() };
        match object.record_type {
            Some(t) => self.model.chain(t).iter().map(|t| self.model.record_name(*t).to_string()).collect(),
            None => object.type_name.clone().into_iter().collect(),
        }
    }

    /// A field of a record, when it is set to something (a default of nic isn't).
    fn field(&self, record: ValueId, name: &str) -> Option<ValueId> {
        let value = self.model.object(record)?.get(name)?.value;
        match self.model.values[value].kind {
            ValueKind::Nic | ValueKind::Invalid => None,
            _ => Some(value),
        }
    }

    fn int_field(&mut self, record: ValueId, name: &str, default: i64) -> Result<i64, Stop> {
        match self.field(record, name) {
            Some(value) => {
                let read = self.value(value)?;
                self.int(&read)
            }
            None => Ok(default),
        }
    }

    /// A field that names something (a counter, a resource): the name a reference or a word gives it.
    fn name_field(&mut self, record: ValueId, name: &str) -> Result<String, Stop> {
        let Some(value) = self.field(record, name) else { return fail(format!("The effect names no {}.", name)) };
        Ok(self.name_of(value))
    }

    fn name_of(&self, value: ValueId) -> String {
        match &self.model.values[value].kind {
            ValueKind::Reference { path, .. } => path.last().cloned().unwrap_or_default(),
            ValueKind::Enum { member, .. } => member.clone(),
            ValueKind::String(t) | ValueKind::Text(t) => t.clone(),
            _ => String::new(),
        }
    }

    fn words_field(&mut self, record: ValueId, name: &str) -> Result<Vec<String>, Stop> {
        let Some(value) = self.field(record, name) else { return Ok(Vec::new()) };
        match &self.model.values[value].kind {
            ValueKind::Array(items) => Ok(items.iter().map(|i| self.name_of(*i)).collect()),
            _ => Ok(vec![self.name_of(value)]),
        }
    }

    /// What an effect about cards acts on: its `target`, else a `With`'s shared target, else the card whose handler it
    /// is. A `Choose` asks its player.
    fn targets(&mut self, effect: ValueId) -> Result<Vec<ObjectId>, Stop> {
        let Some(target) = self.field(effect, "target") else {
            return Ok(match &self.context.target {
                Some(shared) => shared.clone(),
                None => self.context.this.into_iter().collect(),
            });
        };
        let read = self.value(target)?;
        Ok(self.objects_of(&read))
    }

    /// Who an effect about players acts on: its `player`, else `own`.
    fn players(&mut self, effect: ValueId) -> Result<Vec<Seat>, Stop> {
        let Some(player) = self.field(effect, "player") else { return Ok(vec![self.context.controller]) };
        let read = self.value(player)?;
        Ok(self.players_of(&read))
    }

    /// A value as the handler reads it: a literal, a word, a reference, a formula, or a choice.
    fn value(&mut self, value: ValueId) -> Eval {
        Ok(match &self.model.values[value].kind {
            ValueKind::Integer(n) => Val::Int(*n),
            ValueKind::Boolean(b) => Val::Bool(*b),
            ValueKind::String(t) | ValueKind::Text(t) => Val::Text(t.clone()),
            ValueKind::Nic | ValueKind::Empty | ValueKind::Invalid => Val::Nothing,
            ValueKind::Enum { member, .. } => {
                let member = member.clone();
                return self.name(&member);
            }
            ValueKind::Formula { expression, document } => {
                let expression = expression.clone();
                return self.read(&expression, *document);
            }
            ValueKind::Reference { path, target } => {
                let path = path.clone();
                return match target {
                    Some(target) => self.referenced(*target, &path),
                    None => self.reference(&path),
                };
            }
            ValueKind::Object(object) if object.type_name.as_deref() == Some("Choose") => return self.choice(value),
            ValueKind::Array(items) => {
                let mut list = Vec::new();
                for item in items.clone() {
                    list.push(self.value(item)?);
                }
                Val::List(list)
            }
            _ => Val::Value(value),
        })
    }

    /// What a reference the binder resolved stands for: a game or card number, a card, a named formula (read), or the
    /// name it is written with (a keyword, a counter, a resource).
    fn referenced(&mut self, target: ValueId, path: &[String]) -> Eval {
        if let Some(card) = self.catalog.cards.iter().position(|c| c.value == target) {
            return Ok(Val::Card(card));
        }
        match &self.model.values[target].kind {
            ValueKind::Integer(n) => Ok(Val::Int(*n)),
            ValueKind::Formula { .. } => self.value(target),
            _ => self.reference(path),
        }
    }

    /// `Choose(from, filter: ...)`: the unit its player picks.
    fn choice(&mut self, choose: ValueId) -> Eval {
        let from = match self.field(choose, "from") {
            Some(from) => {
                let read = self.value(from)?;
                self.players_of(&read)
            }
            None => vec![self.context.controller],
        };
        let filters = match self.field(choose, "filter") {
            Some(filter) => match self.value(filter)? {
                Val::List(list) => list,
                one => vec![one],
            },
            None => Vec::new(),
        };
        let optional = self.field(choose, "optional").is_some_and(|v| matches!(self.model.values[v].kind, ValueKind::Boolean(true)));
        let options = self.units(&from, &filters);
        let seat = self.context.controller;
        self.choose(seat, "Choose a unit.", options, optional)
    }

    fn op<T>(&mut self, f: impl FnOnce(&mut Game) -> Result<T, String>) -> Result<T, Stop> {
        f(self.game).map_err(Stop::Fail)
    }

    // ── formulas ───────────────────────────────────────────────────────────────────────────────

    /// Reads a formula: its value, computed from the game, which it never changes.
    fn read(&mut self, expression: &Expression, document: usize) -> Eval {
        let (saved_document, saved_reading) = (self.document, self.reading);
        self.document = document;
        self.reading = true;
        let result = self.eval(expression);
        self.document = saved_document;
        self.reading = saved_reading;
        result
    }

    fn text(&self, token: &Token) -> String {
        let source = self.catalog.handlers.sources.get(self.document).map(|s| s.as_slice()).unwrap_or(&[]);
        String::from_utf8_lossy(token.text(source)).into_owned()
    }

    fn eval(&mut self, expression: &Expression) -> Eval {
        match expression {
            Expression::Literal { kind, token } => Ok(match kind {
                LiteralKind::Integer => Val::Int(self.text(token).parse().unwrap_or(0)),
                LiteralKind::True => Val::Bool(true),
                LiteralKind::False => Val::Bool(false),
                LiteralKind::String => {
                    let t = self.text(token);
                    Val::Text(t.trim_matches('\'').replace("''", "'"))
                }
                _ => Val::Nothing,
            }),
            Expression::Name { identifier } => {
                let name = self.text(identifier);
                self.name(&name)
            }
            Expression::Reference { path, .. } => {
                let segments: Vec<String> = items(&path.segments).iter().map(|t| self.text(t)).collect();
                self.reference(&segments)
            }
            Expression::MemberAccess { receiver, name, .. } => {
                let receiver = self.eval(receiver)?;
                let name = self.text(name);
                self.property(&receiver, &name)
            }
            Expression::Call { callee, arguments, .. } => match &**callee {
                Expression::Name { identifier } => {
                    let name = self.text(identifier);
                    let args = self.arguments(arguments)?;
                    self.query(&name, args)
                }
                Expression::MemberAccess { receiver, name, .. } => {
                    let receiver = self.eval(receiver)?;
                    let name = self.text(name);
                    let args = self.arguments(arguments)?;
                    self.method(&receiver, &name, args)
                }
                _ => fail("Only a name or a member can be called."),
            },
            Expression::Unary { operator, operand } => {
                let value = self.eval(operand)?;
                match self.text(operator).as_str() {
                    "not" | "!" => Ok(Val::Bool(!self.truthy(&value))),
                    other => fail(format!("The runtime doesn't know the operator {}.", other)),
                }
            }
            Expression::Signed { sign, operand } => {
                let n = self.eval(operand)?;
                let n = self.int(&n)?;
                Ok(Val::Int(if self.text(sign) == "-" { -n } else { n }))
            }
            Expression::Binary { left, operator, right } => {
                let operator = self.text(operator);
                if operator == "and" || operator == "or" {
                    let l = self.eval(left)?;
                    let l = self.truthy(&l);
                    if (operator == "and") != l {
                        return Ok(Val::Bool(l));
                    }
                    let r = self.eval(right)?;
                    return Ok(Val::Bool(self.truthy(&r)));
                }
                let l = self.eval(left)?;
                let r = self.eval(right)?;
                if operator == "+" {
                    if let (Val::Objects(a), Val::Objects(b)) = (&l, &r) {
                        return Ok(Val::Objects(a.iter().chain(b.iter()).copied().collect()));
                    }
                }
                let (l, r) = (self.int(&l)?, self.int(&r)?);
                Ok(match operator.as_str() {
                    ">=" => Val::Bool(l >= r),
                    "<=" => Val::Bool(l <= r),
                    ">" => Val::Bool(l > r),
                    "<" => Val::Bool(l < r),
                    "==" => Val::Bool(l == r),
                    "!=" => Val::Bool(l != r),
                    "+" => Val::Int(l + r),
                    other => return fail(format!("The runtime doesn't know the operator {}.", other)),
                })
            }
            Expression::Parenthesized { inner, .. } => self.eval(inner),
            Expression::Conditional { condition, then, otherwise, .. } => {
                let condition = self.eval(condition)?;
                if self.truthy(&condition) { self.eval(then) } else { self.eval(otherwise) }
            }
            Expression::Missing { .. } => fail("The formula has a missing expression."),
        }
    }

    fn arguments(&mut self, arguments: &Separated<Argument>) -> Result<(Vec<Val>, BTreeMap<String, Val>), Stop> {
        let mut positional = Vec::new();
        let mut named = BTreeMap::new();
        for argument in items(arguments) {
            let value = self.eval(&argument.value)?;
            match &argument.name {
                Some(name) => {
                    named.insert(self.text(name), value);
                }
                None => positional.push(value),
            }
        }
        Ok((positional, named))
    }

    fn name(&mut self, name: &str) -> Eval {
        let seats = self.game.players.len();
        let own = self.context.controller;
        Ok(match name {
            "this" => self.context.this.map(Val::Object).unwrap_or(Val::Nothing),
            "card" => self.context.card.map(|(c, f)| Val::Face(c, f)).unwrap_or(Val::Nothing),
            "own" => Val::Player(own),
            "opponent" => Val::Player((own + 1) % seats),
            "opponents" => Val::Players((0..seats).filter(|&s| s != own).collect()),
            "all" => Val::Players((0..seats).collect()),
            "nothing" => Val::Nothing,
            "attached" => self.context.this.and_then(|o| self.game.objects[o].attached_to).map(Val::Object).unwrap_or(Val::Nothing),
            _ => match self.catalog.numbers.get(name) {
                Some(&n) => Val::Int(n),
                None => Val::Word(name.to_string()),
            },
        })
    }

    /// `@name` in a formula: a named effect or formula of the rules files (read), a game constant, a zone, a card, or a
    /// name the reader reads (a keyword, a counter, a resource).
    fn reference(&mut self, path: &[String]) -> Eval {
        let last = path.last().cloned().unwrap_or_default();
        if path.len() == 1 {
            if let Some(&named) = self.catalog.handlers.named.get(&last) {
                return match &self.model.values[named].kind {
                    ValueKind::Formula { .. } => self.value(named),
                    _ => Ok(Val::Value(named)),
                };
            }
            if let Some(&n) = self.catalog.constants.get(&last) {
                return Ok(Val::Int(n));
            }
            if let Some(zone) = self.catalog.zone(&last) {
                return Ok(Val::Zone(zone));
            }
        }
        if let Some(card) = self.catalog.card(&last) {
            return Ok(Val::Card(card));
        }
        Ok(Val::Word(last))
    }

    fn property(&mut self, value: &Val, name: &str) -> Eval {
        Ok(match value {
            Val::Face(card, face) => {
                let face = &self.catalog.cards[*card].faces[*face];
                match face.constants.get(name).or_else(|| face.numbers.get(name)) {
                    Some(&n) => Val::Int(n),
                    None => Val::Nothing,
                }
            }
            Val::Objects(list) => match name {
                "count" => Val::Int(list.len() as i64),
                "any" => Val::Bool(!list.is_empty()),
                _ => return fail(format!("A set of objects has no {}.", name)),
            },
            Val::Players(list) if name == "count" => Val::Int(list.len() as i64),
            Val::Object(object) => {
                let o = &self.game.objects[*object];
                let card = &self.catalog.cards[o.card];
                let face = &card.faces[(o.face as usize - 1).min(card.faces.len() - 1)];
                // A card's own handler, as data (`this.on-play`), before its numbers.
                if let Some(handler) = self.catalog.handlers.attached(face.value, name) {
                    return Ok(Val::Value(handler));
                }
                match o.counters.get(name).or_else(|| face.numbers.get(name)) {
                    Some(&n) => Val::Int(n),
                    None => match name {
                        "exhausted" => Val::Bool(o.states.contains("exhausted")),
                        "ready" => Val::Bool(!o.states.contains("exhausted")),
                        "face" => Val::Int(o.face as i64),
                        _ => Val::Nothing,
                    },
                }
            }
            Val::Player(seat) => self.player_property(*seat, name)?,
            Val::Nothing => Val::Nothing,
            _ => return fail(format!("{} has no {}.", describe(value), name)),
        })
    }

    fn player_property(&self, seat: Seat, name: &str) -> Eval {
        let zone_objects = |role: &str| -> Option<Vec<ObjectId>> {
            let def = self.catalog.zone_with_role(role)?;
            let zone = self.game.zone_of(def, Some(seat))?;
            Some(self.game.zones[zone].objects.clone())
        };
        Ok(match name {
            "resources" => Val::Objects(zone_objects("resource").unwrap_or_default()),
            "life" => match zone_objects("life") {
                Some(objects) => Val::Objects(objects),
                None => Val::Int(self.game.players[seat].counters.get("Life").copied().unwrap_or(0)),
            },
            "played-this-round" => Val::Int(self.game.players[seat].counters.get("played-this-round").copied().unwrap_or(0)),
            "next" => Val::Player((seat + 1) % self.game.players.len()),
            _ => match self.game.players[seat].counters.get(name) {
                Some(&n) => Val::Int(n),
                None => return fail(format!("A player has no {}.", name)),
            },
        })
    }

    // ── queries a formula may call ─────────────────────────────────────────────────────────────

    fn query(&mut self, name: &str, (args, _named): (Vec<Val>, BTreeMap<String, Val>)) -> Eval {
        let own = self.context.controller;
        match name {
            "units" => {
                let from = self.players_of(args.first().unwrap_or(&Val::Players(vec![own])));
                let units = self.units(&from, &args[1.min(args.len())..]);
                Ok(Val::Objects(units))
            }
            "cards" => {
                let Some(Val::Zone(def)) = args.first() else { return fail("cards() takes a zone first: cards(@Mist, all).") };
                let from = self.players_of(args.get(1).unwrap_or(&Val::Players(vec![own])));
                let mut found = Vec::new();
                for seat in from {
                    if let Some(zone) = self.game.zone_of(*def, Some(seat)) {
                        found.extend(self.game.zones[zone].objects.iter().copied());
                    }
                }
                found.dedup();
                let filtered = self.filter(found, &args[2.min(args.len())..]);
                Ok(Val::Objects(filtered))
            }
            other => fail(format!("A formula can't call {}(): it reads the game and never changes it.", other)),
        }
    }

    fn method(&mut self, receiver: &Val, name: &str, (args, _named): (Vec<Val>, BTreeMap<String, Val>)) -> Eval {
        let objects = self.objects_of(receiver);
        match name {
            "has" => {
                let word = args.first().map(|v| self.word_of(v)).unwrap_or_default();
                Ok(Val::Bool(!objects.is_empty() && objects.iter().all(|&o| self.has_keyword(o, &word))))
            }
            other => fail(format!("A formula can't call .{}(): it reads the game and never changes it.", other)),
        }
    }

    fn choose(&mut self, seat: Seat, question: &str, options: Vec<ObjectId>, optional: bool) -> Eval {
        if options.is_empty() {
            return Ok(Val::Nothing);
        }
        if self.next_answer < self.answers.len() {
            let answer = self.answers[self.next_answer];
            self.next_answer += 1;
            return match options.get(answer) {
                Some(&object) => Ok(Val::Object(object)),
                None if optional && answer == options.len() => Ok(Val::Nothing),
                None => fail(format!("{} isn't one of the {} options.", answer, options.len())),
            };
        }
        Err(Stop::Need(Decision { seat, question: question.to_string(), options, optional }))
    }

    // ── helpers ────────────────────────────────────────────────────────────────────────────────

    fn draw(&mut self, seat: Seat, count: i64) -> Result<(), Stop> {
        let (Some(deck), Some(hand)) = (self.zone(seat, "deck"), self.zone(seat, "hand")) else { return fail("Draw needs a deck and a hand zone.") };
        for _ in 0..count {
            let Some(&top) = self.game.zones[deck].objects.first() else { break };
            self.op(|g| g.move_to(top, hand, Position::Bottom))?;
        }
        Ok(())
    }

    fn zone(&self, seat: Seat, role: &str) -> Option<usize> {
        self.game.zone_of(self.catalog.zone_with_role(role)?, Some(seat))
    }

    /// The units in play of these players: units in their board zones.
    fn units(&self, players: &[Seat], filters: &[Val]) -> Vec<ObjectId> {
        let mut found = Vec::new();
        for (def, zone) in self.catalog.zones.iter().enumerate() {
            if zone.role != "board" {
                continue;
            }
            for &seat in players {
                if let Some(z) = self.game.zone_of(def, Some(seat)) {
                    found.extend(self.game.zones[z].objects.iter().copied().filter(|&o| self.catalog.is_unit(self.game.objects[o].card)));
                }
            }
        }
        self.filter(found, filters)
    }

    fn filter(&self, objects: Vec<ObjectId>, filters: &[Val]) -> Vec<ObjectId> {
        objects
            .into_iter()
            .filter(|&o| {
                filters.iter().all(|f| match f {
                    Val::Word(w) => match w.as_str() {
                        "optional" => true,
                        "other" => Some(o) != self.context.this,
                        "exhausted" => self.game.objects[o].states.contains("exhausted"),
                        "ready" => !self.game.objects[o].states.contains("exhausted"),
                        "unit-card" => self.catalog.is_unit(self.game.objects[o].card),
                        keyword => self.has_keyword(o, keyword),
                    },
                    _ => true,
                })
            })
            .collect()
    }

    /// Whether an object has a keyword, printed on its face up or given this round, by its key, case aside.
    fn has_keyword(&self, object: ObjectId, keyword: &str) -> bool {
        let o = &self.game.objects[object];
        let card = &self.catalog.cards[o.card];
        let face = &card.faces[(o.face as usize - 1).min(card.faces.len() - 1)];
        face.keywords.iter().any(|(k, _)| k.eq_ignore_ascii_case(keyword))
            || o.states.iter().any(|s| s.strip_prefix("this-round:").is_some_and(|k| k.eq_ignore_ascii_case(keyword)))
    }

    fn objects_of(&self, value: &Val) -> Vec<ObjectId> {
        match value {
            Val::Object(o) => vec![*o],
            Val::Objects(list) => list.clone(),
            Val::List(list) => list.iter().flat_map(|v| self.objects_of(v)).collect(),
            _ => Vec::new(),
        }
    }

    fn players_of(&self, value: &Val) -> Vec<Seat> {
        match value {
            Val::Player(s) => vec![*s],
            Val::Players(list) => list.clone(),
            _ => Vec::new(),
        }
    }

    fn word_of(&self, value: &Val) -> String {
        match value {
            Val::Word(w) | Val::Text(w) => w.clone(),
            Val::Card(c) => self.catalog.cards[*c].key.clone(),
            Val::Zone(z) => self.catalog.zones[*z].name.clone(),
            other => describe(other),
        }
    }

    fn int(&self, value: &Val) -> Result<i64, Stop> {
        match value {
            Val::Int(n) => Ok(*n),
            Val::Bool(b) => Ok(*b as i64),
            Val::Objects(list) => Ok(list.len() as i64),
            Val::Nothing => Ok(0),
            other => fail(format!("A number was expected, and this is {}.", describe(other))),
        }
    }

    fn truthy(&self, value: &Val) -> bool {
        match value {
            Val::Bool(b) => *b,
            Val::Int(n) => *n != 0,
            Val::Nothing => false,
            Val::Objects(list) => !list.is_empty(),
            _ => true,
        }
    }
}

/// The effects the runtime does itself, by type.
const KNOWN: &[&str] = &[
    "With", "Draw", "Damage", "Heal", "Exhaust", "Ready", "Gain", "Grant", "CantAttack", "ReadyResources", "OfferFromDeck",
    "Summon", "AddCounter", "CancelAttack",
];

fn items<T>(separated: &Separated<T>) -> Vec<&T> {
    separated.elements.iter().filter_map(|e| match e {
        Element::Item(item) => Some(item),
        Element::Separator(_) => None,
    }).collect()
}

fn describe(value: &Val) -> String {
    match value {
        Val::Nothing => "nothing".to_string(),
        Val::Int(n) => n.to_string(),
        Val::Bool(b) => b.to_string(),
        Val::Text(t) | Val::Word(t) => t.clone(),
        Val::Player(s) => format!("player {}", s),
        Val::Players(_) => "players".to_string(),
        Val::Object(o) => format!("object {}", o),
        Val::Objects(_) => "objects".to_string(),
        Val::Card(_) => "a card".to_string(),
        Val::Face(..) => "card".to_string(),
        Val::Zone(_) => "a zone".to_string(),
        Val::List(_) => "a list".to_string(),
        Val::Value(_) => "a record".to_string(),
    }
}
