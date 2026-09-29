//! A TrueType font, read by the tables text layout needs (text-layout.md, "The font"): glyph lookup, advances and the
//! vertical metrics.

pub struct Font {
    pub upem: i64,
    pub ascender: i64,
    pub descender: i64,
    advances: Vec<u16>,
    map: CharMap,
}

enum CharMap {
    Segments(Vec<(u32, u32, i16, u16, usize)>, Vec<u8>),
    Groups(Vec<(u32, u32, u32)>),
    None,
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*b.get(at)?, *b.get(at + 1)?]))
}

fn i16_at(b: &[u8], at: usize) -> Option<i16> {
    u16_at(b, at).map(|v| v as i16)
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes([*b.get(at)?, *b.get(at + 1)?, *b.get(at + 2)?, *b.get(at + 3)?]))
}

impl Font {
    pub fn read(bytes: &[u8]) -> Result<Font, String> {
        let table = |tag: &[u8; 4]| -> Option<&[u8]> {
            let count = u16_at(bytes, 4)? as usize;
            for i in 0..count {
                let record = 12 + 16 * i;
                if bytes.get(record..record + 4)? == tag {
                    let offset = u32_at(bytes, record + 8)? as usize;
                    let length = u32_at(bytes, record + 12)? as usize;
                    return bytes.get(offset..offset + length);
                }
            }
            None
        };
        let bad = |what: &str| format!("the font has no readable {} table", what);
        let head = table(b"head").ok_or_else(|| bad("head"))?;
        let hhea = table(b"hhea").ok_or_else(|| bad("hhea"))?;
        let hmtx = table(b"hmtx").ok_or_else(|| bad("hmtx"))?;
        let maxp = table(b"maxp").ok_or_else(|| bad("maxp"))?;
        let upem = u16_at(head, 18).ok_or_else(|| bad("head"))? as i64;
        let mut ascender = i16_at(hhea, 4).unwrap_or(0) as i64;
        let mut descender = i16_at(hhea, 6).unwrap_or(0) as i64;
        if ascender == 0 && descender == 0 {
            if let Some(os2) = table(b"OS/2") {
                ascender = i16_at(os2, 68).unwrap_or(0) as i64;
                descender = i16_at(os2, 70).unwrap_or(0) as i64;
                if ascender == 0 && descender == 0 {
                    ascender = u16_at(os2, 74).unwrap_or(0) as i64;
                    descender = -(u16_at(os2, 76).unwrap_or(0) as i64);
                }
            }
        }
        let metrics = u16_at(hhea, 34).ok_or_else(|| bad("hhea"))? as usize;
        let glyphs = u16_at(maxp, 4).ok_or_else(|| bad("maxp"))? as usize;
        let mut advances = Vec::with_capacity(glyphs.max(metrics));
        for g in 0..glyphs.max(metrics) {
            let advance = if g < metrics { u16_at(hmtx, 4 * g) } else { u16_at(hmtx, 4 * (metrics - 1)) };
            advances.push(advance.ok_or_else(|| bad("hmtx"))?);
        }
        let map = table(b"cmap").map(char_map).unwrap_or(CharMap::None);
        if upem == 0 {
            return Err("the font's unitsPerEm is 0".to_string());
        }
        Ok(Font { upem, ascender, descender, advances, map })
    }

    /// The glyph for a character, or 0 (.notdef).
    pub fn glyph(&self, c: char) -> u16 {
        let c = c as u32;
        match &self.map {
            CharMap::Groups(groups) => {
                for &(start, end, first) in groups {
                    if c >= start && c <= end {
                        return (first + (c - start)) as u16;
                    }
                }
                0
            }
            CharMap::Segments(segments, table) => {
                for &(start, end, delta, range_offset, range_at) in segments {
                    if c < start || c > end {
                        continue;
                    }
                    if range_offset == 0 {
                        return (c as i32 + delta as i32) as u16;
                    }
                    let at = range_at + range_offset as usize + 2 * (c - start) as usize;
                    let g = u16_at(table, at).unwrap_or(0);
                    return if g == 0 { 0 } else { (g as i32 + delta as i32) as u16 };
                }
                0
            }
            CharMap::None => 0,
        }
    }

    /// A glyph's advance width in font units.
    pub fn advance_units(&self, glyph: u16) -> i64 {
        self.advances.get(glyph as usize).copied().unwrap_or(0) as i64
    }
}

/// The cmap subtable text layout reads: Unicode's full range (format 12) when there is one, else its basic plane
/// (format 4).
fn char_map(cmap: &[u8]) -> CharMap {
    let count = u16_at(cmap, 2).unwrap_or(0) as usize;
    let mut full: Option<usize> = None;
    let mut basic: Option<usize> = None;
    for i in 0..count {
        let record = 4 + 8 * i;
        let (Some(platform), Some(encoding), Some(offset)) = (u16_at(cmap, record), u16_at(cmap, record + 2), u32_at(cmap, record + 4)) else {
            continue;
        };
        let offset = offset as usize;
        let format = u16_at(cmap, offset).unwrap_or(0);
        let unicode_full = (platform == 3 && encoding == 10) || (platform == 0 && (encoding == 4 || encoding == 6));
        let unicode_basic = (platform == 3 && encoding == 1) || platform == 0;
        if format == 12 && unicode_full && full.is_none() {
            full = Some(offset);
        } else if format == 4 && unicode_basic && basic.is_none() {
            basic = Some(offset);
        }
    }
    if let Some(at) = full {
        let groups = u32_at(cmap, at + 12).unwrap_or(0) as usize;
        let mut list = Vec::with_capacity(groups);
        for i in 0..groups {
            let g = at + 16 + 12 * i;
            if let (Some(start), Some(end), Some(first)) = (u32_at(cmap, g), u32_at(cmap, g + 4), u32_at(cmap, g + 8)) {
                list.push((start, end, first));
            }
        }
        return CharMap::Groups(list);
    }
    if let Some(at) = basic {
        let segments = u16_at(cmap, at + 6).unwrap_or(0) as usize / 2;
        let ends = at + 14;
        let starts = ends + 2 * segments + 2;
        let deltas = starts + 2 * segments;
        let offsets = deltas + 2 * segments;
        let mut list = Vec::with_capacity(segments);
        for i in 0..segments {
            let (Some(end), Some(start), Some(delta), Some(range)) =
                (u16_at(cmap, ends + 2 * i), u16_at(cmap, starts + 2 * i), i16_at(cmap, deltas + 2 * i), u16_at(cmap, offsets + 2 * i))
            else {
                continue;
            };
            list.push((start as u32, end as u32, delta, range, offsets + 2 * i));
        }
        return CharMap::Segments(list, cmap.to_vec());
    }
    CharMap::None
}
