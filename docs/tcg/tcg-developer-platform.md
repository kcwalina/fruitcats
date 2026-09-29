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
- **A game's logic and data are written in Alex,** next to its assets. Custom code is not supported at first. A future escape
  hatch, like interop in .NET, is for the rare very advanced developer.
- **Built-in rules first.** A game is mostly a selection of rules from the libraries. A custom rule
  written in Alex should be extremely rare.
- **A small language, not a general-purpose one.** Alex for games is a DSL for describing games,
  not a language for arbitrary programs.

## Architecture

### The core: one WebAssembly module (decided 2026-09-29)

Everything that must behave identically wherever it runs is written once, as **the core**, and
compiled to one WebAssembly module: Alex (parse, bind, types, diagnostics, the byte-exact round
trip that lets designers edit files), the game loader, the runtime, the bots, and the card
renderer. Every host runs that same file: the browser (Studio, the game table, the player app),
`tcg.exe` through Wasmtime, and the servers.

- **The core is pure computation.** Bytes in, bytes out: no I/O, no clock, no network, no calls
  back to the host. That is what makes it portable, deterministic (the same seed and actions give
  the same game on every host, which replays and online play need) and a sandbox (an online server
  runs games other people wrote).
- **Written in Rust** (`cardengine/engine/`), because it compiles to small WebAssembly with no
  runtime inside it. .NET's WebAssembly carries its runtime (about 2 MB before any of our code) and
  interprets IL by default; that ruled C# out for the core, not the language itself. The choice is
  not binding: hosts only see a `.wasm` file and its byte interface (`cardengine/engine/src/abi.rs`),
  so the core can be rewritten in another language that compiles to WebAssembly without the layers
  above it changing.
- **C# for everything around it:** `tcg.exe` (NativeAOT, trimmed, one file, with the module and
  the Studio front end embedded), file watching, the local Studio host, printing jobs, the servers.
  `tcg cards` draws with SkiaSharp in C# today; the core's renderer replaces it once it draws the
  same cards pixel for pixel, so the card in Studio, on the table and in the print files is one
  drawing.
- **A thin front end** for Studio and the player app: plain TypeScript bundled into one file, no
  framework and no runtime dependencies. It draws and handles input; the core decides everything.
- **No compiled intermediate format.** The core reads `.alex` source directly: converting Alex to
  JSON would lose what Alex was designed to keep.
- **The engine never assumes `tcg check` ran.** An online server loads games other people wrote,
  so the loader refuses a malformed game with a clear error instead of misbehaving.
- **Two Alex parsers while both are used, kept identical.** The C# Alex stays for mochi's own
  uses (agent configurations, prompts). `cardengine/conformance` parses every `.alex` file in
  fruitcats and mochi, plus 25 seeded broken copies of each, with both, and compares their
  canonical dumps (tree, spans, trivia, diagnostics, round trip) byte for byte. Rejected: a
  TypeScript engine with a TypeScript Alex beside the C# tools. It would have needed a JavaScript
  runtime inside `tcg.exe` to run `tcg sim` and `tcg playtest`, and native Node add-ons to render
  cards.

**The spike (2026-09-29)** proved it on Alex's parser, ported to Rust from `AlexParser.cs`:

| | Result |
|---|---|
| Module size | 98 KB (the parser, the writer and the dump; no dependencies) |
| Load in Chromium | fetch, compile and instantiate in 10–40 ms |
| Load in C# (Wasmtime) | compile and instantiate in 70–85 ms |
| Conformance | 320 dumps of 160 real files and 8,000 of broken copies identical to the C# Alex; the browser's 70 dumps of Folkborn and the framework identical too |
| Speed | 50–57 MB/s through Wasmtime, input copied in each call; the C# Alex about 47 MB/s once warm |
| Folkborn + framework in the browser | 35 files, 135 KB, parsed in about 8 ms |

`cargo test` in `cardengine/engine` round-trips every `.alex` file natively;
`dotnet run -c Release` in `cardengine/conformance` runs the comparison and the timings; and
`cardengine/engine/web/` is the browser page, which reads a game folder from disk and parses it
in the page, uploading nothing.

### Layers

Each layer depends only on the ones below it.

| Layer | What it is | Language |
|---|---|---|
| L6 Services | cloud playtests, online hosting and lobbies, storage, printing | C# (running the core) |
| L5 Tools | the `tcg` CLI, the language server, Studio (the IDE) | C# (+ a thin TS front end) |
| L4 Presentation | the game table, the card renderer, the rulebook renderer (HTML, PDF) | the core draws; a thin TS front end shows |
| L3 Drivers | seat drivers (human, search bot, LLM player), the match host, the playtest runner | the core (bots); C# (match host, runner) |
| L2 Runtime | the engine: plays a game from its Alex source | the core |
| L1 Game loader | loads a project, links it, checks it enough to run safely | the core |
| L0 Alex | parse, bind, types, diagnostics, byte-exact round trip | the core (C# Alex kept identical for mochi) |

"The core" is the one WebAssembly module above, written in Rust.

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

The core's runtime implements exactly this contract. **Alex itself has no game semantics**:
it is a general-purpose data language, closer to JSON than to C#. Our engine gives these
documents their meaning, and it implements every library rule's behaviour.

### Rules: built in, rarely custom

A game's rules come two ways:

1. **Picked from a library** (almost always). Each library rule, such as `GuardiansFirst` or
   `LifeCounter`, is implemented in the core; the game just lists it. The broad
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
itself.

**One front end, several hosts (decided 2026-09-29).** Studio is one web front end over a small
**workspace protocol**: list, read and write files; watch for changes; diagnostics; render a
card; run a game. A host implements that protocol, and the front end never knows which one it
has:

- **The local host, first.** `tcg studio` is the `tcg` process: it serves the front end on
  localhost from inside `tcg.exe` and exposes the folder it runs in. Nothing is uploaded, so a
  game with thousands of cards and gigabytes of art costs nothing extra: images are read from the
  disk. A file watcher pushes every change to the page, so an edit made in a text editor or by an
  agent in another terminal shows within a second. Git stays the designer's: Studio edits files
  and never commits.
- **Designers edit through the core.** A change in a property grid is an edit request; the core's
  Alex applies it as the smallest text change to the file (the byte-exact round trip), the
  watcher sees the file change, and every view refreshes, the code view included. There is one
  place that edits Alex.
- **Instant previews run in the page.** Dragging a part's box in the layout editor (walkthrough
  §6) redraws the card on every mouse move, so the card renderer runs in the browser, in the
  core, not behind a request to `tcg`. Clicking an event to jump to the rule that caused it
  (§13) needs the core to carry source positions through loading into the event log.
- **An online host** for the online designer (next section): the same front end over a workspace
  that lives in storage instead of on the designer's disk.
- **A desktop window is optional** and cheap: the same front end in a WebView2 or Photino
  window, if the owner ever wants file associations and a window of its own.
- **Playing is a separate app on the same core.** Studio's Play tab runs the working files; the
  player app is its own polished shell that loads a published, frozen version of a game.

### Two products on one core (owner, 2026-09-29)

- **Studio (local)** is the full IDE, like Visual Studio, for **digital game designers**: people
  who build a game the computer plays, in a repo, with `tcg` and agents.
- **The online designer** is what the Artist Studio grows into: an online IDE for people who
  design **physical games** to print and sell. They are not developers and do not care about
  shipping on Steam. In it they add and design cards (not only fill in the art for a packet we
  prepared), work with artists (uploads, comments, approvals), and make print files. Artists,
  card designers and, later, playtesters use it.
- **Playtesting is the main value of the online designer.** Many websites already design cards,
  and we don't compete with them on that alone. What they don't do is play the game: here the
  game runs on the engine, bots play it overnight, and the designer reads the results in the
  morning. So the engine and the playtesting portal are part of the online product, not only of
  Studio.
- **Both products share the front end's components and the core.** They differ in their host and
  in what they put first: code and rules in Studio, cards, art and playtest results online.
- **Where files live is behind the workspace protocol.** The designer owns the project. A
  **storage provider** decides where its files are kept: a local folder, a GitHub repository (a
  save is a commit), or storage we host for designers who don't use GitHub. Every save goes to the
  owner's provider, an artist's upload included. Nothing in the front end or the core knows which
  provider it has, so providers can be added, or the default changed, later.

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

Added after comparing with the live game's cards (2026-09-28), so the layout reproduces Folkborn's
card design exactly:

- `frames` entries are `Frame { image, ink }`; a part's `color = ink` takes the frame's ink (purple
  text on Domowiki frames, dark gold on the Hero's).
- `Title { show, subtitle }`: a name with its epithet under it, or alone and centred.
- `Icon { show = '{rarity}', images = [...] }`: one of a few images picked by a field.
- In a `TextBox`, a paragraph's `emphasis` lists what's bold or italic: `Bold { words = keywords }`
  (the game's keywords; `with-number` bolds "Tough 1"), `Bold { up-to = ':' }` (a sentence's opening
  up to a colon: "Hello:"), `Italic { between = '()' }` (reminder text). `same-line = true` runs a
  paragraph on from the one before ("Guardian. Hello: …").
- `tcg` has no Folkborn numbers in it: sizes, paddings and baselines are in the layout, required where
  there's no neutral default. `text-spacing = whole-pixels` sets text the way the old composer did.
- `tcg` references the C# Alex's projects directly, as source in the mochi repository checked out beside
  this one (`C:/git/mochi` next to `C:/git/fruitcats`, kept on main): one copy of Alex, no packages. `tcg`
  moves onto the core (the WebAssembly module) as the core grows past the parser.
- **Two-faced cards:** `Card.back` holds a second face (the Hero's Awakened side). It prints on the
  card's back instead of the game's card back, with its own type's frame; it shows its own fields
  and the front's for the ones its type doesn't have (number, rarity, family).
- **Finishes:** a game declares `enum Finish { standard, foil }` and a `finish` field; a type can fix
  it (`finish = foil` on `Hero`). `tcg cards --print` groups foil cards as their own order.

### Text looks the same whatever language the core is written in (owner, 2026-09-29)

The core may be rewritten in another language that compiles to WebAssembly, and the cards must
not change when that happens: not a font size, not a line break, not a glyph's position. What
decides those is text layout: measuring words, fitting a text box, breaking lines and placing
glyphs. A shaping library such as HarfBuzz (rustybuzz in Rust) is effectively its own
specification, and a rewrite couldn't reproduce its output without porting it. So:

- **The core owns text layout, and the algorithm is written down.** It covers glyph lookup
  (`cmap`), advance widths (`hmtx`), pair kerning (the `kern` table and GPOS pair adjustment),
  line breaking, fitting by stepping the size down to the part's `smallest`, and emphasis. There
  are no ligatures and no complex shaping. Positions are integers in 1/64 pixel with rounding
  stated at each step, so no two implementations can disagree over a float.
- **Fonts are the project's data.** The font files are assets in the game's folder, so every
  metric the algorithm uses comes from a file, not from a library or the operating system.
  Reading them (tables and glyph outlines) is either a small pure-Rust reader such as
  `ttf-parser` or our own. Both are fine, because the file format defines what they read exactly.
- **The contract is the draw list, not the pixels.** Laying out a card produces a draw list:
  every image with its rectangle, and every glyph with its font, glyph id, size, position and
  colour, in order. It is text and deterministic. Golden draw lists for every card of Folkborn
  and Hello TCG are committed as fixtures, and any implementation of the core must reproduce them
  byte for byte, exactly as the Alex dumps are compared today.
- **Pixels come from rasterising the draw list,** and the rasteriser is the replaceable part.
  `tiny-skia` is allowed there. A different rasteriser can differ only in the antialiasing at a
  glyph's edge, never in size, position or line breaks. Image comparisons allow that small
  tolerance and nothing more.
- **No rustybuzz.** Scripts that need complex shaping (Arabic, the Indic scripts) are out of
  scope until a game needs them. Then their rules are added to the written algorithm, not handed
  to a library.
- Moving from SkiaSharp can shift glyphs by fractions of a pixel from today's cards. The first
  cards the core draws are compared with today's for layout: the same sizes chosen and the same
  line breaks. From then on, the core's draw lists are the goldens.

Still to explore, as a survey like the rules survey: the elements cards have across many TCGs
(rarity marks, set symbols and collector numbers, faction frames, icons in text, finishes such as
foil, two-faced cards) and the layout parts they need.

## Business

- **Free:** the toolchain: the `tcg` CLI, Alex, the engine, bots, local play, the rulebook and card
  rendering.
- **Paid:** Studio, the local IDE for digital game designers.
- **Paid:** the online designer for physical games. Its core is the nightly automatic playtests;
  storage for designers without GitHub goes with it.
- **Services (later):** cloud playtests for Studio users, online hosting of playable games,
  printing partners.

## Where it lives

In the fruitcats repo for now, because it is easier to develop both together, but kept
separable: the platform does not depend on Folkborn, and Folkborn becomes an app on the
platform. The platform lives in `cardengine/` at the repo root (agreed with the TCG Alex
session).

## Folkborn's game folder

Folkborn is the platform's first real game (2026-09-28). `games/folkborn/` holds only its sources: `folkborn.alex`
(the game and its card types), `card-layout.alex` (its card design, drawn from shapes), `art/icons/` and
`art/finishes/` (the foil, gold and prismatic textures), and for each
released set `sets/<set>/<set>.alex` (its cards) with the paintings they name (`sets/<set>/art/`). Nothing in it
is generated. `npm run cards` renders every card into `out/cards/<set>/` (ignored by git), and `publish-pack` renders
a set into a fresh folder and uploads that; copying `games/folkborn/` anywhere and running `tcg cards` there makes
the same cards, pixel for pixel. `content/<set>/` keeps what the current engine and web app still read (`set.json`,
art prompts, tale banners); engine files move into the game folder as Alex-based engine features replace them.

## Order of work

**Revised 2026-09-29** for the core and Studio decisions above. The first thing a designer needs
is to *see* their folder of Alex files and art, so a read-only local Studio comes early, straight
after the core can load a game. It no longer waits until the end. The work runs on the owner's
machine (Windows, with mochi checked out beside fruitcats), not in a cloud session.

The walkthrough ([walkthrough.md](walkthrough.md)) stays the spec: each step becomes an
acceptance test, and the product is done when the walkthrough is true.

### Stage 0: the core's first piece (done, 2026-09-29)

In place on branch `claude/tcg-developer-ide-architecture-xy9f9d` (commit `2ecc808`):

- `cardengine/engine/`: Alex's lexer, parser and byte-exact writer in Rust, 98 KB of WebAssembly.
- `cardengine/conformance/`: the C# Alex and the core agree on 8,320 of 8,320 dumps (every `.alex`
  file in both repos, plus seeded broken copies).
- `cardengine/engine/web/`: the module parsing a game folder in a browser.

First, on the owner's machine: `cargo test --release` and
`cargo build --release --target wasm32-unknown-unknown` in `cardengine/engine`, then
`dotnet run -c Release` in `cardengine/conformance` (expect 0 different), and
`dotnet build -c Release` in `cardengine/tcg`. Its project now finds mochi with forward slashes,
which is verified on Linux but not yet on Windows.

### Stage 1: the core loads a game

1. **The binder in the core.** Port `ViaMochi.Alex.Model` (`AlexBinder*.cs`, `AlexCompilation`,
   `AlexType`, `AlexValue`, `AlexDocument`, `AlexHost`) the same way the parser was ported: the
   same rules and the same diagnostic messages. Add a canonical dump of the bound model (types,
   values, references resolved, diagnostics) to both sides and to `cardengine/conformance`.
   *Done when* the framework, Folkborn and both Hello TCG samples bind identically in C# and in the
   core, broken copies included.
2. **The project loader** (L1): a folder's files handed in as bytes (the core does no I/O), one
   `Game`, every `Cards` file, `Rules` by their `for`, the checks `tcg check` promises (unknown
   `{name}`, unused card constants, handler and text both ways, citations). Errors carry file and
   span.
3. **Interface calls** in `abi.rs` for these: `load_project` (many files in, diagnostics and a
   handle out) and queries on the loaded project (cards, card types, the layout). Bytes in, bytes
   out, with no host imports. The module must still instantiate with an empty linker.

### Stage 2: `tcg.exe` runs the core

1. Move `EngineModule` (the Wasmtime host) from `cardengine/conformance` into `tcg`, and embed
   `tcg_engine.wasm` as a resource.
2. `tcg check` runs through the core.
3. **Publish `tcg.exe` as NativeAOT, trimmed and single-file on Windows, with Wasmtime's native
   library inside it.** This is the unproven piece of the design; if Wasmtime's .NET package won't
   go single-file, decide between a second file beside the exe and another host.
   *Done when* a fresh machine with nothing installed runs `tcg check` on `games/folkborn`.

### Stage 3: `tcg studio`, read-only

1. **The local host** in `tcg`: an explicit HTTP server on localhost (`HttpListener`, or Kestrel
   configured in code with no conventions) that serves the front end from inside `tcg.exe`, the
   workspace protocol (list, read and write files, diagnostics), and a push channel (a WebSocket
   or server-sent events) fed by a `FileSystemWatcher`.
2. **The front end:** plain TypeScript, no framework, bundled by esbuild into one file that is
   embedded in `tcg.exe`. It shows the files on the left, the selected card or file in the middle,
   and diagnostics, and it loads `tcg_engine.wasm` itself, so previews run in the page.
3. Until the core renders cards (Stage 4), the page shows each card's data and art as the layout
   places them, or cards `tcg cards` rendered.
   *Done when* walkthrough §2 is true: `tcg studio` in a folder opens the browser, and an edit
   saved in any editor shows within a second.

### Stage 4: the card renderer in the core

As decided in "Text looks the same whatever language the core is written in":

1. **Write the text layout algorithm down first**, as a short spec beside the code: glyph lookup,
   advances, kerning, line breaking, fitting, emphasis, and 1/64-pixel integer positions with
   their rounding.
2. **Layout to a draw list** from `card-layout.alex` (boxes, templates, text fitting, emphasis,
   frames, icons, two faces, finishes), ported from `cardengine/tcg/Renderer.cs` and `Faces.cs`.
   Fonts are read from the project's font files. No rustybuzz.
3. **Rasterise the draw list** with `tiny-skia`.
4. *Done when:* every released Folkborn card has the same font sizes and line breaks as
   `tcg cards` draws today, and differs from it only by antialiasing within a stated tolerance.
   Then the core's draw lists are committed as goldens, `tcg cards` draws through the core, and
   SkiaSharp leaves `tcg`.
5. Studio shows finished cards drawn in the page.

### Stage 5: Studio edits

1. **Edits in the core:** requests such as "set this field", "add this card", "attach a handler",
   applied as the smallest text change through the round trip. The core returns the new bytes and
   the host writes the file.
2. **The property grid** (walkthrough §4) and **the layout editor** (§6: drag a part's box and its
   `x`/`y` change in the file, with the card redrawn on every move).

### Stage 6 onwards: playing

The earlier order continues on the core:

1. **The runtime** plays Hello TCG from its Alex source.
2. **`tcg` basics:** `new`, `test`, `sim` with a random bot.
3. **Search bot and `tcg playtest`.**
4. **The game table:** Studio's Play tab (§13, with events linked to their rules) and `tcg play`
   hot-seat, then online through the match host (a C# server running the core).
5. **`tcg rulebook`.**
6. **Print files** from `tcg cards --print`.
7. **The online designer for physical games:** the online host with storage providers (our
   storage and GitHub first), card design and the artist workflow (the Artist Studio folded in),
   print files, and nightly automatic playtests with a results page. That last part is the
   product's main value.
8. **Services.**

Then **Folkborn in Alex**, compared against today's hard-coded engine (`packages/engine`): win
rates and game lengths should match statistically. That is the proof the platform can carry a
real game.

**Rules for every stage:** the core stays pure (no I/O, no host imports) and dependency-free
unless the platform doc records otherwise. Anything the C# Alex also does stays identical and is
checked by `cardengine/conformance`. Every stage ends with its *done when* shown working, not
reasoned about.

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
  (`mochi.agents/alex`), so the C# Alex binds them today. The core's Alex must bind them identically;
  the conformance suite is the mochi test project's fixture tests.
- **Validation lives in both.** The host checks in C# (library use; every ability has its slot
  handler and every handler its ability; one kind per object; holders) must exist in the
  core too, or the two implementations will accept different games.
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

Asked for the Hero and foil (2026-09-28), to do: `Frame { image, ink }` and `color = ink`; `Title`;
`Icon`; `TextBox` `bold` and `same-line`; `Card.back`; `Deck.hero` in the core (a print-only game
has no `decks` library); `HeroCards { second-face = back }`; the scenario verb `awakened`; `gain`
taking a resource.

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
- Who makes a physical designer's game playable in the online designer. They aren't programmers,
  so presumably an agent writes the rules in Alex from their rulebook and card text, and the
  designer judges it by the playtest results. How much of that they see or confirm is open.
- The product's name.
- **Scenarios (given / when / then, `tcg test`, the `scenarios` library) are not designed yet** (the owner,
  2026-09-28). They get designed properly near the end: after cards and the rulebook, the IDE, printing, the
  execution engine and the online table. Until then the given/when/then syntax in the samples and the
  walkthrough is a placeholder; don't build on it or go deeper into its design. One question is parked for that
  design: whether a section's label may repeat on consecutive lines (`given a` / `given b`) as well as one `given`
  with continuation lines.
