//! A node's tokens, in source order: what the writer writes and what a node's span is computed from.

use super::syntax::*;

pub fn of_document<'t>(document: &'t Document, tokens: &mut Vec<&'t Token>) {
    for statement in &document.statements {
        of_statement(statement, tokens);
    }
    tokens.push(&document.end_of_file);
}

pub fn of_statement<'t>(statement: &'t Statement, tokens: &mut Vec<&'t Token>) {
    match statement {
        Statement::Directive { directive, arguments } => {
            tokens.push(directive);
            for argument in arguments {
                tokens.push(argument);
            }
        }
        Statement::Assignment { target, equals, value } => {
            of_path(target, tokens);
            tokens.push(equals);
            of_value(value, tokens);
        }
        Statement::TypeDeclaration { keyword, name, colon, base_name, fields, equals, alias } => {
            tokens.push(keyword);
            tokens.push(name);
            push_optional(colon, tokens);
            push_optional(base_name, tokens);
            if let Some(fields) = fields {
                of_field_list(fields, tokens);
            }
            push_optional(equals, tokens);
            if let Some(alias) = alias {
                of_type(alias, tokens);
            }
        }
        Statement::EnumDeclaration { keyword, name, colon, backing, open, members, close } => {
            tokens.push(keyword);
            tokens.push(name);
            push_optional(colon, tokens);
            if let Some(backing) = backing {
                tokens.push(&backing.type_name);
                push_optional(&backing.open, tokens);
                push_optional(&backing.size, tokens);
                push_optional(&backing.close, tokens);
            }
            tokens.push(open);
            of_separated(members, tokens, |member, tokens| {
                tokens.push(&member.name);
                push_optional(&member.equals, tokens);
                if let Some(value) = &member.value {
                    of_value(value, tokens);
                }
            });
            tokens.push(close);
        }
        Statement::TextTable { token } => tokens.push(token),
        Statement::Declaration { kind, name, parameters, colon, result, body } => {
            tokens.push(kind);
            tokens.push(name);
            if let Some(list) = parameters {
                tokens.push(&list.open);
                of_separated(&list.parameters, tokens, |parameter, tokens| {
                    tokens.push(&parameter.name);
                    tokens.push(&parameter.colon);
                    of_type(&parameter.parameter_type, tokens);
                });
                tokens.push(&list.close);
            }
            if let Some(colon) = colon {
                tokens.push(colon);
            }
            if let Some(result) = result {
                of_type(result, tokens);
            }
            of_body(body, tokens);
        }
        Statement::Extension { keyword, type_name, members } => {
            tokens.push(keyword);
            tokens.push(type_name);
            of_field_list(members, tokens);
        }
        Statement::ReferenceAssignment { at, target, equals, value } => {
            tokens.push(at);
            of_path(target, tokens);
            tokens.push(equals);
            of_value(value, tokens);
        }
    }
}

pub fn of_field_list<'t>(list: &'t FieldList, tokens: &mut Vec<&'t Token>) {
    tokens.push(&list.open);
    of_separated(&list.fields, tokens, of_field_list_item);
    tokens.push(&list.close);
}

pub fn of_field_list_item<'t>(item: &'t FieldListItem, tokens: &mut Vec<&'t Token>) {
    match item {
        FieldListItem::Declaration { name, colon, field_type, equals, default } => {
            tokens.push(name);
            tokens.push(colon);
            of_type(field_type, tokens);
            push_optional(equals, tokens);
            if let Some(default) = default {
                of_value(default, tokens);
            }
        }
        FieldListItem::Fixed { name, equals, value } => {
            tokens.push(name);
            tokens.push(equals);
            of_value(value, tokens);
        }
    }
}

pub fn of_path<'t>(path: &'t Path, tokens: &mut Vec<&'t Token>) {
    of_separated(&path.segments, tokens, |segment, tokens| tokens.push(segment));
}

pub fn of_value<'t>(value: &'t Value, tokens: &mut Vec<&'t Token>) {
    match value {
        Value::Literal { token, .. } => tokens.push(token),
        Value::EnumMember { enum_name, dot, member } => {
            push_optional(enum_name, tokens);
            push_optional(dot, tokens);
            tokens.push(member);
        }
        Value::Record { type_name, open, fields, close } => {
            tokens.push(type_name);
            tokens.push(open);
            of_separated(fields, tokens, |field, tokens| {
                tokens.push(&field.name);
                tokens.push(&field.equals);
                of_value(&field.value, tokens);
            });
            tokens.push(close);
        }
        Value::OpenInstance { type_name } => tokens.push(type_name),
        Value::Construction { type_name, open, arguments, close } => {
            tokens.push(type_name);
            tokens.push(open);
            of_separated(arguments, tokens, |argument, tokens| {
                push_optional(&argument.name, tokens);
                push_optional(&argument.colon, tokens);
                of_value(&argument.value, tokens);
            });
            tokens.push(close);
        }
        Value::List { open, items, close } => {
            tokens.push(open);
            of_separated(items, tokens, of_value);
            tokens.push(close);
        }
        Value::Map { open, entries, close } => {
            tokens.push(open);
            of_separated(entries, tokens, |entry, tokens| {
                tokens.push(&entry.key);
                tokens.push(&entry.equals);
                of_value(&entry.value, tokens);
            });
            tokens.push(close);
        }
        Value::Reference { at, path } => {
            tokens.push(at);
            of_path(path, tokens);
        }
        Value::Nameof { keyword, open, path, close } => {
            tokens.push(keyword);
            tokens.push(open);
            of_path(path, tokens);
            tokens.push(close);
        }
        Value::Missing { missing } => tokens.push(missing),
        Value::InlineStatement { statement } => of_body_statement(statement, tokens),
        Value::Formula { expression } => of_expression(expression, tokens),
    }
}

pub fn of_type<'t>(value: &'t Type, tokens: &mut Vec<&'t Token>) {
    match value {
        Type::Named { name } => tokens.push(name),
        Type::TypeOfType { keyword, record } => {
            tokens.push(keyword);
            tokens.push(record);
        }
        Type::Optional { inner, question } => {
            of_type(inner, tokens);
            tokens.push(question);
        }
        Type::Union { alternatives } => of_separated(alternatives, tokens, of_type),
        Type::List { open, element, close } => {
            tokens.push(open);
            of_type(element, tokens);
            tokens.push(close);
        }
        Type::Map { open, key, colon, value, close } => {
            tokens.push(open);
            of_type(key, tokens);
            tokens.push(colon);
            of_type(value, tokens);
            tokens.push(close);
        }
        Type::Tuple { open, items, close } => {
            tokens.push(open);
            of_separated(items, tokens, of_type);
            tokens.push(close);
        }
        Type::Missing { missing } => tokens.push(missing),
    }
}

pub fn of_body<'t>(body: &'t Body, tokens: &mut Vec<&'t Token>) {
    match body {
        Body::Block(block) => of_block(block, tokens),
        Body::Expression { equals, expression } => {
            tokens.push(equals);
            of_expression(expression, tokens);
        }
    }
}

pub fn of_block<'t>(block: &'t Block, tokens: &mut Vec<&'t Token>) {
    tokens.push(&block.open);
    for statement in &block.statements {
        of_body_statement(statement, tokens);
    }
    tokens.push(&block.close);
}

pub fn of_body_statement<'t>(statement: &'t BodyStatement, tokens: &mut Vec<&'t Token>) {
    match statement {
        BodyStatement::Binding { name, equals, value } => {
            tokens.push(name);
            tokens.push(equals);
            of_expression(value, tokens);
        }
        BodyStatement::Expression(expression) => of_expression(expression, tokens),
        BodyStatement::CompoundCall { call, operator, delta } => {
            of_expression(call, tokens);
            tokens.push(operator);
            of_expression(delta, tokens);
        }
        BodyStatement::If { if_keyword, condition, then, else_keyword, otherwise } => {
            tokens.push(if_keyword);
            of_expression(condition, tokens);
            of_block(then, tokens);
            push_optional(else_keyword, tokens);
            if let Some(otherwise) = otherwise {
                of_block(otherwise, tokens);
            }
        }
        BodyStatement::Section { label, items } => {
            tokens.push(label);
            of_separated(items, tokens, of_expression);
        }
    }
}

pub fn of_expression<'t>(expression: &'t Expression, tokens: &mut Vec<&'t Token>) {
    match expression {
        Expression::Literal { token, .. } => tokens.push(token),
        Expression::Name { identifier } => tokens.push(identifier),
        Expression::Reference { at, path } => {
            tokens.push(at);
            of_path(path, tokens);
        }
        Expression::MemberAccess { receiver, dot, name } => {
            of_expression(receiver, tokens);
            tokens.push(dot);
            tokens.push(name);
        }
        Expression::Call { callee, open, arguments, close } => {
            of_expression(callee, tokens);
            tokens.push(open);
            of_separated(arguments, tokens, |argument, tokens| {
                push_optional(&argument.name, tokens);
                push_optional(&argument.colon, tokens);
                of_expression(&argument.value, tokens);
            });
            tokens.push(close);
        }
        Expression::Unary { operator, operand } => {
            tokens.push(operator);
            of_expression(operand, tokens);
        }
        Expression::Signed { sign, operand } => {
            tokens.push(sign);
            of_expression(operand, tokens);
        }
        Expression::Binary { left, operator, right } => {
            of_expression(left, tokens);
            tokens.push(operator);
            of_expression(right, tokens);
        }
        Expression::Parenthesized { open, inner, close } => {
            tokens.push(open);
            of_expression(inner, tokens);
            tokens.push(close);
        }
        Expression::Missing { missing } => tokens.push(missing),
        Expression::Conditional { if_keyword, condition, then_keyword, then, else_keyword, otherwise } => {
            tokens.push(if_keyword);
            of_expression(condition, tokens);
            tokens.push(then_keyword);
            of_expression(then, tokens);
            tokens.push(else_keyword);
            of_expression(otherwise, tokens);
        }
    }
}

fn of_separated<'t, T>(list: &'t Separated<T>, tokens: &mut Vec<&'t Token>, of_item: impl Fn(&'t T, &mut Vec<&'t Token>)) {
    for element in &list.elements {
        match element {
            Element::Item(item) => of_item(item, tokens),
            Element::Separator(separator) => tokens.push(separator),
        }
    }
}

fn push_optional<'t>(token: &'t Option<Token>, tokens: &mut Vec<&'t Token>) {
    if let Some(token) = token {
        tokens.push(token);
    }
}

/// From the first written token to the end of the last, without trivia: how `SyntaxNode.Span` is computed.
pub fn span(tokens: &[&Token]) -> TextSpan {
    let mut start: i64 = -1;
    let mut end: i64 = -1;
    for token in tokens {
        let token_start = token.span.start as i64;
        if start < 0 || token_start < start {
            start = token_start;
        }
        if !token.is_missing && token.span.end() as i64 > end {
            end = token.span.end() as i64;
        }
    }

    if start < 0 {
        return TextSpan::default();
    }
    TextSpan::from_bounds(start as usize, start.max(end) as usize)
}

pub fn path_span(path: &Path) -> TextSpan {
    let mut tokens: Vec<&Token> = Vec::new();
    of_path(path, &mut tokens);
    span(&tokens)
}
