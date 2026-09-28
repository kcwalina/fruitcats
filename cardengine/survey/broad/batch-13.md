# Broad survey batch 13: Myths and Legends, Redemption, Warhammer: Invasion, Warhammer Age of Sigmar: Champions, Young Jedi CCG, The Simpsons TCG, SpongeBob SquarePants TCG, Neopets TCG, Bella Sara, The Eye of Judgment

## Myths and Legends (2000, Salo S.A.) — live
- Players: 2
- Turns: full; Magic-style turns with resource/main/combat phases, one active player at a time
- Resources: resource-cards; Gold cards played from hand each turn (like lands) pay for Allies, Weapons, Talismans and Totems
- Life: other; no life total — you lose when your own deck (the "Castillo") runs out of cards, a Star Wars-CCG-style deck-out
- Combat: defender-blocks; attacker declares an Ally attack, defender assigns one blocker; loser is destroyed and the strength difference hits the defender's deck
- Responses: none; summaries show no instant-speed stack, but this is the weakest-sourced field
- Board: row; each player's Allies sit in an unordered row in play, no lanes
- Card kinds: units (Allies), attachments (Weapons equip an Ally), permanents (Totems stay in play unattached)
- Hook: a Magic-like mana-and-combat CCG whose loss condition is decking out like the Star Wars CCG, not damage to a life total
- Libraries sufficient: yes; UnitCard/AttachmentCard/PermanentCard, `LoseOnEmptyDraw`, and `BattleDamageByStatDifference` already cover it
- Missing rules: none
- Core gaps: none
- Fit: libraries; every mechanic found is an existing library rule, just selected
- Confidence: medium; English-language coverage is thin, relied on translated Spanish wiki/blog summaries, no rulebook read directly
SUMMARY|Myths and Legends|2|full|resource-cards|other|defender-blocks|none|row|libraries|medium

## Redemption (1995, Cactus Game Design) — live
- Players: 2
- Turns: full; a five-phase turn (Draw, Upkeep, Preparation, Battle, Discard) per active player, then passes
- Resources: none; cards are played directly from hand, gated by territory/site rules, not a paid cost
- Life: race; first to rescue 5 Lost Souls from the opponent's Land of Bondage wins
- Combat: defender-blocks; a Hero's rescue attempt is blocked by an Evil Character, then both may add Enhancements before Strength vs Toughness is compared
- Responses: windows; each battle is an open window where either side adds Enhancement cards in turn until both pass, then totals are compared directly, no LIFO resolution
- Board: other; Territory is an open, unordered per-player area holding any number of characters and sites; battles occur in a separate shared Field of Battle
- Card kinds: units (Heroes/Evil Characters with Strength/Toughness), spells (Enhancements as combat tricks), permanents (Sites/Artifacts); Lost Souls fit no existing record — a captured objective card, not a unit
- Hook: two overlapping Good/Evil decks race to rescue Lost Souls held in the opponent's Land of Bondage through one-on-one Strength/Toughness battles
- Libraries sufficient: mostly; `WinAtCounter`, `ResponseWindows` and `DefenderBlocks`-style combat already cover the shape
- Missing rules: LostSoulCard (a rescuable/capturable objective record), Rescue (a verb moving a Lost Soul between zones, distinct from combat)
- Core gaps: none
- Fit: framework; only a new card record and verb are needed, no core change
- Confidence: high; official rulebook and quick-start guide found and read in summary
SUMMARY|Redemption|2|full|none|race|defender-blocks|windows|other|framework|high

## Warhammer: Invasion (2009, Fantasy Flight Games) — dead
- Players: 2
- Turns: full; each round one active player runs Kingdom/Quest/Battle phases in full before passing
- Resources: resource-cards; units placed in the Kingdom zone generate resources each turn equal to their power, spent to play cards
- Life: other; no single life total — each of three zones (Kingdom, Quest, Battlefield) has its own 8-point defense counter, and destroying 2 of the opponent's 3 zones wins
- Combat: defender-blocks; the attacker commits Battlefield units at a target zone, the defender may assign blockers from units in that zone, unblocked damage reduces the zone's defense
- Responses: windows; Event and Support abilities mostly fire at defined moments, no full nested stack in the base LCG
- Board: row; three parallel zones per player (Kingdom/Quest/Battlefield), each an unordered row of units
- Card kinds: units, permanents (Support cards fixed to a zone), spells (Events); Quest cards need their own record for zone-linked effects
- Hook: one capital split into three simultaneously-attacked zones that double as your resource engine, your card-draw engine and your battle line, so defending one starves another
- Libraries sufficient: no; needs new records/rules
- Missing rules: a per-zone defense counter and win condition (three independent LifeCounter-like rules tied to zone role), ZoneRole (a unit's zone placement decides whether it produces resources, draws cards, or fights)
- Core gaps: none; three independent zone-defense counters can each be a LifeRule feeding `provide-game-over`, no core change needed
- Fit: framework
- Confidence: medium; rulebook PDF located and BGG/fan summaries read, not the full text
SUMMARY|Warhammer: Invasion|2|full|resource-cards|other|defender-blocks|windows|row|framework|medium

## Warhammer Age of Sigmar: Champions (2019, Games Workshop / Gale Force Nine) — dead
- Players: 2
- Turns: other; a whole turn is capped at 2 actions (play a card, use a heroic act, or pass to draw), no phases, then it passes to the opponent
- Resources: none; no cost resource is paid — playing a card or acting simply spends one of the turn's 2 actions
- Life: counter; reduce the opponent's health to zero, or win by decking them out
- Combat: compare-stat; unconfirmed in detail — Champions and units appear to clash by comparing power while quests and blessings drive most of the swing, confidence is low on this field specifically
- Responses: none; no evidence found of a reaction/stack system, effects resolve inside the 2-action turn
- Board: slots; each of a player's 4 Champions occupies its own slot, each pursuing an individual hidden quest
- Card kinds: heroes (the 4 Champions, each with a personal quest and Blessing), units/spells (the 30 action cards); Quest/Blessing (a hidden per-Champion objective that reveals a bonus card on completion) fits no existing record
- Hook: four Champions each secretly pursue their own printed quest; completing one reveals and grants that Champion's Blessing, a hidden ongoing bonus
- Libraries sufficient: no
- Missing rules: Quest/Blessing (hidden per-object progress + reveal-on-complete), a fixed "N actions per turn" TurnRule (turns.alex has phases and pass-based ends, not an action budget)
- Core gaps: none confirmed; a hidden per-card progress counter with a reveal trigger looks expressible as a Mechanic/Ability, but this is not verified against a full rulebook
- Fit: framework
- Confidence: low; only fan-wiki and quick-rules-sheet summaries, core clash mechanic and quest tracking not independently confirmed
SUMMARY|Warhammer Age of Sigmar: Champions|2|other|none|counter|compare-stat|none|slots|framework|low

## Young Jedi Collectible Card Game (1999, Decipher) — dead
- Players: 2
- Turns: full; a Deploy phase (spend a fixed counter budget, usually 6, on Characters/Weapons/Effects) then a Battle phase for the current planet
- Resources: growing; each turn grants a fixed pool of counters (normally 6) spent to deploy cards, face-down on turn one and face-up after
- Life: other; no life total — lose by running out of your Reserve Deck, or win by claiming 2 of 3 sequential planets (Tatooine, Naboo, Coruscant)
- Combat: compare-stat; deployed Characters and Weapons are picked up into battle, Battle cards and stats are compared to decide the planet's destiny, no separate attacker/blocker declaration
- Responses: windows; Battle cards and some Effects are played at the battle step as a bounded window, not a general stack
- Board: other; a single shared Location (planet) card sits between the players; Characters/Weapons deploy to an open personal area, not lanes or a grid
- Card kinds: units (Characters), attachments (Weapons), spells (Effects/Battle cards), permanents (the shared Location card, a `shared` permanent)
- Hook: three shared planet cards are fought over in sequence, winning the current one's battle advances play to the next, and taking two of three wins the game
- Libraries sufficient: no
- Missing rules: a "claim N of M sequential shared objectives" win rule (unlike WinAtCounter or LifeStack, the objectives are ordered and shared), a fixed per-turn deploy budget (as in Age of Sigmar: Champions)
- Core gaps: none
- Fit: framework
- Confidence: medium; Wookieepedia, BGG and a fan rulebook PDF located, not fully read
SUMMARY|Young Jedi Collectible Card Game|2|full|growing|other|compare-stat|windows|other|framework|medium

## The Simpsons Trading Card Game (2003, Wizards of the Coast) — dead
- Players: 2+; designed for 3-5 but playable with 2
- Turns: full; each player in turn plays Character/Object cards onto the single active Scene, trying to match or mismatch its printed traits
- Resources: none; cards are played directly from hand, no cost to pay
- Life: race; first to 7 points wins, points scored by completing or "trashing" Scenes
- Combat: none; success is whether a played Character's traits match the active Scene's requirements, not a fight between cards
- Responses: none; no reaction or stack system found in summaries
- Board: other; a single shared Scene card is active at a time, onto which every player's Characters are played — not a personal board, lanes, or a grid
- Card kinds: none of units/spells/attachments/permanents/heroes fit cleanly; needs a shared, scored "Scene" objective record and Characters that are trait-tag bearers rather than stat-bearing units
- Hook: one shared Scene card is resolved by every player playing Characters that either complete it (traits match) or trash it (traits mismatch), scoring points either way
- Libraries sufficient: no
- Missing rules: SceneCard (a shared, scored objective unlike any PermanentCard), a trait-matching scoring Condition, multiplayer participation around one shared object (core's `require-actions` already supports simultaneous input, no gap there)
- Core gaps: none
- Fit: framework
- Confidence: medium; hobbyDB, Wikisimpsons and BGG summaries corroborate each other, no rulebook opened directly
SUMMARY|The Simpsons Trading Card Game|2+|full|none|race|none|none|other|framework|medium

## SpongeBob SquarePants Trading Card Game (2003, Upper Deck Entertainment) — dead
- Players: 2
- Turns: full; the active player plays up to two Katchers under a Location card, the opponent may respond, then totals are compared
- Resources: none; no separate cost resource, cards are played directly from a hand refilled by drawing new Location cards each turn
- Life: race; first to catch (win) 4 of the active Location cards wins the game
- Combat: attacker-chooses; the active player commits Katchers to a Location, the opponent may answer with a Strategy card or a Katcher of their own before the higher Patty Pouch total wins it
- Responses: windows; a single reaction window per Location contest lets the opponent add a Strategy card or Katcher before totals compare, not a full stack
- Board: slots; up to four Location cards are laid out in slots simultaneously, each its own contest
- Card kinds: units (Katchers, with a Patty Pouch/strength stat), spells (Strategy cards as combat tricks), permanents (Location cards, a capturable/ownable shared objective)
- Hook: up to four Location cards are open as separate simultaneous contests, and catching four of them wins the game
- Libraries sufficient: no
- Missing rules: a capturable/ownable permanent (a Location that changes controller when won and scores toward victory) — `PermanentCard` has no notion of being contested or won
- Core gaps: none; `ZoneCapacity` already covers the four simultaneous slots
- Fit: framework
- Confidence: medium; Encyclopedia SpongeBobia and toy-listing summaries agree, no rulebook opened
SUMMARY|SpongeBob SquarePants Trading Card Game|2|full|none|race|attacker-chooses|windows|slots|framework|medium

## Neopets Trading Card Game (2003, Wizards of the Coast) — dead
- Players: 2
- Turns: full; each round the active player may deploy a Neopet or start a Contest in an arena, the opponent gets one reply before dice decide it, then the turn passes
- Resources: none; Neopets and Item/Equipment cards are played from hand, gated by placement rules, not by a paid cost
- Life: race; first player to bank 21 points worth of Item/Equipment cards wins
- Combat: compare-stat; a Contest sums each side's Neopets'/Heroes' relevant stat plus equipment bonuses and a die roll, the higher total banks the contested card
- Responses: windows; the non-active player gets one reply (an Item card played face-down, then revealed) before the roll-off, not a full stack
- Board: lanes; up to three of the four Contest arenas (Strength, Agility, Magic, Intelligence) are active at once, each an independent lane
- Card kinds: units (Neopets/Heroes with four stats), attachments (Item/Equipment cards boosting a Neopet)
- Hook: each side secretly commits an Item card face-down before a dice-off decides who banks it, turning every stat contest into a bluffing mini-game
- Libraries sufficient: no
- Missing rules: a die-augmented contest CombatRule (compare stat totals plus a rolled die), a blind-bid verb (simultaneous face-down commit, then reveal) — `WinAtCounter` already covers banking to 21 points
- Core gaps: none; die rolls are already a core random operation
- Fit: framework
- Confidence: medium; official rulebook PDF located (neopets.com/tcg/rulebook.phtml) and cross-checked against wiki summaries, not read in full
SUMMARY|Neopets Trading Card Game|2|full|none|race|compare-stat|windows|lanes|framework|medium

## Bella Sara (2005, Hidden City Games) — dead
- Players: 2+; the printed physical mini-games (where they existed) were Go-Fish-style and open to any number
- Turns: other; no consistent adversarial turn structure was found across editions
- Resources: none
- Life: none
- Combat: none; cards carry no stats meant to fight one another
- Responses: none
- Board: none
- Card kinds: none of ours fit; cards are collectibles/online-unlock tokens, not battle pieces
- Hook: cards mostly function as collectibles and as codes that unlock content (feeding, training, decorating) in a companion browser horse-care game; the few printed physical games are non-competitive (Go Fish-style), not a card-battle ruleset, and later print runs (2009+) dropped even the play symbols
- Libraries sufficient: n/a; nothing to select — this is not a card-versus-card game
- Missing rules: none applicable
- Core gaps: none applicable
- Fit: out; not a competitive card game, no adversarial ruleset to classify against the catalogue
- Confidence: medium; multiple independent sources (Wikipedia, Giant Bomb, fan wiki) agree the design intent was explicitly non-competitive and collection/care-focused
SUMMARY|Bella Sara|2+|other|none|none|none|none|none|out|medium

## The Eye of Judgment (2007, Sony Computer Entertainment) — dead
- Players: 2
- Turns: alternating; players alternate single actions (summon a creature, cast a spell, or pass) rather than full phased turns
- Resources: growing; both players start with 5 mana and gain more each round, spent to summon Creatures or cast Spells
- Life: other; no life total — win by controlling a majority (5 of 9) of the grid's fields when the decks run low, or if the opponent decks out
- Combat: attacker-chooses; a Creature may attack any adjacent enemy-controlled field on the 3x3 grid, the defender has no separate block action beyond instant-speed responses
- Responses: windows; Conjuration/instant-speed spells can be cast in reaction to a summon or attack, a bounded window rather than a full stack
- Board: grid; a fixed 3x3 grid of 9 fields, each independently aligned to one of five elements (top/bottom sides), is the entire board
- Card kinds: units (Creatures, with Attack/Hit Points), spells (Sorcery/Conjuration/Dominion); field elemental alignment (a per-zone stat modifier) fits no existing record
- Hook: the board itself is a 3x3 grid of elementally-aligned fields that buff or debuff whichever creature stands there, so placement matters as much as the creature played
- Libraries sufficient: no
- Missing rules: a field/zone elemental-alignment property that modifies the stats of whatever occupies it, a 2-D grid adjacency selector (combat.alex's `adjacent` is defined for a row, not a grid)
- Core gaps: none; `extension Zone { element: text }` should work the same way card extensions do, since `Zone` is a `Game`-owned data member, but this was not verified against a live implementation
- Fit: framework
- Confidence: medium; BGG, TV Tropes and GameFAQs summaries corroborate, no official rulebook read directly
SUMMARY|The Eye of Judgment|2|alternating|growing|other|attacker-chooses|windows|grid|framework|medium
