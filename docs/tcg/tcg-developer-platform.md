# TCG developer platform

The plan for a toolkit that lets hobbyists and indie developers create trading card games that a
computer can play. It records what was decided in the planning discussion of 2026-09-28 and what
is still open. The walkthrough that shows the finished experience is
[walkthrough.md](walkthrough.md).

## Why

Tools for TCG designers today help design how cards look, so they can be printed and played at
a table. The program never understands the rules. This platform is different in three ways:

1. **The engine plays the game.** So a designer can run thousands of automatic playtests with bots
   and LLM players, the way Folkborn's nightly playtests work today, but for any game.
2. **The game can be played online as a prototype,** with the rules enforced, instead of printing
   cards and meeting in person.
3. **An agent can write the game.** A designer gives Claude or Codex the rules, and it writes the
   game's program. It works the way developers work: the game is a folder of source files, on a
   laptop or on GitHub, with command-line tools. There is no hidden state and no website the
   game has to live in.

On top of that sit an IDE (a two-way editor: change a card in a designer or in the code, both
edit the same files, like Visual Basic's form designer and code-behind) and, later, services:
cloud playtests, online hosting, storage and printing.

## Principles

- **Source is the only truth.** A game is a set of files in a repo: Alex files and images. Every
  tool reads and writes those files. Nothing lives elsewhere.
- **Layers, not a ball of twine.** Each layer depends only on the layers below it and is simple on
  its own. The bottom is a command-line toolchain; everything else builds on it.
- **Games are data, written in Alex.** Custom TypeScript is not supported at first. A future escape
  hatch, like interop in .NET, is for the rare very advanced developer.
- **Built-in rules first.** A game is mostly a selection of rules from the libraries. A custom rule
  written in Alex should be extremely rare.
- **A small language, not a general-purpose one.** Alex for games is a DSL for describing games,
  not a language for arbitrary programs.

## Architecture

### Two languages, one source format

- **C# for the tools.** The full Alex implementation (parse, bind, type-check, diagnostics), the
  `tcg` command-line tool, the language server and the VS Code extension. Alex already lives in C#
  (`mochi/mochi.agents/alex`) and other C# projects use it.
- **TypeScript for the engine.** Everything that plays a game: the runtime, the bots, the table
  and card renderers, the Studio front end and the online match host. It has to run in a browser.
- **Both read `.alex` source directly.** There is no compiled intermediate format: converting Alex
  to JSON would lose what Alex was designed to keep. The TypeScript side parses and binds what
  running a game needs. A shared conformance suite (Alex files with their expected parse trees
  and diagnostics) keeps both implementations in step. Both stay long term.
- **The engine never assumes `tcg check` ran.** An online server loads games other people wrote,
  so the TypeScript loader refuses a malformed game with a clear error instead of misbehaving.

### Layers

Each layer depends only on the ones below it.

| Layer | What it is | Language |
|---|---|---|
| L6 Services | cloud playtests, online hosting and lobbies, storage, printing | TS / C# |
| L5 Tools | the `tcg` CLI, the language server, Studio (the IDE) | C# (+ TS front end) |
| L4 Presentation | the game table, the card renderer, the rulebook renderer (HTML, PDF) | TS |
| L3 Drivers | seat drivers (human, search bot, LLM player), the match host, the playtest runner | TS |
| L2 Runtime | the engine: plays a game from its Alex source | TS |
| L1 Game loader | loads a project, links it, checks it enough to run safely | TS |
| L0 Alex | parse, bind, types, diagnostics, byte-exact round trip | C# and TS |

What each layer promises:

- **L2 Runtime** implements the core's runtime contract exactly (below). It is pure: no I/O, no
  clock, no network. Actions go in, events come out.
- **L3 Drivers** are all one kind of thing: something that picks from the legal actions for one
  seat. A search bot (random playouts or Monte Carlo tree search) needs only the engine, so every
  game gets playtest bots without writing any. The match host stores the seed and the action log,
  the pattern Folkborn's `packages/match` uses today.
- **L4 Presentation** is generic: the game declares its zones and the table lays them out; card
  templates say where a card's data goes; the rulebook renders from the same sources as the game.
- **L5 Tools**: the `tcg` CLI is what a designer and an agent use. Studio is served locally by
  `tcg studio`; its designers edit source through Alex's byte-exact round trip, so a change in a
  property grid is an edit to the `.alex` file.

### The engine contract

The TCG Alex session designed it from a survey of 156 TCGs. It lives in `cardengine/framework/`:

- `core.alex`: the object model and plug points. Objects, zones, players, counters, keywords as
  tags, randomness, the `Rule` extension point, libraries, and the program-layer machinery.
- `core-operations.alex`: the runtime contract. The state model; about 20 operations that are the
  only way state changes; queries the engine asks (legal actions, next actor, round over, game
  over, state check) and five hook kinds rules answer with (provide, filter, before, after,
  replace); input as an action stream per player; the scheduler with its drain policy; the loop
  skeleton; the event log with per-player visibility; logged randomness.
- `lib/*.alex`: the libraries (units, spells, combat, life, resources, turns, decks, setup and
  more). A game chooses libraries and lists rules from them.

The TypeScript runtime implements exactly this contract. **Alex itself has no game semantics**:
it is a general-purpose data language, closer to JSON than to C#. Our engine gives these
documents their meaning, and it implements every library rule's behaviour.

### Rules: built in, rarely custom

A game's rules come two ways:

1. **Picked from a library** (almost always). Each library rule, such as `GuardiansFirst` or
   `LifeCounter`, is implemented in the TypeScript engine; the game just lists it. The broad
   survey (`cardengine/survey/broad/summary.md`) found that 83% of 156 games fit with library
   additions only, and 4% need a small core change (grids, change of controller, ownerless
   objects, dice pools). The plan is to implement every rule the surveys found as a built-in
   rule, unless one is so specific to one obscure game that it isn't worth the added complexity
   for everyone.
2. **Written in Alex** (extremely rare). A `rule` declaration on one of the core's hook points,
   built from the core's primitives. Deferred until a concrete game needs it; we look at that
   scenario before designing it.

Card abilities are separate and not optional: every card ability has a small handler (`effect`,
`static`, `condition`) in a rules document. The same limits apply to both:

- no user functions, no recursion
- no loops except `each` over a selection
- names are bound once
- state changes only through the core's operations and the libraries' verbs
- expressions: arithmetic, comparison, property access, `if` / `else`
- calls only to vocabulary the core and libraries declare

In return every rule finishes, the tools can list what a rule reads and changes, Studio can show
any rule as a form, and agents have fewer ways to be wrong. When a game needs more, the answer is
a new library rule, not a more powerful language.

## A game project

`tcg new <name>` creates a skeleton, like `dotnet new`. It knows nothing about any game: no cards,
no rules. The designer grows the game one piece at a time, by asking an agent, by editing files,
or in Studio: add, check, test, play, repeat.

```
my-game/
  my-game.alex        the game: libraries, zones, rules (starts empty)
  rulebook.alex       the rulebook, as source (starts with a title)
  base-set.alex       the first set: cards and decks (starts empty)
  base-set-rules.alex what the cards do, and scenarios (tests)
  art/                card images
  AGENTS.md           for Claude, Codex and other agents: the spec, the commands, the conventions
```

**The rulebook is source.** Its sections are Alex, and every rule cites the section that explains
it (`cites = @rulebook.combat`). The checker looks both ways, as the linker already does for
cards and their handlers: a citation of a missing section is an error; a rule with no citation,
or a section no rule cites, is a note. `tcg rulebook` renders the same file to HTML and PDF, as
LaTeX does for documents, with a card list generated from the card data.

## The `tcg` command-line tool (free)

| Command | What it does |
|---|---|
| `tcg new` | create a project skeleton |
| `tcg check` | parse, link and type-check; says what's missing and where |
| `tcg test` | run the scenarios (given / when / then) |
| `tcg sim` | play one game with bots and print its log |
| `tcg playtest` | play many bot games and report win rates, game length, card stats |
| `tcg play` | open the game table locally for hot-seat play |
| `tcg rulebook` | render the rulebook to HTML and PDF |
| `tcg cards` | render composed card images and printer-ready files |
| `tcg login`, `tcg push`, `tcg invite` | the online service: host the game, invite players |
| `tcg studio` | open the IDE on this folder (paid) |

## Studio (the IDE, paid)

A local web app that `tcg studio` opens on the project folder. It shows composed cards, the
running game and the rulebook, and has graphical designers (a card's property grid, deck
builder, rule pickers) that write to the Alex files behind the scenes. The code view is the file
itself. A hosted Studio can come later without a rewrite.

## How cards look (to explore)

A second survey, like the rules survey: which data-driven elements cards have across many TCGs
(name, cost, stats, type line, rules text, keywords' icons, rarity, set symbol, frame by type or
faction…) and how they compose with art. Everything about a card is source in the repo (Alex
plus image files), and `tcg cards` produces composed images and files ready for online printers.

## Business

- **Free:** the toolchain: the `tcg` CLI, Alex, the engine, bots, local play, the rulebook and card
  rendering.
- **Paid:** Studio, the IDE where you see composed cards and design graphically.
- **Services (later):** cloud playtests, online hosting, storage, printing partners.

## Where it lives

In the fruitcats repo for now, because it is easier to develop both together, but kept
separable: the platform does not depend on Folkborn, and Folkborn becomes an app on the
platform. The platform folder is to be agreed with the TCG Alex session, most likely its
`cardengine/`.

## Order of work

1. **The walkthrough** ([walkthrough.md](walkthrough.md)): the tutorial as it will read on release
   day. Nothing in it works yet; it is the spec, and each of its steps later becomes an acceptance
   test. The product is done when the walkthrough is true.
2. **Alex in TypeScript:** parser and binder, passing the conformance suite shared with C#.
3. **The runtime** plays Hello TCG from its Alex source.
4. **`tcg` basics:** `new`, `check`, `test`, `sim` with a random bot.
5. **Search bot and `tcg playtest`.**
6. **The game table:** `tcg play` hot-seat, then online through the match host.
7. **`tcg rulebook`.**
8. **Card templates and `tcg cards`** (after the card-look survey).
9. **Studio.**
10. **Services.**

Then **Folkborn in Alex**, compared against today's hard-coded engine (`packages/engine`): win
rates and game lengths should match statistically. That is the proof the platform can carry a
real game.

## Hello TCG

The game the walkthrough builds. It is deliberately boring and uses each core idea once, with only
built-in library rules, in the survey's most common shape: full turns (77% of games), life as a
counter, a growing resource, attacker-chooses combat, no responses.

- Two players, 10 Life each. A 12-card deck, 3 cards in the opening hand, draw 1 a turn.
- Energy grows by 1 each turn, to 3, and refills each turn.
- Creatures enter exhausted; on later turns each may attack the opponent or a Creature.
- Win when the opponent's Life reaches 0. The game is a draw after 20 rounds.
- Six cards: Friend (1/1), Big Friend (3/3), Hello (draw when it enters), Cheer (your other
  Creatures get +1 Power), Spark (2 damage to the opponent), Goodbye (destroy a Creature).
- Two decks of four cards × 3: Swarm and Big.

It covers zones, hidden hands, shuffling, costs, a trigger, a static, a choice, winning and
drawing, scenarios, the rulebook as source, and a balance question for the playtester.

## Working with the TCG Alex session

The TCG Alex session owns the design of the core and the libraries until its survey is done and
the owner signs off. This session builds on them and sends gaps back. Things raised with it:

1. Where the platform folder lives, and getting `cardengine/` committed to main.
2. Which core version the TypeScript runtime targets first, and when it freezes.
3. What the walkthrough assumes that the core or libraries don't have yet (below).

### What the walkthrough assumes that doesn't exist yet

- **A `Rulebook` type** and `cites` as a reference to a section (`cites = @rulebook.combat`)
  instead of free text, with the linker checking both directions.
- **How libraries find the game's zones.** `draw` needs the deck and hand, combat needs the board.
  The walkthrough gives zones a role (`role = deck`); the core has no such field yet.
- **Shuffling at setup.** The `setup` library has no shuffle rule, and "no behaviour defaults"
  means the engine shouldn't shuffle on its own. The walkthrough uses `ShuffleDeck {}`.
- **Scenario setup vocabulary** (`given hand(me, [@spark])`, `energy(me, 2)`) beyond the
  `controls(...)` the Folkborn fixtures use.
- **A card's art** (`art = 'art/friend.png'`): no card field for it yet; it waits for the
  card-look survey.
- **Deck lists in the set** use `[[Card, int]]` as the core has; the walkthrough uses that form.

## Open questions

- Are the language server and VS Code extension free (part of the toolchain) or part of the paid
  IDE? Recommended: free.
- Is Studio a local web app opened by `tcg studio` (recommended), or a desktop app?
- The product's name.
