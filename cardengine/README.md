# cardengine

Design reference files for the card-game IDE discussed on 2026-09-27 and 2026-09-28. The Alex
dialect they are written in is implemented in the mochi repo (`mochi.agents/alex`), and these
files are its acceptance fixtures. They exist so the language, the core and the libraries can be
discussed by editing them instead of re-pasting them into chat.

## Layout

- `framework/core.alex`: the frozen layer. The object model the engine runs (objects, zones,
  players, counters, keywords as tags, randomness), the `Rule` extension point, the `Library`
  type, and the program-layer plug points (declaration kinds, the Trigger/Event/Selector/Verb
  records) with the vocabulary every game has (choose, may, counter, pass). Append-only; never
  renamed; new fields default to the behaviour that existed before them.
- `framework/core-operations.alex`: the other half of the core, the runtime contract the engine
  implements and a library is written against: the state model, the operations that are the only
  way state changes, the queries the engine asks and the hook kinds a rule answers them with,
  input as a stream of actions per player, the scheduler with its selectable drain policy, the
  fixed loop skeleton, the event log with per-observer visibility, and randomness. The engine is
  a headless simulation: actions in, events out.
- `framework/lib/*.alex`: the libraries. Each is a set of helpers over the core that a game may
  use or ignore: rule types for one area, card records, keyword types, and vocabulary. A library
  depends on the core and on what its `requires` lists, and on nothing else. `common` (costs,
  rarity, generic verbs), `units`, `spells`, `attachments`, `permanents`, `heroes`, `abilities`,
  `life` and `life-stack`, `resources`, `turns`, `initiative`, `combat`, `responses`,
  `scheduling`, `objects`, `families`, `decks`, `setup`, and, from the 156-game survey,
  `objectives` (winning by things other than life), `board` (grids and movement), `reveal`
  (checks that turn over deck cards), `dice`, `encounter` (scripted opponents for cooperative
  play), `stat-cards` (the Attax family) and `scenarios` (the vocabulary of scenario blocks).
- `survey/`: eight popular TCGs written against the catalogue by survey agents, each with a game
  document, five cards, a gap table and a verdict; `summary.md` consolidates the gaps by layer.
  `survey/broad/`: 156 TCGs classified against the libraries with a fixed record per game
  (`games.md` is the sourced list, `batch-*.md` the records, `summary.md` the aggregate).
- `samples/`: Hello TCG, the walkthrough's game. `hello-tcg-print/` is printable only (a game
  file with its constants and card types, a rulebook, a `Cards` file, art); `hello-tcg/` is the
  same game made playable (libraries, rules, and a rules document with handlers and scenarios).
- `folkborn/`: Folkborn written against the libraries. `folkborn.alex` is the game (it lists the
  libraries it `uses`, declares its card types as subtypes of their records, and fills each
  library's area with rules). Its sets were the Starter Box (`starter-box.alex`, pure data, and
  `starter-box-rules.alex`, a program document: effects, statics, conditions, scenarios, and the
  wiring that attaches them to cards, `@citron-fox.on-enter = zest-damage`), removed with the
  Starter Box on 2026-09-29 (decisions.md); the folk sets' cards are in `games/folkborn/sets/`.
  Code points at data; data never points at code.
- `engine/`: the core, the one WebAssembly module every host runs (Rust, no dependencies). It holds
  Alex's parser and binder and the game loader; the runtime, the bots and the card renderer join it.
  See its README.
- `conformance/`: parses and binds every `.alex` file with the C# Alex and with the core, and
  compares them byte for byte. It runs the core through kardix's host.
- `kardix/`: the `kardix` command-line tool (C#): `kardix check` and `kardix studio` run the core, `kardix cards` renders
  cards.
- `studio/`: Studio's page, which `kardix studio` serves (plain TypeScript, bundled into kardix).

## Dependencies: the platform never depends on Folkborn

`cardengine/` is the platform (Kardix Platform; see "Products and names" in
`docs/tcg/tcg-developer-platform.md`). It moves to its own repository once the engine plays
Folkborn from its Alex rules, so it must be movable as a folder today:

- **Nothing in `cardengine/` refers to Folkborn's code or data:** not `packages/`, `apps/`,
  `content/`, `playtest/`, `games/` or `art/`, and no Folkborn numbers, names or conventions in
  the tools. A game is always an input (`kardix cards --project games/folkborn`), never something
  built in.
- **Folkborn depends on the platform, only through its public surface:** the `kardix` command, and
  later the core's `.wasm` and its documented interface. It never reaches into the platform's
  source.
- **The one outside dependency is mochi's C# Alex** (`mochi.agents/alex`), and only the conformance
  tool uses it, to check that the core's Alex matches it. `kardix` reads games only through the core.
- **Known exceptions, to move before the split:** `folkborn/` here is Folkborn written against the
  libraries as a design reference, and belongs in `games/folkborn/`. It is also used by mochi's
  Alex tests as fixtures (`mochi.agents/alex/tests/Alex.Tests/Fixtures/cardengine`). Hello TCG
  (`samples/`) borrows six Folkborn cards and their paintings, which is fine: a sample may copy
  content, but it may not refer to it.

## Principles

- **Libraries are composable blocks, not a framework.** A game takes `units` without `combat`,
  `life` without `heroes`, `responses` with `Stack` or with `ResponseWindows`. Nothing in one
  library presumes another unless `requires` says so, and those edges point one way. Adding a
  library never changes an existing one.
- **A game is a selection.** Every area is a list of rules from the catalogue; absent means off;
  there are no behaviour defaults. A different behaviour is a new rule beside the old one, never
  an edit. Rules carry a `cites` field, a rulebook citation copied into logs and never parsed.
- **Printing comes first; the engine is added.** A printable game is cards, decks, a rulebook
  and a card back, with its own card types on the core `Card`
  (`type Creature : Card { cost: int, power: int, health: int }`). Making it playable adds
  libraries and maps its types onto their card records (`UnitCards { types = [@Creature] }`).
  The libraries' card records are engine concepts a printed game never sees.
- **A card's text is data; what it does is code.** A card prints `text = '...'`; its handler lives
  in a rules document, attached to one of the card's slots (`@hello.on-enter = draw()`, or a named handler), and
  the slot says when it runs. The linker requires every card with text to have a handler and every
  handler to belong to a card with text; the first is the IDE's fill-in-the-blank, the second keeps
  code from giving a card behaviour it doesn't print. A card whose ability needs data of its own
  (`once-per-round`), or that prints several abilities, lists `abilities = [OnEnter { ... }]`
  instead, and each ability then has exactly its handler.
- **A printed keyword is a word; a rule gives it meaning.** A printable game declares plain
  keywords (`Swift = Keyword {}`); the playable game names each in the library rule that gives it
  meaning (`EntersReady { keyword = @Swift }`), as it maps card types with `UnitCards`.
- **How cards look is data.** A `#type CardLayout` document (named by `Game.card-layout`) gives
  the card size, fonts, a frame per card type, and the parts drawn on it, each a box showing a
  template of the card's data (`show = '{cost}'`).
- **Every number has one source.** The numbers that shape a game are its `constants`, used by
  rules (`start = @starting-life`) and shown in the rulebook (`{@starting-life}`); a card's numbers
  are the card's `constants`, shown in its text (`{damage}`) and read by its handlers
  (`card.damage`).
- **Open sets are values, not enums.** Action kinds, moments and keywords are values a library
  declares (`attack = ActionKind {}`, `type Guardian : Keyword {}`), so a new library adds to them
  without touching anything shared.

## Language conventions, as settled

- A file holds one value and says its type with a directive on its first statement line:
  `#type Game`, `#type Cards`, `#type Rulebook`, `#type CardLayout`, `#type Rules`, `#type Set`,
  `#type Library`, `#type Core`. The value is an open
  instance of that type whose fields follow as `field = value` lines, and the file's base name is
  its name (`@folkborn` is `folkborn.alex`). A text table filling one of the file's own fields is
  `@@@ .field`. A file that only declares types needs no directive. The older named root
  (`folkborn = Game`) stays legal in Alex, but not together with `#type`, and these files no longer
  use it. A bare type name on the right-hand side of a member is an open instance whose fields
  follow as `path = value` lines. `Type { ... }` is a closed instance, and a
  later assignment into a closed record is an error. Every path is set exactly once. Type names
  start with a capital letter; enum members, fields and keywords never do.
- Brackets are collections, braces are records. `[T]` is a list; `[K: V]` is a map, keyed by
  `text` (identifiers) or by an enum. A map literal is `[key = value, ...]`. `empty` is the empty
  list, map or text, resolved by the field's type. Records are always `Type { ... }`.
- Inside braces and brackets, comma and newline both separate items. Outside them, a newline ends
  the statement.
- Quotes are for text humans read. Anything the engine interprets is a reference (`@name`) or an
  enum member (a bare word, resolved against the field's declared enum).
- References are orthogonal to types: a field typed `Set` accepts an inline value or `@name`. An
  unqualified `@name` resolves to a uniquely named member anywhere in the game; the checker asks
  to qualify when two match. A data document never sees declarations; only a program document's
  references reach them.
- `nameof(x)` is the identifier's last segment as text, checked to exist, never dereferenced. A
  field that names a card type takes `nameof(Creature)`.
- A record under a key in a keyed map takes its `name` from the key: `Deck = Zone { role = deck }`
  is named 'Deck'. Such members are written in Title Case; an explicit `name` wins
  (`AmbushOnAttack = Ambush { name = 'Ambush' }`). Cards keep lowercase keys and string names.
- A game's card types are the card types its game file declares, on `Card`
  (`type Creature : Card { ... }`) and mapped onto library records by rules, or as subtypes of a
  library's record (`type Creature : UnitCard {}`); there is no list of them.
- A game's folder is the game: one `Game` document, every `Cards` document that isn't
  `draft = true`, the sets `Game.sets` lists (only for games that publish expansions), the
  rulebook, and every `Rules` document in the folder.
- The game states its file-format version, `schema-version = 1`; cards files, sets and libraries
  take it. It names no engine: a printed game has none.
- Numbers that shape a game are named once in `constants = [starting-life = 10, ...]` on the
  game. Rules refer to them (`start = @starting-life`) and rulebook text embeds them
  (`{@starting-life}`). A card's own numbers are its `constants = [damage = 2]`, shown in its text
  as `{damage}` and read by its handler as `card.damage`. The checker errors on an unknown name
  in text and on a card constant its text never shows, and notes a digit typed into rulebook
  text, card text or a handler.
- `nic` (Polish for "nothing") is the no-value. A field is required exactly when its type doesn't
  include `nic`; `T?` is sugar for `T | nic` on a single type; a union with nothing is spelled
  out, never parenthesised. Omitted means `nic` in a document and unchanged in a patch.
  Collections default to `empty`, never `nic`.
- Short text is an inline literal (`flavor = 'Honk.'`, apostrophes doubled). Text tables are
  reserved for text that is multi-line or too long for one line: `@@@ name` starts a text, the
  next marker ends it, a bare `@@@` ends the table.
- Two layers, one language. The data layer is everything a data-mode parse accepts; `data` is its
  widest type, asserted with `type Set : data` and required with `accept = data`. The program
  layer adds `routine`, `static` and `scenario` declarations with bodies (a routine returns
  nothing or `bool`; `effect` and `condition` are its older spellings), `extension
  Type { field: T }` blocks (a data-typed member is an ordinary field once its schema is loaded; a
  function-typed member is program-only), and assignments through references to those members
  (`@citron-fox.on-enter = zest-damage`), which may only target extension members and are set once
  across the whole game. A game declares its card types as subtypes with fixed fields
  (`type Fabled : UnitCard { unique = true }`).
- Layout: no line over 100 characters. A type declaration lists one field per line unless it is
  short. A collection that isn't on one line inside a one-line record lists one item per line; a
  record that doesn't fit on one line lists one field per line, except that a card keeps its
  identity and its stats on a line each. A deck entry `[@card, 3]` is one item. A long comment
  goes on its own line above what it describes. Text-table bodies are exempt.
- The design record is the plan file for this session; decisions there win over anything stale
  here.
