//! A TrueType font, read by the tables text layout needs (text-layout.md, "The font"): glyph lookup, advances and the
//! vertical metrics; and its glyphs' outlines (`glyf`), which the rasteriser fills.

pub struct Font {
    pub upem: i64,
    pub ascender: i64,
    pub descender: i64,
    advances: Vec<u16>,
    map: CharMap,
    glyf: Vec<u8>,
    /// Where each glyph's outline starts in `glyf`, and where the next one does.
    loca: Vec<u32>,
}

/// A point of a glyph's outline, in font units, y up: on the curve, or a quadratic control point.
#[derive(Clone, Copy)]
pub struct OutlinePoint {
    pub x: f32,
    pub y: f32,
    pub on: bool,
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
        let long = i16_at(head, 50).unwrap_or(0) == 1;
        let loca_table = table(b"loca").unwrap_or(&[]);
        let mut loca = Vec::with_capacity(glyphs + 1);
        for g in 0..=glyphs {
            let offset = if long { u32_at(loca_table, 4 * g) } else { u16_at(loca_table, 2 * g).map(|v| 2 * v as u32) };
            loca.push(offset.unwrap_or(0));
        }
        let glyf = table(b"glyf").unwrap_or(&[]).to_vec();
        Ok(Font { upem, ascender, descender, advances, map, glyf, loca })
    }

    /// A glyph's outline: its contours, each a closed list of points. Empty for a glyph with none (a space).
    pub fn outline(&self, glyph: u16) -> Vec<Vec<OutlinePoint>> {
        let mut contours = Vec::new();
        self.add_outline(glyph, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0], 0, &mut contours);
        contours
    }

    /// Adds a glyph's contours, each point mapped by `m` (`[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f).
    fn add_outline(&self, glyph: u16, m: [f32; 6], depth: u32, contours: &mut Vec<Vec<OutlinePoint>>) {
        let g = glyph as usize;
        let (Some(&start), Some(&end)) = (self.loca.get(g), self.loca.get(g + 1)) else { return };
        if end <= start || depth > 8 {
            return;
        }
        let Some(data) = self.glyf.get(start as usize..end as usize) else { return };
        let Some(count) = i16_at(data, 0) else { return };
        let map = |x: f32, y: f32| (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
        if count >= 0 {
            let count = count as usize;
            let ends: Vec<usize> = (0..count).filter_map(|i| u16_at(data, 10 + 2 * i).map(|e| e as usize)).collect();
            let points = ends.last().map(|e| e + 1).unwrap_or(0);
            let instructions = u16_at(data, 10 + 2 * count).unwrap_or(0) as usize;
            let mut at = 12 + 2 * count + instructions;
            let mut flags = Vec::with_capacity(points);
            while flags.len() < points {
                let Some(&flag) = data.get(at) else { return };
                at += 1;
                flags.push(flag);
                if flag & 8 != 0 {
                    let Some(&repeat) = data.get(at) else { return };
                    at += 1;
                    for _ in 0..repeat {
                        flags.push(flag);
                    }
                }
            }
            flags.truncate(points);
            let mut read = |short: u8, same: u8| -> Vec<i32> {
                let mut values = Vec::with_capacity(points);
                let mut value = 0i32;
                for &flag in &flags {
                    if flag & short != 0 {
                        let delta = *data.get(at).unwrap_or(&0) as i32;
                        at += 1;
                        value += if flag & same != 0 { delta } else { -delta };
                    } else if flag & same == 0 {
                        value += i16_at(data, at).unwrap_or(0) as i32;
                        at += 2;
                    }
                    values.push(value);
                }
                values
            };
            let xs = read(2, 16);
            let ys = read(4, 32);
            let mut first = 0;
            for end in ends {
                let contour: Vec<OutlinePoint> = (first..=end.min(points.saturating_sub(1)))
                    .map(|i| {
                        let (x, y) = map(xs[i] as f32, ys[i] as f32);
                        OutlinePoint { x, y, on: flags[i] & 1 != 0 }
                    })
                    .collect();
                if !contour.is_empty() {
                    contours.push(contour);
                }
                first = end + 1;
            }
            return;
        }
        // A composite: other glyphs, each moved, and maybe scaled.
        let mut at = 10;
        loop {
            let (Some(flags), Some(component)) = (u16_at(data, at), u16_at(data, at + 2)) else { return };
            at += 4;
            let (dx, dy) = if flags & 1 != 0 {
                let v = (i16_at(data, at).unwrap_or(0) as f32, i16_at(data, at + 2).unwrap_or(0) as f32);
                at += 4;
                v
            } else {
                let v = (*data.get(at).unwrap_or(&0) as i8 as f32, *data.get(at + 1).unwrap_or(&0) as i8 as f32);
                at += 2;
                v
            };
            let f2dot14 = |at: usize| i16_at(data, at).unwrap_or(0) as f32 / 16384.0;
            let (mut a, mut b, mut c, mut d) = (1.0, 0.0, 0.0, 1.0);
            if flags & 8 != 0 {
                a = f2dot14(at);
                d = a;
                at += 2;
            } else if flags & 0x40 != 0 {
                a = f2dot14(at);
                d = f2dot14(at + 2);
                at += 4;
            } else if flags & 0x80 != 0 {
                a = f2dot14(at);
                b = f2dot14(at + 2);
                c = f2dot14(at + 4);
                d = f2dot14(at + 6);
                at += 8;
            }
            // Offsets are x and y (ARGS_ARE_XY_VALUES); matching points is not supported and leaves the offset at 0.
            let (dx, dy) = if flags & 2 != 0 { (dx, dy) } else { (0.0, 0.0) };
            let inner = [a, b, c, d, dx, dy];
            let combined = [
                m[0] * inner[0] + m[2] * inner[1],
                m[1] * inner[0] + m[3] * inner[1],
                m[0] * inner[2] + m[2] * inner[3],
                m[1] * inner[2] + m[3] * inner[3],
                m[0] * inner[4] + m[2] * inner[5] + m[4],
                m[1] * inner[4] + m[3] * inner[5] + m[5],
            ];
            self.add_outline(component, combined, depth + 1, contours);
            if flags & 0x20 == 0 {
                return;
            }
        }
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
