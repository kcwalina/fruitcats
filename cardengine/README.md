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
  `scheduling`, `objects`, `families`, `decks`, `setup`.
- `survey/`: eight popular TCGs written against the catalogue by survey agents, each with a game
  document, five cards, a gap table and a verdict; `summary.md` consolidates the gaps by layer.
  `survey/broad/`: 156 TCGs classified against the libraries with a fixed record per game
  (`games.md` is the sourced list, `batch-*.md` the records, `summary.md` the aggregate).
- `folkborn/`: Folkborn written against the libraries. `folkborn.alex` is the game (it lists the
  libraries it `uses`, declares its card types as subtypes of their records, and fills each
  library's area with rules), `starter-box.alex` and `berry-picnic.alex` are sets (pure data),
  and `starter-box-rules.alex` and `berry-picnic-rules.alex` are program documents: effects,
  statics, conditions, scenarios, and the wiring that attaches them to cards
  (`@citron-fox.on-enter = zing`). Code points at data; data never points at code.

## Principles

- **Libraries are composable blocks, not a framework.** A game takes `units` without `combat`,
  `life` without `heroes`, `responses` with `Stack` or with `ResponseWindows`. Nothing in one
  library presumes another unless `requires` says so, and those edges point one way. Adding a
  library never changes an existing one.
- **A game is a selection.** Every area is a list of rules from the catalogue; absent means off;
  there are no behaviour defaults. A different behaviour is a new rule beside the old one, never
  an edit. Rules carry a `cites` field, a rulebook citation copied into logs and never parsed.
- **A card's abilities are data; what they do is code.** A card lists `abilities = [OnEnter { text =
  '...' }]`: that it has one, of what kind, with its printed text and its once-per-round flag.
  Ability kinds are types a library declares (`type OnEnter : Ability { holders = [nameof(UnitCard)]
  }`), so two cards share a type and no value. The handler lives in a rules document, assigned to
  the holder's slot named after the kind (`@citron-fox.on-enter = zing`). The linker requires each
  declared ability to have its handler and each handler its declared ability; the first error is
  the IDE's fill-in-the-blank, the second keeps code from giving a card behaviour it does not show.
- **Open sets are values, not enums.** Action kinds, moments and keywords are values a library
  declares (`attack = ActionKind {}`, `type Guardian : Keyword {}`), so a new library adds to them
  without touching anything shared.

## Language conventions, as settled

- A file declares one named value, and the name matches the file: `folkborn = Game`. A bare type
  name on the right-hand side is an open instance whose fields follow as `path = value` lines; a
  bare `field = value` at top level addresses the root. `Type { ... }` is a closed instance, and a
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
- `nameof(x)` is the identifier's last segment as text, checked to exist, never dereferenced.
  Convention: a member whose display name is its identifier is written in Title Case and uses
  `name = nameof(...)`; cards keep lowercase identifiers and string names.
- `nic` (Polish for "nothing") is the no-value. A field is required exactly when its type doesn't
  include `nic`; `T?` is sugar for `T | nic` on a single type; a union with nothing is spelled
  out, never parenthesised. Omitted means `nic` in a document and unchanged in a patch.
  Collections default to `empty`, never `nic`.
- Short text is an inline literal (`flavor = 'Honk.'`, apostrophes doubled). Text tables are
  reserved for text that is multi-line or too long for one line: `@@@ name` starts a text, the
  next marker ends it, a bare `@@@` ends the table.
- Two layers, one language. The data layer is everything a data-mode parse accepts; `data` is its
  widest type, asserted with `type Set : data` and required with `accept = data`. The program
  layer adds `effect`, `static`, `condition` and `scenario` declarations with bodies, `extension
  Type { field: T }` blocks (a data-typed member is an ordinary field once its schema is loaded; a
  function-typed member is program-only), and assignments through references to those members
  (`@citron-fox.on-enter = zing`), which may only target extension members and are set once
  across the whole game. A game declares its card types as subtypes with fixed fields
  (`type Fabled : UnitCard { unique = true }`).
- Layout: no line over 100 characters. A type declaration lists one field per line unless it is
  short; a value lists one field or one natural group per line; a long comment goes on its own
  line above what it describes. Text-table bodies are exempt.
- The design record is the plan file for this session; decisions there win over anything stale
  here.
