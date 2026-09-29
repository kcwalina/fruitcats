# Walkthrough: your first card game

In this walkthrough you build **Hello TCG**, a very small two-player card game, from an empty
folder to a game you can playtest with bots, play online with a friend, and print a rulebook
for. It takes about an hour.

Hello TCG is deliberately simple: six cards, one page of rules. It is not meant to be fun. It
is meant to show every part of the toolkit once, so that when you build your own game you know
where everything goes.

## What you need

- **The `tcg` tool**, free. It creates projects, checks them, runs tests, plays games with bots,
  and renders rulebooks and cards.
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
// Hello TCG: the game. Which libraries it uses, its zones and the rules it plays by.
hello-tcg = Game

name = 'Hello TCG'
core = '1'
rulebook = @rulebook
uses = empty
players = Players { min = 2, max = 2 }
sets = [@base-set]
types = empty
zones = empty
```

A few things to notice, since every Alex file works the same way:

- The first real line names the file's one value and says what it is: `hello-tcg = Game`.
- Each following line sets one field: `name = 'Hello TCG'`.
- Quotes are only for text people read. Anything the tools understand is a name (`empty`) or a
  reference to something else, written with `@` (`@rulebook`, `@base-set`).
- `empty` means an empty list.

`rulebook.alex` has a title and no sections yet. `base-set.alex` is a set with no cards.
`base-set-rules.alex` has nothing in it but a line saying it belongs to `@base-set`.

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
// Hello TCG rulebook. Each section is text for players; rules in hello-tcg.alex cite them.
rulebook = Rulebook

title = 'Hello TCG'
sections = [
  winning = Section { number = '1', title = 'Winning', text = @winning }
]

@@@ winning
Each player starts with 10 Life. When your opponent's Life reaches 0, you win.
@@@
```

Long text goes in a *text table* at the end of the file: `@@@ winning` starts the text named
`winning`, and a bare `@@@` ends the table.

Now the rule itself. Life totals are in the `life` library. In `hello-tcg.alex`, add the library
to `uses` and add the rule:

```
uses = [@life]
```

```
life = [
  LifeCounter { name = 'Life', start = 10, lose-at = 0, cites = @rulebook.winning }
]
```

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
Each player shuffles their 12-card deck and draws 3 cards. A random player goes first.
@@@ your-turn
Players take turns. At the start of your turn, ready your exhausted cards and draw a card (the
first player skips this draw on the very first turn). Then play cards and attack in any order,
and pass when you are done.
@@@ energy
Cards cost Energy. You have 1 Energy on your first turn, 2 on your second, and 3 from your
third turn on. Your Energy refills at the start of each of your turns.
@@@
```

Now the game. Add the libraries:

```
uses = [@common, @life, @resources, @turns, @setup]
```

The zones. Each has a `role` that tells the libraries what it is for: `draw` takes cards from
the `deck` zone into the `hand` zone.

```
zones = [
  Deck = Zone { name = nameof(Deck), role = deck, shape = pile, visible = none }
  Hand = Zone { name = nameof(Hand), role = hand, shape = set, visible = owner }
  Board = Zone { name = nameof(Board), role = board, shape = row, visible = all }
  Discard = Zone { name = nameof(Discard), role = discard, shape = pile, visible = all }
]
```

`visible` decides who may see the cards in a zone. Nobody sees the deck; only you see your hand.
The engine enforces this everywhere: in bots, in online play, in replays.

Setup, turns and Energy:

```
setup = [
  ShuffleDeck { cites = @rulebook.setup }
  OpeningHand { n = 3, cites = @rulebook.setup }
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
  Energy = GrowingCounter { name = nameof(Energy), start = 0, max = 3, pay-by = spend }
]
resource-rules = [
  GrowsAt { resource = @hello-tcg.resources.Energy, moment = @turn-start, by = 1 }
  RefillsAt { resource = @hello-tcg.resources.Energy, moment = @turn-start }
]
cost-resource = @hello-tcg.resources.Energy
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
types = [
  Creature = CardType { name = nameof(Creature) }
]

units = [
  UnitsEnterExhausted { cites = @rulebook.creatures }
  DefeatAtHealth { cites = @rulebook.creatures }
]
```

`type Creature : UnitCard {}` means "a Creature is a unit card". It has everything a unit card
has: a cost, power and health.

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
// Base Set: Hello TCG's cards and decks. What each card is; what its abilities do is in
// base-set-rules.alex.
base-set = Set

id = 'BASE'
name = 'Base Set'
core = '1'

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
// Base Set rules: what the cards' abilities do, and scenarios that test them.
base-set-rules = Rules

for = @base-set

effect draw-a-card { draw(1) }
@hello.on-enter = draw-a-card
```

`effect draw-a-card { draw(1) }` is the ability's program: draw one card. `@hello.on-enter =
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
    abilities = [Static { text = 'Your other Creatures have +1 Power.' }]
  }
```

And its handler to `base-set-rules.alex`:

```
static others-plus-one { units(own, other).grant(power: +1) }
@cheer.static = others-plus-one
```

Read it as: "my units, other than this one, are granted +1 power". A static isn't something that
happens; it's something that is true while the card is in play. When Cheer leaves the board, the
bonus goes away by itself.

**Spark** and **Goodbye** are spells: you play them, they do something once, and they go to the
discard pile. Spells come from the `spells` library, and your game calls them **Spell**. In
`hello-tcg.alex`:

```
uses = [@common, @units, @spells, @combat, @life, @resources, @turns, @setup, @scenarios]

type Spell : SpellCard {}
```

```
types = [
  Creature = CardType { name = nameof(Creature) }
  Spell = CardType { name = nameof(Spell) }
]
```

The cards:

```
  spark = Spell {
    name = 'Spark', cost = 1
    abilities = [OnPlay { text = 'Deal 2 damage to your opponent.' }]
  }
  goodbye = Spell {
    name = 'Goodbye', cost = 3
    abilities = [OnPlay { text = 'Destroy a Creature.' }]
  }
```

Their handlers:

```
effect spark { opponent.damage-life(2) }
@spark.on-play = spark

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

A real game has rules about decks. Add the `decks` library to `uses`, and:

```
deck-rules = [
  DeckSize { n = 12, cites = @rulebook.decks }
  CopiesMax { n = 3, cites = @rulebook.decks }
]
```

```
  decks = Section { number = '2', title = 'Your deck', text = @decks }
```

```
@@@ decks
A deck has exactly 12 cards, with at most 3 copies of any card.
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

## 13. Starting from rules you already have

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
- **How cards look.** Designing your own card frames and printing files for online printers
  (`tcg cards --print`) have their own guide.
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
// Hello TCG: the game. Which libraries it uses, its zones and the rules it plays by.
hello-tcg = Game

name = 'Hello TCG'
core = '1'
rulebook = @rulebook
uses = [
  @common, @units, @spells, @combat, @life, @resources, @turns, @setup, @decks, @scenarios
]
players = Players { min = 2, max = 2 }
sets = [@base-set]

type Creature : UnitCard {}
type Spell : SpellCard {}
types = [
  Creature = CardType { name = nameof(Creature) }
  Spell = CardType { name = nameof(Spell) }
]

zones = [
  Deck = Zone { name = nameof(Deck), role = deck, shape = pile, visible = none }
  Hand = Zone { name = nameof(Hand), role = hand, shape = set, visible = owner }
  Board = Zone { name = nameof(Board), role = board, shape = row, visible = all }
  Discard = Zone { name = nameof(Discard), role = discard, shape = pile, visible = all }
]

life = [
  LifeCounter { name = 'Life', start = 10, lose-at = 0, cites = @rulebook.winning }
]

setup = [
  ShuffleDeck { cites = @rulebook.setup }
  OpeningHand { n = 3, cites = @rulebook.setup }
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
  Energy = GrowingCounter {
    name = nameof(Energy), start = 0, max = 3, pay-by = spend, cites = @rulebook.energy
  }
]
resource-rules = [
  GrowsAt { resource = @hello-tcg.resources.Energy, moment = @turn-start, by = 1 }
  RefillsAt { resource = @hello-tcg.resources.Energy, moment = @turn-start }
]
cost-resource = @hello-tcg.resources.Energy

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
  DeckSize { n = 12, cites = @rulebook.decks }
  CopiesMax { n = 3, cites = @rulebook.decks }
]
```

### rulebook.alex

```
// Hello TCG rulebook. Each section is text for players; rules in hello-tcg.alex cite them.
rulebook = Rulebook

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
Each player starts with 10 Life. When your opponent's Life reaches 0, you win.
@@@ decks
A deck has exactly 12 cards, with at most 3 copies of any card.
@@@ setup
Each player shuffles their 12-card deck and draws 3 cards. A random player goes first.
@@@ your-turn
Players take turns. At the start of your turn, ready your exhausted cards and draw a card (the
first player skips this draw on the very first turn). Then play cards and attack in any order,
and pass when you are done.
@@@ energy
Cards cost Energy. You have 1 Energy on your first turn, 2 on your second, and 3 from your
third turn on. Your Energy refills at the start of each of your turns.
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
// Base Set: Hello TCG's cards and decks. What each card is; what its abilities do is in
// base-set-rules.alex.
base-set = Set

id = 'BASE'
name = 'Base Set'
core = '1'

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
    abilities = [Static { text = 'Your other Creatures have +1 Power.' }]
  }
  spark = Spell {
    name = 'Spark', cost = 1
    abilities = [OnPlay { text = 'Deal 2 damage to your opponent.' }]
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
// Base Set rules: what the cards' abilities do, and scenarios that test them.
base-set-rules = Rules

for = @base-set

effect draw-a-card { draw(1) }
@hello.on-enter = draw-a-card

static others-plus-one { units(own, other).grant(power: +1) }
@cheer.static = others-plus-one

effect spark { opponent.damage-life(2) }
@spark.on-play = spark

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
