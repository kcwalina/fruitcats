# Broad survey batch 12: ten small/indie TCGs, classified against framework/lib

## Kaiju Ketsugo! TCG (2026, Kaiju Ketsugo) — kickstarter
- Players: 2+
- Turns: full; a Kaiju in the Primary position may use an Active ability, which ends the turn
- Resources: other; each Kaiju has its own Energy stat, transferred between own Kaiju to fuel
  abilities, not paid from one shared pool
- Life: race; first player to collect all 7 Joule types into their Collected Joules zone wins
- Combat: other; a printed Vulnerability field implies type weaknesses, but resolution steps unfound
- Responses: windows; Passive abilities fire from Primary/Support, sometimes on the opponent's turn
- Board: slots; named per-Kaiju zones (Primary, Support, Energy, Rest) plus shared Joules,
  Collected Joules and Environment zones
- Card kinds: units (Kaiju, with Ascension/Pre-Ascension/Descension faces); Kaijin utility cards fit
  none of our records cleanly
- Hook: Kaiju feed their own Energy to each other to power abilities while racing to collect one
  Joule of each of 7 types.
- Libraries sufficient: mostly; units, combat and families cover stats/keywords/types, but energy
  transfer between own units and Joule-collection-as-victory are new
- Missing rules: WinOnJoulesCollected, TransferEnergyBetweenUnits, Ascension (a unit-level face
  flip, like heroes' TwoFaces but for UnitCard), PositionSlots (Primary/Support/Rest privileges)
- Core gaps: none; position-gated abilities read as UnitRule/CombatRule hooks over counter and move
- Fit: framework; no core change apparent, several new rule types needed
- Confidence: medium; the official site confirms zones/abilities/fields, but its "Official Rules
  v1.2.1" PDF could not be fetched, so turn order and attack resolution are inferred
SUMMARY|Kaiju Ketsugo! TCG|2+|full|other|race|other|windows|slots|framework|medium

## Skyscape TCG (2025, Skyscape Games) — live
- Players: unknown
- Turns: unknown
- Resources: unknown
- Life: unknown
- Combat: unknown; the publisher describes "standard card combat" with no further detail found
- Responses: unknown
- Board: other; publisher material describes floating-island "territory control" laid over card
  combat, but no zone shapes or capacities were found
- Card kinds: unknown
- Hook: Territory control over floating islands is layered on top of an otherwise standard TCG combat
  system (per the publisher's own one-line description).
- Libraries sufficient: unknown; cannot assess without the rulebook
- Missing rules: unknown
- Core gaps: unknown
- Fit: framework; provisional, most small TCGs land here, unconfirmed for this game
- Confidence: low; the game has a storefront and a booster set ("The Great Kin Wars") and two "how to
  play" videos exist, but none of the fetched pages contained readable rules text
SUMMARY|Skyscape TCG|unknown|unknown|unknown|unknown|unknown|unknown|other|framework|low

## Elarion: Aetherfall (2026, Elarion) — digital-live
- Players: 2
- Turns: simultaneous; each round both players secretly pick a card and commit Aether, then reveal
  together
- Resources: other; a shared-feeling but per-player 12-point Aether pool is wagered per round (not
  spent as a flat card cost) to multiply that round's Attack
- Life: counter; both players start at 12 Life
- Combat: compare-stat; Attack = Power x (1 + Aether Spent), the higher Attack wins the round
- Responses: none; a single simultaneous reveal decides the round, no reaction window described
- Board: none; no play area beyond the two revealed cards each round
- Card kinds: units (Characters) only; no spell or attachment cards were described
- Hook: Combat is a sealed-bid auction — both players secretly wager Aether from a shrinking pool to
  multiply one card's Power, and the higher product wins with no board or attack step at all.
- Libraries sufficient: no; simultaneous secret-bid-then-reveal rounds aren't modeled by any library
  (turns.alex has no simultaneous-commit type; combat.alex assumes open-information attacks)
- Missing rules: SimultaneousSecretBid, WageredResourceMultiplier (a spent amount multiplies a stat
  instead of paying a flat cost), AetherPool (a per-match resource wagered, not paid outright)
- Core gaps: none; core-operations' `require-actions` already collects one action from each player
  before continuing, so simultaneous input exists — filling it in for bid-and-reveal is a library's job
- Fit: framework
- Confidence: medium; several marketing/app-store sources agree on deck/life/Aether numbers and the
  Attack formula, but no full rulebook was found, so deck limits and faction abilities are unconfirmed
SUMMARY|Elarion: Aetherfall|2|simultaneous|other|counter|compare-stat|none|none|framework|medium

## Threat Level TCG (2024, Diehard Hobby Games) — kickstarter
- Players: 2
- Turns: shared-gauge; games.md's own hook describes a shared, escalating "threat" meter both players
  feed, which matches a shared counter handing over the turn, but no source confirms the exact trigger
- Resources: unknown
- Life: unknown
- Combat: unknown
- Responses: unknown
- Board: unknown
- Card kinds: unknown
- Hook: A shared, escalating "threat" meter that both players feed pushes the match toward an
  all-out final battle (per the source list's own description; no further detail was found).
- Libraries sufficient: unknown; no rulebook found to judge
- Missing rules: unknown
- Core gaps: unknown
- Fit: framework; provisional, unconfirmed
- Confidence: low; only a one-line entry on Wikipedia's list of collectible card games was found; no
  publisher site, rulebook, Kickstarter page or review surfaced any further mechanical detail
SUMMARY|Threat Level TCG|2|shared-gauge|unknown|unknown|unknown|unknown|unknown|framework|low

## Trigger Warnings (2024, Smirk & Dagger Games) — kickstarter
- Players: 2+
- Turns: unknown
- Resources: unknown
- Life: unknown
- Combat: unknown
- Responses: chain; games.md's hook says playing a card "triggers" a chain of other players'
  overreactions, matching a chain of responses, but no source confirms nesting or priority rules
- Board: unknown
- Card kinds: unknown
- Hook: Playing a card sets off a chain of the other players' comedic "overreactions" before it
  resolves (per the source list's own description).
- Libraries sufficient: unknown; no rulebook found to judge
- Missing rules: unknown
- Core gaps: unknown
- Fit: framework; provisional, unconfirmed
- Confidence: low; Smirk & Dagger's own site and BGG list no such title; the only "Trigger Warning"
  card game found on Kickstarter is an unrelated relationship party game by a different creator, so
  this record could not be confirmed to exist as described
SUMMARY|Trigger Warnings|2+|unknown|unknown|unknown|unknown|chain|unknown|framework|low

## WarlordCC (2023, Warlord Games) — kickstarter
- Players: 2
- Turns: alternating; a Decree phase where players give one Decree at a time in initiative order
  until both pass
- Resources: none; the Rank & File system (level, board rank, formation) gates plays, not currency
- Life: other; victory is killing the opposing Warlord (a specific leader character), not a counter
- Combat: compare-stat; a d20 roll plus modifiers must beat a TN derived from Attack vs. Armor Class
- Responses: windows; "Reacts" are cards played only in answer to a specific triggering occurrence
- Board: grid; the Rank & File formation arranges characters by rank and file, a 2D layout
- Card kinds: units (Characters), attachments (Items), spells (Actions: Orders/Reacts), heroes (the
  Warlord, an always-present leader whose death ends the game)
- Hook: A d20 Rank & File formation system replaces mana entirely — board rank and level, not a
  spent cost, decide what a character may do.
- Libraries sufficient: mostly; units/combat/heroes/attachments/spells cover the shapes, but
  formation-gated legality is new
- Missing rules: RankFileFormation (legality gated by position, not cost), SpendStun (a third
  exhausted-like state needing two turns to clear), DieRollVsTN (d20+modifier vs. a target number)
- Core gaps: none; formation legality reads as a filter-actions rule over the zone/position model
- Fit: framework
- Confidence: low; sources found describe "Warlord: Saga of the Storm" (2001, revived by Kingswood
  Games/AEG) — no 2023 CCG from the miniatures publisher Warlord Games was confirmed; may be mislabeled
SUMMARY|WarlordCC|2|alternating|none|other|compare-stat|windows|grid|framework|low

## Exodus TCG (2014, Existence Games) — live
- Players: 2
- Turns: unknown; not stated in any page that could be fetched
- Resources: resource-cards; a dedicated Energy Deck (minimum 20 cards, separate from the 20-card Main
  Deck) supplies Energy cards placed behind a creature to determine its effective strength
- Life: unknown
- Combat: unknown
- Responses: unknown
- Board: unknown
- Card kinds: units (Creatures, which in the base set carry no printed abilities at all), spells
  (Symmetry effect cards)
- Hook: A base-set Creature has no printed abilities whatsoever — its only strength is however much
  Energy, drawn from a wholly separate Energy Deck, a player commits behind it.
- Libraries sufficient: mostly; units plus resources' ResourceCards/RequiresAttachedResources cover the
  Energy system, spells covers Symmetry cards
- Missing rules: none identified from what is known; the two-deck construction (Main 20 + Energy 20)
  maps to decks' DeckPool
- Core gaps: none
- Fit: framework
- Confidence: medium; the publisher's own pages describe deck construction and the Energy mechanic in
  detail, but the linked official-rules and example-game pages both 404'd, leaving turn structure,
  combat resolution and win condition unconfirmed
SUMMARY|Exodus TCG|2|unknown|resource-cards|unknown|unknown|unknown|unknown|framework|medium

## Cyberpunk (2003 CCG) (2003, Social Games / ImageNative Worlds) — dead
- Players: 2
- Turns: full; players run Missions and raid Locations across a turn, exact phase list unconfirmed
- Resources: resource-cards; Location cards generate "Euro Bucks," tapped to recruit Runners
- Life: race; a player wins at 100 Ops points, at 100 Style points, or via their Sponsor's secret
  agenda — several parallel race tracks to the same kind of finish line
- Combat: attacker-chooses; players choose which Mission to run or opponent Location to raid for
  points, rather than a unit-vs-unit stat fight
- Responses: other; Event cards are "playable anytime," but no source confirmed if they chain
- Board: slots; distinct zones for Sponsor, Runners, Equipment, Cybernetics, Missions, Locations,
  Events, rather than a shared row or grid
- Card kinds: units (Runners), attachments (Equipment, Cybernetics), permanents (Locations,
  Sponsor), spells (Missions, Events)
- Hook: Players race to score Ops or Style points, or fulfill a secret Sponsor agenda, by running
  Missions and raiding Locations — there is no attacking the opponent's characters directly.
- Libraries sufficient: mostly; units/attachments/permanents/spells cover the shapes; several
  simultaneous win-condition tracks and an Empathy "cyber-psycho" corruption meter are new
- Missing rules: MultipleRaceTracks (first of several counters to n wins), CorruptionMeter (a stat
  below 0 turns a unit hostile), LocationRaiding (an attack-like verb targeting a permanent for points)
- Core gaps: none
- Fit: framework
- Confidence: medium; Wikipedia's summary is fairly detailed, but the one rules PDF found could not
  be read as text, so turn structure and resolution steps are inferred from the summary only
SUMMARY|Cyberpunk (2003 CCG)|2|full|resource-cards|race|attacker-chooses|other|slots|framework|medium

## Berserk (the CCG) (2003 / 2023 revival, Fantasy World, Inc. / Hobby World) — live
- Players: 2
- Turns: full; at turn start a player's exhausted creatures become alert again before acting
- Resources: other; each player starts with a one-time budget of gold/silver crystals (asymmetric:
  24/22 vs. 25/23) spent down over the game, not a per-turn resource
- Life: none; no separate life total, a player loses when every one of their creatures is destroyed
- Combat: defender-blocks; strikes only reach adjacent cells, and a non-exhausted adjacent card may
  protect, redirecting the hit
- Responses: unknown
- Board: grid; a shared 6-row by 5-column, 30-cell battlefield, three rows per side
- Card kinds: units (Creatures, with life/movement/basic-strike stats; archers, fliers, symbionts as
  subtypes)
- Hook: Creatures occupy specific cells of a shared 6x5 grid and can only strike, move or protect
  adjacent cells, so board position is the combat system, not a stat comparison.
- Libraries sufficient: no; units and combat's defender-blocks-style protector cover the shapes, but
  2D grid movement and adjacency targeting aren't modeled (`adjacent` presumes a row, not a grid)
- Missing rules: GridMovement (spend a movement stat to relocate on a grid), GridAdjacency (an
  `adjacent` selector over a grid shape), DiceCombat (opposed die roll, difference-based damage)
- Core gaps: none; `Shape` already includes `grid`, so this is a framework gap, not a core one
- Fit: framework
- Confidence: medium; Wikipedia's rules summary is specific (grid size, starting crystals, dice
  combat), though it is a summary rather than the full rulebook
SUMMARY|Berserk (the CCG)|2|full|other|none|defender-blocks|unknown|grid|framework|medium

## Perry Rhodan Sammelkartenspiel (1996, Fanpro / Between the Stars) — live
- Players: 2-4
- Turns: unknown; divided into up to five sequential story "phases," turn order within one unfound
- Resources: other; a card's own prerequisite chain ("premises": other cards already in play) gates
  whether it may be played, rather than a spent resource
- Life: other; no life total, victory to whoever has the most victory points at the chosen phase's end
- Combat: other; a "Pro" side combats opponents' "Anti" sides while one's own "Anti" obstructs the
  opponent's "Pro," but resolution mechanics were not found
- Responses: unknown
- Board: unknown; nine named card categories exist (Events, Fleets, Space Puzzles, Places, Persons,
  Spaceships, Status, Troops, Accessories) but no zone shapes were found
- Card kinds: units (Persons, Troops, Spaceships), permanents (Places, Fleets), spells (Events); the
  premise/prerequisite chain itself fits none of our records
- Hook: Every card lists "premises" — other cards that must already be in play before it may enter —
  letting players rebuild the novel's chronological plot as a precondition tree instead of a cost.
- Libraries sufficient: no; a prerequisite-chain cost, two fronts (Pro/Anti) per player, and a
  ruleset that changes across phases are all new
- Missing rules: PrerequisiteCost (legality gated by other cards in play), DualFrontPlayer (a Pro
  deck and an Anti deck per player vs. the matching opponent side), PhaseRuleset
- Core gaps: multi-record cards / a mid-game ruleset change — `Game` has one fixed `uses`/rules set
  for the whole game, no modeled way for legality to change between numbered phases
- Fit: core; a phase-based change of the active ruleset looks like it needs more than a new library
- Confidence: low; only encyclopedic summaries (Perrypedia, fan-forum threads) were reachable, no
  rulebook text, so mechanics beyond the premise-chain and phase structure are unconfirmed
SUMMARY|Perry Rhodan Sammelkartenspiel|2-4|unknown|other|other|other|unknown|unknown|core|low
