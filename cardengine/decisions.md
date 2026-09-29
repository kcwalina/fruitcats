# Card-game IDE: design decisions (session record, 2026-09-27 to 2026-09-28)

## Immediate step (requested 2026-09-28): reference files only, no engine code

Create a folder in this worktree, `cardengine/` (rename freely), with two subfolders:

- `cardengine/framework/framework.alex`: the framework's schema in revised Alex: enums (`Role`, `Shape`,
  `Visibility`, `Initiative`, `PayBy`, `WindowAfter`, `Reset`, `Builtin`, ...), record types (`Game`, `Set`,
  `Players`, `CardType`, `Zone`, `Setup`, `LifeStack`, `CardsAsResources`, `AlternatingActions`, `Phase` steps,
  `Combat`, `ResponseWindows`, `Keyword`, `Mechanic`, `Counter`, `Token`, card roles, `Face`, `Deck`, `Family`),
  and the DSL environment declarations (`trigger`, `verb`, `selector`, `filter`, `condition` signatures).
- `cardengine/folkborn/`: `folkborn.alex`, `starter-box.alex`, `starter-box.rules`, `berry-picnic.alex`,
  `berry-picnic.rules`, exactly as settled in chat (file-is-the-value roots, enums, `@` names, text tables).
- A short `cardengine/README.md` saying these are design reference files, not yet parsed by anything.

So the language and framework can be discussed by editing files instead of re-pasting them. Nothing else is
implemented in this step.

Status: discussion in progress. This file records conclusions reached in chat so they are not lost. It is not
yet a plan to approve.

## Context

Indie TCG designers' biggest cost is playtesting: printing, conventions, slow iteration. Folkborn already has
bot and LLM playtesting that works. The idea is to offer it to other designers. The obstacle is that every TCG is
a different game, so the product cannot be "submit a description and playtest".

## Conclusions

1. **The product is an LLM-based IDE for online card games** (Lovable / Bolt for card games), not a playtest
   service and not a Tabletop Simulator clone. First deliverable: a playable, rules-enforced online card game
   from a rulebook plus a card sheet, shareable by link, playable against friends or a bot. Second act: LLM
   playtesters and balance reports. No unenforced "tier zero" table: the engine is the product.
2. **What is reusable from fruitcats is the harness, not the engine.** Bot (lookahead over legal actions), LLM
   player (text view + numbered choices, retry, fallback), judgement metrics, reports, balance gate, API,
   runner, dashboard, golden replays all sit above a small game interface: initial state from decks + seed,
   legal actions for whoever decides now, apply, per-seat hidden view, describe as text, winner. That
   interface is the foundation. The Folkborn engine (~2,600 lines, `packages/engine/src/engine.ts`) is one game.
3. **Paper test against three TCGs** (Lorcana ~70% card fit but turn loop and win condition differ; Pokémon ~30%;
   Magic ~15%): even the closest game needs core surgery, so a universal data-driven engine is the wrong shape.
4. **Games are written in a safe DSL, not sandboxed TypeScript.** Safety by construction: the interpreter has no
   IO, no clock, no ambient randomness. Design, Starlark-like:
   - strict subset of JavaScript syntax, our parser, our AST, our interpreter (anything outside = parse error);
   - fixed state model: players, zones, cards, counters, flags; state is plain data (save, replay, version);
   - zone visibility declared, hidden-information view generated (no accidental leaks to bots);
   - RNG passed in, chance is a visible node; "ask player X to choose" is a primitive (reaction windows, stack);
   - bounded iteration only (loop over zones/lists, no `while`, no recursion): every action terminates;
   - cards as data on top (trigger / condition / target / verb), vocabulary defined per game by the skeleton;
   - compile AST to JavaScript with our own compiler for the bot farm; interpret in the browser.
   Acceptance test for the language: port the Folkborn engine into it.
5. **Two tiers per game**: skeleton program (turn structure, zones, resources, combat, win) written by the agent,
   changed rarely; card data edited by the designer directly, extended by the agent only for new verbs.
   Rules text generated from card data so print and engine cannot drift.
6. **Templates**: projects start from the closest working archetype skeleton (Magic-like, Hearthstone-like,
   Pokémon-like, cards-as-resources like Lorcana/Folkborn). This is the main lever on agent failure rate and
   therefore on support load.
7. **Self-serve rules loop**: rulebook is the source of truth and grows with written rulings; every engine
   event carries the rule id that caused it; every ruling becomes a plain-words scenario test the agent must
   pass and keep passing; after a change, replay the designer's own games and show which would differ;
   escalation to the owner is a metric to watch, not the plan.
8. **Generic bot**: information-set MCTS with random rollouts needs no per-game evaluation; per-game heuristics
   are an optional speed-up.
9. **Harness for the coding agent**: model behind the same OpenAI-compatible seam as `playtest/llm/providers.ts`;
   harness behind a thin interface (own, Pi, Agent SDK interchangeable). The agent's job is narrow: implement
   the interface in the DSL from the template, pass scenario tests, keep the run harness green.
10. **Pricing (IDE model)**: subscription ~$20-25/month with agent messages included; extra messages and LLM
    playtest games as credits; bot play and human tables free within the plan (cost nothing); free tier with a
    small message allowance. Cost estimates from our config prices: ~1.5 cents per LLM game on a gpt-oss-20b
    class model, ~30 cents on a frontier model, bot games effectively free, agent setup $20-150 per game.
11. **Support model**: no SLA; chatbot first, agent queue second, owner third at own pace; cohort admission
    (waitlist, admit at the rate the owner can watch, as the Artist Studio does); community forum.
12. Designers can see and export their game's DSL code (trust, no lock-in).

## Game definition (revised twice; this supersedes items 4-5 above)

Target users are designers, not developers. **Nobody writes programs.** Rejected on the way: sandboxed TypeScript
(safety by analysis), a JS-shaped safe language, and a rulebook-like readable language (a research project).

- **One fixed engine, assembled from modules by configuration.** The turn loop, phases, priority, combat and win
  checks live in the framework (TypeScript we own and test). A game picks modules and parameters, no program:
  - turn shape: full turns with phases | alternating single actions until both pass
  - resources: growing counter (Hearthstone) | any card face down (Lorcana, Folkborn, SWU) | resource cards from
    the deck (lands; energy attached) | pitch from hand (FaB) | none (Yu-Gi-Oh)
  - combat: attacker picks target | defender declares blockers | lane pairing | power comparison per location |
    none (effects only)
  - interaction: none | response windows at declared moments | full stack
  - win: counter reaches 0 | life stack empties | counter reaches goal | deck out
  - board: zone shapes from the survey; counters and flags
  Folkborn = alternating actions + cards as resources + life stack 9 + attacker picks target + response windows
  on play and attack + initiative flag (Lantern). Hero flip is a two-faced card with a trigger (card script).
  Pokémon = full turns + energy attached + active/bench slots + attack from active + life stack 6.
- **Card effects are flat scripts, no loops**: trigger, condition, target selector, verb, amount. "For each
  creature you control" is a selector, not a loop; "repeat N" is a verb with a bounded count. Folkborn's
  abilities format (when / if / target / do) is already this. Evidence: Forge implements ~all of Magic in a flat
  keyword-value card script with the engine in Java; Hearthstone is data + tiny effects.
- **Agent's job becomes classification, not programming**: read the rulebook, pick modules and parameters, write
  one flat effect per card. Cheaper models suffice; validator catches most errors; the result is explainable to
  the designer on one screen ("full turns, defender declares blockers, 20 life, lands as resources"), which is the
  acceptance step.
- **Unsupported games wait for a module** (Digimon memory gauge, Netrunner runs, Doomtown poker). Modules are our
  roadmap and moat. Risk: module interactions; mitigate with templates as known-good combinations and a test suite
  per module.
- Per-game component = configuration + card scripts + assets + scenarios (Given/When/Then). Designers can export it.

## Data vs. DSL (decided)

- **Data, never code**: card stats (type, cost, power, health, keywords, faces, rarity, art), set mechanics'
  numbers, deck lists, and the whole game configuration (deck/hand sizes, turn shape, resource module, life
  module, win, zones, combat mode, response windows). Edited in tables and forms; importable from a spreadsheet.
  A card with no abilities has no code at all.
- **DSL, only for special card rules**: the ability text, the one thing a spreadsheet column cannot hold.
  A creature with attack and HP and nothing else, or only keywords, is pure data.
- Measured: 66% of Folkborn's 174 cards have an ability (Starter Box 74%, Berry Picnic 95%, the folk decks
  65-71%); Magic and Hearthstone are similar. So most cards carry 1-2 lines, a third carry none, and lines repeat
  heavily (three Citrus cards share "with Zest: +1 Power this round"). Set mechanics as data templates (Zest,
  Leftovers today) let designers pick a mechanic from a list instead of writing the line.

## DSL sketch (decided: code-like, NOT human-readable language)

Text in is never English. The DSL is simplified code: identifiers, numbers, strings, punctuation, a ten-line
grammar. Header `on <trigger>[, if <cond>][, target <selector>][, responding <event>][, oncePerRound]:` then a
body of verb calls. Selectors are calls (`unit(own, other)`, `units(enemy)`, `this`, `attached`, `target`,
`event`); conditions are named set conditions (`Zest`, `Lush`) or count comparisons (`treats >= 7`). No loops,
no user-defined names beyond `target`; `instead` and `oncePerRound` are the control flow. Verbs and selectors are
framework functions; the DSL can only call them. Human-readable card text is *generated from* it (as write-text
does today), never parsed.

```
// Sanguine
on defeatsInCombat, oncePerRound:
  ready(this)
// Hiss!
on play, responding attack:
  cancelAttack(event)
// Bleu
on enter, target unit(own, other):
  counter(target, crumb, +1, max 3)
static:
  grant(units(own, counter(crumb) >= 3), keyword Sneaky)
// Gooseberry Goose
on enter, target unit(enemy):
  exhaust(target)
  moveCounter(target, this, largest, as crumb, max 3)
```

This is today's ability JSON (`when / if / target / do / instead / static`) minus braces. Keeping JSON as the DSL
is acceptable (no parser); the slim syntax is preferred for diffs and fewer agent bracket errors. Cosmetic either
way; the framework does the work.

Today's JSON abilities (`when / if / target / do / instead / static`) already have this structure; the text form
is a readable projection and printed text is generated from it. The Goose is the one Berry Picnic card that
needed TypeScript (`stealCounter` in `content/2026/12/berry-picnic/plugin.ts`): in the new model the framework
gains a `move counter` verb and the card stays one line. Same grammar covers Hearthstone (`on enter` / `on
leave`), Pokémon (`attack` as a card-level construct enabled by the game), Magic auras and instants.

The game file is configuration, not a program (deck/hand sizes, turn shape, resource module, life module, win,
board zones, combat mode, response windows, initiative flag). Scenarios are Given/When/Then.

Vocabulary needed for Starter Box + Berry Picnic: ~15 verbs, 8 triggers, ~12 selector phrases. Expect the survey
to grow verbs to ~60 and triggers to ~20 while cards stay 1-4 lines.

## Typed DSL and IntelliSense (decided: required)

- **Type environment generated from data, per card**: game config (zones, counters, resources, card types,
  keywords, modules on) + module event declarations + set mechanics and named counters + the card's own type.
  A Creature has enter/leave/attack/attacked/damaged/defeatsInCombat; a Charm has play, and `responding attack`
  only with Ambush and response windows on; a Talisman has attached. Counter names are exactly those declared.
- **Signatures declared once in the framework** (`counter(target: Unit, name: CounterName, delta: Int, max?:
  Int)`, `grant(who: Set<Unit>, what: Grant)`, selectors return `Unit` / `Set<Unit>`, `event` typed by trigger).
  From the one declaration derive: runtime dispatch, type checker, completions, card-text generator. No drift.
- **Editor**: Monaco in the browser with completion/hover/diagnostics providers; no language server process.
  Parser + checker + completions ~1-2k lines. Completions are exhaustive (closed world).
- **Same checker serves the agent**: precise diagnostics for self-correction; the card's typed environment goes
  into the prompt (valid triggers/verbs/names), which is what makes cheaper models viable for card work.
- **Closed-world checks**: unused counters, undefined keywords, `responding attack` without Ambush, selectors
  that can never match under the config, generated text vs. designer-typed text mismatch.
- Language gains dot access on typed values (`event.attacker`, `this.counter(crumb)`); still no variables or
  loops.

### Events, roles and who may define what

- **Roles are built in, card types are data.** Roles: unit (in play, stats, can fight), spell (played, resolves),
  attachment (sits on a unit), unit with faces (heroes/leaders). Folkborn's Creature/Charm/Talisman/Hero and
  Pokémon's Pokémon/Trainer/Energy are names mapped to roles. Roles decide lifecycle events (enter/leave,
  play/resolve, attached/detached).
- **Modules add events**: combat (attack, attacked, blocked, damaged, defeatsInCombat), turn (roundStart,
  turnStart, phases), counters (counterAdded), zones (drawn, discarded, revealed), response windows
  (responding). Every framework verb is also an event (youHeal). Combat off = no combat triggers exist.
- **Designers compose, never invent**: named conditions (Zest, Lush), keywords bundling abilities (Leftovers),
  counters, all in data. Events, verbs and roles are framework-only additions.

### Typed syntax (illustrative, agreed direction)

```
on enter {                                            // Bleu; this: Creature
  target = choose(units(own).except(this))            // Set<Unit> -> Unit; `target` is the only binding
  target.counters.crumb += 1, max 3                   // sugar for counter(); crumb is an enum per set
}
static { units(own).where(counters.crumb >= 3).grant(Sneaky) }   // where: implicit subject, no lambdas
on play, responding Attack { cancel(event) }          // Hiss!; legal only with Ambush + response windows
on enter { target = choose(units(enemy)); exhaust(target)
           moveCounter(from: target, to: this, which: largest, as: crumb, max: 3) }   // Goose
```

Framework declarations are the single source of truth: `trigger('defeatsInCombat', { on: Creature, event:
Combat })`, `verb('counter', { of: Unit, name: CounterName, delta: Int, max: Int.optional() }, run, text)`.
`CounterName`, keyword, zone and condition names are enums computed per set/game, so every name in the language
is drawn from a finite set: completions list all of them, the checker rejects everything else, with messages
like "Charm has no trigger 'enter'. Charms have: play." / "'responding' needs the Ambush keyword."

### Final shape: instantiate and configure (decided 2026-09-27, supersedes the sketches above)

Everything the survey shows is cross-cutting is a **framework property with a per-game display name**, never
declared by the game: `swift`, `guardian`, `sneaky`, `fierce`, `tough(n)`, `lucky`, `ambush` (Haste/Rush,
Taunt/Bodyguard, Evasive, Flash/Quick Effect, shield trigger...). Events are properties too: `onEnter`,
`onDefeated`, `onPlay`, `onDefeatsInCombat`, `exhaust`, `awaken`, `static`, each taking one effect expression.
Modules are constructors with parameters. A game program is a series of instantiations:

```
game Folkborn {
  turns = AlternatingActions(endWhenBothPass: true); roundStart = [readyAll, draw(2), mayOffer(1)]
  resources = CardsAsResources(name: "Offerings", start: 2, perRound: 1)
  life = LifeStack(name: "Candles", size: 9, lostCardTo: hand, emptyDeckCosts: 1)
  board = Row(name: "Yard", max: 6); combat = AttackerChooses(targets: [unit, hero], damagePersists: true)
  responses = Windows(name: "Ambush", on: [play, attack], nesting: false)
  initiative = Token(name: "Lantern", takeAsAction: true, passesIfUntaken: true); hero = TwoFaced(...)
  names = { Spell: "Charm", Attachment: "Talisman", swift: "Swift", onEnter: "Hello", onDefeated: "Goodbye", ... }
}
Counter("Crumb", power +1, health +1, max 3, fullAt: 3)                  // the set's only declarations
Keyword("Leftovers") { onDefeated: choose(own unit).Crumb += 1 }
Token("Ant", 1/1) { leftovers }
Creature("Garden Snail", cost 2, 1/4) { guardian, lucky }                // properties only, no expression
Creature("Mail Duck", cost 3, 2/3) { onEnter: draw(1) }
Creature("Gooseberry Goose", cost 3, 3/2) { onEnter: choose(enemy unit).exhaust().moveLargestCounter(to: this, as: Crumb) }
Fabled("Bleu", cost 3, 2/3) { onEnter: choose(own unit, other).Crumb += 1; static: own units(full).sneaky }
Spell("Second Helping", cost 1) { ambush, onPlay: choose(own unit).Crumb += 1 .buff(power +1, thisRound) }
Attachment("Friendship Bracelet", cost 1) { attached: power +1, leftovers }
Deck("Picnic Club", hero: Jam) { ... }
```

**Every instantiation is an assignment to a typed variable** (`ant = Token("Ant", 1/1) { leftovers }`,
`crumb = Counter(...)`, `jam = Hero(...)`); the display name is a string argument; references use the variable
(`summon(ant)`, `counter(crumb)`, `hero: jam`, deck lists). Types check references (`summon` takes a Token, so
`summon(mailDuck)` errors); built-in zones (`hand`, `deck`, `discard`) and module-created zones are framework
variables; define before use, no forward references. The variable is the card's id column in the IDE's table.

Whole game ~15 lines of configuration; each card one line, plus one expression if it has a real ability. Only
genuinely new things (a set's signature counter/keyword/token) are declared. The framework does the remembering;
the survey decides the property list. Rulebook citations stay as trailing comments.

### Declarative / imperative split (decided: the XAML line, held strictly)

- **Declarative side: one JSON document per set, edited by forms.** Literals, flags, display names, deck lists,
  tokens, counters, hero faces, and the *wiring*: which events a card handles and the **name** of the code that
  handles them (`"onEnter": "giveCrumb"`, `"static": "fullUnitsAreSneaky"`, `"awaken": "fiveUnits"`). Rulebook
  citations are a `rule` field (the rule-trace reads them), not comments. **Never an expression in the data**:
  `"awaken": "own units >= 5"` is the crack that broke XAML; refuse it.
- **Imperative side: one code file per set, edited in the code editor.** Named `effect`, `static`, `condition`
  blocks. Nothing in it names a card; `this` is whatever the wiring attached it to (XAML's `sender`).
  Effects are reusable across cards (Lamb and Bleu share `giveCrumb`; three Citrus cards would share
  `zestPlusOne`) = XAML resources.
- **Linker** checks references both ways (missing effect = error, unreferenced effect = warning) and types
  (`"static": "giveCrumb"` fails; an `onPlay` effect on a Spell cannot use `this.counter`).
- **IDE "add ability"** = pick card, pick event, pick an existing effect or "new" (writes the reference, opens an
  empty stub). The agent performs the same two writes.
- The single-file program is a **read-only projection** generated from both halves, for reading and diffs.
- Game configuration is also declarative JSON (module constructors + parameters).

### Declarative format: Alex (recommended; owner to confirm)

Requirements: comments, references by identity, schema, multi-line text (flavor/lore), lossless round-trip for
form edits, diff-friendly, model-writable from a spec, **no expressions**. JSON fails comments and refs; YAML's
anchors copy and round-trip is poor; KDL has no refs; HCL/Pkl/CUE/Dhall/Jsonnet are half programming languages.

**Alex** (`C:\git\mochi\mochi.agents\alex`, spec `docs/language-specification.md`, C# ~5k lines, VS Code
extension) fits by design: "syntax is admitted when it expresses a data distinction", `//` comments, `@name`
identity references (forward refs allowed), `type` record schemas, hash-scoped text, declarative patches.
- Named `##` headers under `# cards` are the card variables; `@cards.goose` is the reference.
- **Patches are a product feature**: a balance experiment or a designer tweak is a patch over the base set
  (what `PLAYTEST_CARD_MODS` does today); a run = base + patch; the report's "what changed" is the patch.
- Code handlers are referenced by string name (`on-enter = 'stealASnack'`); the linker checks them.
- Costs: TypeScript port of the data-modeling subset (~2k lines; mochi's tests are the acceptance suite);
  the port must keep trivia for lossless round-trip (check whether the C# parser does); models will write
  double quotes until the validator corrects them.
- Refuse: putting handler code in a hash-scoped text body (`### on-enter`). Two files, linked by name.
- Fallback if not Alex: strict YAML subset with a round-trip parser, reluctantly.

**Owner's view of Alex**: happy with comments, references, long text; unhappy that it is verbose for small
objects and arrays; the Markdown look is a losing battle; willing to revise the language for this and the other
mochi scenarios.

**Alex revision (proposed, to be written as a short spec before code)**:
- Keep: `//` comments, `@name` identity references (forward allowed, paths `@jam.face1`), `type` schemas,
  single-quoted strings (`"` means nothing), no expressions, patches.
- Drop: hash-depth headers entirely.
- Add: braces for objects with newline **or** comma as separator, trailing commas allowed; `Type { ... }`
  constructs a typed value (forms and checker use the schema); dotted paths on the left for patches
  (`goose.cost = 4`).
- **Multi-line text: text tables, not triple quotes** (owner rejects `'''`). A line starting at column zero with
  `@@@` is a marker. `@@@ name` starts a named text; everything below, verbatim, until the next marker line;
  bare `@@@` ends the table and syntax resumes. Nothing inside is special except a line starting with `@@@`
  (`\@@@` for a literal). One trailing newline stripped; no dedent, no quoting, no comment stripping. The name
  may be a path (`@@@ goose.flavor` fills that property; the object may be defined anywhere in the file); a
  plain name defines a top-level text (`@lore`). Tables may appear anywhere in the file. `@@@` chosen because
  no format starts lines with it (`#`, `---`, `===`, `***`, `+++`, `~~~`, fences, `!!!`, `:::`, `%%`, `///`,
  `>>>>>>>`, `@@ ` all taken). Parser = two modes toggled by `@@@`; round-trip is exact.
- Top level is an object of named values; every name is referenceable; bare words are never strings.
- **Enums** (added 2026-09-28): `enum Shape { pile, set, row, slots, lanes, grid }` in a schema (framework's or a
  game's, e.g. `enum Rarity`). Members are bare words, resolved by the field's declared type
  (`initiative = random`); unknown member = error listing the members (= the completion list); qualified
  `Initiative.random` required where there is no type context; lists typed `[Reset]` take `[damage, this-round]`.
  An enum is the framework's statement of what it implements: a missing member is an edit-time error, not a
  runtime surprise.
- **Language decisions 2026-09-28 (second pass)**: references are orthogonal to types (`sets: [Set]`, value may
  be inline or `@name`; the binder still resolves to one object because paths are ids). `{ *: T }` is the map
  type only, never mixed with named fields (`Set` has dedicated maps `families`, `mechanics`, `counters`,
  `tokens`, `cards`, `decks`). Maps need no reflection; union types are discriminated by the constructor name,
  the only runtime tag. `nameof(x)` added: last identifier segment as text, must be declared, never
  dereferenced; convention: Title Case identifier + `name = nameof(...)` when display name = identifier.
  Unqualified `@name` resolves to a uniquely named member anywhere in the game's reachable graph. `Rarity` is a
  framework enum (common, uncommon, rare, epic, legendary, mythic). Reference files live in `cardengine/`.
- **First-class maps (2026-09-28)**: brackets are collections, braces are records. Type `[K: V]` with K =
  `text` or an enum (`[Rarity: int]`); literal `[key = value, ...]`; empty `[:]`; ordered; duplicate keys are
  errors; `{ *: T }` removed. Applied to all `cardengine/` files (zones, types, keywords, event-names, set
  maps, framework triggers/events/selectors/filters/verbs, Event `fields`, Verb `params`).
- **Several resources per game (2026-09-28)**: `resources: [text: Resource] = [:]`, `Resource =
  CardsAsResources | GrowingCounter | ResourceCards | PitchFromHand`; `NoResources` removed (`[:]`).
  `cost-resource: Resource?` names what a bare `cost = n` is paid in (required with more than one).
  `Cost = int | [text: int]` (keys = resource names or a resource's kinds: `[credits = 3, clicks = 1]`,
  `[red = 1, any = 2]`). Resource verbs take an optional `resource` defaulting to cost-resource. Folkborn:
  `resources = [Offerings = CardsAsResources { zone = @zones.Offerings ... }]`, `cost-resource =
  @resources.Offerings`. Open: `life` deserves the same treatment (Keyforge keys + aember, Weiss clock + level):
  a map of player tracks with win/lose rules referencing them.
- **`empty` literal (2026-09-28)**: the empty list, map or text, resolved by the field's type like an enum
  member; error without type context. `[:]` removed; `[]` and `''` remain legal literals but defaults use
  `empty`. Applied to every default in `framework.alex`.
- **Optional modules, no marker types (2026-09-28)**: `NoCombat`, `NoResponses` deleted. Rule: a module that
  can be off is nullable, never a "None" alternative with a default.
- **`nic` is the no-value (2026-09-28)**, replacing Alex's `null`. Required = type excludes `nic`. `T?` is
  sugar for `T | nic`, single types only; unions are spelled out: `combat: AttackerChooses | DefenderBlocks |
  Lanes | nic`, `responses: ResponseWindows | Stack | nic`. Omitted = `nic` in a document, unchanged in a
  patch (`x = nic` turns x off). Collections and text default to `empty`, never `nic`.
- **Layout rule (2026-09-28)**: no line over 100 characters anywhere in `cardengine/` (text-table bodies
  exempt). Type declarations one field per line; values one field or one natural group per line (cards:
  identity / stats / abilities); long comments above the line. All seven files reformatted.
- **Open instances and named roots (2026-09-28)**: `x = Type` (no braces) creates an open instance filled
  by later `x.field = value` lines; `x = Type { ... }` is closed and cannot be assigned into later; every
  path is set exactly once; order-independent; only the owning document assigns (patches are the explicit
  exception, same syntax); `zones.Deck = ...` creates a schema-typed map implicitly. A file declares one
  named value matching its file name (`folkborn = Game`, `starter-box = Set`); a bare `field = value` at top
  level addresses the root. **Type names are capitalised, members/fields/keywords are not**: that is what
  distinguishes `folkborn = Game` from `initiative = random`. Convention: root and cards flat, small records
  nested. Applied to the four `.alex` files (root line only so far).
- **Text tables only for long or multi-line text (2026-09-28)**: short strings are inline literals
  (`flavor = 'It''s fine.'`). Starter Box and Berry Picnic inlined 82 texts; only the Mango Tango blurb and
  the Leftovers reminder remain in tables because they exceed 100 columns.
- **Program layer (decided 2026-09-28, briefed to the Alex session)**: two layers in one language. Data
  layer = what data mode parses; `data` is its widest type, inferred structurally, asserted by
  `type Set : data`, required by `accept = data`; `any` is the top. Program layer = `effect` / `static` /
  `condition` / `scenario` declarations with bodies (small generic grammar: literals, enum members,
  `@refs`, calls with positional and `name:` args, member access, comparisons, and/or/not, `x = expr`
  locals, `+=`, `if/else`, `if not`; the host supplies names and signatures), `extension Type { ... }`
  adding function-typed members visible only in program mode, and `@obj.member = decl` wiring that may
  only set extension members, set-once across the game, with required members checked game-wide.
  **Code points at data, never the reverse**: set files carry no behaviour; `link` was dropped before it
  was built. Games declare card types as subtypes with fixed fields (`type Fabled : UnitCard { unique =
  true }`), replacing the CardType-constructor hook; `enum Role` removed. Rules files are Alex program
  documents (`starter-box-rules = Rules`, `for = @starter-box`); the `Set.rules` field is gone. Selectors
  in call syntax: `choose(own, other)`, `units(opponents)`, `buff(power: +1, until: this-round)`.
- **Rulings for the Alex session (2026-09-28, second round)**: `attach-to: Role?` became
  `attaches-to-units: bool`; `choose(any)` became `choose(all)` (no `any` selector); the calls are right
  and the verbs map follows them: params in call order, `optional = [...]` on Verb and Selector, `grant`
  params absorb keyword and `stat: +n` arguments, `buff(..., until:)`; a receiver-less player verb acts on
  `own`, a unit verb on `this`; `properties` map (played-this-round, resources, life, count, any) added to
  the framework; `units` is a selector with params, the `unit` selector is gone (`choose` covers it).
  Interpretations accepted: schema documents always parse in program mode; bare or `@` names on wiring
  right-hand sides; kinds are host-registered lowercase type names, not keywords; `this` in a Mechanic's
  handler is the unit carrying the keyword.
- **Layered framework (2026-09-28, owner's evolvability concern)**: `core.alex` (frozen: object model,
  zones, players, counters, keywords as tags, `type Rule { cites: text? }` extension point, program-layer
  plug records, core vocabulary choose/draw/summon/counter/cancel; append-only, no renames, new fields
  default to prior behaviour) and `framework.alex` (the battle framework: a **catalogue** of small rule
  types per area, `type GuardiansFirst : CombatRule {}`, `LifeDamage { n }`; `extension Game { life:
  [LifeRule], combat: [CombatRule] = empty, ... }`; card records; families/mechanics via `extension Set`
  and `extension Card`; `BuiltinKeyword : Keyword { is, value }`; `StatCounter : Counter`). A game is a
  selection: absent = off, **no behaviour defaults**; a different behaviour is a new entry, never an edit;
  a second framework can sit beside it (WinForms/WPF). Built-in keyword flags removed from cards:
  `keywords = [@Guardian, Applied { keyword = @Tough, n = 1 }]`; faces `keywords = [@Fierce]`. `cites`
  replaces `rule` (a citation string copied to logs, never parsed). Documents carry `core = '1'`.
  Evolution rules written into both file headers. Still to brief the Alex session: aliases for renames,
  deprecation annotations, tolerant loading, version stamps + patches as migrations; and the safety net:
  replay every stored match of every customer game on each framework build (golden-game equality).
- **Core runtime contract (2026-09-28)**: `core-operations.alex` is the interop layer the engine
  implements: state model (object/player/game fields: states, counters, attachments, under, visible-to,
  flags, pending), 19 operations (move, shuffle, flip, set-state, add-counter, attach/detach, stack-under,
  create/destroy, reveal/conceal, adjust, set-flag, adjust-game, set-game-flag, eliminate, end-game, log),
  queries (legal-actions, next-actor, round-over, game-over, view, state-check) answered through hook
  kinds (provide, filter, before, after, replace), decisions (choose, simultaneous), scheduler (enqueue,
  open-window, order-pending), a fixed loop skeleton with slots, view rules, random (shuffle, roll, pick)
  and the trace. Frameworks are TypeScript against this contract (the stable ABI, versioned like
  core.alex); the Alex program layer is not grown for framework authoring yet. Proof of sufficiency =
  implement the battle framework and a structurally different second framework with zero core edits;
  first engineering milestone after the Alex work. `core.alex` alone was only the data half.
- **Extension members come in two kinds (ruled 2026-09-28)**: a data-typed extension member is an ordinary
  field once its schema is loaded (data documents set it, visible in data mode, counts toward `data`); a
  function-typed member is program-only, set through `@x.member = decl`. This is the layering mechanism:
  core declares base types, a framework extends them. Schema documents declare their root types (`Core`,
  `Framework`, `CoreOperations`); a schema's references see every loaded schema's members and no
  document's. Schema load order: core, core-operations, framework. The Alex session has the fixture list;
  the first series (new dialect) is landed in mochi; program-layer spec and parser are committed.
- **Engine is a headless simulation (owner, 2026-09-28)**: input = a stream of actions per player (bot,
  LLM, human client, recording); output = the event log; nothing in the core knows a screen or a prompt.
  `open-window` and `choose` removed from the contract: the engine logs `action-required { player,
  options }` and reads that player's next action (`require-action`; `require-actions` for simultaneous);
  a response window is provide-actor (the defender) + filter-actions (responses and decline), not a
  primitive. `log` operation removed; every operation's event carries visibility (per-observer log; a view
  is the fold of an observer's log; a framework may narrow, never widen). Randomness events make replays
  seed-free. UI is a later layer that interprets the log.
- **Rulings, third round (2026-09-28)**: `optional` on Verb/Selector is a map `[text: ParamType]` (optional
  parameters follow `params` in call order), not a `[text]` list of bare words; `extension Token { cost:
  Cost = 0, power: int, health: int }` in the framework (core's Token has no stats). Accepted language
  change: a data document never sees declarations; the target of `@x.member = ...` resolves among data
  only; only a reference inside a program document reaches a declaration (so a card and an effect may
  share a name). Status from the Alex session: all schemas and documents bind, 63 wirings attach, every
  Charm has on-play; next it type-checks every body against the vocabulary.
- **Alex status (2026-09-28, end of day)**: both series are done and in mochi's land gate: the new dialect
  and the program layer (spec chapter 11, parser, binder, tests, VS Code 0.4.0, CHANGELOG). Acceptance
  passes on the cardengine files: schemas bind; game and sets bind as data; rules documents bind in
  program mode with 63 wirings and on-play on every Charm; every declaration is refused in data mode;
  wrong bodies are refused with the framework's vocabulary. Extra language rules recorded in the spec:
  data-typed extension members, declarations invisible to data, wiring targets data-only, schemas see
  each other, absorbing parameters, `true`/`false` as expressions. Not yet briefed: aliases, deprecation
  annotations, tolerant loading, version stamps + migrations (owner to decide).
- **Survey of eight TCGs (2026-09-28, Sonnet agents, `cardengine/survey/`)**: Magic, Pokémon, Yu-Gi-Oh!,
  Hearthstone, Lorcana, Flesh and Blood, KeyForge, Digimon. Core gaps (5, all additive but one): nestable
  priority (scheduler drain policy after-all-pass, a `respond` input, pending effects as targets) for
  Magic/YGO/FaB; `Filter.params` + predicate filter expressions; a `target` ParamType = unit | player;
  a hook evaluating rules of objects in `under`; remove `Game.win`/`on-loss` (rules own game-over).
  Framework gaps are numerous and Folkborn-shaped: `PermanentCard`, extension blocks for every record,
  `activate` triggers with costs, ~12 verbs (destroy, discard, search, look-top, gain, capture, may,
  prevent...), selectors (adjacent, here, hand, permanents, discover), many combat/turn/life/deck rules,
  keyword builtins, alternate costs. Coverage estimates 20-60% of card pools today. Core held up better
  than the framework. Next: core fixes before freezing core 1; second framework-only game (Hearthstone- or
  KeyForge-like) as the proof. Summary in `survey/summary.md`.
- **Core changes applied + framework split into libraries (2026-09-28)**. Core: `Game.win`/`on-loss` removed;
  `Filter.params`; ParamType `target`/`targets`/`card`/`moment`/`pending`/`rules`; `Trigger.hidden`;
  `type Library { name, version, core, requires, actions, moments, triggers, events, selectors, properties,
  filters, verbs }`; `Game.uses: [Library]`; open sets as values: `ActionKind`, `Moment` (core declares
  `pass`, `round-start`, `round-end`); core verbs only choose/choose-target/may/counter/cancel; `pending`
  selector. core-operations: `active-rules` query + provide/filter-rules hooks; `drain-policy` query,
  `enum Drain { immediately, after-all-pass }`, `require-response` input; loop comment covers stacks.
  **Libraries** in `framework/lib/` (18): common, units, spells, attachments, permanents, heroes,
  abilities, life, life-stack, resources, turns, initiative, combat, responses, scheduling, objects,
  families, decks, setup. Each: `x = Library`, `requires` (only common→core, units→common,
  attachments→units, combat→units, spells/abilities/resources/decks→common, life-stack→life; all others
  core-only), its own `Rule` base + `extension Game { area: [Base] = empty }`, keyword **types** (`type
  Guardian : Keyword {}`, game: `Guardian = Guardian { name = nameof(Guardian) }`), own actions/moments/
  vocabulary. Survey additions folded in (PermanentCard, activate, verbs destroy/discard/search/look-top/
  gain/capture/reduce/may, DefenderBlocks, Stack/Chain/AlternatingPriority, MemoryGauge, DeckSizeRange,
  DeckPool, LifeShield, WinAtCounter, InheritedEffects, StackPreservesState, etc.). `framework.alex`
  deleted. Folkborn: `uses = [...18]`, areas as before plus `units`, `scheduling`; offers are resource
  policies (`OfferAtSetup`, `MayOfferAt`); Hiss uses a second keyword `AmbushOnAttack = Ambush { only =
  @attack }`; `ZoneCapacity` in `rules`. Alex session not yet told.
- **Abilities as typed data (2026-09-28, owner's IDE-designer point)**: core `type Ability { text, once-per-
  round, holders: [text], event: text?, kind: BlockKind, responding: [text], hidden }` replaces `Trigger`
  values; `Card.abilities: [Ability]`, also on `Face` and `Mechanic`. Libraries declare kinds as types with
  fixed fields (`type OnEnter : Ability { holders = [nameof(UnitCard)] }`; `Static`, `OnPlay`, `Exhaust`,
  `Awaken`, `OnDefeatsInCombat` with `event = nameof(combat)`, `Activate`, `OnEvent { hidden = true }`...).
  A card constructs one: `abilities = [OnEnter { text = 'Hello: ...' }]`; no shared value referenced
  (owner rejected `on = @on-enter`). Handler slots unchanged (`extension UnitCard { on-enter: effect? }`);
  slot = kebab-case of the kind; linker checks declared ⇔ wired both ways; one slot per kind per card.
  `once-per-round` moved from cards to abilities. Printed text is now designer-owned data. Both set files
  regenerated from the original JSON `text` fields (starter-box 42 cards with abilities). `Library.triggers`
  map removed; `nameof` may name types and library values.
- **Broad survey of 156 TCGs (2026-09-28, `survey/broad/`)**: list from Wikipedia/BGG/Kickstarter with
  sources; 16 Sonnet batches; fixed record + machine-read SUMMARY line. Fit: libraries 15 (10%), framework
  129 (83%), core 7 (4%: five 2-D grid games, Artifact's concurrent lanes, one low-confidence), out 5 (3%).
  Confidence high 31 / medium 80 / low 45. Shape: full turns 77%, alternating 12%; resources most varied
  ("other" 23%); life by race 24%; response windows 47%, none 33%, stack+chain 12%; grids 11% of boards.
  Core additions recommended before freeze: 2-D `coords`+`facing`, `adjacent` query; `set-controller`
  operation; nullable `owner`/`controller` (shared objectives); `roll` with face lists (dice pools).
  Schema lesson: base records require only universal fields (`UnitCard.health`/`cost` optional). Framework
  clusters: objectives library (~20 games), contest forms (~15), non-resource costs (~12), grid board (12),
  reveal-from-deck checks (5), new records (StatCard, PlotCard, missions, HP permanents, ClimaxCard, Weapon),
  unit variants (dual stats, power-only, levels, evolve swaps), turn structures (action budget,
  simultaneous, role-by-turn), encounter (co-op), dice. Agents' wrong core claims corrected (zone capacity;
  "subtype can't add a field"). Summary in `survey/broad/summary.md`.
- **Alex session rulings on the library split (2026-09-28)**: documents see schema members (schemas never see
  documents; roots win); no type-directed resolution, references stay orthogonal to types, fixtures qualify
  instead (`@common.actions.play`, `@combat.events.attack`, `@folkborn.zones.Offerings`, first segment must be
  unique); a diagnostics-only host hook `AlexHost.Validate` after binding carries the card-game checks
  (library use, ability ⇔ slot both ways, one kind per object, holders); `zone` added to ParamType; core
  gained selector `opponent` and filter `optional`; turns gained property `played-this-round`; Mechanic
  slots are `mechanic-condition/-round-start/-defeated` with matching kinds; talismans declare no Static
  (the Grant is the effect). Fixtures re-sent; the session is finishing its tests.
- **Alex 0.4.0 landed and pushed (mochi main 7485792b, 2026-09-28)**: new dialect + program layer +
  library split; 294 tests green on the final cardengine files (survey/ excluded). Language additions in
  this round: documents see schema members; `AlexHost.Validate` diagnostics-only hook. Card-engine host
  checks with negative tests: library use, ability ⇔ slot both ways, one ability per kind per object,
  holders. The cardengine folder in this worktree is still uncommitted.
- **Survey findings folded in (2026-09-28, owner: reap the survey before archiving)**. Core: `coords`,
  `facing`, `die` object fields; `owner`/`controller` may be nothing; `turn`, `set-controller`,
  `create-zone`, `roll-object` operations; `roll` takes a face list; `adjacent` query and selector; `Zone.role`
  (`enum ZoneRole { deck, hand, discard, board, life, resource, exile, other }`), `width`/`height`;
  `Rulebook`/`Section` types, `Rule.cites: Section | text | nic`, `Game.rulebook: Rulebook | text | nic`;
  `Card.art`; `BlockKind.scenario`. Libraries: `UnitCard.cost`/`health` optional, `defense`, `level`,
  DefensePosition/DualStatByConflict/PowerOnly/SizeCapacity, `OnUse` + `use` action, `stun`; combat
  TeamAttack/TeamBlock/BlockWithHandCard/BlockersNeedKeyword/ZoneMatchedBlock/MutualStrikeExchange/
  ReversalNegates/ComboWindow/PokerHandContest/RowRestrictedTargeting, `team-attack` event, Blocker/Stun
  keywords; resources PerObjectResource/ProducedByUnits/DamageAsResource/SharedPool/ResourceCardsAttach and
  policies SacrificeCost/ThresholdRequirement/PrerequisiteInPlay/CostReduction/CheckToPlay/ShapeCost/
  AnyPoolPays; spells ClimaxCard; heroes PowerOncePerGame/Levels/PayToFlip/HeroIsUnit/HeroRespawns,
  Face.health, WeaponCard; permanents health/capacity; turns ActionBudget/SimultaneousTurns/RoleByTurn/
  ExtraSummonsUnlimited/NoDrawFirstTurn/KnownDeck; setup ShuffleDeck/SplitSharedPool; life LifeObjects/
  DamageTiers/RuneThresholds; decks GroupCount/CardsPerGroup/FactionLock/ComposedCards; objects
  LevelsOnReplay/MergeIntoOne, swap-card/merge verbs. New libraries: objectives, board, reveal, dice,
  encounter, stat-cards, scenarios (26 libraries, ~245 types). Folkborn: zone roles, ShuffleDeck, uses
  scenarios. Not re-verified by the Alex session (it is idle); additive only, no shape changes.
- **Rule: quotes are for text humans read** (names, flavor, `rule = '§...'`). Anything the engine interprets is a
  reference or an enum member. Handler names are references too: `on-enter = @summon-ant` (the rules file's
  names join the game's namespace; the linker resolves them like `@ant`).
- Schemas: `type Creature { cost: int, power: int, health: int, lucky: bool = false }`; the framework ships them.
- Result: `goose = Creature { name = 'Gooseberry Goose', cost = 3, power = 3, health = 2, on-enter = 'stealASnack' }`
  is both the "instantiate and configure" program and the data file; the code file stays separate.
- Implementation: TypeScript first (the IDE), C# follows the same spec; mochi's Alex tests adapted as the suite.

### Reference rewrite in revised Alex + DSL (written in chat 2026-09-27; the target for the spike)

Three files: `folkborn.alex` (game config: `types`, `zones`, `deck-rules`, `setup`, `life = LifeStack{}`,
`resources = CardsAsResources{}`, `turns = AlternatingActions{ round-start = Phase{ steps = [ReadyAll{},
Draw{count=2}, MayOffer{count=1}] } }`, `initiative`, `combat = AttackerChooses{}`, `responses`, `triggers`,
`state-check`, `hero`, `objects`, `keywords = { lucky = Builtin{ name='Lucky', is='play-free-when-lost-as-life' } }`,
`event-names`), `berry-picnic.alex` (set, family, `crumb = Counter{}`, `leftovers = Keyword{ on-defeated =
'feed-a-friend' }`, `ant = Token{}`, `jam = Hero{ face1 = Face{ exhaust = '...', awaken = '...' } }`, cards as
`Unit { type = @types.creature, ... }` / `Spell` / `Attachment`, `picnic-club = Deck{ cards = [[@ladybug, 3], ...] }`,
flavor and blurbs in a `@@@` text table), `berry-picnic.rules` (named `effect` / `static` / `condition` /
`scenario` blocks). Every rule-implementing value carries `rule = '§...'`.

Settled by the rewrite:
- `full-at = 3` on the counter makes `full` a derived filter; no condition code needed. Data beats code whenever
  the framework can derive it.
- Built-in keywords are flags (`lucky = true`); set-defined ones are references (`keywords = [@leftovers]`);
  forms show them as one list.
- `@` means the same in both languages: a reference to a named declarative value. Code uses `@ant`, `@crumb`.
- Deck lists are pairs `[@card, n]`.
- Phase step lists are lists of typed constructors (what an ordered pick-list form produces).
- **Sets of one game share a namespace** (`@mail-duck` from SB1 resolves in BP1); duplicate names across a
  game's sets are an error. Write this into the spec revision.

### Full rewrite of Folkborn + Starter Box + Berry Picnic (chat, 2026-09-28)

`folkborn.alex`, `starter-box.alex` (53 cards, 3 heroes, 3 decks, Zest/Ripen/Lush/Sprout), `starter-box.rules`
(~60 lines), `berry-picnic.alex`, `berry-picnic.rules` were written in full in chat. Additions the Starter Box
forced:
- **Game `CardType` values are constructors** in set files: `Creature { ... }` instead of
  `Unit { type = @types.Creature, ... }`. `types = { Creature = CardType { name = 'Creature', role = unit } }`.
- **`if ... else` replaces `instead`**; with `if not`, the DSL's only control flow.
- **Wiring data on the card**: `once-per-round = true` (Sanguine, Sakura), `ambush-only = attack` (Hiss),
  `pronoun = 'her'`. Constraints the framework enforces before the effect runs.
- **`Mechanic { kind = condition | keyword | action }`** carries display data (name, family, icon, badge,
  reminder text) and points at code (`condition = @zest-on`, `on-round-start = @ripen-tick`); `Counter` is
  separate (`ripe`, max 2). Sprout is display-only; its effects call the framework verb directly.
- **Framework verbs the resource module owes**: `ready-resources(n)`, `offer-from-deck(n, exhausted)`.
- **Restrictions are a verb family**: `this.cant(attack)` (Lychee Sloth), not negative grants.
- **`choose(..., optional)`** (Warm Cider). Selectors: `own | opponents | all` + `unit | units`, filters
  `other, exhausted, ready, guardian, full`; `.any` on a set.
- Conditions in code: `zest-on { own.played-this-round >= 2 }`, `lush-on { own.resources.count >= 7 }`, hero
  awaken conditions (`opponent.life.count <= 5`).
- 17 effects shared across 53 cards; a set with no rules file is still valid.

### Whole-game program exercise (Folkborn + Picnic Club, written 2026-09-27)

The full game and the 20-card Picnic Club deck were written as one file (game block: types→roles, zones with
shape/owner/visibility, deck/start/turns/resources/life/combat/responses, keywords; set block: counters, named
conditions, keywords, tokens, cards with data header + `on`/`static`/`exhaust`/`awaken` blocks, deck list,
scenarios). Findings that shape the framework:

- **Core keywords split two ways**: Swift/Fierce/Tough are DSL programs (`on enter { ready(this) }`,
  `static { this.lifeDamage = 2 }`); Guardian/Sneaky/Lucky/Ambush are module flags (combat targeting, life
  trigger, response playability). Both named in the game's `keywords` block, used identically by cards.
- **Named conditions at set level**: `condition Full(u) = u.counters.Crumb >= 3` (what Zest/Lush are today).
- **Durations are a type**: `buff(power +1, thisRound)` vs permanent `grant`.
- **Verbs apply to sets without loops**: `units(all).counters.Crumb += 1`.
- Only one verb missing for 20 cards: `moveCounter` (the Goose).
- The game block has no programs; `roundStart { ready(all); draw(2); may offer(1) }` is a fixed verb sequence a
  form with pick-lists would produce.
- **Every line carries a rulebook citation as a comment** (`docs/rulebook.md` §13 has numbered comprehensive
  rules 100-900). Doing so found omissions in the first draft (Hearth zone, Take the Lantern + auto-pass §300.4,
  End Phase discard §300.6, mulligan §5.4, tokens vanish §200.4, zone change resets §200.7, Lucky plays can't be
  ambushed §500.6, trigger ordering §800.3) and one outright error: Goodbye is `on defeated`, not `on leave`
  (§800.4). Citations on flags become the rule-trace in game logs. §900 (tunable parameters) is the game
  configuration form almost verbatim.
- Convention for agent-written games: **each config flag and each ability block cites the rulebook rule or the
  printed card text it implements.** Uncited code is a checker warning.

## Surveys before engine design (agreed in principle; not started)

- **Rulebook survey**: Sonnet-class agents read 1,000-2,000 TCG rulebooks (BGG, Kickstarter) and fill a fixed
  schema (the module/knob taxonomy) plus one free-text field "what doesn't fit". Cents per game, a few hundred
  dollars total. Outputs: knob frequencies (what ships first), configuration clusters (the templates), the tail
  (the roadmap).
- **Card effect survey**: classify tens of thousands of card texts from public databases (Scryfall, Pokémon,
  Yu-Gi-Oh, Hearthstone, Lorcana, FaB) into trigger / condition / selector / verb / amount. Produces the verb
  list with frequencies. Only the derived taxonomy enters the product.
- **Variety by layer (belief to test)**: state low (nine primitives, near total); card effects high in
  combination, low in primitives (~60-100 verbs cover ~99%; indie pools are 100-300 cards so the tail bites
  rarely); flow moderate and commercially important because designers innovate there (a dozen coarse modules
  ~80-85% of published TCGs; indie games bimodal: archetype copies vs. structural twists).
- **Granularity is the lever on flow**: fine-grained knobs (phase list from a menu of steps; turn-end condition;
  play restrictions; simultaneous vs. sequential decisions) cover a combinatorial space without programs.
  Digimon gauge = "turn ends when shared counter crosses 0"; Keyforge houses = "choose a trait at turn start,
  only that trait may act"; Snap = "simultaneous decisions revealed together". The survey shows which knobs vary
  independently.
- **Games in the gap** (tabled, must be decided in the plan): refund + roadmap is acceptable for year one.

## State model primitives (from a survey of ~30 TCGs)

Nine primitives cover well over 9 in 10 published TCGs; the rest (physical-room effects, dexterity, subgames) is
out of scope on purpose.

- **Objects**: cards and tokens; several faces; state flags (tapped/exerted, attack/defence position, face-down,
  stunned...); named counters; attachments (energy, auras, DON!!); under-stacks (Xyz materials, digivolution,
  evolution, shift) with inherited effects.
- **Zones**: owned, shared or global; declared visibility (owner / all / none / top card); declared **shape**:
  pile or stack, ordered row (adjacency, flanks), fixed slots (Yu-Gi-Oh zones, active + bench, equipment slots),
  lanes or arenas (Runeterra, SWU, Snap locations), grid with adjacency (Sorcery, Summoner Wars, Doomtown).
  Several decks per player.
- **Counters and flags** at player and global level: named bounded numbers (life, mana, lore, aember, honor,
  credits, clicks, armor, memory gauge as a signed global counter) and enums/flags (initiative, monarch,
  once-per-game, day/night, keys forged).
- **Hero / leader card** with own stats and slots.
- **Asymmetric roles** (Netrunner corp/runner): two code paths in the skeleton.
- **Randomizer**: shuffle, coin, dice with arbitrary named faces (Ashes, Dice Masters), flip-top-card checks.
- **Decision**: whose choice now (stack, chains, combat chain, Ambush windows) plus a simultaneous hidden variant
  (Marvel Snap).
- **Flow** (turn phases, alternating actions until pass, best-of-3 rounds, sideboarding, drafting): ordinary code
  in the skeleton, no language construct.
- Movement, combat modes, poker resolution (Doomtown) etc. are code on top.

**Rendering follows zone shape**: pile = back + count, row = fan in order, slots = fixed frames, grid = grid,
counters = badges, attachments fan beneath, under-stack = thickness, orientation = rotation. Designer places and
skins zones in a layout editor; the client learns shapes, never games. Include grid from day one, plain
rendering until needed.

## Loading: how the files reach the engine (decided 2026-09-28)

Files are not programs; they evaluate to one typed object graph and **the engine has the main**.
- **The file is the value** (corrected 2026-09-28: no `game = Game { }` wrapper). The first line of a file names
  the root's type (`Game`, `Set`); everything below is that value's properties, as if the file boundaries were
  the constructor's braces. `Game`'s schema lists every allowed property (`name`, `players`, `sets`, `types`,
  `zones`, ...); `Set`'s lists `id`, `name`, `requires`, `rules` (file paths, as strings) and then any named
  member of Family / Mechanic / Counter / Token / card / Deck / text type. A stray top-level name is an error.
- **One root reaches everything**: `sets = [@starter-box, @berry-picnic]` in the Game; `requires = [@starter-box]`
  in a set; `rules = ['berry-picnic.rules']`. `alex.load('folkborn.alex')` follows references and hands the
  engine exactly one `Game` value. A set not in `sets` is not in the game (prototypes stay out; patches overlay
  before binding).
- **Cross-document references**: a document is `@<file-name>`, a member `@starter-box.mail-duck`; unqualified
  `@mail-duck` resolves if exactly one reachable document defines it, else the checker asks to qualify.
- **Pipeline** (IDE on save; bot farm on load): parse all files of a game (+ optional patch merged first) →
  bind one namespace per game (resolve `@` refs, enum members, schemas; rules files contribute effect/static/
  condition/scenario names) → compile the DSL (type-check per wiring environment; emit JS for the farm, tree
  for the browser interpreter) → one `GameDefinition` (config, card catalogue, decks, compiled effects).
- `engine.compile(graph)`, `engine.start(def, { decks, seed })`, then the original interface:
  `legalActions`, `apply`, `view(seat)`, `winner`.
- **Member paths are ids** (`BP1.goose` = today's `BP1-B05`) in saves, logs, protocol, rule-trace. Renaming a
  member is a migration the IDE warns about; renaming the display string is free.
- XAML inverted: no code-behind owns the tree; the engine owns it and code only supplies handlers. A set with
  no rules file is complete and playable.
- **Hot reload** = reload graph, recompile, replay the current game's action log; divergence is the "this change
  would have altered your game at round 4" message (same mechanism as golden-game tests).

## Players (decided 2026-09-28): N seats in the model from day one, two-seat client first

- `players = { min, max }`, optional `teams = { size }`. Selectors: `own`, `opponents`, `all`, `each player`,
  `next`, `previous`, `partner`; singular `opponent` legal only when `players.max == 2` (type constraint).
- `order = clockwise | counter-clockwise`; `ends-when = all-pass-in-a-row`; initiative is a seat.
- `on-loss = eliminate | game-ends`; `win = last-standing | first-to`; places come from the log.
- Targeting a Hero means a Hero of an opponent, a choice when there is more than one.
- **Visibility is state**: zones declare a default, verbs can change it during play (bridge's dummy).
- Bot (MCTS) and LLM player are N-player already; the client gets an N-seat layout later.
- Bridge is a test of the primitives, not a target: it needs auction, trick-taking and scoring **modules**, a
  second product family; the primitives must bend without changing. Survey records player counts and teams.

## Core changes from the walkthrough review (owner, 2026-09-28)

Approved while reading the TCG walkthrough (`docs/tcg/walkthrough.md`, whose "The finished game"
is the target, and `cardengine/samples/hello-tcg/`). Core 1 is a draft that may grow but not
change shape, so every change is additive: old fields stay as deprecated, optional aliases, and a
document written before the change still binds and means the same.

- **`engine-version` replaces `core`.** `Game.engine-version: int?`, written `engine-version = 1`:
  readable, and a number. Only the game states it; a set takes its game's version, a library and
  core-operations take the engine's, so `core = '1'` is gone from every set and library file. The
  core document says `engine-version = 1`. Compatibility: `Game.core`, `Set.core`, `Library.core`,
  `CoreOperations.core` and `Core.version` stay as optional, deprecated fields. On a game,
  `core = '1'` reads as `engine-version = 1`; setting both, or neither, is a checker error (so the
  field is `int?` in the type and required by the checker, since an old game has only `core`).
- **Defaults instead of boilerplate on `Game`.** `uses`, `sets`, `types` and `zones` default to
  `empty`, `players` to `Players {}` (two players, clockwise). A new game file needs only `name`,
  `engine-version`, `rulebook` and `sets`. `Rulebook.sections` defaults to `empty` too, since a
  new project's rulebook has only a title. Folkborn dropped its `players` line.
- **Named numbers, one source of truth.** `Game.numbers: [text: int] = empty`
  (`numbers = [starting-life = 10, opening-hand = 3]`). How the type system says "int or a number
  reference": **no new type.** A `numbers` entry is an int member of the game, and a reference to
  an int member is accepted wherever an int is, by the rule that references are orthogonal to
  types. So `LifeCounter { start = @starting-life }` needs no change to `LifeCounter`, and every
  int field of every rule (and step, and card) takes a number without the libraries being edited.
  Rejected: a `Number = int | NamedNumber` alias, which would have changed the declared type of
  about a hundred library fields and put a second spelling of "int" into every schema, for
  nothing the reference rule does not already give. An unknown `@name` in a rule is the binder's
  ordinary unresolved-reference error. Rulebook section text embeds numbers as `{@starting-life}`
  (`{{` for a literal brace); this is the tools' convention for rulebook text, not Alex syntax.
  The checker errors on a `{@name}` that `Game.numbers` lacks and notes digits written straight
  into section text. Folkborn names its deck size, copies, Fabled total, Candles, opening hand,
  mulligan, setup Offerings, draw per round, maximum hand, Yard size and round limit.
- **`Section.title: text?`.** A rendered rulebook needs a heading:
  `Section { number = '1', title = 'Winning', text = @winning }`. Optional because it is new; a
  section without one renders by number.
- **No repeated names (owner, via the TCG Developer Platform session).** A game's card types are
  exactly the subtypes of a card record its game file declares (`type Creature : UnitCard {}`);
  `Game.types` is deprecated and defaults to empty. A type whose display name or citation differs
  from its identifier fixes them on the declaration: `Card.type-name: text?`,
  `Card.type-cites: Section | text | nic`, both "fixed by the type" like `Ability.holders`. A rule
  field that named a `CardType` now takes `CardType | text`, the text being `nameof(Hero)`
  (`TypeCount`, `CopyLimit`, `StartsInZone`, `LifeObjects`, `SacrificeCost`, `BuildBoard`,
  `Token.type`), checked to name a declared card type. `nameof` rather than `@Hero` because
  references name values and a card type is a type, as `holders = [nameof(UnitCard)]` already does.
  And a record under a key in a keyed map takes its `name` from the key: `name` became `text?` on
  `Zone`, `Counter`, `Keyword` (so `Mechanic`), `Card` (so `Token`), `Deck`, `CardType`, `Family`
  and every `ResourceRule` record, and the loader fills an omitted name with the key. An explicit
  `name` wins (`AmbushOnAttack = Ambush { name = 'Ambush' }`); outside a keyed map such a record
  must set its name, and the checker says so. The keyed map already is the "enum of records"; what
  made it noisy was repeating each key. Records that live in lists (`LifeCounter`, `LifeStack`,
  `InitiativeToken`, `ResponseWindows`, `Phase`) keep a required `name`.
- **Files start with `#type`** (Alex change, made by the mochi Alex session): `#type Game`,
  `#type Set`, `#type Rules`, `#type Library`, `#type Core`, `#type CoreOperations`. The file's
  base name is its name, so `@folkborn` and `@common` resolve as before. A text table filling one
  of the file's own fields is `@@@ .field`. `#type` and a named root in one file is an error; the
  named root stays legal for other Alex projects. Every cardengine file is converted.
- **Two binding errors found by the Alex session's re-bind, fixed.** `reveal`'s `CheckToPlay`
  clashed with `resources`' (type names are one namespace across schemas); the reveal one is now
  `RevealToPlay`. The `scenarios` verb `pass` made `@pass` ambiguous with the core's `pass` action
  in every game using `scenarios`; the verb is now `passes`, so `@pass` stays the action.

### An ability carries its numbers (owner approved, 2026-09-28)

Card text drifted from its handler the way the rulebook drifted from the rules: Spark printed
"Deal 2 damage to your opponent." and its handler said `damage-life(2)`, two copies of one
number. The same fix, one level down:

```
spark = Spell {
  name = 'Spark', cost = 1
  abilities = [OnPlay { text = 'Deal {damage} damage to your opponent.', numbers = [damage = 2] }]
}
effect damage-opponent { opponent.damage-life(ability.damage) }
```

- `Ability.numbers: [text: int] = empty`, a new optional field, so every existing card is unchanged.
- The text embeds them as `{name}`, without `@`; `{@name}` stays the game's `numbers`, so the two
  can't be confused.
- A handler reads them through a new core selector, `ability`: the ability the running handler is
  attached to (`ability.damage`). `ability` was appended to `ParamType` for it. A handler shared by
  several cards reads each card's own number.
- The checker errors on a `{name}` in the text that the ability lacks, and on a number the text
  never shows, since players would be playing with a hidden number. It notes a digit written
  straight into a handler body.
- `draw()` with no count draws 1 (`common.draw`'s `count` is optional), so "draw a card" needs no
  number.
- A playtest or patch varies a card by its number, and the printed text follows.
- The core's `ability` selector made Folkborn's `@ability` (the `abilities` library's action)
  ambiguous, so Folkborn now writes `@abilities.actions.ability`.
- Not settled: whether keyword parameters (`Applied { n }`) join the same scheme.

## Open

- Port Folkborn first (lean: yes), then a Hearthstone-like as the second game.
- Where it lives: inside fruitcats (repo, API, site) or a new product with Folkborn as a tenant later.
- Name.
