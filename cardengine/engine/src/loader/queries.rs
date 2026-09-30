//! Questions a host asks a loaded project, answered as JSON: what is wrong with it, what documents it has, its cards,
//! and any document's value as bound.
//!
//! A value is written as JSON would hold it: a record as an object with its constructor under `$type` and every field,
//! the schema's defaults included; a map as an object; an enum member as its word; text as a string. A reference to a
//! record, map or list is `{"$ref": "mochi.cards.mochi", "$document": "mochi", "$path": ["cards", "mochi"]}`, so shared
//! values are written once; a reference to anything else is written as what it names.

use std::collections::HashSet;

use super::project::{declared_type, Project};
use crate::alex::model::{TypeId, ValueId, ValueKind};
use crate::render::layout::Layout;
use crate::render::raster::Raster;

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
    if question == "fonts" {
        return match Layout::new(project) {
            Ok(layout) => format!("[{}]", layout.font_files().iter().map(|f| string(f)).collect::<Vec<_>>().join(",")),
            Err(e) => error(&e),
        };
    }
    if question == "faces" || question.starts_with("faces ") {
        return faces(project, question.strip_prefix("faces").unwrap().trim());
    }
    if question == "draw-lists" || question.starts_with("draw-lists ") {
        return draw_lists(project, question.strip_prefix("draw-lists").unwrap());
    }
    if let Some(what) = question.strip_prefix("draw ") {
        return draw(project, what);
    }
    if let Some(name) = question.strip_prefix("value ") {
        return match project.document(name.trim()) {
            Some((_, document)) => value(project, document.root),
            None => "null".to_string(),
        };
    }
    error("Ask diagnostics, documents, cards, value <document>, fonts, faces [<set>], draw <set> <card> <front|back> <finish>, or draw-lists [<set>].")
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
    for (_, document) in project.documents() {
        let Some(root) = model.object(document.root) else { continue };
        if !is_a(project, root.record_type, "Set") && !is_a(project, root.record_type, "Cards") {
            continue;
        }
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

/// Whether a record type is `name` or derives from it: a game's own set type (`type FamilySet : Set`) is a set.
pub fn is_a(project: &Project, record: Option<TypeId>, name: &str) -> bool {
    let model = &project.compilation.model;
    record.is_some_and(|record| model.chain(record).iter().any(|t| model.record(*t).is_some_and(|r| r.name == name)))
}

fn error(message: &str) -> String {
    format!("{{\"error\":{}}}", string(message))
}

/// Every face the game's cards print, as `draw` names them, with the file name each is written to.
fn faces(project: &Project, only_set: &str) -> String {
    let layout = match Layout::new(project) {
        Ok(layout) => layout,
        Err(e) => return error(&e),
    };
    let items: Vec<String> = layout
        .faces(if only_set.is_empty() { None } else { Some(only_set) })
        .iter()
        .map(|f| {
            format!(
                "{{\"set\":{},\"card\":{},\"face\":{},\"finish\":{},\"file\":{},\"number\":{}}}",
                string(&layout.document_name(f)),
                string(&f.key),
                string(if f.is_back { "back" } else { "front" }),
                string(&f.finish),
                string(&layout.file_name(f)),
                string(&layout.collector_number(f))
            )
        })
        .collect();
    format!("[{}]", items.join(","))
}

/// A face's draw list (src/render/draw-list.md): `draw <set> <card> <front|back> <finish>`, then `frame=<name>` to draw
/// it in another frame and `no-art` to leave its picture see-through. A problem is answered as `{"error": ...}`.
fn draw(project: &Project, what: &str) -> String {
    let words: Vec<&str> = what.split_whitespace().collect();
    if words.len() < 4 {
        return error("Ask draw <set> <card> <front|back> <finish>.");
    }
    let mut layout = match Layout::new(project) {
        Ok(layout) => layout,
        Err(e) => return error(&e),
    };
    for option in &words[4..] {
        match option.split_once('=') {
            Some(("frame", name)) => layout.frame_override = Some(name.to_string()),
            None if *option == "no-art" => layout.no_art = true,
            _ => return error(&format!("draw doesn't take '{}'.", option)),
        }
    }
    let back = words[2] == "back";
    let found = layout
        .faces(Some(words[0]))
        .into_iter()
        .find(|f| f.key == words[1] && f.is_back == back && f.finish == words[3]);
    match found {
        Some(face) => layout.draw(&face).unwrap_or_else(|e| error(&e)),
        None => error(&format!("{} has no card {} with a {} face in the {} finish.", words[0], words[1], words[2], words[3])),
    }
}

/// A face drawn as a PNG (`project_png`): `<set> <card> <front|back> <finish>`, with `draw`'s options and `bleed` to
/// draw the card with its bleed; or a draw list itself, drawn trimmed. The project must hold the pictures and fonts the
/// face uses.
pub fn png(project: &Project, what: &str) -> Result<Vec<u8>, String> {
    if what.starts_with("kardix draw list ") {
        return crate::render::raster::png(&Raster::new(project).draw(what, false)?);
    }
    let bleed = what.split_whitespace().any(|w| w == "bleed");
    let rest: Vec<&str> = what.split_whitespace().filter(|w| *w != "bleed").collect();
    let list = draw(project, &rest.join(" "));
    if list.starts_with("{\"error\"") {
        return Err(list[10..list.len() - 2].to_string());
    }
    let mut raster = Raster::new(project);
    let pixmap = raster.draw(&list, bleed)?;
    crate::render::raster::png(&pixmap)
}

impl crate::render::raster::Files for Project {
    fn file(&self, path: &str) -> Option<&[u8]> {
        self.asset(path)
    }

    fn decoded(&self, path: &str) -> Option<std::rc::Rc<tiny_skia::Pixmap>> {
        self.decoded.borrow().get(path).cloned()
    }

    fn keep_decoded(&self, path: &str, picture: std::rc::Rc<tiny_skia::Pixmap>) {
        self.decoded.borrow_mut().insert(path.to_string(), picture);
    }
}

/// Every face's draw list, each after a line `=== <set> <card> <front|back> <finish> <file>`: `draw-lists [<set>]`, with
/// `draw`'s options, and `finish=<name>` for the faces in that finish only. A problem is answered as `{"error": ...}`.
fn draw_lists(project: &Project, what: &str) -> String {
    let mut layout = match Layout::new(project) {
        Ok(layout) => layout,
        Err(e) => return error(&e),
    };
    let mut set = None;
    let mut finish = None;
    for word in what.split_whitespace() {
        match word.split_once('=') {
            Some(("frame", name)) => layout.frame_override = Some(name.to_string()),
            Some(("finish", name)) => finish = Some(name),
            None if word == "no-art" => layout.no_art = true,
            None => set = Some(word),
            _ => return error(&format!("draw-lists doesn't take '{}'.", word)),
        }
    }
    let mut out = String::new();
    for face in layout.faces(set).into_iter().filter(|f| finish.is_none_or(|name| f.finish == name)) {
        out.push_str(&format!(
            "=== {} {} {} {} {}
",
            layout.document_name(&face),
            face.key,
            if face.is_back { "back" } else { "front" },
            face.finish,
            layout.file_name(&face)
        ));
        match layout.draw(&face) {
            Ok(list) => out.push_str(&list),
            Err(e) => return error(&e),
        }
    }
    out
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
        ValueKind::Formula { expression, document } => {
            let mut tokens = Vec::new();
            crate::alex::tokens::of_expression(expression, &mut tokens);
            let span = crate::alex::tokens::span(&tokens);
            let text = project.sources.get(*document).and_then(|b| b.get(span.range())).map(|b| String::from_utf8_lossy(b).into_owned()).unwrap_or_default();
            out.push_str(&format!("{{\"$formula\":{}}}", string(&text)));
        }
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
