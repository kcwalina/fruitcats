# Working on this game

This folder is a card game for the TCG developer platform. The game is the Alex files plus the
assets they refer to (images in `art/`). Nothing about the game lives anywhere else.

## The files

- `hello-tcg.alex` is the game (`#type Game`): the libraries it uses, its numbers, zones and rules.
- `rulebook.alex` is the rulebook (`#type Rulebook`): the text players read. Rules cite its sections.
- `base-set.alex` is a set (`#type Set`): what each card is, and the decks.
- `base-set-rules.alex` (`#type Rules`, `for = @base-set`): what the cards' abilities do, and
  scenarios that test them.
- `art/`: images. Cards refer to them by path (`art = 'art/friend.png'`).

## How to work

- **Prefer library rules.** A game is mostly a selection of rules from the libraries it `uses`.
  Don't invent a rule a library already has. If the game needs something no library offers, say
  so instead of working around it.
- **Numbers go in `numbers`.** Rules take them (`start = @starting-life`) and rulebook text embeds
  them (`{@starting-life}`). Never type a number into rulebook text.
- **An ability's numbers go on the ability** (`numbers = [damage = 2]`). Its text shows them
  (`'Deal {damage} damage'`) and its handler reads them (`ability.damage`). Never type a number
  into card text or a handler.
- **Every rule cites the rulebook section that explains it** (`cites = @rulebook.sections.winning`). When
  you add a rule, add or update its section.
- **Every ability printed on a card has a handler**, and every handler belongs to a printed
  ability. Keep handlers to a line or two, using the libraries' words.
- **Every ability gets a scenario** in the rules file.
- **Comments only when they say something the code doesn't.**

After every change, run:

```bash
tcg check
```

```bash
tcg test
```

Both must pass before you're done. To see the game play, run `tcg sim`; to judge balance, run
`tcg playtest`.

## References

- The Alex language: the Alex getting-started guide and specification.
- The libraries and the rules they offer: the library reference.
