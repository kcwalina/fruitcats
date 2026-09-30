//! Parses Alex source from UTF-8 bytes into a concrete syntax tree. A port of `AlexParser` (mochi.agents/alex): the
//! same grammar, the same recovery and the same diagnostics, word for word, so both implementations accept and reject
//! exactly the same files.
//!
//! Syntax only: whether names mean anything is the binder's question. Never fails on bad input: a problem becomes a
//! diagnostic and parsing goes on, and tokens that fit nowhere are kept as skipped trivia, so even a broken file
//! writes back out unchanged.

use super::identifiers;
use super::lexer;
use super::syntax::*;
use super::tokens;

/// Whether a document may hold the program layer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParseMode {
    /// Everything parses; nothing is refused.
    Program,
    /// Everything still parses, but each program-layer construct is reported as not allowed in a data document.
    Data,
}

pub fn parse(source: &[u8], mode: ParseMode) -> SyntaxTree {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let token_list = lexer::lex(source, &mut diagnostics);
    let mut parser = Parser {
        source,
        tokens: token_list,
        diagnostics: &mut diagnostics,
        skipped: Vec::new(),
        mode,
        index: 0,
        parenthesis_depth: 0,
        seen_statement: false,
        seen_type_directive: false,
    };
    let root = parser.parse_document();
    // Stable, by where each diagnostic starts.
    diagnostics.sort_by(|left, right| left.span.start.cmp(&right.span.start));
    SyntaxTree { root, diagnostics }
}

struct Parser<'a> {
    source: &'a [u8],
    tokens: Vec<Token>,
    diagnostics: &'a mut Vec<Diagnostic>,
    skipped: Vec<Trivia>,
    mode: ParseMode,
    index: usize,
    // Inside parentheses a line break is only whitespace, so a call may wrap; everywhere else in a body it ends the
    // statement.
    parenthesis_depth: usize,
    // For the rule that directives come first: whether a statement other than a directive, and whether a '#type', has
    // been parsed so far.
    seen_statement: bool,
    seen_type_directive: bool,
}

impl<'a> Parser<'a> {
    // ── the token stream ────────────────────────────────────────────────────────────────────────

    fn current(&self) -> &Token {
        &self.tokens[self.index]
    }

    fn peek(&self, offset: usize) -> &Token {
        let last = self.tokens.len() - 1;
        let index = if self.index + offset < last { self.index + offset } else { last };
        &self.tokens[index]
    }

    fn kind(&self) -> TokenKind {
        self.current().kind
    }

    fn at_end(&self) -> bool {
        self.kind() == TokenKind::EndOfFile
    }

    fn starts_line(&self) -> bool {
        self.current().starts_line
    }

    fn current_is(&self, word: &[u8]) -> bool {
        self.current().is(self.source, word)
    }

    fn current_is_type_name(&self) -> bool {
        self.current().is_type_name(self.source)
    }

    fn text_of(&self, token: &Token) -> String {
        String::from_utf8_lossy(token.text(self.source)).into_owned()
    }

    fn path_text(&self, path: &Path) -> String {
        let mut text = String::new();
        let mut first = true;
        for element in &path.segments.elements {
            if let Element::Item(segment) = element {
                if !first {
                    text.push('.');
                }
                text.push_str(&self.text_of(segment));
                first = false;
            }
        }
        text
    }

    // ── document ────────────────────────────────────────────────────────────────────────────────

    fn parse_document(&mut self) -> Document {
        let mut statements: Vec<Statement> = Vec::new();
        while !self.at_end() {
            if !statements.is_empty() && !self.starts_line() {
                self.error(
                    self.current().span,
                    "Expected the end of the line. A statement ends at the end of its line; put the next one on a line of its own.",
                );
                self.skip_rest_of_line();
                continue;
            }

            let before = self.index;
            if let Some(statement) = self.parse_top_statement() {
                match &statement {
                    Statement::Directive { directive, .. } => {
                        if directive.is(self.source, b"#type") {
                            self.seen_type_directive = true;
                        }
                    }
                    _ => self.seen_statement = true,
                }
                statements.push(statement);
            }
            if self.index == before {
                self.skip();
            }
        }

        let end_of_file = self.take();
        Document { statements, end_of_file }
    }

    fn parse_top_statement(&mut self) -> Option<Statement> {
        match self.kind() {
            TokenKind::TextTable => Some(self.parse_text_table()),
            TokenKind::Directive => Some(self.parse_directive()),
            TokenKind::Identifier => {
                if self.current_is(b"type") && self.is_declaration_name(self.peek(1)) {
                    return Some(self.parse_type_declaration());
                }
                if self.current_is(b"enum") && self.is_declaration_name(self.peek(1)) {
                    return Some(self.parse_enum_declaration());
                }
                if self.current_is(b"extension") && self.is_declaration_name(self.peek(1)) {
                    return Some(self.parse_extension());
                }
                if self.is_body_declaration_start() {
                    return Some(self.parse_declaration());
                }
                Some(self.parse_assignment())
            }
            TokenKind::At => Some(self.parse_reference_assignment()),
            _ => {
                self.error(
                    self.current().span,
                    "Expected a statement: 'name = value', a 'type' or 'enum' declaration, a '#type' directive, or a \
text table starting '@@@ name' at the start of a line.",
                );
                self.skip_rest_of_line();
                None
            }
        }
    }

    fn is_declaration_name(&self, token: &Token) -> bool {
        token.is_type_name(self.source) && !token.starts_line
    }

    /// Whether the statement is a declaration with a body: a lower name followed on the same line by a lower name or
    /// a string (`effect zing`, `scenario 'Title'`).
    fn is_body_declaration_start(&self) -> bool {
        if self.current_is_type_name() {
            return false;
        }
        let next = self.peek(1);
        if next.starts_line {
            return false;
        }
        next.kind == TokenKind::String || (next.kind == TokenKind::Identifier && !next.is_type_name(self.source))
    }

    /// Reports a program-layer construct in a data document. The construct is still parsed whole.
    fn refuse_in_data_mode(&mut self, span: TextSpan, what: &str) {
        if self.mode != ParseMode::Data {
            return;
        }
        self.error(
            span,
            &format!(
                "{} is not allowed in a data document. Declarations, extensions and assignments through references \
belong to a program document.",
                what
            ),
        );
    }

    /// `#name arguments`, which declares something about the whole file. Directives stand at the top of the file,
    /// before any statement, and the only one there is is `#type TypeName`.
    fn parse_directive(&mut self) -> Statement {
        let name = self.take();
        let mut arguments: Vec<Token> = Vec::new();
        while !self.at_end() && !self.starts_line() {
            arguments.push(self.take());
        }

        let is_type = name.is(self.source, b"#type");
        let after_statement = self.seen_statement;
        let type_again = is_type && self.seen_type_directive;

        if !is_type {
            let message = format!("'{}' is not a directive. The directives are: #type.", self.text_of(&name));
            self.error(name.span, &message);
        } else if arguments.is_empty() {
            self.error(name.span, "'#type' names the type of the file's value: '#type Game'.");
        } else if !(arguments.len() == 1 && arguments[0].is_type_name(self.source)) {
            let span = TextSpan::from_bounds(arguments[0].span.start as usize, arguments[arguments.len() - 1].span.end());
            let message = if arguments.len() == 1 {
                format!(
                    "'#type' names a type, and a type's name starts with a capital letter; '{}' does not.",
                    self.text_of(&arguments[0])
                )
            } else {
                "'#type' names one type and nothing else: '#type Game'.".to_string()
            };
            self.error(span, &message);
        }

        if after_statement {
            self.error(name.span, "A directive declares something about the whole file, so it comes before every statement.");
        } else if type_again {
            self.error(name.span, "The file's type is already declared by a '#type' above; a file has one type.");
        }

        Statement::Directive { directive: name, arguments }
    }

    fn parse_text_table(&mut self) -> Statement {
        let token = self.take();
        let parts = TextTableParts::read(token.text(self.source));
        let marker_span = TextSpan::new(token.span.start as usize, parts.marker_length);
        if parts.is_bare {
            self.error(marker_span, "A bare '@@@' closes a text table, but none is open here.");
        } else if parts.invalid_name {
            self.error(marker_span, "A text table starts '@@@ name', '@@@ path.to.field' or '@@@ .field', with nothing after the name.");
        }
        Statement::TextTable { token }
    }

    fn parse_assignment(&mut self) -> Statement {
        let target = self.parse_path("a name");
        let message = format!("Expected '=' after '{}'.", self.path_text(&target));
        let equals = self.expect(TokenKind::Equals, &message);

        let value = if self.looks_like_next_statement() {
            self.missing_value("A value is missing after '='.")
        } else if self.current_is_type_name()
            && self.peek(1).kind != TokenKind::OpenBrace
            && self.peek(1).kind != TokenKind::Dot
        {
            Value::OpenInstance { type_name: self.take() }
        } else {
            self.parse_value()
        };

        Statement::Assignment { target, equals, value }
    }

    /// Whether the token after an `=` begins the next statement rather than this one's value: a value may start on
    /// the next line, but a line that reads `name = …` is a statement of its own.
    fn looks_like_next_statement(&self) -> bool {
        if self.at_end() || self.kind() == TokenKind::TextTable || self.kind() == TokenKind::Directive {
            return true;
        }
        if !self.starts_line() {
            return false;
        }
        if self.kind() == TokenKind::At {
            return self.is_reference_assignment_start();
        }
        if self.kind() != TokenKind::Identifier {
            return false;
        }
        let next = self.peek(1);
        next.kind == TokenKind::Equals
            || (next.kind == TokenKind::Dot && !self.current_is_type_name())
            || self.is_body_declaration_start()
    }

    /// Whether the tokens from here read `@a.b = `: an assignment through a reference, not a value.
    fn is_reference_assignment_start(&self) -> bool {
        if self.kind() != TokenKind::At || self.peek(1).kind != TokenKind::Identifier {
            return false;
        }
        let mut offset = 2;
        while self.peek(offset).kind == TokenKind::Dot && self.peek(offset + 1).kind == TokenKind::Identifier {
            offset += 2;
        }
        offset > 2 && self.peek(offset).kind == TokenKind::Equals
    }

    // ── declarations ────────────────────────────────────────────────────────────────────────────

    fn parse_type_declaration(&mut self) -> Statement {
        let keyword = self.take();
        let name = self.take();

        if self.kind() == TokenKind::Colon {
            // A base type, or 'data' asserting the type is data; the binder says which lowercase names mean anything.
            let colon = self.take();
            let base_name = if self.kind() == TokenKind::Identifier && !self.starts_line() {
                self.take()
            } else {
                self.missing_token(TokenKind::Identifier, "Expected the base type's name, or 'data', after ':'.")
            };
            let fields = self.parse_field_list(&name);
            return Statement::TypeDeclaration {
                keyword,
                name,
                colon: Some(colon),
                base_name: Some(base_name),
                fields: Some(fields),
                equals: None,
                alias: None,
            };
        }

        if self.kind() == TokenKind::OpenBrace {
            let fields = self.parse_field_list(&name);
            return Statement::TypeDeclaration {
                keyword,
                name,
                colon: None,
                base_name: None,
                fields: Some(fields),
                equals: None,
                alias: None,
            };
        }

        if self.kind() == TokenKind::Equals {
            let equals = self.take();
            let alias = self.parse_type_expression();
            return Statement::TypeDeclaration {
                keyword,
                name,
                colon: None,
                base_name: None,
                fields: None,
                equals: Some(equals),
                alias: Some(alias),
            };
        }

        let message = format!(
            "Expected '{{' and fields, ': Base {{', or '= A | B' after 'type {}'.",
            self.text_of(&name)
        );
        self.error(self.current().span, &message);
        let fields = FieldList {
            open: self.missing(TokenKind::OpenBrace),
            fields: Separated::empty(),
            close: self.missing(TokenKind::CloseBrace),
        };
        Statement::TypeDeclaration {
            keyword,
            name,
            colon: None,
            base_name: None,
            fields: Some(fields),
            equals: None,
            alias: None,
        }
    }

    fn parse_field_list(&mut self, owner: &Token) -> FieldList {
        let message = format!("Expected '{{' and the fields of '{}'.", self.text_of(owner));
        let open = self.expect(TokenKind::OpenBrace, &message);
        if open.is_missing {
            let close = self.missing(TokenKind::CloseBrace);
            return FieldList { open, fields: Separated::empty(), close };
        }

        let fields = self.parse_separated(TokenKind::CloseBrace, Parser::parse_field_item);
        let close = self.expect_close(TokenKind::CloseBrace, &open, "'{'", "'}'");
        FieldList { open, fields, close }
    }

    fn parse_field_item(&mut self) -> Option<FieldListItem> {
        if self.kind() != TokenKind::Identifier {
            self.error(self.current().span, "Expected a field declaration: 'name: Type' or 'name: Type = default'.");
            return None;
        }

        let name = self.take();
        if name.is_type_name(self.source) {
            let message = format!(
                "A field name starts with a lowercase letter; '{}' reads as a type.",
                self.text_of(&name)
            );
            self.error(name.span, &message);
        }

        if self.kind() == TokenKind::Equals {
            // 'unique = true': fixes an inherited field. Whether it inherits one is the binder's to say.
            let equals = self.take();
            let value = self.parse_value();
            return Some(FieldListItem::Fixed { name, equals, value });
        }

        let message = format!(
            "Expected ':' and the type of '{}', or '=' and the value that fixes an inherited field.",
            self.text_of(&name)
        );
        let colon = self.expect(TokenKind::Colon, &message);
        let field_type = if colon.is_missing && self.kind() != TokenKind::Identifier && self.kind() != TokenKind::OpenBracket {
            Type::Missing { missing: self.missing(TokenKind::Identifier) }
        } else {
            self.parse_type_expression()
        };

        if self.kind() == TokenKind::Equals && !self.starts_line() {
            let equals = self.take();
            let default = self.parse_value();
            return Some(FieldListItem::Declaration { name, colon, field_type, equals: Some(equals), default: Some(default) });
        }

        Some(FieldListItem::Declaration { name, colon, field_type, equals: None, default: None })
    }

    fn parse_enum_declaration(&mut self) -> Statement {
        let keyword = self.take();
        let name = self.take();
        let mut colon = None;
        let mut backing = None;
        if self.kind() == TokenKind::Colon {
            colon = Some(self.take());
            backing = Some(self.parse_enum_backing());
        }

        let message = format!("Expected '{{' and the members of '{}'.", self.text_of(&name));
        let open = self.expect(TokenKind::OpenBrace, &message);
        if open.is_missing {
            let close = self.missing(TokenKind::CloseBrace);
            return Statement::EnumDeclaration { keyword, name, colon, backing, open, members: Separated::empty(), close };
        }

        let members = self.parse_separated(TokenKind::CloseBrace, Parser::parse_enum_member);
        let close = self.expect_close(TokenKind::CloseBrace, &open, "'{'", "'}'");
        Statement::EnumDeclaration { keyword, name, colon, backing, open, members, close }
    }

    /// `int` or `text(3)` after an enum's name. Which names mean anything is the binder's to say.
    fn parse_enum_backing(&mut self) -> EnumBacking {
        let type_name = if self.kind() == TokenKind::Identifier && !self.starts_line() {
            self.take()
        } else {
            self.missing_token(TokenKind::Identifier, "Expected what backs the enum's members after ':': 'int' or 'text(n)'.")
        };
        if type_name.is_missing || self.kind() != TokenKind::OpenParen {
            return EnumBacking { type_name, open: None, size: None, close: None };
        }

        let open = self.take();
        let size = self.expect(TokenKind::Number, "Expected the most characters a value may have, such as 'text(3)'.");
        let close = self.expect_close(TokenKind::CloseParen, &open, "'('", "')'");
        EnumBacking { type_name, open: Some(open), size: Some(size), close: Some(close) }
    }

    fn parse_enum_member(&mut self) -> Option<EnumMember> {
        if self.kind() != TokenKind::Identifier {
            self.error(self.current().span, "Expected an enum member: a lowercase name.");
            return None;
        }

        let member = self.take();
        if member.is_type_name(self.source) {
            let message = format!(
                "An enum member starts with a lowercase letter; '{}' reads as a type.",
                self.text_of(&member)
            );
            self.error(member.span, &message);
        } else if identifiers::is_value_keyword(member.text(self.source)) {
            let message = format!("'{}' is a keyword and cannot be an enum member.", self.text_of(&member));
            self.error(member.span, &message);
        }
        if self.kind() != TokenKind::Equals {
            return Some(EnumMember { name: member, equals: None, value: None });
        }
        let equals = self.take();
        let value = self.parse_value();
        Some(EnumMember { name: member, equals: Some(equals), value: Some(value) })
    }

    // ── the program layer ───────────────────────────────────────────────────────────────────────

    fn parse_extension(&mut self) -> Statement {
        let keyword = self.take();
        let type_name = self.take();
        self.refuse_in_data_mode(
            TextSpan::from_bounds(keyword.span.start as usize, type_name.span.end()),
            "An extension",
        );
        let members = self.parse_field_list(&type_name);
        Statement::Extension { keyword, type_name, members }
    }

    fn parse_reference_assignment(&mut self) -> Statement {
        let at = self.take();
        let target: Path;
        if self.kind() != TokenKind::Identifier || !at.touches_next(self.current()) {
            self.error(at.span, "Expected a name right after '@': '@object.member = value'.");
            target = self.missing_path(None);
        } else {
            target = self.parse_path("a name");
            if target.segments.count() < 2 {
                let message = format!(
                    "An assignment through a reference sets a member of what it names: '@{}.member = value'.",
                    self.path_text(&target)
                );
                self.error(tokens::path_span(&target), &message);
            }
        }

        let target_end = tokens::path_span(&target).end();
        let end = if at.span.end() > target_end { at.span.end() } else { target_end };
        self.refuse_in_data_mode(TextSpan::from_bounds(at.span.start as usize, end), "An assignment through a reference");
        let message = format!("Expected '=' after '@{}'.", self.path_text(&target));
        let equals = self.expect(TokenKind::Equals, &message);
        let value = if self.looks_like_next_statement() {
            self.missing_value("A value is missing after '='.")
        } else if self.is_inline_statement_start() {
            // None only after a stray 'else', which is reported and skipped.
            match self.parse_body_statement() {
                Some(statement) => Value::InlineStatement { statement: Box::new(statement) },
                None => Value::Missing { missing: self.missing(TokenKind::Identifier) },
            }
        } else {
            self.parse_value()
        };
        Statement::ReferenceAssignment { at, target, equals, value }
    }

    /// Whether the value of `@card.slot = ` is one body statement (`draw()`) rather than a declaration's name: a name or
    /// `@name` alone on the rest of the line names one, and anything else that starts with a name, an `@` or a
    /// parenthesis is a statement. A scenario section (`given ...`) is not one: it would read on across the lines below.
    fn is_inline_statement_start(&self) -> bool {
        if self.kind() == TokenKind::OpenParen {
            return true;
        }
        if self.is_section_start() {
            return false;
        }
        let mut offset;
        if self.kind() == TokenKind::Identifier && !self.current_is_type_name() {
            offset = 1;
        } else if self.kind() == TokenKind::At && self.peek(1).kind == TokenKind::Identifier {
            offset = 2;
            while self.peek(offset).kind == TokenKind::Dot && self.peek(offset + 1).kind == TokenKind::Identifier {
                offset += 2;
            }
        } else {
            return false;
        }
        let next = self.peek(offset);
        next.kind != TokenKind::EndOfFile && !next.starts_line
    }

    fn parse_declaration(&mut self) -> Statement {
        let kind = self.take();
        let name = self.take();
        if self.mode == ParseMode::Data {
            let message = format!(
                "'{} {}' starts a declaration, which is not allowed in a data document. A data statement is \
'name = value'; declarations belong to a program document.",
                self.text_of(&kind),
                self.text_of(&name)
            );
            self.error(TextSpan::from_bounds(kind.span.start as usize, name.span.end()), &message);
        }

        let body = if self.kind() == TokenKind::OpenBrace {
            Body::Block(self.parse_block())
        } else if self.kind() == TokenKind::Equals && !self.starts_line() {
            let equals = self.take();
            let expression = self.parse_expression();
            Body::Expression { equals, expression }
        } else {
            let message = format!(
                "Expected '{{' and a body, or '=' and an expression, after '{} {}'.",
                self.text_of(&kind),
                self.text_of(&name)
            );
            Body::Block(self.missing_block(&message))
        };

        Statement::Declaration { kind, name, body }
    }

    fn parse_block(&mut self) -> Block {
        let open = self.take();
        let outer_depth = self.parenthesis_depth;
        self.parenthesis_depth = 0;
        let mut statements: Vec<BodyStatement> = Vec::new();
        let mut first = true;
        while self.kind() != TokenKind::CloseBrace && !self.at_end() && self.kind() != TokenKind::TextTable {
            if !first && !self.starts_line() {
                self.error(
                    self.current().span,
                    "Expected the end of the line. A statement in a body ends at the end of its line; put the next one \
on a line of its own.",
                );
                self.skip_rest_of_body_line();
                continue;
            }

            let before = self.index;
            if let Some(statement) = self.parse_body_statement() {
                statements.push(statement);
            }
            if self.index == before {
                self.skip();
            }
            first = false;
        }

        self.parenthesis_depth = outer_depth;
        let close = self.expect_close(TokenKind::CloseBrace, &open, "'{'", "'}'");
        Block { open, statements, close }
    }

    fn missing_block(&mut self, message: &str) -> Block {
        let open = self.missing_token(TokenKind::OpenBrace, message);
        let close = self.missing(TokenKind::CloseBrace);
        Block { open, statements: Vec::new(), close }
    }

    fn parse_body_statement(&mut self) -> Option<BodyStatement> {
        if self.kind() == TokenKind::Identifier && !self.current_is_type_name() {
            if self.current_is(b"if") {
                return Some(self.parse_if());
            }
            if self.current_is(b"else") {
                self.error(self.current().span, "'else' follows the '}' of an 'if'.");
                self.skip_rest_of_body_line();
                return None;
            }
            if self.is_section_start() {
                return Some(self.parse_section());
            }
            if self.peek(1).kind == TokenKind::Equals && !self.peek(1).starts_line {
                let name = self.take();
                let equals = self.take();
                let value = self.parse_expression();
                return Some(BodyStatement::Binding { name, equals, value });
            }
        }

        let expression = self.parse_expression();
        if (self.kind() == TokenKind::PlusEquals || self.kind() == TokenKind::MinusEquals) && !self.starts_line() {
            let operator = self.take();
            let delta = self.parse_expression();
            return Some(BodyStatement::CompoundCall { call: expression, operator, delta });
        }

        Some(BodyStatement::Expression(expression))
    }

    fn parse_if(&mut self) -> BodyStatement {
        let if_keyword = self.take();
        let condition = self.parse_expression();
        let then = if self.kind() == TokenKind::OpenBrace {
            self.parse_block()
        } else {
            self.missing_block("Expected '{' after the condition of 'if'.")
        };
        if self.kind() != TokenKind::Identifier || !self.current_is(b"else") {
            return BodyStatement::If { if_keyword, condition, then, else_keyword: None, otherwise: None };
        }

        let else_keyword = self.take();
        let otherwise = if self.kind() == TokenKind::OpenBrace {
            self.parse_block()
        } else if self.kind() == TokenKind::Identifier && self.current_is(b"if") && !self.starts_line() {
            // Kept whole, inside braces that were never written, so the file still writes back unchanged.
            self.error(self.current().span, "There is no 'else if'. Put the 'if' inside the 'else' block: 'else { if ... }'.");
            let nested = self.parse_if();
            let open = self.missing(TokenKind::OpenBrace);
            let close = self.missing(TokenKind::CloseBrace);
            Block { open, statements: vec![nested], close }
        } else {
            self.missing_block("Expected '{' after 'else'.")
        };

        BodyStatement::If { if_keyword, condition, then, else_keyword: Some(else_keyword), otherwise: Some(otherwise) }
    }

    /// Whether this line starts a scenario section: `given`, `when` or `then` and an item.
    fn is_section_start(&self) -> bool {
        if self.kind() != TokenKind::Identifier
            || !(self.current_is(b"given") || self.current_is(b"when") || self.current_is(b"then"))
        {
            return false;
        }
        let next = self.peek(1);
        !next.starts_line
            && (next.kind == TokenKind::Identifier
                || next.kind == TokenKind::At
                || next.kind == TokenKind::Number
                || next.kind == TokenKind::String)
    }

    fn parse_section(&mut self) -> BodyStatement {
        let label = self.take();
        let mut elements: Vec<Element<Expression>> = Vec::new();
        loop {
            let before = self.index;
            let item = self.parse_expression();
            elements.push(Element::Item(item));
            if self.kind() == TokenKind::Comma {
                elements.push(Element::Separator(self.take()));
                if self.kind() == TokenKind::CloseBrace {
                    break;
                }
                continue;
            }

            if self.kind() == TokenKind::CloseBrace || self.at_end() || self.kind() == TokenKind::TextTable {
                break;
            }
            if self.index == before {
                self.skip();
            }
            if self.starts_line() {
                if self.is_section_start() {
                    break;
                }
                continue;
            }

            let message = format!(
                "Expected ',' or a line break between the items of '{}'.",
                self.text_of(&label)
            );
            self.error(self.current().span, &message);
            self.skip_rest_of_body_line();
            if self.kind() == TokenKind::CloseBrace || self.at_end() || self.is_section_start() {
                break;
            }
        }

        BodyStatement::Section { label, items: Separated { elements } }
    }

    /// Skips to the end of the body line, keeping any brackets inside it balanced.
    fn skip_rest_of_body_line(&mut self) {
        let mut depth = 0;
        let mut first = true;
        while !self.at_end() && self.kind() != TokenKind::TextTable {
            let kind = self.kind();
            if depth == 0 && !first && (self.starts_line() || kind == TokenKind::CloseBrace) {
                return;
            }
            if kind == TokenKind::OpenBrace || kind == TokenKind::OpenBracket || kind == TokenKind::OpenParen {
                depth += 1;
            } else if kind == TokenKind::CloseBrace || kind == TokenKind::CloseBracket || kind == TokenKind::CloseParen {
                // A stray ')' or ']' that starts what is skipped is skipped too, or the block asks again forever.
                if depth == 0 && (!first || kind == TokenKind::CloseBrace) {
                    return;
                }
                if depth > 0 {
                    depth -= 1;
                }
            }

            self.skip();
            first = false;
        }
    }

    // ── expressions ─────────────────────────────────────────────────────────────────────────────

    /// Whether the expression may go on at the current token: on the same line, or anywhere inside parentheses.
    fn can_continue(&self) -> bool {
        self.parenthesis_depth > 0 || !self.starts_line()
    }

    fn at_word(&self, word: &[u8]) -> bool {
        self.kind() == TokenKind::Identifier && self.current_is(word) && self.can_continue()
    }

    fn parse_expression(&mut self) -> Expression {
        let mut left = self.parse_conjunction();
        while self.at_word(b"or") {
            let operator = self.take();
            let right = self.parse_conjunction();
            left = Expression::Binary { left: Box::new(left), operator, right: Box::new(right) };
        }
        left
    }

    fn parse_conjunction(&mut self) -> Expression {
        let mut left = self.parse_negation();
        while self.at_word(b"and") {
            let operator = self.take();
            let right = self.parse_negation();
            left = Expression::Binary { left: Box::new(left), operator, right: Box::new(right) };
        }
        left
    }

    fn parse_negation(&mut self) -> Expression {
        if self.kind() == TokenKind::Identifier && self.current_is(b"not") {
            let operator = self.take();
            let operand = self.parse_negation();
            return Expression::Unary { operator, operand: Box::new(operand) };
        }
        self.parse_comparison()
    }

    fn parse_comparison(&mut self) -> Expression {
        let left = self.parse_postfix();
        if !is_comparison(self.kind()) || !self.can_continue() {
            return left;
        }

        let operator = self.take();
        let right = self.parse_postfix();
        let mut result = Expression::Binary { left: Box::new(left), operator, right: Box::new(right) };
        while is_comparison(self.kind()) && self.can_continue() {
            self.error(self.current().span, "Comparisons do not chain. Write each one and join them: 'a < b and b < c'.");
            let extra = self.take();
            let right = self.parse_postfix();
            result = Expression::Binary { left: Box::new(result), operator: extra, right: Box::new(right) };
        }
        result
    }

    fn parse_postfix(&mut self) -> Expression {
        let mut expression = self.parse_primary();
        loop {
            if self.kind() == TokenKind::Dot && self.can_continue() {
                let dot = self.take();
                let name = if self.kind() == TokenKind::Identifier {
                    self.take()
                } else {
                    self.missing_token(TokenKind::Identifier, "Expected a name after '.'.")
                };
                expression = Expression::MemberAccess { receiver: Box::new(expression), dot, name };
                continue;
            }

            let callable = matches!(expression, Expression::Name { .. } | Expression::MemberAccess { .. });
            if self.kind() == TokenKind::OpenParen && self.can_continue() && callable {
                expression = self.parse_call(expression);
                continue;
            }

            return expression;
        }
    }

    fn parse_call(&mut self, callee: Expression) -> Expression {
        let open = self.take();
        self.parenthesis_depth += 1;
        let mut elements: Vec<Element<Argument>> = Vec::new();
        while self.kind() != TokenKind::CloseParen
            && self.kind() != TokenKind::CloseBrace
            && self.kind() != TokenKind::TextTable
            && !self.at_end()
        {
            let argument = self.parse_argument();
            elements.push(Element::Item(argument));
            if self.kind() == TokenKind::Comma {
                elements.push(Element::Separator(self.take()));
                continue;
            }

            if self.kind() != TokenKind::CloseParen {
                self.error(self.current().span, "Expected ',' or ')' after an argument.");
            }
            break;
        }

        self.parenthesis_depth -= 1;
        let close = self.expect_close(TokenKind::CloseParen, &open, "'('", "')'");
        Expression::Call { callee: Box::new(callee), open, arguments: Separated { elements }, close }
    }

    fn parse_argument(&mut self) -> Argument {
        if self.kind() == TokenKind::Identifier && !self.current_is_type_name() && self.peek(1).kind == TokenKind::Colon {
            let name = self.take();
            let colon = self.take();
            let value = self.parse_expression();
            return Argument { name: Some(name), colon: Some(colon), value };
        }
        let value = self.parse_expression();
        Argument { name: None, colon: None, value }
    }

    fn parse_primary(&mut self) -> Expression {
        match self.kind() {
            TokenKind::Number => {
                let kind = if self.is_float(self.current()) { LiteralKind::Float } else { LiteralKind::Integer };
                Expression::Literal { kind, token: self.take() }
            }
            TokenKind::String => Expression::Literal { kind: LiteralKind::String, token: self.take() },
            TokenKind::Plus => {
                let sign = self.take();
                let operand = self.parse_postfix();
                Expression::Signed { sign, operand: Box::new(operand) }
            }
            TokenKind::At => {
                let at = self.take();
                if self.kind() != TokenKind::Identifier || !at.touches_next(self.current()) {
                    self.error(at.span, "Expected a name right after '@', such as '@zest-on' or '@Crumb'.");
                    let path = self.missing_path(None);
                    return Expression::Reference { at, path };
                }
                let path = self.parse_path("a name");
                Expression::Reference { at, path }
            }
            TokenKind::OpenParen => {
                let open = self.take();
                self.parenthesis_depth += 1;
                let inner = self.parse_expression();
                self.parenthesis_depth -= 1;
                let close = self.expect_close(TokenKind::CloseParen, &open, "'('", "')'");
                Expression::Parenthesized { open, inner: Box::new(inner), close }
            }
            TokenKind::Identifier => {
                if self.current_is(b"true") {
                    return Expression::Literal { kind: LiteralKind::True, token: self.take() };
                }
                if self.current_is(b"false") {
                    return Expression::Literal { kind: LiteralKind::False, token: self.take() };
                }
                if self.current_is(b"and") || self.current_is(b"or") || self.current_is(b"if") || self.current_is(b"else") {
                    let message = format!(
                        "Expected an expression before '{}', which is a keyword in a body.",
                        self.text_of(self.current())
                    );
                    return Expression::Missing { missing: self.missing_token(TokenKind::Identifier, &message) };
                }
                Expression::Name { identifier: self.take() }
            }
            _ => Expression::Missing {
                missing: self.missing_token(
                    TokenKind::Identifier,
                    "Expected an expression: a name, '@name', a number, 'text', a call such as 'draw(1)', or '( ... )'.",
                ),
            },
        }
    }

    // ── types ───────────────────────────────────────────────────────────────────────────────────

    fn parse_type_expression(&mut self) -> Type {
        let first = self.parse_type_term();
        if self.kind() != TokenKind::Pipe {
            return first;
        }

        let mut elements: Vec<Element<Type>> = vec![Element::Item(first)];
        while self.kind() == TokenKind::Pipe {
            elements.push(Element::Separator(self.take()));
            let term = self.parse_type_term();
            elements.push(Element::Item(term));
        }
        Type::Union { alternatives: Separated { elements } }
    }

    fn parse_type_term(&mut self) -> Type {
        let primary = self.parse_type_primary();
        if self.kind() == TokenKind::Question && !self.starts_line() {
            let question = self.take();
            return Type::Optional { inner: Box::new(primary), question };
        }
        primary
    }

    fn parse_type_primary(&mut self) -> Type {
        match self.kind() {
            TokenKind::Identifier => {
                let next = self.peek(1);
                if self.current_is(b"type")
                    && next.kind == TokenKind::Identifier
                    && next.is_type_name(self.source)
                    && !next.starts_line
                {
                    // 'type UnitCard': a field whose value names a type declaration ('@Creature'), not a value.
                    let keyword = self.take();
                    let record = self.take();
                    return Type::TypeOfType { keyword, record };
                }
                Type::Named { name: self.take() }
            }
            TokenKind::OpenBracket => {
                let open = self.take();
                let first = self.parse_type_expression();
                if self.kind() == TokenKind::Colon {
                    let colon = self.take();
                    let value = self.parse_type_expression();
                    let close = self.expect_close(TokenKind::CloseBracket, &open, "'['", "']'");
                    return Type::Map { open, key: Box::new(first), colon, value: Box::new(value), close };
                }

                if self.kind() == TokenKind::Comma {
                    let mut items: Vec<Element<Type>> = vec![Element::Item(first)];
                    while self.kind() == TokenKind::Comma {
                        items.push(Element::Separator(self.take()));
                        let item = self.parse_type_expression();
                        items.push(Element::Item(item));
                    }
                    let close = self.expect_close(TokenKind::CloseBracket, &open, "'['", "']'");
                    return Type::Tuple { open, items: Separated { elements: items }, close };
                }

                let close = self.expect_close(TokenKind::CloseBracket, &open, "'['", "']'");
                Type::List { open, element: Box::new(first), close }
            }
            TokenKind::OpenParen => {
                self.error(
                    self.current().span,
                    "A type is never parenthesised. Spell a union out, with nic as one of its alternatives when it may \
be nothing: 'A | B | nic'.",
                );
                self.skip();
                let inner = self.parse_type_expression();
                if self.kind() == TokenKind::CloseParen {
                    self.skip();
                }
                inner
            }
            _ => {
                self.error(self.current().span, "Expected a type: a name such as 'text' or 'Zone', '[T]', or '[K: V]'.");
                Type::Missing { missing: self.missing(TokenKind::Identifier) }
            }
        }
    }

    // ── values ──────────────────────────────────────────────────────────────────────────────────

    fn parse_value(&mut self) -> Value {
        match self.kind() {
            TokenKind::Number => {
                let kind = if self.is_float(self.current()) { LiteralKind::Float } else { LiteralKind::Integer };
                Value::Literal { kind, token: self.take() }
            }
            TokenKind::String => Value::Literal { kind: LiteralKind::String, token: self.take() },
            TokenKind::At => self.parse_reference(),
            TokenKind::OpenBracket => self.parse_collection(),
            TokenKind::OpenBrace => {
                self.error(self.current().span, "A record names its type before '{': write 'Type { field = value }'.");
                let type_name = self.missing(TokenKind::Identifier);
                self.parse_record(type_name)
            }
            TokenKind::Identifier => self.parse_word_value(),
            TokenKind::Plus => {
                self.error(
                    self.current().span,
                    "A '+' must start a number here ('+1'). There is no arithmetic in Alex; only a body may sign what \
it reads ('power: +card.bonus').",
                );
                self.skip();
                self.parse_value()
            }
            _ => self.missing_value(
                "Expected a value: a number, a 'string', nic, empty, true, false, an enum member, 'Type { ... }', \
'[...]', '@name' or 'nameof(name)'.",
            ),
        }
    }

    fn parse_word_value(&mut self) -> Value {
        if self.current_is(b"nic") {
            return Value::Literal { kind: LiteralKind::Nic, token: self.take() };
        }
        if self.current_is(b"empty") {
            return Value::Literal { kind: LiteralKind::Empty, token: self.take() };
        }
        if self.current_is(b"true") {
            return Value::Literal { kind: LiteralKind::True, token: self.take() };
        }
        if self.current_is(b"false") {
            return Value::Literal { kind: LiteralKind::False, token: self.take() };
        }
        if self.current_is(b"nameof") && self.peek(1).kind == TokenKind::OpenParen {
            return self.parse_nameof();
        }

        if self.current_is_type_name() {
            let next_kind = self.peek(1).kind;
            if next_kind == TokenKind::OpenBrace {
                let type_name = self.take();
                return self.parse_record(type_name);
            }
            if next_kind == TokenKind::Dot {
                let enum_name = self.take();
                let dot = self.take();
                let member = if self.kind() == TokenKind::Identifier && dot.touches_next(self.current()) {
                    self.take()
                } else {
                    let message = format!("Expected an enum member after '{}.'.", self.text_of(&enum_name));
                    self.missing_token(TokenKind::Identifier, &message)
                };
                return Value::EnumMember { enum_name: Some(enum_name), dot: Some(dot), member };
            }

            // A type name alone. As the whole right side of a statement it is an open instance; anywhere else it is
            // still syntax, and what it can mean there (nothing, usually) is the binder's to say.
            return Value::OpenInstance { type_name: self.take() };
        }

        Value::EnumMember { enum_name: None, dot: None, member: self.take() }
    }

    fn parse_record(&mut self, type_name: Token) -> Value {
        let open = self.take();
        let fields = self.parse_separated(TokenKind::CloseBrace, Parser::parse_field_value);
        let close = self.expect_close(TokenKind::CloseBrace, &open, "'{'", "'}'");
        Value::Record { type_name, open, fields, close }
    }

    fn parse_field_value(&mut self) -> Option<FieldValue> {
        if self.kind() != TokenKind::Identifier || self.peek(1).kind != TokenKind::Equals {
            self.error(self.current().span, "Expected a field: 'name = value'.");
            return None;
        }

        let name = self.take();
        if name.is_type_name(self.source) {
            let message = format!(
                "A field name starts with a lowercase letter; '{}' reads as a type.",
                self.text_of(&name)
            );
            self.error(name.span, &message);
        }

        let equals = self.take();
        let value = self.parse_value();
        Some(FieldValue { name, equals, value })
    }

    fn parse_collection(&mut self) -> Value {
        let open = self.take();
        if self.kind() == TokenKind::CloseBracket {
            let close = self.take();
            return Value::List { open, items: Separated::empty(), close };
        }

        if self.is_map_entry_start() {
            let entries = self.parse_separated(TokenKind::CloseBracket, Parser::parse_map_entry);
            let close = self.expect_close(TokenKind::CloseBracket, &open, "'['", "']'");
            return Value::Map { open, entries, close };
        }

        let items = self.parse_separated(TokenKind::CloseBracket, Parser::parse_list_item);
        let close = self.expect_close(TokenKind::CloseBracket, &open, "'['", "']'");
        Value::List { open, items, close }
    }

    fn is_map_entry_start(&self) -> bool {
        self.kind() == TokenKind::Identifier && self.peek(1).kind == TokenKind::Equals
    }

    fn parse_map_entry(&mut self) -> Option<MapEntry> {
        if !self.is_map_entry_start() {
            self.error(
                self.current().span,
                "This is a map, so every entry is 'key = value'. A collection is a list or a map, never both.",
            );
            self.skip_item(TokenKind::CloseBracket);
            return None;
        }

        let key = self.take();
        let equals = self.take();
        let value = self.parse_value();
        Some(MapEntry { key, equals, value })
    }

    fn parse_list_item(&mut self) -> Option<Value> {
        if self.is_map_entry_start() {
            self.error(
                self.current().span,
                "This is a list, so an item cannot be 'key = value'. A collection is a list or a map, never both; its \
first item decides which.",
            );
            self.skip();
            self.skip();
        }
        Some(self.parse_value())
    }

    fn parse_reference(&mut self) -> Value {
        let at = self.take();
        if self.kind() != TokenKind::Identifier || !at.touches_next(self.current()) {
            self.error(at.span, "Expected a name right after '@', such as '@starter-box' or '@zones.Deck'.");
            let path = self.missing_path(None);
            return Value::Reference { at, path };
        }
        let path = self.parse_path("a name");
        Value::Reference { at, path }
    }

    fn parse_nameof(&mut self) -> Value {
        let keyword = self.take();
        let open = self.take();
        let path = if self.kind() == TokenKind::Identifier {
            self.parse_path("a name")
        } else {
            self.missing_path(Some("Expected a name inside nameof( )."))
        };
        let close = self.expect_close(TokenKind::CloseParen, &open, "'('", "')'");
        Value::Nameof { keyword, open, path, close }
    }

    fn parse_path(&mut self, what: &str) -> Path {
        let mut elements: Vec<Element<Token>> = Vec::new();
        let first = if self.kind() == TokenKind::Identifier {
            self.take()
        } else {
            let message = format!("Expected {}.", what);
            self.missing_token(TokenKind::Identifier, &message)
        };
        // Whether the last segment touches what follows it; kept rather than the token, which moves into the list.
        let mut previous_trailing_empty = first.trailing.is_empty();
        elements.push(Element::Item(first));

        while self.kind() == TokenKind::Dot && previous_trailing_empty && self.current().leading.is_empty() {
            let dot = self.take();
            let segment = if self.kind() == TokenKind::Identifier && dot.touches_next(self.current()) {
                self.take()
            } else {
                self.missing_token(TokenKind::Identifier, "Expected a name after '.'; a path has no spaces in it.")
            };
            elements.push(Element::Separator(dot));
            previous_trailing_empty = segment.trailing.is_empty();
            elements.push(Element::Item(segment));
        }

        Path { segments: Separated { elements } }
    }

    fn missing_path(&mut self, message: Option<&str>) -> Path {
        let missing = match message {
            Some(message) => self.missing_token(TokenKind::Identifier, message),
            None => self.missing(TokenKind::Identifier),
        };
        Path { segments: Separated { elements: vec![Element::Item(missing)] } }
    }

    // ── lists of items ──────────────────────────────────────────────────────────────────────────

    /// Items up to `closer`, separated by commas, line breaks, or both, with a trailing comma allowed.
    fn parse_separated<T>(&mut self, closer: TokenKind, parse_item: fn(&mut Parser<'a>) -> Option<T>) -> Separated<T> {
        let mut elements: Vec<Element<T>> = Vec::new();
        loop {
            if self.kind() == closer || self.at_end() || self.kind() == TokenKind::TextTable {
                break;
            }

            if self.kind() == TokenKind::Comma {
                self.error(self.current().span, "Expected an item before ','.");
                self.skip();
                continue;
            }

            let before = self.index;
            if let Some(item) = parse_item(self) {
                elements.push(Element::Item(item));
            }
            if self.index == before {
                self.skip();
                continue;
            }

            if self.kind() == closer || self.at_end() {
                break;
            }
            if self.kind() == TokenKind::Comma {
                elements.push(Element::Separator(self.take()));
                continue;
            }

            if self.starts_line() {
                continue;
            }
            self.error(self.current().span, "Expected ',' or a line break between items.");
        }

        Separated { elements }
    }

    // ── tokens ──────────────────────────────────────────────────────────────────────────────────

    /// Moves past the current token and returns it, with any skipped tokens in front of it as trivia. The last token
    /// (the end of the file) stays where it is.
    fn take(&mut self) -> Token {
        let last = self.tokens.len() - 1;
        let mut token = if self.index < last {
            let taken = std::mem::take(&mut self.tokens[self.index]);
            self.index += 1;
            taken
        } else {
            self.tokens[self.index].clone()
        };

        if !self.skipped.is_empty() {
            let mut leading: Vec<Trivia> = std::mem::take(&mut self.skipped);
            leading.extend_from_slice(&token.leading);
            token.leading = leading;
        }
        token
    }

    /// Moves past the current token, keeping its bytes as trivia on the next token taken.
    fn skip(&mut self) {
        if self.at_end() {
            return;
        }
        let token = std::mem::take(&mut self.tokens[self.index]);
        self.skipped.extend_from_slice(&token.leading);
        self.skipped.push(Trivia { kind: TriviaKind::SkippedTokens, span: token.span });
        self.skipped.extend_from_slice(&token.trailing);
        self.index += 1;
    }

    /// Skips one misplaced item, as trivia: everything up to the separator or closer that ends it, keeping any
    /// brackets inside it balanced.
    fn skip_item(&mut self, closer: TokenKind) {
        let mut depth = 0;
        let mut first = true;
        while !self.at_end() && self.kind() != TokenKind::TextTable {
            let kind = self.kind();
            if depth == 0 && !first && (kind == TokenKind::Comma || kind == closer || self.starts_line()) {
                return;
            }
            if kind == TokenKind::OpenBrace || kind == TokenKind::OpenBracket || kind == TokenKind::OpenParen {
                depth += 1;
            } else if kind == TokenKind::CloseBrace || kind == TokenKind::CloseBracket || kind == TokenKind::CloseParen {
                if depth == 0 {
                    return;
                }
                depth -= 1;
            }

            self.skip();
            first = false;
        }
    }

    fn skip_rest_of_line(&mut self) {
        self.skip();
        while !self.at_end() && !self.starts_line() {
            self.skip();
        }
    }

    fn expect(&mut self, kind: TokenKind, message: &str) -> Token {
        if self.kind() == kind {
            return self.take();
        }
        self.missing_token(kind, message)
    }

    fn expect_close(&mut self, kind: TokenKind, open: &Token, opener: &str, closer: &str) -> Token {
        if self.kind() == kind {
            return self.take();
        }
        if !open.is_missing {
            let message = format!("This {} has no matching {}.", opener, closer);
            self.error(open.span, &message);
        }
        self.missing(kind)
    }

    fn missing_token(&mut self, kind: TokenKind, message: &str) -> Token {
        let span = if self.at_end() { TextSpan::new(self.current().span.start as usize, 0) } else { self.current().span };
        self.error(span, message);
        self.missing(kind)
    }

    fn missing(&self, kind: TokenKind) -> Token {
        Token {
            kind,
            span: TextSpan::new(self.current().span.start as usize, 0),
            leading: Vec::new(),
            trailing: Vec::new(),
            starts_line: false,
            is_missing: true,
        }
    }

    fn missing_value(&mut self, message: &str) -> Value {
        Value::Missing { missing: self.missing_token(TokenKind::Identifier, message) }
    }

    fn error(&mut self, span: TextSpan, message: &str) {
        self.diagnostics.push(Diagnostic { message: message.to_string(), span });
    }

    fn is_float(&self, number: &Token) -> bool {
        for byte in number.text(self.source) {
            if *byte == b'.' || *byte == b'e' || *byte == b'E' {
                return true;
            }
        }
        false
    }
}

fn is_comparison(kind: TokenKind) -> bool {
    kind == TokenKind::EqualsEquals
        || kind == TokenKind::BangEquals
        || kind == TokenKind::Less
        || kind == TokenKind::LessEquals
        || kind == TokenKind::Greater
        || kind == TokenKind::GreaterEquals
}
