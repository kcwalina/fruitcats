//! The draw list: what a card face is, drawn in order, as text (draw-list.md). Every length is in q, 1/64 of a layout
//! pixel, from the trimmed card's top-left corner.

use std::fmt::Write;

/// What a shape is filled or stroked with.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Paint {
    /// 0xAARRGGBB.
    Color(u32),
    /// A finish's texture, drawn from the card's corner at its own size.
    Finish(String),
    /// A frame's texture, covering the card, centred; it replaces what is under it.
    Texture(String),
    /// Leaves a hole: what is under it is cleared.
    Clear,
}

impl Paint {
    fn write(&self, out: &mut String) {
        match self {
            Paint::Color(c) => write!(out, "#{:08X}", c).unwrap(),
            Paint::Finish(path) => write!(out, "finish:{}", path).unwrap(),
            Paint::Texture(path) => write!(out, "texture:{}", path).unwrap(),
            Paint::Clear => out.push_str("clear"),
        }
    }
}

#[derive(Clone, Copy)]
pub struct Rect {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
}

impl Rect {
    pub fn px(x: i64, y: i64, w: i64, h: i64) -> Rect {
        Rect { x: 64 * x, y: 64 * y, w: 64 * w, h: 64 * h }
    }

    fn write(&self, out: &mut String) {
        write!(out, "{} {} {} {}", self.x, self.y, self.w, self.h).unwrap();
    }
}

pub struct DrawList {
    out: String,
}

impl DrawList {
    pub fn new(width: i64, height: i64, bleed: i64) -> DrawList {
        DrawList { out: format!("kardix draw list 1\ncard {} {} bleed {}\n", width, height, bleed) }
    }

    /// A rectangle with corners of radii (rx, ry), filled; `smooth` edges are antialiased.
    pub fn rect(&mut self, r: Rect, rx: i64, ry: i64, paint: &Paint, smooth: bool) {
        self.out.push_str("rect ");
        r.write(&mut self.out);
        write!(self.out, " radius {} {} ", rx, ry).unwrap();
        paint.write(&mut self.out);
        self.out.push_str(if smooth { " smooth\n" } else { "\n" });
    }

    /// The band between two rounded rectangles, the inner one inside the outer: an outline drawn inside a box.
    pub fn ring(&mut self, outer: Rect, outer_radius: (i64, i64), inner: Rect, inner_radius: (i64, i64), paint: &Paint) {
        self.out.push_str("ring ");
        outer.write(&mut self.out);
        write!(self.out, " radius {} {} inner ", outer_radius.0, outer_radius.1).unwrap();
        inner.write(&mut self.out);
        write!(self.out, " radius {} {} ", inner_radius.0, inner_radius.1).unwrap();
        paint.write(&mut self.out);
        self.out.push('\n');
    }

    /// A rounded rectangle's outline, centred on its edge, antialiased.
    pub fn stroke(&mut self, r: Rect, rx: i64, ry: i64, width: i64, paint: &Paint) {
        self.out.push_str("stroke ");
        r.write(&mut self.out);
        write!(self.out, " radius {} {} width {} ", rx, ry, width).unwrap();
        paint.write(&mut self.out);
        self.out.push('\n');
    }

    /// A five-pointed star filling the box's circle, point up, its inner points at 45% of the radius.
    pub fn star(&mut self, r: Rect, paint: &Paint) {
        self.out.push_str("star ");
        r.write(&mut self.out);
        self.out.push(' ');
        paint.write(&mut self.out);
        self.out.push('\n');
    }

    pub fn line(&mut self, x1: i64, y1: i64, x2: i64, y2: i64, width: i64, paint: &Paint) {
        write!(self.out, "line {} {} {} {} width {} ", x1, y1, x2, y2, width).unwrap();
        paint.write(&mut self.out);
        self.out.push('\n');
    }

    /// An image into a box: `cover` fills it and trims the overflow evenly, `contain` shows it whole, `stretch` fills it
    /// exactly. With a radius, it is clipped to the rounded box.
    pub fn image(&mut self, path: &str, fit: &str, r: Rect, radius: i64) {
        write!(self.out, "image {} {} ", path, fit).unwrap();
        r.write(&mut self.out);
        if radius > 0 {
            write!(self.out, " radius {}", radius).unwrap();
        }
        self.out.push('\n');
    }

    /// An image at its own size, its top-left corner at (x, y).
    pub fn image_at(&mut self, path: &str, x: i64, y: i64) {
        writeln!(self.out, "image {} natural {} {}", path, x, y).unwrap();
    }

    /// An image stretched into a box, every pixel painted `paint` where the image isn't clear.
    pub fn tinted(&mut self, path: &str, r: Rect, paint: &Paint) {
        write!(self.out, "tinted {} ", path).unwrap();
        r.write(&mut self.out);
        self.out.push(' ');
        paint.write(&mut self.out);
        self.out.push('\n');
    }

    /// Glyphs of one font at one size, each at its origin on the baseline; with an outline, a stroke of `width` with round
    /// joins is drawn under them.
    pub fn text(&mut self, font: &str, size: i64, fill: &Paint, outline: Option<(&Paint, i64)>, glyphs: &[(u16, i64, i64)]) {
        if glyphs.is_empty() {
            return;
        }
        write!(self.out, "text {} {} ", font, size).unwrap();
        fill.write(&mut self.out);
        if let Some((paint, width)) = outline {
            self.out.push_str(" outline ");
            paint.write(&mut self.out);
            write!(self.out, " {}", width).unwrap();
        }
        for (g, x, y) in glyphs {
            write!(self.out, " {}@{},{}", g, x, y).unwrap();
        }
        self.out.push('\n');
    }

    pub fn finish(self) -> String {
        self.out
    }
}
