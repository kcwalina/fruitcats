# Walkthrough: your first card game

In this walkthrough you build **Hello TCG**, a very small two-player card game, from an empty
folder to a game you can playtest with bots, play online with a friend, and print: a rulebook,
and real, physical cards you can shuffle and play at a table. It takes about an hour.

Hello TCG is deliberately simple: six cards, one page of rules. It is not meant to be fun. It
is meant to show every part of the toolkit once, so that when you build your own game you know
where everything goes.

## What you need

- **The `tcg` tool**, free. It creates projects, checks them, runs tests, plays games with bots,
  and renders rulebooks and cards.
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
  say what the game is: its rules, its rulebook, its cards.
- **Assets**: the files the Alex files point at. Mostly images (card art, card frames, icons,
  pictures for the rulebook), and other media your game uses.

Nothing about your game lives anywhere else: not in a database, not on a website. You can keep
the folder on your laptop, in Git, on GitHub, or all three.

There are three kinds of Alex file:

- **The game** says what the game is made of: which zones there are, how a turn goes, how you win.
  You rarely write rules from scratch. You pick them from **libraries** of rules that card games
  commonly use (life totals, attacking, drawing, energy…) and set their numbers.
- **The rulebook** is the text players read. Every rule in the game points at the rulebook section
  that explains it, so the two can't drift apart.
- **The cards**: a *set* file says what each card is (name, cost, power, the text printed on it,
  its picture), and a *rules* file says what the card's abilities do.

And the assets live next to them, in `art/`.

---

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
tcg 1.0.0 (Alex 1.0, core 1)
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
  base-set.alex           your first set of cards
  base-set-rules.alex     what those cards do
  art/                    your game's images
  AGENTS.md               instructions for coding agents

Next: cd hello-tcg, then tcg check
```

`tcg new` never makes up a game for you. Every file starts almost empty. Open `hello-tcg.alex`:

```
#type Game

name = 'Hello TCG'
engine-version = 1
rulebook = @rulebook
sets = [@base-set]
```

Two things to notice:

- `engine-version = 1` says which version of the game engine your game is written for, so a
  later engine keeps playing it exactly the same way.
- Anything you don't write has a default: no libraries, no card types, no zones, two players.
  You add those as the game grows.

The other three files. `rulebook.alex`, a rulebook with a title and no sections yet:

```
#type Rulebook

title = 'Hello TCG'
```

`base-set.alex`, a set of cards with no cards yet:

```
#type Set

id = 'BASE'
name = 'Base Set'
```

`base-set-rules.alex`, where the abilities of the set's cards will be programmed:

```
#type Rules

for = @base-set
```

### How the files fit together

`tcg` reads every `.alex` file in the project folder. Each file holds one thing, of the type its
`#type` line names, and the file's name is how other files refer to it: `@rulebook` is the
rulebook in `rulebook.alex`, and `@base-set` is the set in `base-set.alex`. There are no other
names to keep in step. Rename a file, and `tcg check` lists the references to update (Studio and
agents update them for you).

The folder holds exactly one `Game`. That is your game, and everything else joins it through a
reference:

```
hello-tcg.alex       Game       rulebook = @rulebook   ──▶  rulebook.alex        Rulebook
                                sets = [@base-set]     ──▶  base-set.alex        Set
base-set-rules.alex  Rules      for = @base-set        ──▶  base-set.alex
base-set.alex        (a card)   art = 'art/friend.png' ──▶  art/friend.png
```

- **The game lists its sets.** A folder may hold sets you're still working on; a set is in the
  game only when `sets` lists it.
- **A rules file names the set it programs.** The set itself never mentions its rules file, so the
  cards read the same whether or not their abilities are programmed yet. When `tcg` loads the
  game, it gathers every rules file whose `for` names one of the game's sets, and checks that
  every ability printed on a card has its program, and every program belongs to a printed
  ability.
- **Assets are referred to by their path** in the folder.

`art/` is empty. It is where your game's images go: card art now, and later card frames, icons
and pictures for the rulebook.

`AGENTS.md` is for coding agents. It tells them where the Alex and library references are, which
commands to run after every change (`tcg check`, then `tcg test`), and the conventions in this
walkthrough. You don't need to read it, but you may.

Check the project:

```bash
cd hello-tcg
tcg check
```

```
hello-tcg: 0 errors, 1 note
  note  The game has no way to end yet. Add a rule that decides who wins, for example a
        life total: see the `life` library.
```

A project always checks cleanly as it grows. The notes tell you what's still missing.

> [!NOTE]
> **In Studio:** run `tcg studio` in the folder. Studio opens in your browser with the files on
> the left, the rulebook in the middle, and an empty game table on the right. Everything you do
> in the rest of this walkthrough shows up there as you save.

## 3. Write down how to win

Designers usually know their rules in words before anything else. So start in the rulebook.
Open `rulebook.alex` and add a section:

```
#type Rulebook

title = 'Hello TCG'
sections = [
  winning = Section { number = '1', title = 'Winning', text = @winning }
]

@@@ winning
Each player starts with {@starting-life} Life. When your opponent has no Life left, you win.
@@@
```

`{@starting-life}` is a number the game defines. Numbers like this are where rulebooks and
games usually drift apart: the designer changes starting Life to 12 while playtesting, and the
rulebook still says 10. So every number that shapes the game lives in one place, `numbers` in
`hello-tcg.alex`, and both the rules and the rulebook read it from there. In
`hello-tcg.alex`, add:

```
numbers = [
  starting-life = 10
]
```

Now the rule itself. Life totals are in the `life` library. Add the library to `uses` and add
the rule, taking its starting Life from `numbers`:

```
uses = [@life]
```

```
life = [
  LifeCounter { name = 'Life', start = @starting-life, lose-at = 0, cites = @rulebook.winning }
]
```

Change `starting-life` to 12, and the game starts at 12 Life and `tcg rulebook` prints "Each player
starts with 12 Life." There is nothing else to update. If the rulebook names a number that
doesn't exist, or a rule uses one, `tcg check` says so. It also notes digits written straight into
rulebook text, since those are the numbers that drift.

`cites = @rulebook.winning` connects the rule to the text that explains it. When a game is
played, every event this rule causes carries that reference, so a player can always ask "why did
that happen?" and get the rulebook's answer.

```bash
tcg check
```

```
hello-tcg: 0 errors, 1 note
  note  The game has no zones yet, so nothing can be played. Add zones for the deck, the hand
        and the board.
```

> [!TIP]
> **Ask your agent:** "Players start with 10 Life and lose when it reaches 0. Add that to the
> rulebook and the game."

## 4. Set up the table

Now the parts of the table, how a game starts, and how a turn goes. First the rulebook. Add
three sections to `sections`:

```
  setup = Section { number = '3', title = 'Setting up', text = @setup }
  your-turn = Section { number = '4', title = 'Your turn', text = @your-turn }
  energy = Section { number = '5', title = 'Energy', text = @energy }
```

And their text, in the text table:

```
@@@ setup
Each player shuffles their deck and draws {@opening-hand} cards. A random player goes first.
@@@ your-turn
Players take turns. At the start of your turn, ready your exhausted cards and draw a card (the
first player skips this draw on the very first turn). Then play cards and attack in any order,
and pass when you are done.
@@@ energy
Cards cost Energy. You start with none. At the start of each of your turns, your Energy grows by
{@energy-growth}, up to {@max-energy}, and refills.
@@@
```

Now the game. The new numbers go next to `starting-life`:

```
numbers = [
  starting-life = 10
  opening-hand = 3
  energy-growth = 1
  max-energy = 3
]
```

Add the libraries:

```
uses = [@common, @life, @resources, @turns, @setup]
```

The zones. Each has a `role` that tells the libraries what it is for: `draw` takes cards from
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

Setup, turns and Energy:

```
setup = [
  ShuffleDeck { cites = @rulebook.setup }
  OpeningHand { n = @opening-hand, cites = @rulebook.setup }
]

turns = [
  FullTurns { first = random, cites = @rulebook.your-turn }
  Phases {
    phases = [
      Phase {
        name = 'Start'
        steps = [ReadyAll {}, Draw { count = 1, skip-very-first-turn = true }]
      }
    ]
  }
  Actions { allowed = [@common.actions.play, @pass] }
]

resources = [
  Energy = GrowingCounter { start = 0, max = @max-energy, pay-by = spend }
]
resource-rules = [
  GrowsAt { resource = @Energy, moment = @turn-start, by = @energy-growth }
  RefillsAt { resource = @Energy, moment = @turn-start }
]
cost-resource = @Energy
```

`cost-resource` says that when a card shows `cost = 2`, it means 2 Energy.

```bash
tcg check
```

```
hello-tcg: 0 errors, 2 notes
  note  rulebook.alex:9  Section 'energy' is cited by no rule's `cites`. GrowsAt and
        RefillsAt could cite it.
  note  There are no cards yet. Add some to base-set.alex.
```

The first note is the rulebook check at work: a section that explains no rule is probably a
mistake. Add `cites = @rulebook.energy` to the `GrowingCounter` rule and the note goes away.

> [!TIP]
> **Ask your agent:** "Add the setup, turn and Energy rules from the rulebook sections I just
> wrote."

## 5. Your first cards

Cards that stay on the board, with power and health, come from the `units` library. Your game
gives them its own name, **Creature**. In `hello-tcg.alex`:

```
uses = [@common, @units, @life, @resources, @turns, @setup]

type Creature : UnitCard {}

units = [
  UnitsEnterExhausted { cites = @rulebook.creatures }
  DefeatAtHealth { cites = @rulebook.creatures }
]
```

Your game's Creatures are the library's unit cards under your own name, so they have everything
a unit card has: a cost, power and health. Games name their card types freely (Monsters, Allies,
Characters); the library supplies what they do. Declaring the type is all it takes: your game's
card types are the types it declares.

The rulebook section:

```
  creatures = Section { number = '6', title = 'Creatures', text = @creatures }
```

```
@@@ creatures
Creatures stay on the board. A Creature enters exhausted, so it can't attack on the turn you
play it. When a Creature has taken damage equal to its Health, it is defeated and goes to the
discard pile.
@@@
```

Now open `base-set.alex` and add two cards:

```
#type Set

id = 'BASE'
name = 'Base Set'

cards = [
  friend = Creature {
    name = 'Friend', cost = 1, power = 1, health = 1
    flavor = 'Always there.'
  }
  big-friend = Creature {
    name = 'Big Friend', cost = 3, power = 3, health = 3
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

Until you design your own card frame, cards use a plain default frame that shows the name, cost,
power, health and text.

Now give them pictures. Any image works for now: a sketch, a photo of a drawing. Save two images
as `art/friend.png` and `art/big-friend.png`, and point each card at its picture:

```
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
```

The images are part of your game just as the Alex files are: they go into Git with everything
else, and `tcg check` tells you if a card points at a picture that isn't there:

```
hello-tcg: 1 error
  error  base-set.alex:15  Big Friend's art 'art/big-friend.png' doesn't exist.
```

Render the cards again with `tcg cards friend big-friend`, and the pictures are in the frame.

> [!NOTE]
> **In Studio:** click `friend` in `base-set.alex`. The card appears as it will look, with a
> property grid beside it. Change **Cost** from 1 to 2 in the grid, and the line in
> `base-set.alex` changes to `cost = 2`. Change it back in the file, and the grid follows. The
> file is always the truth; the grid is a view of it.

> [!TIP]
> **Ask your agent:** "Add a Creature type, and two vanilla Creatures: Friend (cost 1, 1/1) and
> Big Friend (cost 3, 3/3)."

## 6. Attacking

Creatures that can't attack don't do much. Attacking comes from the `combat` library. Add it to
`uses`, allow the attack action, and pick the rules:

```
uses = [@common, @units, @combat, @life, @resources, @turns, @setup]
```

```
  Actions { allowed = [@common.actions.play, @combat.actions.attack, @pass] }
```

```
combat = [
  AttackerChooses { targets = [unit, life], cites = @rulebook.attacking }
  AttackerMustBeReady { cites = @rulebook.attacking }
  CombatDamageEqualsPower {}
  SimultaneousDamage {}
  LifeDamageEqualsPower {}
  DamageClearsAt { moment = @turn-end }
]
```

Each rule is one sentence of the rulebook:

- `AttackerChooses { targets = [unit, life] }`: the attacker picks either a Creature or the
  opponent.
- `AttackerMustBeReady`: only ready Creatures attack, and attacking exhausts them.
- `CombatDamageEqualsPower`, `SimultaneousDamage`: two Creatures fighting deal their Power to each
  other at the same time.
- `LifeDamageEqualsPower`: attacking the opponent costs them Life equal to the attacker's Power.
- `DamageClearsAt`: damage heals at the end of the turn.

The rulebook section:

```
  attacking = Section { number = '7', title = 'Attacking', text = @attacking }
```

```
@@@ attacking
On your turn, each of your ready Creatures may attack once. Exhaust it and choose what it
attacks: your opponent, or one of their Creatures. If it attacks your opponent, they lose Life
equal to its Power. If it attacks a Creature, both deal damage equal to their Power to each
other. Damage is removed at the end of the turn.
@@@
```

> [!TIP]
> **Ask your agent:** "Creatures can attack the opponent or a Creature. Use the usual rules:
> both deal their Power, damage heals at the end of the turn."

## 7. Your first game

You need a deck to play. Decks are listed in the set. Add this to `base-set.alex`:

```
decks = [
  first-deck = Deck { name = 'First Deck', cards = [[@friend, 6], [@big-friend, 6]] }
]
```

Now watch two bots play it:

```bash
tcg sim --decks first-deck first-deck --seed 7
```

```
Hello TCG · seed 7 · First Deck (Player 1, random bot) vs First Deck (Player 2, random bot)

Setup    Both decks are shuffled. Each player draws 3.              [Setting up]
         Player 2 goes first.                                        [Your turn]
Round 1  Player 2: Energy 1. Plays Friend.
         Player 1: draws. Energy 1. Plays Friend.
Round 2  Player 2: draws. Energy 2. Friend attacks Player 1: Life 10 → 9.   [Attacking]
         Player 1: draws. Energy 2. Friend attacks Friend: both defeated.   [Creatures]
...
Round 9  Player 2: Big Friend attacks Player 1: Life 2 → 0.
Game over: Player 2 wins in round 9.                                 [Winning]
```

The words in brackets are the rulebook sections the rules cite. When something in a game
surprises you, that's where to look.

The same seed always plays the same game, so `--seed 7` shows you this exact game again. Any
game, from a bot run or from online play, can be replayed this way.

> [!NOTE]
> **In Studio:** press **Play** above the table. The two bots play in front of you, and you can
> step through the game one action at a time. Click any event to jump to the rule that caused it.

## 8. A card that does something

Now a card with an ability. Add **Hello** to `cards` in `base-set.alex`:

```
  hello = Creature {
    name = 'Hello', cost = 2, power = 1, health = 1
    abilities = [OnEnter { text = 'When Hello enters, draw a card.' }]
  }
```

`OnEnter { text = '...' }` says two things: the card has an ability that happens when it enters
play, and this is the text printed on the card. It doesn't say what the ability *does*. Check:

```bash
tcg check
```

```
hello-tcg: 1 error
  error  base-set.alex:17  Hello has an OnEnter ability, but nothing says what it does.
         Add a handler to base-set-rules.alex, for example:

           effect hello-draws { draw(1) }
           @hello.on-enter = hello-draws
```

Every ability printed on a card must have a handler, and every handler must belong to an ability
printed on a card. So the card and what it does can never disagree silently.

Open `base-set-rules.alex` and write the handler:

```
#type Rules

for = @base-set

effect draw-a-card { draw() }
@hello.on-enter = draw-a-card
```

`effect draw-a-card { draw() }` is the ability's program: draw a card. `@hello.on-enter =
draw-a-card` attaches it to Hello. Handlers are short on purpose: they use the words the
libraries give you (`draw`, `damage`, `destroy`, `choose`…), and each one is a line or two.

Now prove it works. A **scenario** sets up a situation, does something, and checks the result.
The words scenarios use (`hand`, `deck`, `counter-is`, `in-zone`…) come from the `scenarios`
library, so add `@scenarios` to `uses` in `hello-tcg.alex`. Then add a scenario below the
handler:

```
scenario 'Hello draws a card when it enters' {
  given hand(me, [@hello]), deck(me, [@friend]), counter-is(me, @Energy, 2)
  when play(me, @hello)
  then in-zone(@friend, @Hand)
}
```

```bash
tcg test
```

```
hello-tcg: 1 scenario, 1 passed
  ✓ Hello draws a card when it enters
```

Scenarios are your game's tests. Every time you or your agent changes something, `tcg test` tells
you whether a card still does what its text says.

> [!TIP]
> **Ask your agent:** "Add Hello: a Creature, cost 2, 1/1, 'When Hello enters, draw a card.'
> Write its handler and a scenario for it."

## 9. Three more cards

**Cheer** makes your other Creatures stronger for as long as it is on the board. That is a
*static* ability. Add it to `cards`:

```
  cheer = Creature {
    name = 'Cheer', cost = 2, power = 1, health = 2
    abilities = [
      Static {
        text = 'Your other Creatures have +{bonus} Power.'
        numbers = [bonus = 1]
      }
    ]
  }
```

The ability has a number, `bonus`, and its printed text shows it as `{bonus}`. It's the same idea
as the game's `numbers`, for one ability: the card says "+1 Power" because `bonus` is 1, so the
text on the card and what the card does can't disagree.

And its handler to `base-set-rules.alex`:

```
static others-get-bonus { units(own, other).grant(power: +ability.bonus) }
@cheer.static = others-get-bonus
```

Read it as: "my units, other than this one, are granted the ability's bonus in power".
`ability.bonus` is the number from the card. A static isn't something that happens; it's
something that is true while the card is in play. When Cheer leaves the board, the bonus goes
away by itself.

`tcg check` holds the two together: a `{name}` in the text that the ability doesn't have is an
error, and so is a number the text never shows, because players would be playing with a number
they can't see. It also notes a digit written straight into a handler, like `grant(power: +1)`:
that's a number the card's text doesn't know about.

**Spark** and **Goodbye** are spells: you play them, they do something once, and they go to the
discard pile. Spells come from the `spells` library, and your game calls them **Spell**. In
`hello-tcg.alex`:

```
uses = [@common, @units, @spells, @combat, @life, @resources, @turns, @setup, @scenarios]

type Spell : SpellCard {}
```

The cards:

```
  spark = Spell {
    name = 'Spark', cost = 1
    abilities = [
      OnPlay { text = 'Deal {damage} damage to your opponent.', numbers = [damage = 2] }
    ]
  }
  goodbye = Spell {
    name = 'Goodbye', cost = 3
    abilities = [OnPlay { text = 'Destroy a Creature.' }]
  }
```

Their handlers:

```
effect damage-opponent { opponent.damage-life(ability.damage) }
@spark.on-play = damage-opponent

effect goodbye { choose(all).destroy() }
@goodbye.on-play = goodbye
```

`choose(all)` asks the player who played Goodbye to pick a Creature, any player's. You don't
write any screen or button for that. The engine asks whoever is playing that seat: a person
sees the Creatures highlighted on the table, a bot weighs its options, an LLM player reads a list.

A scenario with a choice in it:

```
scenario 'Goodbye destroys the chosen Creature' {
  given controls(opponent, @cheer), controls(opponent, @friend)
  given hand(me, [@goodbye]), counter-is(me, @Energy, 3)
  when play(me, @goodbye, target: @cheer)
  then in-zone(@cheer, @Discard), power(@friend) == 1
}
```

It also checks that Friend loses Cheer's bonus once Cheer is gone.

```bash
tcg check
tcg test
```

```
hello-tcg: 0 errors, 1 note
  note  rulebook.alex  No section explains spells. The rulebook's card list will show
        Spark and Goodbye, but players won't know what a Spell is.

hello-tcg: 2 scenarios, 2 passed
```

Add a section:

```
  spells = Section { number = '8', title = 'Spells', text = @spells }
```

```
@@@ spells
A Spell does what its text says, once, and then goes to your discard pile.
@@@
```

> [!TIP]
> **Ask your agent:** "Add Cheer, Spark and Goodbye as described in the walkthrough's chapter 9,
> with scenarios."

## 10. Two decks and a playtest

A real game has rules about decks. Add two numbers:

```
  deck-size = 12
  max-copies = 3
```

Add the `decks` library to `uses`, and:

```
deck-rules = [
  DeckSize { n = @deck-size, cites = @rulebook.decks }
  CopiesMax { n = @max-copies, cites = @rulebook.decks }
]
```

```
  decks = Section { number = '2', title = 'Your deck', text = @decks }
```

```
@@@ decks
A deck has exactly {@deck-size} cards, with at most {@max-copies} copies of any card.
@@@
```

```bash
tcg check
```

```
hello-tcg: 2 errors
  error  base-set.alex:34  First Deck has 6 copies of Friend. A deck may have at most 3.
                           [Your deck]
  error  base-set.alex:34  First Deck has 6 copies of Big Friend. A deck may have at most 3.
                           [Your deck]
```

Your new rule caught your old deck. Replace `decks` in `base-set.alex` with two real ones:

```
decks = [
  swarm = Deck {
    name = 'Swarm', cards = [[@friend, 3], [@cheer, 3], [@hello, 3], [@spark, 3]]
  }
  big = Deck {
    name = 'Big', cards = [[@big-friend, 3], [@hello, 3], [@goodbye, 3], [@spark, 3]]
  }
]
```

Now the question every designer asks: is it fair? Let bots play a thousand games:

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

Cheer looks strong. Make it cost 3 in `base-set.alex`:

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

That's the loop you'll use most: change a card, playtest, read the report, repeat.

> [!NOTE]
> **In Studio:** the **Playtests** tab lists every run with its report, and shows two runs side by
> side, so you can see what a change did.

> [!TIP]
> **Ask your agent:** "Swarm wins too often. Try a few changes to Cheer, playtest each one, and
> tell me which brings the decks closest to even." Agents are good at this: they can run many
> playtests while you do something else. Review what they changed before you keep it.

## 11. Play it

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

## 12. The rulebook

```bash
tcg rulebook
```

```
Rendered the rulebook:
  out/rulebook/index.html
  out/rulebook/hello-tcg-rulebook.pdf
```

It contains every section you wrote, in order, and a card list made from `base-set.alex`: each
card as it looks, with its text. You never copy a card's text into the rulebook, so the two can't
disagree.

`tcg check` keeps the rulebook honest: a rule that cites a section that doesn't exist is an error,
and a rule with no citation, or a section no rule cites, is a note.

## 13. Print your cards

When you want the game on a table, not just on a screen:

```bash
tcg cards --print --decks swarm big
```

```
Rendered 24 cards (2 decks × 12) for printing:
  out/print/hello-tcg-cards.pdf      fronts and backs, with bleed and crop marks
  out/print/fronts/*.png             one image per card, at print resolution
  out/print/backs/back.png
```

These are the files online card printers ask for: each card at print resolution with the extra
margin (bleed) the cutter needs, plus a card back. Upload them to a printer, or print the PDF at
home and cut along the marks. Together with the rulebook PDF from chapter 12, that's a copy of
your game you can play with people in the same room.

## 14. Starting from rules you already have

You may already have a rulebook, in a document or in your head. Instead of building step by step,
you can give it to your agent and let it write the whole game.

Put your rules in the project folder, say `my-rules.md`, and ask:

> [!TIP]
> **Ask your agent:** "Read my-rules.md and write this game: the rulebook sections, the game's
> rules, the cards and a scenario for every card ability. Use library rules wherever you can.
> Run tcg check and tcg test until both pass, then run a short playtest and tell me what you
> found."

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

- **Your own game.** `tcg new my-game`, and grow it the same way: rulebook, rules, cards,
  scenarios, playtests.
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
  base-set.alex
  base-set-rules.alex
  art/
    friend.png
    big-friend.png
  AGENTS.md
```

These are the complete Alex files. The two images are whatever pictures you chose.

### hello-tcg.alex

```
#type Game

name = 'Hello TCG'
engine-version = 1
rulebook = @rulebook
uses = [
  @common, @units, @spells, @combat, @life, @resources, @turns, @setup, @decks, @scenarios
]
sets = [@base-set]

numbers = [
  starting-life = 10
  opening-hand = 3
  energy-growth = 1
  max-energy = 3
  deck-size = 12
  max-copies = 3
]

type Creature : UnitCard {}
type Spell : SpellCard {}

zones = [
  Deck = Zone { role = deck, shape = pile, visible = none }
  Hand = Zone { role = hand, shape = set, visible = owner }
  Board = Zone { role = board, shape = row, visible = all }
  Discard = Zone { role = discard, shape = pile, visible = all }
]

life = [
  LifeCounter { name = 'Life', start = @starting-life, lose-at = 0, cites = @rulebook.winning }
]

setup = [
  ShuffleDeck { cites = @rulebook.setup }
  OpeningHand { n = @opening-hand, cites = @rulebook.setup }
]

turns = [
  FullTurns { first = random, cites = @rulebook.your-turn }
  Phases {
    phases = [
      Phase {
        name = 'Start'
        steps = [ReadyAll {}, Draw { count = 1, skip-very-first-turn = true }]
      }
    ]
  }
  Actions { allowed = [@common.actions.play, @combat.actions.attack, @pass] }
]

resources = [
  Energy = GrowingCounter { start = 0, max = @max-energy, pay-by = spend, cites = @rulebook.energy }
]
resource-rules = [
  GrowsAt { resource = @Energy, moment = @turn-start, by = @energy-growth }
  RefillsAt { resource = @Energy, moment = @turn-start }
]
cost-resource = @Energy

units = [
  UnitsEnterExhausted { cites = @rulebook.creatures }
  DefeatAtHealth { cites = @rulebook.creatures }
]

combat = [
  AttackerChooses { targets = [unit, life], cites = @rulebook.attacking }
  AttackerMustBeReady { cites = @rulebook.attacking }
  CombatDamageEqualsPower {}
  SimultaneousDamage {}
  LifeDamageEqualsPower {}
  DamageClearsAt { moment = @turn-end }
]

deck-rules = [
  DeckSize { n = @deck-size, cites = @rulebook.decks }
  CopiesMax { n = @max-copies, cites = @rulebook.decks }
]
```

### rulebook.alex

```
#type Rulebook

title = 'Hello TCG'
sections = [
  winning = Section { number = '1', title = 'Winning', text = @winning }
  decks = Section { number = '2', title = 'Your deck', text = @decks }
  setup = Section { number = '3', title = 'Setting up', text = @setup }
  your-turn = Section { number = '4', title = 'Your turn', text = @your-turn }
  energy = Section { number = '5', title = 'Energy', text = @energy }
  creatures = Section { number = '6', title = 'Creatures', text = @creatures }
  attacking = Section { number = '7', title = 'Attacking', text = @attacking }
  spells = Section { number = '8', title = 'Spells', text = @spells }
]

@@@ winning
Each player starts with {@starting-life} Life. When your opponent has no Life left, you win.
@@@ decks
A deck has exactly {@deck-size} cards, with at most {@max-copies} copies of any card.
@@@ setup
Each player shuffles their deck and draws {@opening-hand} cards. A random player goes first.
@@@ your-turn
Players take turns. At the start of your turn, ready your exhausted cards and draw a card (the
first player skips this draw on the very first turn). Then play cards and attack in any order,
and pass when you are done.
@@@ energy
Cards cost Energy. You start with none. At the start of each of your turns, your Energy grows by
{@energy-growth}, up to {@max-energy}, and refills.
@@@ creatures
Creatures stay on the board. A Creature enters exhausted, so it can't attack on the turn you
play it. When a Creature has taken damage equal to its Health, it is defeated and goes to the
discard pile.
@@@ attacking
On your turn, each of your ready Creatures may attack once. Exhaust it and choose what it
attacks: your opponent, or one of their Creatures. If it attacks your opponent, they lose Life
equal to its Power. If it attacks a Creature, both deal damage equal to their Power to each
other. Damage is removed at the end of the turn.
@@@ spells
A Spell does what its text says, once, and then goes to your discard pile.
@@@
```

### base-set.alex

```
#type Set

id = 'BASE'
name = 'Base Set'

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
    abilities = [OnEnter { text = 'When Hello enters, draw a card.' }]
  }
  cheer = Creature {
    name = 'Cheer', cost = 3, power = 1, health = 2
    abilities = [
      Static {
        text = 'Your other Creatures have +{bonus} Power.'
        numbers = [bonus = 1]
      }
    ]
  }
  spark = Spell {
    name = 'Spark', cost = 1
    abilities = [
      OnPlay { text = 'Deal {damage} damage to your opponent.', numbers = [damage = 2] }
    ]
  }
  goodbye = Spell {
    name = 'Goodbye', cost = 3
    abilities = [OnPlay { text = 'Destroy a Creature.' }]
  }
]

decks = [
  swarm = Deck {
    name = 'Swarm', cards = [[@friend, 3], [@cheer, 3], [@hello, 3], [@spark, 3]]
  }
  big = Deck {
    name = 'Big', cards = [[@big-friend, 3], [@hello, 3], [@goodbye, 3], [@spark, 3]]
  }
]
```

### base-set-rules.alex

```
#type Rules

for = @base-set

effect draw-a-card { draw() }
@hello.on-enter = draw-a-card

static others-get-bonus { units(own, other).grant(power: +ability.bonus) }
@cheer.static = others-get-bonus

effect damage-opponent { opponent.damage-life(ability.damage) }
@spark.on-play = damage-opponent

effect goodbye { choose(all).destroy() }
@goodbye.on-play = goodbye

scenario 'Hello draws a card when it enters' {
  given hand(me, [@hello]), deck(me, [@friend]), counter-is(me, @Energy, 2)
  when play(me, @hello)
  then in-zone(@friend, @Hand)
}

scenario 'Goodbye destroys the chosen Creature' {
  given controls(opponent, @cheer), controls(opponent, @friend)
  given hand(me, [@goodbye]), counter-is(me, @Energy, 3)
  when play(me, @goodbye, target: @cheer)
  then in-zone(@cheer, @Discard), power(@friend) == 1
}
```
