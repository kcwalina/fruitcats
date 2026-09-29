//! Splits Alex source into tokens, attaching every other byte to one of them as trivia.
//!
//! A text table is recognised here, not in the parser, because it is decided by where a line starts: a line that
//! begins with `@@@` at column zero opens one, and every following line up to the next such line is its text, taken
//! whole.

use super::identifiers;
use super::syntax::{Diagnostic, TextSpan, Token, TokenKind, Trivia, TriviaKind};

pub fn lex(source: &[u8], diagnostics: &mut Vec<Diagnostic>) -> Vec<Token> {
    let mut lexer = Lexer { source, position: 0, diagnostics };
    lexer.lex_all()
}

struct Lexer<'a> {
    source: &'a [u8],
    position: usize,
    diagnostics: &'a mut Vec<Diagnostic>,
}

impl<'a> Lexer<'a> {
    fn lex_all(&mut self) -> Vec<Token> {
        if std::str::from_utf8(self.source).is_err() {
            self.error("The source is not valid UTF-8.", TextSpan::new(0, self.source.len()));
        }

        let mut tokens: Vec<Token> = Vec::new();
        let mut leading: Vec<Trivia> = Vec::new();
        if self.source.starts_with(&[0xEF, 0xBB, 0xBF]) {
            leading.push(trivia(TriviaKind::ByteOrderMark, 0, 3));
            self.position = 3;
        }

        let content_start = self.position;
        loop {
            let leading_start = self.position;
            self.read_leading_trivia(&mut leading, content_start);
            let starts_line = tokens.is_empty()
                || contains_line_break(&leading)
                || self.is_line_start(leading_start, content_start);

            if self.position >= self.source.len() {
                tokens.push(Token {
                    kind: TokenKind::EndOfFile,
                    span: TextSpan::new(self.position, 0),
                    leading: std::mem::take(&mut leading),
                    trailing: Vec::new(),
                    starts_line,
                    is_missing: false,
                });
                return tokens;
            }

            let start = self.position;
            let kind = if self.is_line_start(self.position, content_start) && self.starts_with_marker(self.position) {
                self.lex_text_table()
            } else {
                self.lex_token()
            };

            let span = TextSpan::from_bounds(start, self.position);
            let mut trailing: Vec<Trivia> = Vec::new();
            if kind != TokenKind::TextTable || !self.is_line_start(self.position, content_start) {
                self.read_trailing_trivia(&mut trailing);
            }

            tokens.push(Token {
                kind,
                span,
                leading: std::mem::take(&mut leading),
                trailing,
                starts_line,
                is_missing: false,
            });
        }
    }

    // ── trivia ──────────────────────────────────────────────────────────────────────────────────

    fn read_leading_trivia(&mut self, trivia: &mut Vec<Trivia>, content_start: usize) {
        while self.position < self.source.len() {
            // A text table can only start at column zero, so the first thing on a line is checked before any
            // whitespace is taken as trivia: an indented '@@@' is not a marker.
            if self.is_line_start(self.position, content_start) && self.starts_with_marker(self.position) {
                return;
            }
            if !self.read_one_trivia(trivia) {
                return;
            }
        }
    }

    fn read_trailing_trivia(&mut self, trivia: &mut Vec<Trivia>) {
        while self.position < self.source.len() {
            if !self.read_one_trivia(trivia) {
                return;
            }
            if trivia[trivia.len() - 1].kind == TriviaKind::EndOfLine {
                return;
            }
        }
    }

    fn read_one_trivia(&mut self, trivia_list: &mut Vec<Trivia>) -> bool {
        let source = self.source;
        let start = self.position;
        let current = source[start];

        if current == b' ' || current == b'\t' {
            while self.position < source.len() && (source[self.position] == b' ' || source[self.position] == b'\t') {
                self.position += 1;
            }
            trivia_list.push(trivia(TriviaKind::Whitespace, start, self.position));
            return true;
        }

        if current == b'\n' {
            self.position += 1;
            trivia_list.push(trivia(TriviaKind::EndOfLine, start, self.position));
            return true;
        }

        if current == b'\r' {
            self.position += 1;
            if self.position < source.len() && source[self.position] == b'\n' {
                self.position += 1;
            } else {
                self.error("A carriage return must be followed by a line feed.", TextSpan::new(start, 1));
            }
            trivia_list.push(trivia(TriviaKind::EndOfLine, start, self.position));
            return true;
        }

        if current == b'/' && start + 1 < source.len() && source[start + 1] == b'/' {
            while self.position < source.len() && source[self.position] != b'\n' && source[self.position] != b'\r' {
                self.position += 1;
            }
            trivia_list.push(trivia(TriviaKind::Comment, start, self.position));
            return true;
        }

        false
    }

    // ── tokens ──────────────────────────────────────────────────────────────────────────────────

    fn lex_token(&mut self) -> TokenKind {
        let source = self.source;
        let start = self.position;
        let current = source[start];

        if identifiers::is_start(current) {
            identifiers::try_read(source, &mut self.position, source.len());
            return TokenKind::Identifier;
        }

        if current.is_ascii_digit()
            || ((current == b'-' || current == b'+') && start + 1 < source.len() && source[start + 1].is_ascii_digit())
        {
            self.lex_number();
            return TokenKind::Number;
        }

        if current == b'\'' {
            self.lex_string(start);
            return TokenKind::String;
        }

        // '#' with a word directly after it is a directive's name, one token so that '# type' (the retired hash
        // dialect's header) can never be read as one.
        if current == b'#' && start + 1 < source.len() && identifiers::is_start(source[start + 1]) {
            self.position += 1;
            identifiers::try_read(source, &mut self.position, source.len());
            return TokenKind::Directive;
        }

        let next = if start + 1 < source.len() { source[start + 1] } else { 0 };
        if next == b'=' {
            let pair = match current {
                b'=' => Some(TokenKind::EqualsEquals),
                b'!' => Some(TokenKind::BangEquals),
                b'<' => Some(TokenKind::LessEquals),
                b'>' => Some(TokenKind::GreaterEquals),
                b'+' => Some(TokenKind::PlusEquals),
                b'-' => Some(TokenKind::MinusEquals),
                _ => None,
            };
            if let Some(two_characters) = pair {
                self.position += 2;
                return two_characters;
            }
        }

        // '+card.bonus': a sign on a quantity a body reads. The parser allows it only there.
        if current == b'+' && (identifiers::is_start(next) || next == b'@' || next == b'(') {
            self.position += 1;
            return TokenKind::Plus;
        }

        self.position += 1;
        match current {
            b'<' => return TokenKind::Less,
            b'>' => return TokenKind::Greater,
            b'=' => return TokenKind::Equals,
            b',' => return TokenKind::Comma,
            b':' => return TokenKind::Colon,
            b'.' => return TokenKind::Dot,
            b'|' => return TokenKind::Pipe,
            b'?' => return TokenKind::Question,
            b'@' => return TokenKind::At,
            b'{' => return TokenKind::OpenBrace,
            b'}' => return TokenKind::CloseBrace,
            b'[' => return TokenKind::OpenBracket,
            b']' => return TokenKind::CloseBracket,
            b'(' => return TokenKind::OpenParen,
            b')' => return TokenKind::CloseParen,
            _ => {}
        }

        // Anything else is one character nobody can place: keep it whole (a multi-byte character stays one token)
        // so the diagnostic points at what the author sees.
        while self.position < source.len() && (source[self.position] & 0xC0) == 0x80 {
            self.position += 1;
        }
        let shown = String::from_utf8_lossy(&source[start..self.position]).into_owned();
        self.error(&describe(current, &shown), TextSpan::from_bounds(start, self.position));
        TokenKind::BadToken
    }

    fn lex_number(&mut self) {
        let source = self.source;
        if source[self.position] == b'-' || source[self.position] == b'+' {
            self.position += 1;
        }
        while self.position < source.len() && source[self.position].is_ascii_digit() {
            self.position += 1;
        }

        if self.position + 1 < source.len() && source[self.position] == b'.' && source[self.position + 1].is_ascii_digit() {
            self.position += 1;
            while self.position < source.len() && source[self.position].is_ascii_digit() {
                self.position += 1;
            }
        }

        if self.position < source.len() && (source[self.position] == b'e' || source[self.position] == b'E') {
            let mut exponent = self.position + 1;
            if exponent < source.len() && (source[exponent] == b'+' || source[exponent] == b'-') {
                exponent += 1;
            }
            if exponent < source.len() && source[exponent].is_ascii_digit() {
                self.position = exponent;
                while self.position < source.len() && source[self.position].is_ascii_digit() {
                    self.position += 1;
                }
            }
        }
    }

    fn lex_string(&mut self, start: usize) {
        let source = self.source;
        self.position += 1;
        while self.position < source.len() {
            let current = source[self.position];
            if current == b'\n' || current == b'\r' {
                break;
            }
            if current == b'\'' {
                if self.position + 1 < source.len() && source[self.position + 1] == b'\'' {
                    self.position += 2;
                    continue;
                }
                self.position += 1;
                return;
            }
            self.position += 1;
        }

        self.error(
            "This string is not closed before the end of its line. A string is on one line; write longer text as a text table.",
            TextSpan::from_bounds(start, self.position),
        );
    }

    /// Reads a text table from its marker line to the line before the next marker, taking a closing bare `@@@` with
    /// it when that is what ends the table.
    fn lex_text_table(&mut self) -> TokenKind {
        let bare = self.is_bare_marker_line(self.position);
        self.position = self.end_of_line(self.position);
        if bare {
            // A bare marker that closes nothing. The parser reports it; lexing it whole keeps it out of the syntax.
            return TokenKind::TextTable;
        }

        self.position = self.after_line_break(self.position);
        while self.position < self.source.len() {
            if self.starts_with_marker(self.position) {
                if self.is_bare_marker_line(self.position) {
                    // The closing marker, without its line break: that goes to the table's trailing trivia.
                    let line_end = self.end_of_line(self.position);
                    let mut marker_end = self.position + 3;
                    while marker_end < line_end && (self.source[marker_end] == b' ' || self.source[marker_end] == b'\t') {
                        marker_end += 1;
                    }
                    self.position = marker_end;
                }
                return TokenKind::TextTable;
            }
            self.position = self.after_line_break(self.end_of_line(self.position));
        }

        TokenKind::TextTable
    }

    fn starts_with_marker(&self, position: usize) -> bool {
        position + 2 < self.source.len()
            && self.source[position] == b'@'
            && self.source[position + 1] == b'@'
            && self.source[position + 2] == b'@'
    }

    fn is_bare_marker_line(&self, position: usize) -> bool {
        let end = self.end_of_line(position);
        let mut index = position + 3;
        while index < end {
            if self.source[index] != b' ' && self.source[index] != b'\t' {
                return false;
            }
            index += 1;
        }
        true
    }

    /// The position of the line break that ends the line holding `position`, or the end.
    fn end_of_line(&self, mut position: usize) -> usize {
        while position < self.source.len() && self.source[position] != b'\n' && self.source[position] != b'\r' {
            position += 1;
        }
        position
    }

    fn after_line_break(&self, mut position: usize) -> usize {
        if position < self.source.len() && self.source[position] == b'\r' {
            position += 1;
        }
        if position < self.source.len() && self.source[position] == b'\n' {
            position += 1;
        }
        position
    }

    fn is_line_start(&self, position: usize, content_start: usize) -> bool {
        position == content_start || (position > 0 && position <= self.source.len() && self.source[position - 1] == b'\n')
    }

    fn error(&mut self, message: &str, span: TextSpan) {
        self.diagnostics.push(Diagnostic { message: message.to_string(), span });
    }
}

fn describe(current: u8, shown: &str) -> String {
    match current {
        b'#' => "'#' starts a directive only with a word directly after it ('#type Game'). Headers are gone: set a \
field with 'name = value', and use '//' for a comment."
            .to_string(),
        b'"' => "Strings use single quotes: 'text'. A double quote is only ever part of a string.".to_string(),
        b'-' => "A '-' must start a number here. List items are written in brackets: [a, b].".to_string(),
        b'+' => "A '+' must start a number here ('+1'). There is no arithmetic in Alex; '+=' adds to a call.".to_string(),
        b'!' => "'!' is only part of '!='. Write 'not' to negate.".to_string(),
        _ => format!("'{}' is not part of Alex syntax.", shown),
    }
}

fn contains_line_break(trivia: &[Trivia]) -> bool {
    for item in trivia {
        if item.kind == TriviaKind::EndOfLine {
            return true;
        }
    }
    false
}

fn trivia(kind: TriviaKind, start: usize, end: usize) -> Trivia {
    Trivia { kind, span: TextSpan::from_bounds(start, end) }
}
