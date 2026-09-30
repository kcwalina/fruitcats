# Walkthrough: your first card game

In this walkthrough you build **Hello TCG**, a very small two-player card game, in two parts:

- **Part 1: cards on a table.** You design the cards and how they look, write the rulebook, and
  `kardix` turns them into files a card printer can print, plus a rulebook PDF. At the end you can
  order a real, physical copy of your game and play it with people in the same room. No
  programming.
- **Part 2: a game the computer can play.** You teach the engine the rules your rulebook already
  describes. Then bots can playtest it thousands of times, and you can play it online with
  friends anywhere.

Many designers only need Part 1, or do Part 1 first and come back to Part 2 once the printed game
has been played a few times. Both parts work on the same folder: Part 2 adds to what Part 1
made, and changes nothing about it.

Hello TCG is deliberately small: a Hero, six cards, one page of rules. Its cards are real ones,
borrowed from **Folkborn**, a published game built with this toolkit: the Domowiki deck's Hero,
five of its Creatures and a Charm, the house spirits of Slavic folklore, with their original
paintings and their card design. Each part takes about half an hour.

## What you need

- **The `kardix` tool**, free. It creates projects, checks them, renders cards and rulebooks, and
  plays games with bots.
- **Some Alex.** Games are written in Alex, and this walkthrough assumes you can read it. If
  you haven't used it, the Alex getting-started guide takes about ten minutes.
- **A text editor.** Any will do. VS Code with the Alex extension colours the files and underlines
  mistakes as you type.
- **The Hello TCG images.** `kardix new --sample-art hello-tcg` puts them in the project for you: the
  eight paintings, four card frames, four rarity icons and a card back. With your own game, these
  are your own images.
- **Optional: a coding agent**, such as Claude Code or Codex. Every step in this walkthrough shows
  the exact change to make by hand, so everyone ends up with the same game. Most people end up
  asking an agent to make these changes instead. Look for the boxes that say *Ask your agent*:
  they show what you could ask for instead of typing the change yourself. Your agent's version
  may differ slightly from the one shown here, and that is fine.
- **Optional: Studio**, the paid IDE. It shows your cards as they will look, runs the game next to
  your code, and has designers that edit your files for you. Boxes that say *In Studio* show
  where it helps. Everything in this walkthrough also works without it.

## How a game is made

A game is a folder. It holds two kinds of thing:

- **Alex files**, plain text written in **Alex**, a small language for describing things. They
  say what the game is: its cards, how they look, its rulebook and, once you want the computer to
  play it, its rules.
- **Assets**: the files the Alex files point at. Card paintings, card frames, icons, the card
  back, fonts, pictures for the rulebook.

Nothing about your game lives anywhere else: not in a database, not on a website. You can keep
the folder on your laptop, in Git, on GitHub, or all three.

---

# Part 1: Cards on a table

## 1. Install

On Windows:

```bash
winget install kardix
```

On macOS:

```bash
brew install kardix
```

Check that it works:

```bash
kardix --version
```

```
kardix 1.0.0 (Alex 1.0, schema 1)
```

In VS Code, install the **Alex** extension from the Extensions view.

## 2. Create the project

```bash
kardix new --sample-art hello-tcg
```

```
Created hello-tcg/
  hello-tcg.alex          the game
  rulebook.alex           the rulebook
  cards.alex              your cards
  art/                    your game's images (with the Hello TCG sample art)
  fonts/                  fonts for your cards
  AGENTS.md               instructions for coding agents

Next: cd hello-tcg, then kardix check
```

`kardix new` never makes up a game for you. Every file starts almost empty; `--sample-art` only
fills `art/` with the images this walkthrough uses. `hello-tcg.alex`:

```
#type Game

name = 'Hello TCG'
schema-version = 1
rulebook = @rulebook
```

`schema-version = 1` says which version of the game file format your game is written in, the way
a .NET project names the framework it targets. Later versions of `kardix` keep reading it exactly
the same way. Anything you don't write has a default: no card types, no constants. You add those
as the game grows.

`rulebook.alex`, a rulebook with a title and no sections yet:

```
#type Rulebook

title = 'Hello TCG'
```

`cards.alex`, with no cards yet:

```
#type Cards
```

`fonts/` holds a few free fonts (Nunito, under the SIL Open Font License) so cards look the same
on every computer. Add any font you have the right to use.

`AGENTS.md` is for coding agents. It tells them where the Alex and library references are, which
commands to run after every change, and the conventions in this walkthrough. You don't need to
read it, but you may.

### How the files fit together

`kardix` reads every `.alex` file in the project folder. Each file holds one thing, of the type its
`#type` line names, and the file's name is how other files refer to it: `@rulebook` is the
rulebook in `rulebook.alex`, and `@klobuk` is a card in `cards.alex`. There are no other names to
keep in step. Rename a file, and `kardix check` lists the references to update (Studio and agents
update them for you).

The folder holds exactly one `Game`: that is your game. Every `Cards` file in the folder is part
of it, so you can keep all your cards in `cards.alex` or split them into several files, as you
like. Everything else is joined by a reference, and images and fonts by their path in the
folder:

```
hello-tcg.alex   Game       rulebook = @rulebook       ──▶  rulebook.alex   Rulebook
cards.alex       (a card)   art = 'art/klobuk.webp'    ──▶  art/klobuk.webp
```

Check the project:

```bash
cd hello-tcg
kardix check
```

```
hello-tcg: 0 errors
  Printable   not yet: no cards
  Playable    not yet: no cards, no rules
```

`kardix check` tells you two things. **Errors** are real mistakes, like a reference to something
that doesn't exist; there are none. And it tells you how far the game is from two goals:
**printable**, where you can print cards and a rulebook, and **playable**, where the computer can
play it. Part 1 is about the first.

> [!NOTE]
> **In Studio:** run `kardix studio` in the folder. Studio opens in your browser with the files on
> the left, your cards in the middle and the rulebook on the right. Everything you do in the rest
> of this walkthrough shows up there as you save.

## 3. Card types and keywords

Hello TCG has three kinds of card:

- **Creatures** stay on the table. They have a cost, Power and Health.
- **Charms** are played once and discarded. They have a cost.
- **Heroes** lead a deck. A Hero has two faces: it starts on its front, and later turns over to its
  **Awakened** side, which has Power. Heroes are printed on foil.

Every card also prints its **family** (all of Hello TCG's are Domowiki), its **rarity** and its
collector **number**, and a card's name may have an **epithet** under it ("Kłobuk, *the Soggy
Chick*"). Say all of that in `hello-tcg.alex`:

```
enum Rarity { common, uncommon, rare, legendary }
enum Finish { standard, foil }

type Printed : Card {
  number: text
  rarity: Rarity
  family: text
  epithet: text?
  finish: Finish = standard
}
type Creature : Printed {
  cost: int
  power: int
  health: int
}
type Charm : Printed {
  cost: int
}
type Hero : Printed {
  finish = foil
  back: Awakened
}
type Awakened : Card {
  type-name = 'Hero · Awakened'
  epithet: text
  power: int
}
```

How to read it:

- **`Printed`** is what every card of this game prints, written once. `: Card` means it's a card,
  so it also has what every card has: a name, a picture, text, keywords, flavor text and
  constants. `epithet: text?` is optional: the `?` means a card may leave it out.
- **Creature, Charm and Hero** are `Printed` cards with fields of their own; `int` is a whole
  number. Games name their card types freely (Monsters, Allies, Spells, Leaders) and give them
  whatever fields they print.
- **`finish`** is `standard` unless a card says otherwise, and `finish = foil` on the Hero type
  makes every Hero foil. A single card can be foil too: `finish = foil` on the card.
- **`back`** is the Hero's other face. A card with a `back` is printed double-sided: its front on
  one side and its back on the other, instead of the game's card back. The Awakened face is a card
  of its own type with a display name, `type-name = 'Hero · Awakened'`, for its type line.

Some cards carry a **keyword**: a word that stands for a rule the rulebook explains once, so the
card doesn't have to. Hello TCG has two:

```
keywords = [
  Guardian = Keyword {}
  Swift = Keyword {}
]
```

> [!TIP]
> **Ask your agent:** "My game has Creatures (cost, Power, Health), Charms (cost) and Heroes (two
> faces, printed on foil; the back has Power). Every card prints a family, a rarity and a number,
> and may have an epithet. Keywords: Guardian and Swift."

## 4. Your first cards

Open `cards.alex` and add two Creatures:

```
#type Cards

cards = [
  hearth-cricket = Creature {
    name = 'Hearth Cricket', cost = 1, power = 2, health = 1
    number = 'DW1-D16', rarity = common, family = 'Domowiki'
    art = 'art/hearth-cricket.webp'
    flavor = 'Sings behind the stove, where the Domowik sleeps.'
  }
  keeper-of-the-door = Creature {
    name = 'Keeper of the Door', cost = 3, power = 2, health = 6
    number = 'DW1-D04', rarity = common, family = 'Domowiki'
    art = 'art/keeper-of-the-door.webp'
    keywords = [@Guardian]
    flavor = 'Nothing crosses the threshold without his nod.'
  }
]
```

`hearth-cricket` is the card's identifier, the name everything else refers to it by
(`@hearth-cricket`). `name = 'Hearth Cricket'` is the name printed on the card.

See what they look like:

```bash
kardix cards hearth-cricket keeper-of-the-door
```

```
Rendered 2 cards to out/cards/ (default layout)
  out/cards/hearth-cricket.png
  out/cards/keeper-of-the-door.png
```

Until you design how your cards look (chapter 6), they use a plain default layout that shows the
picture, name, cost, Power, Health, keywords, text and flavor.

The images are part of your game just as the Alex files are: they go into Git with everything
else, and `kardix check` tells you if a card points at a picture that isn't there:

```
hello-tcg: 1 error
  error  cards.alex:12  Keeper of the Door's art 'art/keeper-of-the-door.webp' doesn't exist.
```

> [!NOTE]
> **In Studio:** click `hearth-cricket` in `cards.alex`. The card appears as it will look, with a
> property grid beside it. Change **Cost** from 1 to 2 in the grid, and the line in `cards.alex`
> changes to `cost = 2`. Change it back in the file, and the grid follows. The file is always the
> truth; the grid is a view of it.

> [!TIP]
> **Ask your agent:** "Add two Creatures: Hearth Cricket (cost 1, 2/1, DW1-D16, common) and Keeper
> of the Door (cost 3, 2/6, Guardian, DW1-D04, common), with their pictures and flavor text."

## 5. Cards with text, and the Hero

Most cards do something, and say so in their text. Add four more cards to `cards`:

```
  mane-braiding-domowik = Creature {
    name = 'Mane-Braiding Domowik', cost = 2, power = 2, health = 2
    number = 'DW1-D03', rarity = common, family = 'Domowiki'
    art = 'art/mane-braiding-domowik.webp'
    keywords = [@Swift]
    flavor = 'The horse he favours wakes with braids in its mane.'
  }
  klobuk = Creature {
    name = 'Kłobuk', epithet = 'the Soggy Chick', cost = 3, power = 2, health = 3
    number = 'DW1-D18', rarity = common, family = 'Domowiki'
    art = 'art/klobuk.webp'
    text = 'Hello: Draw a card.'
    flavor = 'Found shivering on the fence in the rain. Take it in, and it brings things home.'
  }
  bread-and-salt-greeter = Creature {
    name = 'Bread-and-Salt Greeter', cost = 4, power = 3, health = 5
    number = 'DW1-D06', rarity = uncommon, family = 'Domowiki'
    art = 'art/bread-and-salt-greeter.webp'
    text = 'Hello: Heal {heal} from each Creature you control.'
    constants = [heal = 2]
    flavor = 'Every guest is welcome. Every crumb is counted.'
  }
  domowiks-temper = Charm {
    name = 'A Domowik''s Temper', cost = 4
    number = 'DW1-D10', rarity = uncommon, family = 'Domowiki'
    art = 'art/domowiks-temper.webp'
    text = 'Deal {damage} damage to a Creature.'
    constants = [damage = 5]
    flavor = 'Slam a door in his house and he slams back.'
  }
```

When a card's text has a number in it, the number is one of the card's **constants**, and the text
shows it in braces: the Greeter's card reads "Hello: Heal 2 from each Creature you control."
because `heal` is 2. That seems like a detour for a printed card. It pays off in Part 2, where the
engine reads the same number the card prints, so the card and what it does can never disagree.
`kardix check` holds the text and its constants together: a `{name}` the card doesn't have is an
error, and so is a constant the text never shows.

### The Hero

The Hero, Dziadziuś, the smallest Domowik in the house, has two faces. Add him at the top of
`cards`:

```
  dziadzius = Hero {
    name = 'Dziadziuś', epithet = 'Heart of the House'
    number = 'DW1-H01', rarity = legendary, family = 'Domowiki'
    art = 'art/dziadzius.webp'
    text = @dziadzius-text
    constants = [energy = 1, creatures = 3]
    flavor = 'The smallest Domowik in the house. Everyone listens to him anyway.'
    back = Awakened {
      name = 'Dziadziuś', epithet = 'Master of the House', power = 4
      art = 'art/dziadzius-awakened.webp'
      text = 'Exhaust: Gain {energy} Energy.'
      constants = [energy = 2]
    }
  }
```

His front's text is two lines, so it goes in a text table at the end of `cards.alex`:

```
@@@ dziadzius-text
Exhaust: Gain {energy} Energy.
Awaken: You control {creatures} or more Creatures.
@@@
```

The back is a whole face: its own name, epithet, picture, text and constants. What it doesn't
have, it shares with the front: the number, rarity and family print on both sides.

> [!TIP]
> **Ask your agent:** "Add Mane-Braiding Domowik, Kłobuk, Bread-and-Salt Greeter, A Domowik's
> Temper and the Hero Dziadziuś as in chapter 5 of the walkthrough."

## 6. How your cards look

A printed card is a picture: a frame, the painting, and the card's data (name, cost, text, Power,
Health, rarity, number) drawn in the right places, in the right fonts and colours. You design the
look once, and every card gets it, so changing a card's cost in `cards.alex` changes the printed
card, with nothing redrawn by hand.

The look has two halves:

- **Frames**, images you draw in any drawing program: everything on the card that is the same on
  every card of a type. Hello TCG's are in `art/frames/`: Folkborn's card design, left blank. A
  frame leaves a transparent window where the painting shows through, and blank spaces where the
  data goes: a circle for the cost, a banner for the name, a strip for the type line, a box for
  the text, and chips for Power and Health. Each type has its own: Creatures and Charms in
  Domowiki's purple (a Charm has no chips), and the Hero's two faces in gold, with a star in the
  circle instead of a cost, and only a Power chip on the Awakened face.
- **A card layout**, an Alex file that says which frame each card type uses, and where each piece
  of the card's data goes on it.

The frames are drawn at the card's printed size, 750 × 1050 pixels (2.5 × 3.5 inches at 300
dots per inch), plus 36 pixels of **bleed** on every side: the frame's edge carries on past where
the printer cuts, so no card ends up with a white sliver when the cut is slightly off. So the
frame images are 822 × 1122 pixels. The rarity marks are small images in `art/icons/`: a bronze
circle, a silver diamond, a gold star and a purple crown.

Create `card-layout.alex`. Its beginning:

```
#type CardLayout

width = 750
height = 1050
dpi = 300
bleed = 36

fonts = [
  black = 'fonts/Nunito-Black.ttf'
  bold = 'fonts/Nunito-Bold.ttf'
  bold-italic = 'fonts/Nunito-BoldItalic.ttf'
  regular = 'fonts/Nunito-Regular.ttf'
  italic = 'fonts/Nunito-Italic.ttf'
]

frames = [
  Creature = Frame { image = 'art/frames/creature.png', ink = '#2E1F5C' }
  Charm = Frame { image = 'art/frames/charm.png', ink = '#2E1F5C' }
  Hero = Frame { image = 'art/frames/hero.png', ink = '#7A5A0C' }
  Awakened = Frame { image = 'art/frames/hero-awakened.png', ink = '#7A5A0C' }
]

parts = [
  art = Picture {
    show = '{art}'
    box = Box { x = 42, y = 138, width = 666, height = 444 }
    fit = cover
    under-frame = true
  }
  cost = Label {
    show = '{cost}'
    box = Box { x = 30, y = 26, width = 102, height = 102 }
    font = @black
    size = 60
    color = ink
    align = center
  }
  name = Title {
    show = '{name}'
    subtitle = '{epithet}'
    box = Box { x = 150, y = 34, width = 540, height = 88 }
    font = @bold
    size = 42
    smallest = 26
    subtitle-font = @bold-italic
    subtitle-size = 25
    baseline = 34
    subtitle-baseline = 70
    color = '#FFFFFF'
    outline = ink
    outline-width = 2
  }
  type-line = Label {
    show = '{type} · {family}'
    ...
  }
  ...
]
```

(The complete file, with the rarity, number, text box, Power, Health and footer, is at the end of
the walkthrough.)

How to read it:

- **`frames`** gives each card type its frame, and its **ink**: the colour its text is drawn in,
  deep purple on the Domowiki frames and dark gold on the Hero's. A part with `color = ink` takes
  the ink of the card's frame.
- **`parts`** are the pieces drawn on the card, in order. Each has a **box**: where it goes,
  measured in pixels from the card's top-left corner, where the printer cuts, not counting bleed.
  Designers usually measure them in their drawing program: the box of the name is the name banner
  in the frame.
- **`show`** says what the part shows: `'{cost}'` is the card's cost, `'{type} · {family}'` its
  type and family, for "CREATURE · DOMOWIKI". It can mix in words of its own: the footer shows
  `'Hello TCG · {family} · © 2026'`.
- **A `Label`** is one line of text. `size` is its font size; with `smallest`, long text shrinks
  to fit its box instead of spilling out. `capitals = true` prints it in capitals.
- **A `Title`** is a name with an optional line under it: the epithet, when the card has one.
  "Kłobuk" gets "the Soggy Chick" under it; "A Domowik's Temper" sits alone in the middle of the
  banner.
- **A `Picture`** shows an image. `fit = cover` fills the box and trims what doesn't fit;
  `under-frame = true` draws it below the frame, so it shows through the frame's window.
- **An `Icon`** shows one of a few images, picked by a field: the rarity mark, by `{rarity}`.
- **A `TextBox`** holds paragraphs that shrink together to fit the box: the keywords in bold, then
  the card's text on the same line (`same-line = true`), then the flavor in italics under a thin
  line. A paragraph's `emphasis` says what's bold or italic in it: `Bold { words = keywords }` for
  the game's keywords, and `Bold { up-to = ':' }` for a sentence's opening up to a colon, such as
  "Hello:" and "Exhaust:". The `{heal}` in
  the Greeter's text is filled in with its constant before it's drawn.
- **A part shows only on cards that have what it shows.** A Charm has no `power`, so its card has
  no Power; a Hero has no `cost`, so its circle keeps the frame's star.
- **A card with a `back`** is drawn twice, front and back, each with its own type's frame. The
  back shows its own fields and the front's for what it doesn't have, so the Awakened face prints
  "HERO · AWAKENED · DOMOWIKI" and the Hero's number.

```bash
kardix cards
```

```
Rendered 7 cards, 8 faces, to out/cards/ (card-layout.alex)
```

Open `out/cards/`: every card in its frame, with its painting, name, cost, text and stats in
place, and the Hero's two faces as `dziadzius.png` and `dziadzius-back.png`. Change `size = 42` on
the name to 38 and render again, and every card's name is smaller. Change the Greeter's `heal` to
3, and its card reads "Heal 3".

`kardix check` checks the layout too: a `{field}` no card type has, a card type with no frame, a box
that runs off the card, a font, frame or icon that isn't there, and a text box too small for a
card's text at its smallest size, which names the card.

> [!NOTE]
> **In Studio:** open `card-layout.alex`, and the layout editor shows a card with every part's box
> drawn on it. Drag a box, and its `x` and `y` change in the file. Pick any card to see it in the
> layout, or show them all side by side.

> [!TIP]
> **Ask your agent:** "Write a card layout for my frames in art/frames: the cost in the circle,
> the name and epithet in the banner, the type line and rarity, the text in the box, Power and
> Health in the chips." Agents can read the frame images to find where the spaces are, but check
> their boxes against a rendered card.

## 7. The rulebook

Players need to know how to play. The rulebook is a list of sections, each with a number, a title
and its text. Open `rulebook.alex`:

```
#type Rulebook

title = 'Hello TCG'
sections = [
  winning = Section { number = '1', title = 'Winning', text = @winning-text }
  decks = Section { number = '2', title = 'Your deck', text = @decks-text }
  setup = Section { number = '3', title = 'Setting up', text = @setup-text }
  your-turn = Section { number = '4', title = 'Your turn', text = @your-turn-text }
  energy = Section { number = '5', title = 'Energy', text = @energy-text }
  creatures = Section { number = '6', title = 'Creatures', text = @creatures-text }
  heroes = Section { number = '7', title = 'Heroes', text = @heroes-text }
  keywords = Section { number = '8', title = 'Keywords', text = @keywords-text }
  attacking = Section { number = '9', title = 'Attacking', text = @attacking-text }
  charms = Section { number = '10', title = 'Charms', text = @charms-text }
]

@@@ winning-text
Each player starts with {@starting-life} Life. When your opponent has no Life left, you win.
@@@ decks-text
A deck has a Hero and exactly {@deck-size} other cards, with at most {@max-copies} copies of any
card.
@@@ setup-text
Each player puts their Hero in play, shuffles their deck and draws {@opening-hand} cards. A random
player goes first.
@@@ your-turn-text
Players take turns. At the start of your turn, ready your exhausted cards and draw a card (the
first player skips this draw on the very first turn). Then play cards and attack in any order,
and pass when you are done.
@@@ energy-text
Cards cost Energy. You start with none. At the start of each of your turns, your Energy grows by
{@energy-growth}, up to {@max-energy}, and refills.
@@@ creatures-text
Creatures stay on the board. A Creature enters exhausted, so it can't attack on the turn you
play it. When a Creature has taken damage equal to its Health, it is defeated and goes to the
discard pile. "Hello:" on a Creature means: when this Creature enters play, do what follows.
"Heal" removes damage from a Creature.
@@@ heroes-text
Your Hero is in play from the start. It isn't a Creature: it can't be attacked or damaged. Once
each turn you may exhaust it to use its "Exhaust:" ability. When its "Awaken:" condition is true,
turn it over to its Awakened side, which it keeps for the rest of the game. An Awakened Hero with
Power can attack like a Creature, and takes no damage doing so.
@@@ keywords-text
Guardian: while you control a Creature with Guardian, your opponent's Creatures must attack a
Creature with Guardian if they attack.
Swift: this Creature enters ready, so it can attack on the turn you play it.
@@@ attacking-text
On your turn, each of your ready Creatures may attack once. Exhaust it and choose what it
attacks: your opponent, or one of their Creatures. If it attacks your opponent, they lose Life
equal to its Power. If it attacks a Creature, both deal damage equal to their Power to each
other. Damage is removed at the end of the turn.
@@@ charms-text
A Charm does what its text says, once, and then goes to your discard pile.
@@@
```

`{@starting-life}` and the others are the game's **constants**: the numbers that shape the game.
Numbers are where rulebooks and games usually drift apart: the designer changes starting Life to
12 while playtesting, and the rulebook still says 10. So every such number lives in one place,
`constants` in `hello-tcg.alex`, and the rulebook reads it from there. Add them:

```
constants = [
  starting-life = 10
  opening-hand = 3
  energy-growth = 1
  max-energy = 4
  deck-size = 12
  max-copies = 3
]
```

Change `starting-life` to 12, and the rulebook says "Each player starts with 12 Life." There is
nothing else to update. In Part 2 the engine reads the same constants, so the printed rulebook
and the game the computer plays always agree. If the rulebook names a constant that doesn't exist,
`kardix check` says so. It also notes digits typed straight into rulebook text, since those are the
numbers that drift.

Name the layout in `hello-tcg.alex`, so the rulebook's card list uses it too:

```
card-layout = @card-layout
```

Render the rulebook:

```bash
kardix rulebook
```

```
Rendered the rulebook:
  out/rulebook/index.html
  out/rulebook/hello-tcg-rulebook.pdf
```

It contains every section, in order, and a card list: each card as it will be printed, both faces
of the Hero. You never copy a card's text into the rulebook, so the two can't disagree.

> [!TIP]
> **Ask your agent:** "Write the rulebook for Hello TCG: players start with 10 Life, decks are a
> Hero and 12 cards with at most 3 copies, … Put every number in the game's constants."

## 8. Decks

A printed game comes with decks to play, each led by a Hero. Add two to `cards.alex`, after the
cards and before the text table:

```
decks = [
  hearth = Deck {
    name = 'Hearth',
    hero = @dziadzius,
    cards = [
      [@hearth-cricket, 3],
      [@mane-braiding-domowik, 3],
      [@klobuk, 3],
      [@domowiks-temper, 3]
    ]
  }
  threshold = Deck {
    name = 'Threshold',
    hero = @dziadzius,
    cards = [
      [@keeper-of-the-door, 3],
      [@bread-and-salt-greeter, 3],
      [@klobuk, 3],
      [@domowiks-temper, 3]
    ]
  }
]
```

```bash
kardix check
```

```
hello-tcg: 0 errors, 1 warning
  warning  hello-tcg.alex:7  The card back is 600 × 840 pixels; printing needs 822 × 1122
           (300 dpi with bleed). It will look soft when printed.
  Printable   yes: 7 cards, 2 decks, a rulebook with 10 sections
  Playable    not yet: no zones, no turns, no way to win, 2 keywords with no rule,
              4 cards' text has no handler
```

The game is printable. It isn't playable by the computer yet, and it doesn't need to be: none of
what's missing is an error. It's Part 2's list of things to do. (The warning is about the card
back, which chapter 9 adds.)

## 9. Print it

Printed cards need a back, the same for every card in the game. Hello TCG's is
`art/card-back.png`; name it in `hello-tcg.alex`:

```
card-back = 'art/card-back.png'
```

Then make the print files:

```bash
kardix cards --print --decks hearth threshold --printer makeplayingcards
```

```
Rendered 26 cards for MakePlayingCards, poker size (63 × 88 mm), 822 × 1122 at 300 dpi with bleed:
  out/print/standard/     24 cards: fronts, and the card back
  out/print/foil/         2 cards on foil: Dziadziuś (× 2), double-sided, front and Awakened back
  out/print/order.txt     what to choose on the order page
  out/print/hello-tcg-cards.pdf   everything for home printing, with crop marks
```

These are the files an online card printer asks for: each card at print resolution with the
bleed the cutter needs. Cards are grouped the way printers take orders: the standard cards with the
shared card back, and the foil cards, which are ordered on foil stock and here have their own
backs, the Hero's Awakened face. `order.txt` lists the choices to make on the printer's order
page for each group (card size, stock, finish, number of cards) so the files fit. Or print the
PDF at home and cut along the marks.

With the rulebook PDF from chapter 7, that's a copy of your game you can play at a table. That's
the end of Part 1. Play it with people, change what doesn't work, and print again.

---

# Part 2: A game the computer can play

A printed game is played by people who read the rulebook. For bots to playtest it, or for people
to play it online, the engine has to know the rules too. Your rulebook already says what they
are; Part 2 tells the engine the same thing.

You rarely write rules from scratch. The libraries hold the rules card games commonly use (life
totals, attacking, drawing, energy, heroes, keywords like Guardian…), and you pick the ones your
game uses and set their numbers. Each rule you pick *cites* the rulebook section that explains
it, so the rules and the rulebook stay connected.

`kardix check` already listed what's missing:

```
  Playable    not yet: no zones, no turns, no way to win, 2 keywords with no rule,
              4 cards' text has no handler
```

The chapters below work through that list.

## 10. The table

The engine needs to know the parts of the table, how a game starts, and how a turn goes. From
here on, everything you add to `hello-tcg.alex` goes below what Part 1 wrote; nothing there
changes. Add the libraries to `uses`:

```
uses = [
  @common
  @units
  @spells
  @heroes
  @resources
  @turns
  @setup
]
```

Tell the libraries what your card types are: your Creatures are what the `units` library calls
unit cards (cards that stay in play with power and health), your Charms are what the `spells`
library calls spell cards, and your Heroes are the `heroes` library's hero cards, whose second
face is their `back`. `kardix check` confirms that your types have the fields each library needs.

```
units = [
  UnitCards { types = [@Creature] }
]

spells = [
  SpellCards { types = [@Charm], cites = @rulebook.sections.charms }
]

hero = [
  HeroCards { types = [@Hero], second-face = back }
]
```

The zones. Each has a `role` that tells the libraries what it is for: drawing takes cards from
the `deck` zone into the `hand` zone. The Hearth is where the Hero sits.

```
zones = [
  Deck = Zone { role = deck, shape = pile, visible = none }
  Hand = Zone { role = hand, shape = set, visible = owner }
  Board = Zone { role = board, shape = row, visible = all }
  Discard = Zone { role = discard, shape = pile, visible = all }
  Hearth = Zone { role = other, shape = slot, visible = all }
]
```

Each zone's name is the one you give it here: players see "Deck", "Hand", "Board", "Hearth".
`visible` decides who may see the cards in a zone. Nobody sees the deck; only you see your hand.
The engine enforces this everywhere: in bots, in online play, in replays.

Setup, turns and Energy, each rule citing the section of your rulebook that says the same thing,
and taking its numbers from `constants`:

```
setup = [
  StartsInZone { type = nameof(Hero), zone = @Hearth, cites = @rulebook.sections.setup }
  ShuffleDeck { cites = @rulebook.sections.setup }
  OpeningHand { n = @opening-hand, cites = @rulebook.sections.setup }
]

turns = [
  FullTurns { first = random, cites = @rulebook.sections.your-turn }
  Phases {
    phases = [
      Phase {
        name = 'Start'
        steps = [
          ReadyAll {}
          Draw { count = 1, skip-very-first-turn = true }
        ]
      }
    ]
  }
  Actions {
    allowed = [
      @common.actions.play
      @abilities.actions.ability
      @pass
    ]
  }
]

resources = [
  Energy = GrowingCounter {
    start = 0
    max = @max-energy
    pay-by = spend
    cites = @rulebook.sections.energy
  }
]
resource-rules = [
  GrowsAt { resource = @Energy, moment = @turn-start, by = @energy-growth }
  RefillsAt { resource = @Energy, moment = @turn-start }
]
cost-resource = @Energy
```

`cost-resource` says that when a card shows `cost = 2`, it means 2 Energy. The `ability` action is
exhausting the Hero to use its ability.

`cites = @rulebook.sections.setup` connects a rule to the text that explains it. When a game is
played, every event a rule causes carries that reference, so a player can always ask "why did
that happen?" and get the rulebook's answer.

> [!TIP]
> **Ask your agent:** "Make the game playable: add the zones, setup, turn and Energy rules that
> rulebook sections 3 to 5 describe."

## 11. Creatures, the Hero, keywords, attacking and winning

The rest of the rulebook: Creatures, the Hero, keywords, attacks and Life. Add `@abilities`,
`@combat` and `@life` to `uses`, and `@combat.actions.attack` to the allowed actions:

```
  Actions {
    allowed = [
      @common.actions.play
      @abilities.actions.ability
      @combat.actions.attack
      @pass
    ]
  }
```

Then the rules:

```
units = [
  UnitCards { types = [@Creature] }
  UnitsEnterExhausted { cites = @rulebook.sections.creatures }
  EntersReady { keyword = @Swift, cites = @rulebook.sections.keywords }
  DefeatAtHealth { cites = @rulebook.sections.creatures }
]

hero = [
  HeroCards { types = [@Hero], second-face = back }
  TwoFaces { cites = @rulebook.sections.heroes }
  AwakenOnStateCheck { cites = @rulebook.sections.heroes }
  AwakenedNeverReverts { cites = @rulebook.sections.heroes }
  PowerOncePerRound { cites = @rulebook.sections.heroes }
  HeroAttacksWhenAwakened { takes-no-damage = true, cites = @rulebook.sections.heroes }
]

combat = [
  AttackerChooses { targets = [unit, life], cites = @rulebook.sections.attacking }
  AttackerMustBeReady { cites = @rulebook.sections.attacking }
  GuardiansFirst { keyword = @Guardian, cites = @rulebook.sections.keywords }
  CombatDamageEqualsPower {}
  SimultaneousDamage {}
  LifeDamageEqualsPower {}
  DamageClearsAt { moment = @turn-end }
]

life = [
  LifeCounter {
    name = 'Life'
    start = @starting-life
    lose-at = 0
    cites = @rulebook.sections.winning
  }
]
```

Each rule is one sentence of the rulebook:

- `UnitsEnterExhausted`, `DefeatAtHealth`: section 6, Creatures.
- `EntersReady { keyword = @Swift }`: section 8. A keyword means nothing to the engine until a rule
  gives it meaning; this is the library's "enters ready" rule, applied to your keyword.
- `GuardiansFirst { keyword = @Guardian }`: section 8 again, the library's "must be attacked
  first" rule, applied to Guardian.
- `TwoFaces`, `AwakenOnStateCheck`, `AwakenedNeverReverts`: section 7. The Hero turns over as soon
  as its Awaken condition holds, and stays turned.
- `PowerOncePerRound`: the Hero's Exhaust ability, once each turn.
- `HeroAttacksWhenAwakened`: an Awakened Hero with Power attacks, and takes no damage.
- `AttackerChooses { targets = [unit, life] }`: the attacker picks either a Creature or the
  opponent.
- `AttackerMustBeReady`: only ready Creatures attack, and attacking exhausts them.
- `CombatDamageEqualsPower`, `SimultaneousDamage`: two Creatures fighting deal their Power to each
  other at the same time.
- `LifeDamageEqualsPower`: attacking the opponent costs them Life equal to the attacker's Power.
- `DamageClearsAt`: damage heals at the end of the turn.
- `LifeCounter`: section 1, starting at `@starting-life`, the same number the rulebook prints.

```bash
kardix check
```

```
hello-tcg: 0 errors
  Printable   yes
  Playable    not yet: 4 cards' text has no handler
  note  rulebook.alex  Section 'decks' is cited by no rule.
```

The note is the rulebook check at work: a section that explains no rule is either a rule you
haven't added yet or a mistake. Deck rules come in chapter 14.

> [!TIP]
> **Ask your agent:** "Add the rules for Creatures, the Hero, keywords, attacking and winning from
> rulebook sections 1 and 6 to 9."

## 12. What the cards do

Each card's text says what it does, in words. For the engine, that needs a small program: a
**handler**. Handlers live in a rules file next to your cards. Create `card-rules.alex`:

```
#type Rules

@klobuk.on-enter = draw()
```

Like a cards file, a rules file is part of the game because it's in the game's folder. The cards
file never mentions its rules file, so the cards read the same, and print the same, whether or not
they're programmed.

`draw()` is the program: draw a card. `@klobuk.on-enter` attaches it to Kłobuk, and says when it
runs: when Kłobuk enters play, which is what "Hello:" means. Handlers are short on purpose: they use the words the libraries give you (`draw`, `heal`,
`damage`, `gain`, `choose`…), and each one is a line or two.

The Greeter and the Temper:

```
@bread-and-salt-greeter.on-enter = units(own).heal(card.heal)
@domowiks-temper.on-play = choose(all).damage(card.damage)
```

- The Greeter heals each of your Creatures by `card.heal`, the constant printed on the card.
- `@domowiks-temper.on-play` runs when the Charm is played. `choose(all)` asks the player who
  played it to pick a Creature, any player's. You don't write any screen or button for that. The
  engine asks whoever is playing that seat: a person sees the Creatures highlighted on the table,
  a bot weighs its options, an LLM player reads a list. Then it deals `card.damage` to it.

And the Hero. Each labelled line of its text ("Exhaust:", "Awaken:") is its own handler:

```
routine gain-energy { gain(@Energy, card.energy) }
@dziadzius.exhaust = gain-energy
@dziadzius.back.exhaust = gain-energy

@dziadzius.awaken = units(own).count >= card.creatures
```

- Both faces' Exhaust abilities use the same handler, so it gets a name: `routine gain-energy`
  declares it once, and each face attaches it by that name. A handler of several lines is written
  the same way. `card.energy` is the number printed on the face in play: 1 on the front, 2 on the
  Awakened back.
- Awaken's handler answers yes or no: here, "do I control 3 or more Creatures?". The moment it's
  yes, the Hero awakens.
- A named handler is a **routine**. It can't loop or call itself, so it always finishes. With
  `: bool` it answers yes or no, as `routine enough-creatures : bool { ... }` would here. The slot says
  which kind it wants: `awaken` wants a yes or no, `exhaust` and `on-enter` want one that does
  something, and `kardix check` says so if you attach the wrong one.
- A handler takes no parameters. It reads its numbers from the card (`card.creatures`), so the
  number the card prints and the number the rules use are the same one.

Every card with text must have a handler, and every handler must belong to a card with text, so
the card and what it does can't disagree silently. Cards whose only rules are keywords, like
Keeper of the Door, need none: the keyword's rule covers them. `kardix check` also notes a digit
typed straight into a handler, like `heal(2)`: that's a number the card's text doesn't know about.

### Scenarios

Prove the handlers work. A **scenario** sets up a situation, does something, and checks the
result. The words scenarios use (`hand`, `deck`, `counter-is`, `in-zone`, `awakened`…) come from
the `scenarios` library, so add `@scenarios` to `uses`. Then add three scenarios to
`card-rules.alex`:

```
scenario 'Kłobuk draws a card when it enters' {
  given hand(me, @klobuk)
    deck(me, @hearth-cricket)
    counter-is(me, @Energy, 3)
  when play(me, @klobuk)
  then in-zone(@hearth-cricket, @Hand)
}

scenario 'Dziadziuś awakens when you control enough Creatures' {
  given controls(me, @dziadzius)
    controls(me, @hearth-cricket)
    controls(me, @klobuk)
    hand(me, @mane-braiding-domowik)
    counter-is(me, @Energy, 2)
  when play(me, @mane-braiding-domowik)
  then awakened(@dziadzius)
}

scenario 'A Domowik''s Temper defeats the chosen Creature' {
  given controls(opponent, @bread-and-salt-greeter)
    hand(me, @domowiks-temper)
    counter-is(me, @Energy, 4)
  when play(me, @domowiks-temper, target: @bread-and-salt-greeter)
  then in-zone(@bread-and-salt-greeter, @Discard)
}
```

```bash
kardix test
```

```
hello-tcg: 3 scenarios, 3 passed
  ✓ Kłobuk draws a card when it enters
  ✓ Dziadziuś awakens when you control enough Creatures
  ✓ A Domowik's Temper defeats the chosen Creature
```

Scenarios are your game's tests. Every time you or your agent changes something, `kardix test` tells
you whether a card still does what its text says.

> [!TIP]
> **Ask your agent:** "Write the handlers for the cards with text, and a scenario for each."

## 13. Your first game

```bash
kardix check
```

```
hello-tcg: 0 errors
  Printable   yes
  Playable    yes
  note  rulebook.alex  Section 'decks' is cited by no rule.
```

Watch two bots play:

```bash
kardix sim --decks hearth threshold --seed 7
```

```
Hello TCG · seed 7 · Hearth (Player 1, random bot) vs Threshold (Player 2, random bot)

Setup    Both Heroes are put in play. Both decks are shuffled.
         Each player draws 3.                                        [Setting up]
         Player 1 goes first.                                        [Your turn]
Round 1  Player 1: Energy 1. Plays Hearth Cricket.
         Player 2: draws. Energy 1. Exhausts Dziadziuś: Energy 1 → 2.   [Heroes]
Round 2  Player 1: draws. Energy 2. Plays Mane-Braiding Domowik, which enters ready.
                                                                     [Keywords]
         Hearth Cricket attacks Player 2: Life 10 → 8.              [Attacking]
         Mane-Braiding Domowik attacks Player 2: Life 8 → 6.
         Player 2: draws. Energy 2. Exhausts Dziadziuś: Energy 2 → 3.
         Plays Keeper of the Door.
Round 3  Player 1: draws. Energy 3. Plays Kłobuk, draws a card.
         Player 1 controls 3 Creatures: Dziadziuś awakens.           [Heroes]
         Hearth Cricket must attack Keeper of the Door.              [Keywords]
...
Round 11 Player 2: Bread-and-Salt Greeter attacks Player 1: Life 3 → 0.
Game over: Player 2 wins in round 11.                                [Winning]
```

The words in brackets are the rulebook sections the rules cite. When something in a game
surprises you, that's where to look.

The same seed always plays the same game, so `--seed 7` shows you this exact game again. Any
game, from a bot run or from online play, can be replayed this way.

> [!NOTE]
> **In Studio:** press **Play** above the table. The two bots play in front of you, and you can
> step through the game one action at a time. Click any event to jump to the rule that caused it.

## 14. Deck rules and a playtest

Section 2 of the rulebook says how decks are built; the engine doesn't know it yet. Add `@decks`
to `uses`, and:

```
deck-rules = [
  DeckSize { n = @deck-size, cites = @rulebook.sections.decks }
  CopiesMax { n = @max-copies, cites = @rulebook.sections.decks }
]
```

Now `kardix check` checks every deck against them, and the note about section 2 is gone.

Then the question every designer asks: is it fair? Let bots play a thousand games:

```bash
kardix playtest --decks hearth threshold --games 1000
```

```
Hello TCG · 1000 games · Hearth vs Threshold · search bots · seats alternate · 16 s

             Wins   Win rate   likely range
Hearth        352     35.2%    32.3 – 38.2
Threshold     633     63.3%    60.3 – 66.2
Draws          15      1.5%

Game length: median 10 rounds (most games 7 – 14)
Dziadziuś awakened in 71% of Hearth's games and 38% of Threshold's.

Cards (win rate in games where the card was played):
  Keeper of the Door        72%   A Domowik's Temper couldn't defeat it: 6 Health
  Bread-and-Salt Greeter    61%
  Kłobuk                    52%
  A Domowik's Temper        50%
  Mane-Braiding Domowik     44%
  Hearth Cricket            38%

Threshold wins 63% of games. Evenly matched decks usually land between 45% and 55%.
Report saved to out/playtests/2026-09-28-1412.md
```

The search bots aren't written for your game. They try out their legal moves and keep the ones
that tend to win, so they play any game the engine can run, including yours as soon as it checks.

Keeper of the Door walls Hearth's small Creatures out, and Hearth's one answer, A Domowik's
Temper, deals 5: one short of its Health. Make it 5 in `cards.alex`:

```
    name = 'Keeper of the Door', cost = 3, power = 2, health = 5
```

```bash
kardix playtest --decks hearth threshold --games 1000
```

```
             Wins   Win rate   likely range
Hearth        509     50.9%    47.8 – 54.0
Threshold     477     47.7%    44.6 – 50.8
Draws          14      1.4%
```

That's the loop you'll use most: change a card, playtest, read the report, repeat. When you're
happy, `kardix cards --print` makes new print files: the printed Keeper shows its new Health, because
it's the same card.

> [!NOTE]
> **In Studio:** the **Playtests** tab lists every run with its report, and shows two runs side by
> side, so you can see what a change did.

> [!TIP]
> **Ask your agent:** "Threshold wins too often. Try a few changes, playtest each one, and tell me
> which brings the decks closest to even." Agents are good at this: they can run many playtests
> while you do something else. Review what they changed before you keep it.

## 15. Play it

With a person:

```bash
kardix play --decks hearth threshold
```

This opens the game table in your browser for two players on one screen (hot-seat). Or
play against a bot:

```bash
kardix play --decks hearth threshold --opponent bot
```

The table is laid out from your zones, and the cards are drawn with your card layout. The engine
enforces every rule. You can only do what's legal, and when it's your opponent's turn, their hand
is hidden.

With a friend somewhere else, use the online service. You need an account:

```bash
kardix login
kardix push
```

```
Pushed Hello TCG (commit 3f2a91c) to your games.
Invite a player:  kardix invite
```

```bash
kardix invite --deck hearth
```

```
Invite link (valid 7 days): https://play.tcg.example/j/K7QX-2M
```

Send the link. Your friend opens it in a browser, picks a deck and plays: no installing, no
printing. The service runs exactly the game you pushed, so when you push a change, new games use
it and games in progress finish on the version they started with.

Every online game is saved as its seed and its actions, so you can watch it again with
`kardix replay`, or turn a surprising moment into a scenario.

## 16. Starting from rules you already have

You may already have a rulebook, in a document or in your head. Instead of building step by step,
you can give it to your agent and let it write the whole game.

Put your rules in the project folder, say `my-rules.md`, and ask:

> [!TIP]
> **Ask your agent:** "Read my-rules.md and write this game: the rulebook sections, the cards,
> the game's rules and a handler and scenario for every card with text. Use library rules
> wherever you can. Run kardix check and kardix test until both pass, then run a short playtest and tell
> me what you found."

Or only the first half, for a printed game: "Read my-rules.md and write the cards and the
rulebook, ready to print."

Your agent reads `AGENTS.md`, picks rules from the libraries, and runs the same commands you've
used here until everything checks. What comes back won't be the same every time, so review it
the way you'd review anyone's work:

- **Read the rulebook it wrote.** `kardix rulebook` and open the HTML. Is that your game?
- **Read `kardix check`'s notes.** They point at sections no rule explains and rules no section
  explains, which is where misunderstandings show up.
- **Read the scenarios.** Each one is a sentence about a card. Do they say what you meant?
- **Watch a game** with `kardix sim`, or play one with `kardix play`.

If your game needs something no library has, a new way to win or a new kind of turn, your agent
will say so rather than invent it. Most games need nothing new: the libraries were built from
more than 150 published card games.

## Where next

- **Your own game.** `kardix new my-game`: cards, their look and a rulebook first, rules when you want
  the computer to play it.
- **Card layouts.** Every kind of part, frames by rarity or faction, badges, foil and other
  finishes, and the sizes printers offer.
- **The library reference.** Every library, every rule, and what its numbers mean.
- **Folkborn.** The complete game Hello TCG's cards come from, as an example of a bigger project.

---

## The finished game

At the end of the walkthrough, your folder holds:

```
hello-tcg/
  hello-tcg.alex
  rulebook.alex
  cards.alex
  card-layout.alex
  card-rules.alex
  art/
    dziadzius.webp
    dziadzius-awakened.webp
    hearth-cricket.webp
    mane-braiding-domowik.webp
    klobuk.webp
    keeper-of-the-door.webp
    bread-and-salt-greeter.webp
    domowiks-temper.webp
    card-back.png
    frames/
      creature.png
      charm.png
      hero.png
      hero-awakened.png
    icons/
      common.png
      uncommon.png
      rare.png
      legendary.png
  fonts/
    Nunito-Black.ttf
    Nunito-Bold.ttf
    Nunito-BoldItalic.ttf
    Nunito-Regular.ttf
    Nunito-Italic.ttf
  AGENTS.md
```

These are the complete Alex files. At the end of Part 1 the folder is the same without
`card-rules.alex`, with only the first part of `hello-tcg.alex` (down to the card types), and
with Keeper of the Door's Health still 6.

### hello-tcg.alex

```
#type Game

name = 'Hello TCG'
schema-version = 1
rulebook = @rulebook
card-layout = @card-layout
card-back = 'art/card-back.png'

constants = [
  starting-life = 10
  opening-hand = 3
  energy-growth = 1
  max-energy = 4
  deck-size = 12
  max-copies = 3
]

keywords = [
  Guardian = Keyword {}
  Swift = Keyword {}
]

enum Rarity { common, uncommon, rare, legendary }
enum Finish { standard, foil }

type Printed : Card {
  number: text
  rarity: Rarity
  family: text
  epithet: text?
  finish: Finish = standard
}
type Creature : Printed {
  cost: int
  power: int
  health: int
}
type Charm : Printed {
  cost: int
}
type Hero : Printed {
  finish = foil
  back: Awakened
}
type Awakened : Card {
  type-name = 'Hero · Awakened'
  epithet: text
  power: int
}

uses = [
  @common
  @units
  @spells
  @heroes
  @abilities
  @combat
  @life
  @resources
  @turns
  @setup
  @decks
  @scenarios
]

zones = [
  Deck = Zone { role = deck, shape = pile, visible = none }
  Hand = Zone { role = hand, shape = set, visible = owner }
  Board = Zone { role = board, shape = row, visible = all }
  Discard = Zone { role = discard, shape = pile, visible = all }
  Hearth = Zone { role = other, shape = slot, visible = all }
]

setup = [
  StartsInZone { type = nameof(Hero), zone = @Hearth, cites = @rulebook.sections.setup }
  ShuffleDeck { cites = @rulebook.sections.setup }
  OpeningHand { n = @opening-hand, cites = @rulebook.sections.setup }
]

turns = [
  FullTurns { first = random, cites = @rulebook.sections.your-turn }
  Phases {
    phases = [
      Phase {
        name = 'Start'
        steps = [
          ReadyAll {}
          Draw { count = 1, skip-very-first-turn = true }
        ]
      }
    ]
  }
  Actions {
    allowed = [
      @common.actions.play
      @abilities.actions.ability
      @combat.actions.attack
      @pass
    ]
  }
]

resources = [
  Energy = GrowingCounter {
    start = 0
    max = @max-energy
    pay-by = spend
    cites = @rulebook.sections.energy
  }
]
resource-rules = [
  GrowsAt { resource = @Energy, moment = @turn-start, by = @energy-growth }
  RefillsAt { resource = @Energy, moment = @turn-start }
]
cost-resource = @Energy

units = [
  UnitCards { types = [@Creature] }
  UnitsEnterExhausted { cites = @rulebook.sections.creatures }
  EntersReady { keyword = @Swift, cites = @rulebook.sections.keywords }
  DefeatAtHealth { cites = @rulebook.sections.creatures }
]

spells = [
  SpellCards { types = [@Charm], cites = @rulebook.sections.charms }
]

hero = [
  HeroCards { types = [@Hero], second-face = back }
  TwoFaces { cites = @rulebook.sections.heroes }
  AwakenOnStateCheck { cites = @rulebook.sections.heroes }
  AwakenedNeverReverts { cites = @rulebook.sections.heroes }
  PowerOncePerRound { cites = @rulebook.sections.heroes }
  HeroAttacksWhenAwakened { takes-no-damage = true, cites = @rulebook.sections.heroes }
]

combat = [
  AttackerChooses { targets = [unit, life], cites = @rulebook.sections.attacking }
  AttackerMustBeReady { cites = @rulebook.sections.attacking }
  GuardiansFirst { keyword = @Guardian, cites = @rulebook.sections.keywords }
  CombatDamageEqualsPower {}
  SimultaneousDamage {}
  LifeDamageEqualsPower {}
  DamageClearsAt { moment = @turn-end }
]

life = [
  LifeCounter {
    name = 'Life'
    start = @starting-life
    lose-at = 0
    cites = @rulebook.sections.winning
  }
]

deck-rules = [
  DeckSize { n = @deck-size, cites = @rulebook.sections.decks }
  CopiesMax { n = @max-copies, cites = @rulebook.sections.decks }
]
```

### rulebook.alex

```
#type Rulebook

title = 'Hello TCG'
sections = [
  winning = Section { number = '1', title = 'Winning', text = @winning-text }
  decks = Section { number = '2', title = 'Your deck', text = @decks-text }
  setup = Section { number = '3', title = 'Setting up', text = @setup-text }
  your-turn = Section { number = '4', title = 'Your turn', text = @your-turn-text }
  energy = Section { number = '5', title = 'Energy', text = @energy-text }
  creatures = Section { number = '6', title = 'Creatures', text = @creatures-text }
  heroes = Section { number = '7', title = 'Heroes', text = @heroes-text }
  keywords = Section { number = '8', title = 'Keywords', text = @keywords-text }
  attacking = Section { number = '9', title = 'Attacking', text = @attacking-text }
  charms = Section { number = '10', title = 'Charms', text = @charms-text }
]

@@@ winning-text
Each player starts with {@starting-life} Life. When your opponent has no Life left, you win.
@@@ decks-text
A deck has a Hero and exactly {@deck-size} other cards, with at most {@max-copies} copies of any
card.
@@@ setup-text
Each player puts their Hero in play, shuffles their deck and draws {@opening-hand} cards. A random
player goes first.
@@@ your-turn-text
Players take turns. At the start of your turn, ready your exhausted cards and draw a card (the
first player skips this draw on the very first turn). Then play cards and attack in any order,
and pass when you are done.
@@@ energy-text
Cards cost Energy. You start with none. At the start of each of your turns, your Energy grows by
{@energy-growth}, up to {@max-energy}, and refills.
@@@ creatures-text
Creatures stay on the board. A Creature enters exhausted, so it can't attack on the turn you
play it. When a Creature has taken damage equal to its Health, it is defeated and goes to the
discard pile. "Hello:" on a Creature means: when this Creature enters play, do what follows.
"Heal" removes damage from a Creature.
@@@ heroes-text
Your Hero is in play from the start. It isn't a Creature: it can't be attacked or damaged. Once
each turn you may exhaust it to use its "Exhaust:" ability. When its "Awaken:" condition is true,
turn it over to its Awakened side, which it keeps for the rest of the game. An Awakened Hero with
Power can attack like a Creature, and takes no damage doing so.
@@@ keywords-text
Guardian: while you control a Creature with Guardian, your opponent's Creatures must attack a
Creature with Guardian if they attack.
Swift: this Creature enters ready, so it can attack on the turn you play it.
@@@ attacking-text
On your turn, each of your ready Creatures may attack once. Exhaust it and choose what it
attacks: your opponent, or one of their Creatures. If it attacks your opponent, they lose Life
equal to its Power. If it attacks a Creature, both deal damage equal to their Power to each
other. Damage is removed at the end of the turn.
@@@ charms-text
A Charm does what its text says, once, and then goes to your discard pile.
@@@
```

### cards.alex

```
#type Cards

cards = [
  dziadzius = Hero {
    name = 'Dziadziuś', epithet = 'Heart of the House'
    number = 'DW1-H01', rarity = legendary, family = 'Domowiki'
    art = 'art/dziadzius.webp'
    text = @dziadzius-text
    constants = [energy = 1, creatures = 3]
    flavor = 'The smallest Domowik in the house. Everyone listens to him anyway.'
    back = Awakened {
      name = 'Dziadziuś', epithet = 'Master of the House', power = 4
      art = 'art/dziadzius-awakened.webp'
      text = 'Exhaust: Gain {energy} Energy.'
      constants = [energy = 2]
    }
  }
  hearth-cricket = Creature {
    name = 'Hearth Cricket', cost = 1, power = 2, health = 1
    number = 'DW1-D16', rarity = common, family = 'Domowiki'
    art = 'art/hearth-cricket.webp'
    flavor = 'Sings behind the stove, where the Domowik sleeps.'
  }
  mane-braiding-domowik = Creature {
    name = 'Mane-Braiding Domowik', cost = 2, power = 2, health = 2
    number = 'DW1-D03', rarity = common, family = 'Domowiki'
    art = 'art/mane-braiding-domowik.webp'
    keywords = [@Swift]
    flavor = 'The horse he favours wakes with braids in its mane.'
  }
  klobuk = Creature {
    name = 'Kłobuk', epithet = 'the Soggy Chick', cost = 3, power = 2, health = 3
    number = 'DW1-D18', rarity = common, family = 'Domowiki'
    art = 'art/klobuk.webp'
    text = 'Hello: Draw a card.'
    flavor = 'Found shivering on the fence in the rain. Take it in, and it brings things home.'
  }
  keeper-of-the-door = Creature {
    name = 'Keeper of the Door', cost = 3, power = 2, health = 5
    number = 'DW1-D04', rarity = common, family = 'Domowiki'
    art = 'art/keeper-of-the-door.webp'
    keywords = [@Guardian]
    flavor = 'Nothing crosses the threshold without his nod.'
  }
  bread-and-salt-greeter = Creature {
    name = 'Bread-and-Salt Greeter', cost = 4, power = 3, health = 5
    number = 'DW1-D06', rarity = uncommon, family = 'Domowiki'
    art = 'art/bread-and-salt-greeter.webp'
    text = 'Hello: Heal {heal} from each Creature you control.'
    constants = [heal = 2]
    flavor = 'Every guest is welcome. Every crumb is counted.'
  }
  domowiks-temper = Charm {
    name = 'A Domowik''s Temper', cost = 4
    number = 'DW1-D10', rarity = uncommon, family = 'Domowiki'
    art = 'art/domowiks-temper.webp'
    text = 'Deal {damage} damage to a Creature.'
    constants = [damage = 5]
    flavor = 'Slam a door in his house and he slams back.'
  }
]

decks = [
  hearth = Deck {
    name = 'Hearth',
    hero = @dziadzius,
    cards = [
      [@hearth-cricket, 3],
      [@mane-braiding-domowik, 3],
      [@klobuk, 3],
      [@domowiks-temper, 3]
    ]
  }
  threshold = Deck {
    name = 'Threshold',
    hero = @dziadzius,
    cards = [
      [@keeper-of-the-door, 3],
      [@bread-and-salt-greeter, 3],
      [@klobuk, 3],
      [@domowiks-temper, 3]
    ]
  }
]

@@@ dziadzius-text
Exhaust: Gain {energy} Energy.
Awaken: You control {creatures} or more Creatures.
@@@
```

### card-layout.alex

```
#type CardLayout

width = 750
height = 1050
dpi = 300
bleed = 36

fonts = [
  black = 'fonts/Nunito-Black.ttf'
  bold = 'fonts/Nunito-Bold.ttf'
  bold-italic = 'fonts/Nunito-BoldItalic.ttf'
  regular = 'fonts/Nunito-Regular.ttf'
  italic = 'fonts/Nunito-Italic.ttf'
]

frames = [
  Creature = Frame { image = 'art/frames/creature.png', ink = '#2E1F5C' }
  Charm = Frame { image = 'art/frames/charm.png', ink = '#2E1F5C' }
  Hero = Frame { image = 'art/frames/hero.png', ink = '#7A5A0C' }
  Awakened = Frame { image = 'art/frames/hero-awakened.png', ink = '#7A5A0C' }
]

parts = [
  art = Picture {
    show = '{art}'
    box = Box { x = 42, y = 138, width = 666, height = 444 }
    fit = cover
    under-frame = true
  }
  cost = Label {
    show = '{cost}'
    box = Box { x = 30, y = 26, width = 102, height = 102 }
    font = @black
    size = 60
    color = ink
    align = center
  }
  name = Title {
    show = '{name}'
    subtitle = '{epithet}'
    box = Box { x = 150, y = 34, width = 540, height = 88 }
    font = @bold
    size = 42
    smallest = 26
    subtitle-font = @bold-italic
    subtitle-size = 25
    baseline = 34
    subtitle-baseline = 70
    color = '#FFFFFF'
    outline = ink
    outline-width = 2
  }
  type-line = Label {
    show = '{type} · {family}'
    box = Box { x = 62, y = 600, width = 480, height = 44 }
    font = @bold
    size = 25
    color = ink
    capitals = true
  }
  rarity = Icon {
    show = '{rarity}'
    images = [
      common = 'art/icons/common.png'
      uncommon = 'art/icons/uncommon.png'
      rare = 'art/icons/rare.png'
      legendary = 'art/icons/legendary.png'
    ]
    box = Box { x = 566, y = 609, width = 26, height = 26 }
  }
  number = Label {
    show = '{number}'
    box = Box { x = 598, y = 606, width = 90, height = 32 }
    font = @regular
    size = 20
    color = '#7A6A5C'
    align = right
  }
  rules = TextBox {
    box = Box { x = 66, y = 678, width = 618, height = 216 }
    size = 31
    smallest = 18
    color = '#2B211B'
    paragraphs = [
      Paragraph { show = '{keywords}.', join = '. ', font = @bold }
      Paragraph {
        show = '{text}'
        font = @regular
        bold-font = @bold
        emphasis = [
          Bold { words = keywords }
          Bold { up-to = ':' }
        ]
        same-line = true
      }
      Paragraph {
        show = '{flavor}'
        font = @italic
        color = '#7A6A5C'
        align = center
        rule-above = '#E2D3BA'
      }
    ]
  }
  power = Label {
    show = '{power}'
    box = Box { x = 98, y = 930, width = 52, height = 62 }
    font = @black
    size = 40
    color = ink
  }
  health = Label {
    show = '{health}'
    box = Box { x = 642, y = 930, width = 52, height = 62 }
    font = @black
    size = 40
    color = ink
  }
  footer = Label {
    show = 'Hello TCG · {family} · © 2026'
    box = Box { x = 0, y = 988, width = 750, height = 24 }
    font = @regular
    size = 17
    color = '#7A6A5C'
    align = center
  }
]
```

### card-rules.alex

```
#type Rules

routine gain-energy { gain(@Energy, card.energy) }
@dziadzius.exhaust = gain-energy
@dziadzius.back.exhaust = gain-energy

routine enough-creatures : bool { units(own).count >= card.creatures }
@dziadzius.awaken = enough-creatures

routine draw-a-card { draw() }
@klobuk.on-enter = draw-a-card

routine heal-own-creatures { units(own).heal(card.heal) }
@bread-and-salt-greeter.on-enter = heal-own-creatures

routine damage-a-creature { choose(all).damage(card.damage) }
@domowiks-temper.on-play = damage-a-creature

scenario 'Kłobuk draws a card when it enters' {
  given hand(me, @klobuk)
    deck(me, @hearth-cricket)
    counter-is(me, @Energy, 3)
  when play(me, @klobuk)
  then in-zone(@hearth-cricket, @Hand)
}

scenario 'Dziadziuś awakens when you control enough Creatures' {
  given controls(me, @dziadzius)
    controls(me, @hearth-cricket)
    controls(me, @klobuk)
    hand(me, @mane-braiding-domowik)
    counter-is(me, @Energy, 2)
  when play(me, @mane-braiding-domowik)
  then awakened(@dziadzius)
}

scenario 'A Domowik''s Temper defeats the chosen Creature' {
  given controls(opponent, @bread-and-salt-greeter)
    hand(me, @domowiks-temper)
    counter-is(me, @Energy, 4)
  when play(me, @domowiks-temper, target: @bread-and-salt-greeter)
  then in-zone(@bread-and-salt-greeter, @Discard)
}
```
