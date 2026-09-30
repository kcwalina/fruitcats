//! Laying out a card face from the game's card layout (`#type CardLayout`, core.alex): its frame, then its parts, in the
//! order the layout lists them, as a draw list. Ported from kardix's SkiaSharp renderer (`cardengine/kardix/Renderer.cs`
//! and `Faces.cs`), so the cards it draws keep their sizes, line breaks and places. The text in it follows
//! text-layout.md.

use std::collections::HashMap;

use super::draw::{DrawList, Paint, Rect};
use super::font::Font;
use super::text::{self, Emphasis, Sized, BOLD, ITALIC, REGULAR};
use crate::alex::model::{Model, TypeId, ValueId, ValueKind};
use crate::loader::project::Project;
use crate::loader::queries::is_a;

/// One printed face of a card, in one finish. A back face shows its own fields, and the front's for any its type doesn't
/// declare; a field the card doesn't give comes from its set, when the set gives it as a field of its own.
#[derive(Clone)]
pub struct Face {
    pub document: usize,
    pub key: String,
    pub card: ValueId,
    pub values: ValueId,
    pub is_back: bool,
    pub finish: String,
}

/// A value with the document it was written in, so a path in it resolves against that file, and the key it was found
/// under, which a record shows as.
#[derive(Clone, Default)]
struct Located {
    value: Option<ValueId>,
    owner: Option<usize>,
    key: Option<String>,
    text: Option<String>,
}

impl Located {
    fn of(value: ValueId, owner: usize, key: Option<&str>) -> Located {
        Located { value: Some(value), owner: Some(owner), key: key.map(str::to_string), text: None }
    }

    fn text(text: String) -> Located {
        Located { text: Some(text), ..Default::default() }
    }
}

pub struct Layout<'p> {
    project: &'p Project,
    model: &'p Model,
    owners: Vec<Option<usize>>,
    game: usize,
    layout: usize,
    root: ValueId,
    whole_pixels: bool,
    pub width: i64,
    pub height: i64,
    pub bleed: i64,
    fonts: HashMap<String, Font>,
    /// The frame every card is drawn in, instead of its own (`kardix cards --frame`).
    pub frame_override: Option<String>,
    /// A card's own picture and a frame's texture left see-through (`kardix cards --no-art`).
    pub no_art: bool,
}

type Result<T> = std::result::Result<T, String>;

impl<'p> Layout<'p> {
    /// The game's card layout, with the project's font files.
    pub fn new(project: &'p Project) -> Result<Layout<'p>> {
        let model = &project.compilation.model;
        let owners = owners(project);
        let game_name = project.game.clone().ok_or("The project has no Game.")?;
        let (game, game_doc) = project.document(&game_name).ok_or("The project has no Game.")?;
        let layout_value = model
            .object(game_doc.root)
            .and_then(|o| o.get("card-layout"))
            .map(|p| final_target(model, p.value))
            .filter(|v| model.object(*v).is_some())
            .ok_or("The Game names no card-layout, so the core doesn't know how its cards look.")?;
        let layout = owners[layout_value].ok_or("The card layout is in no document.")?;
        let mut this = Layout {
            project,
            model,
            owners,
            game,
            layout,
            root: layout_value,
            whole_pixels: false,
            width: 750,
            height: 1050,
            bleed: 0,
            fonts: HashMap::new(),
            frame_override: None,
            no_art: false,
        };
        this.whole_pixels = this.word(this.field(layout_value, "text-spacing")).as_deref() == Some("whole-pixels");
        this.width = this.int(this.field(layout_value, "width")).unwrap_or(750);
        this.height = this.int(this.field(layout_value, "height")).unwrap_or(1050);
        this.bleed = this.int(this.field(layout_value, "bleed")).unwrap_or(0);
        for path in this.font_files() {
            if let Some(bytes) = project.asset(&path) {
                this.fonts.insert(path.clone(), Font::read(bytes).map_err(|e| format!("The font {}: {}.", path, e))?);
            }
        }
        Ok(this)
    }

    /// Every font file the layout names, as a path in the project.
    pub fn font_files(&self) -> Vec<String> {
        let mut files = Vec::new();
        if let Some(fonts) = self.field(self.root, "fonts").and_then(|v| self.model.object(v)) {
            for p in &fonts.properties {
                let file = self.scalar(Some(final_target(self.model, p.value)));
                if !file.is_empty() {
                    files.push(join(&self.directory(self.layout), &file));
                }
            }
        }
        files
    }

    // ── the cards ──────────────────────────────────────────────────────────────────────────────

    /// Every face `kardix cards` draws: each card of each set the game lists and each Cards document that isn't a draft,
    /// in each of its finishes, front then back; with `only_set`, that document's, even a set the game doesn't list.
    pub fn faces(&self, only_set: Option<&str>) -> Vec<Face> {
        let mut documents: Vec<usize> = Vec::new();
        let game_root = self.project.compilation.documents[self.game].root;
        if let Some(sets) = self.field(game_root, "sets").and_then(|v| self.array(v)) {
            for set in sets {
                if let Some(owner) = self.owners[final_target(self.model, set)] {
                    if !documents.contains(&owner) {
                        documents.push(owner);
                    }
                }
            }
        }
        for (index, document) in self.project.documents() {
            let record = self.model.object(document.root).and_then(|o| o.record_type);
            let draft = self.field(document.root, "draft").is_some_and(|v| matches!(self.model.values[v].kind, ValueKind::Boolean(true)));
            if is_a(self.project, record, "Cards") && !draft && !documents.contains(&index) {
                documents.push(index);
            }
        }
        if let Some(name) = only_set {
            documents.retain(|d| self.project.compilation.documents[*d].name.as_deref() == Some(name));
            if documents.is_empty() {
                if let Some((index, document)) = self.project.document(name) {
                    let record = self.model.object(document.root).and_then(|o| o.record_type);
                    if is_a(self.project, record, "Set") || is_a(self.project, record, "Cards") {
                        documents.push(index);
                    }
                }
            }
        }

        let mut faces = Vec::new();
        for document in documents {
            let root = self.project.compilation.documents[document].root;
            let Some(cards) = self.field(root, "cards").and_then(|v| self.model.object(v)) else { continue };
            for entry in &cards.properties {
                let card = final_target(self.model, entry.value);
                if self.model.object(card).is_none() {
                    continue;
                }
                for finish in self.finishes(card) {
                    let front = Face { document, key: entry.name.clone(), card, values: card, is_back: false, finish: finish.clone() };
                    faces.push(front.clone());
                    if let Some(back) = self.field(card, "back").map(|v| final_target(self.model, v)).filter(|v| self.model.object(*v).is_some()) {
                        faces.push(Face { values: back, is_back: true, ..front });
                    }
                }
            }
        }
        faces
    }

    /// The finishes a card is printed in: its list, or `standard`.
    fn finishes(&self, card: ValueId) -> Vec<String> {
        let list: Vec<String> = self
            .field(card, "finishes")
            .and_then(|v| self.array(v))
            .map(|items| items.into_iter().map(|i| self.scalar(Some(i))).collect())
            .unwrap_or_default();
        if list.is_empty() { vec!["standard".to_string()] } else { list }
    }

    /// A face's file name: the layout's `file-names` entry for its type, or its number, or its key.
    pub fn file_name(&self, face: &Face) -> String {
        if let Some(names) = self.field(self.root, "file-names") {
            if let Some(template) = self.by_type(face, names) {
                return self.template(face, Some(template));
            }
        }
        let number = self.text(face, "number");
        if number.is_empty() { face.key.clone() } else { number }
    }

    /// A face's collector number, or nothing.
    pub fn collector_number(&self, face: &Face) -> String {
        self.text(face, "number")
    }

    pub fn document_name(&self, face: &Face) -> String {
        self.project.compilation.documents[face.document].name.clone().unwrap_or_default()
    }

    // ── drawing ────────────────────────────────────────────────────────────────────────────────

    pub fn draw(&self, face: &Face) -> Result<String> {
        let mut list = DrawList::new(self.width, self.height, self.bleed);
        let frame = self.frame(face)?;
        let parts: Vec<ValueId> = self
            .field(self.root, "parts")
            .and_then(|v| self.model.object(v))
            .map(|o| o.properties.iter().map(|p| final_target(self.model, p.value)).collect())
            .ok_or("The card layout has no parts.")?;
        for &part in &parts {
            if self.bool(part, "under-frame") {
                self.part(&mut list, face, frame, part)?;
            }
        }
        if let Some(frame) = frame {
            if let Some(path) = self.asset_path(face, self.field(frame, "image")) {
                list.image_at(&path, -64 * self.bleed, -64 * self.bleed);
            }
        }
        for &part in &parts {
            if !self.bool(part, "under-frame") {
                self.part(&mut list, face, frame, part)?;
            }
        }
        Ok(list.finish())
    }

    /// The frame for a face: the one named by `--frame` or the card's `frame` field, or else its type's, or its nearest
    /// base type's.
    fn frame(&self, face: &Face) -> Result<Option<ValueId>> {
        let Some(frames) = self.field(self.root, "frames") else { return Ok(None) };
        let named = self.frame_override.clone().unwrap_or_else(|| self.text(face, "frame"));
        if !named.is_empty() {
            return self
                .entry(frames, &named)
                .filter(|v| self.model.object(*v).is_some())
                .map(Some)
                .ok_or_else(|| format!("{}: the card layout has no frame named {}.", face.key, named));
        }
        Ok(self.by_type(face, frames).filter(|v| self.model.object(*v).is_some()))
    }

    fn by_type(&self, face: &Face, map: ValueId) -> Option<ValueId> {
        self.type_chain(face).iter().find_map(|t| self.entry(map, t))
    }

    fn part(&self, list: &mut DrawList, face: &Face, frame: Option<ValueId>, part: ValueId) -> Result<()> {
        if let Some(keyword) = self.field(part, "if-keyword") {
            if let ValueKind::Reference { path, .. } = &self.model.values[keyword].kind {
                if !self.has_keyword(face, path.last().map(String::as_str).unwrap_or("")) {
                    return Ok(());
                }
            }
        }
        if let Some(types) = self.field(part, "only-types").and_then(|v| self.array(v)) {
            if !types.is_empty() {
                let chain = self.type_chain(face);
                let named: Vec<String> = types
                    .iter()
                    .filter_map(|t| match self.model.values[*t].kind {
                        ValueKind::TypeValue(id) => Some(self.model.record_name(id).to_string()),
                        _ => None,
                    })
                    .collect();
                if !named.iter().any(|n| chain.contains(n)) {
                    return Ok(());
                }
            }
        }
        if self.bool(part, "only-with-finish") && face.finish == "standard" {
            return Ok(());
        }
        if self.bool(part, "only-without-finish") && face.finish != "standard" {
            return Ok(());
        }
        if self.bool(part, "only-with-frame-texture") && !self.has_frame_texture(face, frame) {
            return Ok(());
        }
        if let Some(shown) = self.field(part, "if") {
            if self.template(face, Some(shown)).is_empty() {
                return Ok(());
            }
        }
        if let Some(hidden) = self.field(part, "unless") {
            if !self.template(face, Some(hidden)).is_empty() {
                return Ok(());
            }
        }
        let kind = self.model.object(part).and_then(|o| o.type_name.clone()).unwrap_or_default();
        match kind.as_str() {
            "Figure" => self.figure(list, face, frame, part),
            "Picture" => self.picture(list, face, part),
            "Label" => self.label(list, face, frame, part, self.rect(part)),
            "Title" => self.title(list, face, frame, part),
            "Row" => self.row(list, face, frame, part),
            "TextBox" => self.text_box(list, face, frame, part),
            "Chip" => self.chip(list, face, frame, part),
            "Icon" => {
                let r = self.rect(part);
                self.icon(list, face, part, r)
            }
            other => Err(format!("card-layout.alex: the core doesn't know how to draw a {}.", other)),
        }
    }

    fn figure(&self, list: &mut DrawList, face: &Face, frame: Option<ValueId>, part: ValueId) -> Result<()> {
        let r = self.rect(part);
        let kind = self.word(self.field(part, "kind")).unwrap_or_else(|| "rounded-rect".to_string());
        let radius = 64 * self.number(part, "radius", 0);
        let finish = if self.bool(part, "chrome") { self.finish_texture(face) } else { None };
        let has_outline = self.field(part, "outline").is_some();
        let texture = if self.bool(part, "frame-texture") { self.frame_texture(face, frame) } else { None };
        let chrome = finish.is_some() || texture.is_some();
        let outline_width = 64 * self.number(part, "outline-width", 1);

        if kind == "star" {
            let fill = self.color(face, frame, self.field(part, "fill"), 0xFF000000);
            list.star(r, &Paint::Color(fill));
            return Ok(());
        }
        let radii = |r: Rect, radius: i64| if kind == "circle" { (r.w / 2, r.h / 2) } else { (radius, radius) };

        if let Some(fill) = self.field(part, "fill") {
            let paint = match (&finish, &texture) {
                (Some(f), _) if !has_outline => f.clone(),
                (_, Some(t)) => t.clone(),
                _ => Paint::Color(self.color(face, frame, Some(fill), 0xFF000000)),
            };
            let (rx, ry) = radii(r, radius);
            list.rect(r, rx, ry, &paint, false);
        }
        if has_outline {
            let width = if chrome { 64 * self.number(part, "chrome-width", self.number(part, "outline-width", 1)) } else { outline_width };
            let paint = match (&finish, &texture) {
                (Some(f), _) => f.clone(),
                (_, Some(t)) => t.clone(),
                _ => Paint::Color(self.color(face, frame, self.field(part, "outline"), 0xFF000000)),
            };
            let inner = Rect { x: r.x + width, y: r.y + width, w: r.w - 2 * width, h: r.h - 2 * width };
            list.ring(r, radii(r, radius), inner, radii(inner, (radius - width).max(0)), &paint);
        }
        Ok(())
    }

    fn has_frame_texture(&self, face: &Face, frame: Option<ValueId>) -> bool {
        match frame.and_then(|f| self.field(f, "texture")) {
            Some(texture) => self.no_art || self.asset_path(face, Some(texture)).is_some(),
            None => false,
        }
    }

    fn frame_texture(&self, face: &Face, frame: Option<ValueId>) -> Option<Paint> {
        if !self.has_frame_texture(face, frame) {
            return None;
        }
        if self.no_art {
            return Some(Paint::Clear);
        }
        self.asset_path(face, frame.and_then(|f| self.field(f, "texture"))).map(Paint::Texture)
    }

    fn finish_texture(&self, face: &Face) -> Option<Paint> {
        if face.finish == "standard" {
            return None;
        }
        let finish = self.field(self.root, "finishes").and_then(|f| self.entry(f, &face.finish))?;
        let file = self.scalar(self.field(finish, "texture"));
        Some(Paint::Finish(join(&self.directory(self.layout), &file)))
    }

    fn picture(&self, list: &mut DrawList, face: &Face, part: ValueId) -> Result<()> {
        let r = self.rect(part);
        let corner = 64 * self.number(part, "corner-radius", 0);
        let show = self.field(part, "show");
        if self.no_art {
            if let Some(ValueKind::String(s) | ValueKind::Text(s)) = show.map(|v| &self.model.values[v].kind) {
                if s.trim_start().starts_with('{') {
                    list.rect(r, corner, corner, &Paint::Clear, false);
                    return Ok(());
                }
            }
        }
        let Some(path) = self.asset_path(face, show) else { return Ok(()) };
        let fit = if self.word(self.field(part, "fit")).as_deref() == Some("contain") { "contain" } else { "cover" };
        list.image(&path, fit, r, corner);
        Ok(())
    }

    fn icon(&self, list: &mut DrawList, face: &Face, part: ValueId, r: Rect) -> Result<()> {
        let key = self.template(face, self.field(part, "show"));
        if key.is_empty() {
            return Ok(());
        }
        let Some(file) = self.field(part, "images").and_then(|m| self.entry(m, &key)) else { return Ok(()) };
        let file = self.scalar(Some(file));
        list.image(&join(&self.directory(self.layout), &file), "stretch", r, 0);
        Ok(())
    }

    fn label(&self, list: &mut DrawList, face: &Face, frame: Option<ValueId>, part: ValueId, r: Rect) -> Result<()> {
        let mut shown = self.template(face, self.field(part, "show"));
        if shown.is_empty() {
            return Ok(());
        }
        if self.bool(part, "capitals") {
            shown = text::capitals(&shown);
        }
        let size = self.need(part, "size")?;
        let smallest = self.int(self.field(part, "smallest")).unwrap_or(size);
        let mut font = self.font(part, "font", size)?;
        while font.size > smallest && font.width(&shown) > r.w {
            font = font.with_size(font.size - 1);
        }
        let align = self.word(self.field(part, "align")).unwrap_or_else(|| "left".to_string());
        let x = match align.as_str() {
            "center" => r.x + r.w / 2,
            "right" => r.x + r.w,
            _ => r.x,
        };
        let color = self.color(face, frame, self.field(part, "color"), 0xFF000000);
        let outline = self.color(face, frame, self.field(part, "outline"), 0);
        let outline_width = 64 * self.number(part, "outline-width", 1);
        draw_text(list, &shown, &font, x, r.y + r.h / 2, &align, true, color, outline, outline_width);
        Ok(())
    }

    fn title(&self, list: &mut DrawList, face: &Face, frame: Option<ValueId>, part: ValueId) -> Result<()> {
        let name = self.template(face, self.field(part, "show"));
        if name.is_empty() {
            return Ok(());
        }
        let subtitle = self.template(face, self.field(part, "subtitle"));
        let r = self.rect(part);
        let size = self.need(part, "size")?;
        let smallest = self.int(self.field(part, "smallest")).unwrap_or(size);
        let mut font = self.font(part, "font", size)?;
        while font.width(&name) > r.w && font.size > smallest {
            font = font.with_size(font.size - 2);
        }
        let color = self.color(face, frame, self.field(part, "color"), 0xFFFFFFFF);
        let outline = self.color(face, frame, self.field(part, "outline"), 0);
        let outline_width = 64 * self.number(part, "outline-width", 1);
        if subtitle.is_empty() {
            draw_text(list, &name, &font, r.x, r.y + r.h / 2, "left", true, color, outline, outline_width);
            return Ok(());
        }
        let baseline = 64 * self.need(part, "baseline")?;
        draw_text(list, &name, &font, r.x, r.y + baseline, "left", false, color, outline, outline_width);
        let sub = self.font(part, "subtitle-font", self.need(part, "subtitle-size")?)?;
        let indent = 64 * self.number(part, "subtitle-indent", 0);
        let sub_baseline = 64 * self.need(part, "subtitle-baseline")?;
        draw_text(list, &subtitle, &sub, r.x + indent, r.y + sub_baseline, "left", false, color, 0, 0);
        Ok(())
    }

    fn row(&self, list: &mut DrawList, face: &Face, frame: Option<ValueId>, part: ValueId) -> Result<()> {
        let r = self.rect(part);
        let mut right = r.x + r.w;
        let middle = r.y + r.h / 2;
        let Some(items) = self.field(part, "items").and_then(|v| self.array(v)) else { return Ok(()) };
        for item in items {
            let item = final_target(self.model, item);
            let kind = self.model.object(item).and_then(|o| o.type_name.clone()).unwrap_or_default();
            let width;
            if kind == "Icon" {
                let key = self.template(face, self.field(item, "show"));
                if key.is_empty() || self.field(item, "images").and_then(|m| self.entry(m, &key)).is_none() {
                    continue;
                }
                let (w, h) = (64 * self.need(item, "width")?, 64 * self.need(item, "height")?);
                let left = 64 * text::round_div(right - w, 64);
                let top = 64 * text::round_div(middle - h / 2, 64);
                self.icon(list, face, item, Rect { x: left, y: top, w, h })?;
                width = right - left;
            } else {
                let shown = self.template(face, self.field(item, "show"));
                if shown.is_empty() {
                    continue;
                }
                let font = self.font(item, "font", self.need(item, "size")?)?;
                let color = self.color(face, frame, self.field(item, "color"), 0xFF000000);
                draw_text(list, &shown, &font, right, middle, "right", true, color, 0, 0);
                width = font.width(&shown);
            }
            right -= width + 64 * self.number(item, "gap", 0);
        }
        Ok(())
    }

    fn chip(&self, list: &mut DrawList, face: &Face, frame: Option<ValueId>, part: ValueId) -> Result<()> {
        let shown = self.template(face, self.field(part, "show"));
        if shown.is_empty() {
            return Ok(());
        }
        let r = self.rect(part);
        let font = self.font(part, "font", self.need(part, "size")?)?;
        let pad = 64 * self.number(part, "padding", 0);
        let icon_size = self.int(self.field(part, "icon-size")).map(|n| 64 * n).unwrap_or(r.h);
        let gap = 64 * self.number(part, "gap", 0);
        let width = 64 * text::round_div(pad + icon_size + gap + font.width(&shown) + pad + 128, 64);
        let x0 = if self.word(self.field(part, "align")).as_deref() == Some("right") { r.x + r.w - width } else { r.x };
        let h = r.h;
        let fill = self.color(face, frame, self.field(part, "fill"), 0xFFFFFFFF);
        list.rect(Rect { x: x0, y: r.y, w: width, h }, h / 2, h / 2, &Paint::Color(fill), true);
        let stroke = 64 * self.number(part, "outline-width", 1);
        let outline = self.color(face, frame, self.field(part, "outline"), 0xFF000000);
        let ring = Rect { x: x0 + stroke / 2, y: r.y + stroke / 2, w: width - stroke, h: h - stroke };
        list.stroke(ring, ring.h / 2, ring.h / 2, stroke, &Paint::Color(outline));
        if let Some(icon) = self.field(part, "icon").filter(|v| self.model.is_textual(*v)) {
            let path = join(&self.directory(self.layout), &self.scalar(Some(icon)));
            let tint = self.color(face, frame, self.field(part, "icon-color"), 0xFF000000);
            let top = r.y + 64 * (h - icon_size).div_euclid(128);
            list.tinted(&path, Rect { x: x0 + pad, y: top, w: icon_size, h: icon_size }, &Paint::Color(tint));
        }
        let color = self.color(face, frame, self.field(part, "color"), 0xFF000000);
        let offset = 64 * self.number(part, "text-offset", 0);
        draw_text(list, &shown, &font, x0 + pad + icon_size + gap, r.y + h / 2 + offset, "left", true, color, 0, 0);
        Ok(())
    }

    fn text_box(&self, list: &mut DrawList, face: &Face, frame: Option<ValueId>, part: ValueId) -> Result<()> {
        let r = self.rect(part);
        let padding = 64 * self.number(part, "padding", 0);
        let padding_top = self.int(self.field(part, "padding-top")).map(|n| 64 * n).unwrap_or(padding);
        let line_height = match self.field(part, "line-height").map(|v| &self.model.values[v].kind) {
            Some(ValueKind::Float(f)) => *f as f32,
            Some(ValueKind::Integer(i)) => *i as f32,
            _ => 1.2f32,
        };
        let largest = self.need(part, "size")?;
        let smallest = self.int(self.field(part, "smallest")).unwrap_or(largest);
        let inner = r.w - 2 * padding;
        let box_color = self.color(face, frame, self.field(part, "color"), 0xFF000000);

        let mut paragraphs: Vec<(ValueId, String)> = Vec::new();
        if let Some(list) = self.field(part, "paragraphs").and_then(|v| self.array(v)) {
            for p in list {
                let p = final_target(self.model, p);
                let shown = self.template(face, self.field(p, "show"));
                if !shown.is_empty() {
                    paragraphs.push((p, shown));
                }
            }
        }
        if paragraphs.is_empty() {
            return Ok(());
        }

        struct Laid<'f> {
            paragraph: ValueId,
            lines: Vec<Vec<(String, u8)>>,
            fonts: [Option<Sized<'f>>; 3],
            size: i64,
            line_height: i64,
            rule: i64,
        }
        let mut laid: Vec<Laid> = Vec::new();
        let mut total = 0;
        let mut size = largest;
        while size >= smallest {
            laid.clear();
            total = 0;
            for (p, shown) in &paragraphs {
                let psize = (size + self.number(*p, "size-change", 0)).max(self.int(self.field(*p, "smallest")).unwrap_or(0));
                let regular = if self.field(*p, "font").is_some() { self.font(*p, "font", psize)? } else { self.font(part, "font", psize)? };
                let bold = if self.field(*p, "bold-font").is_some() { Some(self.font(*p, "bold-font", psize)?) } else { None };
                let italic = if self.field(*p, "italic-font").is_some() { Some(self.font(*p, "italic-font", psize)?) } else { None };
                let fonts = [Some(regular), bold, italic];
                let rules = self.emphasis(face, *p, &fonts)?;
                let marks = text::marks(shown, &rules);
                let runs = text::runs(shown, &marks);
                let lines = text::wrap(&runs, inner, &|piece, style| fonts[style as usize].unwrap_or(regular).width(piece));
                let rule = if !laid.is_empty() && !lines.is_empty() && self.field(*p, "rule-above").is_some() {
                    64 * self.number(*p, "rule-gap", 0)
                } else {
                    0
                };
                let lh = 64 * ((psize as f32) * line_height) as i64;
                total += rule + lines.len() as i64 * lh;
                laid.push(Laid { paragraph: *p, lines, fonts, size: psize, line_height: lh, rule });
            }
            if total <= r.h - 2 * padding_top {
                break;
            }
            size -= 1;
        }

        let mut y = r.y + (r.h - total) / 2;
        for l in &laid {
            if l.rule > 0 {
                let inset = 64 * self.number(l.paragraph, "rule-inset", 0);
                let rule_y = y + 64 * self.number(l.paragraph, "rule-offset", 0);
                let width = 64 * self.number(l.paragraph, "rule-width", 1);
                let color = self.color(face, frame, self.field(l.paragraph, "rule-above"), 0xFF808080);
                list.line(r.x + inset, rule_y, r.x + r.w - inset, rule_y, width, &Paint::Color(color));
                y += l.rule;
            }
            let color = self.color(face, frame, self.field(l.paragraph, "color"), box_color);
            let centre = self.word(self.field(l.paragraph, "align")).as_deref() == Some("center");
            let regular = l.fonts[REGULAR as usize].unwrap();
            for line in &l.lines {
                let baseline = y + 64 * l.size;
                if centre {
                    let words: String = line.iter().map(|(p, _)| p.as_str()).collect();
                    let font = line.first().map(|(_, s)| l.fonts[*s as usize].unwrap_or(regular)).unwrap_or(regular);
                    draw_text(list, &words, &font, r.x + r.w / 2, baseline, "center", false, color, 0, 0);
                } else {
                    let mut x = r.x + padding;
                    for (piece, style) in line {
                        let font = l.fonts[*style as usize].unwrap_or(regular);
                        draw_text(list, piece, &font, x, baseline, "left", false, color, 0, 0);
                        x += font.width(piece);
                    }
                }
                y += l.line_height;
            }
        }
        Ok(())
    }

    /// A paragraph's emphasis rules.
    fn emphasis(&self, face: &Face, paragraph: ValueId, fonts: &[Option<Sized>; 3]) -> Result<Vec<Emphasis>> {
        let mut rules = Vec::new();
        let Some(list) = self.field(paragraph, "emphasis").and_then(|v| self.array(v)) else { return Ok(rules) };
        for rule in list {
            let rule = final_target(self.model, rule);
            let Some(object) = self.model.object(rule) else { continue };
            let italic = object.type_name.as_deref() == Some("Italic");
            let style = if italic { ITALIC } else { BOLD };
            if fonts[style as usize].is_none() {
                return Err(format!(
                    "card-layout.alex: a paragraph with {} emphasis needs a {}.",
                    if italic { "Italic" } else { "Bold" },
                    if italic { "italic-font" } else { "bold-font" }
                ));
            }
            if let Some(words) = self.field(rule, "words") {
                let words = match self.array(words) {
                    Some(items) => items.into_iter().map(|i| self.scalar(Some(i))).collect(),
                    None => self.keywords(face),
                };
                rules.push(Emphasis::Words { style, words, with_number: self.bool(rule, "with-number") });
            } else if let Some(end) = self.field(rule, "up-to").map(|v| self.scalar(Some(v))).filter(|s| s.chars().count() == 1) {
                rules.push(Emphasis::UpTo { style, end: end.chars().next().unwrap() });
            } else if let Some(pair) = self.field(rule, "between").map(|v| self.scalar(Some(v))).filter(|s| s.chars().count() == 2) {
                let mut chars = pair.chars();
                rules.push(Emphasis::Between { style, open: chars.next().unwrap(), close: chars.next().unwrap() });
            }
        }
        Ok(rules)
    }

    /// The words `words = keywords` means: the game's keywords and the card's set's.
    fn keywords(&self, face: &Face) -> Vec<String> {
        let mut words = Vec::new();
        for document in [self.game, face.document] {
            let root = self.project.compilation.documents[document].root;
            if let Some(keywords) = self.field(root, "keywords").and_then(|v| self.model.object(v)) {
                for k in &keywords.properties {
                    let value = final_target(self.model, k.value);
                    let name = self.field(value, "name").filter(|v| self.model.is_textual(*v)).map(|v| self.scalar(Some(v)));
                    words.push(name.unwrap_or_else(|| k.name.clone()));
                }
            }
        }
        words
    }

    fn has_keyword(&self, face: &Face, keyword: &str) -> bool {
        let Some(list) = self.face_field(face, "keywords").value.and_then(|v| self.array(v)) else { return false };
        list.into_iter().any(|item| {
            let value = self.field(item, "keyword").unwrap_or(item);
            matches!(&self.model.values[value].kind, ValueKind::Reference { path, .. } if path.last().map(String::as_str) == Some(keyword))
        })
    }

    // ── a face's data ──────────────────────────────────────────────────────────────────────────

    /// A face's type, then its bases, by name.
    fn type_chain(&self, face: &Face) -> Vec<String> {
        let mut chain = Vec::new();
        let object = self.model.object(face.values);
        let mut current: Option<TypeId> = object.and_then(|o| o.record_type);
        while let Some(t) = current {
            let Some(record) = self.model.record(t) else { break };
            chain.push(record.name.clone());
            current = record.base;
        }
        if chain.is_empty() {
            chain.push(object.and_then(|o| o.type_name.clone()).unwrap_or_else(|| "Card".to_string()));
        }
        chain
    }

    /// A field of a face: its own value, its type's, the front's for a field a back doesn't have, or its set's. A back
    /// with only a library's default for a field the front's game type declares and its own doesn't prints the
    /// front's: a Hero's back shows the Hero's rarity, not the default every card has from the `common` library.
    fn face_field(&self, face: &Face, name: &str) -> Located {
        let own = self.model.object(face.values).and_then(|o| o.get(name));
        let front = self.model.object(face.card).and_then(|o| o.get(name));
        if let Some(p) = own {
            if !p.is_default {
                return Located::of(p.value, face.document, Some(name));
            }
            if face.is_back && self.game_declares(face.card, name) && !self.game_declares(face.values, name) {
                if let Some(f) = front.filter(|f| !f.is_default) {
                    return Located::of(f.value, face.document, Some(name));
                }
            }
            if !self.is_nothing(p.value) {
                return Located::of(p.value, self.game, Some(name));
            }
        }
        if face.is_back && own.is_none() {
            if let Some(p) = front {
                if !p.is_default {
                    return Located::of(p.value, face.document, Some(name));
                }
                if !self.is_nothing(p.value) {
                    return Located::of(p.value, self.game, Some(name));
                }
            }
        }
        if let Some(value) = self.set_wide(face.document, name) {
            return Located::of(value, face.document, Some(name));
        }
        Located::default()
    }

    /// Whether a value's type, or a type it derives from that the game's own files declare, declares the field.
    fn game_declares(&self, value: ValueId, name: &str) -> bool {
        let mut current = self.model.object(value).and_then(|o| o.record_type);
        while let Some(t) = current {
            let Some(record) = self.model.record(t) else { return false };
            let own = self.project.documents().any(|(_, d)| d.types.iter().any(|(_, declared)| *declared == t));
            if own && record.own_fields.iter().any(|f| self.model.fields[*f].name == name) {
                return true;
            }
            current = record.base;
        }
        false
    }

    /// A field a set gives for all its cards: one the core's `Set` or `Cards` doesn't declare.
    fn set_wide(&self, document: usize, name: &str) -> Option<ValueId> {
        let root = self.project.compilation.documents[document].root;
        let object = self.model.object(root)?;
        let property = object.get(name).filter(|p| !p.is_default)?;
        let mut current = object.record_type;
        while let Some(t) = current {
            let record = self.model.record(t)?;
            if (record.name == "Set" || record.name == "Cards") && record.own_fields.iter().any(|f| self.model.fields[*f].name == name) {
                return None;
            }
            current = record.base;
        }
        Some(property.value)
    }

    /// A dotted path from a face: `cost`, `family.dark`, `set.name`, `type`, `finish`.
    fn path(&self, face: &Face, path: &str) -> Located {
        let parts: Vec<&str> = path.split('.').collect();
        let mut current = match parts[0] {
            "type" => Located::text(self.display_name(face)),
            "finish" => Located::text(face.finish.clone()),
            "set" => Located::of(self.project.compilation.documents[face.document].root, face.document, self.project.compilation.documents[face.document].name.as_deref()),
            first => self.face_field(face, first),
        };
        for part in &parts[1..] {
            let resolved = self.resolve(&current);
            let Some(value) = resolved.value else { return Located::default() };
            if self.model.object(value).is_none() {
                return Located::default();
            }
            match self.field(value, part) {
                Some(next) => current = self.resolve(&Located { value: Some(next), owner: resolved.owner, key: None, text: None }),
                None if *part == "name" && (resolved.key.is_some() || current.key.is_some()) => {
                    current = Located::text(resolved.key.or(current.key).unwrap());
                }
                None => return Located::default(),
            }
        }
        let resolved = self.resolve(&current);
        if resolved.value.is_none() && resolved.text.is_none() {
            return current;
        }
        Located { key: resolved.key.or(current.key), ..resolved }
    }

    /// Follows a reference to the value it names, and the document and key it is under.
    fn resolve(&self, at: &Located) -> Located {
        let Some(mut value) = at.value else { return at.clone() };
        let mut key = at.key.clone();
        let mut owner = at.owner;
        for _ in 0..64 {
            match &self.model.values[value].kind {
                ValueKind::Reference { path, target: Some(target) } => {
                    key = path.last().cloned();
                    value = *target;
                    owner = self.owners[value].or(owner);
                }
                _ => break,
            }
        }
        if key.is_none() || !matches!(self.model.values[at.value.unwrap()].kind, ValueKind::Reference { .. }) {
            key = at.key.clone();
        }
        Located { value: Some(value), owner, key, text: None }
    }

    /// A path as text. A record shows as its key (`{family}` is `domowiki`).
    fn text(&self, face: &Face, path: &str) -> String {
        let found = self.path(face, path);
        if let Some(text) = found.text {
            return text;
        }
        if found.value.is_some_and(|v| self.model.object(v).is_some()) {
            return found.key.unwrap_or_default();
        }
        let text = self.scalar(found.value);
        if path == "text" || path == "flavor" { self.fill_constants(face, &text) } else { text }
    }

    /// A template: `'{type} · {family.name}'`. Empty when every placeholder in it is empty.
    fn template(&self, face: &Face, template: Option<ValueId>) -> String {
        let Some(value) = template.map(|v| final_target(self.model, v)) else { return String::new() };
        let source = match &self.model.values[value].kind {
            ValueKind::String(s) | ValueKind::Text(s) => s.clone(),
            _ => return self.scalar(Some(value)),
        };
        let mut placeholders = false;
        let mut any = false;
        let result = render_template(&source, &mut |path| {
            placeholders = true;
            let value = self.text(face, path);
            any |= !value.is_empty();
            Some(value)
        });
        if placeholders && !any { String::new() } else { result }
    }

    /// The card's own `{name}` constants filled into its text.
    fn fill_constants(&self, face: &Face, text: &str) -> String {
        if !text.contains('{') {
            return text.to_string();
        }
        let Some(constants) = self.face_field(face, "constants").value.map(|v| final_target(self.model, v)).filter(|v| self.model.object(*v).is_some()) else {
            return text.to_string();
        };
        let chars: Vec<char> = text.chars().collect();
        let mut out = String::new();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] == '{' {
                if let Some(offset) = chars[i + 1..].iter().position(|c| *c == '}') {
                    let close = i + 1 + offset;
                    if close > i + 1 {
                        let name: String = chars[i + 1..close].iter().collect();
                        if name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '.' || c == '_') {
                            if let Some(value) = self.field(constants, &name) {
                                out.push_str(&self.scalar(Some(value)));
                                i = close + 1;
                                continue;
                            }
                        }
                    }
                }
            }
            out.push(chars[i]);
            i += 1;
        }
        out
    }

    /// The asset a template names, as a path in the project: relative to the file the value was written in, for a
    /// template that is one placeholder (`'{art}'`), or else to the layout.
    fn asset_path(&self, face: &Face, template: Option<ValueId>) -> Option<String> {
        let value = final_target(self.model, template?);
        let raw = match &self.model.values[value].kind {
            ValueKind::String(s) | ValueKind::Text(s) => s.trim().to_string(),
            _ => return None,
        };
        if raw.starts_with('{') && raw.ends_with('}') && raw.find('}') == Some(raw.len() - 1) {
            let found = self.path(face, &raw[1..raw.len() - 1]);
            let text = found.text.clone().unwrap_or_else(|| self.scalar(found.value));
            if text.is_empty() {
                return None;
            }
            return Some(join(&self.directory(found.owner.unwrap_or(face.document)), &text));
        }
        let text = self.template(face, Some(value));
        if text.is_empty() { None } else { Some(join(&self.directory(self.layout), &text)) }
    }

    fn display_name(&self, face: &Face) -> String {
        if let Some(name) = self.field(face.values, "type-name").filter(|v| self.model.is_textual(*v)) {
            return self.scalar(Some(name));
        }
        self.type_chain(face).into_iter().next().unwrap_or_default()
    }

    /// A colour: a template (`'{family.dark}'`), `ink`, `accent` or `tint` from the frame, or `finish-ink` from the
    /// card's finish; `fallback` for none, or for text that isn't a colour.
    fn color(&self, face: &Face, frame: Option<ValueId>, value: Option<ValueId>, fallback: u32) -> u32 {
        let Some(value) = value.map(|v| final_target(self.model, v)) else { return fallback };
        let text = if self.model.is_textual(value) { self.template(face, Some(value)) } else { self.scalar(Some(value)) };
        match text.as_str() {
            "ink" | "accent" | "tint" => match frame.and_then(|f| self.field(f, &text)) {
                Some(color) => self.color(face, None, Some(color), fallback),
                None => fallback,
            },
            "finish-ink" => match self.field(self.root, "finishes").and_then(|f| self.entry(f, &face.finish)) {
                Some(finish) => self.color(face, None, self.field(finish, "ink"), fallback),
                None => fallback,
            },
            _ => parse_color(&text).unwrap_or(fallback),
        }
    }

    fn font(&self, part: ValueId, field: &str, size: i64) -> Result<Sized<'_>> {
        let value = self.field(part, field).ok_or_else(|| format!("card-layout.alex: a part has no {}.", field))?;
        let target = final_target(self.model, value);
        let file = self.scalar(Some(target));
        if file.is_empty() {
            return Err(format!("card-layout.alex: a part has no {}.", field));
        }
        let owner = self.owners[target].unwrap_or(self.layout);
        let path = join(&self.directory(owner), &file);
        let (key, font) = self.fonts.get_key_value(&path).ok_or_else(|| format!("The font {} is not in the project.", path))?;
        Ok(Sized { font, file: key, size, whole_pixels: self.whole_pixels })
    }

    // ── reading values ─────────────────────────────────────────────────────────────────────────

    /// A field's value, references followed; none for a field that is absent or nothing.
    fn field(&self, object: ValueId, name: &str) -> Option<ValueId> {
        let value = self.model.object(object)?.get(name)?.value;
        if self.is_nothing(value) { None } else { Some(value) }
    }

    /// A map's entry, references followed.
    fn entry(&self, map: ValueId, key: &str) -> Option<ValueId> {
        let value = final_target(self.model, self.model.object(map)?.get(key)?.value);
        if self.is_nothing(value) { None } else { Some(value) }
    }

    fn is_nothing(&self, value: ValueId) -> bool {
        matches!(self.model.values[final_target(self.model, value)].kind, ValueKind::Nic | ValueKind::Invalid)
    }

    fn array(&self, value: ValueId) -> Option<Vec<ValueId>> {
        match &self.model.values[final_target(self.model, value)].kind {
            ValueKind::Array(items) => Some(items.clone()),
            ValueKind::Empty => Some(Vec::new()),
            _ => None,
        }
    }

    fn scalar(&self, value: Option<ValueId>) -> String {
        let Some(value) = value else { return String::new() };
        match &self.model.values[value].kind {
            ValueKind::Nic | ValueKind::Invalid | ValueKind::Empty => String::new(),
            ValueKind::String(s) | ValueKind::Text(s) => s.clone(),
            ValueKind::Integer(i) => i.to_string(),
            ValueKind::Float(f) => f.to_string(),
            ValueKind::Boolean(b) => b.to_string(),
            ValueKind::Enum { member, .. } => member.clone(),
            ValueKind::Reference { path, target } => match target {
                Some(t) => self.scalar(Some(*t)),
                None => path.join("."),
            },
            ValueKind::TypeValue(t) => self.model.record_name(*t).to_string(),
            ValueKind::Array(items) => items.iter().map(|i| self.scalar(Some(*i))).collect::<Vec<_>>().join(", "),
            ValueKind::Declaration(_) | ValueKind::Object(_) | ValueKind::Formula { .. } => String::new(),
        }
    }

    fn word(&self, value: Option<ValueId>) -> Option<String> {
        value.map(|v| self.scalar(Some(final_target(self.model, v))))
    }

    fn int(&self, value: Option<ValueId>) -> Option<i64> {
        match value.map(|v| &self.model.values[final_target(self.model, v)].kind) {
            Some(ValueKind::Integer(i)) => Some(*i),
            Some(ValueKind::Float(f)) => Some(*f as f32 as i64),
            _ => None,
        }
    }

    fn number(&self, object: ValueId, field: &str, fallback: i64) -> i64 {
        self.int(self.field(object, field)).unwrap_or(fallback)
    }

    fn need(&self, part: ValueId, field: &str) -> Result<i64> {
        self.int(self.field(part, field)).ok_or_else(|| {
            let kind = self.model.object(part).and_then(|o| o.type_name.clone()).unwrap_or_default();
            format!("card-layout.alex: a {} needs {}.", kind, field)
        })
    }

    fn bool(&self, object: ValueId, field: &str) -> bool {
        self.field(object, field).is_some_and(|v| matches!(self.model.values[v].kind, ValueKind::Boolean(true)))
    }

    fn rect(&self, part: ValueId) -> Rect {
        match self.field(part, "box") {
            Some(b) => Rect::px(self.number(b, "x", 0), self.number(b, "y", 0), self.number(b, "width", 0), self.number(b, "height", 0)),
            None => Rect { x: 0, y: 0, w: 0, h: 0 },
        }
    }

    /// The folder a document is in, within the project.
    fn directory(&self, document: usize) -> String {
        let path = &self.project.paths[document];
        match path.rfind('/') {
            Some(slash) => path[..slash].to_string(),
            None => String::new(),
        }
    }
}

/// Draws a line of text from a point: left, centred on, or right of `x`; `y` its baseline, or with `middle`, the line
/// halfway between its ascender and descender.
#[allow(clippy::too_many_arguments)]
fn draw_text(list: &mut DrawList, shown: &str, font: &Sized, x: i64, y: i64, align: &str, middle: bool, color: u32, outline: u32, outline_width: i64) {
    let width = font.width(shown);
    let left = match align {
        "center" => x - width.div_euclid(2),
        "right" => x - width,
        _ => x,
    };
    let baseline = if middle { y + font.middle_to_baseline() } else { y };
    let glyphs = font.glyphs(shown, left, baseline);
    let stroke = Paint::Color(outline);
    let outline = if outline != 0 && outline_width > 0 { Some((&stroke, 2 * outline_width)) } else { None };
    list.text(font.file, font.size, &Paint::Color(color), outline, &glyphs);
}

/// `#RGB`, `#ARGB`, `#RRGGBB` or `#AARRGGBB`, as 0xAARRGGBB.
fn parse_color(text: &str) -> Option<u32> {
    let hex = text.trim().trim_start_matches('#');
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let expand = |s: &str| -> String { s.chars().flat_map(|c| [c, c]).collect() };
    let full = match hex.len() {
        3 => format!("FF{}", expand(hex)),
        4 => expand(hex),
        6 => format!("FF{}", hex),
        8 => hex.to_string(),
        _ => return None,
    };
    u32::from_str_radix(&full, 16).ok()
}

/// The template `{name}` rendering kardix's cards used (C# Alex's `AlexTextual.Render`): a placeholder is a dotted name;
/// `{{` and `}}` are braces; a placeholder alone on its line that renders empty takes the line with it.
fn render_template(value: &str, resolve: &mut dyn FnMut(&str) -> Option<String>) -> String {
    let chars: Vec<char> = value.chars().collect();
    let mut result = String::new();
    let mut literal_start = 0;
    let mut i = 0;
    let slice = |from: usize, to: usize| -> String { chars[from..to].iter().collect() };
    while i < chars.len() {
        if chars[i] == '}' && i + 1 < chars.len() && chars[i + 1] == '}' {
            result.push_str(&slice(literal_start, i));
            result.push('}');
            i += 1;
            literal_start = i + 1;
            i += 1;
            continue;
        }
        if chars[i] != '{' {
            i += 1;
            continue;
        }
        if i + 1 < chars.len() && chars[i + 1] == '{' {
            result.push_str(&slice(literal_start, i));
            result.push('{');
            i += 1;
            literal_start = i + 1;
            i += 1;
            continue;
        }
        let Some(close) = chars[i + 1..].iter().position(|c| *c == '}').map(|p| p + i + 1) else {
            i += 1;
            continue;
        };
        let name = slice(i + 1, close);
        if close <= i + 1 || !is_path(&name) {
            i += 1;
            continue;
        }
        let Some(replacement) = resolve(&name) else {
            i = close + 1;
            continue;
        };
        let line_start = if i == 0 { 0 } else { chars[..i].iter().rposition(|c| *c == '\n').map(|p| p + 1).unwrap_or(0) };
        let next_break = chars[close + 1..].iter().position(|c| *c == '\n').map(|p| p + close + 1);
        let line_end = next_break.unwrap_or(chars.len());
        let blank = |from: usize, to: usize| chars[from..to].iter().all(|c| c.is_whitespace());
        let alone = blank(line_start, i) && blank(close + 1, line_end);
        if alone && replacement.is_empty() {
            result.push_str(&slice(literal_start, line_start));
            match next_break {
                Some(b) => {
                    i = b + 1;
                    literal_start = b + 1;
                }
                None => {
                    i = chars.len();
                    literal_start = chars.len();
                }
            }
            continue;
        }
        result.push_str(&slice(literal_start, i));
        result.push_str(&replacement);
        if alone && replacement.ends_with('\n') {
            if let Some(b) = next_break {
                i = b + 1;
                literal_start = b + 1;
                continue;
            }
        }
        i = close + 1;
        literal_start = close + 1;
    }
    result.push_str(&slice(literal_start, chars.len()));
    result
}

fn is_path(path: &str) -> bool {
    let mut at_start = true;
    for c in path.chars() {
        if at_start {
            if c != '_' && !c.is_ascii_alphabetic() {
                return false;
            }
            at_start = false;
            continue;
        }
        if c == '.' {
            at_start = true;
            continue;
        }
        if c != '-' && c != '_' && !c.is_ascii_alphanumeric() {
            return false;
        }
    }
    !at_start && !path.is_empty()
}

fn final_target(model: &Model, value: ValueId) -> ValueId {
    let mut current = value;
    for _ in 0..64 {
        match &model.values[current].kind {
            ValueKind::Reference { target: Some(t), .. } => current = *t,
            _ => break,
        }
    }
    current
}

/// The document each value is written in.
fn owners(project: &Project) -> Vec<Option<usize>> {
    let model = &project.compilation.model;
    let mut owners = vec![None; model.values.len()];
    for (index, document) in project.compilation.documents.iter().enumerate() {
        let mut pending = vec![document.root];
        for (_, text) in &document.texts {
            pending.push(*text);
        }
        while let Some(value) = pending.pop() {
            if owners[value].is_some() {
                continue;
            }
            owners[value] = Some(index);
            match &model.values[value].kind {
                ValueKind::Object(o) => pending.extend(o.properties.iter().map(|p| p.value)),
                ValueKind::Array(items) => pending.extend(items.iter().copied()),
                _ => {}
            }
        }
    }
    owners
}

/// `folder/relative`, with `.` and `..` worked out; a path in the project.
pub fn join(folder: &str, relative: &str) -> String {
    let relative = relative.replace('\\', "/");
    let mut parts: Vec<&str> = if relative.starts_with('/') { Vec::new() } else { folder.split('/').filter(|p| !p.is_empty()).collect() };
    for part in relative.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            p => parts.push(p),
        }
    }
    parts.join("/")
}
