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

- **Source is the only truth.** A game is a folder of files in a repo: **Alex files plus assets**.
  The Alex files describe the game (rules, rulebook, cards, decks); the assets are the files they
  point at: images at least (card art, frames, icons, rulebook pictures), possibly other media
  later. Every tool reads and writes those files. Nothing lives elsewhere.
- **Layers, not a ball of twine.** Each layer depends only on the layers below it and is simple on
  its own. The bottom is a command-line toolchain; everything else builds on it.
- **A game's logic and data are written in Alex,** next to its assets. Custom TypeScript is not supported at first. A future escape
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
or in Studio.

**Two stages, one folder (decided 2026-09-28).** Many designers start with cards and a rulebook
only, to print a physical game, and make it playable by the computer later or never. So a project
has two goals, and `tcg check` reports progress toward each:

- **Printable:** card types, cards, decks, the rulebook, constants and the card back. Nothing about
  the engine or playing appears: a printable game is only a definition of cards and a rulebook.
  `tcg cards --print` and `tcg rulebook` need only this.
- **Playable:** added below, never changing the printable part: the libraries, zones, rules picked
  from the libraries (each citing its rulebook section), the mapping of the game's card types to
  the libraries' (`UnitCards { types = [@Creature] }`), and a handler for every card with text.
  `tcg sim`, `test`, `playtest`, `play` and `push` need this.

Errors are real mistakes only (a broken reference, a missing image, an unknown constant). What a
game still lacks to be playable is a list, not errors.

```
my-game/
  my-game.alex        the game: name, schema version, card back, constants, card types
  rulebook.alex       the rulebook (starts with a title)
  cards.alex          the cards and decks (starts empty)
  art/                images: card art, the card back
  AGENTS.md           for Claude, Codex and other agents: the spec, the commands, the conventions
```

A rules file (`card-rules.alex`, `for = @cards`: handlers and scenarios) is added when the game is
made playable.

**Cards, not sets (decided 2026-09-28).** A beginner writes a `Cards` file: cards and decks, with
no id and no name. Every `Cards` file in the folder is part of the game (the game doesn't list
them), so cards can be split across files freely. A set in the TCG sense (a named release, with a
code, symbol, collector numbers, boosters, rotation) is an opt-in for games that publish
expansions, designed later. A cards file can be held back with a marker such as `draft = true`.

**Card types are the game's own (decided 2026-09-28).** A printable game declares what its cards
print, on the core `Card`: `type Creature : Card { cost: int, power: int, health: int }`. `Card`
gives name, art, text, flavor and constants. The libraries' card shapes (`UnitCard`, `SpellCard`)
are engine concepts, so a playable game maps its types onto them (`UnitCards { types =
[@Creature] }`), and `tcg check` confirms the types have the fields the library needs.

**Card text and handlers.** A card's printed rules text is `text = '...'`. Its handlers attach to
the card by slot (`@hello.on-enter = draw-a-card`, `@cheer.static = ...`, `@spark.on-play = ...`);
the slot names when the handler runs. The linker checks both ways: every card with text has a
handler, every handler belongs to a card with text.

Samples: `cardengine/samples/hello-tcg-print/` is Hello TCG at the end of the walkthrough's Part 1
(printable only), and `cardengine/samples/hello-tcg/` is the finished, playable game.

**One source for every number: constants.** Rulebooks and games drift apart most often over
numbers. So a game names the numbers that shape it in one place, `constants = [starting-life = 10,
...]` on `Game`; rules take them (`LifeCounter { start = @starting-life }`) and rulebook text embeds
them (`Each player starts with {@starting-life} Life.`). A card's own numbers are the card's
`constants`, shown in its text as `{bonus}` (no `@`) and read by its handler as `card.bonus`:

```
cheer = Creature {
  ...
  text = 'Your other Creatures have +{bonus} Power.'
  constants = [bonus = 1]
}
static others-get-bonus { units(own, other).grant(power: +card.bonus) }
```

`tcg check`: an unknown name in text is an error; a card constant its text never shows is an error
(players would play with a number they can't see); a digit typed into rulebook text, card text or
a handler is a note. Constants are also the knobs a playtest can vary.

**How a project loads.** `tcg` and the engine read every `.alex` file in the folder. Each file
holds one value, of the type its `#type` directive names; the file's name is its name
(`@rulebook` is `rulebook.alex`). The folder holds exactly one `Game` and any number of `Cards`
files, all part of it; the rulebook joins by reference (`rulebook = @rulebook`), and each `Rules`
document by its `for = @cards` (the cards never name their rules file: code points at data).
Assets are referred to by their path in the folder.

**The rulebook is source.** Its sections are Alex, and every rule cites the section that explains
it (`cites = @rulebook.sections.combat`). The checker looks both ways, as the linker already does for
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
| `tcg cards` | render composed card images; `--print --printer <name>` makes printer-ready files |
| `tcg login`, `tcg push`, `tcg invite` | the online service: host the game, invite players |
| `tcg studio` | open the IDE on this folder (paid) |

## Studio (the IDE, paid)

A local web app that `tcg studio` opens on the project folder. It shows composed cards, the
running game and the rulebook, and has graphical designers (a card's property grid, deck
builder, rule pickers) that write to the Alex files behind the scenes. The code view is the file
itself. A hosted Studio can come later without a rewrite.

## How cards look

**Decided 2026-09-28.** A designer designs the look once; every card gets it, and the numbers on a
printed card come from the Alex files. The look has two halves:

- **Frames**: images the designer draws in any drawing program, one per card type (later also per
  rarity, faction or finish). A frame holds everything that is the same on every card of its type
  and leaves a transparent window for the painting and blank spaces for the data. Frames are drawn
  at the trimmed card size plus bleed: for poker size at 300 dpi, 750 × 1050 plus 36 px each side,
  so 822 × 1122.
- **A card layout** (`card-layout.alex`, `#type CardLayout`, named by `Game.card-layout`): the card
  size, dpi and bleed; the fonts (files in `fonts/`); which frame each card type uses; and the
  **parts** drawn on the frame, in order. A part has a box (pixels from the card's top-left corner
  at the trim line) and shows a template of the card's data: `show = '{cost}'`, `'{name}'`,
  `'{type}'`, or fixed words. Kinds: `Label` (one line; `size`, `smallest` to shrink long text,
  `color`, `outline`, `align`, `capitals`), `Picture` (`fit = cover`, `under-frame = true` so the
  painting shows through the frame's window), `TextBox` (paragraphs that shrink together to fit:
  keywords in bold, the card's text with its `{constants}` filled in, flavor in italics under a
  rule). A part shows only on cards that have what it shows (a Charm has no Power).

`tcg check` checks the layout: a `{field}` no card type has, a box off the card, a missing font or
frame, a text box too small for a card's text at its smallest size (naming the card), and images
below print resolution. `tcg cards` renders every card; `--print --printer <name>` adds bleed-sized
files, the back and the printer's order choices. The layout is Folkborn's own card anatomy
(`tools/compose_cards.py`) moved out of a Python script and into data a designer owns.

Still to explore, as a survey like the rules survey: the elements cards have across many TCGs
(rarity marks, set symbols and collector numbers, faction frames, icons in text, finishes such as
foil, two-faced cards) and the layout parts they need.

## Business

- **Free:** the toolchain: the `tcg` CLI, Alex, the engine, bots, local play, the rulebook and card
  rendering.
- **Paid:** Studio, the IDE where you see composed cards and design graphically.
- **Services (later):** cloud playtests, online hosting, storage, printing partners.

## Where it lives

In the fruitcats repo for now, because it is easier to develop both together, but kept
separable: the platform does not depend on Folkborn, and Folkborn becomes an app on the
platform. The platform lives in `cardengine/` at the repo root (agreed with the TCG Alex
session).

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
8. **The card layout and `tcg cards`**, including print files. The owner's next step.
9. **Studio.**
10. **Services.**

Then **Folkborn in Alex**, compared against today's hard-coded engine (`packages/engine`): win
rates and game lengths should match statistically. That is the proof the platform can carry a
real game.

## Hello TCG

Its sources are in `cardengine/samples/`: `hello-tcg-print/` is the game at the end of the
walkthrough's Part 1 (printable only), and `hello-tcg/` is the finished, playable game, the same
files as the walkthrough's "The finished game". Keep them in step with the walkthrough.

The game the walkthrough builds. Its cards are six real Folkborn cards from the Domowiki deck,
with their original paintings, so the card layout and the print files are tested on real art and
real text. Its rules use only built-in library rules, in the survey's most common shape: full
turns (77% of games), life as a counter, a growing resource, attacker-chooses combat, no
responses.

- Two players, 10 Life each. A 12-card deck, 3 cards in the opening hand, draw 1 a turn.
- Energy grows by 1 each turn, to 4, and refills each turn.
- Creatures enter exhausted; on later turns each may attack the opponent or a Creature.
- Two keywords: Guardian (must be attacked first) and Swift (enters ready).
- Cards: Hearth Cricket (1, 2/1), Mane-Braiding Domowik (2, 2/2, Swift), Kłobuk, the Soggy Chick
  (3, 2/3, "Hello: Draw a card."), Keeper of the Door (3, 2/6 then 2/5, Guardian), Bread-and-Salt
  Greeter (4, 3/5, "Hello: Heal {heal} from each Creature you control."), and the Charm A
  Domowik's Temper (4, "Deal {damage} damage to a Creature."). Texts are adapted where Folkborn's
  words differ ("unit" is "Creature"; Temper's Lucky keyword is left out).
- Two decks of four cards × 3: Hearth and Threshold.
- Art: the six paintings (1536 × 1024, 3:2), two blank frames (`creature.png` with Power and Health
  chips, `charm.png` without) drawn from Folkborn's anatomy in Domowiki's colours, and Folkborn's
  card back.
- Fonts: the layout uses Nunito (SIL Open Font License) from `fonts/`. The font files still need
  adding to the samples.

It covers zones, hidden hands, shuffling, costs, keywords, triggers, a choice, winning and drawing,
scenarios, the rulebook as source, the card layout, and a balance question for the playtester.

## Working with the TCG Alex session

The TCG Alex session owns the design of the core and the libraries until its survey is done and
the owner signs off. This session builds on them and sends gaps back.

- **Location.** The platform builds on `cardengine/` at the repo root, on main since 4780d71. Read
  `cardengine/decisions.md` (the full design record) and `README.md` (conventions) first.
- **Core version.** Target `core = '1'` as the files on main have it. It is a draft: it may grow
  but should not change shape. It freezes when a second, structurally different game
  (Hearthstone-like or KeyForge-like) is built against the libraries with no core edits. The
  broad survey's recommended additions (2-D coordinates, change of controller, ownerless objects,
  dice as face lists, optional unit health and cost) are not approved yet.
- **Conformance.** These files are the acceptance fixtures of Alex 0.4.0 in mochi
  (`mochi.agents/alex`), so the C# Alex binds them today. The TS Alex must bind them identically;
  the conformance suite is the mochi test project's fixture tests.
- **Validation lives in both.** The host checks in C# (library use; every ability has its slot
  handler and every handler its ability; one kind per object; holders) must exist in the TS
  engine too, or the two implementations will accept different games.
- **The DSL.** The body limits above match the program-layer brief. `each` over a selection is new
  and goes into the Alex spec.

### What the walkthrough needs from the core and libraries

All five asks are in core 1 on main since f7a6845, when the whole 156-game survey was folded into
the core and libraries (seven new libraries, among them `scenarios`, `objectives`, `board` and
`dice`; the full list is in `cardengine/decisions.md`):

- `Rulebook { title, sections: [text: Section] }`, `Section { number, text }`,
  `Game.rulebook: Rulebook | text | nic`, and `cites: Section | text | nic` on rules and cards.
- `Zone.role: ZoneRole` (`deck, hand, discard, board, life, resource, exile, other`).
- `ShuffleDeck { zone: Zone? }` in `setup`.
- The `scenarios` library: `hand`, `deck`, `controls`, `counter-is` to set up; `play`
  (with `target:`), `attack`, `passes` to act; `in-zone`, `power`, `life`, `winner` to assert.
- `Card.art: text?`, an asset reference.

Core changes the owner asked for on 2026-09-28, from reading the walkthrough. **All done** in
`cardengine/` (core, libraries and Folkborn), recorded in `cardengine/decisions.md` under "Core
changes from the walkthrough review" and "Printing first: cards, constants, schema-version"
(ede3bb0). Each is additive: old spellings still bind as deprecated fields.

- **`schema-version = 1`** on `Game` (first `engine-version`, then renamed): the version of the
  file format, like a .NET project's target framework. Cards files take the game's version.
- **No repeated names.** A game's card types are the types it declares; `Game.types` is
  deprecated. A record under a key takes its `name` from the key unless it gives its own. Rule
  fields that name a card type still take `nameof(Hero)`; moving them to `@Hero` is open.
- **Defaults instead of boilerplate:** `uses`, `sets`, `types` and `zones` default to `empty`,
  `players` to `Players {}`, `Rulebook.sections` to `empty`.
- **`constants`** on `Game` and on `Card`: `{@name}` in rulebook text, `{name}` in card text, the
  `card` selector in handler bodies. The checker errors on an unknown name and on a card constant
  its text never shows, and notes digits in rulebook text, card text and handlers.
- **`Cards`** documents (`cards`, `decks`, `draft = true`; no tokens or counters yet), picked up
  automatically. `Rules.for` accepts a `Cards` document. `Set` stays for expansions, with `code`
  and `symbol`, and joins through `Game.sets`.
- **`Card.text`** (printed rules text) and **`Card.constants`**. A card uses `text` or
  `abilities`, not both; `abilities` stays for once-per-round abilities, hero faces and
  mechanics.
- **`UnitCards { types }`, `SpellCards { types }`**: map a game's own card types onto a library's,
  checked structurally. Needs Alex 0.6.0 (type-valued fields, mapped card types), being built by
  the session "Alex 0.6.0: type-valued fields and mapped card types"; the samples bind once it
  lands.
- **`Game.card-back`**, an asset reference to the back every printed card shares.
- **`Section.title`**, required.
- **`#type`**, in the C# Alex (mochi); `@@@ .field` fills one of the file's own fields. Every
  cardengine file starts with its `#type`.
- Fixed from the Alex session's re-bind: `reveal`'s `CheckToPlay` is `RevealToPlay`, and the
  scenario verb `pass` is `passes`, so `@pass` means the core's pass action.

Asked after the real-card samples (2026-09-28). **Done** (0051e31), recorded in
`cardengine/decisions.md` under "Card layouts, and keyword rules that take the game's own keyword";
`frames` is keyed by the card type's name as text, checked against the declared types:

- **`CardLayout`** documents and **`Game.card-layout`** (see "How cards look" above).
- **Keyword rules that take the game's keyword:** `EntersReady { keyword = @Swift }` in `units`,
  `GuardiansFirst { keyword = @Guardian }` in `combat`, and the same pattern for the other
  keywords the libraries give meaning to. A printable game declares its keywords as plain
  `Keyword {}`; the playable part gives them meaning.

## Open questions

- Are the language server and VS Code extension free (part of the toolchain) or part of the paid
  IDE? Recommended: free.
- Is Studio a local web app opened by `tcg studio` (recommended), or a desktop app?
- The product's name.
