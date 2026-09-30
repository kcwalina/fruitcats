//! The canonical dump of documents bound together: for each document and schema, its types, its value with every
//! reference resolved, its texts, what each statement set, its declarations and its diagnostics. The C# Alex prints
//! exactly the same format (`cardengine/conformance/BoundDump.cs`), so the two binders are compared byte for byte.
//!
//! Every record, map and list is numbered in the order it is first written; a reference is written as what it names,
//! by that number. Floats are written as their bits.

use std::collections::HashMap;
use std::fmt::Write;

use super::binder::{BoundDocument, Compilation};
use super::model::*;

pub fn dump(compilation: &Compilation) -> String {
    let mut dumper = Dumper { model: &compilation.model, out: String::new(), depth: 0, ids: HashMap::new() };

    // The first pass numbers every record, map and list; the second writes, with references to those numbers.
    for _ in 0..2 {
        dumper.out.clear();
        for document in compilation.documents.iter().filter(|d| d.is_schema) {
            dumper.document("schema", document);
        }
        for document in compilation.documents.iter().filter(|d| !d.is_schema) {
            dumper.document("document", document);
        }
    }
    dumper.out
}

struct Dumper<'m> {
    model: &'m Model,
    out: String,
    depth: usize,
    ids: HashMap<ValueId, usize>,
}

impl<'m> Dumper<'m> {
    fn line(&mut self, text: &str) {
        for _ in 0..self.depth {
            self.out.push_str("  ");
        }
        self.out.push_str(text);
        self.out.push('\n');
    }

    fn document(&mut self, role: &str, document: &BoundDocument) {
        self.line(&format!("{} {}", role, document.source_name));
        self.depth += 1;
        self.line(&format!("name {}", document.name.as_deref().unwrap_or("-")));
        self.line(&format!("mode {}", if document.is_program { "program" } else { "data" }));

        self.line("types");
        self.depth += 1;
        let mut types = document.types.clone();
        types.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
        for (name, type_id) in types {
            self.type_line(&name, type_id);
        }
        self.depth -= 1;

        self.line("root");
        self.depth += 1;
        self.value(document.root);
        self.depth -= 1;

        self.line("texts");
        self.depth += 1;
        let mut texts = document.texts.clone();
        texts.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
        for (name, text) in texts {
            self.line(&name);
            self.depth += 1;
            self.value(text);
            self.depth -= 1;
        }
        self.depth -= 1;

        self.line("assignments");
        self.depth += 1;
        for path in &document.assignments {
            self.line(&path.join("."));
        }
        self.depth -= 1;

        self.line("declarations");
        self.depth += 1;
        for value in &document.declarations {
            let ValueKind::Declaration(d) = self.model.values[*value].kind else { continue };
            let declaration = &self.model.declarations[d];
            let span = self.model.values[*value].span;
            self.line(&format!("{} {} {}+{}", declaration.kind, self.model.declaration_string(d), span.start, span.length));
            self.depth += 1;
            for parameter in &declaration.parameters {
                self.line(&format!("parameter {}: {}", parameter.name, self.model.type_string(parameter.parameter_type)));
            }
            for attachment in &declaration.attachments {
                let shown = format!("@{}.{}", attachment.path.join("."), self.model.fields[attachment.member].name);
                let target = self.shown(Some(attachment.target));
                self.line(&format!("attached {} on {}", shown, target));
            }
            self.depth -= 1;
        }
        self.depth -= 1;

        self.line("diagnostics");
        self.depth += 1;
        let mut diagnostics = document.diagnostics.clone();
        diagnostics.sort_by(|a, b| {
            a.span.start.cmp(&b.span.start).then(a.span.length.cmp(&b.span.length)).then(a.message.as_bytes().cmp(b.message.as_bytes()))
        });
        for diagnostic in diagnostics {
            let severity = if diagnostic.severity == Severity::Error { "error" } else { "warning" };
            self.line(&format!("{} {}+{} {}", severity, diagnostic.span.start, diagnostic.span.length, diagnostic.message));
        }
        self.depth -= 1;
        self.depth -= 1;
    }

    fn type_line(&mut self, name: &str, type_id: TypeId) {
        match &self.model.types[type_id].kind {
            TypeKind::Record(record) => {
                let base = record.base.map(|b| format!(" : {}", self.model.record_name(b))).unwrap_or_default();
                self.line(&format!("record {}{}{}", name, base, if record.asserts_data { " asserts-data" } else { "" }));
                self.depth += 1;
                for field in record.own_fields.clone() {
                    self.field("field", field);
                }
                for member in record.own_extension_members.clone() {
                    self.field("member", member);
                }
                let mut fixed = record.own_fixed.clone();
                fixed.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
                for (fixed_name, value) in fixed {
                    self.line(&format!("fixed {}", fixed_name));
                    self.depth += 1;
                    self.value(value);
                    self.depth -= 1;
                }
                if !record.views.is_empty() {
                    let views: Vec<&str> = record.views.iter().map(|v| self.model.record_name(*v)).collect();
                    let text = format!("mapped-onto {}", views.join(", "));
                    self.line(&text);
                }
                self.depth -= 1;
            }
            TypeKind::Enum { members, backing: None, .. } => {
                let text = format!("enum {} {{ {} }}", name, members.join(", "));
                self.line(&text);
            }
            TypeKind::Enum { members, backing: Some(backing), .. } => {
                let shown: Vec<String> = members
                    .iter()
                    .map(|m| match backing.value_of(m) {
                        Some(value) => format!("{} = {}", m, self.shown(Some(value))),
                        None => m.clone(),
                    })
                    .collect();
                let text = format!("enum {} : {} {{ {} }}", name, backing.name(), shown.join(", "));
                self.line(&text);
            }
            TypeKind::Alias { target, .. } => {
                let shown = target.map(|t| self.model.type_string(t)).unwrap_or_else(|| "-".to_string());
                self.line(&format!("alias {} = {}", name, shown));
            }
            _ => {
                let text = format!("other {} {}", name, self.model.type_string(type_id));
                self.line(&text);
            }
        }
    }

    fn field(&mut self, what: &str, field: FieldId) {
        let f = &self.model.fields[field];
        let required = if self.model.is_required(field) { " required" } else { "" };
        let text = format!("{} {}: {}{}", what, f.name, self.model.type_string(f.field_type), required);
        self.line(&text);
        let Some(default) = f.default else { return };
        self.depth += 1;
        self.line("default");
        self.depth += 1;
        self.value(default);
        self.depth -= 2;
    }

    fn id(&mut self, value: ValueId) -> String {
        let next = self.ids.len() + 1;
        let id = *self.ids.entry(value).or_insert(next);
        format!("#{}", id)
    }

    fn value(&mut self, value: ValueId) {
        let span = self.model.values[value].span;
        match &self.model.values[value].kind {
            ValueKind::Object(object) => {
                let head = if object.is_map {
                    "map".to_string()
                } else {
                    let record_type = object.record_type.map(|t| self.model.record_name(t).to_string()).unwrap_or_else(|| "-".to_string());
                    format!("record {} as {}", object.type_name.as_deref().unwrap_or("-"), record_type)
                };
                let id = self.id(value);
                self.line(&format!("{} {} {}+{}", head, id, span.start, span.length));
                self.depth += 1;
                for property in object.properties.clone() {
                    self.line(&format!("{}{}", if property.is_default { "default " } else { "" }, property.name));
                    self.depth += 1;
                    self.value(property.value);
                    self.depth -= 1;
                }
                let mut extensions = object.extensions.clone();
                extensions.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
                for (member, declaration) in extensions {
                    let shown = self.shown(Some(declaration));
                    self.line(&format!("extension {} = {}", member, shown));
                }
                self.depth -= 1;
            }
            ValueKind::Array(items) => {
                let id = self.id(value);
                self.line(&format!("list {} {}+{}", id, span.start, span.length));
                self.depth += 1;
                for item in items.clone() {
                    self.value(item);
                }
                self.depth -= 1;
            }
            _ => {
                let shown = self.shown(Some(value));
                self.line(&format!("{} {}+{}", shown, span.start, span.length));
            }
        }
    }

    /// A value on one line: a scalar as itself, a record, map or list by its number, a reference as what it names.
    fn shown(&self, value: Option<ValueId>) -> String {
        let Some(value) = value else { return "unresolved".to_string() };
        let span = self.model.values[value].span;
        match &self.model.values[value].kind {
            ValueKind::Nic => "nic".to_string(),
            ValueKind::Invalid => "invalid".to_string(),
            ValueKind::Boolean(b) => if *b { "true" } else { "false" }.to_string(),
            ValueKind::Integer(i) => format!("int {}", i),
            ValueKind::Float(f) => format!("float {:016x}", f.to_bits()),
            ValueKind::Empty => "empty".to_string(),
            ValueKind::Enum { member, enum_type } => {
                format!("enum {} of {}", member, enum_type.map(|t| self.model.enum_name(t).to_string()).unwrap_or_else(|| "-".to_string()))
            }
            ValueKind::Text(text) => format!("table {}", quoted(text)),
            ValueKind::String(text) => format!("string {}", quoted(text)),
            ValueKind::Reference { path, target } => format!("ref @{} -> {}", path.join("."), self.shown(*target)),
            ValueKind::TypeValue(t) => format!("type @{}", self.model.record_name(*t)),
            ValueKind::Declaration(d) => format!("declaration {} {}", self.model.declarations[*d].kind, self.model.declaration_string(*d)),
            ValueKind::Object(_) | ValueKind::Array(_) => match self.ids.get(&value) {
                Some(id) => format!("#{}", id),
                None => {
                    let mut text = String::new();
                    let _ = write!(text, "unwritten {}+{}", span.start, span.length);
                    text
                }
            },
        }
    }
}

fn quoted(text: &str) -> String {
    let mut quoted = String::from("'");
    for c in text.chars() {
        match c {
            '\\' => quoted.push_str("\\\\"),
            '\'' => quoted.push_str("\\'"),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            _ => quoted.push(c),
        }
    }
    quoted.push('\'');
    quoted
}
