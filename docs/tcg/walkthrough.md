# Walkthrough: your first card game

In this walkthrough you build **Hello TCG**, a very small two-player card game, in two parts:

- **Part 1: cards on a table.** You design the cards and write the rulebook, and `tcg` turns them
  into files a card printer can print, plus a rulebook PDF. At the end you can order a real,
  physical copy of your game and play it with people in the same room. No programming.
- **Part 2: a game the computer can play.** You teach the engine the rules your rulebook already
  describes. Then bots can playtest it thousands of times, and you can play it online with
  friends anywhere.

Many designers only need Part 1, or do Part 1 first and come back to Part 2 once the printed game
has been played a few times. Both parts work on the same folder: Part 2 adds to what Part 1
made, and changes nothing about it.

Hello TCG is deliberately simple: six cards, one page of rules. It is not meant to be fun. It
is meant to show every part of the toolkit once, so that when you build your own game you know
where everything goes. Each part takes about half an hour.

## What you need

- **The `tcg` tool**, free. It creates projects, checks them, renders cards and rulebooks, and
  plays games with bots.
- **Some Alex.** Games are written in Alex, and this walkthrough assumes you can read it. If
  you haven't used it, the Alex getting-started guide takes about ten minutes.
- **A text editor.** Any will do. VS Code with the Alex extension colours the files and underlines
  mistakes as you type.
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
  say what the game is: its cards, its rulebook and, once you want the computer to play it, its
  rules.
- **Assets**: the files the Alex files point at. Mostly images (card art, the card back, card
  frames, icons, pictures for the rulebook), and other media your game uses.

Nothing about your game lives anywhere else: not in a database, not on a website. You can keep
the folder on your laptop, in Git, on GitHub, or all three.

---

# Part 1: Cards on a table

## 1. Install

On Windows:

```bash
winget install tcg
```

On macOS:

```bash
brew install tcg
```

Check that it works:

```bash
tcg --version
```

```
tcg 1.0.0 (Alex 1.0, schema 1)
```

In VS Code, install the **Alex** extension from the Extensions view.

## 2. Create the project

```bash
tcg new hello-tcg
```

```
Created hello-tcg/
  hello-tcg.alex          the game
  rulebook.alex           the rulebook
  cards.alex              your cards
  art/                    your game's images
  AGENTS.md               instructions for coding agents

Next: cd hello-tcg, then tcg check
```

`tcg new` never makes up a game for you. Every file starts almost empty. `hello-tcg.alex`:

```
#type Game

name = 'Hello TCG'
schema-version = 1
rulebook = @rulebook
```

`schema-version = 1` says which version of the game file format your game is written in, the way
a .NET project names the framework it targets. Later versions of `tcg` keep reading it exactly
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

`art/` is empty. It is where your game's images go.

`AGENTS.md` is for coding agents. It tells them where the Alex and library references are, which
commands to run after every change, and the conventions in this walkthrough. You don't need to
read it, but you may.

### How the files fit together

`tcg` reads every `.alex` file in the project folder. Each file holds one thing, of the type its
`#type` line names, and the file's name is how other files refer to it: `@rulebook` is the
rulebook in `rulebook.alex`, and `@friend` is a card in `cards.alex`. There are no other
names to keep in step. Rename a file, and `tcg check` lists the references to update (Studio and
agents update them for you).

The folder holds exactly one `Game`: that is your game. Every `Cards` file in the folder is part
of it, so you can keep all your cards in `cards.alex` or split them into several files, as you
like. Everything else is joined by a reference:

```
hello-tcg.alex   Game       rulebook = @rulebook      ──▶  rulebook.alex   Rulebook
cards.alex       (a card)   art = 'art/friend.png'    ──▶  art/friend.png
```

Assets are referred to by their path in the folder.

Check the project:

```bash
cd hello-tcg
tcg check
```

```
hello-tcg: 0 errors
  Printable   not yet: no cards
  Playable    not yet: no cards, no rules
```

`tcg check` tells you two things. **Errors** are real mistakes, like a reference to something
that doesn't exist; there are none. And it tells you how far the game is from two goals:
**printable**, where you can print cards and a rulebook, and **playable**, where the computer can
play it. Part 1 is about the first.

> [!NOTE]
> **In Studio:** run `tcg studio` in the folder. Studio opens in your browser with the files on
> the left, your cards in the middle and the rulebook on the right. Everything you do in the rest
> of this walkthrough shows up there as you save.

## 3. Card types

Hello TCG has two kinds of card:

- **Creatures** stay on the table. They have a cost, Power and Health.
- **Spells** are played once and discarded. They have a cost.

Say what each type of card has printed on it. In `hello-tcg.alex`:

```
type Creature : Card {
  cost: int
  power: int
  health: int
}
type Spell : Card {
  cost: int
}
```

`: Card` means these are cards, so they also have what every card has: a name, a picture, text
and flavor text, all optional. The fields you add are the ones your game prints; `int` means a
whole number. Games name their card types freely (Monsters, Allies, Characters, Tricks) and give
them whatever fields they print.

> [!TIP]
> **Ask your agent:** "My game has two card types: Creatures, with a cost, Power and Health, and
> Spells, with a cost."

## 4. Your first cards

Open `cards.alex` and add two Creatures. Any image works for their pictures for now, like a
sketch or a photo of a drawing: save two images as `art/friend.png` and `art/big-friend.png`.

```
#type Cards

cards = [
  friend = Creature {
    name = 'Friend', cost = 1, power = 1, health = 1
    art = 'art/friend.png'
    flavor = 'Always there.'
  }
  big-friend = Creature {
    name = 'Big Friend', cost = 3, power = 3, health = 3
    art = 'art/big-friend.png'
    flavor = 'Bigger hugs.'
  }
]
```

`friend` is the card's identifier, the name everything else refers to it by (`@friend`).
`name = 'Friend'` is the name printed on the card.

See what they look like:

```bash
tcg cards friend big-friend
```

```
Rendered 2 cards to out/cards/ (default frame)
  out/cards/friend.png
  out/cards/big-friend.png
```

Until you design your own card frame, cards use a plain default frame that shows the picture,
name, cost, Power, Health, text and flavor.

The images are part of your game just as the Alex files are: they go into Git with everything
else, and `tcg check` tells you if a card points at a picture that isn't there:

```
hello-tcg: 1 error
  error  cards.alex:11  Big Friend's art 'art/big-friend.png' doesn't exist.
```

> [!NOTE]
> **In Studio:** click `friend` in `cards.alex`. The card appears as it will look, with a
> property grid beside it. Change **Cost** from 1 to 2 in the grid, and the line in
> `cards.alex` changes to `cost = 2`. Change it back in the file, and the grid follows. The
> file is always the truth; the grid is a view of it.

> [!TIP]
> **Ask your agent:** "Add two Creatures: Friend (cost 1, 1/1, 'Always there.') and Big Friend
> (cost 3, 3/3, 'Bigger hugs.'), with their pictures in art/."

## 5. Cards with text

Most cards do something, and say so in their text. Add four more cards to `cards`, each with its
picture in `art/`:

```
  hello = Creature {
    name = 'Hello', cost = 2, power = 1, health = 1
    art = 'art/hello.png'
    text = 'When Hello enters, draw a card.'
    flavor = 'Nice to meet you.'
  }
  cheer = Creature {
    name = 'Cheer', cost = 2, power = 1, health = 2
    art = 'art/cheer.png'
    text = 'Your other Creatures have +{bonus} Power.'
    constants = [bonus = 1]
    flavor = 'Louder together.'
  }
  spark = Spell {
    name = 'Spark', cost = 1
    art = 'art/spark.png'
    text = 'Deal {damage} damage to your opponent.'
    constants = [damage = 2]
    flavor = 'Small, bright, rude.'
  }
  goodbye = Spell {
    name = 'Goodbye', cost = 3
    art = 'art/goodbye.png'
    text = 'Destroy a Creature.'
    flavor = 'See you around.'
  }
```

When a card's text has a number in it, the number is one of the card's **constants**, and the text
shows it in braces: Cheer's card reads "Your other Creatures have +1 Power." because `bonus` is 1.
That seems like a detour for a printed card. It pays off in Part 2, where the engine reads the
same number the card prints, so the card and what it does can never disagree. `tcg check` holds
the text and its constants together: a `{name}` the card doesn't have is an error, and so is a
constant the text never shows.

> [!TIP]
> **Ask your agent:** "Add Hello, Cheer, Spark and Goodbye as in chapter 5 of the walkthrough."

## 6. The rulebook

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
  attacking = Section { number = '7', title = 'Attacking', text = @attacking-text }
  spells = Section { number = '8', title = 'Spells', text = @spells-text }
]

@@@ winning-text
Each player starts with {@starting-life} Life. When your opponent has no Life left, you win.
@@@ decks-text
A deck has exactly {@deck-size} cards, with at most {@max-copies} copies of any card.
@@@ setup-text
Each player shuffles their deck and draws {@opening-hand} cards. A random player goes first.
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
discard pile.
@@@ attacking-text
On your turn, each of your ready Creatures may attack once. Exhaust it and choose what it
attacks: your opponent, or one of their Creatures. If it attacks your opponent, they lose Life
equal to its Power. If it attacks a Creature, both deal damage equal to their Power to each
other. Damage is removed at the end of the turn.
@@@ spells-text
A Spell does what its text says, once, and then goes to your discard pile.
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
  max-energy = 3
  deck-size = 12
  max-copies = 3
]
```

Change `starting-life` to 12, and the rulebook says "Each player starts with 12 Life." There is
nothing else to update. In Part 2 the engine reads the same constants, so the printed rulebook
and the game the computer plays always agree. If the rulebook names a constant that doesn't exist,
`tcg check` says so. It also notes digits typed straight into rulebook text, since those are the
numbers that drift.

Render it:

```bash
tcg rulebook
```

```
Rendered the rulebook:
  out/rulebook/index.html
  out/rulebook/hello-tcg-rulebook.pdf
```

It contains every section, in order, and a card list made from your cards: each card as it
looks, with its text. You never copy a card's text into the rulebook, so the two can't disagree.

> [!TIP]
> **Ask your agent:** "Write the rulebook for Hello TCG: players start with 10 Life, decks are 12
> cards with at most 3 copies, … Put every number in the game's constants."

## 7. Decks

A printed game comes with decks to play. Add two to `cards.alex`:

```
decks = [
  swarm = Deck {
    name = 'Swarm',
    cards = [
      [@friend, 3],
      [@cheer, 3],
      [@hello, 3],
      [@spark, 3]
    ]
  }
  big = Deck {
    name = 'Big',
    cards = [
      [@big-friend, 3],
      [@hello, 3],
      [@goodbye, 3],
      [@spark, 3]
    ]
  }
]
```

```bash
tcg check
```

```
hello-tcg: 0 errors
  Printable   yes: 6 cards, 2 decks, a rulebook with 8 sections
  Playable    not yet: no zones, no turns, no way to win, 4 cards' text has no handler
```

The game is printable. It isn't playable by the computer yet, and it doesn't need to be: none of
what's missing is an error. It's Part 2's list of things to do.

## 8. Print it

Printed cards need a back, the same for every card in the game. Save an image as
`art/card-back.png` and name it in `hello-tcg.alex`:

```
card-back = 'art/card-back.png'
```

Then make the print files:

```bash
tcg cards --print --decks swarm big --printer makeplayingcards
```

```
Rendered 24 cards (2 decks × 12) for MakePlayingCards, poker size (63 × 88 mm):
  out/print/fronts/*.png      one image per card, 300 dpi, with 3 mm bleed
  out/print/back.png          the card back, 300 dpi, with 3 mm bleed
  out/print/order.txt         what to choose on the order page
  out/print/hello-tcg-cards.pdf   the same cards for home printing, with crop marks
```

These are the files an online card printer asks for: each card at print resolution with the
extra margin (bleed) the cutter needs, and the back. `order.txt` lists the choices to make on
the printer's order page (card size, stock, number of cards) so the files fit. Or print the PDF
at home and cut along the marks.

With the rulebook PDF from chapter 6, that's a copy of your game you can play at a table. That's
the end of Part 1. Play it with people, change what doesn't work, and print again.

---

# Part 2: A game the computer can play

A printed game is played by people who read the rulebook. For bots to playtest it, or for people
to play it online, the engine has to know the rules too. Your rulebook already says what they
are; Part 2 tells the engine the same thing.

You rarely write rules from scratch. The libraries hold the rules card games commonly use (life
totals, attacking, drawing, energy…), and you pick the ones your game uses and set their numbers.
Each rule you pick *cites* the rulebook section that explains it, so the rules and the rulebook
stay connected.

`tcg check` already listed what's missing:

```
  Playable    not yet: no zones, no turns, no way to win, 4 cards' text has no handler
```

The chapters below work through that list.

## 9. The table

The engine needs to know the parts of the table, how a game starts, and how a turn goes. From
here on, everything you add to `hello-tcg.alex` goes below what Part 1 wrote; nothing there
changes. Add the libraries to `uses`:

```
uses = [
  @common
  @units
  @spells
  @resources
  @turns
  @setup
]
```

Tell the libraries what your card types are: your Creatures are what the `units` library calls
unit cards (cards that stay in play with power and health), and your Spells are its spell cards.
`tcg check` confirms that your types have the fields the library needs.

```
units = [
  UnitCards { types = [@Creature] }
]

spells = [
  SpellCards { types = [@Spell], cites = @rulebook.sections.spells }
]
```

The zones. Each has a `role` that tells the libraries what it is for: drawing takes cards from
the `deck` zone into the `hand` zone.

```
zones = [
  Deck = Zone { role = deck, shape = pile, visible = none }
  Hand = Zone { role = hand, shape = set, visible = owner }
  Board = Zone { role = board, shape = row, visible = all }
  Discard = Zone { role = discard, shape = pile, visible = all }
]
```

Each zone's name is the one you give it here: players see "Deck", "Hand", "Board".
`visible` decides who may see the cards in a zone. Nobody sees the deck; only you see your hand.
The engine enforces this everywhere: in bots, in online play, in replays.

Setup, turns and Energy, each rule citing the section of your rulebook that says the same thing,
and taking its numbers from `constants`:

```
setup = [
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

`cost-resource` says that when a card shows `cost = 2`, it means 2 Energy.

`cites = @rulebook.sections.setup` connects a rule to the text that explains it. When a game is
played, every event a rule causes carries that reference, so a player can always ask "why did
that happen?" and get the rulebook's answer.

> [!TIP]
> **Ask your agent:** "Make the game playable: add the zones, setup, turn and Energy rules that
> rulebook sections 3 to 5 describe."

## 10. Creatures, attacking and winning

The rest of the rulebook: Creatures, attacks and Life. Add `@combat` and `@life` to `uses`, and
`@combat.actions.attack` to the allowed actions:

```
  Actions {
    allowed = [
      @common.actions.play
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
  DefeatAtHealth { cites = @rulebook.sections.creatures }
]

combat = [
  AttackerChooses { targets = [unit, life], cites = @rulebook.sections.attacking }
  AttackerMustBeReady { cites = @rulebook.sections.attacking }
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
- `AttackerChooses { targets = [unit, life] }`: the attacker picks either a Creature or the
  opponent.
- `AttackerMustBeReady`: only ready Creatures attack, and attacking exhausts them.
- `CombatDamageEqualsPower`, `SimultaneousDamage`: two Creatures fighting deal their Power to each
  other at the same time.
- `LifeDamageEqualsPower`: attacking the opponent costs them Life equal to the attacker's Power.
- `DamageClearsAt`: damage heals at the end of the turn.
- `LifeCounter`: section 1, starting at `@starting-life`, the same number the rulebook prints.

```bash
tcg check
```

```
hello-tcg: 0 errors
  Printable   yes
  Playable    not yet: 4 cards' text has no handler
  note  rulebook.alex  Section 'decks' is cited by no rule.
```

The note is the rulebook check at work: a section that explains no rule is either a rule you
haven't added yet or a mistake. Deck rules come in chapter 13.

> [!TIP]
> **Ask your agent:** "Add the rules for Creatures, attacking and winning from rulebook sections
> 1, 6 and 7."

## 11. What the cards do

Each card's text says what it does, in words. For the engine, that needs a small program: a
**handler**. Handlers live in a rules file next to your cards. Create `card-rules.alex`:

```
#type Rules

for = @cards

effect draw-a-card { draw() }
@hello.on-enter = draw-a-card
```

`for = @cards` says which cards this file programs. The cards file never mentions its rules file,
so the cards read the same, and print the same, whether or not they're programmed.

`effect draw-a-card { draw() }` is the program: draw a card. `@hello.on-enter = draw-a-card`
attaches it to Hello, and says when it runs: when Hello enters play. Handlers are short on
purpose: they use the words the libraries give you (`draw`, `damage`, `destroy`, `choose`…), and
each one is a line or two.

The other three:

```
static others-get-bonus { units(own, other).grant(power: +card.bonus) }
@cheer.static = others-get-bonus

effect damage-opponent { opponent.damage-life(card.damage) }
@spark.on-play = damage-opponent

effect destroy-a-creature { choose(all).destroy() }
@goodbye.on-play = destroy-a-creature
```

- Cheer's handler is a `static`: not something that happens, but something that is true while the
  card is in play. It reads as: "my units, other than this one, are granted the card's bonus in
  power". `card.bonus` is the constant printed on the card. When Cheer leaves the board, the
  bonus goes away by itself.
- `@spark.on-play` runs when Spark is played, and deals `card.damage`, the same number the card
  prints.
- `choose(all)` asks the player who played Goodbye to pick a Creature, any player's. You don't
  write any screen or button for that. The engine asks whoever is playing that seat: a person
  sees the Creatures highlighted on the table, a bot weighs its options, an LLM player reads a
  list.

Every card with text must have a handler, and every handler must belong to a card with text, so
the card and what it does can't disagree silently. `tcg check` also notes a digit typed straight
into a handler, like `grant(power: +1)`: that's a number the card's text doesn't know about.

### Scenarios

Prove the handlers work. A **scenario** sets up a situation, does something, and checks the
result. The words scenarios use (`hand`, `deck`, `counter-is`, `in-zone`…) come from the
`scenarios` library, so add `@scenarios` to `uses`. Then add two scenarios to
`card-rules.alex`:

```
scenario 'Hello draws a card when it enters' {
  given hand(me, @hello)
    deck(me, @friend)
    counter-is(me, @Energy, 2)
  when play(me, @hello)
  then in-zone(@friend, @Hand)
}

scenario 'Goodbye destroys the chosen Creature' {
  given controls(opponent, @cheer)
    controls(opponent, @friend)
    hand(me, @goodbye)
    counter-is(me, @Energy, 3)
  when play(me, @goodbye, target: @cheer)
  then in-zone(@cheer, @Discard)
    power(@friend) == 1
}
```

The second also checks that Friend loses Cheer's bonus once Cheer is gone.

```bash
tcg test
```

```
hello-tcg: 2 scenarios, 2 passed
  ✓ Hello draws a card when it enters
  ✓ Goodbye destroys the chosen Creature
```

Scenarios are your game's tests. Every time you or your agent changes something, `tcg test` tells
you whether a card still does what its text says.

> [!TIP]
> **Ask your agent:** "Write the handlers for Hello, Cheer, Spark and Goodbye, and a scenario for
> each."

## 12. Your first game

```bash
tcg check
```

```
hello-tcg: 0 errors
  Printable   yes
  Playable    yes
  note  rulebook.alex  Section 'decks' is cited by no rule.
```

Watch two bots play:

```bash
tcg sim --decks swarm big --seed 7
```

```
Hello TCG · seed 7 · Swarm (Player 1, random bot) vs Big (Player 2, random bot)

Setup    Both decks are shuffled. Each player draws 3.              [Setting up]
         Player 2 goes first.                                        [Your turn]
Round 1  Player 2: Energy 1. Plays Spark: Player 1's Life 10 → 8.
         Player 1: draws. Energy 1. Plays Friend.
Round 2  Player 2: draws. Energy 2. Plays Hello, draws a card.
         Player 1: draws. Energy 2. Plays Cheer. Friend attacks Player 2: Life 10 → 8.
                                                                     [Attacking]
...
Round 9  Player 1: Friend attacks Player 2: Life 2 → 0.
Game over: Player 1 wins in round 9.                                 [Winning]
```

The words in brackets are the rulebook sections the rules cite. When something in a game
surprises you, that's where to look.

The same seed always plays the same game, so `--seed 7` shows you this exact game again. Any
game, from a bot run or from online play, can be replayed this way.

> [!NOTE]
> **In Studio:** press **Play** above the table. The two bots play in front of you, and you can
> step through the game one action at a time. Click any event to jump to the rule that caused it.

## 13. Deck rules and a playtest

Section 2 of the rulebook says how decks are built; the engine doesn't know it yet. Add `@decks`
to `uses`, and:

```
deck-rules = [
  DeckSize { n = @deck-size, cites = @rulebook.sections.decks }
  CopiesMax { n = @max-copies, cites = @rulebook.sections.decks }
]
```

Now `tcg check` checks every deck against them, and the note about section 2 is gone.

Then the question every designer asks: is it fair? Let bots play a thousand games:

```bash
tcg playtest --decks swarm big --games 1000
```

```
Hello TCG · 1000 games · Swarm vs Big · search bots · seats alternate · 14 s

           Wins   Win rate   likely range
Swarm       641     64.1%    61.1 – 67.0
Big         347     34.7%    31.8 – 37.7
Draws        12      1.2%

Game length: median 8 rounds (most games 5 – 13)

Cards (win rate in games where the card was played):
  Cheer        71%   played in 82% of Swarm's games
  Friend       66%
  Spark        58%
  Hello        55%
  Goodbye      49%   Big played it on Cheer in 61% of those games
  Big Friend   44%

Swarm wins 64% of games. Evenly matched decks usually land between 45% and 55%.
Report saved to out/playtests/2026-09-28-1412.md
```

The search bots aren't written for your game. They try out their legal moves and keep the ones
that tend to win, so they play any game the engine can run, including yours as soon as it checks.

Cheer looks strong. Make it cost 3 in `cards.alex`:

```
    name = 'Cheer', cost = 3, power = 1, health = 2
```

```bash
tcg playtest --decks swarm big --games 1000
```

```
           Wins   Win rate   likely range
Swarm       532     53.2%    50.1 – 56.3
Big         455     45.5%    42.4 – 48.6
Draws        13      1.3%
```

That's the loop you'll use most: change a card, playtest, read the report, repeat. When you're
happy, `tcg cards --print` makes new print files: the printed Cheer shows the new cost, because
it's the same card.

> [!NOTE]
> **In Studio:** the **Playtests** tab lists every run with its report, and shows two runs side by
> side, so you can see what a change did.

> [!TIP]
> **Ask your agent:** "Swarm wins too often. Try a few changes to Cheer, playtest each one, and
> tell me which brings the decks closest to even." Agents are good at this: they can run many
> playtests while you do something else. Review what they changed before you keep it.

## 14. Play it

With a person:

```bash
tcg play --decks swarm big
```

This opens the game table in your browser for two players on one screen (hot-seat). Or
play against a bot:

```bash
tcg play --decks swarm big --opponent bot
```

The table is laid out from your zones, and the cards are rendered from your card data. The
engine enforces every rule. You can only do what's legal, and when it's your opponent's turn,
their hand is hidden.

With a friend somewhere else, use the online service. You need an account:

```bash
tcg login
tcg push
```

```
Pushed Hello TCG (commit 3f2a91c) to your games.
Invite a player:  tcg invite
```

```bash
tcg invite --deck swarm
```

```
Invite link (valid 7 days): https://play.tcg.example/j/K7QX-2M
```

Send the link. Your friend opens it in a browser, picks a deck and plays: no installing, no
printing. The service runs exactly the game you pushed, so when you push a change, new games use
it and games in progress finish on the version they started with.

Every online game is saved as its seed and its actions, so you can watch it again with
`tcg replay`, or turn a surprising moment into a scenario.

## 15. Starting from rules you already have

You may already have a rulebook, in a document or in your head. Instead of building step by step,
you can give it to your agent and let it write the whole game.

Put your rules in the project folder, say `my-rules.md`, and ask:

> [!TIP]
> **Ask your agent:** "Read my-rules.md and write this game: the rulebook sections, the cards,
> the game's rules and a handler and scenario for every card with text. Use library rules wherever
> you can. Run tcg check and tcg test until both pass, then run a short playtest and tell me what
> you found."

Or only the first half, for a printed game: "Read my-rules.md and write the cards and the
rulebook, ready to print."

Your agent reads `AGENTS.md`, picks rules from the libraries, and runs the same commands you've
used here until everything checks. What comes back won't be the same every time, so review it
the way you'd review anyone's work:

- **Read the rulebook it wrote.** `tcg rulebook` and open the HTML. Is that your game?
- **Read `tcg check`'s notes.** They point at sections no rule explains and rules no section
  explains, which is where misunderstandings show up.
- **Read the scenarios.** Each one is a sentence about a card. Do they say what you meant?
- **Watch a game** with `tcg sim`, or play one with `tcg play`.

If your game needs something no library has, a new way to win or a new kind of turn, your agent
will say so rather than invent it. Most games need nothing new: the libraries were built from
more than 150 published card games.

## Where next

- **Your own game.** `tcg new my-game`: cards and a rulebook first, rules when you want the
  computer to play it.
- **How cards look.** Designing your own card frames and card backs, and the sizes and finishes
  printers offer, have their own guide.
- **The library reference.** Every library, every rule, and what its numbers mean.
- **Folkborn.** A complete, published game built with this toolkit, as an example of a bigger
  project.

---

## The finished game

At the end of the walkthrough, your folder holds:

```
hello-tcg/
  hello-tcg.alex
  rulebook.alex
  cards.alex
  card-rules.alex
  art/
    friend.png
    big-friend.png
    hello.png
    cheer.png
    spark.png
    goodbye.png
    card-back.png
  AGENTS.md
```

These are the complete Alex files. The images are whatever pictures you chose. At the end of
Part 1 the folder is the same without `card-rules.alex`, with only the first part of
`hello-tcg.alex` (down to the card types), and with Cheer still costing 2.

### hello-tcg.alex

```
#type Game

name = 'Hello TCG'
schema-version = 1
rulebook = @rulebook
card-back = 'art/card-back.png'

constants = [
  starting-life = 10
  opening-hand = 3
  energy-growth = 1
  max-energy = 3
  deck-size = 12
  max-copies = 3
]

type Creature : Card {
  cost: int
  power: int
  health: int
}
type Spell : Card {
  cost: int
}

uses = [
  @common
  @units
  @spells
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
]

setup = [
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
  DefeatAtHealth { cites = @rulebook.sections.creatures }
]

spells = [
  SpellCards { types = [@Spell], cites = @rulebook.sections.spells }
]

combat = [
  AttackerChooses { targets = [unit, life], cites = @rulebook.sections.attacking }
  AttackerMustBeReady { cites = @rulebook.sections.attacking }
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
  attacking = Section { number = '7', title = 'Attacking', text = @attacking-text }
  spells = Section { number = '8', title = 'Spells', text = @spells-text }
]

@@@ winning-text
Each player starts with {@starting-life} Life. When your opponent has no Life left, you win.
@@@ decks-text
A deck has exactly {@deck-size} cards, with at most {@max-copies} copies of any card.
@@@ setup-text
Each player shuffles their deck and draws {@opening-hand} cards. A random player goes first.
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
discard pile.
@@@ attacking-text
On your turn, each of your ready Creatures may attack once. Exhaust it and choose what it
attacks: your opponent, or one of their Creatures. If it attacks your opponent, they lose Life
equal to its Power. If it attacks a Creature, both deal damage equal to their Power to each
other. Damage is removed at the end of the turn.
@@@ spells-text
A Spell does what its text says, once, and then goes to your discard pile.
@@@
```

### cards.alex

```
#type Cards

cards = [
  friend = Creature {
    name = 'Friend', cost = 1, power = 1, health = 1
    art = 'art/friend.png'
    flavor = 'Always there.'
  }
  big-friend = Creature {
    name = 'Big Friend', cost = 3, power = 3, health = 3
    art = 'art/big-friend.png'
    flavor = 'Bigger hugs.'
  }
  hello = Creature {
    name = 'Hello', cost = 2, power = 1, health = 1
    art = 'art/hello.png'
    text = 'When Hello enters, draw a card.'
    flavor = 'Nice to meet you.'
  }
  cheer = Creature {
    name = 'Cheer', cost = 3, power = 1, health = 2
    art = 'art/cheer.png'
    text = 'Your other Creatures have +{bonus} Power.'
    constants = [bonus = 1]
    flavor = 'Louder together.'
  }
  spark = Spell {
    name = 'Spark', cost = 1
    art = 'art/spark.png'
    text = 'Deal {damage} damage to your opponent.'
    constants = [damage = 2]
    flavor = 'Small, bright, rude.'
  }
  goodbye = Spell {
    name = 'Goodbye', cost = 3
    art = 'art/goodbye.png'
    text = 'Destroy a Creature.'
    flavor = 'See you around.'
  }
]

decks = [
  swarm = Deck {
    name = 'Swarm',
    cards = [
      [@friend, 3],
      [@cheer, 3],
      [@hello, 3],
      [@spark, 3]
    ]
  }
  big = Deck {
    name = 'Big',
    cards = [
      [@big-friend, 3],
      [@hello, 3],
      [@goodbye, 3],
      [@spark, 3]
    ]
  }
]
```

### card-rules.alex

```
#type Rules

for = @cards

effect draw-a-card { draw() }
@hello.on-enter = draw-a-card

static others-get-bonus { units(own, other).grant(power: +card.bonus) }
@cheer.static = others-get-bonus

effect damage-opponent { opponent.damage-life(card.damage) }
@spark.on-play = damage-opponent

effect destroy-a-creature { choose(all).destroy() }
@goodbye.on-play = destroy-a-creature

scenario 'Hello draws a card when it enters' {
  given hand(me, @hello)
    deck(me, @friend)
    counter-is(me, @Energy, 2)
  when play(me, @hello)
  then in-zone(@friend, @Hand)
}

scenario 'Goodbye destroys the chosen Creature' {
  given controls(opponent, @cheer)
    controls(opponent, @friend)
    hand(me, @goodbye)
    counter-is(me, @Energy, 3)
  when play(me, @goodbye, target: @cheer)
  then in-zone(@cheer, @Discard)
    power(@friend) == 1
}
```
