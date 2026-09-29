//! Questions a host asks a loaded project, answered as JSON: what is wrong with it, what documents it has, its cards,
//! and any document's value as bound.
//!
//! A value is written as JSON would hold it: a record as an object with its constructor under `$type` and every field,
//! the schema's defaults included; a map as an object; an enum member as its word; text as a string. A reference to a
//! record, map or list is `{"$ref": "mochi.cards.mochi", "$document": "mochi", "$path": ["cards", "mochi"]}`, so shared
//! values are written once; a reference to anything else is written as what it names.

use std::collections::HashSet;

use super::project::{declared_type, Project};
use crate::alex::model::{ValueId, ValueKind};

/// Answers `question`: `diagnostics`, `documents`, `cards`, or `value <document>`.
pub fn answer(project: &Project, question: &str) -> String {
    let question = question.trim();
    if question == "diagnostics" {
        return diagnostics(project);
    }
    if question == "documents" {
        return documents(project);
    }
    if question == "cards" {
        return cards(project);
    }
    if let Some(name) = question.strip_prefix("value ") {
        return match project.document(name.trim()) {
            Some((_, document)) => value(project, document.root),
            None => "null".to_string(),
        };
    }
    format!("{{\"error\":{}}}", string("Ask diagnostics, documents, cards, or value <document>."))
}

fn diagnostics(project: &Project) -> String {
    let items: Vec<String> = project
        .diagnostics
        .iter()
        .map(|d| {
            format!(
                "{{\"file\":{},\"line\":{},\"column\":{},\"start\":{},\"length\":{},\"severity\":{},\"message\":{}}}",
                string(&d.file),
                d.line,
                d.column,
                d.span.start,
                d.span.length,
                string(if d.is_error { "error" } else { "warning" }),
                string(&d.message)
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

fn documents(project: &Project) -> String {
    let items: Vec<String> = project
        .documents()
        .map(|(index, document)| {
            let declared = declared_type(&project.sources[index]);
            format!(
                "{{\"file\":{},\"name\":{},\"type\":{},\"program\":{}}}",
                string(&project.paths[index]),
                document.name.as_deref().map(string).unwrap_or_else(|| "null".to_string()),
                declared.as_deref().map(string).unwrap_or_else(|| "null".to_string()),
                document.is_program
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

/// Every card of every set and cards file, with the document and key it is written under.
fn cards(project: &Project) -> String {
    let model = &project.compilation.model;
    let mut items: Vec<String> = Vec::new();
    for (index, document) in project.documents() {
        let declared = declared_type(&project.sources[index]);
        if !matches!(declared.as_deref(), Some("Set") | Some("Cards")) {
            continue;
        }
        let Some(root) = model.object(document.root) else { continue };
        let Some(cards) = root.get("cards").and_then(|p| model.object(p.value)) else { continue };
        for property in &cards.properties {
            items.push(format!(
                "{{\"document\":{},\"key\":{},\"card\":{}}}",
                document.name.as_deref().map(string).unwrap_or_else(|| "null".to_string()),
                string(&property.name),
                value(project, property.value)
            ));
        }
    }
    format!("[{}]", items.join(","))
}

/// A value as JSON.
pub fn value(project: &Project, id: ValueId) -> String {
    let mut out = String::new();
    write_value(project, id, &mut out, &mut HashSet::new());
    out
}

fn write_value(project: &Project, id: ValueId, out: &mut String, open: &mut HashSet<ValueId>) {
    let model = &project.compilation.model;
    match &model.values[id].kind {
        ValueKind::Nic | ValueKind::Invalid => out.push_str("null"),
        ValueKind::Boolean(b) => out.push_str(if *b { "true" } else { "false" }),
        ValueKind::Integer(i) => out.push_str(&i.to_string()),
        ValueKind::Float(f) => out.push_str(&if f.is_finite() { format!("{}", f) } else { "null".to_string() }),
        ValueKind::Empty => out.push_str("[]"),
        ValueKind::Enum { member, .. } => out.push_str(&string(member)),
        ValueKind::String(t) | ValueKind::Text(t) => out.push_str(&string(t)),
        ValueKind::TypeValue(t) => out.push_str(&format!("{{\"$typeName\":{}}}", string(model.record_name(*t)))),
        ValueKind::Declaration(d) => {
            let declaration = &model.declarations[*d];
            out.push_str(&format!(
                "{{\"$declaration\":{},\"name\":{}}}",
                string(&declaration.kind),
                string(&model.declaration_string(*d))
            ));
        }
        ValueKind::Reference { path, target } => match target.and_then(|t| final_target(project, t)) {
            Some(target) if matches!(model.values[target].kind, ValueKind::Object(_) | ValueKind::Array(_)) => {
                let (document, at) = project.locate(target).map(|(d, p)| (project.compilation.documents[d].name.clone(), p)).unwrap_or((None, Vec::new()));
                let at: Vec<String> = at.iter().map(|s| string(s)).collect();
                out.push_str(&format!(
                    "{{\"$ref\":{},\"$document\":{},\"$path\":[{}]}}",
                    string(&path.join(".")),
                    document.as_deref().map(string).unwrap_or_else(|| "null".to_string()),
                    at.join(",")
                ));
            }
            Some(target) => write_value(project, target, out, open),
            None => out.push_str(&format!("{{\"$ref\":{},\"$unresolved\":true}}", string(&path.join(".")))),
        },
        ValueKind::Array(items) => {
            if !open.insert(id) {
                out.push_str("null");
                return;
            }
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(project, *item, out, open);
            }
            out.push(']');
            open.remove(&id);
        }
        ValueKind::Object(object) => {
            if !open.insert(id) {
                out.push_str("null");
                return;
            }
            out.push('{');
            let mut first = true;
            if !object.is_map {
                out.push_str(&format!("\"$type\":{}", object.type_name.as_deref().map(string).unwrap_or_else(|| "null".to_string())));
                first = false;
            }
            for property in &object.properties {
                if !first {
                    out.push(',');
                }
                first = false;
                out.push_str(&string(&property.name));
                out.push(':');
                write_value(project, property.value, out, open);
            }
            out.push('}');
            open.remove(&id);
        }
    }
}

fn final_target(project: &Project, value: ValueId) -> Option<ValueId> {
    let mut current = value;
    for _ in 0..64 {
        match &project.compilation.model.values[current].kind {
            ValueKind::Reference { target, .. } => current = (*target)?,
            _ => return Some(current),
        }
    }
    None
}

/// A JSON string.
pub fn string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
