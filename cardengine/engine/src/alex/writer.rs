//! Writes a syntax tree back out as source: every token with its trivia, in order. For a parsed tree the output is
//! the input, byte for byte.

use super::syntax::{Document, Token, Trivia};
use super::tokens;

pub fn write(document: &Document, source: &[u8], output: &mut Vec<u8>) {
    let mut list: Vec<&Token> = Vec::new();
    tokens::of_document(document, &mut list);
    for token in list {
        write_trivia(&token.leading, source, output);
        output.extend_from_slice(token.text(source));
        write_trivia(&token.trailing, source, output);
    }
}

fn write_trivia(trivia: &[Trivia], source: &[u8], output: &mut Vec<u8>) {
    for item in trivia {
        output.extend_from_slice(&source[item.span.range()]);
    }
}
