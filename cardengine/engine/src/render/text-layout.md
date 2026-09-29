# Text layout

How the core measures and places text on a card. Any implementation of the core follows this, and reproduces the
committed draw lists byte for byte (docs/tcg/tcg-developer-platform.md, "Text looks the same whatever language the
core is written in"). Nothing here comes from a shaping library or the operating system: every number is read from the
font file or the layout, and every position is an integer.

## Units

A position or a length is an integer number of **q**, 1/64 of a layout pixel. A layout number (a box, a padding, a
gap) is `n` pixels, so `64·n` q. A font size `s` is a whole number of pixels.

Rounding is named at each step:

- `round(a / b)`: the nearest integer to the exact quotient, a tie going to the even integer. Computed on integers,
  never through a float.
- `floor(a / b)`: toward minus infinity.

One quantity keeps IEEE 754 binary32 arithmetic, because the layout says it with a fraction and the first cards were
drawn that way: a text box's line height (below).

## The font

A font is a TrueType or OpenType file with TrueType outlines, read by its tables:

- `head`: `unitsPerEm`, called `upem` below.
- `hhea`: `ascender` `A` and `descender` `D` (negative below the baseline), and `numberOfHMetrics`. When both are
  zero, `OS/2`'s `sTypoAscender` and `sTypoDescender` are used, and when those are zero too, `usWinAscent` and
  `−usWinDescent`.
- `hmtx`: each glyph's advance width in font units. A glyph past `numberOfHMetrics` has the last one's.
- `cmap`: the subtable for Unicode's full range (platform 3 encoding 10, or platform 0 encoding 4 or 6, format 12)
  when there is one, else Unicode's basic plane (platform 3 encoding 1, or platform 0, format 4).

**Glyph lookup.** Each Unicode scalar value of the text is one glyph: the `cmap`'s glyph for it, or glyph 0 when it
has none. There are no ligatures, no contextual forms and no reordering, and combining marks are glyphs of their own.

**Kerning.** None yet: the first cards were set without it, and a layout that wants it will say so. When it comes, it
is pair kerning from `GPOS` (pair adjustment, format 1 and 2, the `kern` feature of the default script and language)
or, when a font has no `GPOS`, the `kern` table's format 0, added to the first glyph's advance.

## Measuring

The **advance** of glyph `g` at size `s`, with `u` its advance in font units:

- `text-spacing = exact`: `round(u·s·64 / upem)` q.
- `text-spacing = whole-pixels`: `64 · round(u·s / upem)` q. Each glyph steps by a whole pixel, as FreeType's hinted
  layout set text.

The **width** of a text is the sum of its glyphs' advances. Glyph `i` of a text drawn from `x` is at `x` plus the
advances of glyphs `0…i−1`.

## Placing a line

A line is drawn from a point: left-aligned from `x`, centred with its left at `x − floor(width / 2)`, right-aligned
at `x − width`.

Vertically, a point is the baseline, except where a part centres text on its box's middle line. There the baseline is
`y + round((A + D)·s·32 / upem)` q, halfway between the ascender and descender lines.

`capitals = true` maps each character to its simple uppercase (one character to one character; a character whose
uppercase is several characters, like `ß`, stays as it is).

## Breaking lines

A paragraph's text, in emphasis runs (below), is broken into lines no wider than the box's inner width
`box.width − 2·padding`:

1. Each run is split into words and gaps: a gap is a maximal run of white space (Unicode `White_Space`), a word
   anything between gaps.
2. A gap holding a line break (U+000A) ends the line, whatever else it holds: two line breaks in a row still end one
   line. Any other gap becomes one space in its run's font, unless the line is empty so far.
3. A word is measured in its run's font. When the line isn't empty and `used + width > inner width`, the line's
   trailing spaces are removed and the line ends before the word. A word is never split: one wider than the box
   stands on a line of its own and overflows it.
4. A line that ends at a line break, and the last line, keep their trailing spaces.

## Emphasis

A paragraph's `emphasis` marks spans of its text bold or italic. Each rule is applied in order, over the whole text,
and a later rule overrides an earlier one where they overlap. A paragraph with a rule needs the matching font
(`bold-font`, `italic-font`).

- **`words`**: the game's keywords (`words = keywords`: the `name`, or else the key, of every entry of the Game's
  `keywords` and then of the card's set's), or the listed words. They are tried longest first, and words of the
  same length in the order they are listed. A match starts at a word boundary, is one of the
  words exactly, is followed with `with-number = true` by a space and one or more digits when they are there, and ends
  at a word boundary. A word boundary lies between a word character (a letter, a digit, a mark, a connector like `_`)
  and a character that isn't one, or the text's start or end. With `with-number`, the most digits that end at a
  boundary are taken, then fewer, and then none. Matches don't overlap: the search goes on after each one.
- **`up-to = c`**: a sentence's opening up to and including `c`. A sentence starts the text, follows a line break, or
  follows `". "`. The opening is an ASCII capital letter, then ASCII letters, digits, spaces and commas, then `c`, the
  first `c` reached.
- **`between = 'oc'`**: from `o` to the first `c` after it, both included.

The marked text becomes runs: a run is a maximal span of one style, in the regular, bold or italic font.

## Fitting

- **Label.** One line at `size`. With `smallest`, a text wider than its box is set 1 pixel smaller at a time until
  it fits or reaches `smallest`.
- **Title.** The name at `size`. While it is wider than its box and its size is greater than `smallest`, it is set
  2 pixels smaller; it can end below `smallest` by 1.
- **TextBox.** Every size `s` from `size` down to `smallest` is tried in turn, the first that fits wins, and when
  none fits the last one tried is used. At size `s`, a paragraph is set at `max(s + size-change, its smallest or 0)`,
  and its line height is `trunc(ps × line-height)` pixels, with `ps` and `line-height` binary32 numbers multiplied as
  binary32 and the product truncated toward zero. A paragraph with a `rule-above` that isn't the first laid out adds
  its `rule-gap` above itself. The paragraphs fit when the sum of their rule gaps and lines × line heights is at most
  `box.height − 2·padding-top`. The laid-out paragraphs are centred in the box vertically: the first line's top at
  `box.y + (box.height − total) / 2` (exact in q), and each line's baseline its size below its top.
- A centred paragraph's line is drawn as one text in the font of its first run, centred on the box's middle.
