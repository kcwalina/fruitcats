//! The canonical dump of a parsed file: its tree (every node, every token with its span, flags and trivia), its
//! diagnostics, and whether it writes back out unchanged. The C# Alex prints exactly the same format
//! (`cardengine/conformance`), so the two implementations are compared byte for byte.
//!
//! Diagnostics are listed ordered by start, then length, then message, so the order never depends on how either side
//! sorts.

use std::fmt::Write;

use super::parser::{self, ParseMode};
use super::syntax::*;
use super::writer;

pub fn dump(source: &[u8], mode: ParseMode) -> String {
    let tree = parser::parse(source, mode);
    let mut out = String::new();
    let mut dumper = Dumper { out: &mut out, depth: 0 };
    dumper.document(&tree.root);

    let mut diagnostics: Vec<&Diagnostic> = Vec::new();
    for diagnostic in &tree.diagnostics {
        diagnostics.push(diagnostic);
    }
    diagnostics.sort_by(|left, right| {
        left.span
            .start
            .cmp(&right.span.start)
            .then(left.span.length.cmp(&right.span.length))
            .then(left.message.as_bytes().cmp(right.message.as_bytes()))
    });
    out.push_str("diagnostics\n");
    for diagnostic in diagnostics {
        let _ = writeln!(out, "  {}+{} {}", diagnostic.span.start, diagnostic.span.length, diagnostic.message);
    }

    let mut written: Vec<u8> = Vec::with_capacity(source.len());
    writer::write(&tree.root, source, &mut written);
    out.push_str(if written == source { "round-trip exact\n" } else { "round-trip different\n" });
    out
}

struct Dumper<'o> {
    out: &'o mut String,
    depth: usize,
}

impl<'o> Dumper<'o> {
    fn node(&mut self, name: &str) {
        self.indent();
        self.out.push_str(name);
        self.out.push('\n');
        self.depth += 1;
    }

    fn end(&mut self) {
        self.depth -= 1;
    }

    fn indent(&mut self) {
        for _ in 0..self.depth {
            self.out.push_str("  ");
        }
    }

    fn token(&mut self, token: &Token) {
        self.indent();
        let _ = write!(self.out, "{} {}+{}", token.kind.name(), token.span.start, token.span.length);
        if token.is_missing {
            self.out.push_str(" missing");
        }
        if token.starts_line {
            self.out.push_str(" line");
        }
        self.trivia(" lead", &token.leading);
        self.trivia(" trail", &token.trailing);
        self.out.push('\n');
    }

    fn trivia(&mut self, label: &str, trivia: &[Trivia]) {
        if trivia.is_empty() {
            return;
        }
        self.out.push_str(label);
        self.out.push('[');
        let mut first = true;
        for item in trivia {
            if !first {
                self.out.push(',');
            }
            let _ = write!(self.out, "{} {}+{}", item.kind.name(), item.span.start, item.span.length);
            first = false;
        }
        self.out.push(']');
    }

    fn optional(&mut self, token: &Option<Token>) {
        if let Some(token) = token {
            self.token(token);
        }
    }

    fn separated<T>(&mut self, list: &Separated<T>, mut item: impl FnMut(&mut Self, &T)) {
        for element in &list.elements {
            match element {
                Element::Item(value) => item(self, value),
                Element::Separator(separator) => self.token(separator),
            }
        }
    }

    fn named_token(&mut self, name: &str, token: &Token) {
        self.node(name);
        self.token(token);
        self.end();
    }

    // ── statements ──────────────────────────────────────────────────────────────────────────────

    fn document(&mut self, document: &Document) {
        self.node("Document");
        for statement in &document.statements {
            self.statement(statement);
        }
        self.token(&document.end_of_file);
        self.end();
    }

    fn statement(&mut self, statement: &Statement) {
        match statement {
            Statement::Directive { directive, arguments } => {
                self.node("Directive");
                self.token(directive);
                for argument in arguments {
                    self.token(argument);
                }
            }
            Statement::Assignment { target, equals, value } => {
                self.node("Assignment");
                self.path(target);
                self.token(equals);
                self.value(value);
            }
            Statement::TypeDeclaration { keyword, name, colon, base_name, fields, equals, alias } => {
                self.node("TypeDeclaration");
                self.token(keyword);
                self.token(name);
                self.optional(colon);
                self.optional(base_name);
                if let Some(fields) = fields {
                    self.field_list(fields);
                }
                self.optional(equals);
                if let Some(alias) = alias {
                    self.type_syntax(alias);
                }
            }
            Statement::EnumDeclaration { keyword, name, colon, backing, open, members, close } => {
                self.node("EnumDeclaration");
                self.token(keyword);
                self.token(name);
                self.optional(colon);
                if let Some(backing) = backing {
                    self.node("EnumBacking");
                    self.token(&backing.type_name);
                    self.optional(&backing.open);
                    self.optional(&backing.size);
                    self.optional(&backing.close);
                    self.end();
                }
                self.token(open);
                self.separated(members, |dumper, member| {
                    dumper.node("EnumMemberDeclaration");
                    dumper.token(&member.name);
                    dumper.optional(&member.equals);
                    if let Some(value) = &member.value {
                        dumper.value(value);
                    }
                    dumper.end();
                });
                self.token(close);
            }
            Statement::TextTable { token } => {
                self.node("TextTable");
                self.token(token);
            }
            Statement::Declaration { kind, name, parameters, colon, result, body } => {
                self.node("Declaration");
                self.token(kind);
                self.token(name);
                if let Some(list) = parameters {
                    self.node("ParameterList");
                    self.token(&list.open);
                    self.separated(&list.parameters, |dumper, parameter| {
                        dumper.node("Parameter");
                        dumper.token(&parameter.name);
                        dumper.token(&parameter.colon);
                        dumper.type_syntax(&parameter.parameter_type);
                        dumper.end();
                    });
                    self.token(&list.close);
                    self.end();
                }
                self.optional(colon);
                if let Some(result) = result {
                    self.type_syntax(result);
                }
                self.body(body);
            }
            Statement::Extension { keyword, type_name, members } => {
                self.node("ExtensionDeclaration");
                self.token(keyword);
                self.token(type_name);
                self.field_list(members);
            }
            Statement::ReferenceAssignment { at, target, equals, value } => {
                self.node("ReferenceAssignment");
                self.token(at);
                self.path(target);
                self.token(equals);
                self.value(value);
            }
        }
        self.end();
    }

    fn field_list(&mut self, list: &FieldList) {
        self.node("FieldList");
        self.token(&list.open);
        self.separated(&list.fields, |dumper, item| match item {
            FieldListItem::Declaration { name, colon, field_type, equals, default } => {
                dumper.node("FieldDeclaration");
                dumper.token(name);
                dumper.token(colon);
                dumper.type_syntax(field_type);
                dumper.optional(equals);
                if let Some(default) = default {
                    dumper.value(default);
                }
                dumper.end();
            }
            FieldListItem::Fixed { name, equals, value } => {
                dumper.node("FixedField");
                dumper.token(name);
                dumper.token(equals);
                dumper.value(value);
                dumper.end();
            }
        });
        self.token(&list.close);
        self.end();
    }

    fn path(&mut self, path: &Path) {
        self.node("Path");
        self.separated(&path.segments, |dumper, segment| dumper.named_token("Name", segment));
        self.end();
    }

    // ── values ──────────────────────────────────────────────────────────────────────────────────

    fn value(&mut self, value: &Value) {
        match value {
            Value::Literal { kind, token } => {
                self.node(&format!("Literal {}", kind.name()));
                self.token(token);
            }
            Value::EnumMember { enum_name, dot, member } => {
                self.node("EnumMember");
                self.optional(enum_name);
                self.optional(dot);
                self.token(member);
            }
            Value::Record { type_name, open, fields, close } => {
                self.node("Record");
                self.token(type_name);
                self.token(open);
                self.separated(fields, |dumper, field| {
                    dumper.node("FieldValue");
                    dumper.token(&field.name);
                    dumper.token(&field.equals);
                    dumper.value(&field.value);
                    dumper.end();
                });
                self.token(close);
            }
            Value::OpenInstance { type_name } => {
                self.node("OpenInstance");
                self.token(type_name);
            }
            Value::Construction { type_name, open, arguments, close } => {
                self.node("Construction");
                self.token(type_name);
                self.token(open);
                self.separated(arguments, |dumper, argument| {
                    dumper.node("ValueArgument");
                    dumper.optional(&argument.name);
                    dumper.optional(&argument.colon);
                    dumper.value(&argument.value);
                    dumper.end();
                });
                self.token(close);
            }
            Value::List { open, items, close } => {
                self.node("List");
                self.token(open);
                self.separated(items, |dumper, item| dumper.value(item));
                self.token(close);
            }
            Value::Map { open, entries, close } => {
                self.node("Map");
                self.token(open);
                self.separated(entries, |dumper, entry| {
                    dumper.node("MapEntry");
                    dumper.token(&entry.key);
                    dumper.token(&entry.equals);
                    dumper.value(&entry.value);
                    dumper.end();
                });
                self.token(close);
            }
            Value::Reference { at, path } => {
                self.node("Reference");
                self.token(at);
                self.path(path);
            }
            Value::Nameof { keyword, open, path, close } => {
                self.node("Nameof");
                self.token(keyword);
                self.token(open);
                self.path(path);
                self.token(close);
            }
            Value::Missing { missing } => {
                self.node("MissingValue");
                self.token(missing);
            }
            Value::InlineStatement { statement } => {
                self.node("InlineStatement");
                self.body_statement(statement);
            }
        }
        self.end();
    }

    // ── types ───────────────────────────────────────────────────────────────────────────────────

    fn type_syntax(&mut self, value: &Type) {
        match value {
            Type::Named { name } => {
                self.node("NamedType");
                self.token(name);
            }
            Type::TypeOfType { keyword, record } => {
                self.node("TypeOfType");
                self.token(keyword);
                self.named_token("NamedType", record);
            }
            Type::Optional { inner, question } => {
                self.node("OptionalType");
                self.type_syntax(inner);
                self.token(question);
            }
            Type::Union { alternatives } => {
                self.node("UnionType");
                self.separated(alternatives, |dumper, alternative| dumper.type_syntax(alternative));
            }
            Type::List { open, element, close } => {
                self.node("ListType");
                self.token(open);
                self.type_syntax(element);
                self.token(close);
            }
            Type::Map { open, key, colon, value, close } => {
                self.node("MapType");
                self.token(open);
                self.type_syntax(key);
                self.token(colon);
                self.type_syntax(value);
                self.token(close);
            }
            Type::Tuple { open, items, close } => {
                self.node("TupleType");
                self.token(open);
                self.separated(items, |dumper, item| dumper.type_syntax(item));
                self.token(close);
            }
            Type::Missing { missing } => {
                self.node("MissingType");
                self.token(missing);
            }
        }
        self.end();
    }

    // ── the program layer ───────────────────────────────────────────────────────────────────────

    fn body(&mut self, body: &Body) {
        match body {
            Body::Block(block) => self.block(block),
            Body::Expression { equals, expression } => {
                self.node("ExpressionBody");
                self.token(equals);
                self.expression(expression);
                self.end();
            }
        }
    }

    fn block(&mut self, block: &Block) {
        self.node("Block");
        self.token(&block.open);
        for statement in &block.statements {
            self.body_statement(statement);
        }
        self.token(&block.close);
        self.end();
    }

    fn body_statement(&mut self, statement: &BodyStatement) {
        match statement {
            BodyStatement::Binding { name, equals, value } => {
                self.node("Binding");
                self.token(name);
                self.token(equals);
                self.expression(value);
            }
            BodyStatement::Expression(expression) => {
                self.node("ExpressionStatement");
                self.expression(expression);
            }
            BodyStatement::CompoundCall { call, operator, delta } => {
                self.node("CompoundCall");
                self.expression(call);
                self.token(operator);
                self.expression(delta);
            }
            BodyStatement::If { if_keyword, condition, then, else_keyword, otherwise } => {
                self.node("IfStatement");
                self.token(if_keyword);
                self.expression(condition);
                self.block(then);
                self.optional(else_keyword);
                if let Some(otherwise) = otherwise {
                    self.block(otherwise);
                }
            }
            BodyStatement::Section { label, items } => {
                self.node("Section");
                self.token(label);
                self.separated(items, |dumper, item| dumper.expression(item));
            }
        }
        self.end();
    }

    fn expression(&mut self, expression: &Expression) {
        match expression {
            Expression::Literal { kind, token } => {
                self.node(&format!("LiteralExpression {}", kind.name()));
                self.token(token);
            }
            Expression::Name { identifier } => {
                self.node("NameExpression");
                self.token(identifier);
            }
            Expression::Reference { at, path } => {
                self.node("ReferenceExpression");
                self.token(at);
                self.path(path);
            }
            Expression::MemberAccess { receiver, dot, name } => {
                self.node("MemberAccess");
                self.expression(receiver);
                self.token(dot);
                self.token(name);
            }
            Expression::Call { callee, open, arguments, close } => {
                self.node("Call");
                self.expression(callee);
                self.token(open);
                self.separated(arguments, |dumper, argument| {
                    dumper.node("Argument");
                    dumper.optional(&argument.name);
                    dumper.optional(&argument.colon);
                    dumper.expression(&argument.value);
                    dumper.end();
                });
                self.token(close);
            }
            Expression::Unary { operator, operand } => {
                self.node("UnaryExpression");
                self.token(operator);
                self.expression(operand);
            }
            Expression::Signed { sign, operand } => {
                self.node("SignedExpression");
                self.token(sign);
                self.expression(operand);
            }
            Expression::Binary { left, operator, right } => {
                self.node("BinaryExpression");
                self.expression(left);
                self.token(operator);
                self.expression(right);
            }
            Expression::Parenthesized { open, inner, close } => {
                self.node("ParenthesizedExpression");
                self.token(open);
                self.expression(inner);
                self.token(close);
            }
            Expression::Missing { missing } => {
                self.node("MissingExpression");
                self.token(missing);
            }
        }
        self.end();
    }
}
