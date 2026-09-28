# Broad survey: 156 TCGs against the core and the libraries

Date: 2026-09-28. One Sonnet agent compiled the list (`games.md`, with sources), sixteen Sonnet
agents classified ten games each against `core.alex`, `core-operations.alex` and the nineteen
libraries, using the fixed record in `TEMPLATE.md`. `aggregate.txt` and `records.json` hold the
machine-read counts; the per-game records are in `batch-01.md` to `batch-16.md`.

Read the numbers with their confidence: 31 records are high, 80 medium, 45 low. The low ones are
mostly dead 1990s games and small indie games whose rulebooks could not be fetched; two indie
entries could not be confirmed to exist as described. Treat counts as shape, not measurement.

## Fit

| Fit | Games | Share | Meaning |
|---|---|---|---|
| libraries | 15 | 10% | the libraries' existing rules suffice |
| framework | 129 | 83% | needs new rules, records or verbs in libraries, no core change |
| core | 7 | 4% | needs a change to the core |
| out | 5 | 3% | not card-versus-card, or a miniatures game with cards on top |

The fifteen that fit today: BattleTech, Epic, Pokémon, Digimon, Duel Masters, Battle Spirits,
WIXOSS, Force of Will, Final Fantasy, One Piece, Union Arena, Kaijudo, Myths and Legends, Gods
Unchained, Kards. Nine of them are the Bandai, Bushiroad and Square Enix family, which says the
libraries are already shaped like the Japanese mainstream as much as like Folkborn.

The seven core verdicts are one theme and two outliers. Five are two-dimensional boards with
movement: Sorcery, Genesis, Eikonic, Faeria, Duelyst. Artifact runs three lanes as concurrent
sub-games. Perry Rhodan changes its rule set between numbered phases, at low confidence.

## The shape of the population

| Knob | Distribution (of 156) |
|---|---|
| players | 2: 143 · asym: 9 · 2-4: 3 |
| turns | full: 120 · alternating: 19 · simultaneous: 6 · shared-gauge: 3 · other: 5 |
| resources | resource-cards: 36 · other: 36 · growing: 33 · none: 32 · cards: 12 · pitch: 7 |
| life | counter: 65 · race: 37 · other: 26 · stack: 20 · none: 4 · keys: 2 |
| combat | attacker-chooses: 52 · defender-blocks: 47 · compare-stat: 29 · other: 21 · lanes: 9 |
| responses | windows: 73 · none: 51 · stack: 13 · chain: 6 · alternating: 4 |
| board | row: 41 · slots: 35 · none: 21 · lanes: 19 · other: 19 · grid: 17 |

What that says:

- **Full turns dominate** (77%). Folkborn's alternating actions are the second shape at 12%.
- **Resources are the most varied knob.** "Other" ties for first: per-object counters, skill
  gates, dice, damage piles, units that produce the resource. A fifth of games have none.
- **A quarter of games win by a race**, not by life. Lore, honor, victory points, objectives,
  arena control, majority of rounds. `WinAtCounter` is the most important rule the deep survey
  added and it is still not enough (see objectives below).
- **Fixed response windows are the majority model** (47%); a third of games have no responses at
  all; stacks and chains together are 12%. The after-all-pass drain policy is worth its core
  slot but it is not the common case.
- **Grids are 11% of boards**, more than the deep survey suggested, and they are where every
  core verdict comes from.

## Core findings

The core held. Of 156 games, none asked for a change to operations, queries, hooks, input or
the scheduler except through the board model, and three small additive gaps appeared that the
deep survey had not seen. Recommended, all additive:

1. **Two-dimensional position.** Twelve games place units on a grid and move them: Sorcery,
   Genesis, Eikonic, Faeria, Duelyst, Mage Wars, Summoner Wars, Berserk, Chaotic, Eye of
   Judgment, Alternate Souls, Warhammer Underworlds. Today `position` is one integer. Add an
   optional `coords` object field (x, y) and `facing`, let `move` take `at = coords` within a
   grid zone, and add an `adjacent` query with a radius. A library then owns movement, range and
   line of sight. Faeria and Sorcery also build the board during play; that needs a
   `create-zone` operation and is rare enough to defer.
2. **Change of controller.** Shadowfist captures sites, SpongeBob captures locations,
   Illuminati takes control of groups, Redemption rescues souls. `controller` exists as a field
   but no operation changes it. Add `set-controller { object, player }`, emitting
   `controller-changed`.
3. **Objects with no owner.** Shared story cards, scenes, spacelines, contested locations,
   objectives on the table belong to neither player in Call of Cthulhu, Simpsons, Star Trek,
   Riftbound, Young Jedi and others. `owner` is required today. Make `owner` and `controller`
   nullable.
4. **Dice as pools, not a single roll.** Star Wars Destiny and Dice Masters roll several
   differently-faced dice per object and resolve faces one by one. Let `roll` take a list of
   faces and return one, and let an object carry its die as a face list. Bakugan's random unit
   stat and Neopets' die-augmented contest use the same thing.

Two things agents called core that are not. Zone capacity is a library rule enforced through
`filter-actions`, as Pokémon's agent showed. "A subtype cannot add a field" (Lorcana, Star Wars
Unlimited) is wrong: `type Character : UnitCard { lore: int }` adds one. The real point behind
it is the next one.

**A schema lesson, not a core change.** Marvel Snap has units with power and no health;
Rush Duel and Yu-Gi-Oh! want attack and defence. A subtype cannot drop a required inherited
field, so `UnitCard.health` being required excludes Snap. Rule for the libraries: a base record
requires only what every game in its family has. `health` and `cost` become optional on
`UnitCard`, and `DefeatAtHealth` requires them.

Deferred, rare: a card that is two records at once (Magic's split and modal cards, Rush Duel's
Maximum monsters), summing a counter across objects for game-over (expressible in a hook), a
rule set that changes mid-game (one low-confidence game), three lanes as concurrent games.

## Framework findings, clustered

Counts are games asking, from the free-text fields; a game may appear in several clusters.

- **Objectives and scoring wins (about 20).** Race to n objectives, claim n of m ordered shared
  objectives, control a shared zone for n turns, control points, mission completion, majority
  of rounds (Gwent), several race tracks at once. Proposed: an `objectives` library with
  `ObjectiveCard` (shared, ownerless, capturable, scored), `WinOnObjectives { n }`,
  `ZoneControlWin`, `RoundsMajority { of }`, `MultipleRaceTracks`.
- **Grid boards (12).** After the core change: a `board` library with `Movement { range }`,
  `AdjacencyRange`, `LineOfSight`, `TerrainModifier`, `AdjacencyTriggersBattle`.
- **Contests beyond one attacker versus one blocker (about 15).** Team attacks and team
  combat (Naruto, Vs System, Sailor Moon), die-augmented contests (Neopets, Illuminati,
  X-Men), poker-hand resolution (Doomtown), mutual strike exchanges (Chaotic), zone-matched
  blocks (UFS family), blocking with a card from hand (Flesh and Blood), blocking gated by a
  keyword (Gundam, Digimon), reversal-style damage prevention. Proposed for `combat`: an
  `attackers: units` form of the attack event, `TeamCombat`, `DieAugmentedContest`,
  `ZoneMatchedBlock`, `BlockWithHandCard`, `BlockersNeedKeyword`, `ReversalNegates`.
- **Costs that are not resources (about 12).** Sacrifice or tribute your own units (Yu-Gi-Oh!,
  Rush Duel), colour thresholds that are checked not spent (Hex, Lorcana ink), prerequisites of
  cards in play (Perry Rhodan, Dragon Ball Z), shape puzzles (Harry Potter lessons), per-object
  counters as the currency (VTES), units that produce the resource (Caster Chronicles), symbol
  cost reduction (Battle Spirits), check-to-play draws (UniVersus), damage piles as the gate
  (Raw Deal). Proposed for `resources`: `SacrificeCost`, `ThresholdRequirement`,
  `PrerequisiteInPlay`, `PerObjectResource`, `ProducedByUnits`, `CostReduction`, `CheckToPlay`.
- **Reveal-from-deck triggers (5).** Vanguard's drive and damage checks, Weiss Schwarz's and
  Chaos's trigger icons, Transformers' battle-card flip. Proposed: `DeckRevealCheck { count }`
  with a `trigger-icon` card field, in `life-stack` or a small `reveal` library.
- **Card records that fit nothing (about 15).** `StatCard` for the Attax family (three games:
  two stats, no persistence), `PlotCard` with simultaneous reveal (Game of Thrones), mission,
  quest and story records (eight games), province or tower objects as per-zone life (L5R,
  Argent Saga, Warhammer Invasion), `ClimaxCard` (Weiss Schwarz, Chaos), `Weapon`
  (Hearthstone), permanents with hit points (Lorcana locations, Star Wars Unlimited bases,
  Gundam bases), encounter records for cooperative decks.
- **Unit variants (about 10).** Two combat stats chosen per fight (L5R, Yu-Gi-Oh!, Rush Duel,
  Elestrals), power-only units (Snap), heroes with more than two levels (Codex, Runeterra,
  WIXOSS, Artifact), evolve and level-up swaps that keep state (Shadowverse, SolForge, Grand
  Archive, Digimon, Pokémon). Proposed: `second-stat` and `defense-position` rules,
  `Levels { driven-by: counter }` on heroes and units, and `objects.StackPreservesState`
  widened to a `swap-card` verb.
- **Turn structures (about 8).** An action budget per turn (Arkham, Age of Sigmar Champions,
  Young Jedi), a simultaneous-turns rule exposing the core's `require-actions` (Infinity Wars,
  Elarion, Snap), a role that swaps with whose turn it is (Decipher's Lord of the Rings), draw
  to hand size, first-player asymmetry. Proposed for `turns`: `ActionBudget { n }`,
  `SimultaneousTurns`, `RoleByTurn`.
- **Cooperative and automated opponents (4).** Arkham, Marvel Champions, Lord of the Rings LCG,
  and any solo mode. The scripted deck is deterministic card text, so it runs through hooks as a
  non-actor; no core change. Proposed: an `encounter` library.
- **Randomness (5).** After the core change to `roll`: a `dice` library with `DiePool`,
  `ResolveDie`, `RandomizedUnitStat`.

## What stays out

Bella Sara (a collectible with codes, not a game), Warhammer Underworlds and Alternate Souls
(miniatures skirmishes with a card layer), and two indie entries that could not be verified.
That is three real exclusions in 156, all for the same reason: the game is a board game whose
cards are secondary. Nothing was excluded for being a card game the engine cannot host.

## What it means for the product

- The audience is indie designers, and the twenty-seven indie games surveyed are almost all
  `framework`-fit with one or two named gaps each, when their rules could be read at all. The
  gaps they name are the same ones the mainstream names.
- The libraries as they stand cover the Japanese mainstream, Hearthstone-likes and Magic-likes
  minus priority and blocking. The three additions with the widest reach are `objectives`,
  the contest forms in `combat`, and the non-resource costs in `resources`.
- The core needs four small additive changes before it is declared frozen: coordinates, change
  of controller, ownerless objects, dice as face lists. Everything else on the core list from the
  deep survey (priority, filter parameters, target as unit or player, under-stack rules) stands.

## Suggested order

1. Core: the four additions above; make `health` and `cost` optional on `UnitCard`.
2. Libraries: `objectives`; the contest forms in `combat`; the non-resource costs in
   `resources`; `StatCard`, `PlotCard`, mission-style and hit-point-bearing permanents;
   `ActionBudget`, `SimultaneousTurns`; `DeckRevealCheck`.
3. Then the second framework-only game as the proof, and a third from the `libraries` list to
   show a game that needs nothing new: One Piece or Duel Masters, both high confidence.
