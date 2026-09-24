# Card data architecture: cards and decks from outside the engine

A design, not built yet. It sets the direction for adding cards and decks, so that:

1. **The engine knows no cards.** It implements the rules and a fixed vocabulary of effects. Every card,
   deck, family and family mechanic is data handed to it from outside.
2. **Contributors can make decks without touching code.** A card set is a folder of JSON and pictures. A
   future designer app (the **Studio**) edits that folder, playtests it and submits it for review.

Last updated 2026-09-24. The first set written in this format is Heat Wave
([heat-wave-set.md](heat-wave-set.md), data in [`cards/hw1.json`](../cards/hw1.json)).

## Where cards live in the code today

| Place | Card knowledge |
|---|---|
| `packages/engine/src/cards.ts` | Imports `cards/sb1.json` directly. `DECKS` comes from the same file. `BEHAVIOURS` maps each card id to an effect key. |
| `packages/engine/src/engine.ts` | A `switch` of about 30 effect keys (`damage1zest2`, `buff2readyTreat`, …), one per card wording. Special cases by card id: `SANGUINE`, `SAKURA`, `GRANNY_SMITH`. Ripen and Zest are in the core rules. |
| `packages/engine/src/types.ts` | `Unit.ripe`, `buffSneaky` and `buffGuardian`: one field per mechanic. |
| `packages/engine/src/ai.ts` | `BLANK = 'SB1-C04'`; a Zest heuristic that reads card text. |
| `packages/engine/src/text.ts` | The rules primer lists every family mechanic by hand. |
| `apps/web/src/main.ts` | Hiss!'s explanation by id (`SB1-O09`), a hard-coded hero list, `DECKS['zest-rush']` as a default. |
| `apps/web/src/ui.ts`, `rarity.ts`, `showcase.ts` | `sb1/` art paths, the default Showcase (`SB1-H03`). |
| `tools/compose_cards.py` | Family colours in the script. |

Each new card with a new wording means a new effect key, a new `case` and sometimes a new field on `Unit`.
That is fine for 53 cards, but it doesn't work if people who can't change the code are to make sets.

## The target shape

```
 content/sets/<set>/            data only: no code, ever
   set.json                     families, mechanics, cards, tokens
   decks.json                   ready-made decks
   art.json                     art direction (style, family backgrounds, one subject per card)
   art/                         illustrations and finished cards
        │
        ▼  loadSet() + validateSet()          packages/content
   Catalog  (every loaded set, compiled: ids → CardDef with abilities)
        │
        ├──► packages/engine    createGame({ catalog, decks: [DeckList, DeckList], seed })
        ├──► apps/web           the game, deck builder, Collection, Store
        ├──► playtest/          bots, LLM playtesters, the balance gate
        └──► apps/api (later)   the Store catalog, ownership, and online games run by the server
```

- **`packages/engine`** imports no JSON. `createGame` takes a compiled `Catalog` and two deck lists. It has no
  `DECKS` and no card ids. It exports the effect vocabulary (the list of triggers, conditions, targets and
  actions it understands) and a version number for it.
- **`packages/content`** (new) holds the sets, the loader, the JSON Schema and the validator. It is the only
  package that knows set folders exist. The web app, the playtest harness and later the API all get cards
  from it.
- **Sets are packages.** The Starter Box becomes `content/sets/sb1/`. Each later deck or expansion is its own
  folder. Card ids are prefixed with their set (`SB1-C15`, `HW1-P07`) and never reused.

## Cards as data: the effect language

A card's rules are a list of **abilities**. Each ability combines four closed lists of pieces: **when** it
happens, an optional **if**, a **target**, and what it does (**do**). The engine implements each piece once,
and a designer combines them. There are no scripts, expressions or anything else that could run code.

```jsonc
{
  "id": "SB1-C06", "name": "Citron Fox", "type": "Critter", "family": "Citrus", "rarity": "Common",
  "cost": 3, "power": 3, "health": 3,
  "abilities": [
    { "when": "hello", "target": { "unit": "any" },
      "do": [{ "damage": 1 }],
      "instead": { "if": "Zest", "do": [{ "damage": 2 }] } }   // "Zest" names a family mechanic (see below)
  ],
  "flavor": "Always arrives with a little zing."
}
```

### The vocabulary (version 1)

This covers every Starter Box card, the two preview Hero Cats and the whole Heat Wave set.

| Kind | Pieces |
|---|---|
| **Keywords** (core rules) | `Zoomies`, `Guardian`, `Sneaky`, `Fierce`, `Tough N`, `Lucky`, `Pounce` |
| **when** | `play` (Tricks) · `hello` · `goodbye` · `roundStart` · `roundEnd` · `exhaust` (activated: Hero Cats) · `damagedAndSurvives` · `defeatsInCombat` · `youHeal` |
| **if** | `playedThisRound ≥ N` · `treats ≥ N` · `lives ≤ N` · `opponentLives ≤ N` · `yardHas {keyword}` · `unitsInComposts ≥ N` · `compost ≥ N` · `targetIsYours` · `controlUnits ≥ N` · `unitHasCounter {name} ≥ N` |
| **target** | `self` · `{ unit: own / enemy / any, other?, filter: { exhausted, damaged, maxCost, keyword, counter } }` · `targets: [ … ]` (two targets, for `fight`) · `each: own / enemy / all / allOther` · `treats` · `attack` (the attack in this Pounce window) |
| **do** | `damage N` · `heal N` · `buff { power, keywords }` this round · `counter { name, add, max }` · `draw N` · `exhaust` · `ready` · `readyTreats N` · `sprout N` · `summon {token}` · `cancelAttack` · `fight` (two targets deal damage to each other) |
| **static** | `grant { keywords, power, health }` to `self` / `attached` (Toys) / `each own …`, optionally `while {if}` · `cantAttack while {if}` |
| **modifiers** | `optional` (you may) · `oncePerRound` · `instead: { if, do }` (a better version when a condition holds) · `pounceOnly: "attack"` · `cost: { exhaust, pay N }` for activated abilities |
| **Hero Cats** | `kitten` and `bigCat` sides, each with abilities, plus `growUp: { if }` |

Numbers are small integers with limits the validator checks (damage 0–10 and so on). **Adding a new piece is
an engine change**: someone writes code, adds tests and raises the vocabulary version. A set declares which
version it needs, so an old app refuses a set it can't play instead of playing it wrong.

### Family mechanics are data too

Zest, Ripen, Sprout, Lush and Heat don't belong in the engine. A set defines each one once, and cards use it
by name. The mechanic also carries the reminder text that the rulebook, the app and the LLM primer show:

```jsonc
"mechanics": {
  "Ripen": { "family": "Orchard", "kind": "keyword",
    "reminder": "At the start of each round, this unit gets +1 Power and +1 Health, up to +2/+2.",
    "counter": { "name": "ripe", "power": 1, "health": 1 },
    "abilities": [{ "when": "roundStart", "do": [{ "counter": { "name": "ripe", "add": 1, "max": 2 } }] }] },
  "Zest":  { "family": "Citrus", "kind": "condition",
    "reminder": "A bonus if you've already played another card this round.",
    "if": { "playedThisRound": { "atLeast": 2 } } },
  "Lush":  { "family": "Tropical", "kind": "condition",
    "reminder": "You're Lush while you have 7 or more Treats.", "if": { "treats": { "atLeast": 7 } } },
  "Heat":  { "family": "Pepper", "kind": "keyword",
    "reminder": "Whenever this unit is dealt damage and survives, it gets +1 Power, up to +3.",
    "counter": { "name": "heat", "power": 1 },
    "abilities": [{ "when": "damagedAndSurvives", "do": [{ "counter": { "name": "heat", "add": 1, "max": 3 } }] }] }
}
```

A new family whose mechanic is built from existing pieces needs **no engine change at all**. Heat is the test
case: it needs only the new `damagedAndSurvives` trigger, which the engine needs once for every set.

Families are data as well: name, frame colours (today in `compose_cards.py`), personality, art background and
mechanic. The deck rules keep "your Hero Cat's family, one other family, and Garden", and Garden is marked
as neutral in the data, not in code.

### The Starter Box's special cases, in data

These cards have bespoke code today. In the new format they are ordinary data:

```jsonc
// Sanguine: once per round, after she defeats a unit in combat, ready her.
{ "when": "defeatsInCombat", "oncePerRound": true, "target": "self", "do": [{ "ready": true }] }
// Sakura: once per round, when you heal 1 or more damage from a unit, draw a card.
{ "when": "youHeal", "oncePerRound": true, "do": [{ "draw": 1 }] }
// Granny Smith: at the start of each round, heal 1 from each unit you control.
{ "when": "roundStart", "target": { "each": "own" }, "do": [{ "heal": 1 }] }
// Lychee Sloth: can't attack unless you're Lush.
{ "static": { "cantAttack": true, "while": { "not": "Lush" } } }
// Hiss!: Pounce. Cancel an attack.
{ "when": "play", "pounceOnly": "attack", "target": "attack", "do": [{ "cancelAttack": true }] }
```

### Rules text

A card's text is **generated from its abilities** by a templater in `packages/content`, in the house style
("Hello: Deal 1 damage to a unit."). A set may override the wording of a card, and the validator then checks
that the override still says the same thing: same numbers, same keywords. So the text can't drift from what
the card does, and a designer who writes the abilities gets correct text for free. The LLM playtesters' rules
primer is built the same way, from the mechanics the loaded sets define.

### Units hold counters, not fields

`Unit.ripe`, `buffSneaky` and `buffGuardian` become two generic maps: `counters` (`{ ripe: 2, heat: 1 }`) and
this round's `buffs` (`{ power: 2, keywords: ['Sneaky'] }`). A unit's Power and Health are its card's plus
its Toy, its counters (as each mechanic defines them) and its buffs. Nothing in the engine is named after a
family.

### The AI plays by pieces

The bot scores an action by the pieces it contains (damage, draw, ready, counters, keywords), not by card id.
The Zest heuristic becomes a general rule ("play a card whose bonus depends on `playedThisRound` second"), so
it covers any future condition of that shape. `BLANK = 'SB1-C04'` becomes a card built on the fly.

## Decks and sets

```jsonc
// content/sets/hw1/decks.json
{ "five-alarm": { "name": "Five Alarm", "hero": "HW1-H01",
    "cards": { "HW1-P01": 3, "…": 3, "SB1-G01": 3 } } }   // decks may use Garden cards from other sets
```

```jsonc
// content/sets/hw1/set.json (head)
{ "set": "HW1", "name": "Heat Wave", "version": "0.1.0", "vocabulary": 1,
  "status": "draft",                       // draft → playtest → review → released
  "requires": ["SB1"],                     // uses SB1's Garden cards and its Zest/Ripen/Sprout/Lush families
  "families": { "Pepper": { "colors": ["#D7261E", "#5A0E0A", "#FFD6C2"], "mechanic": "Heat", "…": "…" } },
  "mechanics": { "Heat": { "…": "…" } },
  "cards": [ … ], "tokens": [ … ] }
```

- **Card revisions.** Changing a released card (a balance patch) bumps its `rev`. A replay records the set
  versions it was played with, so it can be replayed exactly. Collections and the Store refer to the card id,
  which never changes.
- **Rarity and store data** (rarity, starter flag, price tier) stay on the card. The Store's catalog refers to
  `deck:HW1/five-alarm` and `card:HW1-X03`.
- **Art paths** come from the set: `cards/<set>/<id>.webp`. `ui.ts` stops assuming `sb1/`.

## Validation: what a set must pass

`npm run check-set content/sets/hw1` runs in this order, and stops at the first stage that fails:

1. **Schema:** the JSON matches `set.schema.json`, and every piece is in the vocabulary version the set asks for.
2. **References:** every id a deck, token or ability names exists. There are no duplicate ids, and nothing
   collides with another set.
3. **Text:** the generated or overridden rules text matches the abilities, and fits in two short lines.
4. **Deck rules:** every deck is legal (50 cards, copy limits, families).
5. **Budget report:** Power + Health against the `2 × cost + 1` budget, with keyword prices, per card. This is
   a warning, not an error: it tells designers where to look.
6. **Balance:** bot games against every released deck through the existing `playtest/` balance gate, with the
   same thresholds `npm run deploy` uses (`runBalance({ quick: true, extraDecks })` in
   `playtest/balance/gauntlet.ts` already plays extra decks against the starters). Also the LLM playtesters' report, on request.

The same checker runs in the Studio, in `npm test` and before a deploy.

## The Studio (future: not to build yet)

A designer app, `apps/studio`, for contributors who don't change the code. Its whole output is a set folder.

```
 Draft cards ──► Art ──► Preview ──► Build decks ──► Playtest ──► Adjust ──► Submit ──► Review ──► Release
 (by hand or     (generate   (composed   (the same      (bots, the    (loop)      (a set      (a person   (Store
  with an LLM:    or upload)  card, as    deck builder)  PC2024 paw,               package)    approves)   catalog)
  schema-bound                in game)                   LLM testers)
  JSON)
```

- **Drafting with an LLM:** the model writes abilities as JSON under the set schema (structured output), and
  the templater writes the text. The model never writes code, and the validator checks everything it writes.
- **Playtesting** sends the set to the existing harness: bot runs on the PC2024 playtest paw and the Ollama
  LLM playtesters. The report (win rates, per-card numbers, LLM comments) comes back into the Studio next to
  the cards.
- **Safety:** a set is data, so a contributor can't run anything. What remains is content review (art, names,
  text), which a person does before a set leaves `draft`. Uploaded images are re-encoded to WebP at fixed
  sizes.
- **Needs a new effect?** The Studio shows what the vocabulary is missing, and the contributor files it as a
  request. An engineer adds the piece, and the set waits for the next vocabulary version.

## Building it, in order

Each step keeps the game playing exactly as before. The test is **golden replays**: record a few hundred
bot games with the current engine (seed plus actions, plus the final state), and after each step the same
seeds must give the same games.

| # | Step | Result |
|---|---|---|
| 1 | Record golden replays; write `set.schema.json` and the vocabulary | A safety net and the contract |
| 2 | Rewrite `cards/sb1.json` in the new format (as `content/sets/sb1/`), plus the templater; the text check passes on all 53 cards | The data exists alongside the old code |
| 3 | Effect interpreter in the engine; `counters`/`buffs` on units; delete `BEHAVIOURS`, the effect `switch`, and `SANGUINE`/`SAKURA`/`GRANNY_SMITH` | The engine has no card ids; the golden replays match |
| 4 | `createGame({ catalog, decks })`; `packages/content` loader; the web app, playtest and tools take cards from it; remove the web app's id special cases. Playtest today reads cards through `playtest/lib/engine.ts` (`DECKS`, `CARDS`, `BEHAVIOURS`), builds random decks by family in `playtest/balance/decks.ts`, and copies family colours into `playtest/dashboard/meta.ts`: all three move to the loader. Tell the "balance testing" session before changing the `DeckList`/`CARDS` shapes | Nothing imports `sb1.json` except the loader |
| 5 | `check-set` with all six stages | Sets can be checked without a person |
| 6 | Heat Wave: add `content/sets/hw1/` (a data file plus art), with no engine change except `damagedAndSurvives`, `fight` and two-target Tricks | The proof that a new deck is data only |

Steps 1–5 fit the Store plan's Phase 1 ("the multi-set card registry"), and step 6 gives the Store its first
new product.
