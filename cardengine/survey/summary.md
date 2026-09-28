# Survey summary: eight TCGs against the core and the battle framework

Date: 2026-09-28. Method: one Sonnet agent per game read `core.alex`, `core-operations.alex`,
`framework.alex` and the Folkborn documents, wrote the game as a selection from the catalogue,
five representative cards with effects, a gap table and a verdict. Single pass, from the models'
own knowledge with occasional web checks. Treat the numbers as informed guesses, not measurements.
The per-game files are beside this one.

## Verdicts

| Game | Core change needed? | Largest obstacle | Card pool expressible today (agent's estimate) |
|---|---|---|---|
| Magic | yes | continuous priority and the stack; blockers; multi-typed cards | 35-45% |
| Pokémon | no | attacks as card-level constructs whose costs check attached Energy | 20-25% |
| Yu-Gi-Oh! | yes | nestable chains with spell speeds | 30-35% |
| Hearthstone | small | a target type spanning hero and minion | 55-60% |
| Lorcana | small | Items and Locations have no card record | 35-45% |
| Flesh and Blood | brushes | the combat chain's role-flipping priority | 35-45% |
| KeyForge | no | the active-house restriction on every action | 55% |
| Digimon | one hook | inherited effects on cards buried under another | 50% |

Two claims to discount. Lorcana's agent said a game cannot add a new per-card field; it can
(`type Character : UnitCard { lore: int }` declares one, `field = value` fixes an inherited one),
so that "language" gap is not real. Several agents counted things as core gaps that another agent
solved in the framework: zone capacity is Hearthstone's and Yu-Gi-Oh!'s core gap and Pokémon's
`ObjectRule ZoneCapacity { zone, n }` enforced through `filter-actions`. The framework answer is
right; the core needs no field.

## Gaps in the core (change core.alex or core-operations.alex)

Ordered by how many games hit them. Every one is additive under the core's evolution rules,
except the last, which is a removal and is only possible because core 1 is not yet frozen.

1. **Nestable priority.** Magic, Yu-Gi-Oh!, Flesh and Blood. The loop skeleton is "one action,
   then drain the scheduler". A stack, a chain and a combat chain all need: after an action or an
   enqueued effect, every player in turn may add a response or pass, and the queue resolves last
   in, first out only when all have passed. Addition: a scheduler drain policy chosen by the game
   (`drain = immediately | after-all-pass`), a `respond` input distinct from an action, and the
   pending queue as something a selector can yield (a counterspell targets a pending effect).
   `NoNesting` stays as the rule Folkborn lists; games that nest list a different one.
2. **Filters with parameters.** Magic, Yu-Gi-Oh!, Digimon, Lorcana. `Filter` in core has no
   `params`, so "power 3 or more", "cost at most 2", "of type Rookie" cannot be said. Addition:
   `params: [text: ParamType]` on `Filter`, mirroring `Selector`, plus (language) a predicate
   expression allowed as a filter argument in bodies: `units(own, power >= 3)`.
3. **A target that may be a unit or a player.** Hearthstone, Magic. "Deal 3 damage to any
   target" is the most common card shape in two of the eight games. Addition: a `ParamType` and
   `Arg` member `target` meaning unit or player, and `choose` allowed to yield it.
4. **Rules for cards buried in an under-stack.** Digimon, Pokémon evolution, Lorcana shift.
   Nothing evaluates a static or trigger for an object that is not a zone's own occupant.
   Addition: a hook point, `provide-statics` over `under` recursively, or a core flag on
   `stack-under` saying whether the buried object's rules stay live.
5. **Win and loss belong to rules, not to `Game`.** Lorcana has a lore race and a deck-out loss
   at once; KeyForge wins by keys and has no life. `Game.win` and `Game.on-loss` are single enum
   values and duplicate what `provide-game-over` already decides. Removal: drop both fields; the
   framework's `StateCheckRule`s (`WinAtCounter`, `LoseWhenEmpty`, `LoseOnEmptyDraw`) own it.

Deferred, rare: zone-slot adjacency for Yu-Gi-Oh! link arrows; a card belonging to two card
records at once (Magic's artifact creatures), which can be a supertype tag until it cannot.

## Gaps in the battle framework (catalogue additions, no core change)

Grouped; the count is how many of the eight games asked for it.

- **Card records (6).** `PermanentCard : Card { cost }` for Items, Locations, Tamers, Artifacts,
  Stadiums; `WeaponCard`; `PlaneswalkerCard { loyalty }`; `TrapCard`; per-card `Attack` records
  for Pokémon and `power`/`defense`/`pitch` on Flesh and Blood action cards; hero stats `life`
  and `hand-size` on `HeroCard`; a second stat on units (ATK/DEF) as a documented convention.
- **Extension points (5).** Every card record needs its own program-layer extension block:
  `AttachmentCard` and `HeroCard` have none today, so equipment and heroes cannot carry effects.
  An `activate` trigger kind with a cost, attachable to any record, appears in six surveys.
- **Verbs (8).** `destroy`, `discard`, `discard-from-hand`, `search` (hidden zone, filter, take
  one privately), `look-top` with place-to-hand/bottom, `gain` and `capture` (player counters),
  `adjust-game`, `play-free`, `damage-life`, `prevent` or `reduce` on a pending event's amount,
  `move` to a zone, `may` as a whole-effect optional wrapper.
- **Selectors (5).** `adjacent` or `neighbours` in a row, `here` (objects attached to one),
  `hand(of player)`, `permanents` (non-unit objects), `discover` (sample from the pool).
- **Combat rules (7).** `DeclareBlockers`, `CombatDamageEqualsPower`, `LifeDamageEqualsPower`,
  `AttackerOnlyDamage`, `CompareStatDeletes` and `TieDeletesBoth`, `BattleDamageByStatDifference`,
  `TwoCombatDamageSteps`, `WeaknessResistance`, `Retreat`, `OneWayDamage`.
- **Turn and setup rules (7).** `DrawTo`, `RefillHandTo`, `BurnOnDrawIfFull`, `GrowResource`,
  `GoAgainContinues`, `OncePerTurn { action }`, `ChooseActiveHouse` and `RestrictToActiveHouse`,
  `MemoryGauge`, `AsymmetricOpeningHand`, `MulliganUntilBasic`, `ChooseToZone`, `StartsInZone`.
- **Life and state-check rules (6).** `WinAtCounter`, `WinWhenEmpty`, `LoseOnEmptyDraw`,
  `LoseWithEmptyZones`, `LifeShield` (armor), `PrizesOnKnockout`, `LegendRule`, `KeysToWin`,
  `EmptyDeckDrawCosts { start, growth }` for fatigue.
- **Deck rules (5).** `DeckSizeRange`, `DeckPool` for extra and egg decks, `ColorLimit`,
  `CopyLimitByRarity`, `ZoneMinimum`, per-card `copies-max`.
- **Built-in keywords (6).** flying and reach as `blockable-only-by(quality)`, first strike,
  double strike, trample, windfury, poisonous, lifesteal, stealth, divine shield, elusive, ward,
  rush and blocker.
- **Costs (4).** Hybrid and alternate costs, `PayBy` `life`, `RequiresAttachedResources` for
  Pokémon-style costs that check rather than spend, and (language) an `X` in a cost the body can
  read.
- **Small schema fixes (3).** `life` should default to `empty`; `Cost` fields should default to 0
  or be optional; `TriggerTime` should name game-declared steps instead of a closed enum;
  `Action` needs more members; `Trigger.hidden` for secrets and traps.

## What this says about the layering

- The core held up better than the framework. Eight games produced five core additions, four of
  them small and one of them the priority model that three games share. Nothing asked the core
  for anything the object model cannot represent.
- The framework's catalogue is Folkborn-shaped. Half the requests are card records and extension
  points that Folkborn never needed; the other half are rules a second game would have forced on
  the first day. The second-framework test proposed earlier is the right next step, and the
  survey says which game to pick: Hearthstone or KeyForge fit with the fewest changes and
  exercise different areas (targets and board position; houses and counters).
- The two biggest structural gaps are the priority model and card-level attacks. Both are worth
  designing before core 1 is declared frozen, because the first touches the scheduler and the
  second decides whether `UnitCard` keeps one cost and one power.

## Suggested order

1. Core: drop `win` and `on-loss`; add `params` to `Filter`; add the `target` param type; add the
   under-stack hook; design the priority model (drain policy, respond input, pending as target).
2. Language: predicate expressions as filter arguments; `may`; a cost variable readable in bodies.
3. Framework: `PermanentCard` and extension blocks for every record; the verb list above; then
   the rules a second game needs, in the order that game needs them.
4. Build the second framework-only game as the proof of the core: Hearthstone-like first.
