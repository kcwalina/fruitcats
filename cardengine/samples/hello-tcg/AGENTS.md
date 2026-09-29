# Working on this game

This folder is a card game for the TCG developer platform. The game is the Alex files plus the
assets they refer to (images in `art/`). Nothing about the game lives anywhere else.

## Two stages

A game is **printable** when its cards, decks, rulebook and card back are complete: `tcg cards
--print` and `tcg rulebook` make the files to print it. It is **playable** once the engine knows
its rules too. `tcg check` reports both. Don't add rules or handlers to a game the designer only
wants to print, unless they ask.

## The files

- `hello-tcg.alex` (`#type Game`): the game's name, card layout, card back, constants, keywords and
  card types. Once the game is playable, also the libraries it uses, its zones and the rules it
  picks from them.
- `card-layout.alex` (`#type CardLayout`): how printed cards look. Frames per card type, and the
  parts drawn on them: where each piece of a card's data goes (`show = '{cost}'`), in which font.
- `rulebook.alex` (`#type Rulebook`): the text players read.
- `cards.alex` (`#type Cards`): the cards and the decks. Every cards file in the folder is part of
  the game.
- `card-rules.alex` (`#type Rules`, `for = @cards`), once the game is playable: what the cards' text
  does (handlers), and scenarios that test them.
- `art/`: images, referred to by path: card paintings, the card back, and frames in `art/frames/`.
  Frames are 822 × 1122 (750 × 1050 plus 36 px bleed each side) with a transparent art window.
- `fonts/`: font files the card layout uses.

## How to work

- **Numbers are constants.** A number the game uses goes in the game's `constants`; the rulebook
  shows it as `{@starting-life}` and rules take it as `@starting-life`. A number in a card's text
  goes in the card's `constants`; the text shows it as `{damage}` and handlers read it as
  `card.damage`. Never type a number into rulebook text, card text or a handler.
- **Prefer library rules.** A playable game is mostly a selection of rules from the libraries it
  `uses`. Don't invent a rule a library already has. If the game needs something no library
  offers, say so instead of working around it.
- **Every rule cites the rulebook section that explains it** (`cites = @rulebook.sections.winning`).
- **Every card with text has a handler**, and every handler belongs to a card with text. Keep
  handlers to a line or two, using the libraries' words. Every handler gets a scenario.
- **One item per line** in collections; a record that doesn't fit on one line gets one field per
  line.
- **Layout boxes are measured on the card**, in pixels from its top-left corner at the trim line,
  not counting bleed. Check a changed layout by rendering the cards (`tcg cards`) and looking.
- **Comments only when they say something the code doesn't.**

After every change, run:

```bash
tcg check
```

It must report no errors. Once the game is playable, also run:

```bash
tcg test
```

All scenarios must pass before you're done.

## References

- The Alex language: the Alex getting-started guide and specification.
- The libraries and the rules they offer: the library reference.
