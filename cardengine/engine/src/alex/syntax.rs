//! The concrete syntax tree: every token the author wrote, in order, with its trivia, so a tree writes back out
//! byte for byte. A port of `ViaMochi.Alex.Syntax` (mochi.agents/alex); the names follow it.

/// A range of the source, in bytes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TextSpan {
    pub start: u32,
    pub length: u32,
}

impl TextSpan {
    pub fn new(start: usize, length: usize) -> TextSpan {
        TextSpan { start: start as u32, length: length as u32 }
    }

    pub fn from_bounds(start: usize, end: usize) -> TextSpan {
        TextSpan::new(start, end - start)
    }

    pub fn end(&self) -> usize {
        (self.start + self.length) as usize
    }

    pub fn range(&self) -> std::ops::Range<usize> {
        self.start as usize..self.end()
    }
}

/// Something the parser found wrong. Parsing never stops at one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagnostic {
    pub message: String,
    pub span: TextSpan,
}

/// What a token is.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TokenKind {
    #[default]
    EndOfFile,
    BadToken,
    Identifier,
    Number,
    String,
    TextTable,
    Directive,
    Equals,
    Comma,
    Colon,
    Dot,
    Pipe,
    Question,
    At,
    OpenBrace,
    CloseBrace,
    OpenBracket,
    CloseBracket,
    OpenParen,
    CloseParen,
    EqualsEquals,
    BangEquals,
    Less,
    LessEquals,
    Greater,
    GreaterEquals,
    PlusEquals,
    MinusEquals,
    Plus,
}

impl TokenKind {
    pub fn name(self) -> &'static str {
        match self {
            TokenKind::EndOfFile => "EndOfFile",
            TokenKind::BadToken => "BadToken",
            TokenKind::Identifier => "Identifier",
            TokenKind::Number => "Number",
            TokenKind::String => "String",
            TokenKind::TextTable => "TextTable",
            TokenKind::Directive => "Directive",
            TokenKind::Equals => "Equals",
            TokenKind::Comma => "Comma",
            TokenKind::Colon => "Colon",
            TokenKind::Dot => "Dot",
            TokenKind::Pipe => "Pipe",
            TokenKind::Question => "Question",
            TokenKind::At => "At",
            TokenKind::OpenBrace => "OpenBrace",
            TokenKind::CloseBrace => "CloseBrace",
            TokenKind::OpenBracket => "OpenBracket",
            TokenKind::CloseBracket => "CloseBracket",
            TokenKind::OpenParen => "OpenParen",
            TokenKind::CloseParen => "CloseParen",
            TokenKind::EqualsEquals => "EqualsEquals",
            TokenKind::BangEquals => "BangEquals",
            TokenKind::Less => "Less",
            TokenKind::LessEquals => "LessEquals",
            TokenKind::Greater => "Greater",
            TokenKind::GreaterEquals => "GreaterEquals",
            TokenKind::PlusEquals => "PlusEquals",
            TokenKind::MinusEquals => "MinusEquals",
            TokenKind::Plus => "Plus",
        }
    }
}

/// What a piece of trivia is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TriviaKind {
    Whitespace,
    EndOfLine,
    Comment,
    ByteOrderMark,
    /// Tokens the parser could not place, kept so the file still round-trips.
    SkippedTokens,
}

impl TriviaKind {
    pub fn name(self) -> &'static str {
        match self {
            TriviaKind::Whitespace => "Whitespace",
            TriviaKind::EndOfLine => "EndOfLine",
            TriviaKind::Comment => "Comment",
            TriviaKind::ByteOrderMark => "ByteOrderMark",
            TriviaKind::SkippedTokens => "SkippedTokens",
        }
    }
}

/// Whitespace, a line break, a comment, or skipped tokens: bytes that belong to a token but are not it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Trivia {
    pub kind: TriviaKind,
    pub span: TextSpan,
}

/// One token, with the trivia before and after it. Its text is the source under its span; a missing token has none.
#[derive(Clone, Debug, Default)]
pub struct Token {
    pub kind: TokenKind,
    pub span: TextSpan,
    pub leading: Vec<Trivia>,
    pub trailing: Vec<Trivia>,
    /// Whether a line break separates this token from the one before it, or it is the first.
    pub starts_line: bool,
    /// A token the parser expected and did not find. A diagnostic says so.
    pub is_missing: bool,
}

impl Token {
    pub fn text<'a>(&self, source: &'a [u8]) -> &'a [u8] {
        &source[self.span.range()]
    }

    pub fn is(&self, source: &[u8], word: &[u8]) -> bool {
        self.text(source) == word
    }

    /// Whether this identifier names a type: it starts with a capital letter.
    pub fn is_type_name(&self, source: &[u8]) -> bool {
        self.kind == TokenKind::Identifier && self.span.length > 0 && source[self.span.start as usize].is_ascii_uppercase()
    }

    /// Whether there is no trivia between this token and `next`.
    pub fn touches_next(&self, next: &Token) -> bool {
        self.trailing.is_empty() && next.leading.is_empty()
    }
}

/// Items with the separator tokens between them, in the order they were written.
#[derive(Clone, Debug)]
pub struct Separated<T> {
    pub elements: Vec<Element<T>>,
}

#[derive(Clone, Debug)]
pub enum Element<T> {
    Item(T),
    Separator(Token),
}

impl<T> Separated<T> {
    pub fn empty() -> Separated<T> {
        Separated { elements: Vec::new() }
    }

    pub fn count(&self) -> usize {
        let mut count = 0;
        for element in &self.elements {
            if let Element::Item(_) = element {
                count += 1;
            }
        }
        count
    }
}

// ── statements ──────────────────────────────────────────────────────────────────────────────────

/// The whole file: its top-level statements and the end-of-file token that carries the final trivia.
#[derive(Clone, Debug)]
pub struct Document {
    pub statements: Vec<Statement>,
    pub end_of_file: Token,
}

#[derive(Clone, Debug)]
pub enum Statement {
    /// `#type Game`: the name and its `#` are one token; the arguments are every token after it on the line.
    Directive { directive: Token, arguments: Vec<Token> },
    /// `path = value`.
    Assignment { target: Path, equals: Token, value: Value },
    /// `type Name { fields }`, `type Name : Base { fields }`, or `type Name = A | B`.
    TypeDeclaration {
        keyword: Token,
        name: Token,
        colon: Option<Token>,
        base_name: Option<Token>,
        fields: Option<FieldList>,
        equals: Option<Token>,
        alias: Option<Type>,
    },
    /// `enum Name { member, member }`, or a backed enum: `enum Count : int { one = 1 }`.
    EnumDeclaration {
        keyword: Token,
        name: Token,
        colon: Option<Token>,
        backing: Option<EnumBacking>,
        open: Token,
        members: Separated<EnumMember>,
        close: Token,
    },
    /// `@@@ name`, the lines below it verbatim, and the `@@@` that closes it: one token.
    TextTable { token: Token },
    /// `routine zing { ... }`, `routine zest-on : bool = ...`, `effect zing { ... }` or `scenario 'Title' { ... }`. Only a
    /// routine may have parameters and a result type.
    Declaration { kind: Token, name: Token, parameters: Option<ParameterList>, colon: Option<Token>, result: Option<Type>, body: Body },
    /// `extension UnitCard { on-enter: effect? }`.
    Extension { keyword: Token, type_name: Token, members: FieldList },
    /// `@citron-fox.on-enter = zing`.
    ReferenceAssignment { at: Token, target: Path, equals: Token, value: Value },
}

/// `(n: int, from: player)`: a routine's parameters.
#[derive(Clone, Debug)]
pub struct ParameterList {
    pub open: Token,
    pub parameters: Separated<Parameter>,
    pub close: Token,
}

/// `n: int`.
#[derive(Clone, Debug)]
pub struct Parameter {
    pub name: Token,
    pub colon: Token,
    pub parameter_type: Type,
}

/// What backs an enum's members: `int`, or `text(3)` with the most characters a value may have.
#[derive(Clone, Debug)]
pub struct EnumBacking {
    pub type_name: Token,
    pub open: Option<Token>,
    pub size: Option<Token>,
    pub close: Option<Token>,
}

/// One member of an enum declaration, with its value in a backed enum: `two = 2`.
#[derive(Clone, Debug)]
pub struct EnumMember {
    pub name: Token,
    pub equals: Option<Token>,
    pub value: Option<Value>,
}

/// The braces of a record type or an extension.
#[derive(Clone, Debug)]
pub struct FieldList {
    pub open: Token,
    pub fields: Separated<FieldListItem>,
    pub close: Token,
}

#[derive(Clone, Debug)]
pub enum FieldListItem {
    /// `name: Type` or `name: Type = default`.
    Declaration { name: Token, colon: Token, field_type: Type, equals: Option<Token>, default: Option<Value> },
    /// `name = value`: fixes an inherited field.
    Fixed { name: Token, equals: Token, value: Value },
}

/// A dotted name: `zones.Deck`. Items are the name tokens.
#[derive(Clone, Debug)]
pub struct Path {
    pub segments: Separated<Token>,
}

// ── values ──────────────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LiteralKind {
    Nic,
    Empty,
    True,
    False,
    Integer,
    Float,
    String,
}

impl LiteralKind {
    pub fn name(self) -> &'static str {
        match self {
            LiteralKind::Nic => "Nic",
            LiteralKind::Empty => "Empty",
            LiteralKind::True => "True",
            LiteralKind::False => "False",
            LiteralKind::Integer => "Integer",
            LiteralKind::Float => "Float",
            LiteralKind::String => "String",
        }
    }
}

#[derive(Clone, Debug)]
pub enum Value {
    Literal { kind: LiteralKind, token: Token },
    /// `random`, or `Initiative.random`.
    EnumMember { enum_name: Option<Token>, dot: Option<Token>, member: Token },
    /// `Type { field = value, … }`: a closed instance.
    Record { type_name: Token, open: Token, fields: Separated<FieldValue>, close: Token },
    /// A type name alone: an open instance.
    OpenInstance { type_name: Token },
    /// `Type(value, name: value)`: a closed instance written as a constructor call. Unnamed arguments fill the type's
    /// fields in the order it declares them; named ones follow.
    Construction { type_name: Token, open: Token, arguments: Separated<ValueArgument>, close: Token },
    List { open: Token, items: Separated<Value>, close: Token },
    Map { open: Token, entries: Separated<MapEntry>, close: Token },
    Reference { at: Token, path: Path },
    Nameof { keyword: Token, open: Token, path: Path, close: Token },
    Missing { missing: Token },
    /// One body statement as the value of `@card.slot = `: `@klobuk.on-enter = draw()`. It is bound as a declaration of
    /// the slot's kind, with no name, whose body is this statement.
    InlineStatement { statement: Box<BodyStatement> },
}

/// One argument of a construction: `value`, or `name: value`.
#[derive(Clone, Debug)]
pub struct ValueArgument {
    pub name: Option<Token>,
    pub colon: Option<Token>,
    pub value: Value,
}

#[derive(Clone, Debug)]
pub struct FieldValue {
    pub name: Token,
    pub equals: Token,
    pub value: Value,
}

#[derive(Clone, Debug)]
pub struct MapEntry {
    pub key: Token,
    pub equals: Token,
    pub value: Value,
}

// ── types ───────────────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub enum Type {
    Named { name: Token },
    /// `type UnitCard`.
    TypeOfType { keyword: Token, record: Token },
    Optional { inner: Box<Type>, question: Token },
    Union { alternatives: Separated<Type> },
    List { open: Token, element: Box<Type>, close: Token },
    Map { open: Token, key: Box<Type>, colon: Token, value: Box<Type>, close: Token },
    Tuple { open: Token, items: Separated<Type>, close: Token },
    Missing { missing: Token },
}

// ── the program layer ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
pub enum Body {
    Block(Block),
    /// `= expression`.
    Expression { equals: Token, expression: Expression },
}

#[derive(Clone, Debug)]
pub struct Block {
    pub open: Token,
    pub statements: Vec<BodyStatement>,
    pub close: Token,
}

#[derive(Clone, Debug)]
pub enum BodyStatement {
    Binding { name: Token, equals: Token, value: Expression },
    Expression(Expression),
    /// `x.counter(@Crumb) += 1`.
    CompoundCall { call: Expression, operator: Token, delta: Expression },
    If { if_keyword: Token, condition: Expression, then: Block, else_keyword: Option<Token>, otherwise: Option<Block> },
    /// `given a, b`.
    Section { label: Token, items: Separated<Expression> },
}

#[derive(Clone, Debug)]
pub enum Expression {
    Literal { kind: LiteralKind, token: Token },
    Name { identifier: Token },
    Reference { at: Token, path: Path },
    MemberAccess { receiver: Box<Expression>, dot: Token, name: Token },
    Call { callee: Box<Expression>, open: Token, arguments: Separated<Argument>, close: Token },
    Unary { operator: Token, operand: Box<Expression> },
    Signed { sign: Token, operand: Box<Expression> },
    Binary { left: Box<Expression>, operator: Token, right: Box<Expression> },
    Parenthesized { open: Token, inner: Box<Expression>, close: Token },
    Missing { missing: Token },
}

#[derive(Clone, Debug)]
pub struct Argument {
    pub name: Option<Token>,
    pub colon: Option<Token>,
    pub value: Expression,
}

/// A parsed file: its tree and what the parser found wrong with it. The source is the caller's.
pub struct SyntaxTree {
    pub root: Document,
    pub diagnostics: Vec<Diagnostic>,
}

// ── text tables ─────────────────────────────────────────────────────────────────────────────────

/// The pieces of a text-table token, found in the token's own bytes. Offsets are from the token's start.
#[derive(Debug, Default)]
pub struct TextTableParts {
    pub name_offsets: Vec<(usize, usize)>,
    pub marker_length: usize,
    pub is_bare: bool,
    pub from_root: bool,
    pub invalid_name: bool,
    pub body_offset: usize,
    pub body_length: usize,
    pub closing_offset: Option<usize>,
}

impl TextTableParts {
    pub fn read(text: &[u8]) -> TextTableParts {
        let mut parts = TextTableParts::default();
        let line_end = index_of(text, b'\n');
        let mut marker_end = match line_end {
            Some(end) => end,
            None => text.len(),
        };
        if marker_end > 0 && text[marker_end - 1] == b'\r' {
            marker_end -= 1;
        }
        parts.marker_length = marker_end;

        let mut position = 3;
        let name_start = position;
        while position < marker_end && (text[position] == b' ' || text[position] == b'\t') {
            position += 1;
        }
        if position == marker_end {
            parts.is_bare = true;
        } else if position == name_start {
            parts.invalid_name = true;
        } else {
            if text[position] == b'.' {
                parts.from_root = true;
                position += 1;
            }
            read_table_name(text, position, marker_end, &mut parts);
        }

        let body_start = match line_end {
            Some(end) => end + 1,
            None => text.len(),
        };
        let mut body_end = text.len();

        // A closing bare marker is the token's last line: the body ends where that line starts.
        let last_line_start = match last_index_of(text, b'\n') {
            Some(index) => index + 1,
            None => 0,
        };
        if last_line_start >= body_start && last_line_start > 0 && text[last_line_start..].starts_with(b"@@@") {
            parts.closing_offset = Some(last_line_start);
            body_end = last_line_start;
        }

        parts.body_offset = body_start;
        parts.body_length = body_end.saturating_sub(body_start);
        parts
    }
}

fn read_table_name(text: &[u8], mut position: usize, end: usize, parts: &mut TextTableParts) {
    loop {
        let start = position;
        if !super::identifiers::try_read(text, &mut position, end) {
            parts.invalid_name = true;
            return;
        }
        parts.name_offsets.push((start, position - start));
        if position < end && text[position] == b'.' {
            position += 1;
            continue;
        }
        break;
    }

    while position < end && (text[position] == b' ' || text[position] == b'\t') {
        position += 1;
    }
    if position != end {
        parts.invalid_name = true;
    }
}

fn index_of(text: &[u8], value: u8) -> Option<usize> {
    for (index, byte) in text.iter().enumerate() {
        if *byte == value {
            return Some(index);
        }
    }
    None
}

fn last_index_of(text: &[u8], value: u8) -> Option<usize> {
    let mut index = text.len();
    while index > 0 {
        index -= 1;
        if text[index] == value {
            return Some(index);
        }
    }
    None
}
