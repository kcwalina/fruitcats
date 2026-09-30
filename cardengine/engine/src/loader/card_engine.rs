//! The card engine's host: four kinds of declaration; an environment whose vocabulary is read from the core's and the
//! used libraries' own maps (`selectors`, `properties`, `filters`, `verbs`, `actions`); and the card game's rules the
//! language cannot know, checked after binding: a game uses only the libraries it lists, and every ability a card
//! declares is implemented by exactly the slot named after it. A port of mochi's `CardEngineHost.cs`
//! (`mochi.agents/alex/tests/Alex.Tests`), which `cardengine/conformance` binds with on the C# side.

use std::collections::HashSet;

use crate::alex::host::{DocumentView, Host, Parameter, Scope, ScopeRequest, Signature, ValidationContext};
use crate::alex::model::*;
use crate::alex::syntax::TextSpan;

pub struct CardEngineHost {
    pub game: String,
    pub libraries: Vec<String>,
}

/// The libraries the card-engine framework has, in dependency order.
pub const LIBRARIES: [&str; 26] = [
    "common", "units", "abilities", "attachments", "combat", "decks", "families", "heroes", "initiative", "life", "life-stack", "objects",
    "permanents", "resources", "responses", "scheduling", "setup", "spells", "turns", "board", "dice", "encounter", "objectives", "reveal",
    "scenarios", "stat-cards",
];

impl CardEngineHost {
    pub fn new(game: &str) -> CardEngineHost {
        CardEngineHost { game: game.to_string(), libraries: LIBRARIES.iter().map(|l| l.to_string()).collect() }
    }
}

impl Host for CardEngineHost {
    fn kinds(&self) -> Vec<(String, BodyShape)> {
        vec![
            ("effect".to_string(), BodyShape::Statements),
            ("static".to_string(), BodyShape::Statements),
            ("condition".to_string(), BodyShape::Expression),
            ("scenario".to_string(), BodyShape::Scenario),
        ]
    }

    // A routine that returns nothing is an effect, one that returns bool a condition; 'effect' and 'condition' are their
    // deprecated spellings, and the slot types' names.
    fn routine_kinds(&self) -> Vec<(String, String)> {
        vec![(String::new(), "effect".to_string()), ("bool".to_string(), "condition".to_string())]
    }

    fn has_environment(&self) -> bool {
        true
    }

    fn scope_for(&self, model: &mut Model, request: &ScopeRequest) -> Option<Box<dyn Scope>> {
        // A body may use the vocabulary of the libraries the game uses, and no other.
        let used = used_libraries(model, &|name| request.root(name), &self.game, &self.libraries)
            .unwrap_or_else(|| self.libraries.iter().cloned().collect());
        let vocabulary: Vec<String> = self.libraries.iter().filter(|l| used.contains(*l)).cloned().collect();
        let request = OwnedRequest { kind: request.kind.clone(), attachments: request.attachments.clone(), types: request.types.clone(), roots: request.roots.clone() };
        if request.kind == "scenario" {
            return Some(Box::new(ScenarioScope::new(model, request, &vocabulary)));
        }
        Some(Box::new(RulesScope::new(model, request, &self.game, &vocabulary)))
    }

    fn validate(&self, context: &mut dyn ValidationContext) {
        let used = used_libraries(context.model(), &|name| context.document(name).map(|d| d.root), &self.game, &self.libraries);
        let documents = context.documents();
        let any_program = documents.iter().any(|d| d.is_program);
        for document in &documents {
            if document.is_program {
                continue;
            }
            let mut seen: HashSet<ValueId> = HashSet::new();
            if let Some(used) = &used {
                self.check_libraries(context, document, document.root, used, &mut seen);
            }
            if any_program {
                let key = document.name.clone().unwrap_or_else(|| "root".to_string());
                check_abilities(context, document.root, &key, &mut HashSet::new());
            }
        }

        for document in &documents {
            check_attached_parameters(context, document);
        }
    }
}

/// A slot runs its routine with no arguments, so a routine with parameters cannot be attached to one. A card's handler
/// reads its numbers from the card instead, which keeps them the numbers its text prints.
fn check_attached_parameters(context: &mut dyn ValidationContext, document: &DocumentView) {
    let mut found: Vec<(TextSpan, String)> = Vec::new();
    for declaration in context.model().declarations.iter().filter(|d| d.document == document.index) {
        let (Some(parameter), Some(attachment)) = (declaration.parameters.first(), declaration.attachments.first()) else { continue };
        let message = format!(
            "'{}' takes parameters, and @{}.{} runs it with none. A card's handler reads its numbers from the card ('card.{}', a constant it prints), so the text and the rules stay linked.",
            declaration.name.clone().unwrap_or_default(),
            attachment.path.join("."),
            context.model().fields[attachment.member].name,
            parameter.name
        );
        found.push((parameter.span, message));
    }
    for (span, message) in found {
        context.error(document.index, span, message);
    }
}

/// The libraries `game` lists in `uses`, and what they require, transitively. None when the game is not loaded.
fn used_libraries(model: &Model, root: &dyn Fn(&str) -> Option<ValueId>, game: &str, libraries: &[String]) -> Option<HashSet<String>> {
    let game_root = root(game)?;
    let mut used: HashSet<String> = HashSet::new();
    let mut pending: std::collections::VecDeque<ValueId> = std::collections::VecDeque::new();
    if let Some(uses) = value_of(model, game_root, "uses") {
        if let ValueKind::Array(items) = &model.values[uses].kind {
            pending.extend(items.iter().copied());
        }
    }
    while let Some(next) = pending.pop_front() {
        let ValueKind::Reference { target: Some(library), .. } = model.values[next].kind else { continue };
        if model.object(library).is_none() {
            continue;
        }
        for name in libraries {
            if root(name) != Some(library) || !used.insert(name.clone()) {
                continue;
            }
            if let Some(requires) = value_of(model, library, "requires") {
                if let ValueKind::Array(items) = &model.values[requires].kind {
                    pending.extend(items.iter().copied());
                }
            }
        }
    }
    Some(used)
}

/// A property's value, defaults included, or none.
fn value_of(model: &Model, object: ValueId, name: &str) -> Option<ValueId> {
    model.object(object)?.get(name).map(|p| p.value)
}

/// A record's enum member field as its word: `on = unit` is "unit".
fn member_of(model: &Model, record: ValueId, field: &str) -> Option<String> {
    match &model.values[value_of(model, record, field)?].kind {
        ValueKind::Enum { member, .. } => Some(member.clone()),
        _ => None,
    }
}

fn textual(model: &Model, value: ValueId) -> Option<&str> {
    match &model.values[value].kind {
        ValueKind::String(t) | ValueKind::Text(t) => Some(t),
        _ => None,
    }
}

/// The value at the end of a chain of references, or none when one of them did not resolve.
fn final_target(model: &Model, value: ValueId) -> Option<ValueId> {
    let mut current = value;
    let mut hops = 0;
    while let ValueKind::Reference { target, .. } = &model.values[current].kind {
        if hops >= 64 {
            return None;
        }
        hops += 1;
        current = (*target)?;
    }
    Some(current)
}

fn is_named(model: &Model, type_id: TypeId, name: &str) -> bool {
    let resolved = model.resolved(type_id);
    model.is_named(resolved, name)
}

/// `OnDefeatsInCombat` as the slot it fills: `on-defeats-in-combat`.
pub fn kebab(type_name: &str) -> String {
    let mut text = String::with_capacity(type_name.len() + 8);
    for (i, c) in type_name.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                text.push('-');
            }
            text.extend(c.to_lowercase());
        } else {
            text.push(c);
        }
    }
    text
}

fn article(word: &str) -> &'static str {
    if word.chars().next().map(|c| "aeiou".contains(c)).unwrap_or(false) { "an" } else { "a" }
}

fn constructor_span(model: &Model, object: ValueId) -> TextSpan {
    let span = model.values[object].span;
    let length = model.object(object).and_then(|o| o.type_name.as_ref()).map(|n| n.encode_utf16().count()).unwrap_or(0);
    TextSpan::new(span.start as usize, (span.length as usize).min(length))
}

/// The scope request, kept by a scope for as long as it answers.
struct OwnedRequest {
    kind: String,
    attachments: Vec<Attachment>,
    types: Vec<(String, TypeId)>,
    roots: Vec<(String, ValueId)>,
}

impl OwnedRequest {
    fn find_type(&self, name: &str) -> Option<TypeId> {
        self.types.iter().find(|(n, _)| n == name).map(|(_, t)| *t)
    }

    fn root(&self, name: &str) -> Option<ValueId> {
        self.roots.iter().find(|(n, _)| n == name).map(|(_, r)| *r)
    }
}

/// A `ParamType` member as the type a body sees.
fn param_type(model: &mut Model, param_type: &str, request: &OwnedRequest) -> TypeId {
    let find = |model: &mut Model, name: &str| request.find_type(name).unwrap_or_else(|| model.add_type(TypeKind::Invalid, TextSpan::default()));
    match param_type {
        "int" | "bool" | "text" => model.add_type(TypeKind::Named { name: param_type.to_string(), is_host: false }, TextSpan::default()),
        "token" => find(model, "Token"),
        "counter" => find(model, "Counter"),
        "keyword" => find(model, "Keyword"),
        "duration" => find(model, "Duration"),
        "action" => find(model, "ActionKind"),
        "counter-or-resource" => {
            let counter = find(model, "Counter");
            let resource = find(model, "ResourceRule");
            model.add_type(TypeKind::Union(vec![counter, resource]), TextSpan::default())
        }
        "condition" => model.add_type(TypeKind::Function { kind: "condition".to_string(), shape: BodyShape::Expression }, TextSpan::default()),
        _ => model.add_type(TypeKind::Named { name: param_type.to_string(), is_host: true }, TextSpan::default()),
    }
}

/// A map in a library's root (`verbs`), read into `into`: each entry that is a record, a later one replacing an earlier
/// one of its name in place.
fn read_map(model: &Model, root: ValueId, map: &str, into: &mut Vec<(String, ValueId)>) {
    let Some(entries) = value_of(model, root, map) else { return };
    let Some(entries) = model.object(entries) else { return };
    for property in &entries.properties {
        if model.object(property.value).is_some() {
            put(into, &property.name, property.value);
        }
    }
}

fn put(into: &mut Vec<(String, ValueId)>, name: &str, value: ValueId) {
    match into.iter_mut().find(|(n, _)| n == name) {
        Some(entry) => entry.1 = value,
        None => into.push((name.to_string(), value)),
    }
}

fn get(from: &[(String, ValueId)], name: &str) -> Option<ValueId> {
    from.iter().find(|(n, _)| n == name).map(|(_, v)| *v)
}

/// A record's parameters: its `params`, then its `optional` ones.
fn params(model: &Model, record: ValueId) -> Vec<(String, String, bool)> {
    let mut parameters = Vec::new();
    for (field, optional) in [("params", false), ("optional", true)] {
        let Some(map) = value_of(model, record, field) else { continue };
        let Some(map) = model.object(map) else { continue };
        for property in &map.properties {
            if let ValueKind::Enum { member, .. } = &model.values[property.value].kind {
                parameters.push((property.name.clone(), member.clone(), optional));
            }
        }
    }
    parameters
}

// ── effects, statics and conditions ─────────────────────────────────────────────────────────────

struct RulesScope {
    request: OwnedRequest,
    game: String,
    selectors: Vec<(String, ValueId)>,
    properties: Vec<(String, ValueId)>,
    filters: Vec<(String, ValueId)>,
    verbs: Vec<(String, ValueId)>,
    actions: Vec<(String, ValueId)>,
    int: TypeId,
}

impl RulesScope {
    fn new(model: &mut Model, request: OwnedRequest, game: &str, libraries: &[String]) -> RulesScope {
        let mut scope = RulesScope {
            int: model.add_type(TypeKind::Named { name: "int".to_string(), is_host: false }, TextSpan::default()),
            request,
            game: game.to_string(),
            selectors: Vec::new(),
            properties: Vec::new(),
            filters: Vec::new(),
            verbs: Vec::new(),
            actions: Vec::new(),
        };

        // The core's vocabulary, then each library's, under the same map names.
        let mut documents = vec!["core".to_string()];
        documents.extend(libraries.iter().cloned());
        for document in documents {
            let Some(root) = scope.request.root(&document) else { continue };
            read_map(model, root, "selectors", &mut scope.selectors);
            read_map(model, root, "properties", &mut scope.properties);
            read_map(model, root, "filters", &mut scope.filters);
            scope.read_verbs(model, root);
            read_map(model, root, "actions", &mut scope.actions);
        }
        scope
    }

    /// The verbs a declaration of this kind may call. A verb only for another kind is left out.
    fn read_verbs(&mut self, model: &Model, root: ValueId) {
        let Some(entries) = value_of(model, root, "verbs") else { return };
        let Some(entries) = model.object(entries) else { return };
        for property in &entries.properties {
            if model.object(property.value).is_none() {
                continue;
            }
            if let Some(only_in) = member_of(model, property.value, "only-in") {
                if only_in != self.request.kind {
                    continue;
                }
            }
            put(&mut self.verbs, &property.name, property.value);
        }
    }

    /// A verb on a player acts on `own` and one on a unit on `this`, so both may be called free.
    fn is_free(model: &Model, verb: ValueId) -> bool {
        match member_of(model, verb, "on") {
            None => true,
            Some(on) => on == "player" || on == "unit",
        }
    }

    /// A verb that is only for statics is refused anywhere else.
    fn allowed(&self, model: &Model, verb: ValueId) -> bool {
        match member_of(model, verb, "only-in") {
            None => true,
            Some(only_in) => only_in == self.request.kind,
        }
    }

    fn yields(&self, model: &mut Model, record: ValueId) -> Option<TypeId> {
        let yields = member_of(model, record, "yields")?;
        Some(param_type(model, &yields, &self.request))
    }

    fn signature(&self, model: &mut Model, name: &str, record: ValueId) -> Signature {
        let mut parameters = Vec::new();
        for (parameter, type_name, optional) in params(model, record) {
            let parameter_type = param_type(model, &type_name, &self.request);
            parameters.push(Parameter { name: parameter, parameter_type, is_optional: optional, absorbs: type_name == "grant" });
        }
        let result = self.yields(model, record);
        Signature { name: name.to_string(), parameters, result }
    }

    fn accepts(model: &Model, value: TypeId, target: TypeId) -> bool {
        let from = model.resolved(value);
        let to = model.resolved(target);
        if let (TypeKind::Named { name: f, .. }, TypeKind::Named { name: t, .. }) = (&model.types[from].kind, &model.types[to].kind) {
            if f == t || (f == "unit" && t == "units") || (f == "player" && t == "players") {
                return true;
            }
        }
        // A reference names a card or a zone by its record: 'summon(@dove)', 'cards(@Mist, all)'.
        if let (Some(_), TypeKind::Named { name: t, .. }) = (model.record(from), &model.types[to].kind) {
            let record = if t == "card" { "Card" } else if t == "zone" { "Zone" } else { "" };
            if !record.is_empty() && model.chain(from).iter().any(|c| model.record_name(*c) == record) {
                return true;
            }
        }
        matches!(&model.types[value].kind, TypeKind::Function { kind, .. } if kind == "condition") && is_named(model, target, "bool")
    }

    fn is_keyword(&self, model: &Model, word: &str) -> bool {
        let Some(root) = self.request.root(&self.game) else { return false };
        let Some(keywords) = value_of(model, root, "keywords") else { return false };
        let Some(keywords) = model.object(keywords) else { return false };
        keywords.properties.iter().any(|p| p.name.eq_ignore_ascii_case(word))
    }

    /// Whether the ability the declaration implements gives it an event.
    fn has_event(&self, model: &Model) -> bool {
        let Some(attachment) = self.request.attachments.first() else { return false };
        let Some(ability) = self.ability_for(model, &model.fields[attachment.member].name) else { return false };
        let has_event = model.fixed_value(ability, "event").and_then(|v| textual(model, v)).map(|t| !t.is_empty()).unwrap_or(false);
        let responds = model.fixed_value(ability, "responding").map(|v| matches!(&model.values[v].kind, ValueKind::Array(a) if !a.is_empty())).unwrap_or(false);
        has_event || responds
    }

    fn ability_for(&self, model: &Model, slot: &str) -> Option<TypeId> {
        let ability = self.request.find_type("Ability").filter(|t| model.record(*t).is_some())?;
        self.request
            .types
            .iter()
            .map(|(_, t)| *t)
            .find(|t| model.record(*t).is_some() && *t != ability && model.is_or_extends(*t, ability) && kebab(model.record_name(*t)) == slot)
    }

    /// The names every object the declaration is attached to has: its card's `constants`, or the `numbers` of the ability
    /// its slot implements.
    fn attached_numbers(&self, model: &Model, constants: bool) -> Vec<String> {
        let mut common: Option<Vec<String>> = None;
        for attachment in &self.request.attachments {
            let source = if constants { value_of(model, attachment.target, "constants").filter(|v| model.object(*v).is_some()) } else { ability_numbers(model, attachment) };
            let names: Vec<String> = source.map(|s| model.object(s).unwrap().properties.iter().map(|p| p.name.clone()).collect()).unwrap_or_default();
            common = Some(match common {
                None => names,
                Some(mut kept) => {
                    kept.retain(|n| names.contains(n));
                    kept
                }
            });
        }
        common.unwrap_or_default()
    }
}

fn ability_numbers(model: &Model, attachment: &Attachment) -> Option<ValueId> {
    let abilities = value_of(model, attachment.target, "abilities")?;
    let ValueKind::Array(items) = &model.values[abilities].kind else { return None };
    for item in items {
        let Some(ability) = model.object(*item) else { continue };
        let Some(kind) = ability.record_type else { continue };
        if kebab(model.record_name(kind)) == model.fields[attachment.member].name {
            return value_of(model, *item, "numbers").filter(|v| model.object(*v).is_some());
        }
    }
    None
}

impl Scope for RulesScope {
    fn names(&self, model: &mut Model) -> Vec<String> {
        let mut names = Vec::new();
        for (name, _) in self.selectors.clone() {
            if self.type_of(model, &name).is_some() {
                names.push(name);
            }
        }
        names
    }

    fn functions(&self, model: &mut Model) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();
        for (name, selector) in &self.selectors {
            if !params(model, *selector).is_empty() {
                names.push(name.clone());
            }
        }
        for (name, verb) in &self.verbs {
            if RulesScope::is_free(model, *verb) && self.allowed(model, *verb) {
                names.push(name.clone());
            }
        }
        names.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        names
    }

    fn bindable(&self) -> Vec<String> {
        if get(&self.selectors, "target").is_some() { vec!["target".to_string()] } else { Vec::new() }
    }

    fn can_bind(&self, name: &str) -> bool {
        name == "target" && get(&self.selectors, "target").is_some()
    }

    /// A selector without parameters is a name: `this`, `own`. `target` is bound, not given, and `event` exists only where
    /// the trigger has one.
    fn type_of(&self, model: &mut Model, name: &str) -> Option<TypeId> {
        if name == "target" {
            return None;
        }
        let selector = get(&self.selectors, name)?;
        if !params(model, selector).is_empty() {
            return None;
        }
        if name == "event" && !self.has_event(model) {
            return None;
        }
        self.yields(model, selector)
    }

    fn function(&self, model: &mut Model, name: &str) -> Option<Signature> {
        if let Some(selector) = get(&self.selectors, name) {
            if !params(model, selector).is_empty() {
                return Some(self.signature(model, name, selector));
            }
        }
        if let Some(verb) = get(&self.verbs, name) {
            if RulesScope::is_free(model, verb) && self.allowed(model, verb) {
                return Some(self.signature(model, name, verb));
            }
        }
        None
    }

    fn method(&self, model: &mut Model, receiver: TypeId, name: &str) -> Option<Signature> {
        let verb = get(&self.verbs, name)?;
        if !self.allowed(model, verb) {
            return None;
        }
        let on = member_of(model, verb, "on")?;
        let on_type = param_type(model, &on, &self.request);
        if RulesScope::accepts(model, receiver, on_type) { Some(self.signature(model, name, verb)) } else { None }
    }

    fn methods(&self, model: &mut Model, receiver: TypeId) -> Vec<String> {
        let mut names = Vec::new();
        for (name, verb) in self.verbs.clone() {
            if !self.allowed(model, verb) {
                continue;
            }
            let Some(on) = member_of(model, verb, "on") else { continue };
            let on_type = param_type(model, &on, &self.request);
            if RulesScope::accepts(model, receiver, on_type) {
                names.push(name);
            }
        }
        names.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        names
    }

    fn member(&self, model: &mut Model, receiver: TypeId, name: &str) -> Option<TypeId> {
        if let Some(property) = get(&self.properties, name) {
            if let Some(on) = member_of(model, property, "on") {
                if is_named(model, receiver, &on) {
                    let yields = member_of(model, property, "yields").unwrap_or_default();
                    return Some(param_type(model, &yields, &self.request));
                }
            }
        }

        // 'card.bonus' is a constant of the card the handler is attached to, and 'ability.damage' (deprecated) a number of
        // the ability it implements: an int when every card it is attached to has it.
        if is_named(model, receiver, "card") || is_named(model, receiver, "ability") {
            let names = self.attached_numbers(model, is_named(model, receiver, "card"));
            return if names.iter().any(|n| n == name) { Some(self.int) } else { None };
        }
        None
    }

    fn members(&self, model: &mut Model, receiver: TypeId) -> Vec<String> {
        if is_named(model, receiver, "card") || is_named(model, receiver, "ability") {
            return self.attached_numbers(model, is_named(model, receiver, "card"));
        }
        let mut names = Vec::new();
        for (name, property) in &self.properties {
            if let Some(on) = member_of(model, *property, "on") {
                if is_named(model, receiver, &on) {
                    names.push(name.clone());
                }
            }
        }
        names
    }

    fn word(&self, model: &mut Model, word: &str, expected: TypeId) -> Option<TypeId> {
        if is_named(model, expected, "filters") {
            return if get(&self.filters, word).is_some() { Some(expected) } else { None };
        }
        if is_named(model, expected, "grant") && self.is_keyword(model, word) {
            return Some(expected);
        }
        let resolved = model.resolved(expected);
        if model.record(resolved).map(|r| r.name == "ActionKind").unwrap_or(false) && get(&self.actions, word).is_some() {
            return Some(expected);
        }
        None
    }

    /// A grant absorbs its stats by name: `power: +1`.
    fn absorbed(&self, model: &mut Model, _signature: &Signature, parameter: &Parameter, name: &str) -> Option<TypeId> {
        if !is_named(model, parameter.parameter_type, "grant") {
            return None;
        }
        let grant = self.request.find_type("Grant").filter(|t| model.record(*t).is_some())?;
        let field = model.field_of(grant, name)?;
        let field_type = model.fields[field].field_type;
        let resolved = model.resolved(field_type);
        if model.is_named(resolved, "int") { Some(field_type) } else { None }
    }

    fn is_assignable(&self, model: &mut Model, value: TypeId, target: TypeId) -> bool {
        RulesScope::accepts(model, value, target)
    }
}

// ── scenarios ───────────────────────────────────────────────────────────────────────────────────

/// A scenario speaks the `scenarios` library's words (and any other used library's verbs marked `only-in = scenario`),
/// each called with what it acts on as its first argument. Names are the selectors that yield a player.
struct ScenarioScope {
    functions: Vec<(String, Signature)>,
    names: Vec<String>,
    player: TypeId,
}

impl ScenarioScope {
    fn new(model: &mut Model, request: OwnedRequest, libraries: &[String]) -> ScenarioScope {
        let player = model.add_type(TypeKind::Named { name: "player".to_string(), is_host: true }, TextSpan::default());
        let mut scope = ScenarioScope { functions: Vec::new(), names: Vec::new(), player };
        let mut documents = vec!["core".to_string()];
        documents.extend(libraries.iter().cloned());
        for document in documents {
            let Some(root) = request.root(&document) else { continue };
            if let Some(selectors) = value_of(model, root, "selectors").and_then(|v| model.object(v).cloned()) {
                for property in &selectors.properties {
                    if model.object(property.value).is_none() {
                        continue;
                    }
                    let yields_player = member_of(model, property.value, "yields").as_deref() == Some("player");
                    let has_params = value_of(model, property.value, "params")
                        .and_then(|p| model.object(p))
                        .map(|o| !o.properties.is_empty())
                        .unwrap_or(false);
                    if yields_player && !has_params && !scope.names.contains(&property.name) {
                        scope.names.push(property.name.clone());
                    }
                }
            }

            let Some(verbs) = value_of(model, root, "verbs").and_then(|v| model.object(v).cloned()) else { continue };
            for property in &verbs.properties {
                if model.object(property.value).is_some() && member_of(model, property.value, "only-in").as_deref() == Some("scenario") {
                    scope.add(model, &request, &property.name, property.value);
                }
            }
        }
        scope
    }

    fn add(&mut self, model: &mut Model, request: &OwnedRequest, name: &str, verb: ValueId) {
        let mut parameters = Vec::new();
        if let Some(on) = member_of(model, verb, "on") {
            let on_type = self.type_for(model, &on, request);
            parameters.push(Parameter { name: on, parameter_type: on_type, is_optional: false, absorbs: false });
        }
        for (parameter, type_name, optional) in params(model, verb) {
            let parameter_type = self.type_for(model, &type_name, request);
            parameters.push(Parameter { name: parameter, parameter_type, is_optional: optional, absorbs: false });
        }
        let result = member_of(model, verb, "yields").map(|y| self.type_for(model, &y, request));
        let signature = Signature { name: name.to_string(), parameters, result };
        match self.functions.iter_mut().find(|(n, _)| n == name) {
            Some(entry) => entry.1 = signature,
            None => self.functions.push((name.to_string(), signature)),
        }
    }

    /// A scenario names cards, zones and counters by reference, so those parameters take the records.
    fn type_for(&self, model: &mut Model, param: &str, request: &OwnedRequest) -> TypeId {
        let find = |model: &mut Model, name: &str| request.find_type(name).unwrap_or_else(|| model.add_type(TypeKind::Invalid, TextSpan::default()));
        match param {
            "unit" | "units" | "card" | "target" | "targets" => find(model, "Card"),
            "zone" => find(model, "Zone"),
            "player" | "players" => self.player,
            _ => param_type(model, param, request),
        }
    }
}

impl Scope for ScenarioScope {
    fn names(&self, _model: &mut Model) -> Vec<String> {
        self.names.clone()
    }

    fn type_of(&self, _model: &mut Model, name: &str) -> Option<TypeId> {
        if self.names.iter().any(|n| n == name) { Some(self.player) } else { None }
    }

    fn function(&self, _model: &mut Model, name: &str) -> Option<Signature> {
        self.functions.iter().find(|(n, _)| n == name).map(|(_, s)| s.clone())
    }

    fn functions(&self, _model: &mut Model) -> Vec<String> {
        let mut names: Vec<String> = self.functions.iter().map(|(n, _)| n.clone()).collect();
        names.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        names
    }
}

// ── validation: the card game's rules ───────────────────────────────────────────────────────────

impl CardEngineHost {
    /// A game may use a library's records, fields and values only when it lists that library.
    fn check_libraries(&self, context: &mut dyn ValidationContext, document: &DocumentView, value: ValueId, used: &HashSet<String>, seen: &mut HashSet<ValueId>) {
        match context.model().values[value].kind.clone() {
            ValueKind::Reference { path, target: Some(target) } => {
                let owner = context.document_of(target);
                if let Some(library) = unused_library(context, owner.as_ref(), used) {
                    let span = context.model().values[value].span;
                    let message = format!(
                        "'@{}' is a value of the {} library, which {} does not use. Add @{} to its uses.",
                        path.join("."),
                        library,
                        self.game,
                        library
                    );
                    context.error(document.index, span, message);
                }
            }
            ValueKind::Object(object) => {
                if !seen.insert(value) {
                    return;
                }
                if let Some(record_type) = object.record_type {
                    let owner = context.declaring_document_of_type(record_type);
                    if let Some(library) = unused_library(context, owner.as_ref(), used) {
                        let model = context.model();
                        let written = object.type_name.clone().unwrap_or_else(|| model.record_name(record_type).to_string());
                        let span = constructor_span(model, value);
                        let message = format!("'{}' comes from the {} library, which {} does not use. Add @{} to its uses.", written, library, self.game, library);
                        context.error(document.index, span, message);
                    }
                }
                for property in &object.properties {
                    if !property.is_default {
                        if let Some(field) = object.record_type.and_then(|t| context.model().field_of(t, &property.name)) {
                            let owner = context.declaring_document_of_field(field);
                            if let Some(library) = unused_library(context, owner.as_ref(), used) {
                                let message = format!(
                                    "'{}' is a field the {} library adds, and {} does not use it. Add @{} to its uses.",
                                    property.name, library, self.game, library
                                );
                                context.error(document.index, property.name_span, message);
                            }
                        }
                    }
                    self.check_libraries(context, document, property.value, used, seen);
                }
            }
            ValueKind::Array(items) => {
                for item in items {
                    self.check_libraries(context, document, item, used, seen);
                }
            }
            _ => {}
        }
    }
}

/// The name of the library `document` is when the game does not use it, or none.
fn unused_library(context: &dyn ValidationContext, document: Option<&DocumentView>, used: &HashSet<String>) -> Option<String> {
    let document = document?;
    let name = document.name.clone()?;
    let model = context.model();
    let root_type = model.object(document.root)?.record_type?;
    if model.record_name(root_type) != "Library" {
        return None;
    }
    if used.contains(&name) { None } else { Some(name) }
}

/// Every ability an object declares is implemented by the slot named after its kind, and every slot a rules document
/// fills stands for an ability the object declares. One ability of a kind per object.
fn check_abilities(context: &mut dyn ValidationContext, value: ValueId, key: &str, seen: &mut HashSet<ValueId>) {
    match context.model().values[value].kind.clone() {
        ValueKind::Object(object) => {
            if !seen.insert(value) {
                return;
            }
            check_abilities_of(context, value, key);
            for property in &object.properties {
                if !matches!(context.model().values[property.value].kind, ValueKind::Reference { .. }) {
                    check_abilities(context, property.value, &property.name, seen);
                }
            }
        }
        ValueKind::Array(items) => {
            for item in items {
                check_abilities(context, item, key, seen);
            }
        }
        _ => {}
    }
}

fn check_abilities_of(context: &mut dyn ValidationContext, holder: ValueId, key: &str) {
    let model = context.model();
    let object = model.object(holder).unwrap().clone();
    let name = value_of(model, holder, "name").and_then(|v| textual(model, v)).map(|t| t.to_string()).unwrap_or_else(|| key.to_string());
    let mut declared: HashSet<String> = HashSet::new();

    // A card prints its rules as 'text' and its handlers attach by slot, or it declares 'abilities', never both.
    let card = context.types().iter().find(|(n, _)| n == "Card").map(|(_, t)| *t).filter(|t| model.record(*t).is_some());
    let is_card = match (card, object.record_type) {
        (Some(card), Some(holder_type)) => model.is_or_viewed_as(holder_type, card),
        _ => false,
    };
    let text = object.properties.iter().find(|p| p.name == "text").cloned();
    let has_text = is_card
        && text.as_ref().map(|t| !t.is_default && final_target(model, t.value).and_then(|v| textual(model, v)).map(|s| !s.is_empty()).unwrap_or(false)).unwrap_or(false);
    let abilities = value_of(model, holder, "abilities");
    let ability_count = abilities.map(|a| match &model.values[a].kind {
        ValueKind::Array(items) => items.len(),
        _ => 0,
    });
    if has_text && ability_count.unwrap_or(0) > 0 {
        if let Some(where_) = context.document_of(holder) {
            let message = format!("{} sets both text and abilities; its printed text is its abilities' texts, so it sets one or the other.", name);
            context.error(where_.index, text.as_ref().unwrap().name_span, message);
        }
    }

    if is_card {
        check_constants_shown(context, holder, &name);
    }

    if has_text {
        if object.extensions.is_empty() {
            if let Some(where_) = context.document_of(holder) {
                let message = format!("{} has text, and no rules document gives it a handler ('@{}.on-enter = ...', or whichever slot runs it).", name, key);
                context.error(where_.index, text.unwrap().name_span, message);
            }
        }
        return;
    }

    if let Some(abilities) = abilities {
        let items = match &context.model().values[abilities].kind {
            ValueKind::Array(items) => items.clone(),
            _ => Vec::new(),
        };
        for ability in items {
            let model = context.model();
            let Some(kind) = model.object(ability).and_then(|o| o.record_type) else { continue };
            let slot = kebab(model.record_name(kind));
            let where_ = context.document_of(ability);
            let model = context.model();
            if !declared.insert(slot.clone()) {
                if let Some(where_) = where_ {
                    let span = constructor_span(model, ability);
                    context.error(where_.index, span, format!("{} declares two {} abilities; an object has one ability of each kind.", name, slot));
                }
                continue;
            }

            // An ability kind names the records that may hold it; a card of another kind has it by mistake.
            if let (Some(holders), Some(holder_type), Some(where_)) = (model.fixed_value(kind, "holders"), object.record_type, where_.clone()) {
                if let ValueKind::Array(entries) = &model.values[holders].kind {
                    let mut allowed: Vec<String> = Vec::new();
                    let mut fits = false;
                    let types = context.types();
                    for entry in entries {
                        let Some(holder_name) = textual(model, *entry) else { continue };
                        allowed.push(holder_name.to_string());
                        fits |= types.iter().find(|(n, _)| n == holder_name).map(|(_, t)| model.record(*t).is_some() && model.is_or_viewed_as(holder_type, *t)).unwrap_or(false);
                    }
                    if !fits {
                        let holder_name = model.record_name(holder_type).to_string();
                        let span = constructor_span(model, ability);
                        let message = format!(
                            "{} declares {} {} ability, which only {} may hold, and it is {} {}.",
                            name,
                            article(&slot),
                            slot,
                            allowed.join(" or "),
                            article(&holder_name),
                            holder_name
                        );
                        context.error(where_.index, span, message);
                        continue;
                    }
                }
            }

            let implemented = object.extensions.iter().any(|(n, v)| *n == slot && matches!(context.model().values[*v].kind, ValueKind::Declaration(_)));
            if !implemented {
                if let Some(where_) = where_ {
                    let span = constructor_span(context.model(), ability);
                    context.error(where_.index, span, format!("{} declares {} {} ability that no rules document implements", name, article(&slot), slot));
                }
            }
        }
    }

    for (member, assigned) in &object.extensions {
        let ValueKind::Declaration(declaration) = context.model().values[*assigned].kind else { continue };
        if declared.contains(member) {
            continue;
        }
        let attachments = context.model().declarations[declaration].attachments.clone();
        for attachment in attachments {
            if attachment.target != holder || context.model().fields[attachment.member].name != *member {
                continue;
            }
            let Some(rules) = attachment.document_name.clone() else { continue };
            let Some(rules_document) = context.document(&rules) else { continue };
            context.error(rules_document.index, attachment.span, format!("{} assigns {} on {}, which declares no such ability", rules, member, name));
        }
    }
}

/// A card's text shows its constants as `{name}`: a name the card has no constant for is an error, and so is a constant
/// no text shows. `{@name}` is a game constant and `{{` a literal brace.
fn check_constants_shown(context: &mut dyn ValidationContext, card: ValueId, name: &str) {
    let Some(where_) = context.document_of(card) else { return };
    let model = context.model();
    let mut texts: Vec<String> = Vec::new();
    let add_text = |value: Option<ValueId>, texts: &mut Vec<String>| {
        if let Some(value) = value {
            if let Some(text) = final_target(model, value).and_then(|v| textual(model, v)) {
                texts.push(text.to_string());
            }
        }
    };
    add_text(value_of(model, card, "text"), &mut texts);
    if let Some(abilities) = value_of(model, card, "abilities") {
        if let ValueKind::Array(items) = &model.values[abilities].kind {
            for item in items {
                if model.object(*item).is_some() {
                    add_text(value_of(model, *item, "text"), &mut texts);
                }
            }
        }
    }

    let constants = value_of(model, card, "constants").filter(|v| model.object(*v).is_some());
    let constant_names: Vec<(String, TextSpan)> =
        constants.map(|c| model.object(c).unwrap().properties.iter().map(|p| (p.name.clone(), p.name_span)).collect()).unwrap_or_default();
    let span = constructor_span(model, card);
    let mut shown: HashSet<String> = HashSet::new();
    let mut errors: Vec<(TextSpan, String)> = Vec::new();
    for text in &texts {
        let chars: Vec<char> = text.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] != '{' {
                i += 1;
                continue;
            }
            if i + 1 < chars.len() && chars[i + 1] == '{' {
                i += 2;
                continue;
            }
            let Some(end) = chars[i + 1..].iter().position(|c| *c == '}').map(|p| p + i + 1) else { break };
            let placeholder: String = chars[i + 1..end].iter().collect();
            i = end + 1;
            if placeholder.starts_with('@') {
                continue;
            }
            shown.insert(placeholder.clone());
            if constants.is_none() || !constant_names.iter().any(|(n, _)| *n == placeholder) {
                errors.push((
                    span,
                    format!("{}'s text shows {{{}}}, and it has no constant '{}'. Add it: 'constants = [{} = ...]'.", name, placeholder, placeholder, placeholder),
                ));
            }
        }
    }

    if constants.is_some() {
        for (constant, constant_span) in &constant_names {
            if !shown.contains(constant) {
                errors.push((
                    *constant_span,
                    format!(
                        "{} has the constant '{}', and its text never shows it. Show it as {{{}}}: players cannot play with a number they cannot see.",
                        name, constant, constant
                    ),
                ));
            }
        }
    }

    for (span, message) in errors {
        context.error(where_.index, span, message);
    }
}
