# The draw list

What the core says a card face looks like: every shape, image and glyph, in the order they are drawn. It is the
contract between the layout (`layout.rs`) and a rasteriser. Any implementation of the core reproduces a face's draw
list byte for byte; a rasteriser may differ from another only in how it antialiases an edge
(docs/tcg/tcg-developer-platform.md, "Text looks the same whatever language the core is written in").

## Format

UTF-8 text, one operation per line, each line ending in `\n`. The first two lines are

```
kardix draw list 1
card <width> <height> bleed <bleed>
```

with the card's trimmed size and its bleed in pixels. Everything after is in **q**, 1/64 of a pixel, measured from the
trimmed card's top-left corner; a card drawn with its bleed is shifted by the bleed. Numbers are decimal integers. A
path is a file of the project, from its folder, with forward slashes.

A **paint** is one of:

- `#AARRGGBB`: a colour, alpha first, in hexadecimal capitals.
- `finish:<path>`: a finish's texture, drawn at its own size from the card's top-left corner, clamped at its edges.
- `texture:<path>`: a frame's texture, scaled to cover the card (the larger of the two scales), centred, the overflow cut
  off. It **replaces** what is under it, alpha included.
- `clear`: makes what it covers fully transparent.

## Operations

- `rect <x> <y> <w> <h> radius <rx> <ry> <paint>[ smooth]`: a rectangle with elliptical corners of radii `rx`, `ry`,
  filled. Without `smooth` its edges are hard: a pixel is painted when its centre is inside the shape. With `smooth`
  they are antialiased.
- `ring <x> <y> <w> <h> radius <rx> <ry> inner <x> <y> <w> <h> radius <rx> <ry> <paint>`: the band between two rounded
  rectangles, the second inside the first, filled with hard edges.
- `stroke <x> <y> <w> <h> radius <rx> <ry> width <w> <paint>`: a rounded rectangle's outline, `width` wide and centred
  on its edge, antialiased.
- `star <x> <y> <w> <h> <paint>`: a five-pointed star in the box, point up, filled with hard edges. Its outer points
  are on the circle of radius `w / 2` about the box's centre, and its inner points at 45% of that radius, the first
  point straight up and the others every 36° counter-clockwise, alternating outer and inner.
- `line <x1> <y1> <x2> <y2> width <w> <paint>`: a straight line with flat ends, `width` wide, hard edges.
- `image <path> <fit> <x> <y> <w> <h>[ radius <r>]`: an image into the box, with bicubic (Catmull-Rom) sampling.
  `cover` scales it to cover the box (the larger scale) and crops the overflow evenly from both sides. `contain` scales
  it to fit inside the box, centred. `stretch` scales it to the box exactly. With a radius, the image is clipped to the
  box's rounded rectangle, with hard edges.
- `image <path> natural <x> <y>`: an image at its own size, its top-left corner at `(x, y)`.
- `tinted <path> <x> <y> <w> <h> <paint>`: an image stretched into the box, painted in the colour wherever it isn't
  transparent, keeping its alpha.
- `text <font> <size> <paint>[ outline <paint> <width>] <glyph>@<x>,<y> ...`: glyphs of a font (a path), at a size in
  pixels, each by its glyph id with its origin on the baseline. The outline, when there is one, is a stroke `width`
  wide with round joins, drawn under all the glyphs of the line before they are filled. Glyphs are antialiased.

A rasteriser composites each operation over what is already drawn (source over), except `texture:` and `clear`,
as above. The card starts transparent.
