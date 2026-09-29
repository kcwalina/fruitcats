//! The bound model: values, types and declarations, as the binder makes them. A port of `ViaMochi.Alex.Model`
//! (mochi.agents/alex); the names follow it.
//!
//! The C# model is a graph of objects that refer to each other (a reference holds its target, a record its type). Here
//! each kind of thing lives in one arena of the `Model` and refers to others by index, so a value can be shared and
//! changed in place the way the C# binder does.

use super::syntax::TextSpan;

pub type ValueId = usize;
pub type TypeId = usize;
pub type FieldId = usize;
pub type DeclarationId = usize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Warning,
    Error,
}

#[derive(Clone, Debug)]
pub struct BoundDiagnostic {
    pub severity: Severity,
    pub message: String,
    pub span: TextSpan,
}

impl BoundDiagnostic {
    pub fn error(message: String, span: TextSpan) -> BoundDiagnostic {
        BoundDiagnostic { severity: Severity::Error, message, span }
    }
}

// ── values ──────────────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct Value {
    pub kind: ValueKind,
    pub span: TextSpan,
}

#[derive(Clone, Debug)]
pub enum ValueKind {
    Nic,
    Invalid,
    Boolean(bool),
    Integer(i64),
    Float(f64),
    Empty,
    /// The member as written, and the enum it belongs to once something says which.
    Enum { member: String, enum_type: Option<TypeId> },
    /// A quoted string.
    String(String),
    /// A text table.
    Text(String),
    Reference { path: Vec<String>, target: Option<ValueId> },
    TypeValue(TypeId),
    Declaration(DeclarationId),
    Array(Vec<ValueId>),
    Object(Object),
}

#[derive(Clone, Debug)]
pub struct Object {
    pub is_map: bool,
    /// The constructor a record was written with, or none for a map.
    pub type_name: Option<String>,
    pub properties: Vec<Property>,
    /// The record type the constructor resolved to.
    pub record_type: Option<TypeId>,
    /// Whether later statements may still add to it.
    pub is_open: bool,
    /// Where it sits, from its document's root.
    pub path_from_root: Option<Vec<String>>,
    /// Extension members a program document assigned, in the order assigned.
    pub extensions: Vec<(String, ValueId)>,
}

impl Object {
    pub fn new(is_map: bool, type_name: Option<String>) -> Object {
        Object { is_map, type_name, properties: Vec::new(), record_type: None, is_open: false, path_from_root: None, extensions: Vec::new() }
    }

    pub fn find(&self, name: &str) -> Option<usize> {
        self.properties.iter().position(|p| p.name == name)
    }

    pub fn get(&self, name: &str) -> Option<&Property> {
        self.properties.iter().find(|p| p.name == name)
    }

    pub fn contains(&self, name: &str) -> bool {
        self.find(name).is_some()
    }
}

#[derive(Clone, Debug)]
pub struct Property {
    pub name: String,
    pub value: ValueId,
    pub name_span: TextSpan,
    pub span: TextSpan,
    /// The author left it out and the schema supplied it.
    pub is_default: bool,
}

// ── types ───────────────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BodyShape {
    Statements,
    Expression,
    Scenario,
}

#[derive(Clone, Debug)]
pub struct Type {
    pub kind: TypeKind,
    pub span: TextSpan,
}

#[derive(Clone, Debug)]
pub enum TypeKind {
    /// A built-in (text, int, float, bool, nic, data, any), or an opaque type a host names.
    Named { name: String, is_host: bool },
    Record(RecordType),
    /// `type R`.
    TypeOfType { record: TypeId },
    Enum { name: String, members: Vec<String> },
    Alias { name: String, target: Option<TypeId> },
    Optional(TypeId),
    Union(Vec<TypeId>),
    List(TypeId),
    Map(TypeId, TypeId),
    Tuple(Vec<TypeId>),
    Function { kind: String, shape: BodyShape },
    Invalid,
}

#[derive(Clone, Debug)]
pub struct RecordType {
    pub name: String,
    pub base: Option<TypeId>,
    pub asserts_data: bool,
    pub own_fields: Vec<FieldId>,
    pub own_extension_members: Vec<FieldId>,
    /// The inherited fields this type fixes, in the order first fixed.
    pub own_fixed: Vec<(String, ValueId)>,
    /// The record types a document maps it onto.
    pub views: Vec<TypeId>,
}

#[derive(Clone, Debug)]
pub struct Field {
    pub name: String,
    pub field_type: TypeId,
    pub default: Option<ValueId>,
    pub span: TextSpan,
    pub declaring_type: Option<TypeId>,
    pub is_extension: bool,
}

// ── declarations ────────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub struct Declaration {
    pub kind: String,
    pub function_type: TypeId,
    pub name: Option<String>,
    pub title: Option<String>,
    pub document_name: Option<String>,
    pub attachments: Vec<Attachment>,
    /// Where it is written: the document's index in the binding, and the statement's in the document.
    pub document: usize,
    pub statement: usize,
}

#[derive(Clone, Debug)]
pub struct Attachment {
    pub target: ValueId,
    pub member: FieldId,
    pub path: Vec<String>,
    pub document_name: Option<String>,
    pub span: TextSpan,
}

// ── the arenas ──────────────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct Model {
    pub values: Vec<Value>,
    pub types: Vec<Type>,
    pub fields: Vec<Field>,
    pub declarations: Vec<Declaration>,
}

pub fn is_builtin_name(name: &str) -> bool {
    matches!(name, "text" | "int" | "float" | "bool" | "nic" | "data" | "any")
}

impl Model {
    pub fn add_value(&mut self, kind: ValueKind, span: TextSpan) -> ValueId {
        self.values.push(Value { kind, span });
        self.values.len() - 1
    }

    pub fn add_type(&mut self, kind: TypeKind, span: TextSpan) -> TypeId {
        self.types.push(Type { kind, span });
        self.types.len() - 1
    }

    pub fn object(&self, id: ValueId) -> Option<&Object> {
        match &self.values[id].kind {
            ValueKind::Object(object) => Some(object),
            _ => None,
        }
    }

    pub fn object_mut(&mut self, id: ValueId) -> Option<&mut Object> {
        match &mut self.values[id].kind {
            ValueKind::Object(object) => Some(object),
            _ => None,
        }
    }

    pub fn is_record(&self, id: ValueId) -> bool {
        matches!(&self.values[id].kind, ValueKind::Object(o) if !o.is_map)
    }

    pub fn is_map(&self, id: ValueId) -> bool {
        matches!(&self.values[id].kind, ValueKind::Object(o) if o.is_map)
    }

    /// Adds a property unless one of that name is there already; whether it was added.
    pub fn try_add(&mut self, object: ValueId, property: Property) -> bool {
        let target = self.object_mut(object).expect("an object");
        if target.contains(&property.name) {
            return false;
        }
        target.properties.push(property);
        true
    }

    // ── types ────────────────────────────────────────────────────────────────────────────────

    pub fn record(&self, id: TypeId) -> Option<&RecordType> {
        match &self.types[id].kind {
            TypeKind::Record(record) => Some(record),
            _ => None,
        }
    }

    pub fn record_mut(&mut self, id: TypeId) -> Option<&mut RecordType> {
        match &mut self.types[id].kind {
            TypeKind::Record(record) => Some(record),
            _ => None,
        }
    }

    pub fn record_name(&self, id: TypeId) -> &str {
        &self.record(id).expect("a record type").name
    }

    /// The type with aliases followed through to what they name.
    pub fn resolved(&self, id: TypeId) -> TypeId {
        let mut current = id;
        let mut depth = 0;
        while let TypeKind::Alias { target: Some(target), .. } = &self.types[current].kind {
            if depth >= 64 {
                break;
            }
            depth += 1;
            current = *target;
        }
        current
    }

    pub fn is_alias(&self, id: TypeId) -> bool {
        matches!(self.types[id].kind, TypeKind::Alias { .. })
    }

    pub fn is_named(&self, id: TypeId, name: &str) -> bool {
        matches!(&self.types[id].kind, TypeKind::Named { name: n, .. } if n == name)
    }

    pub fn includes_nic(&self, id: TypeId) -> bool {
        match &self.types[id].kind {
            TypeKind::Named { name, .. } => name == "nic",
            TypeKind::Alias { .. } => {
                let resolved = self.resolved(id);
                !self.is_alias(resolved) && self.includes_nic(resolved)
            }
            TypeKind::Optional(_) => true,
            TypeKind::Union(alternatives) => alternatives.iter().any(|a| self.includes_nic(*a)),
            _ => false,
        }
    }

    /// How the type reads back, for a diagnostic.
    pub fn type_string(&self, id: TypeId) -> String {
        match &self.types[id].kind {
            TypeKind::Named { name, .. } => name.clone(),
            TypeKind::Record(record) => record.name.clone(),
            TypeKind::TypeOfType { record } => format!("type {}", self.record_name(*record)),
            TypeKind::Enum { name, .. } => name.clone(),
            TypeKind::Alias { name, .. } => name.clone(),
            TypeKind::Optional(inner) => format!("{}?", self.type_string(*inner)),
            TypeKind::Union(alternatives) => alternatives.iter().map(|a| self.type_string(*a)).collect::<Vec<_>>().join(" | "),
            TypeKind::List(element) => format!("[{}]", self.type_string(*element)),
            TypeKind::Map(key, value) => format!("[{}: {}]", self.type_string(*key), self.type_string(*value)),
            TypeKind::Tuple(items) => format!("[{}]", items.iter().map(|a| self.type_string(*a)).collect::<Vec<_>>().join(", ")),
            TypeKind::Function { kind, .. } => kind.clone(),
            TypeKind::Invalid => "?".to_string(),
        }
    }

    /// This record type and its bases, nearest first; each once, at most 64.
    pub fn chain(&self, id: TypeId) -> Vec<TypeId> {
        let mut chain: Vec<TypeId> = Vec::new();
        let mut current = Some(id);
        while let Some(c) = current {
            if chain.len() >= 64 || chain.contains(&c) {
                break;
            }
            chain.push(c);
            current = self.record(c).and_then(|r| r.base);
        }
        chain
    }

    /// Every field, the bases' first.
    pub fn fields_of(&self, id: TypeId) -> Vec<FieldId> {
        let chain = self.chain(id);
        let mut fields = Vec::new();
        for c in chain.iter().rev() {
            fields.extend(self.record(*c).unwrap().own_fields.iter().copied());
        }
        fields
    }

    pub fn field_of(&self, id: TypeId, name: &str) -> Option<FieldId> {
        self.fields_of(id).into_iter().find(|f| self.fields[*f].name == name)
    }

    pub fn field_list(&self, id: TypeId) -> String {
        let names: Vec<&str> = self.fields_of(id).iter().map(|f| self.fields[*f].name.as_str()).collect();
        if names.is_empty() { "(none)".to_string() } else { names.join(", ") }
    }

    pub fn is_required(&self, field: FieldId) -> bool {
        self.fields[field].default.is_none() && !self.includes_nic(self.fields[field].field_type)
    }

    pub fn fixed_by(&self, id: TypeId, name: &str) -> Option<TypeId> {
        self.chain(id).into_iter().find(|c| self.record(*c).unwrap().own_fixed.iter().any(|(n, _)| n == name))
    }

    pub fn fixed_value(&self, id: TypeId, name: &str) -> Option<ValueId> {
        let owner = self.fixed_by(id, name)?;
        self.record(owner).unwrap().own_fixed.iter().find(|(n, _)| n == name).map(|(_, v)| *v)
    }

    pub fn fix(&mut self, id: TypeId, name: &str, value: ValueId) {
        let record = self.record_mut(id).unwrap();
        if let Some(entry) = record.own_fixed.iter_mut().find(|(n, _)| n == name) {
            entry.1 = value;
        } else {
            record.own_fixed.push((name.to_string(), value));
        }
    }

    pub fn is_or_extends(&self, id: TypeId, other: TypeId) -> bool {
        let mut current = Some(id);
        let mut depth = 0;
        while let Some(c) = current {
            if depth >= 64 {
                break;
            }
            depth += 1;
            if c == other {
                return true;
            }
            current = self.record(c).and_then(|r| r.base);
        }
        false
    }

    /// This type, its bases, the types they are mapped onto, and so on: each once, nearest first.
    pub fn reached(&self, id: TypeId) -> Vec<TypeId> {
        let mut reached: Vec<TypeId> = Vec::new();
        let mut pending: std::collections::VecDeque<TypeId> = std::collections::VecDeque::new();
        pending.push_back(id);
        while let Some(next) = pending.pop_front() {
            for c in self.chain(next) {
                if reached.contains(&c) {
                    continue;
                }
                reached.push(c);
                for view in &self.record(c).unwrap().views {
                    pending.push_back(*view);
                }
            }
        }
        reached
    }

    pub fn is_or_viewed_as(&self, id: TypeId, other: TypeId) -> bool {
        self.reached(id).contains(&other)
    }

    pub fn map_onto(&mut self, id: TypeId, view: TypeId) {
        let record = self.record_mut(id).unwrap();
        if !record.views.contains(&view) {
            record.views.push(view);
        }
    }

    /// Every extension member: the chain's, bases first, then those of the types it is mapped onto.
    pub fn extension_members(&self, id: TypeId) -> Vec<FieldId> {
        let mut members: Vec<FieldId> = Vec::new();
        let chain = self.chain(id);
        for c in chain.iter().rev() {
            members.extend(self.record(*c).unwrap().own_extension_members.iter().copied());
        }
        let reached = self.reached(id);
        for r in reached.iter().skip(chain.len()) {
            for m in &self.record(*r).unwrap().own_extension_members {
                if !members.contains(m) {
                    members.push(*m);
                }
            }
        }
        members
    }

    pub fn extension_member(&self, id: TypeId, name: &str) -> Option<FieldId> {
        self.extension_members(id).into_iter().find(|f| self.fields[*f].name == name)
    }

    pub fn extension_member_list(&self, id: TypeId) -> String {
        let members = self.extension_members(id);
        if members.is_empty() {
            return "(none)".to_string();
        }
        members.iter().map(|m| self.fields[*m].name.as_str()).collect::<Vec<_>>().join(", ")
    }

    pub fn enum_contains(&self, id: TypeId, member: &str) -> bool {
        matches!(&self.types[id].kind, TypeKind::Enum { members, .. } if members.iter().any(|m| m == member))
    }

    pub fn enum_name(&self, id: TypeId) -> &str {
        match &self.types[id].kind {
            TypeKind::Enum { name, .. } => name,
            _ => "",
        }
    }

    pub fn member_list(&self, id: TypeId) -> String {
        match &self.types[id].kind {
            TypeKind::Enum { members, .. } if !members.is_empty() => members.join(", "),
            _ => "(none)".to_string(),
        }
    }

    /// The name of a type declaration: a record, enum or alias.
    pub fn declared_name(&self, id: TypeId) -> Option<&str> {
        match &self.types[id].kind {
            TypeKind::Record(r) => Some(&r.name),
            TypeKind::Enum { name, .. } | TypeKind::Alias { name, .. } => Some(name),
            _ => None,
        }
    }

    // ── describing values ─────────────────────────────────────────────────────────────────────

    /// How a value reads in a diagnostic (`AlexDescriptions.Describe`).
    pub fn describe(&self, id: ValueId) -> String {
        match &self.values[id].kind {
            ValueKind::Nic => "nic".to_string(),
            ValueKind::Boolean(_) => "a boolean".to_string(),
            ValueKind::Integer(_) => "a whole number".to_string(),
            ValueKind::Float(_) => "a number".to_string(),
            ValueKind::String(_) => "a string".to_string(),
            ValueKind::Text(_) => "text".to_string(),
            ValueKind::Array(_) => "a list".to_string(),
            ValueKind::Object(o) if o.is_map => "a map".to_string(),
            ValueKind::Object(Object { type_name: Some(name), .. }) => format!("a {}", name),
            ValueKind::Object(_) => "an object".to_string(),
            ValueKind::Enum { .. } => format!("the enum member '{}'", self.enum_value_name(id)),
            ValueKind::Empty => "empty".to_string(),
            ValueKind::Reference { path, .. } => format!("a reference to '{}'", path.join(".")),
            ValueKind::TypeValue(t) => format!("the type '{}'", self.record_name(*t)),
            ValueKind::Declaration(d) => format!("the {} '{}'", self.declarations[*d].kind, self.declaration_string(*d)),
            ValueKind::Invalid => "unreadable".to_string(),
        }
    }

    /// An enum member as `Enum.member`, or the member alone while no enum is known.
    pub fn enum_value_name(&self, id: ValueId) -> String {
        match &self.values[id].kind {
            ValueKind::Enum { member, enum_type: Some(t) } => format!("{}.{}", self.enum_name(*t), member),
            ValueKind::Enum { member, enum_type: None } => member.clone(),
            _ => String::new(),
        }
    }

    pub fn declaration_string(&self, id: DeclarationId) -> String {
        let declaration = &self.declarations[id];
        match &declaration.name {
            Some(name) => name.clone(),
            None => format!("'{}'", declaration.title.clone().unwrap_or_default()),
        }
    }

    pub fn is_textual(&self, id: ValueId) -> bool {
        matches!(self.values[id].kind, ValueKind::String(_) | ValueKind::Text(_))
    }
}
