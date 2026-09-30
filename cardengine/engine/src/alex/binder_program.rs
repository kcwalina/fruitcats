//! The program layer's passes: extensions, declarations, `data`, what a consumer accepts, assignments through
//! references and required extension members. A port of `AlexBinder.Program.cs`. Bodies are checked for their shape
//! only; checking them against a host's environment is not ported yet.

use std::collections::HashSet;

use super::binder::*;
use super::model::*;
use super::syntax::{self, Body, BodyStatement, Statement, TextSpan};
use super::tokens;

impl Binder<'_> {
    // ── kinds ────────────────────────────────────────────────────────────────────────────────

    /// The function type a kind of declaration names, or none when the host registers no such kind.
    pub(super) fn function_type(&mut self, kind: &str) -> Option<TypeId> {
        if let Some(cached) = self.function_types.get(kind) {
            return Some(*cached);
        }
        let shape = self.kinds.iter().find(|(k, _)| k == kind).map(|(_, s)| *s)?;
        let id = self.model.add_type(TypeKind::Function { kind: kind.to_string(), shape }, TextSpan::default());
        self.function_types.insert(kind.to_string(), id);
        Some(id)
    }

    fn kind_list(&self) -> String {
        let mut kinds: Vec<&str> = self.kinds.iter().map(|(k, _)| k.as_str()).collect();
        kinds.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        kinds.join(", ")
    }

    pub(super) fn kinds_sentence(&self) -> String {
        if self.kinds.is_empty() { String::new() } else { format!("the kinds of declaration are {}; ", self.kind_list()) }
    }

    // ── extensions ───────────────────────────────────────────────────────────────────────────

    pub(super) fn declare_extensions(&mut self, s: usize) {
        let tree = self.states[s].tree.clone();
        let bytes = self.states[s].bytes.clone();
        for statement in &tree.root.statements {
            // In a data document the parser has already said an extension does not belong there.
            let Statement::Extension { type_name, members, .. } = statement else { continue };
            if !self.states[s].is_program || type_name.is_missing {
                continue;
            }

            let name = value_text(type_name, &bytes);
            let declared = self.type_named(&name);
            let Some(record) = declared.map(|t| self.model.resolved(t)).filter(|t| self.model.record(*t).is_some()) else {
                let message = if declared.is_none() {
                    format!("Nothing declares a record type named '{}' to extend. The record types are: {}.", name, self.record_type_names())
                } else {
                    format!("'{}' is not a record type, and only a record type can be extended.", name)
                };
                self.error(s, message, type_name.span);
                continue;
            };

            for item in items(&members.fields) {
                let (member_name, field_type, default) = match item {
                    syntax::FieldListItem::Fixed { name, .. } => {
                        if name.is_missing {
                            continue;
                        }
                        self.error(
                            s,
                            "An extension adds members; it cannot fix a field. 'name = value' belongs in a subtype's braces ('type Fabled : UnitCard { unique = true }').".to_string(),
                            name.span,
                        );
                        continue;
                    }
                    syntax::FieldListItem::Declaration { name, field_type, default, .. } => (name, field_type, default),
                };
                if member_name.is_missing {
                    continue;
                }

                let text = value_text(member_name, &bytes);
                if let Some(conflict) = self.extension_conflict(record, &text) {
                    self.error(s, conflict, member_name.span);
                    continue;
                }

                let member_type = self.bind_type(field_type, s);
                let default_value = default.as_ref().map(|d| self.build_value(d, s, false));

                // A data-typed member is an ordinary field once its extension is loaded.
                let is_extension = !self.is_data(member_type);
                let span = field_item_span(item);
                self.model.fields.push(Field { name: text, field_type: member_type, default: default_value, span, declaring_type: Some(record), is_extension });
                let field = self.model.fields.len() - 1;
                self.field_states.insert(field, s);
                let target = self.model.record_mut(record).unwrap();
                if is_extension {
                    target.own_extension_members.push(field);
                } else {
                    target.own_fields.push(field);
                }
            }
        }
    }

    /// Why `record` cannot gain an extension member called `name`, or none.
    fn extension_conflict(&self, record: TypeId, name: &str) -> Option<String> {
        let record_name = self.model.record_name(record);
        if let Some(field) = self.model.field_of(record, name) {
            let declaring = self.model.fields[field].declaring_type;
            let from = if declaring == Some(record) { String::new() } else { format!(", from '{}'", self.declaring_name(declaring)) };
            return Some(format!("'{}' already has a field '{}'{}; an extension member needs a name of its own.", record_name, name, from));
        }

        if let Some(existing) = self.model.extension_member(record, name) {
            let declaring = self.model.fields[existing].declaring_type;
            let from = if declaring == Some(record) { String::new() } else { format!(", from its extension of '{}'", self.declaring_name(declaring)) };
            return Some(format!("'{}' already has an extension member '{}'{}.", record_name, name, from));
        }

        for (_, subtype) in &self.type_names {
            if self.model.record(*subtype).is_none() || *subtype == record || !self.model.is_or_extends(*subtype, record) {
                continue;
            }
            if self.model.field_of(*subtype, name).is_some() || self.model.extension_member(*subtype, name).is_some() {
                return Some(format!(
                    "'{}' extends '{}' and already has a member '{}', so '{}' cannot gain one with that name.",
                    self.model.record_name(*subtype),
                    record_name,
                    name,
                    record_name
                ));
            }
        }
        None
    }

    pub(super) fn declaring_name(&self, declaring: Option<TypeId>) -> String {
        declaring.map(|t| self.model.record_name(t).to_string()).unwrap_or_default()
    }

    // ── declarations ─────────────────────────────────────────────────────────────────────────

    pub(super) fn declare_declarations(&mut self, s: usize) {
        // A data document's declarations were reported by the parser; they declare nothing.
        if !self.states[s].is_program {
            return;
        }

        let tree = self.states[s].tree.clone();
        let bytes = self.states[s].bytes.clone();
        let mut names_seen: HashSet<String> = HashSet::new();
        for (index, statement) in tree.root.statements.iter().enumerate() {
            let Statement::Declaration { kind, name, body } = statement else { continue };
            if kind.is_missing {
                continue;
            }

            let kind_text = value_text(kind, &bytes);
            let Some(function) = self.function_type(&kind_text) else {
                let message = if self.kinds.is_empty() {
                    format!(
                        "'{} {}' is a declaration, and nothing here registers any kinds of declaration.",
                        kind_text,
                        value_text(name, &bytes)
                    )
                } else {
                    format!("'{}' is not a kind of declaration here. The kinds are: {}.", kind_text, self.kind_list())
                };
                self.error(s, message, kind.span);
                continue;
            };

            self.check_shape(&kind_text, name, body, function, s);
            let titled = name.kind == syntax::TokenKind::String;
            let declaration_name = if titled { None } else { Some(value_text(name, &bytes)) };
            let title = if titled { Some(string_literal_text(name, &bytes)) } else { None };
            if let Some(declared) = &declaration_name {
                if !names_seen.insert(declared.clone()) {
                    self.error(s, format!("'{}' is declared twice in this document.", declared), name.span);
                    continue;
                }
                if Some(declared) == self.states[s].root_name.as_ref() {
                    self.error(s, format!("'{}' is this document's own root name; a declaration needs a name of its own.", declared), name.span);
                    continue;
                }
            }

            self.model.declarations.push(Declaration {
                kind: kind_text,
                function_type: function,
                name: declaration_name,
                title,
                document_name: self.states[s].root_name.clone(),
                attachments: Vec::new(),
                document: s,
                statement: index,
            });
            let declaration = self.model.declarations.len() - 1;
            let value = self.model.add_value(ValueKind::Declaration(declaration), statement_span(statement));
            self.states[s].declarations.push(value);
        }
    }

    /// Reports a body that does not have its kind's shape.
    fn check_shape(&mut self, kind: &str, name: &syntax::Token, body: &Body, function: TypeId, s: usize) {
        let bytes = self.states[s].bytes.clone();
        let TypeKind::Function { shape, .. } = self.model.types[function].kind else { return };
        let name_text = value_text(name, &bytes);
        match shape {
            BodyShape::Statements => match body {
                Body::Expression { equals, .. } => {
                    self.error(s, format!("The body of {} is statements in braces: '{} {} {{ ... }}'.", with_article(kind), kind, name_text), equals.span);
                }
                Body::Block(block) => self.report_sections(block, kind, s),
            },
            BodyShape::Expression => {
                if let Body::Block(block) = body {
                    if !block.open.is_missing && (block.statements.len() != 1 || !matches!(block.statements[0], BodyStatement::Expression(_))) {
                        self.error(
                            s,
                            format!("The body of {} is one expression: '{} {} {{ a >= 2 }}', or '= a >= 2'.", with_article(kind), kind, name_text),
                            block.open.span,
                        );
                    }
                }
            }
            BodyShape::Scenario => match body {
                Body::Block(block) => self.check_sections(block, kind, s),
                _ => {
                    let span = body_span(body);
                    self.error(s, format!("The body of {} is its sections in braces: 'given ...', 'when ...', 'then ...'.", with_article(kind)), span);
                }
            },
        }
    }

    fn report_sections(&mut self, block: &syntax::Block, kind: &str, s: usize) {
        let bytes = self.states[s].bytes.clone();
        for statement in &block.statements {
            match statement {
                BodyStatement::Section { label, .. } => {
                    let message = format!("'{}' starts a section of a scenario, and this is {}.", value_text(label, &bytes), with_article(kind));
                    self.error(s, message, label.span);
                }
                BodyStatement::If { then, otherwise, .. } => {
                    self.report_sections(then, kind, s);
                    if let Some(otherwise) = otherwise {
                        self.report_sections(otherwise, kind, s);
                    }
                }
                _ => {}
            }
        }
    }

    fn check_sections(&mut self, block: &syntax::Block, kind: &str, s: usize) {
        let bytes = self.states[s].bytes.clone();
        let order = ["given", "when", "then"];
        let mut next: i32 = 0;
        for statement in &block.statements {
            let BodyStatement::Section { label, .. } = statement else {
                let message = format!("A {} holds only its sections: 'given ...', 'when ...' and 'then ...'.", kind);
                self.error(s, message, body_statement_span(statement));
                continue;
            };

            let text = value_text(label, &bytes);
            let at: i32 = order.iter().position(|o| *o == text).map(|p| p as i32).unwrap_or(-1);
            if at < next {
                let how = if at == next - 1 { "twice" } else { "out of order" };
                let message = format!("'{}' comes {}. A {} has 'given', 'when' and 'then', each once and in that order.", text, how, kind);
                self.error(s, message, label.span);
                continue;
            }
            if at > next {
                let message = format!(
                    "'{}' is missing before '{}'. A {} has 'given', 'when' and 'then', each once and in that order.",
                    order[next as usize], text, kind
                );
                self.error(s, message, label.span);
            }
            next = at + 1;
        }

        if (next as usize) < order.len() && !block.close.is_missing {
            let message = format!(
                "This {} has no '{}'. A {} has 'given', 'when' and 'then', each once and in that order.",
                kind, order[next as usize], kind
            );
            self.error(s, message, block.close.span);
        }
    }

    // ── data ─────────────────────────────────────────────────────────────────────────────────

    /// Whether `type_id` is data: no function type, nor `any`, anywhere in it by value.
    pub(super) fn is_data(&self, type_id: TypeId) -> bool {
        self.not_data(type_id, &self.model.type_string(type_id)).is_empty()
    }

    /// Every place in `type_id` that keeps it from being data, as "'path' holds X".
    pub(super) fn not_data(&self, type_id: TypeId, path: &str) -> Vec<String> {
        let mut found = Vec::new();
        let mut seen = HashSet::new();
        self.collect_not_data(type_id, path, &mut found, &mut seen);
        found
    }

    fn collect_not_data(&self, type_id: TypeId, path: &str, found: &mut Vec<String>, seen: &mut HashSet<TypeId>) {
        let resolved = self.model.resolved(type_id);
        match &self.model.types[resolved].kind {
            TypeKind::Function { kind, .. } => found.push(format!("'{}' holds {}", path, kind)),
            TypeKind::Named { name, .. } if name == "any" => found.push(format!("'{}' holds any", path)),
            TypeKind::Named { name, is_host: true } => found.push(format!("'{}' holds {}", path, name)),
            TypeKind::Optional(inner) => self.collect_not_data(*inner, path, found, seen),
            TypeKind::Union(alternatives) => {
                for alternative in alternatives {
                    self.collect_not_data(*alternative, path, found, seen);
                }
            }
            TypeKind::List(element) => self.collect_not_data(*element, path, found, seen),
            TypeKind::Map(key, value) => {
                self.collect_not_data(*key, path, found, seen);
                self.collect_not_data(*value, path, found, seen);
            }
            TypeKind::Tuple(items) => {
                for item in items {
                    self.collect_not_data(*item, path, found, seen);
                }
            }
            TypeKind::Record(_) => {
                // A type that refers to itself is data unless something else in it is not: each record once.
                if !seen.insert(resolved) {
                    return;
                }
                for field in self.model.fields_of(resolved) {
                    let child = format!("{}.{}", path, self.model.fields[field].name);
                    self.collect_not_data(self.model.fields[field].field_type, &child, found, seen);
                }
            }
            _ => {}
        }
    }

    pub(super) fn check_data_assertions(&mut self) {
        for d in self.declared.clone() {
            let Some(record) = self.model.record(d.type_id) else { continue };
            if !record.asserts_data {
                continue;
            }
            let name = record.name.clone();
            let tree = self.states[d.document].tree.clone();
            let span = match &tree.root.statements[d.statement] {
                Statement::TypeDeclaration { base_name: Some(base), .. } => base.span,
                Statement::TypeDeclaration { name, .. } => name.span,
                _ => TextSpan::default(),
            };
            for offending in self.not_data(d.type_id, &name) {
                self.error(d.document, format!("'{}' is declared data, but {}, which is not data.", name, offending), span);
            }
        }
    }

    // ── what the consumer accepts ────────────────────────────────────────────────────────────

    pub(super) fn check_accept(&mut self, s: usize) {
        let state = &self.states[s];
        if state.is_schema || state.is_program || state.root_name.is_none() {
            return;
        }

        let root_type = self.model.object(state.root).unwrap().record_type;
        let at = if state.root_span.length == 0 { TextSpan::new(0, 0) } else { state.root_span };
        let Some(root_type) = root_type else { return };
        let name = self.model.record_name(root_type).to_string();
        let offending = self.not_data(root_type, &name);
        if !offending.is_empty() {
            self.error(s, format!("This document is loaded as data, and its root's type is not: {}.", offending.join("; ")), at);
        }
    }

    // ── assignments through references ───────────────────────────────────────────────────────

    pub(super) fn bind_reference_assignments(&mut self) {
        for (index, s) in self.reference_assignments.clone() {
            let tree = self.states[s].tree.clone();
            let bytes = self.states[s].bytes.clone();
            let Statement::ReferenceAssignment { target, value, .. } = &tree.root.statements[index] else { continue };
            let path = names(target, &bytes);
            let target_span = tokens::path_span(target);
            if path.len() < 2 || target_span.length == 0 {
                continue;
            }

            let member = path[path.len() - 1].clone();
            let object_path: Vec<String> = path[..path.len() - 1].to_vec();
            let candidates = self.find(&object_path[0], Some(s), true);
            if candidates.len() != 1 {
                let message = if candidates.is_empty() {
                    format!("Nothing is named '{}'.", object_path[0])
                } else {
                    self.ambiguous(&object_path[0], &candidates, s)
                };
                self.error(s, message, target_span);
                continue;
            }

            let (found, failure) = self.walk(candidates[0].value, &object_path, 1);
            let shown = format!("@{}", object_path.join("."));
            let Some(target_object) = found.filter(|f| self.model.is_record(*f)) else {
                let message = failure.unwrap_or_else(|| format!("'{}' is {}, which has no members to assign.", shown, self.describe_opt(found)));
                self.error(s, message, target_span);
                continue;
            };

            let Some(record_type) = self.model.object(target_object).unwrap().record_type else {
                self.error(s, format!("'{}' has no declared type, so it has no extension members.", shown), target_span);
                continue;
            };

            let Some(extension) = self.model.extension_member(record_type, &member) else {
                let owner_document = candidates[0].document;
                let owner = self.states[owner_document]
                    .root_name
                    .clone()
                    .unwrap_or_else(|| file_name_of(&self.states[owner_document].source_name).to_string());
                let message = if self.model.field_of(record_type, &member).is_some() {
                    format!("'{}' is a field of {}; assign it there or in a patch.", member, owner)
                } else {
                    let type_name = self.model.object(target_object).unwrap().type_name.clone().unwrap_or_else(|| self.model.record_name(record_type).to_string());
                    format!(
                        "A {} has no extension member '{}'. Its extension members are: {}.",
                        type_name,
                        member,
                        self.model.extension_member_list(record_type)
                    )
                };
                let last_segment = items(&target.segments).last().map(|t| t.span).unwrap_or(target_span);
                self.error(s, message, last_segment);
                continue;
            };

            if let Some((earlier_document, earlier_span)) = self.assigned.get(&(target_object, member.clone())).copied() {
                let place = if earlier_document == s {
                    format!("on line {}", self.states[s].line_of(earlier_span.start))
                } else {
                    let name = self.states[earlier_document].root_name.clone().unwrap_or_else(|| self.states[earlier_document].source_name.clone());
                    format!("in {} on line {}", name, self.states[earlier_document].line_of(earlier_span.start))
                };
                let message = format!("'{}.{}' is assigned twice: here and {}. An extension member is set once.", shown, member, place);
                self.error(s, message, target_span);
                continue;
            }

            let Some(declaration) = self.resolve_declaration(value, extension, s, index) else { continue };

            self.assigned.insert((target_object, member.clone()), (s, target_span));
            let extensions = &mut self.model.object_mut(target_object).unwrap().extensions;
            match extensions.iter_mut().find(|(n, _)| *n == member) {
                Some(entry) => entry.1 = declaration,
                None => extensions.push((member.clone(), declaration)),
            }
            let ValueKind::Declaration(d) = self.model.values[declaration].kind else { continue };
            let document_name = self.states[s].root_name.clone();
            self.model.declarations[d].attachments.push(Attachment { target: target_object, member: extension, path: object_path, document_name, span: target_span });
        }
    }

    pub(super) fn describe_opt(&self, value: Option<ValueId>) -> String {
        match value {
            Some(v) => self.model.describe(v),
            None => "unreadable".to_string(),
        }
    }

    /// The declaration an assignment's value names, checked against the member's kind, or none (reported).
    fn resolve_declaration(&mut self, value: &syntax::Value, member: FieldId, s: usize, statement: usize) -> Option<ValueId> {
        let bytes = self.states[s].bytes.clone();
        let member_type = self.model.fields[member].field_type;
        let member_name = self.model.fields[member].name.clone();
        let mut alternatives = Vec::new();
        self.flatten(member_type, &mut alternatives);
        let kinds: Vec<String> = alternatives
            .iter()
            .filter_map(|a| match &self.model.types[*a].kind {
                TypeKind::Function { kind, .. } => Some(kind.clone()),
                _ => None,
            })
            .collect();
        let span = value_span(value);

        if kinds.is_empty() {
            let message = format!("'{}' holds {}, which is not a kind of declaration.", member_name, self.model.type_string(member_type));
            self.error(s, message, span);
            return None;
        }

        let wanted = kinds.join(" or ");
        match value {
            syntax::Value::Missing { .. } => None,
            syntax::Value::InlineStatement { statement: inline } => self.inline_declaration(inline, span, &member_name, &kinds, s, statement),
            syntax::Value::EnumMember { enum_name: None, member: word, .. } => {
                // Resolved like an enum member against its enum: against the declarations of the member's kind.
                let name = value_text(word, &bytes);
                let mut named: Vec<ValueId> = Vec::new();
                let mut of_kind: Vec<ValueId> = Vec::new();
                for state in &self.states {
                    for declaration in &state.declarations {
                        let ValueKind::Declaration(d) = self.model.values[*declaration].kind else { continue };
                        let decl = &self.model.declarations[d];
                        if decl.name.as_deref() == Some(name.as_str()) {
                            named.push(*declaration);
                        }
                        if decl.name.is_some() && kinds.contains(&decl.kind) {
                            of_kind.push(*declaration);
                        }
                    }
                }

                let fitting: Vec<ValueId> = named.iter().copied().filter(|d| kinds.contains(&self.declaration_of(*d).kind)).collect();
                if fitting.len() == 1 {
                    return Some(fitting[0]);
                }
                if fitting.len() > 1 {
                    let which = fitting
                        .iter()
                        .map(|d| format!("@{}.{}", self.declaration_of(*d).document_name.clone().unwrap_or_default(), name))
                        .collect::<Vec<_>>()
                        .join(", ");
                    self.error(s, format!("'{}' names more than one {}; write which: {}.", name, wanted, which), span);
                    return None;
                }
                if !named.is_empty() {
                    let message = format!(
                        "'{}' is {}, and '{}' holds {}.",
                        name,
                        with_article(&self.declaration_of(named[0]).kind),
                        member_name,
                        with_article(&wanted)
                    );
                    self.error(s, message, span);
                    return None;
                }

                let declared = if of_kind.is_empty() {
                    "(none)".to_string()
                } else {
                    of_kind.iter().map(|d| self.declaration_of(*d).name.clone().unwrap_or_default()).collect::<Vec<_>>().join(", ")
                };
                let message = format!("Nothing declares {} named '{}'. The {} are: {}.", with_article(&wanted), name, plural(&wanted), declared);
                self.error(s, message, span);
                None
            }
            syntax::Value::Reference { path, .. } => {
                let path_names = names(path, &bytes);
                let shown = path_names.join(".");
                let (target, error) = self.resolve_path(&path_names, s, false);
                let Some(target) = target else {
                    self.error(s, error.unwrap_or_else(|| format!("Nothing is named '{}'.", shown)), span);
                    return None;
                };

                if let ValueKind::Declaration(d) = self.model.values[target].kind {
                    if kinds.contains(&self.model.declarations[d].kind) {
                        return Some(target);
                    }
                }
                let message = format!("'@{}' names {}, and '{}' holds {}.", shown, self.model.describe(target), member_name, with_article(&wanted));
                self.error(s, message, span);
                None
            }
            _ => {
                let message = format!(
                    "'{}' holds {}: write the name of one, as in '= zing', or one statement, as in '= draw()'.",
                    member_name,
                    with_article(&wanted)
                );
                self.error(s, message, span);
                None
            }
        }
    }

    /// `@card.slot = draw()`: a declaration of the slot's kind, with no name, whose body is the one statement. It is checked
    /// as a one-line body attached to that slot would be.
    fn inline_declaration(&mut self, inline: &BodyStatement, span: TextSpan, member_name: &str, kinds: &[String], s: usize, statement: usize) -> Option<ValueId> {
        if kinds.len() > 1 {
            let message = format!(
                "'{}' holds {}, so a statement here could be either; declare one with a name and write its name.",
                member_name,
                with_article(&kinds.join(" or "))
            );
            self.error(s, message, span);
            return None;
        }

        let kind = kinds[0].clone();
        let function = self.function_type(&kind)?;
        let TypeKind::Function { shape, .. } = self.model.types[function].kind else { return None };
        let fits = match shape {
            BodyShape::Statements => !matches!(inline, BodyStatement::Section { .. }),
            BodyShape::Expression => matches!(inline, BodyStatement::Expression(_)),
            BodyShape::Scenario => false,
        };
        if !fits {
            let message = if shape == BodyShape::Expression {
                format!("'{}' holds {}, which is one expression: '= own.resources.count >= card.offerings'.", member_name, with_article(&kind))
            } else {
                format!("'{}' holds {}, which is written as a declaration with a name.", member_name, with_article(&kind))
            };
            self.error(s, message, span);
            return None;
        }

        self.model.declarations.push(Declaration {
            kind,
            function_type: function,
            name: None,
            title: None,
            document_name: self.states[s].root_name.clone(),
            attachments: Vec::new(),
            document: s,
            statement,
        });
        let declaration = self.model.declarations.len() - 1;
        let value = self.model.add_value(ValueKind::Declaration(declaration), span);
        self.states[s].declarations.push(value);
        Some(value)
    }

    fn declaration_of(&self, value: ValueId) -> &Declaration {
        match self.model.values[value].kind {
            ValueKind::Declaration(d) => &self.model.declarations[d],
            _ => unreachable!("a declaration"),
        }
    }

    /// What `@a.b` names, from `from`, or none with the reason.
    pub(super) fn resolve_path(&mut self, path: &[String], from: usize, data_only: bool) -> (Option<ValueId>, Option<String>) {
        if path.is_empty() || path[0].is_empty() {
            return (None, None);
        }
        let candidates = self.find(&path[0], Some(from), data_only);
        if candidates.len() != 1 {
            let error = if candidates.is_empty() { format!("Nothing is named '{}'.", path[0]) } else { self.ambiguous(&path[0], &candidates, from) };
            return (None, Some(error));
        }
        let (found, failure) = self.walk(candidates[0].value, path, 1);
        let error = if found.is_none() { failure } else { None };
        (found, error)
    }

    // ── required extension members ───────────────────────────────────────────────────────────

    pub(super) fn check_required_extension_members(&mut self) {
        // Extension members are visible only in program mode: with only data documents bound, nothing requires them.
        let any_program = self.states.iter().any(|s| !s.is_schema && s.is_program);
        if !any_program {
            return;
        }

        let mut seen: HashSet<ValueId> = HashSet::new();
        for s in 0..self.states.len() {
            if self.states[s].is_schema {
                continue;
            }
            let Some(root_name) = self.states[s].root_name.clone() else { continue };
            let root = self.states[s].root;
            let root_span = self.states[s].root_span;
            self.require_extension_members(root, &root_name, root_span, s, &mut seen);
            self.walk_for_required(root, s, &mut seen);
        }
    }

    fn walk_for_required(&mut self, value: ValueId, s: usize, seen: &mut HashSet<ValueId>) {
        match self.model.values[value].kind.clone() {
            ValueKind::Object(object) => {
                for property in &object.properties {
                    if self.model.object(property.value).is_some() && !property.is_default {
                        self.require_extension_members(property.value, &property.name, property.name_span, s, seen);
                    }
                    self.walk_for_required(property.value, s, seen);
                }
            }
            ValueKind::Array(array) => {
                for item in array {
                    self.walk_for_required(item, s, seen);
                }
            }
            _ => {}
        }
    }

    fn require_extension_members(&mut self, object: ValueId, name: &str, at: TextSpan, s: usize, seen: &mut HashSet<ValueId>) {
        let Some(o) = self.model.object(object) else { return };
        if o.is_map {
            return;
        }
        let Some(type_id) = o.record_type else { return };
        if !seen.insert(object) {
            return;
        }

        let object_type_name = o.type_name.clone().unwrap_or_else(|| self.model.record_name(type_id).to_string());
        for member in self.model.extension_members(type_id) {
            let member_name = self.model.fields[member].name.clone();
            let assigned = self.model.object(object).unwrap().extensions.iter().any(|(n, _)| *n == member_name);
            if !self.model.is_required(member) || assigned {
                continue;
            }
            let declaring = self.model.fields[member].declaring_type.map(|t| self.model.record_name(t).to_string()).unwrap_or_else(|| self.model.record_name(type_id).to_string());
            let message = format!(
                "'{}' is {}, and {} requires '{}' ({}), which no program document assigns. Assign it: '@{}.{} = ...'.",
                name,
                with_article(&object_type_name),
                with_article(&declaring),
                member_name,
                self.model.type_string(self.model.fields[member].field_type),
                name,
                member_name
            );
            self.error(s, message, at);
        }
    }
}

fn plural(kind: &str) -> String {
    if kind.ends_with('s') { format!("{}es", kind) } else { format!("{}s", kind) }
}

fn file_name_of(name: &str) -> &str {
    match name.rfind(['/', '\\']) {
        Some(index) => &name[index + 1..],
        None => name,
    }
}

/// The text a string literal token holds, without its quotes and with doubled quotes read as one.
fn string_literal_text(token: &syntax::Token, source: &[u8]) -> String {
    let text = token.text(source);
    let length = if text.len() >= 2 && text[text.len() - 1] == b'\'' { text.len() - 2 } else { text.len().saturating_sub(1) };
    let start = 1.min(text.len());
    let content = &text[start..start + length];
    let mut result = Vec::with_capacity(content.len());
    let mut index = 0;
    while index < content.len() {
        result.push(content[index]);
        if content[index] == b'\'' && index + 1 < content.len() && content[index + 1] == b'\'' {
            index += 1;
        }
        index += 1;
    }
    String::from_utf8_lossy(&result).into_owned()
}

fn body_span(body: &Body) -> TextSpan {
    let mut list = Vec::new();
    tokens::of_body(body, &mut list);
    tokens::span(&list)
}

fn body_statement_span(statement: &BodyStatement) -> TextSpan {
    let mut list = Vec::new();
    tokens::of_body_statement(statement, &mut list);
    tokens::span(&list)
}
