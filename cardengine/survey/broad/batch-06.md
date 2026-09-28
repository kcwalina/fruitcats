# Batch 06: Yu-Gi-Oh!, Pokémon TCG, Digi-Battle (1999), Digimon Card Game (2020), Duel Masters, Battle Spirits, Cardfight!! Vanguard, Future Card Buddyfight, Weiss Schwarz, WIXOSS

## Yu-Gi-Oh! Trading Card Game (1999, Konami) — live
- Players: 2
- Turns: full; Draw/Standby/Main1/Battle/Main2/End phases, then the other player's turn.
- Resources: none; monsters are played from hand directly, higher-level ones paid by tributing (releasing) your own monsters, not a resource pool.
- Life: counter; 8000 LP, race to 0 (or deck-out).
- Combat: attacker-chooses; attacker declares a target monster or the player directly, no blocking step.
- Responses: chain; any player may chain a faster-or-equal Spell Speed effect in reverse order before it resolves.
- Board: row; 5(+) Monster Zones and 5 Spell/Trap Zones per side, plus Field zone, Graveyard, Extra Deck.
- Card kinds: units (Monsters), spells (Spell cards), attachments (Equip Spells), permanents (Continuous Spell/Trap, Field Spell); set Traps are hidden permanents.
- Hook: no mana curve at all — a monster's cost is releasing your own monsters (tribute) or using other monsters as Fusion/Synchro/Xyz/Link material.
- Libraries sufficient: mostly; units/spells/attachments/permanents/chain cover most of it.
- Missing rules: TributeCost (pay a cost by destroying/releasing your own units, not a resource), MaterialCost (Extra Deck summons consume other units as cost), SetFaceDown, PositionChange (attack/defense position).
- Core gaps: none; a cost that consumes objects instead of a resource counter is a new framework rule, not a core change.
- Fit: framework; tribute/material-as-cost is not expressible with the common/resources libraries as they stand.
- Confidence: high; extensively documented, well known.
SUMMARY|Yu-Gi-Oh! Trading Card Game|2|full|none|counter|attacker-chooses|chain|row|framework|high

## Pokémon Trading Card Game (1996, The Pokémon Company / Wizards of the Coast) — live
- Players: 2
- Turns: full; draw, then any number of actions (play Basics/Trainers, evolve, attach one Energy, retreat), one Attack ends the turn.
- Resources: resource-cards; Energy cards attach to a Pokémon and power its attacks.
- Life: keys; 6 Prize cards taken as opposing Pokémon are Knocked Out, win by taking them all.
- Combat: attacker-chooses; the Active Pokémon attacks the opponent's Active Pokémon only, no blocking, Bench is safe.
- Responses: none; effects overwhelmingly resolve immediately on the active player's turn.
- Board: slots; 1 Active slot + up to 5 Bench slots per side, plus a shared Stadium slot.
- Card kinds: units (Pokémon, with Weakness/Resistance), attachments (Energy, Pokémon Tools), spells (Trainer Items/Supporters), permanents (Stadium, shared and replaced).
- Hook: Energy is a resource glued to one specific unit rather than a shared pool, and type Weakness/Resistance multiplies damage.
- Libraries sufficient: mostly; combat.WeaknessResistance, resources.RequiresAttachedResources, objects.stack-onto (Evolution) all map cleanly.
- Missing rules: RetreatCost (discard Energy to switch the Active Pokémon) is a cost-like verb not modeled explicitly; otherwise none.
- Core gaps: none.
- Fit: libraries; nearly everything maps onto an existing library rule.
- Confidence: high; well known, matches rulebook.
SUMMARY|Pokémon Trading Card Game|2|full|resource-cards|keys|attacker-chooses|none|slots|libraries|high

## Digimon Digi-Battle Card Game (1999, Bandai) — dead
- Players: 2
- Turns: full; a Digivolve Phase (coin flip decides priority) followed by playing Power Option cards and battling.
- Resources: none; cards go directly into play or onto the Power Port, no paid resource pool.
- Life: other; unclear from available summaries whether there is a single shared life total or the match is decided battle-by-battle; treat as unestablished.
- Combat: compare-stat; the Digimon with the higher total Power (base plus Power Option/Technique modifiers) wins the encounter.
- Responses: windows; players alternate playing Power Option cards onto the Power Port before the comparison resolves.
- Board: other; a fixed "place mat" of named areas (Digivolve zone, Power Port, battle area) rather than a row/lane/grid shape.
- Card kinds: units (Digimon, with a Power stat), spells (Power Option / Technique cards).
- Hook: the outcome of a fight is a straight Power comparison, boosted by option cards played alternately, rather than a damage/life-total system.
- Libraries sufficient: mostly; combat.CompareStatDeletes plus a response window cover the comparison.
- Missing rules: a match/round structure for how comparisons decide the overall game (not clearly a life counter or stack).
- Core gaps: none apparent, but sourcing here is thin.
- Fit: framework.
- Confidence: low; the original 1999 rulebook was not accessible, this is built from fan/secondary summaries only — verify before relying on it.
SUMMARY|Digimon Digi-Battle Card Game|2|full|none|other|compare-stat|windows|other|framework|low

## Digimon Card Game (2020, Bandai) — live
- Players: 2
- Turns: shared-gauge; playing/digivolving a card moves the shared Memory Gauge toward the opponent, and the turn passes once it crosses to their side.
- Resources: other; the Memory Gauge is a single shared signed counter, both the cost currency and the turn-passing mechanism, not a per-player pool.
- Life: stack; a 5-card face-down Security stack, attacked directly it is checked card by card (security effects may fire).
- Combat: attacker-chooses+defender-blocks; a Digimon attacks a Digimon or the player directly, but a Blocker-keyword Digimon may redirect an attack to itself.
- Responses: windows; security checks reveal cards and inherited (digivolved) effects fire as fixed reaction moments.
- Board: other; an open Battle Area with no fixed slots or lanes, cards may digivolve by stacking directly on top of their prior form.
- Card kinds: units (Digimon, stacked via Digivolve), spells (Option cards), permanents (Tamer cards, matching the library's own example).
- Hook: the Memory Gauge is a single shared, signed counter that both pays every cost and hands the turn over, named directly in the framework's turns library.
- Libraries sufficient: mostly; turns.MemoryGauge, objects.InheritedEffects/StackPreservesState (digivolution), life-stack (Security), permanents (Tamers) all fit closely.
- Missing rules: BlockerRedirect (a keyword letting an unlisted Digimon intercept an attack; different from Guardian's must-be-attacked-first).
- Core gaps: none.
- Fit: libraries.
- Confidence: high; rules well documented, matches the project's own "cards as data" notes on Digimon.
SUMMARY|Digimon Card Game|2|shared-gauge|other|stack|attacker-chooses+defender-blocks|windows|other|libraries|high

## Duel Masters (2002, Wizards of the Coast / Takara) — live
- Players: 2
- Turns: full; untap, draw, charge one card face-down to the Mana Zone, main (summon/cast paid by tapping mana), attack, end.
- Resources: cards; any card may be placed face-down, tapped, into the Mana Zone as fuel, losing its front-face identity there.
- Life: stack; 5 face-down Shields, hit directly one breaks (reveals); some carry a free "Shield Trigger" play.
- Combat: attacker-chooses+defender-blocks; attacker targets a player or creature, the defender may block with an untapped creature.
- Responses: windows; Shield Trigger is a free out-of-turn play triggered by a shield breaking.
- Board: other; creatures sit in an open, shared Battle Zone rather than fixed lanes or a grid.
- Card kinds: units (Creatures), spells (Spells, one-shot).
- Hook: any card doubles as itself or as flipped-down mana fuel, chosen at the moment it's played.
- Libraries sufficient: mostly; resources.CardsAsResources + NoIdentityWhileResource and life-stack.LifeStack/Lucky fit precisely.
- Missing rules: none major; multicolor ("civilization") cost matching is already covered by Cost's map-of-resource-kinds form.
- Core gaps: none.
- Fit: libraries.
- Confidence: high; well known, stable core rules across the game's history.
SUMMARY|Duel Masters|2|full|cards|stack|attacker-chooses+defender-blocks|windows|other|libraries|high

## Battle Spirits (2009, Bandai) — live
- Players: 2
- Turns: full; Main Step (play/level up/set Burst/activate abilities), Attack Step (attackers declared, defenders choose blockers, two Flash windows), End Step.
- Resources: growing; Cores accumulate on the field each turn and are sent to the trash (Core Cost) to pay for cards.
- Life: stack; Life is a stack of your own face-down cards sent to the trash as damage, some with a "Burst" effect that fires as they go.
- Combat: attacker-chooses+defender-blocks; attackers are declared, defenders choose blockers, higher BP destroys the lower (a tie destroys both).
- Responses: windows; two Flash Windows per Attack Step let flash-speed cards respond.
- Board: other; Spirits occupy an open field area rather than fixed lanes or a grid.
- Card kinds: units (Spirits, with BP), spells (Magic cards), permanents (Nexus cards, stay in play).
- Hook: Cores sit on the field as a growing, spendable fuel while Life is itself a face-down card stack with its own trigger effects (Burst) on loss.
- Libraries sufficient: mostly; resources.GrowingCounter, life-stack, combat.CompareStatDeletes/TieDeletesBoth, responses.ResponseWindows all map.
- Missing rules: symbol-based cost reduction (cards in play reducing a later card's Core Cost) is not an existing resource policy.
- Core gaps: none.
- Fit: libraries.
- Confidence: medium; gathered from official rule-manual summaries rather than a full rulebook read.
SUMMARY|Battle Spirits|2|full|growing|stack|attacker-chooses+defender-blocks|windows|other|libraries|medium

## Cardfight!! Vanguard (2011, Bushiroad) — live
- Players: 2
- Turns: full; Stand, Draw, Ride, Main, Battle, End phases each turn, alternating.
- Resources: none; Units are Ridden or Called from hand by grade restriction, no paid currency.
- Life: stack; a Damage Zone of cards revealed (Damage Check) from your own deck and kept face-up; six damage (or deck-out) loses.
- Combat: attacker-chooses+defender-blocks; the Vanguard/Rear-Guards attack, the defender may place cards in the Guardian Circle to boost defense.
- Responses: windows; the Guard Step is a fixed window for the defender to add guardians or play Perfect Guard/Intercept cards.
- Board: grid; a Vanguard Circle plus up to 5 Rear-Guard Circles arranged in front/back rows.
- Card kinds: units (Units, with grade/power/shield); later sets add Order cards (spells).
- Hook: the Drive Check / Damage Check reveal cards from your own deck as both your life total and a per-attack bonus-icon lottery.
- Libraries sufficient: mostly; life-stack, combat.DefenderBlocks, responses.ResponseWindows cover the shape of it.
- Missing rules: DriveCheck/TriggerIcon (revealing a deck card grants a bonus tied to a printed icon, feeding directly into the same attack's stats — a hybrid draw-and-apply mechanic not modeled by any library); Stride/Legion (later stacking mechanics from a separate zone).
- Core gaps: none; DriveCheck is a new framework verb over existing operations, not a core change.
- Fit: framework.
- Confidence: high; comprehensive rules fetched and well known generally.
SUMMARY|Cardfight!! Vanguard|2|full|none|stack|attacker-chooses+defender-blocks|windows|grid|framework|high

## Future Card Buddyfight (2013, Bushiroad) — dead
- Players: 2
- Turns: full; Draw, Charge & Draw (place a card face-down in Gauge, draw one), Main (cast/call paid by Gauge), Attack, End.
- Resources: cards; the Gauge Zone holds cards placed face-down from hand as fuel, paid by discarding them to the drop zone.
- Life: counter; a numeric Life total reduced directly by unblocked attacks, reaching 0 loses.
- Combat: attacker-chooses+defender-blocks; the defender may fully block with a monster of sufficient Size, otherwise damage hits Life; Counter-timing spells may respond.
- Responses: windows; Counter cards can be cast during the opponent's attack as a fixed reaction window.
- Board: slots; the Monster Zone is capped not by card count but by the combined Size stat of the monsters on it (max 3).
- Card kinds: units (Monsters, with Size/Power/Defense/Critical), spells (Spell cards), heroes (the player's own signature "Buddy" monster, always available in its own zone and called into play, similar to a hero card with a repeatable Buddy Skill).
- Hook: each player's signature Buddy monster starts in its own zone from the outset and is called into the capacity-limited Monster Zone at will.
- Libraries sufficient: mostly; resources.CardsAsResources (Gauge), life.LifeCounter, heroes.HeroCard (Buddy) all map.
- Missing rules: SizeCapacity (a zone capacity keyed on the sum of a stat across objects, not a card count — common.ZoneCapacity only counts objects).
- Core gaps: none; a stat-summed capacity check is a new framework hook, not a core change.
- Fit: framework.
- Confidence: medium; built from official rulebook search summaries, game is defunct in English so play experience is limited.
SUMMARY|Future Card Buddyfight|2|full|cards|counter|attacker-chooses+defender-blocks|windows|slots|framework|medium

## Weiss Schwarz (2008, Bushiroad) — live
- Players: 2
- Turns: full; Draw, optional Clock (card from hand to Clock, draw 2), Main (play Characters/Events paid from Stock), Climax (one Climax card), Battle, End.
- Resources: cards; the Stock Zone holds cards placed face-down (from your own deck) as fuel to pay costs.
- Life: counter; the Clock accumulates cards from your deck, every 7 raises your Level, reaching Level 4 loses.
- Combat: attacker-chooses; Front Row characters attack directly, there is no blocking step.
- Responses: windows; Counter-timing cards and Climax Combo effects play around the Trigger/Damage step as fixed windows.
- Board: grid; a Front Row and Back Row of up to 4 character slots each per side.
- Card kinds: units (Characters, with Level/Power/Soul), spells (Events); Climax cards are a once-per-turn public card type that fits no existing record.
- Hook: your own deck is simultaneously your life total (Clock) and your resource fuel (Stock), so drawing further depletes both safety and options.
- Libraries sufficient: mostly; resources.CardsAsResources, life.LifeCounter, responses.ResponseWindows map, but Climax has no library fit.
- Missing rules: ClimaxCard (a once-per-turn special card with its own single-capacity public zone, neither Unit/Spell/Permanent); TriggerIconCheck (a revealed deck card's printed icon grants a bonus, the same recurring pattern as Vanguard's Drive Check).
- Core gaps: none.
- Fit: framework.
- Confidence: high; well documented, matches rulebook excerpts fetched.
SUMMARY|Weiss Schwarz|2|full|cards|counter|attacker-chooses|windows|grid|framework|high

## WIXOSS (2013, Takara Tomy) — live
- Players: 2
- Turns: full; Draw, Grow (level up your Lrig), Main (play Signi/Spells, attack), End.
- Resources: none; Signi are played from hand within per-turn limits and growing the Lrig costs discarding a card rather than spending a stockpiled resource (exact Signi cost mechanism not fully confirmed).
- Life: stack; a 7-card face-down Life Cloth, each direct hit removes one, losing when empty and hit again.
- Combat: lanes; battles happen across three fixed linear lanes (left/center/right).
- Responses: windows; Spell cards appear to have fixed play timings around attacks, though this is less firmly confirmed than the lane and life-cloth mechanics.
- Board: lanes; the same three linear lanes structure the whole field.
- Card kinds: units (Signi, supporting the Lrig), heroes (the Lrig — always in play, grows by leveling, represents the player), spells (Spell cards).
- Hook: the player's own signature Lrig grows through its own dedicated deck, stacking a higher-level Lrig over the last one, while combat plays out across three fixed lanes — a mechanic the framework names directly (combat.Lanes).
- Libraries sufficient: mostly; combat.Lanes, life-stack.LifeStack/LoseWhenEmpty, heroes (Lrig) and objects.stack-onto (Lrig growth) all map well.
- Missing rules: GrowCost (the Lrig's per-level cost is distinct from any generic resource-pool rule currently in resources.alex).
- Core gaps: none.
- Fit: libraries.
- Confidence: medium; lanes/life-cloth/Lrig-growth confirmed via search, but the Signi cost system and response timing are less certain.
SUMMARY|WIXOSS|2|full|none|stack|lanes|windows|lanes|libraries|medium
