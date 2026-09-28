# Broad survey — batch 08: Bakugan, Kaijudo, Chaotic, Redakai, Lightseekers, Precious Memories, Lycée, Shadowverse: Evolve, Naruto CCG, Dragon Ball Z CCG (Score)

## Bakugan Trading Card Game (2010, Spin Master / Giochi Preziosi) — dead
- Players: 2
- Turns: alternating; players take turns rolling one Bakugan at a time onto Gate Cards until a shared gate holds Bakugan from both sides, forcing a battle
- Resources: none; Ability Cards are just played from hand at fixed timing windows, no cost to pay
- Life: race; first player to send 3 Gate Cards to their Used Pile wins
- Combat: compare-stat; the opened Gate's bonuses apply, then both sides' G-Power totals (raised further by Ability Cards) are compared, higher wins the card
- Responses: windows; Ability Cards are restricted to named moments (before rolling, after rolling, start of battle, during battle, on winning or losing a battle)
- Board: row; a shared line of Gate Cards (each player contributes one Gold, one Silver, one Copper) that Bakugan are rolled onto in turn
- Card kinds: units (Bakugan), permanents (Gate Cards, in play until used), spells (Ability Cards, one-shot, played in a window); no attachments or heroes
- Hook: the stat that decides a battle (G-Power) is not printed on the card at all — it's physically randomized by how the spring-loaded toy pops open when rolled onto the Gate's metal core
- Libraries sufficient: mostly; units + permanents + spells + responses.ResponseWindows cover the cards, but nothing models the randomized physical stat
- Missing rules: RandomizedUnitStat (a per-battle random roll that sets a unit's power, layered on top of Grant), GateTriggersBattle (two units landing on one permanent starts combat)
- Core gaps: none; the core's `die` RandomSource and `pick` operation can seed a randomized stat, so this is a framework-level rule, not a core change
- Fit: framework; everything but the toy's own random power roll fits current libraries, and that roll is expressible with the core's existing randomness primitive
- Confidence: medium; Bakugan Wiki and Fandom rules pages fetched; general childhood familiarity with the toy line
SUMMARY|Bakugan Trading Card Game|2|alternating|none|race|compare-stat|windows|row|framework|medium

## Kaijudo: Rise of the Duel Masters (2012, Wizards of the Coast) — dead
- Players: 2
- Turns: full; untap, draw, charge mana, cast spells/summon creatures, attack, end — then the other player's full turn
- Resources: cards; any card from hand can be placed face-down into the mana zone instead of being cast, then tapped later for its civilization
- Life: stack; 5 face-down shield cards from the deck, broken one at a time by unblocked attacks; attacking with no shields left wins
- Combat: defender-blocks; an untapped opposing creature may block an attacker, otherwise it hits a shield or the player directly
- Responses: windows; a broken shield with Shield Trigger may be cast for free that instant, otherwise play is sorcery-speed with no open priority
- Board: none; creatures enter a shared, uncapped, unordered battle zone
- Card kinds: units (creatures), spells (cast, then discarded); no attachments, permanents or heroes in the core rules
- Hook: any card, not a dedicated resource type, can be spent face-down as mana of its own civilization, and mixing civilizations in the mana zone is what lets a deck cast more than one color
- Libraries sufficient: yes; resources.CardsAsResources, life-stack.LifeStack, combat.DefenderBlocks and common.play-free (Shield Trigger) match its rules almost by name
- Missing rules: none
- Core gaps: none
- Fit: libraries; a near-exact match to libraries written with Duel Masters and its relatives in mind
- Confidence: high; this is Duel Masters under a new name (confirmed via Kaijudo Wiki), a system I know well
SUMMARY|Kaijudo: Rise of the Duel Masters|2|full|cards|stack|defender-blocks|windows|none|libraries|high

## Chaotic Trading Card Game (2007, 4Kids Entertainment) — dead
- Players: 2, each fielding an army of 1, 3, 6 or 10 creatures
- Turns: full; a player may move each creature once, then may initiate one battle by moving onto an opponent's space, before play passes
- Resources: growing; each creature slowly accumulates its own Mugic counters over the game, later spent to cast that tribe's Mugic
- Life: other; there is no player life pool, only creatures leaving the board when defeated — the game ends when one side has none left
- Combat: other; the location card sets who strikes first, then both sides alternate playing drawn Attack Cards (plus Battlegear/Mugic bonuses) against the defender's remaining energy until one creature is defeated — not a single attacker/blocker exchange
- Responses: windows; Mugic can be cast at named points within a battle once a creature has enough counters
- Board: grid; creatures occupy fixed spaces in a triangular arena and must move onto an opponent's space to fight, so terrain gates who can battle whom
- Card kinds: units (creatures), attachments (Battlegear, one per creature), spells (Mugic), permanents (Locations, setting initiative and bonuses while in play); no heroes
- Hook: creatures physically move around a shared spatial board, and a battle is only possible between creatures whose positions collide
- Libraries sufficient: no; nothing models a unit moving between board positions to trigger combat, or a mutual multi-strike exchange instead of attacker/blocker roles
- Missing rules: Movement (relocating a unit within a board shape), AdjacencyTriggersBattle, MutualStrikeExchange (a CombatRule alternating strikes into a shared damage pool rather than attacker vs. defender)
- Core gaps: the `Shape` enum (pile, set, row, slot, slots, lanes, grid) has no notion of a unit's position moving turn over turn into adjacency with another unit; `position` is only an index in an ordered zone, not 2-D placement
- Fit: framework; the card records (units/attachments/spells/permanents) fit, but the movement-based board and mutual-strike combat need new rule types, which a library — not core — could add
- Confidence: medium; Chaotic Wiki rules page and Wikipedia fetched; general memory of the cartoon tie-in
SUMMARY|Chaotic Trading Card Game|2|full|growing|other|other|windows|grid|framework|medium

## Redakai: Conquer the Kairu (2011, Spin Master) — dead
- Players: 2
- Turns: full; a player draws one card and plays it immediately (a Monster onto their own Character, or an Attack onto the opponent's), then the turn passes
- Resources: other; players also track a pool of Kairu energy (starting amount plus cards drawn) that powers attacks, but the exact payment rule wasn't confirmed in the sources checked
- Life: other; each side controls up to 3 Character Cards, each with 3 colored Defense Zones and 3 Damage Zones; a character is defeated once its Damage Zones fill, and losing all 3 loses the game
- Combat: compare-stat; an Attack Card's Power is compared to the target Character's total Defense of matching color; if higher, it hits and physically stacks on the card, covering that defense for future attacks
- Responses: none; cards resolve as soon as drawn and played, no reaction step found
- Board: slots; each player's 3 Character Cards are fixed slots, each itself holding up to 3 Defense Zones
- Card kinds: units (Character Cards), attachments (Attack and Monster cards, which stack onto and modify a character); no spells, permanents or heroes as separate kinds
- Hook: the game's semi-transparent, "3D" Attack Cards physically overlap a Character Card to cover specific printed Defense Zones, so what an attack can still hit depends on what's already stacked on top
- Libraries sufficient: mostly; objects.stack-onto and attachments give a unit-with-things-stacked-on-it model, but nothing represents a stacked object selectively masking one named field of its host
- Missing rules: CoversField (an attached/stacked object hides or zeroes one specific stat zone of its host, rather than granting a flat modifier), PerUnitZoneHealth (3 independently-filled damage zones per unit)
- Core gaps: none clearly forced; `attach`/`stack-under` plus a new static rule can likely express "covers a zone" without touching core
- Fit: framework; a genuine stacking/covering resolution the libraries don't yet name, but nothing here looks like it needs the core to change
- Confidence: low; only fan-wiki summaries were reachable (no full rulebook text), and the energy-payment specifics could not be confirmed
SUMMARY|Redakai: Conquer the Kairu|2|full|other|other|compare-stat|none|slots|framework|low

## Lightseekers Trading Card Game (2017, PlayFusion) — dead
- Players: 2
- Turns: full; each player gets 2 actions per turn (play a card, activate an ability, or play a combo), and any unspent action instead draws a card
- Resources: none; there is no separate mana/energy pool — the 2-actions-per-turn budget is the only constraint on what a player can do
- Life: counter; reduce the opponent's Hero's health points to 0 to win
- Combat: attacker-chooses; the sources checked did not confirm whether the defender has any block option, so this is a best guess favoring the attacker
- Responses: none; no reaction/interrupt system was found, though "combo" cards that require several specific named cards played across turns do exist
- Board: row; best guess that Titan/creature-type cards, if they stay in play, sit in an uncapped shared zone — not confirmed
- Card kinds: heroes (the Champion); units are a plausible fit for any creature/Titan cards but unconfirmed; spells likely cover one-shot action cards
- Hook: a two-action economy where playing a card, using an ability, and assembling a multi-card combo all draw from the same small per-turn pool, and unused actions convert straight into card draw
- Libraries sufficient: unclear; heroes + units + spells look plausible, but a "combo" effect that fires only once several specific other named cards have been played this game has no obvious library match
- Missing rules: ComboRequiresNamedCards (a condition tracking that several specific other cards were played earlier in the game), ActionsPerTurn (turns.alex has Actions{allowed} and OncePerTurn, but no "n generic actions, each spendable on any action kind" rule)
- Core gaps: none identified from what's confirmed
- Fit: framework; low-confidence call given how much of the ruleset stayed unconfirmed
- Confidence: low; the official rules and comprehensive-rules PDFs were located but the rules page timed out on fetch, and this session's web-search budget ran out before a fallback source could be checked
SUMMARY|Lightseekers Trading Card Game|2|full|none|counter|attacker-chooses|none|row|framework|low

## Precious Memories TCG (2011, Kadokawa / Broccoli) — dead
- Players: 2
- Turns: full; Beginning (untap+draw), Main (play characters/events, activate abilities), Approach (attacks one at a time), End (hand capped at 7) phases each turn
- Resources: cards; a card's cost is paid by discarding hand cards (or flipping cards from the player's own point pile) that share its color or series
- Life: race; first to 7 points wins — points come from unblocked attacks, which flip the defender's top deck card face-up into the attacker's point pile; decking the opponent out also wins outright
- Combat: defender-blocks; the attacker sends one character to "approach," the defender may block with a single untapped character, and AP is compared to DP to see who's discarded
- Responses: none; no reaction windows or a stack were found — battles and effects resolve directly through the fixed phase order
- Board: slots; a 5-slot Main Area for characters with AP/DP that can fight, plus an unlimited Support Area for non-combat characters
- Card kinds: units (Main Area characters), permanents (Support Area characters/cards with no AP/DP that sit and sustain a static or on-enter effect)
- Hook: an unblocked attack doesn't damage the defender directly — it flips a card off the top of the defender's own deck into the attacker's point pile, so the win condition (7 points) and the alternate loss condition (deck-out) are drawn from the same resource
- Libraries sufficient: mostly; units + common.discard cover most of it, but scoring points by milling the opponent into the attacker's own pile isn't a named verb
- Missing rules: MillIntoAttackerPile (an unblocked attack moves the defender's top card into the attacker's own score zone, not a discard or the attacker's hand)
- Core gaps: none; `move` already supports moving an object to any zone at any position, so this is a framework-level verb
- Fit: framework; deck-out-as-scoring is a distinctive small mechanic outside the named verbs, everything else matches units/combat.DefenderBlocks/common
- Confidence: medium; a detailed fan-authored English rules page (prememo.blogspot.com) was fetched and reads as internally consistent, but is not an official rulebook
SUMMARY|Precious Memories TCG|2|full|cards|race|defender-blocks|none|slots|framework|medium

## Lycée Trading Card Game (2005, SilverBlitz) — live
- Players: 2
- Turns: full; a standard draw/main/battle/end shape is assumed by genre convention, but the exact phase names weren't confirmed in the sources checked
- Resources: pitch; playing a card costs discarding other cards from hand, matched by element (an elementless card can only pay for another elementless card; any element can pay an elementless cost)
- Life: stack; each player's 60-card deck is their own life total, and driving it to zero (mainly by attacking) is the primary win condition
- Combat: attacker-chooses; characters attack to reduce the opponent's deck, but whether defenders can block, and how the five elements (snow, moon, flower, void, sun) interact, could not be confirmed
- Responses: none; no evidence of a stack or reaction window turned up in the sources checked
- Board: row; character, item and area cards are described as sitting in play with no stated shape limit
- Card kinds: units (characters), spells (events), attachments (items, presumably attaching to a character), permanents (areas, presumably persistent field effects); no heroes confirmed
- Hook: any card in hand, regardless of element, can be discarded to pay for another card's cost — an "ink/pitch anything" resource system years before Force of Will or Lorcana
- Libraries sufficient: mostly, on what's confirmed; resources.PitchFromHand is a near-exact name match for the discard-to-pay mechanic
- Missing rules: none confirmed as missing; the elemental interactions (if any) need a real rulebook read before a firm call
- Core gaps: none identified
- Fit: framework; provisional, pending the elemental rock-paper-scissors rule the games.md hook implies but the sources did not confirm
- Confidence: low; only summary pages (Wikipedia, gambiter.com, TV Tropes) were reachable — the candidate rulebook site (lycee-tcg.eu/rules) returned no usable rules text, and the session's web-search budget ran out before a fuller source could be found
SUMMARY|Lycée Trading Card Game|2|full|pitch|stack|attacker-chooses|none|row|framework|low

## Shadowverse: Evolve (2020, Bushiroad) — live
- Players: 2
- Turns: full; the start phase raises max PP, stands (untaps) cards and draws one, then the active player plays followers/spells/amulets before passing
- Resources: growing; PP (Play Points) is a per-turn counter that increases by 1 each turn up to a cap of 10, mana-crystal style
- Life: counter; reduce the opponent's Defense (life) to 0
- Combat: defender-blocks; Ward followers force an attack to target them first, otherwise the attacker picks any engaged (untapped) target
- Responses: windows; a small set of instant-speed spells can be played in reaction, closer to Hearthstone's simple sequencing than a full stack
- Board: row; followers sit in an unordered but capacity-limited field per side
- Card kinds: units (followers, which can be exchanged for an Evolved version from a separate Evolve deck), spells, permanents (amulets)
- Hook: a follower already in play can be "Evolved" by paying PP (or an Evolution Point) to swap it for a stronger printed version from a dedicated Evolve deck — a physical-card version of the original digital game's one-time mid-match buff
- Libraries sufficient: mostly; units, spells, permanents (amulets) and combat.DefenderBlocks-with-Guardian(Ward) cover the base game cleanly
- Missing rules: EvolveSwap (replace an in-play unit with a different, stronger printed card from a separate deck while preserving its counters/attachments) — closest existing rule is objects.StackPreservesState, which stacks a card on top rather than swapping the object's identity
- Core gaps: none; a library could add an operation-level "replace this object's card, preserve its state" verb without changing core
- Fit: framework; Evolve's card-swap is the one named thing missing from the libraries, everything else is a clean fit
- Confidence: high; the official English rules page and comprehensive rules PDF were fetched and are consistent with the base digital game Shadowverse
SUMMARY|Shadowverse: Evolve|2|full|growing|counter|defender-blocks|windows|row|framework|high

## Naruto Collectible Card Game (2006, Bandai) — dead
- Players: 2
- Turns: full; a Turn Marker rises each turn, gating which Ninja (by Entrance cost) may be deployed, followed by a Mission Phase, an Exchange-of-Jutsu step, then combat
- Resources: cards; a Ninja's Hand cost is paid by discarding matching-element cards from hand face-up into the Chakra area, which either player may inspect at any time
- Life: race; first to 10 Battle Rewards (cards taken off the top of the opponent's deck when a Team's attack goes unblocked) wins; decking the opponent out also wins
- Combat: attacker-chooses; the Attacker sends up to 3 Teams (a Head Ninja plus supporting Back Ninja), the Blocker sends at most as many Teams to oppose them, and Team Power (Head's Combat + Back Ninjas' Support) decides the damage split
- Responses: chain; Jutsu cards played during the Exchange step build a chain that resolves last-in-first-out
- Board: lanes; up to 3 simultaneous Team match-ups per combat, each its own head-plus-support lane
- Card kinds: units (Ninja, in Head/Back roles), spells (Jutsu, Mission and Client cards played from hand for an effect); no attachments, permanents or heroes as separate kinds
- Hook: the resource pool (Chakra) is entirely public — built from cards spent from hand into a zone either player can inspect — so both sides always know exactly what the other can afford to cast
- Libraries sufficient: mostly; common.discard, responses.Chain and combat's target types cover most of it, but the Head/Back "team" grouping and its margin-based damage split has no library match
- Missing rules: TeamCombat (grouping several units into one attacking/blocking unit whose combined stat is compared, with damage split by the margin), PublicResourceZone (a resources policy stating the pool is visible to all)
- Core gaps: none; `active-rules`/`Filter` plus a new CombatRule subtype can express team grouping without a core change
- Fit: framework; team combat is a genuine gap in combat.alex (every current CombatRule assumes one attacker vs. one blocker/target), everything else maps cleanly
- Confidence: medium; a detailed third-party rules write-up (gamertagmythras.com) was fetched and reads as internally consistent, but is not the official rulebook
SUMMARY|Naruto Collectible Card Game|2|full|cards|race|attacker-chooses|chain|lanes|framework|medium

## Dragon Ball Z Collectible Card Game (2000, Score Entertainment) — dead
- Players: 2
- Turns: full; a draw/main/combat/end shape typical of the era is assumed, but the exact step names weren't confirmed in the sources checked
- Resources: growing; Power Stage cards set a level that gates which cards (by printed power level) a Personality may use, alongside an Anger mechanic that builds toward bonus effects
- Life: stack; the Life Deck doubles as the draw deck, and taking damage discards cards off its top — running out of Life Deck loses the game
- Combat: attacker-chooses; Physical Combat and Energy Combat cards are played to attack, opposed by the target's Endurance rating, with drama/non-combat cards affecting the fight
- Responses: none; nothing in the sources checked confirmed a reaction window or stack
- Board: none; the sources checked describe card types and stats but no zone-shape limits
- Card kinds: units are the closest fit for Personality cards (they anchor the board and take/deal damage); spells for Physical/Energy Combat and drama/non-combat cards; permanents, attachments and heroes not clearly present
- Hook: a player's own draw deck is also their life total, so every attack taken thins the very deck being drawn from, tying resource depletion and life loss into one pile
- Libraries sufficient: unclear; life-stack.LifeStack/LoseWhenEmpty and units/spells look like the right shapes, but the Power Level gating and Anger mechanic aren't confirmed well enough to name real gaps
- Missing rules: PowerLevelGate (a card only usable once its Personality's Power Stage reaches a printed level), if the mechanic is as remembered
- Core gaps: none identified
- Fit: framework; provisional pending a real rulebook read
- Confidence: low; Wikipedia was fetched but focuses on card types/history, not rules; the Dragon Ball Fandom wiki and a dedicated retro-rules site (retrodbzccg.com) were unreachable (paywall/certificate errors), so this leans on general memory of the game plus the games.md hook
SUMMARY|Dragon Ball Z Collectible Card Game|2|full|growing|stack|attacker-chooses|none|none|framework|low
