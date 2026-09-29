//! Pixels from a draw list (draw-list.md), with tiny-skia: the replaceable part of the renderer. Glyphs are filled from
//! their outlines in the project's fonts, unhinted; images are the project's PNG and WebP files.

use std::collections::HashMap;

use tiny_skia::{
    BlendMode, Color, FillRule, FilterQuality, LineCap, LineJoin, Mask, Paint, Path, PathBuilder, Pattern, Pixmap, PixmapPaint,
    Rect, SpreadMode, Stroke, Transform,
};

use super::font::Font;

type Result<T> = std::result::Result<T, String>;

/// What a draw list needs besides itself: the project's files, by path.
pub trait Files {
    fn file(&self, path: &str) -> Option<&[u8]>;
}

pub struct Raster<'f> {
    files: &'f dyn Files,
    fonts: HashMap<String, Font>,
    images: HashMap<String, Pixmap>,
}

fn q(text: &str) -> Result<f32> {
    text.parse::<i64>().map(|v| v as f32 / 64.0).map_err(|_| format!("'{}' is not a number of 1/64 pixels.", text))
}

impl<'f> Raster<'f> {
    pub fn new(files: &'f dyn Files) -> Raster<'f> {
        Raster { files, fonts: HashMap::new(), images: HashMap::new() }
    }

    /// Reads a picture the first time it is drawn.
    fn load_image(&mut self, path: &str) -> Result<()> {
        if !self.images.contains_key(path) {
            let bytes = self.files.file(path).ok_or_else(|| format!("The picture {} is not in the project.", path))?;
            let pixmap = decode(bytes).map_err(|e| format!("The picture {}: {}.", path, e))?;
            self.images.insert(path.to_string(), pixmap);
        }
        Ok(())
    }

    /// Reads the picture a paint names, if it names one.
    fn load_paint(&mut self, paint: &str) -> Result<()> {
        match paint.strip_prefix("finish:").or_else(|| paint.strip_prefix("texture:")) {
            Some(path) => self.load_image(path),
            None => Ok(()),
        }
    }

    fn load_font(&mut self, path: &str) -> Result<()> {
        if !self.fonts.contains_key(path) {
            let bytes = self.files.file(path).ok_or_else(|| format!("The font {} is not in the project.", path))?;
            self.fonts.insert(path.to_string(), Font::read(bytes).map_err(|e| format!("The font {}: {}.", path, e))?);
        }
        Ok(())
    }

    /// The card, with its bleed or trimmed.
    pub fn draw(&mut self, list: &str, with_bleed: bool) -> Result<Pixmap> {
        let mut lines = list.lines();
        if lines.next() != Some("kardix draw list 1") {
            return Err("This is not a draw list (kardix draw list 1).".to_string());
        }
        let card: Vec<&str> = lines.next().unwrap_or("").split(' ').collect();
        let [_, width, height, _, bleed] = card[..] else { return Err("The draw list says no card size.".to_string()) };
        let (width, height, bleed): (u32, u32, u32) = (
            width.parse().map_err(|_| "bad width")?,
            height.parse().map_err(|_| "bad height")?,
            bleed.parse().map_err(|_| "bad bleed")?,
        );
        let pad = if with_bleed { bleed } else { 0 };
        let mut pixmap = Pixmap::new(width + 2 * pad, height + 2 * pad).ok_or("The card is too large to draw.")?;
        let at = Transform::from_translate(pad as f32, pad as f32);
        let card = (width as f32, height as f32);
        for line in lines {
            let words: Vec<&str> = line.split(' ').collect();
            self.operation(&mut pixmap, at, card, &words).map_err(|e| format!("{} ({})", e, line.chars().take(80).collect::<String>()))?;
        }
        Ok(pixmap)
    }

    fn operation(&mut self, pixmap: &mut Pixmap, at: Transform, card: (f32, f32), w: &[&str]) -> Result<()> {
        match w[0] {
            "rect" => self.load_paint(w.get(8).copied().unwrap_or(""))?,
            "ring" => self.load_paint(w.get(16).copied().unwrap_or(""))?,
            "image" | "tinted" => self.load_image(w.get(1).copied().unwrap_or(""))?,
            "text" => {
                self.load_font(w.get(1).copied().unwrap_or(""))?;
                self.load_paint(w.get(3).copied().unwrap_or(""))?;
                if w.get(4) == Some(&"outline") {
                    self.load_paint(w.get(5).copied().unwrap_or(""))?;
                }
            }
            _ => {}
        }
        self.draw_operation(pixmap, at, card, w)
    }

    fn draw_operation(&self, pixmap: &mut Pixmap, at: Transform, card: (f32, f32), w: &[&str]) -> Result<()> {
        let rect = |i: usize| -> Result<(f32, f32, f32, f32)> { Ok((q(w[i])?, q(w[i + 1])?, q(w[i + 2])?, q(w[i + 3])?)) };
        match w[0] {
            "rect" => {
                let (x, y, width, height) = rect(1)?;
                let path = rounded(x, y, width, height, q(w[6])?, q(w[7])?).ok_or("an empty rectangle")?;
                let smooth = w.get(9) == Some(&"smooth");
                self.fill(pixmap, at, card, &path, w[8], smooth, FillRule::Winding)
            }
            "ring" => {
                let (x, y, width, height) = rect(1)?;
                let (ix, iy, iw, ih) = rect(9)?;
                let mut builder = PathBuilder::new();
                if let Some(outer) = rounded(x, y, width, height, q(w[6])?, q(w[7])?) {
                    builder.push_path(&outer);
                }
                if let Some(inner) = rounded(ix, iy, iw, ih, q(w[14])?, q(w[15])?) {
                    builder.push_path(&inner);
                }
                let Some(path) = builder.finish() else { return Ok(()) };
                self.fill(pixmap, at, card, &path, w[16], false, FillRule::EvenOdd)
            }
            "stroke" => {
                let (x, y, width, height) = rect(1)?;
                let path = rounded(x, y, width, height, q(w[6])?, q(w[7])?).ok_or("an empty rectangle")?;
                let paint = self.paint(w[10], card, true)?;
                let stroke = Stroke { width: q(w[9])?, ..Stroke::default() };
                pixmap.stroke_path(&path, &paint, &stroke, at, None);
                Ok(())
            }
            "star" => {
                let (x, y, width, _) = rect(1)?;
                let r = width / 2.0;
                let (cx, cy) = (x + r, y + q(w[4])? / 2.0);
                let mut builder = PathBuilder::new();
                for i in 0..10 {
                    let radius = if i % 2 == 0 { r } else { r * 0.45 };
                    let angle = std::f64::consts::PI / 2.0 + i as f64 * std::f64::consts::PI / 5.0;
                    let (px, py) = (cx + radius * angle.cos() as f32, cy - radius * angle.sin() as f32);
                    if i == 0 { builder.move_to(px, py) } else { builder.line_to(px, py) }
                }
                builder.close();
                let path = builder.finish().ok_or("an empty star")?;
                self.fill(pixmap, at, card, &path, w[5], false, FillRule::Winding)
            }
            "line" => {
                let mut builder = PathBuilder::new();
                builder.move_to(q(w[1])?, q(w[2])?);
                builder.line_to(q(w[3])?, q(w[4])?);
                let path = builder.finish().ok_or("an empty line")?;
                let mut paint = self.paint(w[7], card, false)?;
                paint.anti_alias = false;
                let stroke = Stroke { width: q(w[6])?, line_cap: LineCap::Butt, ..Stroke::default() };
                pixmap.stroke_path(&path, &paint, &stroke, at, None);
                Ok(())
            }
            "image" if w[2] == "natural" => {
                let (x, y) = (q(w[3])?, q(w[4])?);
                let image = &self.images[w[1]];
                let placed = at.pre_translate(x, y);
                pixmap.draw_pixmap(0, 0, image.as_ref(), &PixmapPaint { quality: FilterQuality::Nearest, ..PixmapPaint::default() }, placed, None);
                Ok(())
            }
            "image" => {
                let (x, y, width, height) = rect(3)?;
                let radius = if w.get(7) == Some(&"radius") { q(w[8])? } else { 0.0 };
                let image = &self.images[w[1]];
                let (iw, ih) = (image.width() as f32, image.height() as f32);
                let place = match w[2] {
                    "cover" | "contain" => {
                        let scale = if w[2] == "cover" { (width / iw).max(height / ih) } else { (width / iw).min(height / ih) };
                        Transform::from_scale(scale, scale).post_translate(x + (width - iw * scale) / 2.0, y + (height - ih * scale) / 2.0)
                    }
                    _ => Transform::from_scale(width / iw, height / ih).post_translate(x, y),
                };
                let paint = Paint {
                    shader: Pattern::new(image.as_ref(), SpreadMode::Pad, FilterQuality::Bicubic, 1.0, place),
                    anti_alias: false,
                    ..Paint::default()
                };
                let path = rounded(x, y, width, height, radius, radius).ok_or("an empty picture")?;
                pixmap.fill_path(&path, &paint, FillRule::Winding, at, None);
                Ok(())
            }
            "tinted" => {
                let (x, y, width, height) = rect(2)?;
                let image = &self.images[w[1]];
                let color = color(w[6])?;
                let mut tinted = (*image).clone();
                for pixel in tinted.pixels_mut() {
                    let a = pixel.alpha();
                    let c = color.premultiply().to_color_u8();
                    let scale = |v: u8| ((v as u32 * a as u32 + 127) / 255) as u8;
                    *pixel = tiny_skia::PremultipliedColorU8::from_rgba(scale(c.red()), scale(c.green()), scale(c.blue()), scale(c.alpha())).unwrap();
                }
                let place = Transform::from_scale(width / image.width() as f32, height / image.height() as f32).post_translate(x, y);
                let paint = Paint { shader: Pattern::new(tinted.as_ref(), SpreadMode::Pad, FilterQuality::Bicubic, 1.0, place), ..Paint::default() };
                pixmap.fill_rect(Rect::from_xywh(x, y, width, height).ok_or("an empty icon")?, &paint, at, None);
                Ok(())
            }
            "text" => self.text(pixmap, at, card, w),
            other => Err(format!("The rasteriser doesn't know how to draw a {}.", other)),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn fill(&self, pixmap: &mut Pixmap, at: Transform, card: (f32, f32), path: &Path, paint: &str, smooth: bool, rule: FillRule) -> Result<()> {
        let mut paint = self.paint(paint, card, smooth)?;
        paint.anti_alias = smooth;
        pixmap.fill_path(path, &paint, rule, at, None);
        Ok(())
    }

    fn paint(&self, paint: &str, card: (f32, f32), smooth: bool) -> Result<Paint<'_>> {
        let mut result = Paint { anti_alias: smooth, ..Paint::default() };
        if paint == "clear" {
            result.blend_mode = BlendMode::Clear;
        } else if let Some(path) = paint.strip_prefix("finish:") {
            let image = &self.images[path];
            result.shader = Pattern::new(image.as_ref(), SpreadMode::Pad, FilterQuality::Bicubic, 1.0, Transform::identity());
        } else if let Some(path) = paint.strip_prefix("texture:") {
            let image = &self.images[path];
            let (iw, ih) = (image.width() as f32, image.height() as f32);
            let scale = (card.0 / iw).max(card.1 / ih);
            let place = Transform::from_scale(scale, scale).post_translate((card.0 - iw * scale) / 2.0, (card.1 - ih * scale) / 2.0);
            result.shader = Pattern::new(image.as_ref(), SpreadMode::Pad, FilterQuality::Bicubic, 1.0, place);
            result.blend_mode = BlendMode::Source;
        } else {
            result.set_color(color(paint)?);
        }
        Ok(result)
    }

    fn text(&self, pixmap: &mut Pixmap, at: Transform, card: (f32, f32), w: &[&str]) -> Result<()> {
        let size: f32 = w[2].parse().map_err(|_| "bad size")?;
        let fill = w[3];
        let (outline, glyphs_from) = if w.get(4) == Some(&"outline") { (Some((w[5], q(w[6])?)), 7) } else { (None, 4) };
        let font = &self.fonts[w[1]];
        let scale = size / font.upem as f32;
        let mut builder = PathBuilder::new();
        for glyph in &w[glyphs_from..] {
            let (id, place) = glyph.split_once('@').ok_or("a glyph without a place")?;
            let (x, y) = place.split_once(',').ok_or("a glyph without a place")?;
            let (id, x, y): (u16, f32, f32) = (id.parse().map_err(|_| "bad glyph")?, q(x)?, q(y)?);
            for contour in font.outline(id) {
                add_contour(&mut builder, &contour, x, y, scale);
            }
        }
        let Some(path) = builder.finish() else { return Ok(()) };
        if let Some((paint, width)) = outline {
            let paint = self.paint(paint, card, true)?;
            let stroke = Stroke { width, line_join: LineJoin::Round, ..Stroke::default() };
            pixmap.stroke_path(&path, &paint, &stroke, at, None);
        }
        let paint = self.paint(fill, card, true)?;
        pixmap.fill_path(&path, &paint, FillRule::Winding, at, None::<&Mask>);
        Ok(())
    }
}

/// A glyph's contour, quadratic B-spline points in font units (y up), placed with its origin at (x, y).
fn add_contour(builder: &mut PathBuilder, contour: &[super::font::OutlinePoint], x: f32, y: f32, scale: f32) {
    let n = contour.len();
    if n == 0 {
        return;
    }
    let at = |i: usize| {
        let p = contour[i % n];
        (x + p.x * scale, y - p.y * scale, p.on)
    };
    let mid = |a: (f32, f32, bool), b: (f32, f32, bool)| ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
    // Start on a point on the curve: the first one that is, or the midpoint of the first two when none is.
    let start_index = (0..n).find(|i| contour[*i].on);
    let (start, first) = match start_index {
        Some(i) => ((at(i).0, at(i).1), i),
        None => (mid(at(0), at(1)), 0),
    };
    builder.move_to(start.0, start.1);
    let mut control: Option<(f32, f32)> = if start_index.is_none() { Some((at(0).0, at(0).1)) } else { None };
    for step in 1..=n {
        let p = at(first + step);
        if p.2 {
            match control.take() {
                Some(c) => builder.quad_to(c.0, c.1, p.0, p.1),
                None => builder.line_to(p.0, p.1),
            }
        } else {
            if let Some(c) = control {
                let m = mid((c.0, c.1, false), p);
                builder.quad_to(c.0, c.1, m.0, m.1);
            }
            control = Some((p.0, p.1));
        }
    }
    if let Some(c) = control {
        builder.quad_to(c.0, c.1, start.0, start.1);
    }
    builder.close();
}

/// A rectangle with elliptical corners, the radii scaled down together when they don't fit, as Skia's rounded
/// rectangles are.
fn rounded(x: f32, y: f32, w: f32, h: f32, rx: f32, ry: f32) -> Option<Path> {
    if w <= 0.0 || h <= 0.0 {
        return None;
    }
    let (mut rx, mut ry) = (rx.max(0.0), ry.max(0.0));
    let fit = (w / (2.0 * rx).max(f32::MIN_POSITIVE)).min(h / (2.0 * ry).max(f32::MIN_POSITIVE)).min(1.0);
    rx *= fit;
    ry *= fit;
    if rx == 0.0 || ry == 0.0 {
        return Some(PathBuilder::from_rect(Rect::from_xywh(x, y, w, h)?));
    }
    const K: f32 = 0.552_284_8;
    let (r, b) = (x + w, y + h);
    let mut p = PathBuilder::new();
    p.move_to(x + rx, y);
    p.line_to(r - rx, y);
    p.cubic_to(r - rx + K * rx, y, r, y + ry - K * ry, r, y + ry);
    p.line_to(r, b - ry);
    p.cubic_to(r, b - ry + K * ry, r - rx + K * rx, b, r - rx, b);
    p.line_to(x + rx, b);
    p.cubic_to(x + rx - K * rx, b, x, b - ry + K * ry, x, b - ry);
    p.line_to(x, y + ry);
    p.cubic_to(x, y + ry - K * ry, x + rx - K * rx, y, x + rx, y);
    p.close();
    p.finish()
}

fn color(text: &str) -> Result<Color> {
    let hex = text.strip_prefix('#').filter(|h| h.len() == 8).ok_or_else(|| format!("'{}' is not a colour (#AARRGGBB).", text))?;
    let v = u32::from_str_radix(hex, 16).map_err(|_| format!("'{}' is not a colour (#AARRGGBB).", text))?;
    Ok(Color::from_rgba8((v >> 16) as u8, (v >> 8) as u8, v as u8, (v >> 24) as u8))
}

/// A PNG or WebP picture, premultiplied.
fn decode(bytes: &[u8]) -> std::result::Result<Pixmap, String> {
    if bytes.starts_with(b"\x89PNG") {
        return Pixmap::decode_png(bytes).map_err(|e| e.to_string());
    }
    if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        let mut decoder = image_webp::WebPDecoder::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
        let (w, h) = decoder.dimensions();
        let alpha = decoder.has_alpha();
        let mut data = vec![0u8; decoder.output_buffer_size().ok_or("too large")?];
        decoder.read_image(&mut data).map_err(|e| e.to_string())?;
        let rgba: Vec<u8> = if alpha { data } else { data.chunks(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect() };
        let mut pixmap = Pixmap::new(w, h).ok_or("empty")?;
        for (pixel, c) in pixmap.pixels_mut().iter_mut().zip(rgba.chunks(4)) {
            *pixel = tiny_skia::ColorU8::from_rgba(c[0], c[1], c[2], c[3]).premultiply();
        }
        return Ok(pixmap);
    }
    Err("it is neither PNG nor WebP".to_string())
}
