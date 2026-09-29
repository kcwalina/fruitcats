//! Measuring, emphasis and line breaking, as text-layout.md says. Every length is in q, 1/64 of a layout pixel.

use super::font::Font;

/// `round(a / b)`, the tie going to the even integer; `b` is positive.
pub fn round_div(a: i64, b: i64) -> i64 {
    let q = a.div_euclid(b);
    let r = a.rem_euclid(b);
    match (2 * r).cmp(&b) {
        std::cmp::Ordering::Less => q,
        std::cmp::Ordering::Greater => q + 1,
        std::cmp::Ordering::Equal => q + (q & 1),
    }
}

/// A font at a size: what a run of text is set in.
#[derive(Clone, Copy)]
pub struct Sized<'a> {
    pub font: &'a Font,
    /// The font's file, as the draw list names it.
    pub file: &'a str,
    pub size: i64,
    pub whole_pixels: bool,
}

impl<'a> Sized<'a> {
    pub fn advance(&self, glyph: u16) -> i64 {
        let units = self.font.advance_units(glyph);
        if self.whole_pixels {
            64 * round_div(units * self.size, self.font.upem)
        } else {
            round_div(units * self.size * 64, self.font.upem)
        }
    }

    pub fn width(&self, text: &str) -> i64 {
        text.chars().map(|c| self.advance(self.font.glyph(c))).sum()
    }

    /// Each glyph of `text` drawn from `x` on the baseline `y`.
    pub fn glyphs(&self, text: &str, x: i64, y: i64) -> Vec<(u16, i64, i64)> {
        let mut at = x;
        text.chars()
            .map(|c| {
                let g = self.font.glyph(c);
                let placed = (g, at, y);
                at += self.advance(g);
                placed
            })
            .collect()
    }

    /// How far below a middle line the baseline is, for text centred on it.
    pub fn middle_to_baseline(&self) -> i64 {
        round_div((self.font.ascender + self.font.descender) * self.size * 32, self.font.upem)
    }

    pub fn with_size(&self, size: i64) -> Sized<'a> {
        Sized { size, ..*self }
    }
}

/// Simple uppercase: one character to one character.
pub fn capitals(text: &str) -> String {
    text.chars()
        .map(|c| {
            let mut upper = c.to_uppercase();
            match (upper.next(), upper.next()) {
                (Some(u), None) => u,
                _ => c,
            }
        })
        .collect()
}

// ── emphasis ─────────────────────────────────────────────────────────────────────────────────────

pub const REGULAR: u8 = 0;
pub const BOLD: u8 = 1;
pub const ITALIC: u8 = 2;

/// One of a paragraph's emphasis rules.
pub enum Emphasis {
    Words { style: u8, words: Vec<String>, with_number: bool },
    UpTo { style: u8, end: char },
    Between { style: u8, open: char, close: char },
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || ('\u{0300}'..='\u{036F}').contains(&c) || c == '\u{203F}' || c == '\u{2040}'
}

fn boundary(chars: &[char], at: usize) -> bool {
    let before = at > 0 && is_word_char(chars[at - 1]);
    let after = at < chars.len() && is_word_char(chars[at]);
    before != after
}

/// Each character's style, by the rules in order.
pub fn marks(text: &str, rules: &[Emphasis]) -> Vec<u8> {
    let chars: Vec<char> = text.chars().collect();
    let mut marks = vec![REGULAR; chars.len()];
    for rule in rules {
        match rule {
            Emphasis::Words { style, words, with_number } => {
                let mut ordered: Vec<Vec<char>> = words.iter().filter(|w| !w.is_empty()).map(|w| w.chars().collect()).collect();
                ordered.sort_by(|a, b| b.len().cmp(&a.len()));
                if ordered.is_empty() {
                    continue;
                }
                let mut i = 0;
                while i <= chars.len() {
                    match word_at(&chars, i, &ordered, *with_number) {
                        Some(end) => {
                            marks[i..end].iter_mut().for_each(|m| *m = *style);
                            i = if end > i { end } else { i + 1 };
                        }
                        None => i += 1,
                    }
                }
            }
            Emphasis::UpTo { style, end } => {
                let mut i = 0;
                while i < chars.len() {
                    let starts = i == 0 || chars[i - 1] == '\n' || (i >= 2 && chars[i - 2] == '.' && chars[i - 1] == ' ');
                    if starts && chars[i].is_ascii_uppercase() {
                        let mut j = i + 1;
                        let mut found = None;
                        while j < chars.len() {
                            if chars[j] == *end {
                                found = Some(j + 1);
                                break;
                            }
                            let c = chars[j];
                            if !(c.is_ascii_alphanumeric() || c == ' ' || c == ',') {
                                break;
                            }
                            j += 1;
                        }
                        if let Some(stop) = found {
                            marks[i..stop].iter_mut().for_each(|m| *m = *style);
                            i = stop;
                            continue;
                        }
                    }
                    i += 1;
                }
            }
            Emphasis::Between { style, open, close } => {
                let mut i = 0;
                while i < chars.len() {
                    if chars[i] == *open {
                        if let Some(offset) = chars[i + 1..].iter().position(|c| c == close) {
                            let stop = i + 1 + offset + 1;
                            marks[i..stop].iter_mut().for_each(|m| *m = *style);
                            i = stop;
                            continue;
                        }
                    }
                    i += 1;
                }
            }
        }
    }
    marks
}

/// Where a match of one of `words` starting at `i` ends: `\b(?:words)(?: \d+)?\b`.
fn word_at(chars: &[char], i: usize, words: &[Vec<char>], with_number: bool) -> Option<usize> {
    if !boundary(chars, i) {
        return None;
    }
    for word in words {
        if i + word.len() > chars.len() || chars[i..i + word.len()] != word[..] {
            continue;
        }
        let end = i + word.len();
        if with_number && end + 1 < chars.len() && chars[end] == ' ' && chars[end + 1].is_ascii_digit() {
            let mut last = end + 1;
            while last < chars.len() && chars[last].is_ascii_digit() {
                last += 1;
            }
            for stop in (end + 2..=last).rev() {
                if boundary(chars, stop) {
                    return Some(stop);
                }
            }
        }
        if boundary(chars, end) {
            return Some(end);
        }
    }
    None
}

/// The runs of one style: (text, style).
pub fn runs(text: &str, marks: &[u8]) -> Vec<(String, u8)> {
    let mut runs: Vec<(String, u8)> = Vec::new();
    for (c, m) in text.chars().zip(marks.iter()) {
        match runs.last_mut() {
            Some((run, style)) if *style == *m => run.push(c),
            _ => runs.push((c.to_string(), *m)),
        }
    }
    runs
}

// ── line breaking ────────────────────────────────────────────────────────────────────────────────

/// Breaks styled runs into lines no wider than `width`: a line is its pieces, each a word or a space, with its style.
pub fn wrap(runs: &[(String, u8)], width: i64, measure: &dyn Fn(&str, u8) -> i64) -> Vec<Vec<(String, u8)>> {
    let mut lines: Vec<Vec<(String, u8)>> = Vec::new();
    let mut line: Vec<(String, u8)> = Vec::new();
    let mut used = 0;
    for (chunk, style) in runs {
        for (piece, gap) in pieces(chunk) {
            if gap {
                if piece.contains('\n') {
                    lines.push(std::mem::take(&mut line));
                    used = 0;
                } else if !line.is_empty() {
                    line.push((" ".to_string(), *style));
                    used += measure(" ", *style);
                }
                continue;
            }
            let size = measure(&piece, *style);
            if used + size > width && !line.is_empty() {
                while line.last().is_some_and(|(p, _)| p == " ") {
                    line.pop();
                }
                lines.push(std::mem::take(&mut line));
                used = 0;
            }
            line.push((piece, *style));
            used += size;
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

/// A text as words and gaps (maximal runs of white space), in order: (piece, is a gap).
fn pieces(text: &str) -> Vec<(String, bool)> {
    let mut out: Vec<(String, bool)> = Vec::new();
    for c in text.chars() {
        let gap = c.is_whitespace();
        match out.last_mut() {
            Some((piece, was_gap)) if *was_gap == gap => piece.push(c),
            _ => out.push((c.to_string(), gap)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_takes_ties_to_even() {
        assert_eq!((round_div(5, 2), round_div(7, 2), round_div(-5, 2), round_div(10, 4), round_div(11, 4)), (2, 4, -2, 2, 3));
    }

    #[test]
    fn keywords_with_their_numbers_are_bold() {
        let rules = [Emphasis::Words { style: BOLD, words: vec!["Tough".into(), "Swift".into()], with_number: true }];
        let text = "Swift. Tough 12. Toughness.";
        let bold: String = text.chars().zip(marks(text, &rules)).map(|(c, m)| if m == BOLD { c } else { '_' }).collect();
        assert_eq!(bold, "Swift__Tough 12____________");
    }

    #[test]
    fn a_sentence_opening_up_to_a_colon_is_bold() {
        let rules = [Emphasis::UpTo { style: BOLD, end: ':' }];
        let text = "Hello: Draw. Last Words, now: go.\nOn Enter: x (not: this)";
        let bold: String = text.chars().zip(marks(text, &rules)).map(|(c, m)| if m == BOLD { c } else { '_' }).collect();
        assert_eq!(bold, "Hello:_______Last Words, now:_____On Enter:______________");
    }

    #[test]
    fn a_line_break_in_a_gap_ends_one_line() {
        let runs = vec![("one two\n\nthree".to_string(), REGULAR)];
        let lines = wrap(&runs, 1000, &|t, _| t.chars().count() as i64);
        let words: Vec<String> = lines.iter().map(|l| l.iter().map(|(p, _)| p.as_str()).collect()).collect();
        assert_eq!(words, vec!["one two", "three"]);
    }
}
