//! Runs a routine's body against a game. Every change it makes goes through the core's operations (`ops.rs`), so it is
//! logged with its cause. A `choose` the routine reaches before it has an answer stops it (`Stop::Need`); the
//! scheduler (`schedule.rs`) runs it on a copy of the game, so a stopped routine has changed nothing, and runs it again
//! with the answers once they are given.
//!
//! The words a body calls (`draw`, `choose`, `units`, `damage`, `heal`…) are the libraries' vocabulary. They are Rust
//! here for now; they move into the libraries' Alex once routines on hooks run (docs/tcg/runtime-design.md, step 3).

use std::collections::BTreeMap;
use std::rc::Rc;

use super::catalog::Catalog;
use super::rules::RoutineBody;
use super::state::{Game, ObjectId, Seat};
use super::Position;
use crate::alex::syntax::{Argument, BodyStatement, Element, Expression, LiteralKind, Separated, Token};

/// What a routine runs for: the object it is attached to, the card face whose numbers it reads (`card.damage`), and
/// the player it acts for (`own`).
#[derive(Clone, Debug)]
pub struct Context {
    pub this: Option<ObjectId>,
    /// The card, by its index in the catalog, and which of its faces: 0 the front, 1 the back.
    pub card: Option<(usize, usize)>,
    pub controller: Seat,
}

/// A decision a routine is waiting for: which object `seat` picks, from `options`; with `optional`, answering
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
    /// A bare word the callee gives a meaning: a filter (`exhausted`), a keyword (`guardian`), a duration.
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
}

type Eval = Result<Val, Stop>;

fn fail<T>(message: impl Into<String>) -> Result<T, Stop> {
    Err(Stop::Fail(message.into()))
}

pub struct Run<'g> {
    pub game: &'g mut Game,
    catalog: Rc<Catalog>,
    source: usize,
    context: Context,
    routine: usize,
    answers: Vec<usize>,
    next_answer: usize,
    locals: BTreeMap<String, Val>,
}

impl<'g> Run<'g> {
    pub fn new(game: &'g mut Game, routine: usize, context: Context, answers: Vec<usize>) -> Run<'g> {
        let catalog = game.catalog.clone();
        let source = catalog.handlers.routines[routine].source;
        Run { game, catalog, source, context, routine, answers, next_answer: 0, locals: BTreeMap::new() }
    }

    /// Runs the routine: nothing for a routine that does something, its answer for one that answers yes or no.
    pub fn run(&mut self) -> Eval {
        let body = self.catalog.handlers.routines[self.routine].body.clone();
        match body {
            RoutineBody::Block(statements) => {
                self.block(&statements)?;
                Ok(Val::Nothing)
            }
            RoutineBody::Expression(expression) => self.eval(&expression),
            RoutineBody::Statement(BodyStatement::Expression(expression)) => self.eval(&expression),
            RoutineBody::Statement(statement) => {
                self.statement(&statement)?;
                Ok(Val::Nothing)
            }
        }
    }

    fn text(&self, token: &Token) -> String {
        String::from_utf8_lossy(token.text(&self.catalog.handlers.sources[self.source])).into_owned()
    }

    fn block(&mut self, statements: &[BodyStatement]) -> Result<(), Stop> {
        for statement in statements {
            self.statement(statement)?;
        }
        Ok(())
    }

    fn statement(&mut self, statement: &BodyStatement) -> Result<(), Stop> {
        match statement {
            BodyStatement::Binding { name, value, .. } => {
                let value = self.eval(value)?;
                self.locals.insert(self.text(name), value);
            }
            BodyStatement::Expression(expression) => {
                self.eval(expression)?;
            }
            BodyStatement::CompoundCall { call, operator, delta } => {
                let Expression::Call { callee, arguments, .. } = call else { return fail("A += needs a call on its left, such as x.counter(@c).") };
                let Expression::MemberAccess { receiver, name, .. } = &**callee else { return fail("A += needs a call on its left, such as x.counter(@c).") };
                if self.text(name) != "counter" {
                    return fail("Only a counter can be added to with +=.");
                }
                let receiver = self.eval(receiver)?;
                let counter = self.arguments(arguments)?.0.into_iter().next().map(|v| self.word_of(&v)).unwrap_or_default();
                let delta = self.eval(delta)?;
                let delta = self.int(&delta)?;
                let delta = if self.text(operator) == "-=" { -delta } else { delta };
                for object in self.objects_of(&receiver) {
                    self.op(|g| g.add_counter(object, &counter, delta))?;
                }
            }
            BodyStatement::If { condition, then, otherwise, .. } => {
                let condition = self.eval(condition)?;
                if self.truthy(&condition) {
                    self.block(&then.statements)?;
                } else if let Some(otherwise) = otherwise {
                    self.block(&otherwise.statements)?;
                }
            }
            BodyStatement::Section { .. } => return fail("given/when/then belong in a scenario."),
        }
        Ok(())
    }

    fn op<T>(&mut self, f: impl FnOnce(&mut Game) -> Result<T, String>) -> Result<T, Stop> {
        f(self.game).map_err(Stop::Fail)
    }

    // ── expressions ────────────────────────────────────────────────────────────────────────────

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
                    self.call(&name, args)
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
                let (l, r) = (self.int(&l)?, self.int(&r)?);
                Ok(match operator.as_str() {
                    ">=" => Val::Bool(l >= r),
                    "<=" => Val::Bool(l <= r),
                    ">" => Val::Bool(l > r),
                    "<" => Val::Bool(l < r),
                    "==" => Val::Bool(l == r),
                    "!=" => Val::Bool(l != r),
                    "+" => Val::Int(l + r),
                    "-" => Val::Int(l - r),
                    "*" => Val::Int(l * r),
                    other => return fail(format!("The runtime doesn't know the operator {}.", other)),
                })
            }
            Expression::Parenthesized { inner, .. } => self.eval(inner),
            Expression::Conditional { condition, then, otherwise, .. } => {
                let condition = self.eval(condition)?;
                if self.truthy(&condition) { self.eval(then) } else { self.eval(otherwise) }
            }
            Expression::Missing { .. } => fail("The routine has a missing expression."),
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
        if let Some(value) = self.locals.get(name) {
            return Ok(value.clone());
        }
        let seats = self.game.players.len();
        let own = self.context.controller;
        Ok(match name {
            "this" => self.context.this.map(Val::Object).unwrap_or(Val::Nothing),
            "card" => self.context.card.map(|(c, f)| Val::Face(c, f)).unwrap_or(Val::Nothing),
            "own" => Val::Player(own),
            "opponent" => Val::Player((own + 1) % seats),
            "opponents" => Val::Players((0..seats).filter(|&s| s != own).collect()),
            "all" => Val::Players((0..seats).collect()),
            // The event a routine answers (an attack it cancels) comes with events, in the next step; until then
            // there is none, and what is done to it does nothing.
            "event" => Val::Nothing,
            "attached" => self.context.this.and_then(|o| self.game.objects[o].attached_to).map(Val::Object).unwrap_or(Val::Nothing),
            "once-per-round" => {
                let key = (self.context.this.unwrap_or(usize::MAX), self.routine);
                Val::Bool(self.game.used_once.insert(key))
            }
            _ => match self.catalog.numbers.get(name) {
                Some(&n) => Val::Int(n),
                None => Val::Word(name.to_string()),
            },
        })
    }

    /// `@name`: a routine (run, and its answer used), a game constant, a zone, a card, or a name the callee reads
    /// (a resource, a counter, an action).
    fn reference(&mut self, path: &[String]) -> Eval {
        let last = path.last().cloned().unwrap_or_default();
        if path.len() == 1 {
            if let Some(&routine) = self.catalog.handlers.by_name.get(&last) {
                let mut nested = Run::new(&mut *self.game, routine, self.context.clone(), Vec::new());
                return nested.run();
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
                let face = &self.catalog.cards[o.card].faces[(o.face as usize - 1).min(self.catalog.cards[o.card].faces.len() - 1)];
                match o.counters.get(name).or_else(|| face.numbers.get(name)) {
                    Some(&n) => Val::Int(n),
                    None => Val::Nothing,
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

    // ── the libraries' words ───────────────────────────────────────────────────────────────────

    fn call(&mut self, name: &str, (args, named): (Vec<Val>, BTreeMap<String, Val>)) -> Eval {
        let own = self.context.controller;
        match name {
            "draw" => {
                let count = match args.first() {
                    Some(v) => self.int(v)?,
                    None => 1,
                };
                self.draw(own, count)?;
                Ok(Val::Nothing)
            }
            "gain" => {
                let counter = args.first().map(|v| self.word_of(v)).unwrap_or_default();
                let amount = match args.get(1) {
                    Some(v) => self.int(v)?,
                    None => 1,
                };
                self.game.adjust(own, &counter, amount);
                Ok(Val::Nothing)
            }
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
            "choose" => {
                let from = self.players_of(args.first().unwrap_or(&Val::Players(vec![own])));
                let filters = &args[1.min(args.len())..];
                let optional = filters.iter().any(|f| matches!(f, Val::Word(w) if w == "optional"));
                let options = self.units(&from, filters);
                self.choose(own, "Choose a unit.", options, optional)
            }
            "ready-resources" => {
                let count = match args.first() {
                    Some(v) => self.int(v)?,
                    None => 1,
                };
                let exhausted: Vec<ObjectId> = match self.player_property(own, "resources")? {
                    Val::Objects(list) => list.into_iter().filter(|&o| self.game.objects[o].states.contains("exhausted")).collect(),
                    _ => Vec::new(),
                };
                for object in exhausted.into_iter().take(count.max(0) as usize) {
                    self.op(|g| g.set_state(object, "exhausted", false))?;
                }
                Ok(Val::Nothing)
            }
            "offer-from-deck" => {
                let count = match args.first() {
                    Some(v) => self.int(v)?,
                    None => 1,
                };
                let exhausted = named.get("exhausted").map(|v| self.truthy(v)).unwrap_or(false);
                let (Some(deck), Some(resources)) = (self.zone(own, "deck"), self.zone(own, "resource")) else { return fail("offer-from-deck needs a deck and a resource zone.") };
                for _ in 0..count {
                    let Some(&top) = self.game.zones[deck].objects.first() else { break };
                    self.op(|g| g.move_to(top, resources, Position::Bottom))?;
                    if exhausted {
                        self.op(|g| g.set_state(top, "exhausted", true))?;
                    }
                }
                Ok(Val::Nothing)
            }
            "summon" => {
                let Some(Val::Card(card)) = args.first() else { return fail("summon takes a card: summon(@dove).") };
                let Some(board) = self.zone(own, "board") else { return fail("summon needs a zone with role = board.") };
                let card = *card;
                let object = self.game.create(card, Some(own), board);
                Ok(Val::Object(object))
            }
            other => fail(format!("The runtime doesn't run {}() yet.", other)),
        }
    }

    fn method(&mut self, receiver: &Val, name: &str, (args, named): (Vec<Val>, BTreeMap<String, Val>)) -> Eval {
        if let Val::Player(seat) = receiver {
            let mut this = Context { controller: *seat, ..self.context.clone() };
            std::mem::swap(&mut this, &mut self.context);
            let result = self.call(name, (args, named));
            std::mem::swap(&mut this, &mut self.context);
            return result;
        }
        let objects = self.objects_of(receiver);
        match name {
            "damage" => {
                let n = self.int(args.first().unwrap_or(&Val::Int(1)))?;
                for object in objects {
                    self.op(|g| g.add_counter(object, "damage", n))?;
                }
            }
            "heal" => {
                let n = self.int(args.first().unwrap_or(&Val::Int(1)))?;
                for object in objects {
                    let damage = self.game.objects[object].counters.get("damage").copied().unwrap_or(0);
                    let healed = n.min(damage);
                    if healed > 0 {
                        self.op(|g| g.add_counter(object, "damage", -healed))?;
                    }
                }
            }
            "exhaust" | "ready" => {
                for object in objects {
                    self.op(|g| g.set_state(object, "exhausted", name == "exhaust"))?;
                }
            }
            "counter" => {
                let counter = args.first().map(|v| self.word_of(v)).unwrap_or_default();
                let delta = self.int(args.get(1).unwrap_or(&Val::Int(1)))?;
                for object in objects {
                    self.op(|g| g.add_counter(object, &counter, delta))?;
                }
            }
            "buff" => {
                let power = named.get("power").map(|v| self.int(v)).transpose()?.unwrap_or(0);
                let health = named.get("health").map(|v| self.int(v)).transpose()?.unwrap_or(0);
                let keywords: Vec<String> = args.iter().filter_map(|a| match a {
                    Val::Word(w) => Some(w.clone()),
                    _ => None,
                }).collect();
                for object in objects {
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
            "has" => {
                let word = args.first().map(|v| self.word_of(v)).unwrap_or_default();
                return Ok(Val::Bool(objects.iter().all(|&o| self.has_keyword(o, &word)) && !objects.is_empty()));
            }
            "cancel" if matches!(receiver, Val::Nothing) => {}
            "grant" | "cant" | "must" => return fail(format!("{}() is for statics, which the runtime doesn't apply yet.", name)),
            other => return fail(format!("The runtime doesn't run .{}() yet.", other)),
        }
        Ok(Val::Nothing)
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
        let (Some(deck), Some(hand)) = (self.zone(seat, "deck"), self.zone(seat, "hand")) else { return fail("draw needs a deck and a hand zone.") };
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
        face.keywords.iter().any(|(k, _)| k.eq_ignore_ascii_case(keyword)) || o.states.contains(&format!("this-round:{}", keyword))
    }

    fn objects_of(&self, value: &Val) -> Vec<ObjectId> {
        match value {
            Val::Object(o) => vec![*o],
            Val::Objects(list) => list.clone(),
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
    }
}
