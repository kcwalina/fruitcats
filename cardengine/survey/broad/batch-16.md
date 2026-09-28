# Broad survey batch 16: SolForge, Duelyst, Infinity Wars, Kards, Pokémon TCG Pocket, Chaos TCG

## SolForge (2013, Stoneblade Entertainment) — digital-dead
- Players: 2
- Turns: full; a player draws 5, plays up to 2 of them, discards the rest, then passes the whole turn
- Resources: none; nothing is spent to play a card, a hard 2-plays-per-turn cap gates access instead
- Life: counter; each player starts at 120 health, reduced to 0 loses
- Combat: lanes; each of 5 lanes resolves at once — occupied lanes fight each other, an unopposed front creature hits the player directly, and creatures fight on both players' turns
- Responses: none; all play happens on the active player's own turn, no reactive window is described
- Board: lanes; 5 lanes, a creature that enters a lane stays there permanently until removed
- Card kinds: units (creatures), spells
- Hook: leveling — each time a copy of a named creature is drawn and replayed it enters as a stronger printing than the last, tracked per card name, not per physical copy
- Libraries sufficient: mostly; units/combat/turns/common cover stats, lane combat and the draw-play-discard turn
- Missing rules: LevelsOnReplay (a UnitRule: swap a played card for a stronger printing of the same name, keyed to a per-name play/cycle counter, via the core's existing destroy+create operations)
- Core gaps: none; the swap can be built from existing operations, just needs a new rule type
- Fit: framework; only a new library rule is needed, not a core change
- Confidence: medium; corroborated by Wikipedia and the SolForge fan wiki's "How to Play" page, not personally played
SUMMARY|SolForge|2|full|none|counter|lanes|none|lanes|framework|medium

## Duelyst (2016, Counterplay Games) — digital-dead
- Players: 2
- Turns: full; a player draws, gains mana, moves/plays/attacks freely, then ends the turn
- Resources: growing; a mana-core counter starts at 2 (or 3 for the second player) and grows by 1/turn to a 9 cap, refilling in full each turn
- Life: counter; each general carries an HP counter, reaching 0 loses
- Combat: attacker-chooses; a unit or general moves then attacks an adjacent enemy, which strikes back with simultaneous return damage
- Responses: none; only turn-bound triggered abilities (Opening Gambit, Deathwatch, Zeal-while-adjacent) are described, no opponent's-turn window
- Board: grid; a 9x5 grid, units have a movement range and a facing, and Zeal buffs trigger by adjacency to the general
- Card kinds: units, spells, heroes (the general, with a repeatable mana-costed Battle Skill)
- Hook: tactical positioning — units and the general move around a grid instead of sitting in a lane or row, so adjacency and reach decide legal targets
- Libraries sufficient: mostly; units/combat/heroes/resources/turns give the stats, mana growth and a hero ability, but nothing models 2-D movement
- Missing rules: Movement (per-unit move range, pathing, adjacency-gated attack), a Zeal-style "buffed while adjacent to X" static
- Core gaps: an object's `position` is a single int, not a 2-D coordinate, and there is no move-within-zone or adjacency query for a `grid`-shaped zone, so pathing, movement range and facing cannot be expressed
- Fit: core; the grid needs real 2-D position and movement, which the object model doesn't offer
- Confidence: medium; Wikipedia plus the Duelyst fan wiki's rules/keyword pages, general knowledge of the game, not re-checked against the full rulebook
SUMMARY|Duelyst|2|full|growing|counter|attacker-chooses|none|grid|core|medium

## Infinity Wars: Animated Trading Card Game (2013, Lightmare Studios) — digital-dead
- Players: 2
- Turns: simultaneous; both players commit actions each round and the engine resolves them together (the games.md hook: combat plays out as a cutscene)
- Resources: growing; one colour-neutral resource is added to a shared pool every turn and may pay for anything
- Life: counter; health and morale each start at 100 and either hitting 0 ends the game (two counters, one field)
- Combat: defender-blocks; a creature deploys to Support, moves to Assault to attack, and the defending player's Defense-zone creatures block it
- Responses: none; actions resolve simultaneously each round rather than through any reactive stack or window
- Board: slots; four named zones per side (Command, Support, Assault, Defense); Command holds exactly 3 commanders that are in play but never in battle
- Card kinds: units (fighters), spells (abilities), heroes (3 commanders that gate deck legality by "Purity" instead of acting)
- Hook: whole-round simultaneous resolution instead of alternating actions
- Libraries sufficient: mostly; turns.alex has no rule for it, but core-operations already defines `require-actions` for exactly this ("Simultaneous decisions are this")
- Missing rules: SimultaneousTurns (a TurnRule built on the core's existing `require-actions` input, which turns.alex does not yet declare), a commander-gated deck-legality rule (decks.alex has nothing like Commander colour identity)
- Core gaps: none; the primitive needed already exists in core-operations, unused by any library rule
- Fit: framework; the core anticipates simultaneous decisions, a library rule just needs to expose it
- Confidence: low; the Wikipedia article 404'd, so this rests on secondary web summaries (Steam/GameFAQs-style write-ups), not an official rulebook
SUMMARY|Infinity Wars: Animated Trading Card Game|2|simultaneous|growing|counter|defender-blocks|none|slots|framework|low

## Kards: The WWII Card Game (2019, 1939 Games) — digital-live
- Players: 2
- Turns: full; a player draws, gains Kredits, deploys/moves/attacks, then passes
- Resources: growing; Kredits rise by 1/turn to a 12 cap (24 with certain cards), refilling in full each turn
- Life: counter; destroying the opponent's Headquarters card (an HP counter) ends the game
- Combat: attacker-chooses; a front-line unit attacks any opposing front-line unit or the HQ directly, no block step
- Responses: none found beyond a paid retreat a unit may take instead of dying
- Board: row; each side has a Support row (max 4) and a Front row (max 5); a unit must be deployed to Support and pay Kredits to move to Front, and normally cannot move back
- Card kinds: units, spells (Orders), a Commander/HQ card fixed per player
- Hook: two-row deployment — a unit sits a turn in Support before it can reach the Front where it fights, and leaving the Front (retreating) costs a resource instead of being free
- Libraries sufficient: yes; ZoneCapacity gives the row caps, common's `move` verb gives Support→Front, and combat's `Retreat : CombatRule { pay: Cost, once-per-turn: bool }` is a near-literal match for Kards' retreat
- Missing rules: none
- Core gaps: none
- Fit: libraries; every distinguishing piece (row capacity, paid movement, paid retreat) is already a named rule
- Confidence: medium; Wikipedia's summary corroborates the games.md hook; not checked against the current live ruleset, which may have patched since 2019
SUMMARY|Kards: The WWII Card Game|2|full|growing|counter|attacker-chooses|none|row|libraries|medium

## Pokémon Trading Card Game Pocket (2024, Creatures Inc. / DeNA) — digital-live
- Players: 2
- Turns: full; draw, take 1 auto-generated Energy, play Trainers/evolve/attach/attack, pass
- Resources: resource-cards; Energy attaches to a Pokémon and is required to attack, but it is granted automatically each turn (no Energy cards in the 20-card deck) rather than drawn
- Life: race; first to 3 points (from KOs, 2 for an ex Pokémon) wins, replacing the paper game's 6 prize cards
- Combat: attacker-chooses; the active Pokémon's chosen move deals its printed, weakness/resistance-adjusted damage to the opponent's sole active Pokémon, no block step
- Responses: none; Trainer cards and attacks only happen on the active player's own turn
- Board: slots; 1 active slot plus up to 3 bench slots per side (vs 5 bench in the paper game)
- Card kinds: units (Pokémon, evolving by stacking a card onto one in play), spells (Item/Supporter Trainers, 1 Supporter/turn), attachments (Energy, Tools)
- Hook: a simplified paper TCG — one automatic Energy per turn instead of an Energy-card economy, 20-card decks, and a first-to-3-points race instead of a prize pile
- Libraries sufficient: mostly; resources.alex's `RequiresAttachedResources` policy is commented "(Pokémon energy)" and life.alex's `WinAtCounter` ("first to n of a counter wins") match this game almost exactly, and objects.alex's stack-onto/`StackPreservesState` covers evolution
- Missing rules: AttackList (a unit needing several named attacks, each with its own energy cost, damage and text, rather than a single power stat) — the same gap the paper Pokémon deep-survey record needs
- Core gaps: none beyond that same multi-attack-per-card gap
- Fit: framework; the resource and win-condition pieces are already covered, but per-card multiple costed attacks are not
- Confidence: medium; Wikipedia plus general knowledge of the paper game it simplifies; have not played Pocket directly
SUMMARY|Pokémon Trading Card Game Pocket|2|full|resource-cards|race|attacker-chooses|none|slots|framework|medium

## Chaos TCG (2009, Bushiroad) — dead
- Players: 2
- Turns: full; stand/draw/clock/main/climax/battle/encore phases alternate whole turns
- Resources: cards; a face-down "Stock" pile built from the player's own deck pays for plays (any card facedown, identity irrelevant)
- Life: stack; the deck is the life total — unprevented damage sends its top cards to a separate "Clock" pile (7 there = level up), and each lost card is flipped face-up and checked for a printed "Trigger" bonus (draw, +stock, +damage, etc.)
- Combat: compare-stat; an attacked character's level+power totalled against the attacker's decides whether the attack is "reversed" (no damage), rather than a block step
- Responses: windows; some events/characters carry a "Counter" timing playable during the opponent's turn or an attack
- Board: row; a stage of a front row and a back row per player, both slot-limited
- Card kinds: units (characters), spells (events); one kind fits none of ours: Climax — a once-per-turn card whose play is a condition characters' static abilities check for ("combo")
- Hook: the trigger check — every card lost as life is revealed and may fire a small printed bonus, so taking damage doubles as card advantage
- Libraries sufficient: mostly; life-stack's `LifeStack`/`RevealedCardEffectFires` model the deck-as-life-with-triggers closely, and combat has a comparable (if not identical) stat-comparison rule
- Missing rules: a reversal-style CombatRule (compare totals to prevent damage, rather than `CompareStatDeletes`' delete-the-loser), ClimaxCombo (a once-per-turn card type other cards' statics can check for), a Stock-vs-Clock split (two piles both fed from the same deck, one for cost, one for life)
- Core gaps: none identified
- Fit: framework; needs a few new record/rule types, no change to the core's model
- Confidence: low; no Chaos TCG-specific rules text was found online (only that it is Bushiroad's earlier trading card line); this record is inferred from its confirmed identity as a reskin of Weiß Schwarz's engine, not from Chaos-specific sources
SUMMARY|Chaos TCG|2|full|cards|stack|compare-stat|windows|row|framework|low
