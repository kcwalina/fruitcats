//! The identifier rules, in one place: hyphenated segments, a capital letter for a type name.

/// Reads one identifier starting at `position`, and moves past it. Only the first segment must start with a letter or
/// underscore, so `gpt-5` is one identifier and `5` is not one.
pub fn try_read(source: &[u8], position: &mut usize, end: usize) -> bool {
    if *position >= end || !is_start(source[*position]) {
        return false;
    }

    *position += 1;
    while *position < end && is_part(source[*position]) {
        *position += 1;
    }

    while *position + 1 < end && source[*position] == b'-' && is_part(source[*position + 1]) {
        *position += 2;
        while *position < end && is_part(source[*position]) {
            *position += 1;
        }
    }

    true
}

/// The words that are keywords in value position, and so can never be enum members.
pub fn is_value_keyword(text: &[u8]) -> bool {
    text == b"nic" || text == b"empty" || text == b"true" || text == b"false" || text == b"nameof"
}

pub fn is_start(value: u8) -> bool {
    value.is_ascii_alphabetic() || value == b'_'
}

pub fn is_part(value: u8) -> bool {
    is_start(value) || value.is_ascii_digit()
}
