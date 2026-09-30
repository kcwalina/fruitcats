//! The binder: syntax trees into the bound model. Declarations become types, statements one value graph, names the
//! values they name, and every value is checked against its type. A port of `AlexBinder.cs` (mochi.agents/alex) with
//! the same passes in the same order and the same diagnostic messages; `cardengine/conformance` compares the two.
//!
//! Binding never stops at a problem: every problem is a diagnostic on the document it is in, with a span.
//!
//! The program layer's passes are in `binder_program.rs`, type-valued fields in `binder_type_values.rs`. Bodies are
//! not checked yet: a host's environment is not ported, so bodies are checked only for their shape.

use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use super::host::Host;
use super::model::*;
use super::parser::{self, ParseMode};
use super::syntax::{self, Document as DocumentSyntax, Element, Separated, Statement, SyntaxTree, TextSpan, TextTableParts, Token};
use super::tokens;

/// One source to bind.
pub struct Source {
    /// The file name: `game.alex`.
    pub name: String,
    pub bytes: Vec<u8>,
    pub role: Role,
    /// Whether the root must be named after the file.
    pub check_root_name: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// A schema: its types are every document's; always read in program mode.
    Schema,
    /// A document its consumer accepts as data.
    Data,
    /// A document accepted as any: read in program mode.
    Any,
}

/// The kinds of declaration a host registers, with the shape each body takes, in the order the host lists them.
pub type Kinds = Vec<(String, BodyShape)>;

/// A document as bound.
pub struct BoundDocument {
    pub source_name: String,
    pub is_schema: bool,
    pub is_program: bool,
    pub name: Option<String>,
    pub root: ValueId,
    pub types: Vec<(String, TypeId)>,
    pub texts: Vec<(String, ValueId)>,
    pub assignments: Vec<Vec<String>>,
    pub declarations: Vec<ValueId>,
    pub diagnostics: Vec<BoundDiagnostic>,
}

/// Documents bound together, and the model their values and types are in.
pub struct Compilation {
    pub model: Model,
    pub documents: Vec<BoundDocument>,
    pub types: Vec<(String, TypeId)>,
}

pub fn bind(sources: Vec<Source>, host: &dyn Host, is_patch: bool) -> Compilation {
    let mut binder = Binder::new(host, is_patch);
    binder.run(sources)
}

pub(super) struct DocumentState {
    pub source_name: String,
    pub bytes: Rc<Vec<u8>>,
    pub tree: Rc<SyntaxTree>,
    pub is_schema: bool,
    pub is_program: bool,
    pub check_root_name: bool,
    pub declarations: Vec<ValueId>,
    pub diagnostics: Vec<BoundDiagnostic>,
    pub root_name: Option<String>,
    pub root: ValueId,
    pub root_span: TextSpan,
    pub texts: Vec<(String, ValueId)>,
    pub types: Vec<(String, TypeId)>,
    pub assignments: Vec<(Vec<String>, ValueId)>,
}

impl DocumentState {
    pub fn line_of(&self, offset: u32) -> usize {
        let stop = (offset as usize).min(self.bytes.len());
        1 + self.bytes[..stop].iter().filter(|b| **b == b'\n').count()
    }

    /// The file name up to its first '.', when that is an identifier.
    pub fn base_name(&self) -> Option<String> {
        if self.source_name.is_empty() {
            return None;
        }
        let file = file_name(&self.source_name);
        let base = match file.find('.') {
            Some(dot) => &file[..dot],
            None => file,
        };
        if is_identifier(base) { Some(base.to_string()) } else { None }
    }

    pub fn expected_root_name(&self) -> Option<String> {
        if self.check_root_name { self.base_name() } else { None }
    }
}

#[derive(Clone)]
pub(super) struct Member {
    pub value: ValueId,
    pub path: Vec<String>,
    pub document: usize,
}

pub(super) struct PendingReference {
    pub reference: ValueId,
    pub document: usize,
    pub failure: Option<String>,
    pub reported: bool,
    pub resolving: bool,
    pub attempted: bool,
}

pub(super) struct PendingNameof {
    pub path: Vec<String>,
    pub span: TextSpan,
    pub document: usize,
}

/// A type declaration and where it is: its document and its statement.
#[derive(Clone, Copy)]
pub(super) struct Declared {
    pub type_id: TypeId,
    pub document: usize,
    pub statement: usize,
}

pub(super) struct Binder<'h> {
    pub host: &'h dyn Host,
    pub model: Model,
    pub kinds: Kinds,
    pub routines: Vec<(String, String)>,
    pub is_patch: bool,
    pub states: Vec<DocumentState>,
    pub type_names: Vec<(String, TypeId)>,
    pub type_index: HashMap<String, TypeId>,
    /// A document's types that hide a schema's of the same name, seen only from documents.
    pub document_types: Vec<(String, TypeId)>,
    pub declared: Vec<Declared>,
    pub members: HashMap<String, Vec<Member>>,
    pub references: Vec<PendingReference>,
    pub reference_lookup: HashMap<ValueId, usize>,
    pub nameofs: Vec<PendingNameof>,
    pub closed_at: HashMap<ValueId, TextSpan>,
    pub typed: bool,
    // The program layer.
    pub reference_assignments: Vec<(usize, usize)>,
    pub assigned: HashMap<(ValueId, String), (usize, TextSpan)>,
    pub function_types: HashMap<String, TypeId>,
    // Type-valued fields.
    pub mapped_objects: HashSet<ValueId>,
    pub reported_type_values: HashSet<ValueId>,
    pub trials: i32,
    /// Where each union trial under way reports: thrown away when it ends.
    pub trial_sinks: Vec<Vec<BoundDiagnostic>>,
    /// The document that declares each type, and each field (a field an extension adds: the extension's).
    pub type_states: HashMap<TypeId, usize>,
    pub field_states: HashMap<FieldId, usize>,
    /// Which document each value is written in, for the host's validation; made when first asked.
    pub value_documents: Option<HashMap<ValueId, usize>>,
}

impl<'h> Binder<'h> {
    fn new(host: &'h dyn Host, is_patch: bool) -> Binder<'h> {
        Binder {
            host,
            model: Model::default(),
            kinds: host.kinds(),
            routines: host.routine_kinds(),
            is_patch,
            states: Vec::new(),
            type_names: Vec::new(),
            type_index: HashMap::new(),
            document_types: Vec::new(),
            declared: Vec::new(),
            members: HashMap::new(),
            references: Vec::new(),
            reference_lookup: HashMap::new(),
            nameofs: Vec::new(),
            closed_at: HashMap::new(),
            typed: false,
            reference_assignments: Vec::new(),
            assigned: HashMap::new(),
            function_types: HashMap::new(),
            mapped_objects: HashSet::new(),
            reported_type_values: HashSet::new(),
            trials: 0,
            trial_sinks: Vec::new(),
            type_states: HashMap::new(),
            field_states: HashMap::new(),
            value_documents: None,
        }
    }

    pub fn error(&mut self, document: usize, message: String, span: TextSpan) {
        self.states[document].diagnostics.push(BoundDiagnostic::error(message, span));
    }

    /// The type `name` names in document `s`: a document's own type hides a schema's, and a schema sees only the schemas'.
    pub fn type_named(&self, name: &str, s: usize) -> Option<TypeId> {
        if !self.states[s].is_schema {
            if let Some((_, shadowing)) = self.document_types.iter().find(|(n, _)| n == name) {
                return Some(*shadowing);
            }
        }
        self.type_index.get(name).copied()
    }

    /// Every declared type, then the ones documents declare to hide a schema's.
    pub fn all_types(&self) -> Vec<TypeId> {
        self.type_names.iter().chain(self.document_types.iter()).map(|(_, t)| *t).collect()
    }

    // ── the passes ───────────────────────────────────────────────────────────────────────────

    fn run(&mut self, sources: Vec<Source>) -> Compilation {
        // Schemas first, as the C# binder lists them.
        let mut ordered: Vec<Source> = Vec::new();
        let mut documents: Vec<Source> = Vec::new();
        for source in sources {
            if source.role == Role::Schema { ordered.push(source) } else { documents.push(source) }
        }
        ordered.extend(documents);

        for source in ordered {
            let is_schema = source.role == Role::Schema;
            let is_program = source.role != Role::Data;
            let tree = parser::parse(&source.bytes, if is_program { ParseMode::Program } else { ParseMode::Data });
            let root = self.model.add_value(ValueKind::Object(Object::new(false, None)), TextSpan::new(0, 0));
            let mut state = DocumentState {
                source_name: source.name,
                bytes: Rc::new(source.bytes),
                tree: Rc::new(tree),
                is_schema,
                is_program,
                check_root_name: source.check_root_name,
                declarations: Vec::new(),
                diagnostics: Vec::new(),
                root_name: None,
                root,
                root_span: TextSpan::default(),
                texts: Vec::new(),
                types: Vec::new(),
                assignments: Vec::new(),
            };
            for diagnostic in &state.tree.diagnostics {
                state.diagnostics.push(BoundDiagnostic::error(diagnostic.message.clone(), diagnostic.span));
            }
            self.states.push(state);
        }

        let count = self.states.len();
        for s in 0..count {
            self.declare_types(s);
        }
        self.complete_types();
        for s in 0..count {
            self.declare_extensions(s);
        }
        self.fix_all_fields();
        self.typed = !self.type_names.is_empty();

        for s in 0..count {
            self.build_document(s);
        }
        for s in 0..count {
            self.declare_declarations(s);
        }
        self.index_members();
        for s in 0..count {
            self.apply_text_tables(s);
        }
        self.index_members();

        let mut i = 0;
        while i < self.references.len() {
            self.resolve(i);
            i += 1;
        }
        for s in 0..count {
            let root = self.states[s].root;
            self.resolve_constructors(root, s);
        }
        for d in self.declared.clone() {
            let Some(record) = self.model.record(d.type_id) else { continue };
            let defaults: Vec<ValueId> = record.own_fields.iter().filter_map(|f| self.model.fields[*f].default).collect();
            let fixed: Vec<ValueId> = record.own_fixed.iter().map(|(_, v)| *v).collect();
            for value in defaults.into_iter().chain(fixed) {
                self.resolve_constructors(value, d.document);
            }
        }

        // Types named where a field expects one ('types = [@Creature]') are mapped before anything is checked.
        for s in 0..count {
            let root = self.states[s].root;
            self.map_type_values(root, None, s);
        }
        self.check_defaults();
        for s in 0..count {
            self.check_document(s);
        }
        self.check_data_assertions();
        for s in 0..count {
            self.check_accept(s);
        }
        self.bind_reference_assignments();
        self.check_bodies();
        self.report_unresolved_references();
        self.check_nameofs();
        self.check_required_extension_members();
        let host = self.host;
        host.validate(self);

        let mut bound = Vec::new();
        for state in &mut self.states {
            bound.push(BoundDocument {
                source_name: state.source_name.clone(),
                is_schema: state.is_schema,
                is_program: state.is_program,
                name: state.root_name.clone(),
                root: state.root,
                types: state.types.clone(),
                texts: state.texts.clone(),
                assignments: state.assignments.iter().map(|(p, _)| p.clone()).collect(),
                declarations: state.declarations.clone(),
                diagnostics: std::mem::take(&mut state.diagnostics),
            });
        }
        Compilation { model: std::mem::take(&mut self.model), documents: bound, types: self.type_names.clone() }
    }

    // ── declarations ─────────────────────────────────────────────────────────────────────────

    fn declare_types(&mut self, s: usize) {
        let tree = self.states[s].tree.clone();
        let bytes = self.states[s].bytes.clone();
        for (index, statement) in tree.root.statements.iter().enumerate() {
            let (name, type_kind) = match statement {
                Statement::TypeDeclaration { name, alias, .. } => {
                    let text = value_text(name, &bytes);
                    let kind = if alias.is_some() {
                        TypeKind::Alias { name: text, target: None }
                    } else {
                        TypeKind::Record(RecordType {
                            name: text,
                            base: None,
                            asserts_data: false,
                            own_fields: Vec::new(),
                            own_extension_members: Vec::new(),
                            own_fixed: Vec::new(),
                            views: Vec::new(),
                        })
                    };
                    (name, kind)
                }
                Statement::EnumDeclaration { name, .. } => (name, TypeKind::Enum { name: value_text(name, &bytes), members: Vec::new(), backing: None }),
                _ => continue,
            };

            if name.is_missing {
                continue;
            }
            let text = value_text(name, &bytes);
            if is_builtin_name(&text) {
                self.error(s, format!("'{}' is a built-in type and cannot be declared again.", text), name.span);
                continue;
            }
            // A document may declare a type a schema has: its own hides the schema's, for the documents (8.1).
            let shadows = !self.states[s].is_schema
                && !self.document_types.iter().any(|(n, _)| *n == text)
                && self.type_index.get(&text).and_then(|t| self.type_states.get(t)).map(|d| self.states[*d].is_schema).unwrap_or(false);
            if self.type_index.contains_key(&text) && !shadows {
                self.error(s, format!("A type named '{}' is already declared.", text), name.span);
                continue;
            }

            let span = statement_span(statement);
            let type_id = self.model.add_type(type_kind, span);
            if shadows {
                self.document_types.push((text.clone(), type_id));
            } else {
                self.type_index.insert(text.clone(), type_id);
                self.type_names.push((text.clone(), type_id));
            }
            self.states[s].types.push((text, type_id));
            self.type_states.insert(type_id, s);
            self.declared.push(Declared { type_id, document: s, statement: index });
        }
    }

    fn complete_types(&mut self) {
        for d in self.declared.clone() {
            let tree = self.states[d.document].tree.clone();
            let bytes = self.states[d.document].bytes.clone();
            let statement = &tree.root.statements[d.statement];
            match (&self.model.types[d.type_id].kind, statement) {
                (TypeKind::Record(_), Statement::TypeDeclaration { .. }) => self.complete_record(d.type_id, statement, d.document),
                (TypeKind::Alias { .. }, Statement::TypeDeclaration { alias: Some(alias), .. }) => {
                    let target = self.bind_type(alias, d.document);
                    if let TypeKind::Alias { target: t, .. } = &mut self.model.types[d.type_id].kind {
                        *t = Some(target);
                    }
                }
                (TypeKind::Enum { .. }, Statement::EnumDeclaration { backing, members, .. }) => {
                    self.complete_enum(d.type_id, backing.as_ref(), members, d.document, &bytes);
                }
                _ => {}
            }
        }

        for d in self.declared.clone() {
            let tree = self.states[d.document].tree.clone();
            let name_span = match &tree.root.statements[d.statement] {
                Statement::TypeDeclaration { name, .. } => name.span,
                _ => TextSpan::default(),
            };
            if self.model.record(d.type_id).is_some() && self.has_base_cycle(d.type_id) {
                let name = self.model.record_name(d.type_id).to_string();
                self.error(d.document, format!("'{}' extends itself through its bases.", name), name_span);
                self.model.record_mut(d.type_id).unwrap().base = None;
            }
            if self.model.is_alias(d.type_id) && self.model.is_alias(self.model.resolved(d.type_id)) {
                let name = self.model.declared_name(d.type_id).unwrap_or_default().to_string();
                self.error(d.document, format!("'{}' names itself: an alias must end at a real type.", name), name_span);
                let span = self.model.types[d.type_id].span;
                let invalid = self.model.add_type(TypeKind::Invalid, span);
                if let TypeKind::Alias { target, .. } = &mut self.model.types[d.type_id].kind {
                    *target = Some(invalid);
                }
            }
        }

        for d in self.declared.clone() {
            let Some(record) = self.model.record(d.type_id) else { continue };
            let Some(base) = record.base else { continue };
            for field in record.own_fields.clone() {
                let name = self.model.fields[field].name.clone();
                if self.model.field_of(base, &name).is_some() {
                    let message = format!(
                        "'{}' declares '{}', which its base '{}' already declares.",
                        self.model.record_name(d.type_id),
                        name,
                        self.model.record_name(base)
                    );
                    let span = self.model.fields[field].span;
                    self.error(d.document, message, span);
                }
            }
        }
    }

    /// Checks and records every fixed field, once bases and extensions have given each type all its fields.
    fn fix_all_fields(&mut self) {
        for d in self.declared.clone() {
            if self.model.record(d.type_id).is_none() {
                continue;
            }
            let tree = self.states[d.document].tree.clone();
            if let Statement::TypeDeclaration { fields: Some(fields), .. } = &tree.root.statements[d.statement] {
                self.fix_fields(d.type_id, fields, d.document);
            }
        }
    }

    fn fix_fields(&mut self, record: TypeId, fields: &syntax::FieldList, s: usize) {
        let bytes = self.states[s].bytes.clone();
        for item in items(&fields.fields) {
            let syntax::FieldListItem::Fixed { name: name_token, value, .. } = item else { continue };
            if name_token.is_missing {
                continue;
            }
            let name = value_text(name_token, &bytes);
            let base = self.model.record(record).unwrap().base;
            let inherited = base.and_then(|b| self.model.field_of(b, &name));
            let record_name = self.model.record_name(record).to_string();
            if inherited.is_none() {
                let own = self.model.record(record).unwrap().own_fields.iter().any(|f| self.model.fields[*f].name == name);
                let message = if own {
                    format!(
                        "'{}' declares '{}' itself; a type fixes only a field it inherits. Give it a default ('{}: T = value') instead.",
                        record_name, name, name
                    )
                } else if let Some(base) = base {
                    format!("'{}' inherits no field '{}' to fix. It inherits: {}.", record_name, name, self.model.field_list(base))
                } else {
                    format!("'{} = ...' fixes an inherited field, and '{}' has no base to inherit one from.", name, record_name)
                };
                self.error(s, message, name_token.span);
                continue;
            }

            if let Some(fixed_by) = self.model.fixed_by(base.unwrap(), &name) {
                let message = format!(
                    "'{}' is already fixed by '{}', so '{}' cannot fix it again.",
                    name,
                    self.model.record_name(fixed_by),
                    record_name
                );
                self.error(s, message, name_token.span);
                continue;
            }

            if self.model.record(record).unwrap().own_fixed.iter().any(|(n, _)| *n == name) {
                self.error(s, format!("'{}' fixes '{}' twice.", record_name, name), name_token.span);
                continue;
            }

            let built = self.build_value(value, s, false);
            self.model.fix(record, &name, built);
        }
    }

    fn complete_record(&mut self, record: TypeId, statement: &Statement, s: usize) {
        let Statement::TypeDeclaration { base_name, fields, .. } = statement else { return };
        let bytes = self.states[s].bytes.clone();
        let record_name = self.model.record_name(record).to_string();
        if let Some(base_token) = base_name.as_ref().filter(|t| !t.is_missing) {
            let base_text = value_text(base_token, &bytes);
            if !base_token.is_type_name(&bytes) {
                if base_token.is(&bytes, b"data") {
                    self.model.record_mut(record).unwrap().asserts_data = true;
                } else {
                    self.error(
                        s,
                        format!(
                            "After ':' comes the base type's name, or 'data' to assert that '{}' is data; '{}' is neither.",
                            record_name, base_text
                        ),
                        base_token.span,
                    );
                }
            } else {
                let base_type = self.type_named(&base_text, s);
                match base_type.map(|t| self.model.resolved(t)).filter(|t| self.model.record(*t).is_some()) {
                    Some(base_record) => self.model.record_mut(record).unwrap().base = Some(base_record),
                    None => {
                        let message = if base_type.is_none() {
                            format!("Nothing declares a record type named '{}' for '{}' to extend.", base_text, record_name)
                        } else {
                            format!("'{}' can only extend a record type, and '{}' is not one.", record_name, base_text)
                        };
                        self.error(s, message, base_token.span);
                    }
                }
            }
        }

        let Some(fields) = fields else { return };
        let mut seen: HashSet<String> = HashSet::new();
        for item in items(&fields.fields) {
            let syntax::FieldListItem::Declaration { name: name_token, field_type, default, .. } = item else { continue };
            if name_token.is_missing {
                continue;
            }
            let name = value_text(name_token, &bytes);
            if !seen.insert(name.clone()) {
                self.error(s, format!("'{}' declares '{}' twice.", record_name, name), name_token.span);
                continue;
            }

            let bound_type = self.bind_type(field_type, s);
            let default_value = default.as_ref().map(|d| self.build_value(d, s, false));
            let span = field_item_span(item);
            self.model.fields.push(Field { name, field_type: bound_type, default: default_value, span, declaring_type: Some(record), is_extension: false });
            let field = self.model.fields.len() - 1;
            self.field_states.insert(field, s);
            self.model.record_mut(record).unwrap().own_fields.push(field);
        }
    }

    fn has_base_cycle(&self, record: TypeId) -> bool {
        let mut seen: HashSet<TypeId> = HashSet::new();
        let mut current = Some(record);
        while let Some(c) = current {
            if !seen.insert(c) {
                return true;
            }
            current = self.model.record(c).and_then(|r| r.base);
        }
        false
    }

    pub fn bind_type(&mut self, syntax_type: &syntax::Type, s: usize) -> TypeId {
        let bytes = self.states[s].bytes.clone();
        let span = type_span(syntax_type);
        match syntax_type {
            syntax::Type::Named { name } => {
                let text = value_text(name, &bytes);
                if is_builtin_name(&text) {
                    return self.model.add_type(TypeKind::Named { name: text, is_host: false }, span);
                }
                if let Some(declared) = self.type_named(&text, s) {
                    return declared;
                }
                if !name.is_type_name(&bytes) {
                    if let Some(function) = self.function_type(&text) {
                        return function;
                    }
                }
                let message = if name.is_type_name(&bytes) {
                    format!("Nothing declares a type named '{}'. The declared types are: {}.", text, self.type_names_list())
                } else {
                    format!(
                        "'{}' is not a type. The built-in types are text, int, float, bool, nic, data and any; {}a declared type starts with a capital letter.",
                        text,
                        self.kinds_sentence()
                    )
                };
                self.error(s, message, span);
                self.model.add_type(TypeKind::Invalid, span)
            }
            syntax::Type::TypeOfType { record, .. } => {
                let text = value_text(record, &bytes);
                let declared = self.type_named(&text, s);
                if let Some(resolved) = declared.map(|t| self.model.resolved(t)).filter(|t| self.model.record(*t).is_some()) {
                    return self.model.add_type(TypeKind::TypeOfType { record: resolved }, span);
                }
                let message = if declared.is_none() {
                    format!("Nothing declares a record type named '{}'. The record types are: {}.", text, self.record_type_names())
                } else {
                    format!("'type {}' names a type that must have a record type's fields, and '{}' is not a record type.", text, text)
                };
                self.error(s, message, record.span);
                self.model.add_type(TypeKind::Invalid, span)
            }
            syntax::Type::Optional { inner, .. } => {
                let inner = self.bind_type(inner, s);
                self.model.add_type(TypeKind::Optional(inner), span)
            }
            syntax::Type::Union { alternatives } => {
                let mut bound = Vec::new();
                for alternative in items(alternatives) {
                    if let syntax::Type::Optional { .. } = alternative {
                        self.error(
                            s,
                            "'?' is for a type that stands alone. In a union, write nothing as an alternative: 'A | B | nic'.".to_string(),
                            type_span(alternative),
                        );
                    }
                    bound.push(self.bind_type(alternative, s));
                }
                self.model.add_type(TypeKind::Union(bound), span)
            }
            syntax::Type::List { element, .. } => {
                let element = self.bind_type(element, s);
                self.model.add_type(TypeKind::List(element), span)
            }
            syntax::Type::Map { key, value, .. } => {
                let bound_key = self.bind_type(key, s);
                let resolved = self.model.resolved(bound_key);
                let ok = matches!(self.model.types[resolved].kind, TypeKind::Enum { .. } | TypeKind::Invalid) || self.model.is_named(resolved, "text");
                if !ok {
                    let message = format!("A map's keys are 'text' or an enum; '{}' cannot be a key.", self.model.type_string(bound_key));
                    self.error(s, message, type_span(key));
                }
                let bound_value = self.bind_type(value, s);
                self.model.add_type(TypeKind::Map(bound_key, bound_value), span)
            }
            syntax::Type::Tuple { items: tuple_items, .. } => {
                let mut bound = Vec::new();
                for item in items(tuple_items) {
                    bound.push(self.bind_type(item, s));
                }
                self.model.add_type(TypeKind::Tuple(bound), span)
            }
            syntax::Type::Missing { .. } => self.model.add_type(TypeKind::Invalid, span),
        }
    }

    fn type_names_list(&self) -> String {
        let mut names: Vec<&str> = self.type_names.iter().map(|(n, _)| n.as_str()).collect();
        names.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        if names.is_empty() { "(none)".to_string() } else { names.join(", ") }
    }

    pub fn record_type_names(&self) -> String {
        let mut names: Vec<&str> = self
            .type_names
            .iter()
            .filter(|(_, t)| self.model.record(*t).is_some())
            .map(|(n, _)| n.as_str())
            .collect();
        names.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        if names.is_empty() { "(none)".to_string() } else { names.join(", ") }
    }

    // ── building the value graph ─────────────────────────────────────────────────────────────

    fn build_document(&mut self, s: usize) {
        let tree = self.states[s].tree.clone();
        let bytes = self.states[s].bytes.clone();
        let document = &tree.root;
        if let Some(directive) = type_directive(document, &bytes) {
            let second_root = self.declare_typed_root(s, document, directive);
            self.build_statements(s, document, second_root);
            return;
        }

        let Some(root_index) = first_assignment(document) else {
            if self.states[s].types.is_empty() && tree.diagnostics.is_empty() {
                self.error(
                    s,
                    "This file declares nothing. It starts by saying what its value is, '#type Game', and then sets its fields.".to_string(),
                    TextSpan::new(0, 0),
                );
            }
            return;
        };

        let Statement::Assignment { target, value, .. } = &document.statements[root_index] else { return };
        let root_path = names(target, &bytes);
        let target_span = tokens::path_span(target);
        let declaration_span = statement_span(&document.statements[root_index]);
        self.states[s].root_span = target_span;
        if root_path.len() != 1 {
            self.error(s, "The first statement declares the file's root, so its name is one name: 'name = Type'.".to_string(), target_span);
        }

        let root_name = root_path.first().cloned().unwrap_or_default();
        self.states[s].root_name = Some(root_name.clone());
        if let Some(expected) = self.states[s].expected_root_name() {
            if expected != root_name {
                let file = file_name(&self.states[s].source_name).to_string();
                self.error(s, format!("This file is '{}', so its root is named '{}', not '{}'.", file, expected, root_name), target_span);
            }
        }

        match value {
            syntax::Value::OpenInstance { type_name } => {
                let mut object = Object::new(false, Some(value_text(type_name, &bytes)));
                object.is_open = true;
                self.states[s].root = self.model.add_value(ValueKind::Object(object), declaration_span);
            }
            syntax::Value::Record { .. } => {
                let root = self.build_value(value, s, true);
                self.states[s].root = root;
                let properties: Vec<(String, ValueId)> =
                    self.model.object(root).unwrap().properties.iter().map(|p| (p.name.clone(), p.value)).collect();
                for (name, value) in properties {
                    self.states[s].assignments.push((vec![name], value));
                }
            }
            _ => {
                self.error(
                    s,
                    format!(
                        "The root is a record: write '{} = Type' and set its fields below, or '{} = Type {{ ... }}'.",
                        root_name, root_name
                    ),
                    value_span(value),
                );
                let mut object = Object::new(false, None);
                object.is_open = true;
                self.states[s].root = self.model.add_value(ValueKind::Object(object), declaration_span);
            }
        }

        self.build_statements(s, document, Some(root_index));
    }

    /// The value of a file that starts `#type Game`: an open instance of that type, named after the file. A first
    /// statement that still declares a named root would be a second root; it is reported and returned.
    fn declare_typed_root(&mut self, s: usize, document: &DocumentSyntax, directive: &Statement) -> Option<usize> {
        let bytes = self.states[s].bytes.clone();
        let Statement::Directive { directive: directive_token, arguments } = directive else { return None };
        let type_name = if arguments.len() == 1 && arguments[0].is_type_name(&bytes) { Some(&arguments[0]) } else { None };
        let base_name = self.states[s].base_name();
        self.states[s].root_name = base_name.clone();
        let root_span = match type_name {
            Some(t) => t.span,
            None => statement_span(directive),
        };
        let _ = directive_token;
        self.states[s].root_span = root_span;
        let mut object = Object::new(false, type_name.map(|t| value_text(t, &bytes)));
        object.is_open = true;
        object.path_from_root = Some(Vec::new());
        self.states[s].root = self.model.add_value(ValueKind::Object(object), root_span);

        let first_index = first_assignment(document)?;
        let Statement::Assignment { target, value: syntax::Value::OpenInstance { type_name: open_type }, .. } = &document.statements[first_index] else {
            return None;
        };
        let target_names = names(target, &bytes);
        if target_names.len() != 1 {
            return None;
        }
        let name = &target_names[0];
        if let Some(t) = type_name {
            if let Some(record) = self.declared_record_type(Some(&value_text(t, &bytes)), s) {
                if self.model.field_of(record, name).is_some() {
                    return None;
                }
            }
        }
        let names_the_file = Some(name.clone()) == base_name;
        let repeats_the_type = type_name.map(|t| open_type.text(&bytes) == t.text(&bytes)).unwrap_or(false);
        if !names_the_file && !repeats_the_type {
            return None;
        }

        let written_type = type_name.map(|t| value_text(t, &bytes)).unwrap_or_else(|| "...".to_string());
        let message = format!(
            "This file says what its value is with '#type {}', so '{} = {}' would declare a second root. Remove it: the statements below set the fields of the file's value, which is named after the file.",
            written_type,
            name,
            value_text(open_type, &bytes)
        );
        let span = statement_span(&document.statements[first_index]);
        self.error(s, message, span);
        Some(first_index)
    }

    /// Every `path = value` statement but `skip`, set from the root.
    fn build_statements(&mut self, s: usize, document: &DocumentSyntax, skip: Option<usize>) {
        let bytes = self.states[s].bytes.clone();
        let root_name = self.states[s].root_name.clone();

        // Parents before children, so 'zones.Deck = ...' finds 'zones' whichever order they were written in.
        let mut statements: Vec<(Vec<String>, usize, usize)> = Vec::new();
        let mut order = 0;
        for (index, statement) in document.statements.iter().enumerate() {
            if let Statement::ReferenceAssignment { .. } = statement {
                if self.states[s].is_program {
                    self.reference_assignments.push((index, s));
                    continue;
                }
            }
            let Statement::Assignment { target, .. } = statement else { continue };
            if Some(index) == skip {
                continue;
            }
            let mut path = names(target, &bytes);
            if path.len() > 1 && Some(&path[0]) == root_name.as_ref() {
                path.remove(0);
            }
            statements.push((path, index, order));
            order += 1;
        }

        statements.sort_by(|left, right| left.0.len().cmp(&right.0.len()).then(left.2.cmp(&right.2)));

        for (path, index, _) in statements {
            let Statement::Assignment { target, value, .. } = &document.statements[index] else { continue };
            let built = self.build_value(value, s, true);
            let target_span = tokens::path_span(target);
            let span = statement_span(&document.statements[index]);
            self.set_from_root(s, &path, built, target_span, span, false);
        }
    }

    /// Puts `value` at `path` from the root, creating maps on the way where allowed, and reporting a path set twice or
    /// an assignment into a closed instance.
    pub fn set_from_root(&mut self, s: usize, path: &[String], value: ValueId, target: TextSpan, span: TextSpan, is_text_table: bool) -> bool {
        let mut container = self.states[s].root;
        let root_type_name = self.model.object(container).unwrap().type_name.clone();
        let mut container_type: Option<TypeId> = self.declared_record_type(root_type_name.as_deref(), s);
        for i in 0..path.len().saturating_sub(1) {
            let name = &path[i];
            let child_type = self.child_type(container_type, name);
            let existing = self.model.object(container).unwrap().get(name).map(|p| p.value);
            if let Some(existing) = existing {
                if self.model.object(existing).is_none() {
                    let message = format!("'{}' is {}, so nothing can be set inside it.", join(path, i + 1), self.model.describe(existing));
                    self.error(s, message, target);
                    return false;
                }
                container = existing;
                let child_name = self.model.object(existing).unwrap().type_name.clone();
                container_type = child_type.or_else(|| self.declared_record_type(child_name.as_deref(), s));
                continue;
            }

            if !self.can_add(s, container, name, target, false) {
                return false;
            }

            let resolved = self.unwrap_type(child_type);
            if self.typed && child_type.is_some() {
                let resolved = resolved.unwrap();
                if !matches!(self.model.types[resolved].kind, TypeKind::Map(..) | TypeKind::Invalid) {
                    let declared = match self.model.record(resolved) {
                        Some(record) => record.name.clone(),
                        None => "...".to_string(),
                    };
                    let message = format!(
                        "Nothing declares '{}'. Declare it first ('{} = {}'), then set its fields.",
                        join(path, i + 1),
                        join(path, i + 1),
                        declared
                    );
                    self.error(s, message, target);
                    return false;
                }
            }

            let mut map = Object::new(true, None);
            map.is_open = true;
            let map_id = self.model.add_value(ValueKind::Object(map), span);
            self.model.try_add(container, Property { name: name.clone(), value: map_id, name_span: target, span, is_default: false });
            container = map_id;
            container_type = child_type;
        }

        let last = path.last().cloned().unwrap_or_default();
        let already = self.model.object(container).unwrap().get(&last).map(|p| p.name_span);
        if let Some(already) = already {
            let line = self.states[s].line_of(already.start);
            self.error(s, format!("'{}' is set twice: here and on line {}.", join(path, path.len()), line), target);
            return false;
        }

        if !self.can_add(s, container, &last, target, is_text_table) {
            return false;
        }

        self.model.try_add(container, Property { name: last, value, name_span: target, span, is_default: false });
        self.states[s].assignments.push((path.to_vec(), value));
        true
    }

    pub fn can_add(&mut self, s: usize, container: ValueId, name: &str, at: TextSpan, is_text_table: bool) -> bool {
        if self.model.object(container).unwrap().is_open {
            return true;
        }

        let place = match self.closed_at.get(&container) {
            Some(closed) => format!(" on line {}", self.states[s].line_of(closed.start)),
            None => String::new(),
        };
        let message = if is_text_table {
            format!(
                "A text table cannot fill '{}': what it would go in was written with its contents in braces or brackets{}, which makes it closed. Name the text ('@@@ {}-text') and write '{} = @{}-text' inside the braces, or declare the record open ('x = Type').",
                name, place, name, name, name
            )
        } else {
            format!(
                "'{}' cannot be set here: what it would go in was written with its contents in brackets or braces{}, which makes it closed. Set '{}' inside them, or declare it open ('x = Type') to set its fields one by one.",
                name, place, name
            )
        };
        self.error(s, message, at);
        false
    }

    pub fn build_value(&mut self, syntax_value: &syntax::Value, s: usize, statement_level: bool) -> ValueId {
        let bytes = self.states[s].bytes.clone();
        let span = value_span(syntax_value);
        match syntax_value {
            syntax::Value::Literal { kind, token } => self.build_literal(*kind, token, s),
            syntax::Value::EnumMember { enum_name, member, .. } => self.build_enum_member(enum_name.as_ref(), member, span, s),
            syntax::Value::Record { type_name, fields, .. } => {
                let name = if type_name.is_missing { None } else { Some(value_text(type_name, &bytes)) };
                let result = self.model.add_value(ValueKind::Object(Object::new(false, name.clone())), span);
                self.closed_at.insert(result, span);
                for field in items(fields) {
                    let field_name = value_text(&field.name, &bytes);
                    let value = self.build_value(&field.value, s, false);
                    let field_span = field_value_span(field);
                    let added = self.model.try_add(
                        result,
                        Property { name: field_name.clone(), value, name_span: field.name.span, span: field_span, is_default: false },
                    );
                    if !added {
                        let what = name.clone().unwrap_or_else(|| "record".to_string());
                        self.error(s, format!("'{}' is written twice in this {}.", field_name, what), field.name.span);
                    }
                }
                result
            }
            syntax::Value::OpenInstance { type_name } => {
                let name = value_text(type_name, &bytes);
                if statement_level {
                    let mut object = Object::new(false, Some(name));
                    object.is_open = true;
                    return self.model.add_value(ValueKind::Object(object), span);
                }
                self.error(
                    s,
                    format!(
                        "'{}' alone is an open instance, which only a statement of its own can declare. Write '{} {{}}' for a record with nothing set, or '@name' to refer to one.",
                        name, name
                    ),
                    span,
                );
                self.model.add_value(ValueKind::Invalid, span)
            }
            syntax::Value::List { items: list, .. } => {
                let mut built = Vec::new();
                for item in items(list) {
                    built.push(self.build_value(item, s, false));
                }
                self.model.add_value(ValueKind::Array(built), span)
            }
            syntax::Value::Map { entries, .. } => {
                let result = self.model.add_value(ValueKind::Object(Object::new(true, None)), span);
                self.closed_at.insert(result, span);
                for entry in items(entries) {
                    let key = value_text(&entry.key, &bytes);
                    let value = self.build_value(&entry.value, s, false);
                    let entry_span = map_entry_span(entry);
                    let added = self
                        .model
                        .try_add(result, Property { name: key.clone(), value, name_span: entry.key.span, span: entry_span, is_default: false });
                    if !added {
                        self.error(s, format!("The key '{}' is written twice in this map.", key), entry.key.span);
                    }
                }
                result
            }
            syntax::Value::Reference { path, .. } => {
                let path_names = names(path, &bytes);
                if tokens::path_span(path).length == 0 {
                    return self.model.add_value(ValueKind::Invalid, span);
                }
                let value = self.model.add_value(ValueKind::Reference { path: path_names, target: None }, span);
                self.references.push(PendingReference { reference: value, document: s, failure: None, reported: false, resolving: false, attempted: false });
                self.reference_lookup.insert(value, self.references.len() - 1);
                value
            }
            syntax::Value::Nameof { path, .. } => {
                let path_names = names(path, &bytes);
                let last = path_names.last().cloned().unwrap_or_default();
                if !last.is_empty() {
                    self.nameofs.push(PendingNameof { path: path_names, span: tokens::path_span(path), document: s });
                }
                self.model.add_value(ValueKind::String(last), span)
            }
            syntax::Value::Missing { .. } | syntax::Value::InlineStatement { .. } => self.model.add_value(ValueKind::Invalid, span),
        }
    }

    fn build_literal(&mut self, kind: syntax::LiteralKind, token: &Token, s: usize) -> ValueId {
        let bytes = self.states[s].bytes.clone();
        let span = token.span;
        use syntax::LiteralKind::*;
        match kind {
            Nic => self.model.add_value(ValueKind::Nic, span),
            Empty => self.model.add_value(ValueKind::Empty, span),
            True => self.model.add_value(ValueKind::Boolean(true), span),
            False => self.model.add_value(ValueKind::Boolean(false), span),
            Integer => {
                let text = value_text(token, &bytes);
                match text.parse::<i64>() {
                    Ok(whole) => self.model.add_value(ValueKind::Integer(whole), span),
                    Err(_) => {
                        self.error(s, format!("'{}' is too large for a whole number.", text), span);
                        self.model.add_value(ValueKind::Invalid, span)
                    }
                }
            }
            Float => {
                let text = value_text(token, &bytes);
                match text.parse::<f64>() {
                    Ok(real) => self.model.add_value(ValueKind::Float(real), span),
                    Err(_) => {
                        self.error(s, format!("'{}' is not a number.", text), span);
                        self.model.add_value(ValueKind::Invalid, span)
                    }
                }
            }
            String => {
                let text = token.text(&bytes);
                let length = if text.len() >= 2 && text[text.len() - 1] == b'\'' { text.len() - 2 } else { text.len().saturating_sub(1) };
                let start = 1.min(text.len());
                let content = undouble_quotes(&text[start..start + length]);
                self.model.add_value(ValueKind::String(std::string::String::from_utf8_lossy(&content).into_owned()), span)
            }
        }
    }

    /// Adds an enum's members, and in a backed enum (`enum Count : int { one = 1 }`) their values. A backing that means
    /// nothing is reported once, and its members' values are then not checked.
    fn complete_enum(&mut self, type_id: TypeId, backing: Option<&syntax::EnumBacking>, members: &syntax::Separated<syntax::EnumMember>, s: usize, bytes: &[u8]) {
        let enum_name = self.model.enum_name(type_id).to_string();
        let mut bound: Option<EnumBacking> = None;
        if let Some(backing) = backing.filter(|b| !b.type_name.is_missing) {
            let name = value_text(&backing.type_name, bytes);
            if name == "int" {
                bound = Some(EnumBacking { type_name: name, max_length: 0, values: Vec::new() });
                if let Some(open) = &backing.open {
                    self.error(s, "An int has no size; only text does: 'text(n)'.".to_string(), open.span);
                }
            } else if name == "text" {
                match &backing.size {
                    None => self.error(
                        s,
                        "A text-backed enum says the most characters a value may have: 'text(n)', such as 'text(3)'.".to_string(),
                        backing.type_name.span,
                    ),
                    Some(size) if !size.is_missing => {
                        let text = value_text(size, bytes);
                        match text.parse::<i32>() {
                            Ok(n) if n >= 1 && text.bytes().all(|b| b.is_ascii_digit()) => {
                                bound = Some(EnumBacking { type_name: name, max_length: n as usize, values: Vec::new() });
                            }
                            _ => self.error(s, format!("'{}' is not a size: it is a whole number of characters, 1 or more.", text), size.span),
                        }
                    }
                    _ => {}
                }
            } else {
                self.error(s, format!("An enum is backed by 'int' or 'text(n)'; '{}' is neither.", name), backing.type_name.span);
            }
        }
        let backing_name = bound.as_ref().map(|b| b.name());
        let is_int = bound.as_ref().map(|b| b.type_name == "int").unwrap_or(false);
        let max_length = bound.as_ref().map(|b| b.max_length).unwrap_or(0);
        if let TypeKind::Enum { backing: b, .. } = &mut self.model.types[type_id].kind {
            *b = bound;
        }

        for member in items(members) {
            if member.name.is_missing {
                continue;
            }
            let name = value_text(&member.name, bytes);
            let added = match &mut self.model.types[type_id].kind {
                TypeKind::Enum { members, .. } if !members.contains(&name) => {
                    members.push(name.clone());
                    true
                }
                _ => false,
            };
            if !added {
                self.error(s, format!("'{}' is already a member of '{}'.", name, enum_name), member.name.span);
                continue;
            }

            let Some(value) = &member.value else {
                if let Some(backing_name) = &backing_name {
                    let message = format!("'{}' needs a value: '{}' is backed by {}, so every member has one.", name, enum_name, backing_name);
                    self.error(s, message, member.name.span);
                }
                continue;
            };
            let value_span = value_span(value);
            if backing.is_none() {
                let message = format!(
                    "'{}' has a value, but '{}' is not backed. To give its members values, write 'enum {} : int' or 'enum {} : text(n)'.",
                    name, enum_name, enum_name, enum_name
                );
                self.error(s, message, value_span);
                continue;
            }
            let Some(backing_name) = &backing_name else { continue };
            if matches!(value, syntax::Value::Missing { .. }) {
                continue;
            }
            let wanted = if is_int { syntax::LiteralKind::Integer } else { syntax::LiteralKind::String };
            if let syntax::Value::Literal { kind, token } = value {
                if *kind == wanted {
                    let built = self.build_literal(*kind, token, s);
                    if let ValueKind::String(text) = &self.model.values[built].kind {
                        let length = text.chars().count();
                        if length > max_length {
                            let message = format!("'{}' is {} characters, and {} has at most {}.", text, length, with_article(&enum_name), max_length);
                            self.error(s, message, value_span);
                        }
                    }
                    if !matches!(self.model.values[built].kind, ValueKind::Invalid) {
                        if let TypeKind::Enum { backing: Some(b), .. } = &mut self.model.types[type_id].kind {
                            b.values.push((name.clone(), built));
                        }
                    }
                    continue;
                }
            }
            let what = if is_int { "a whole number." } else { "text in single quotes." };
            let message = format!("'{}' is {}, which is backed by {}: its value is {}", name, with_article(&enum_name), backing_name, what);
            self.error(s, message, value_span);
        }
    }

    fn build_enum_member(&mut self, enum_name: Option<&Token>, member: &Token, span: TextSpan, s: usize) -> ValueId {
        let bytes = self.states[s].bytes.clone();
        let member_text = value_text(member, &bytes);
        let Some(enum_name) = enum_name else {
            return self.model.add_value(ValueKind::Enum { member: member_text, enum_type: None }, span);
        };

        let name = value_text(enum_name, &bytes);
        let declared = self.type_named(&name, s);
        let resolved = declared.map(|t| self.model.resolved(t)).filter(|t| matches!(self.model.types[*t].kind, TypeKind::Enum { .. }));
        let Some(enum_type) = resolved else {
            let message = if declared.is_none() { format!("Nothing declares an enum named '{}'.", name) } else { format!("'{}' is not an enum.", name) };
            self.error(s, message, enum_name.span);
            return self.model.add_value(ValueKind::Invalid, span);
        };

        if !member.is_missing && !self.model.enum_contains(enum_type, &member_text) {
            let message = self.not_a_member(&member_text, enum_type);
            self.error(s, message, member.span);
            return self.model.add_value(ValueKind::Invalid, span);
        }

        self.model.add_value(ValueKind::Enum { member: member_text, enum_type: Some(enum_type) }, span)
    }

    // ── text tables ──────────────────────────────────────────────────────────────────────────

    fn apply_text_tables(&mut self, s: usize) {
        let tree = self.states[s].tree.clone();
        let bytes = self.states[s].bytes.clone();
        for statement in &tree.root.statements {
            let Statement::TextTable { token } = statement else { continue };
            let text_bytes = token.text(&bytes);
            let parts = TextTableParts::read(text_bytes);
            if parts.is_bare || parts.invalid_name || parts.name_offsets.is_empty() {
                continue;
            }

            let body_span = TextSpan::new(token.span.start as usize + parts.body_offset, parts.body_length);
            let body = &text_bytes[parts.body_offset..parts.body_offset + parts.body_length];
            let text = self.model.add_value(ValueKind::Text(decode_table(body)), body_span);
            let name: Vec<String> = parts
                .name_offsets
                .iter()
                .map(|(offset, length)| std::string::String::from_utf8_lossy(&text_bytes[*offset..*offset + *length]).into_owned())
                .collect();
            let table_span = token.span;
            let marker_span = TextSpan::new(token.span.start as usize, parts.marker_length);

            if parts.from_root {
                self.set_from_root(s, &name, text, table_span, table_span, true);
                continue;
            }

            if name.len() == 1 {
                let clash = self.states[s].root_name.as_ref() == Some(&name[0]) || self.states[s].texts.iter().any(|(n, _)| *n == name[0]);
                if clash {
                    self.error(
                        s,
                        format!(
                            "'{}' is already declared in this file. To fill a field of the file's value, start the name with a dot: '@@@ .{}'.",
                            name[0], name[0]
                        ),
                        marker_span,
                    );
                } else {
                    self.states[s].texts.push((name[0].clone(), text));
                }
                continue;
            }

            let field = name[name.len() - 1].clone();
            let prefix: Vec<String> = name[..name.len() - 1].to_vec();
            let candidates = self.find(&prefix[0], Some(s), false);
            if candidates.len() > 1 {
                let message = self.ambiguous(&prefix[0], &candidates, s);
                self.error(s, message, marker_span);
                continue;
            }

            if candidates.is_empty() {
                // Nothing is named that: the path is the root's, as a statement's would be.
                let mut root_path = name.clone();
                if name.len() > 1 && self.states[s].root_name.as_ref() == Some(&name[0]) {
                    root_path.remove(0);
                }
                self.set_from_root(s, &root_path, text, table_span, table_span, true);
                continue;
            }

            let (owner, failure) = self.walk(candidates[0].value, &prefix, 1);
            let container = match owner {
                Some(o) if self.model.object(o).is_some() => o,
                _ => {
                    let message = failure.unwrap_or_else(|| {
                        format!(
                            "'{}' is {}, so a text table cannot fill a field of it.",
                            join(&prefix, prefix.len()),
                            self.model.describe(owner.unwrap())
                        )
                    });
                    self.error(s, message, marker_span);
                    continue;
                }
            };

            let existing = self.model.object(container).unwrap().get(&field).map(|p| p.name_span);
            if let Some(existing) = existing {
                let place = if candidates[0].document == s { format!(" on line {}", self.states[s].line_of(existing.start)) } else { String::new() };
                self.error(
                    s,
                    format!("'{}' is already set{}; a text table supplies a value that is not written anywhere else.", name.join("."), place),
                    marker_span,
                );
                continue;
            }

            if !self.can_add(s, container, &field, marker_span, true) {
                continue;
            }
            self.model.try_add(container, Property { name: field.clone(), value: text, name_span: marker_span, span: table_span, is_default: false });
            let path_from_root = self.model.object(container).unwrap().path_from_root.clone();
            if let Some(mut full) = path_from_root {
                if candidates[0].document == s {
                    full.push(field);
                    self.states[s].assignments.push((full, text));
                }
            }
        }
    }

    // ── named members and references ─────────────────────────────────────────────────────────

    fn index_members(&mut self) {
        self.members.clear();
        for s in 0..self.states.len() {
            if let Some(root_name) = self.states[s].root_name.clone() {
                let root = self.states[s].root;
                self.add_member(&root_name, root, Vec::new(), s);
            }

            let root = self.states[s].root;
            let properties: Vec<(String, ValueId)> =
                self.model.object(root).unwrap().properties.iter().map(|p| (p.name.clone(), p.value)).collect();
            for (name, value) in properties {
                let path = vec![name.clone()];
                self.add_member(&name, value, path.clone(), s);
                self.index_value(value, path, s, false);
            }

            for (name, text) in self.states[s].texts.clone() {
                self.add_member(&name, text, vec![name.clone()], s);
            }
            for declaration in self.states[s].declarations.clone() {
                let ValueKind::Declaration(d) = self.model.values[declaration].kind else { continue };
                if let Some(name) = self.model.declarations[d].name.clone() {
                    self.add_member(&name, declaration, vec![name.clone()], s);
                }
            }
        }
    }

    /// Inside a map's entry, a map's plain values (numbers, texts) are the entry's own, reached through it: a card's
    /// `constants` are not the game's. Its records and maps are named members wherever they are.
    fn index_value(&mut self, value: ValueId, path: Vec<String>, s: usize, in_entry: bool) {
        match &self.model.values[value].kind {
            ValueKind::Object(object) => {
                let is_map = object.is_map;
                let properties: Vec<(String, ValueId)> = object.properties.iter().map(|p| (p.name.clone(), p.value)).collect();
                self.model.object_mut(value).unwrap().path_from_root = Some(path.clone());
                for (name, child_value) in properties {
                    let mut child = path.clone();
                    child.push(name.clone());
                    if is_map && (!in_entry || self.model.object(child_value).is_some()) {
                        self.add_member(&name, child_value, child.clone(), s);
                    }
                    self.index_value(child_value, child, s, in_entry || is_map);
                }
            }
            ValueKind::Array(array) => {
                for item in array.clone() {
                    self.index_value(item, path.clone(), s, in_entry);
                }
            }
            _ => {}
        }
    }

    fn add_member(&mut self, name: &str, value: ValueId, path: Vec<String>, s: usize) {
        self.members.entry(name.to_string()).or_default().push(Member { value, path, document: s });
    }

    /// The named members called `name`. A document's root wins over any other member of the same name.
    pub fn find(&self, name: &str, from: Option<usize>, data_only: bool) -> Vec<Member> {
        let Some(all) = self.members.get(name) else { return Vec::new() };

        // Code points at data, never the reverse: a data document never sees a declaration.
        let skip_declarations = data_only || from.map(|f| !self.states[f].is_program).unwrap_or(false);
        let mut found: Vec<Member> = Vec::new();
        for member in all {
            // A schema's references see the schemas' members, never a document's.
            let mut visible = !from.map(|f| self.states[f].is_schema).unwrap_or(false) || self.states[member.document].is_schema;
            if visible && skip_declarations && matches!(self.model.values[member.value].kind, ValueKind::Declaration(_)) {
                visible = false;
            }
            if visible {
                found.push(member.clone());
            }
        }

        let roots: Vec<Member> = found.iter().filter(|m| m.path.is_empty()).cloned().collect();
        if roots.is_empty() { found } else { roots }
    }

    pub fn resolve(&mut self, pending: usize) {
        if self.references[pending].attempted || self.references[pending].resolving {
            return;
        }
        self.references[pending].resolving = true;
        let reference = self.references[pending].reference;
        let document = self.references[pending].document;
        let path = match &self.model.values[reference].kind {
            ValueKind::Reference { path, .. } => path.clone(),
            _ => Vec::new(),
        };

        let candidates = self.find(&path[0], Some(document), false);
        if candidates.is_empty() {
            self.references[pending].failure = Some(format!("Nothing is named '{}'.", path[0]));
        } else if candidates.len() > 1 {
            // Reported with the unresolved ones, at the end: where a field expects a type, the members do not matter.
            self.references[pending].failure = Some(self.ambiguous(&path[0], &candidates, document));
        } else {
            let (target, failure) = self.walk(candidates[0].value, &path, 1);
            match target {
                None => self.references[pending].failure = failure,
                Some(target) => {
                    if let ValueKind::Reference { target: t, .. } = &mut self.model.values[reference].kind {
                        *t = Some(target);
                    }
                }
            }
        }

        self.references[pending].resolving = false;
        self.references[pending].attempted = true;
    }

    /// Follows `path` from `start`, through references, from segment `from` on.
    pub fn walk(&mut self, start: ValueId, path: &[String], from: usize) -> (Option<ValueId>, Option<String>) {
        let mut current = self.follow(start);
        for i in from..path.len() {
            let Some(c) = current.filter(|c| self.model.object(*c).is_some()) else {
                let failure = match current {
                    None => format!("'{}' does not resolve, so '{}' cannot either.", join(path, i), path.join(".")),
                    Some(c) => format!("'{}' is {}, which has no '{}'.", join(path, i), self.model.describe(c), path[i]),
                };
                return (None, Some(failure));
            };

            let property = self.model.object(c).unwrap().get(&path[i]).map(|p| p.value);
            let Some(property) = property else {
                let failure = format!("'{}' has no '{}'. It holds: {}.", join(path, i), path[i], self.names_of(c));
                return (None, Some(failure));
            };
            current = self.follow(property);
        }
        (current, None)
    }

    /// The value a reference names, resolving it first if it has not been; any other value as it is.
    pub fn follow(&mut self, value: ValueId) -> Option<ValueId> {
        let mut hops = 0;
        let mut current = Some(value);
        while let Some(c) = current {
            let ValueKind::Reference { target, .. } = &self.model.values[c].kind else { break };
            if hops >= 64 {
                break;
            }
            hops += 1;
            if target.is_none() {
                if let Some(pending) = self.reference_lookup.get(&c).copied() {
                    self.resolve(pending);
                }
            }
            current = match &self.model.values[c].kind {
                ValueKind::Reference { target, .. } => *target,
                _ => None,
            };
        }
        current
    }

    pub fn ambiguous(&self, name: &str, candidates: &[Member], from: usize) -> String {
        let mut text = format!("'{}' names more than one thing; write which: ", name);
        for (i, member) in candidates.iter().enumerate() {
            if i > 0 {
                text.push_str(", ");
            }
            text.push('@');
            let other_document = member.document != from || member.path.is_empty();
            if other_document {
                if let Some(root_name) = &self.states[member.document].root_name {
                    text.push_str(root_name);
                    if !member.path.is_empty() {
                        text.push('.');
                    }
                }
            }
            text.push_str(&member.path.join("."));
        }
        text.push('.');
        text
    }

    // ── constructors ─────────────────────────────────────────────────────────────────────────

    fn resolve_constructors(&mut self, value: ValueId, s: usize) {
        match &self.model.values[value].kind {
            ValueKind::Object(object) => {
                let needs = !object.is_map && object.type_name.is_some() && object.record_type.is_none() && self.typed;
                let children: Vec<ValueId> = object.properties.iter().map(|p| p.value).collect();
                if needs {
                    let resolved = self.resolve_constructor(value, s);
                    self.model.object_mut(value).unwrap().record_type = resolved;
                }
                for child in children {
                    self.resolve_constructors(child, s);
                }
            }
            ValueKind::Array(array) => {
                for item in array.clone() {
                    self.resolve_constructors(item, s);
                }
            }
            _ => {}
        }
    }

    fn resolve_constructor(&mut self, object: ValueId, s: usize) -> Option<TypeId> {
        let name = self.model.object(object).unwrap().type_name.clone().unwrap();
        if let Some(declared) = self.type_named(&name, s) {
            let resolved = self.model.resolved(declared);
            if self.model.record(resolved).is_some() {
                return Some(resolved);
            }
            let what = if matches!(self.model.types[resolved].kind, TypeKind::Enum { .. }) { "an enum" } else { "not a record type" };
            let span = self.constructor_span(object, s);
            self.error(s, format!("'{}' is {}, so it cannot be written '{} {{ ... }}'.", name, what, name), span);
            return None;
        }

        let span = self.constructor_span(object, s);
        let message = format!("Nothing declares a record type named '{}'. The record types are: {}.", name, self.record_type_names());
        self.error(s, message, span);
        None
    }

    pub fn constructor_span(&self, object: ValueId, s: usize) -> TextSpan {
        if object == self.states[s].root && self.states[s].root_span.length != 0 {
            return self.states[s].root_span;
        }
        let span = self.model.values[object].span;
        let name_length = self.model.object(object).unwrap().type_name.as_ref().map(|n| n.encode_utf16().count()).unwrap_or(0);
        TextSpan::new(span.start as usize, (span.length as usize).min(name_length))
    }

    // ── checking ─────────────────────────────────────────────────────────────────────────────

    fn check_defaults(&mut self) {
        for d in self.declared.clone() {
            let Some(record) = self.model.record(d.type_id) else { continue };
            let own_fields = record.own_fields.clone();
            let fixed_names: Vec<String> = record.own_fixed.iter().map(|(n, _)| n.clone()).collect();
            let base = record.base;
            for field in own_fields {
                let Some(default) = self.model.fields[field].default else { continue };
                let field_type = self.model.fields[field].field_type;
                let checked = self.check_value(default, Some(field_type), d.document, Sink::Document);
                self.model.fields[field].default = Some(checked);
            }
            for name in fixed_names {
                let Some(inherited) = base.and_then(|b| self.model.field_of(b, &name)) else { continue };
                let value = self.model.record(d.type_id).unwrap().own_fixed.iter().find(|(n, _)| *n == name).map(|(_, v)| *v).unwrap();
                let field_type = self.model.fields[inherited].field_type;
                let checked = self.check_value(value, Some(field_type), d.document, Sink::Document);
                self.model.fix(d.type_id, &name, checked);
            }
        }
    }

    fn check_document(&mut self, s: usize) {
        if self.states[s].root_name.is_none() {
            return;
        }
        let root = self.states[s].root;
        if let Some(record_type) = self.model.object(root).unwrap().record_type {
            self.check_record(root, record_type, s, Sink::Document);
            return;
        }
        self.check_value(root, None, s, Sink::Document);
    }

    pub fn report(&mut self, sink: Sink, s: usize, message: String, span: TextSpan) {
        match sink {
            Sink::Document => self.states[s].diagnostics.push(BoundDiagnostic::error(message, span)),
            Sink::Trial(index) => self.trial_sinks[index].push(BoundDiagnostic::error(message, span)),
        }
    }

    pub fn check_value(&mut self, value: ValueId, expected: Option<TypeId>, s: usize, sink: Sink) -> ValueId {
        if matches!(self.model.values[value].kind, ValueKind::Invalid) {
            return value;
        }
        let Some(expected) = expected else { return self.check_untyped(value, s, sink) };
        let resolved = self.model.resolved(expected);
        if matches!(self.model.types[resolved].kind, TypeKind::Invalid | TypeKind::Alias { .. }) {
            return self.check_untyped(value, s, sink);
        }

        let type_id = resolved;
        if let ValueKind::Reference { .. } = self.model.values[value].kind {
            if let Some(expected_type) = self.type_of_type_for(value, type_id, s) {
                return if self.reported_type_values.contains(&value) { value } else { self.to_type_value(value, expected_type, s, sink) };
            }
            return self.check_reference(value, type_id, s, sink);
        }

        let span = self.model.values[value].span;
        match self.model.types[type_id].kind.clone() {
            TypeKind::Optional(inner) => {
                if matches!(self.model.values[value].kind, ValueKind::Nic) {
                    value
                } else {
                    self.check_value(value, Some(inner), s, sink)
                }
            }
            TypeKind::Union(_) => self.check_union(value, type_id, s, sink),
            TypeKind::Named { name, .. } if name == "data" => {
                if let ValueKind::Declaration(_) = self.model.values[value].kind {
                    let message = format!("This is {}, and a declaration is never data.", self.model.describe(value));
                    self.report(sink, s, message, span);
                    return value;
                }
                self.check_untyped(value, s, sink)
            }
            TypeKind::Named { name, .. } if name == "any" => {
                if let ValueKind::Declaration(_) = self.model.values[value].kind {
                    value
                } else {
                    self.check_untyped(value, s, sink)
                }
            }
            TypeKind::Named { name, .. } => {
                if let Some(converted) = self.from_backed_member(value, &name, s, sink) {
                    return converted;
                }
                self.check_named(value, &name, s, sink)
            }
            TypeKind::Function { kind, .. } => {
                if let ValueKind::Declaration(d) = self.model.values[value].kind {
                    if self.model.declarations[d].kind == kind {
                        return value;
                    }
                }
                let message = format!(
                    "This holds {}: a declaration, which only a program document declares and attaches through a reference ('@object.member = name').",
                    with_article(&kind)
                );
                self.report(sink, s, message, span);
                value
            }
            TypeKind::TypeOfType { record } => {
                if let ValueKind::TypeValue(given) = self.model.values[value].kind {
                    if !self.model.is_or_viewed_as(given, record) && !self.reported_type_values.contains(&value) {
                        let message = format!("'@{}' is not mapped onto {}.", self.model.record_name(given), self.model.record_name(record));
                        self.report(sink, s, message, span);
                    }
                    return value;
                }
                let what = format!("a type that has {}'s fields, named '@Name'", with_article(self.model.record_name(record)));
                let message = self.expected(&what, value);
                self.report(sink, s, message, span);
                value
            }
            TypeKind::Record(record) => {
                if self.model.is_record(value) {
                    let object = self.model.object(value).unwrap();
                    let Some(object_type) = object.record_type else { return self.check_untyped(value, s, sink) };
                    if !self.model.is_or_viewed_as(object_type, type_id) {
                        let message = format!(
                            "This is a {}, and a {} is expected here.",
                            object.type_name.clone().unwrap_or_default(),
                            record.name
                        );
                        self.report(sink, s, message, span);
                        return value;
                    }
                    self.check_record(value, object_type, s, sink);
                    return value;
                }
                let what = format!("a {}, written '{} {{ ... }}' or '@name'", record.name, record.name);
                let message = self.expected(&what, value);
                self.report(sink, s, message, span);
                value
            }
            TypeKind::Enum { name, .. } => {
                if let ValueKind::Enum { member, enum_type } = self.model.values[value].kind.clone() {
                    match enum_type {
                        None => {
                            if self.model.enum_contains(type_id, &member) {
                                if let ValueKind::Enum { enum_type: t, .. } = &mut self.model.values[value].kind {
                                    *t = Some(type_id);
                                }
                            } else {
                                let message = self.not_a_member(&member, type_id);
                                self.report(sink, s, message, span);
                            }
                        }
                        Some(t) if t != type_id => {
                            let message = format!(
                                "'{}' is not a {}. A {} is one of: {}.",
                                self.model.enum_value_name(value),
                                name,
                                name,
                                self.model.member_list(type_id)
                            );
                            self.report(sink, s, message, span);
                        }
                        _ => {}
                    }
                    return value;
                }
                let what = format!("a {}, one of: {}", name, self.model.member_list(type_id));
                let message = self.expected(&what, value);
                self.report(sink, s, message, span);
                value
            }
            TypeKind::List(element) => {
                if let ValueKind::Empty = self.model.values[value].kind {
                    return self.model.add_value(ValueKind::Array(Vec::new()), span);
                }
                if let ValueKind::Array(array) = self.model.values[value].kind.clone() {
                    for (i, item) in array.into_iter().enumerate() {
                        let checked = self.check_value(item, Some(element), s, sink);
                        self.replace_item(value, i, checked);
                    }
                    return value;
                }
                let message = self.expected("a list, [ ... ]", value);
                self.report(sink, s, message, span);
                value
            }
            TypeKind::Tuple(tuple_items) => {
                if let ValueKind::Array(array) = self.model.values[value].kind.clone() {
                    if array.len() == tuple_items.len() {
                        for (i, item) in array.into_iter().enumerate() {
                            let checked = self.check_value(item, Some(tuple_items[i]), s, sink);
                            self.replace_item(value, i, checked);
                        }
                        return value;
                    }
                    let message = format!(
                        "This holds {} item{}, and a {} holds exactly {}.",
                        array.len(),
                        if array.len() == 1 { "" } else { "s" },
                        self.model.type_string(type_id),
                        tuple_items.len()
                    );
                    self.report(sink, s, message, span);
                    return value;
                }
                let what = self.model.type_string(type_id);
                let message = self.expected(&what, value);
                self.report(sink, s, message, span);
                value
            }
            TypeKind::Map(key_type, value_type) => {
                let empty = match &self.model.values[value].kind {
                    ValueKind::Empty => true,
                    ValueKind::Array(a) => a.is_empty(),
                    _ => false,
                };
                if empty {
                    return self.model.add_value(ValueKind::Object(Object::new(true, None)), span);
                }
                if self.model.is_map(value) {
                    let resolved_key = self.model.resolved(key_type);
                    let key_enum = if matches!(self.model.types[resolved_key].kind, TypeKind::Enum { .. }) { Some(resolved_key) } else { None };
                    let entries: Vec<(String, ValueId, TextSpan)> =
                        self.model.object(value).unwrap().properties.iter().map(|p| (p.name.clone(), p.value, p.name_span)).collect();
                    for (i, (name, entry, name_span)) in entries.into_iter().enumerate() {
                        if let Some(key_enum) = key_enum {
                            if !self.model.enum_contains(key_enum, &name) {
                                let enum_name = self.model.enum_name(key_enum).to_string();
                                let message = format!(
                                    "The keys of this map are {} members, and '{}' is not one. A {} is one of: {}.",
                                    enum_name,
                                    name,
                                    enum_name,
                                    self.model.member_list(key_enum)
                                );
                                self.report(sink, s, message, name_span);
                            }
                        }
                        let checked = self.check_value(entry, Some(value_type), s, sink);
                        self.model.object_mut(value).unwrap().properties[i].value = checked;
                    }
                    return value;
                }
                let message = self.expected("a map, [key = value, ...]", value);
                self.report(sink, s, message, span);
                value
            }
            _ => self.check_untyped(value, s, sink),
        }
    }

    pub fn replace_item(&mut self, array: ValueId, index: usize, item: ValueId) {
        if let ValueKind::Array(items) = &mut self.model.values[array].kind {
            items[index] = item;
        }
    }

    fn check_named(&mut self, value: ValueId, name: &str, s: usize, sink: Sink) -> ValueId {
        let span = self.model.values[value].span;
        let kind = &self.model.values[value].kind;
        let (ok, what) = match name {
            "text" => {
                if let ValueKind::Empty = kind {
                    return self.model.add_value(ValueKind::String(String::new()), span);
                }
                (self.model.is_textual(value), "text, in single quotes or a text table")
            }
            "int" => (matches!(kind, ValueKind::Integer(_)), "a whole number"),
            "float" => (matches!(kind, ValueKind::Float(_) | ValueKind::Integer(_)), "a number"),
            "bool" => (matches!(kind, ValueKind::Boolean(_)), "true or false"),
            "nic" => (matches!(kind, ValueKind::Nic), "nic"),
            _ => (true, ""),
        };
        if !ok {
            let message = self.expected(what, value);
            self.report(sink, s, message, span);
        }
        value
    }

    fn check_union(&mut self, value: ValueId, union: TypeId, s: usize, sink: Sink) -> ValueId {
        let mut alternatives = Vec::new();
        self.flatten(union, &mut alternatives);
        let span = self.model.values[value].span;
        let union_string = self.model.type_string(union);

        if let ValueKind::Nic = self.model.values[value].kind {
            if alternatives.iter().any(|a| self.model.includes_nic(*a)) {
                return value;
            }
            self.report(sink, s, format!("This cannot be nic: it is {}.", union_string), span);
            return value;
        }

        if let ValueKind::Enum { member, enum_type } = self.model.values[value].kind.clone() {
            let enums: Vec<TypeId> = alternatives
                .iter()
                .copied()
                .filter(|a| {
                    matches!(self.model.types[*a].kind, TypeKind::Enum { .. })
                        && match enum_type {
                            None => self.model.enum_contains(*a, &member),
                            Some(t) => t == *a,
                        }
                })
                .collect();
            if enums.len() == 1 {
                if let ValueKind::Enum { enum_type: t, .. } = &mut self.model.values[value].kind {
                    *t = Some(enums[0]);
                }
                return value;
            }
            if enums.len() > 1 {
                let message = format!(
                    "'{}' is a member of more than one enum here; write which, such as '{}.{}'.",
                    member,
                    self.model.enum_name(enums[0]),
                    member
                );
                self.report(sink, s, message, span);
                return value;
            }
            for alternative in &alternatives {
                if let TypeKind::Named { name, .. } = self.model.types[*alternative].kind.clone() {
                    if let Some(converted) = self.from_backed_member(value, &name, s, sink) {
                        return converted;
                    }
                }
            }
            let message = format!("'{}' is not {}.{}", self.model.enum_value_name(value), union_string, self.enum_members(&alternatives));
            self.report(sink, s, message, span);
            return value;
        }

        let candidates: Vec<TypeId> = alternatives.iter().copied().filter(|a| self.fits(value, *a)).collect();
        if candidates.is_empty() {
            let message = format!(
                "This is {}, and it must be {}.{}",
                self.model.describe(value),
                union_string,
                self.enum_members(&alternatives)
            );
            self.report(sink, s, message, span);
            return value;
        }

        if candidates.len() == 1 {
            return self.check_value(value, Some(candidates[0]), s, sink);
        }

        for candidate in &candidates {
            self.trial_sinks.push(Vec::new());
            let index = self.trial_sinks.len() - 1;
            self.trials += 1;
            self.check_value(value, Some(*candidate), s, Sink::Trial(index));
            self.trials -= 1;
            let clean = self.trial_sinks.pop().unwrap().is_empty();
            if clean {
                return self.check_value(value, Some(*candidate), s, sink);
            }
        }

        self.check_value(value, Some(candidates[0]), s, sink)
    }

    /// A backed enum's member where its backing type is expected stands for its value: `two` is `2` where an int is. A bare
    /// member is looked up among every backed enum. None when `value` is no such member, so the ordinary check reports it.
    fn from_backed_member(&mut self, value: ValueId, expected: &str, s: usize, sink: Sink) -> Option<ValueId> {
        let ValueKind::Enum { member, enum_type } = self.model.values[value].kind.clone() else { return None };
        let enums: Vec<TypeId> = match enum_type {
            None => self.backed_enums_with(&member, expected),
            Some(t) if self.backs(t, expected) => vec![t],
            Some(_) => Vec::new(),
        };
        if enums.is_empty() {
            return None;
        }
        let span = self.model.values[value].span;
        if enums.len() > 1 {
            let message = format!(
                "'{}' is a member of more than one enum here; write which, such as '{}.{}'.",
                member,
                self.model.enum_name(enums[0]),
                member
            );
            self.report(sink, s, message, span);
            return Some(value);
        }

        if let ValueKind::Enum { enum_type: t, .. } = &mut self.model.values[value].kind {
            *t = Some(enums[0]);
        }
        let backing_value = self.model.enum_backing(enums[0]).and_then(|b| b.value_of(&member));
        match backing_value.map(|v| self.model.values[v].kind.clone()) {
            Some(kind @ (ValueKind::Integer(_) | ValueKind::String(_))) => Some(self.model.add_value(kind, span)),
            _ => Some(value),
        }
    }

    /// The backed enums that have `member` and are backed by what the built-in type `expected` accepts.
    pub(super) fn backed_enums_with(&self, member: &str, expected: &str) -> Vec<TypeId> {
        self.type_names
            .iter()
            .map(|(_, t)| *t)
            .filter(|t| self.model.enum_contains(*t, member) && self.backs(*t, expected))
            .collect()
    }

    /// Whether an enum is backed by a type the built-in `expected` accepts; an int is accepted where a float is.
    pub(super) fn backs(&self, enum_type: TypeId, expected: &str) -> bool {
        match self.model.enum_backing(enum_type) {
            Some(backing) => backing.type_name == expected || (backing.type_name == "int" && expected == "float"),
            None => false,
        }
    }

    /// Whether `value` is the kind of thing `type_id` holds, without looking inside it.
    pub fn fits(&self, value: ValueId, type_id: TypeId) -> bool {
        let resolved = self.model.resolved(type_id);
        let kind = &self.model.values[value].kind;
        match &self.model.types[resolved].kind {
            TypeKind::Record(_) => match kind {
                ValueKind::Object(o) if !o.is_map => o.record_type.map(|t| self.model.is_or_viewed_as(t, resolved)).unwrap_or(true),
                _ => false,
            },
            TypeKind::TypeOfType { record } => {
                matches!(kind, ValueKind::TypeValue(t) if self.model.is_or_viewed_as(*t, *record)) || matches!(kind, ValueKind::Reference { .. })
            }
            TypeKind::Map(..) => matches!(kind, ValueKind::Object(o) if o.is_map) || matches!(kind, ValueKind::Empty) || matches!(kind, ValueKind::Array(a) if a.is_empty()),
            TypeKind::List(_) => matches!(kind, ValueKind::Array(_) | ValueKind::Empty),
            TypeKind::Tuple(items) => matches!(kind, ValueKind::Array(a) if a.len() == items.len()),
            TypeKind::Enum { .. } => matches!(kind, ValueKind::Enum { .. }),
            TypeKind::Function { kind: function, .. } => matches!(kind, ValueKind::Declaration(d) if self.model.declarations[*d].kind == *function),
            TypeKind::Named { name, .. } if name == "any" => true,
            TypeKind::Named { name, .. } if name == "data" => !matches!(kind, ValueKind::Declaration(_)),
            TypeKind::Named { name, .. } if name == "text" => self.model.is_textual(value) || matches!(kind, ValueKind::Empty),
            TypeKind::Named { name, .. } => named_accepts(name, kind),
            TypeKind::Optional(inner) => matches!(kind, ValueKind::Nic) || self.fits(value, *inner),
            TypeKind::Union(alternatives) => alternatives.iter().any(|a| self.fits(value, *a)),
            _ => true,
        }
    }

    pub fn flatten(&mut self, type_id: TypeId, alternatives: &mut Vec<TypeId>) {
        let resolved = self.model.resolved(type_id);
        match self.model.types[resolved].kind.clone() {
            TypeKind::Union(items) => {
                for item in items {
                    self.flatten(item, alternatives);
                }
            }
            TypeKind::Optional(inner) => {
                self.flatten(inner, alternatives);
                let span = self.model.types[resolved].span;
                let nic = self.model.add_type(TypeKind::Named { name: "nic".to_string(), is_host: false }, span);
                alternatives.push(nic);
            }
            _ => alternatives.push(resolved),
        }
    }

    fn enum_members(&self, alternatives: &[TypeId]) -> String {
        let mut text = String::new();
        for alternative in alternatives {
            if let TypeKind::Enum { name, .. } = &self.model.types[*alternative].kind {
                text.push_str(&format!(" A {} is one of: {}.", name, self.model.member_list(*alternative)));
            }
        }
        text
    }

    fn check_reference(&mut self, reference: ValueId, type_id: TypeId, s: usize, sink: Sink) -> ValueId {
        let Some(target) = self.follow(reference) else { return reference };
        if !self.fits(target, type_id) {
            let name = match &self.model.values[reference].kind {
                ValueKind::Reference { path, .. } => path.join("."),
                _ => String::new(),
            };
            let message = format!("'@{}' names {}, and this holds {}.", name, self.model.describe(target), self.model.type_string(type_id));
            let span = self.model.values[reference].span;
            self.report(sink, s, message, span);
        }
        reference
    }

    pub fn check_record(&mut self, object: ValueId, type_id: TypeId, s: usize, sink: Sink) {
        let properties: Vec<(String, ValueId, TextSpan, bool)> =
            self.model.object(object).unwrap().properties.iter().map(|p| (p.name.clone(), p.value, p.name_span, p.is_default)).collect();
        let object_type_name = self.model.object(object).unwrap().type_name.clone();
        let shown_type = object_type_name.clone().unwrap_or_else(|| self.model.record_name(type_id).to_string());
        for (i, (name, value, name_span, is_default)) in properties.into_iter().enumerate() {
            if is_default {
                continue;
            }
            let Some(field) = self.model.field_of(type_id, &name) else {
                let message = match self.model.extension_member(type_id, &name) {
                    Some(extension) => {
                        let declaring = self.model.fields[extension].declaring_type.map(|t| self.model.record_name(t).to_string()).unwrap_or_default();
                        format!(
                            "'{}' is an extension member of {}, not a field. A program document sets it through a reference: '@name.{} = ...'.",
                            name, declaring, name
                        )
                    }
                    None => format!("A {} has no field '{}'. Its fields are: {}.", shown_type, name, self.model.field_list(type_id)),
                };
                self.report(sink, s, message, name_span);
                continue;
            };

            if let Some(fixed_by) = self.model.fixed_by(type_id, &name) {
                let fixed_value = self.model.fixed_value(type_id, &name).unwrap();
                let message = format!(
                    "'{}' is fixed by {} ('{} = {}'), so a {} cannot set it.",
                    name,
                    self.model.record_name(fixed_by),
                    name,
                    self.shown_value(fixed_value),
                    shown_type
                );
                self.report(sink, s, message, name_span);
                continue;
            }

            let field_type = self.model.fields[field].field_type;
            let checked = self.check_value(value, Some(field_type), s, sink);
            self.model.object_mut(object).unwrap().properties[i].value = checked;
        }

        if self.is_patch {
            return;
        }

        for field in self.model.fields_of(type_id) {
            let name = self.model.fields[field].name.clone();
            if self.model.object(object).unwrap().contains(&name) {
                continue;
            }
            let field_span = self.model.fields[field].span;
            if let Some(fixed_value) = self.model.fixed_value(type_id, &name) {
                self.model.try_add(object, Property { name, value: fixed_value, name_span: field_span, span: field_span, is_default: true });
            } else if let Some(default) = self.model.fields[field].default {
                self.model.try_add(object, Property { name, value: default, name_span: field_span, span: field_span, is_default: true });
            } else if self.model.includes_nic(self.model.fields[field].field_type) {
                let nic = self.model.add_value(ValueKind::Nic, field_span);
                self.model.try_add(object, Property { name, value: nic, name_span: field_span, span: field_span, is_default: true });
            } else {
                let at = if object == self.states[s].root && self.states[s].root_span.length != 0 {
                    self.states[s].root_span
                } else {
                    self.constructor_span(object, s)
                };
                let message = format!(
                    "A {} requires '{}' ({}), and it is not set.",
                    shown_type,
                    name,
                    self.model.type_string(self.model.fields[field].field_type)
                );
                self.report(sink, s, message, at);
            }
        }
    }

    /// A value whose position gives it no type: an untyped document, or a field the schema does not know.
    fn check_untyped(&mut self, value: ValueId, s: usize, sink: Sink) -> ValueId {
        let span = self.model.values[value].span;
        match self.model.values[value].kind.clone() {
            ValueKind::Empty => {
                if !self.typed {
                    return self.model.add_value(ValueKind::Array(Vec::new()), span);
                }
                self.report(
                    sink,
                    s,
                    "Nothing here says which empty this is: a list, a map or text. Write '[]' or '' instead.".to_string(),
                    span,
                );
                value
            }
            ValueKind::Enum { member, enum_type: None } => {
                let message = format!(
                    "'{}' is a bare word, which is an enum member, and nothing here says which enum. Write 'Enum.{}', or quote it ('{}') if you meant text.",
                    member, member, member
                );
                self.report(sink, s, message, span);
                value
            }
            ValueKind::Object(object) => {
                if !object.is_map {
                    if let Some(record_type) = object.record_type {
                        self.check_record(value, record_type, s, sink);
                        return value;
                    }
                }

                // A record whose type did not resolve has already been reported.
                if self.typed && !object.is_map && object.type_name.is_some() {
                    return value;
                }

                for (i, property) in object.properties.iter().enumerate() {
                    let checked = self.check_untyped(property.value, s, sink);
                    self.model.object_mut(value).unwrap().properties[i].value = checked;
                }
                value
            }
            ValueKind::Array(array) => {
                for (i, item) in array.into_iter().enumerate() {
                    let checked = self.check_untyped(item, s, sink);
                    self.replace_item(value, i, checked);
                }
                value
            }
            _ => value,
        }
    }

    fn report_unresolved_references(&mut self) {
        for i in 0..self.references.len() {
            let pending = &self.references[i];
            let target = match &self.model.values[pending.reference].kind {
                ValueKind::Reference { target, .. } => *target,
                _ => None,
            };
            if pending.reported || target.is_some() {
                continue;
            }
            let name = match &self.model.values[pending.reference].kind {
                ValueKind::Reference { path, .. } => path.join("."),
                _ => String::new(),
            };
            let message = pending.failure.clone().unwrap_or_else(|| format!("Nothing is named '{}'.", name));
            let document = pending.document;
            let span = self.model.values[pending.reference].span;
            self.error(document, message, span);
            self.references[i].reported = true;
        }
    }

    fn check_nameofs(&mut self) {
        for i in 0..self.nameofs.len() {
            let path = self.nameofs[i].path.clone();
            let document = self.nameofs[i].document;
            let span = self.nameofs[i].span;
            if path.len() == 1 && self.type_named(&path[0], document).is_some() {
                continue;
            }

            let candidates = self.find(&path[0], Some(document), false);
            let mut found = false;
            let mut failure: Option<String> = None;
            for candidate in &candidates {
                if found {
                    break;
                }
                let (target, why) = self.walk(candidate.value, &path, 1);
                failure = why;
                found = target.is_some();
            }

            if !found {
                let message = if candidates.is_empty() {
                    format!("nameof({}): nothing is named '{}'.", path.join("."), path[0])
                } else {
                    format!("nameof({}): {}", path.join("."), failure.unwrap_or_default())
                };
                self.error(document, message, span);
            }
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────

    pub fn declared_record_type(&self, name: Option<&str>, s: usize) -> Option<TypeId> {
        let declared = self.type_named(name?, s)?;
        let resolved = self.model.resolved(declared);
        if self.model.record(resolved).is_some() { Some(resolved) } else { None }
    }

    /// The type a field or entry named `name` has inside a value of `container`.
    pub fn child_type(&self, container: Option<TypeId>, name: &str) -> Option<TypeId> {
        let resolved = self.unwrap_type(container)?;
        match &self.model.types[resolved].kind {
            TypeKind::Record(_) => self.model.field_of(resolved, name).map(|f| self.model.fields[f].field_type),
            TypeKind::Map(_, value) => Some(*value),
            _ => None,
        }
    }

    /// A type with aliases followed and a `T?` read as its `T`.
    pub fn unwrap_type(&self, type_id: Option<TypeId>) -> Option<TypeId> {
        let mut current = self.model.resolved(type_id?);
        while let TypeKind::Optional(inner) = self.model.types[current].kind {
            current = self.model.resolved(inner);
        }
        if let TypeKind::Union(alternatives) = &self.model.types[current].kind {
            let mut single: Option<TypeId> = None;
            for alternative in alternatives {
                let resolved = self.model.resolved(*alternative);
                if self.model.is_named(resolved, "nic") {
                    continue;
                }
                if single.is_some() {
                    return Some(current);
                }
                single = Some(resolved);
            }
            return Some(single.unwrap_or(current));
        }
        Some(current)
    }

    pub fn not_a_member(&self, member: &str, enum_type: TypeId) -> String {
        let name = self.model.enum_name(enum_type);
        format!("'{}' is not a {}. A {} is one of: {}.", member, name, name, self.model.member_list(enum_type))
    }

    pub fn expected(&self, what: &str, value: ValueId) -> String {
        match &self.model.values[value].kind {
            ValueKind::Enum { member, enum_type: None } => format!("'{}' is not {}.", member, what),
            _ => format!("This is {}, and it must be {}.", self.model.describe(value), what),
        }
    }

    pub fn names_of(&self, object: ValueId) -> String {
        let properties = &self.model.object(object).unwrap().properties;
        if properties.is_empty() {
            return "nothing".to_string();
        }
        properties.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")
    }

    /// A value as it would be written: `true`, `1`, `'text'`.
    pub fn shown_value(&self, value: ValueId) -> String {
        match &self.model.values[value].kind {
            ValueKind::Boolean(b) => if *b { "true" } else { "false" }.to_string(),
            ValueKind::Integer(i) => i.to_string(),
            ValueKind::Float(f) => format_float(*f),
            ValueKind::String(t) | ValueKind::Text(t) => format!("'{}'", t.replace('\'', "''")),
            ValueKind::Enum { member, .. } => member.clone(),
            ValueKind::Nic => "nic".to_string(),
            _ => self.model.describe(value),
        }
    }
}

/// Where a check's diagnostics go: the document, or a union's trial that is thrown away.
#[derive(Clone, Copy)]
pub(super) enum Sink {
    Document,
    Trial(usize),
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

pub(super) fn named_accepts(name: &str, kind: &ValueKind) -> bool {
    match name {
        "text" => matches!(kind, ValueKind::String(_) | ValueKind::Text(_)),
        "int" => matches!(kind, ValueKind::Integer(_)),
        "float" => matches!(kind, ValueKind::Float(_) | ValueKind::Integer(_)),
        "bool" => matches!(kind, ValueKind::Boolean(_)),
        "nic" => matches!(kind, ValueKind::Nic),
        "data" => !matches!(kind, ValueKind::Declaration(_)),
        "any" => true,
        "string" => matches!(kind, ValueKind::String(_)),
        "number" => matches!(kind, ValueKind::Float(_) | ValueKind::Integer(_)),
        _ => !matches!(kind, ValueKind::Nic),
    }
}

pub(super) fn with_article(word: &str) -> String {
    // By sound, as well as a rule this small can: "a unit", "a user", "an effect", "an int".
    let lower = word.to_lowercase();
    let vowel_sound = lower.chars().next().map(|c| "aeiou".contains(c)).unwrap_or(false)
        && !lower.starts_with("uni")
        && !lower.starts_with("use")
        && !lower.starts_with("usu")
        && !lower.starts_with("eu")
        && !lower.starts_with("one");
    format!("{}{}", if vowel_sound { "an " } else { "a " }, word)
}

pub(super) fn join(path: &[String], count: usize) -> String {
    path.iter().take(count).cloned().collect::<Vec<_>>().join(".")
}

pub(super) fn value_text(token: &Token, source: &[u8]) -> String {
    String::from_utf8_lossy(token.text(source)).into_owned()
}

pub(super) fn items<T>(separated: &Separated<T>) -> impl Iterator<Item = &T> {
    separated.elements.iter().filter_map(|e| match e {
        Element::Item(item) => Some(item),
        Element::Separator(_) => None,
    })
}

pub(super) fn names(path: &syntax::Path, source: &[u8]) -> Vec<String> {
    items(&path.segments).map(|t| value_text(t, source)).collect()
}

pub(super) fn statement_span(statement: &Statement) -> TextSpan {
    let mut list = Vec::new();
    tokens::of_statement(statement, &mut list);
    tokens::span(&list)
}

pub(super) fn value_span(value: &syntax::Value) -> TextSpan {
    let mut list = Vec::new();
    tokens::of_value(value, &mut list);
    tokens::span(&list)
}

pub(super) fn type_span(value: &syntax::Type) -> TextSpan {
    let mut list = Vec::new();
    tokens::of_type(value, &mut list);
    tokens::span(&list)
}

pub(super) fn field_item_span(item: &syntax::FieldListItem) -> TextSpan {
    let mut list = Vec::new();
    tokens::of_field_list_item(item, &mut list);
    tokens::span(&list)
}

fn field_value_span(field: &syntax::FieldValue) -> TextSpan {
    let mut list = vec![&field.name, &field.equals];
    tokens::of_value(&field.value, &mut list);
    tokens::span(&list)
}

fn map_entry_span(entry: &syntax::MapEntry) -> TextSpan {
    let mut list = vec![&entry.key, &entry.equals];
    tokens::of_value(&entry.value, &mut list);
    tokens::span(&list)
}

fn type_directive<'d>(document: &'d DocumentSyntax, source: &[u8]) -> Option<&'d Statement> {
    document.statements.iter().find(|s| matches!(s, Statement::Directive { directive, .. } if directive.is(source, b"#type")))
}

fn first_assignment(document: &DocumentSyntax) -> Option<usize> {
    document.statements.iter().position(|s| matches!(s, Statement::Assignment { .. }))
}

fn file_name(name: &str) -> &str {
    match name.rfind(['/', '\\']) {
        Some(index) => &name[index + 1..],
        None => name,
    }
}

pub(super) fn is_identifier(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut position = 0;
    super::identifiers::try_read(bytes, &mut position, bytes.len()) && position == bytes.len()
}

fn undouble_quotes(escaped: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(escaped.len());
    let mut index = 0;
    while index < escaped.len() {
        result.push(escaped[index]);
        if escaped[index] == b'\'' && index + 1 < escaped.len() && escaped[index + 1] == b'\'' {
            index += 1;
        }
        index += 1;
    }
    result
}

/// A text table's text: line breaks read as LF, `\@@@` at a line's start read as `@@@`, one trailing line break
/// removed.
fn decode_table(body: &[u8]) -> String {
    let mut text = String::from_utf8_lossy(body).replace("\r\n", "\n");
    if text.ends_with('\n') {
        text.pop();
    }
    if text.starts_with("\\@@@") || text.contains("\n\\@@@") {
        let lines: Vec<&str> = text.split('\n').collect();
        text = lines.iter().map(|l| if let Some(rest) = l.strip_prefix('\\') { if rest.starts_with("@@@") { rest } else { l } } else { l }).collect::<Vec<_>>().join("\n");
    }
    text
}

/// A number as .NET writes a double: the shortest text that reads back as it.
pub(super) fn format_float(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "∞".to_string() } else { "-∞".to_string() };
    }
    let magnitude = value.abs();
    if magnitude != 0.0 && (magnitude >= 1e15 || magnitude < 1e-4) {
        let formatted = format!("{:e}", value);
        let (mantissa, exponent) = formatted.split_once('e').unwrap();
        let exponent: i32 = exponent.parse().unwrap();
        return format!("{}E{}{:02}", mantissa, if exponent < 0 { '-' } else { '+' }, exponent.abs());
    }
    format!("{}", value)
}


// ── what a host's validation sees ────────────────────────────────────────────────────────────────

impl Binder<'_> {
    pub(super) fn view(&self, index: usize) -> super::host::DocumentView {
        let state = &self.states[index];
        super::host::DocumentView { index, name: state.root_name.clone(), is_schema: state.is_schema, is_program: state.is_program, root: state.root }
    }

    /// Which document each value is written in: every value in each root's tree, its texts and declarations. A
    /// reference's target is written somewhere else, and indexed there.
    fn index_value_documents(&self) -> HashMap<ValueId, usize> {
        fn walk(model: &Model, value: ValueId, s: usize, values: &mut HashMap<ValueId, usize>) {
            if values.contains_key(&value) {
                return;
            }
            values.insert(value, s);
            match &model.values[value].kind {
                ValueKind::Object(object) => {
                    for property in &object.properties {
                        walk(model, property.value, s, values);
                    }
                }
                ValueKind::Array(array) => {
                    for item in array {
                        walk(model, *item, s, values);
                    }
                }
                _ => {}
            }
        }
        let mut values: HashMap<ValueId, usize> = HashMap::new();
        for (s, state) in self.states.iter().enumerate() {
            walk(&self.model, state.root, s, &mut values);
            for (_, text) in &state.texts {
                values.entry(*text).or_insert(s);
            }
            for declaration in &state.declarations {
                values.entry(*declaration).or_insert(s);
            }
        }
        values
    }
}

impl super::host::ValidationContext for Binder<'_> {
    fn model(&self) -> &Model {
        &self.model
    }

    fn documents(&self) -> Vec<super::host::DocumentView> {
        (0..self.states.len()).filter(|s| !self.states[*s].is_schema).map(|s| self.view(s)).collect()
    }

    fn types(&self) -> Vec<(String, TypeId)> {
        self.type_names.clone()
    }

    fn document(&self, name: &str) -> Option<super::host::DocumentView> {
        let documents = (0..self.states.len()).filter(|s| !self.states[*s].is_schema);
        let schemas = (0..self.states.len()).filter(|s| self.states[*s].is_schema);
        documents.chain(schemas).find(|s| self.states[*s].root_name.as_deref() == Some(name)).map(|s| self.view(s))
    }

    fn declaring_document_of_type(&self, type_id: TypeId) -> Option<super::host::DocumentView> {
        self.type_states.get(&type_id).map(|s| self.view(*s))
    }

    fn declaring_document_of_field(&self, field: FieldId) -> Option<super::host::DocumentView> {
        self.field_states.get(&field).map(|s| self.view(*s))
    }

    fn document_of(&mut self, value: ValueId) -> Option<super::host::DocumentView> {
        if self.value_documents.is_none() {
            self.value_documents = Some(self.index_value_documents());
        }
        let s = *self.value_documents.as_ref().unwrap().get(&value)?;
        Some(self.view(s))
    }

    fn error(&mut self, document: usize, span: TextSpan, message: String) {
        self.states[document].diagnostics.push(BoundDiagnostic::error(message, span));
    }
}
