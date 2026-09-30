//! Bodies checked against the host's environment: names, calls, members, and Booleans where a Boolean is needed. A port
//! of `AlexBinder.Program.cs`'s `CheckBodies` and `BodyChecker`.

use std::collections::HashSet;

use super::binder::*;
use super::host::{Parameter, Scope, ScopeRequest, Signature};
use super::model::*;
use super::syntax::{self, Body, BodyStatement, Expression, LiteralKind, Statement, TextSpan, TokenKind};
use super::tokens;

/// The built-in types a body speaks in, made once per binding.
pub(super) struct BodyTypes {
    int: TypeId,
    float: TypeId,
    text: TypeId,
    boolean: TypeId,
    data: TypeId,
    nothing: TypeId,
}

impl Binder<'_> {
    pub(super) fn check_bodies(&mut self) {
        if !self.host.has_environment() {
            return;
        }

        let named = |model: &mut Model, name: &str| model.add_type(TypeKind::Named { name: name.to_string(), is_host: false }, TextSpan::default());
        let types = BodyTypes {
            int: named(&mut self.model, "int"),
            float: named(&mut self.model, "float"),
            text: named(&mut self.model, "text"),
            boolean: named(&mut self.model, "bool"),
            data: named(&mut self.model, "data"),
            nothing: named(&mut self.model, "nothing"),
        };

        for s in 0..self.states.len() {
            for value in self.states[s].declarations.clone() {
                let ValueKind::Declaration(declaration) = self.model.values[value].kind else { continue };

                // One check per member it is attached to, and one with no attachment when it is attached to nothing.
                let mut sites: Vec<Vec<Attachment>> = Vec::new();
                for attachment in self.model.declarations[declaration].attachments.clone() {
                    match sites.iter_mut().find(|site| site[0].member == attachment.member) {
                        Some(site) => site.push(attachment),
                        None => sites.push(vec![attachment]),
                    }
                }
                if sites.is_empty() {
                    sites.push(Vec::new());
                }

                let mut reported: HashSet<(u32, String)> = HashSet::new();
                let count = sites.len();
                for site in sites {
                    let place = if count > 1 && !site.is_empty() {
                        let a = &site[0];
                        Some(format!(" (attached as @{}.{})", a.path.join("."), self.model.fields[a.member].name))
                    } else {
                        None
                    };
                    let request = ScopeRequest {
                        declaration,
                        kind: self.model.declarations[declaration].kind.clone(),
                        attachments: site,
                        types: self.type_names.clone(),
                        roots: self.roots(),
                    };
                    let host = self.host;
                    let Some(scope) = host.scope_for(&mut self.model, &request) else { continue };
                    let mut checker = BodyChecker { binder: self, state: s, declaration, scope, place, reported: &mut reported, locals: Vec::new(), types: &types };
                    checker.check();
                }
            }
        }
    }

    /// Each document's and schema's root, by its name, in the order bound.
    pub(super) fn roots(&self) -> Vec<(String, ValueId)> {
        self.states.iter().filter_map(|s| s.root_name.clone().map(|n| (n, s.root))).collect()
    }
}

struct BodyChecker<'c, 'h> {
    binder: &'c mut Binder<'h>,
    state: usize,
    declaration: DeclarationId,
    scope: Box<dyn Scope>,
    place: Option<String>,
    reported: &'c mut HashSet<(u32, String)>,
    locals: Vec<Vec<(String, Option<TypeId>)>>,
    types: &'c BodyTypes,
}

impl BodyChecker<'_, '_> {
    fn bytes(&self) -> std::rc::Rc<Vec<u8>> {
        self.binder.states[self.state].bytes.clone()
    }

    fn text(&self, token: &syntax::Token) -> String {
        value_text(token, &self.bytes())
    }

    fn check(&mut self) {
        let declaration = &self.binder.model.declarations[self.declaration];
        let (document, statement) = (declaration.document, declaration.statement);
        let kind = declaration.kind.clone();
        let TypeKind::Function { shape, .. } = self.binder.model.types[declaration.function_type].kind else { return };
        let tree = self.binder.states[document].tree.clone();
        if let Statement::ReferenceAssignment { value: syntax::Value::InlineStatement { statement: inline }, .. } = &tree.root.statements[statement] {
            if let (BodyStatement::Expression(expression), BodyShape::Expression) = (inline.as_ref(), shape) {
                let boolean = self.types.boolean;
                let found = self.expression(expression, Some(boolean));
                self.require_bool(found, expression, &format!("The body of {}", with_article(&kind)));
                return;
            }
            self.locals.push(Vec::new());
            self.check_statement(inline);
            self.locals.pop();
            return;
        }
        let Statement::Declaration { body, .. } = &tree.root.statements[statement] else { return };
        let bytes = self.bytes();

        match shape {
            BodyShape::Statements => {
                if let Body::Block(block) = body {
                    self.check_block(block);
                }
            }
            BodyShape::Expression => {
                let expression = match body {
                    Body::Expression { expression, .. } => Some(expression),
                    Body::Block(block) if block.statements.len() == 1 => match &block.statements[0] {
                        BodyStatement::Expression(expression) => Some(expression),
                        _ => None,
                    },
                    _ => None,
                };
                if let Some(expression) = expression {
                    let boolean = self.types.boolean;
                    let found = self.expression(expression, Some(boolean));
                    self.require_bool(found, expression, &format!("The body of {}", with_article(&kind)));
                }
            }
            BodyShape::Scenario => {
                let Body::Block(scenario) = body else { return };
                for statement in &scenario.statements {
                    let BodyStatement::Section { label, items: section_items } = statement else { continue };
                    let then = label.is(&bytes, b"then");
                    for expression in items(section_items) {
                        if then {
                            let boolean = self.types.boolean;
                            let found = self.expression(expression, Some(boolean));
                            self.require_bool(found, expression, "Each item of 'then'");
                            continue;
                        }
                        if !matches!(expression, Expression::Call { .. } | Expression::Missing { .. }) {
                            let message = format!("Each item of '{}' is a call, such as 'controls(me, @corgi)'.", value_text(label, &bytes));
                            self.error(message, expression_span(expression));
                        }
                        self.expression(expression, None);
                    }
                }
            }
        }
    }

    // ── statements ───────────────────────────────────────────────────────────────────────────

    fn check_block(&mut self, block: &syntax::Block) {
        self.locals.push(Vec::new());
        for statement in &block.statements {
            self.check_statement(statement);
        }
        self.locals.pop();
    }

    fn check_statement(&mut self, statement: &BodyStatement) {
        match statement {
            BodyStatement::Binding { name, value, .. } => {
                let text = self.text(name);
                if !self.scope.can_bind(&text) {
                    let bindable = self.scope.bindable();
                    let rest = if bindable.is_empty() { "A body here binds nothing.".to_string() } else { format!("A body may bind: {}.", bindable.join(", ")) };
                    self.error(format!("'{}' cannot be bound here. {}", text, rest), name.span);
                } else if self.try_local(&text).is_some() {
                    self.error(format!("'{}' is already bound; a local is bound once.", text), name.span);
                }
                let found = self.expression(value, None);
                let scope = self.locals.last_mut().unwrap();
                match scope.iter_mut().find(|(n, _)| *n == text) {
                    Some(entry) => entry.1 = found,
                    None => scope.push((text, found)),
                }
            }
            BodyStatement::Expression(expression) => {
                if !matches!(expression, Expression::Call { .. } | Expression::Missing { .. }) {
                    let message = format!("A statement in a body is a call, such as 'draw(1)'; this is {}.", describe_expression(expression));
                    self.error(message, body_statement_span(statement));
                }
                self.expression(expression, None);
            }
            BodyStatement::CompoundCall { call, operator, delta } => {
                let Expression::Call { .. } = call else {
                    let message = format!("'{}' adds to a call, such as 'x.counter(@Crumb) += 1'.", self.text(operator));
                    self.error(message, operator.span);
                    self.expression(call, None);
                    self.expression(delta, None);
                    return;
                };
                let is_subtraction = operator.kind == TokenKind::MinusEquals;
                if is_subtraction && !matches!(delta, Expression::Literal { kind: LiteralKind::Integer, .. }) {
                    self.error(
                        "The right side of '-=' is a whole number. There is no arithmetic, so nothing else can be negated.".to_string(),
                        expression_span(delta),
                    );
                }
                self.check_call(call, Some(delta));
            }
            BodyStatement::If { condition, then, otherwise, .. } => {
                let boolean = self.types.boolean;
                let found = self.expression(condition, Some(boolean));
                self.require_bool(found, condition, "The condition of 'if'");
                self.check_block(then);
                if let Some(otherwise) = otherwise {
                    self.check_block(otherwise);
                }
            }
            BodyStatement::Section { .. } => {}
        }
    }

    // ── expressions ──────────────────────────────────────────────────────────────────────────

    fn expression(&mut self, expression: &Expression, expected: Option<TypeId>) -> Option<TypeId> {
        match expression {
            Expression::Literal { kind, token } => match kind {
                LiteralKind::Integer => {
                    let text = self.text(token);
                    if text.parse::<i64>().is_err() {
                        self.error(format!("'{}' is too large for a whole number.", text), expression_span(expression));
                    }
                    Some(self.types.int)
                }
                LiteralKind::Float => {
                    let text = self.text(token);
                    self.error(format!("A body has whole numbers only; '{}' is not one.", text), expression_span(expression));
                    Some(self.types.int)
                }
                LiteralKind::String => Some(self.types.text),
                _ => Some(self.types.boolean),
            },
            Expression::Name { identifier } => self.name(identifier, expected),
            Expression::Reference { path, .. } => {
                if tokens::path_span(path).length == 0 {
                    return None;
                }
                let path_names = names(path, &self.bytes());
                let state = self.state;
                let (target, error) = self.binder.resolve_path(&path_names, state, false);
                let Some(target) = target else {
                    let message = error.unwrap_or_else(|| format!("Nothing is named '{}'.", path_names.join(".")));
                    self.error(message, expression_span(expression));
                    return None;
                };
                Some(self.type_of_value(target))
            }
            Expression::MemberAccess { receiver, name, .. } => {
                let receiver_type = self.expression(receiver, None)?;
                if name.is_missing {
                    return None;
                }
                let text = self.text(name);
                if let Some(found) = self.scope.member(&mut self.binder.model, receiver_type, &text) {
                    return Some(found);
                }
                let resolved = self.binder.model.resolved(receiver_type);
                if self.binder.model.record(resolved).is_some() {
                    if let Some(field) = self.binder.model.field_of(resolved, &text) {
                        return Some(self.binder.model.fields[field].field_type);
                    }
                }
                let members = self.scope.members(&mut self.binder.model, receiver_type);
                let listed = if members.is_empty() { String::new() } else { format!(" Its members are: {}.", members.join(", ")) };
                let message = format!("{} has no member '{}'.{}", with_article(&self.shown(receiver_type)), text, listed);
                self.error(message, name.span);
                None
            }
            Expression::Call { .. } => self.check_call(expression, None),
            Expression::Unary { operand, .. } => {
                let boolean = self.types.boolean;
                let found = self.expression(operand, Some(boolean));
                self.require_bool(found, operand, "What 'not' negates");
                Some(boolean)
            }
            Expression::Signed { operand, .. } => {
                // A sign says a quantity is a move up; it is the same number, so it signs only a number.
                let found = self.expression(operand, expected);
                if let Some(found) = found {
                    if !self.is_number(found) {
                        let message = format!("'+' signs a number; this is {}.", with_article(&self.shown(found)));
                        self.error(message, expression_span(operand));
                    }
                }
                found
            }
            Expression::Binary { left, operator, right } => self.binary(left, operator, right),
            Expression::Parenthesized { inner, .. } => self.expression(inner, expected),
            Expression::Missing { .. } => None,
        }
    }

    fn name(&mut self, identifier: &syntax::Token, expected: Option<TypeId>) -> Option<TypeId> {
        let word = self.text(identifier);
        if let Some(local) = self.try_local(&word) {
            return local;
        }
        if let Some(in_scope) = self.scope.type_of(&mut self.binder.model, &word) {
            return Some(in_scope);
        }

        let mut enums: Vec<TypeId> = Vec::new();
        if let Some(expected) = expected {
            let mut alternatives = Vec::new();
            self.binder.flatten(expected, &mut alternatives);
            for alternative in alternatives.iter().copied() {
                if matches!(self.binder.model.types[alternative].kind, TypeKind::Enum { .. }) {
                    if self.binder.model.enum_contains(alternative, &word) {
                        return Some(alternative);
                    }
                    enums.push(alternative);
                }
            }
            if let Some(meaning) = self.scope.word(&mut self.binder.model, &word, expected) {
                return Some(meaning);
            }

            // A backed enum's member where its backing type is expected: 'two' where an int is.
            let mut backed: Vec<TypeId> = Vec::new();
            for alternative in alternatives {
                let TypeKind::Named { name, .. } = &self.binder.model.types[alternative].kind else { continue };
                for found in self.binder.backed_enums_with(&word, name) {
                    if !backed.contains(&found) {
                        backed.push(found);
                    }
                }
            }
            if backed.len() == 1 {
                return Some(backed[0]);
            }
            if backed.len() > 1 {
                let names: Vec<&str> = backed.iter().map(|e| self.binder.model.enum_name(*e)).collect();
                let message = format!(
                    "'{}' is a member of more than one enum: {}. A body cannot say which, so give the member another name in one of them.",
                    word,
                    names.join(", ")
                );
                self.error(message, identifier.span);
                return None;
            }
        }

        let mut message = format!("Nothing is named '{}' here.", word);
        for e in &enums {
            message.push_str(&format!(" A {} is one of: {}.", self.binder.model.enum_name(*e), self.binder.model.member_list(*e)));
        }
        let names = self.in_scope();
        if !names.is_empty() {
            message.push_str(&format!(" In scope: {}.", names.join(", ")));
        }
        self.error(message, identifier.span);
        None
    }

    fn binary(&mut self, left: &Expression, operator: &syntax::Token, right: &Expression) -> Option<TypeId> {
        let bytes = self.bytes();
        let operator_text = value_text(operator, &bytes);
        let boolean = self.types.boolean;
        let logical = operator.kind == TokenKind::Identifier;
        if logical {
            let what = format!("Each side of '{}'", operator_text);
            let found = self.expression(left, Some(boolean));
            self.require_bool(found, left, &what);
            let found = self.expression(right, Some(boolean));
            self.require_bool(found, right, &what);
            return Some(boolean);
        }

        let left_type = self.expression(left, None);
        let right_type = self.expression(right, left_type);
        let (Some(left_type), Some(right_type)) = (left_type, right_type) else { return Some(boolean) };

        let ordering = matches!(operator.kind, TokenKind::Less | TokenKind::LessEquals | TokenKind::Greater | TokenKind::GreaterEquals);
        if ordering {
            if !self.is_number(left_type) || !self.is_number(right_type) {
                let message = format!(
                    "'{}' compares numbers; this compares {} with {}.",
                    operator_text,
                    with_article(&self.shown(left_type)),
                    with_article(&self.shown(right_type))
                );
                self.error(message, operator.span);
            }
        } else if !self.assignable(left_type, right_type) && !self.assignable(right_type, left_type) {
            let message = format!("{} and {} cannot be compared.", with_article(&self.shown(left_type)), with_article(&self.shown(right_type)));
            self.error(message, operator.span);
        }
        Some(boolean)
    }

    fn check_call(&mut self, call: &Expression, delta: Option<&Expression>) -> Option<TypeId> {
        let Expression::Call { callee, arguments, .. } = call else { return None };
        let bytes = self.bytes();
        let mut signature: Option<Signature> = None;
        match callee.as_ref() {
            Expression::Name { identifier } => {
                let name = value_text(identifier, &bytes);
                signature = self.scope.function(&mut self.binder.model, &name);
                if signature.is_none() {
                    let functions = self.scope.functions(&mut self.binder.model);
                    let is_value = self.try_local(&name).is_some() || self.scope.type_of(&mut self.binder.model, &name).is_some();
                    let head = if is_value { format!("'{}' is not a function.", name) } else { format!("Nothing called '{}' can be called here.", name) };
                    let tail = if functions.is_empty() { String::new() } else { format!(" The functions are: {}.", functions.join(", ")) };
                    self.error(format!("{}{}", head, tail), expression_span(callee));
                }
            }
            Expression::MemberAccess { receiver, name, .. } => {
                let receiver_type = self.expression(receiver, None);
                if let Some(receiver_type) = receiver_type.filter(|_| !name.is_missing) {
                    let text = value_text(name, &bytes);
                    signature = self.scope.method(&mut self.binder.model, receiver_type, &text);
                    if signature.is_none() {
                        let methods = self.scope.methods(&mut self.binder.model, receiver_type);
                        let tail = if methods.is_empty() { String::new() } else { format!(" Its functions are: {}.", methods.join(", ")) };
                        let message = format!("{} has no function '{}'.{}", with_article(&self.shown(receiver_type)), text, tail);
                        self.error(message, name.span);
                    }
                }
            }
            _ => self.error("Only a name or a member can be called.".to_string(), expression_span(callee)),
        }

        let Some(signature) = signature else {
            // With no parameter to give a bare word its type, it cannot be judged.
            for argument in items(arguments) {
                if !matches!(argument.value, Expression::Name { .. }) {
                    self.expression(&argument.value, None);
                }
            }
            if let Some(delta) = delta {
                self.expression(delta, None);
            }
            return None;
        };

        self.bind_arguments(&signature, call, arguments, delta);
        Some(signature.result.unwrap_or(self.types.nothing))
    }

    fn bind_arguments(&mut self, signature: &Signature, call: &Expression, arguments: &syntax::Separated<syntax::Argument>, delta: Option<&Expression>) {
        let bytes = self.bytes();
        let mut given: HashSet<String> = HashSet::new();
        let absorbing: Option<Parameter> = signature.parameters.iter().find(|p| p.absorbs).cloned();
        let mut position = 0;
        let mut named = false;
        for argument in items(arguments) {
            let parameter: Parameter;
            match &argument.name {
                None => {
                    let reaches_absorbing = absorbing.is_some()
                        && (named || position >= signature.parameters.len() || signature.parameters[position].name == absorbing.as_ref().unwrap().name);
                    if reaches_absorbing {
                        let absorbing = absorbing.clone().unwrap();
                        given.insert(absorbing.name.clone());
                        self.check_argument(&absorbing, &argument.value);
                        continue;
                    }
                    if named {
                        self.error("A positional argument cannot follow a named one.".to_string(), argument_span(argument));
                        self.expression(&argument.value, None);
                        continue;
                    }
                    if position >= signature.parameters.len() {
                        let count = signature.parameters.len();
                        let message = format!(
                            "'{}' takes {} argument{}: {}.",
                            signature.name,
                            count,
                            if count == 1 { "" } else { "s" },
                            signature.parameter_list(&self.binder.model)
                        );
                        self.error(message, argument_span(argument));
                        self.expression(&argument.value, None);
                        continue;
                    }
                    parameter = signature.parameters[position].clone();
                    position += 1;
                }
                Some(name_token) => {
                    named = true;
                    let name = value_text(name_token, &bytes);
                    let found = signature.parameter(&name).cloned();
                    if found.is_none() {
                        if let Some(absorbing) = &absorbing {
                            if let Some(absorbed_type) = self.scope.absorbed(&mut self.binder.model, signature, absorbing, &name) {
                                given.insert(absorbing.name.clone());
                                let as_parameter = Parameter { name: name.clone(), parameter_type: absorbed_type, is_optional: false, absorbs: false };
                                self.check_argument(&as_parameter, &argument.value);
                                continue;
                            }
                        }
                    }
                    let Some(found) = found else {
                        // Meant for the absorbing parameter, if there is one: reporting it as missing too would say it twice.
                        if let Some(absorbing) = &absorbing {
                            given.insert(absorbing.name.clone());
                        }
                        let message = format!(
                            "'{}' has no parameter '{}'. Its parameters are: {}.",
                            signature.name,
                            name,
                            signature.parameter_list(&self.binder.model)
                        );
                        self.error(message, name_token.span);
                        self.expression(&argument.value, None);
                        continue;
                    };
                    parameter = found;
                }
            }

            if !given.insert(parameter.name.clone()) {
                self.error(format!("'{}' is given twice.", parameter.name), argument_span(argument));
                continue;
            }
            self.check_argument(&parameter, &argument.value);
        }

        if let Some(delta) = delta {
            match signature.parameter("delta").cloned() {
                None => {
                    self.error(format!("'{}' takes no 'delta', so it cannot be written with '+=' or '-='.", signature.name), expression_span(delta));
                    self.expression(delta, None);
                }
                Some(parameter) => {
                    if !given.insert(parameter.name.clone()) {
                        self.error("'delta' is given twice: as an argument and by '+='.".to_string(), expression_span(delta));
                    } else {
                        self.check_argument(&parameter, delta);
                    }
                }
            }
        }

        for parameter in &signature.parameters {
            if !parameter.is_optional && !given.contains(&parameter.name) {
                let message = format!(
                    "'{}' requires '{}' ({}). Its parameters are: {}.",
                    signature.name,
                    parameter.name,
                    self.shown(parameter.parameter_type),
                    signature.parameter_list(&self.binder.model)
                );
                self.error(message, expression_span(call));
            }
        }
    }

    fn check_argument(&mut self, parameter: &Parameter, value: &Expression) {
        let found = self.expression(value, Some(parameter.parameter_type));
        if let Some(found) = found {
            if !self.assignable(found, parameter.parameter_type) {
                let message = format!(
                    "'{}' takes {}, and this is {}.",
                    parameter.name,
                    with_article(&self.shown(parameter.parameter_type)),
                    with_article(&self.shown(found))
                );
                self.error(message, expression_span(value));
            }
        }
    }

    // ── types ────────────────────────────────────────────────────────────────────────────────

    fn assignable(&mut self, value: TypeId, target: TypeId) -> bool {
        let from = self.binder.model.resolved(value);
        let to = self.binder.model.resolved(target);
        if from == to {
            return true;
        }

        match self.binder.model.types[to].kind.clone() {
            TypeKind::Named { name, .. } if name == "any" => return true,
            TypeKind::Optional(inner) => return self.assignable(value, inner),
            TypeKind::Union(alternatives) => {
                for alternative in alternatives {
                    if self.assignable(value, alternative) {
                        return true;
                    }
                }
            }
            TypeKind::Named { name, .. } if name == "data" => {
                if self.binder.is_data(from) {
                    return true;
                }
            }
            _ => {}
        }

        if let (TypeKind::Enum { .. }, TypeKind::Named { name, .. }) = (&self.binder.model.types[from].kind, &self.binder.model.types[to].kind) {
            if self.binder.backs(from, name) {
                return true;
            }
        }
        let model = &self.binder.model;
        if let (TypeKind::Named { name: from_name, .. }, TypeKind::Named { name: to_name, .. }) = (&model.types[from].kind, &model.types[to].kind) {
            if from_name == to_name || (from_name == "int" && to_name == "float") {
                return true;
            }
        }
        if model.record(from).is_some() && model.record(to).is_some() && model.is_or_viewed_as(from, to) {
            return true;
        }
        if let (TypeKind::Function { kind: from_kind, .. }, TypeKind::Function { kind: to_kind, .. }) = (&model.types[from].kind, &model.types[to].kind) {
            if from_kind == to_kind {
                return true;
            }
        }

        self.scope.is_assignable(&mut self.binder.model, value, target)
    }

    fn is_number(&self, type_id: TypeId) -> bool {
        let resolved = self.binder.model.resolved(type_id);
        match &self.binder.model.types[resolved].kind {
            TypeKind::Named { name, .. } => name == "int" || name == "float",
            TypeKind::Enum { backing: Some(backing), .. } => backing.type_name == "int",
            _ => false,
        }
    }

    fn require_bool(&mut self, found: Option<TypeId>, expression: &Expression, what: &str) {
        let Some(found) = found else { return };
        let boolean = self.types.boolean;
        if self.assignable(found, boolean) {
            return;
        }
        let message = format!("{} must be true or false; this is {}.", what, with_article(&self.shown(found)));
        self.error(message, expression_span(expression));
    }

    fn type_of_value(&mut self, value: ValueId) -> TypeId {
        let model = &self.binder.model;
        match &model.values[value].kind {
            ValueKind::Declaration(d) => model.declarations[*d].function_type,
            ValueKind::Object(o) if !o.is_map && o.record_type.is_some() => o.record_type.unwrap(),
            ValueKind::Enum { enum_type: Some(t), .. } => *t,
            ValueKind::Integer(_) => self.types.int,
            ValueKind::Float(_) => self.types.float,
            ValueKind::String(_) | ValueKind::Text(_) => self.types.text,
            ValueKind::Boolean(_) => self.types.boolean,
            _ => self.types.data,
        }
    }

    fn shown(&self, type_id: TypeId) -> String {
        let model = &self.binder.model;
        let resolved = model.resolved(type_id);
        if model.is_named(resolved, "nothing") { "call that gives nothing back".to_string() } else { model.type_string(type_id) }
    }

    // ── locals and diagnostics ───────────────────────────────────────────────────────────────

    /// The type a local was bound to: `Some(type)` when bound (the type may be unknown), `None` when not bound.
    fn try_local(&self, name: &str) -> Option<Option<TypeId>> {
        for scope in self.locals.iter().rev() {
            if let Some((_, t)) = scope.iter().find(|(n, _)| n == name) {
                return Some(*t);
            }
        }
        None
    }

    fn in_scope(&mut self) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();
        for scope in &self.locals {
            names.extend(scope.iter().map(|(n, _)| n.clone()));
        }
        names.extend(self.scope.names(&mut self.binder.model));
        names
    }

    fn error(&mut self, message: String, span: TextSpan) {
        let full = match &self.place {
            Some(place) => format!("{}{}", message, place),
            None => message.clone(),
        };
        if self.reported.insert((span.start, message)) {
            let state = self.state;
            self.binder.error(state, full, span);
        }
    }
}

fn describe_expression(expression: &Expression) -> &'static str {
    match expression {
        Expression::Name { .. } => "a name",
        Expression::Reference { .. } => "a reference",
        Expression::Literal { .. } => "a literal",
        Expression::MemberAccess { .. } => "a member",
        Expression::Binary { operator, .. } => {
            if operator.kind == TokenKind::Identifier { "a Boolean" } else { "a comparison" }
        }
        Expression::Unary { .. } => "a Boolean",
        _ => "an expression",
    }
}

pub(super) fn expression_span(expression: &Expression) -> TextSpan {
    let mut list = Vec::new();
    tokens::of_expression(expression, &mut list);
    tokens::span(&list)
}

fn body_statement_span(statement: &BodyStatement) -> TextSpan {
    let mut list = Vec::new();
    tokens::of_body_statement(statement, &mut list);
    tokens::span(&list)
}

fn argument_span(argument: &syntax::Argument) -> TextSpan {
    let mut list = Vec::new();
    if let Some(name) = &argument.name {
        list.push(name);
    }
    if let Some(colon) = &argument.colon {
        list.push(colon);
    }
    tokens::of_expression(&argument.value, &mut list);
    tokens::span(&list)
}
