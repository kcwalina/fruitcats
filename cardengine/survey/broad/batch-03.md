# Broad survey batch 03: X-Men TCG, Star Wars TCG (2002), Harry Potter TCG, World of Warcraft TCG, Buffy CCG, LotR TCG (Decipher), WWE Raw Deal, Marvel OverPower, VS System, Dice Masters

## X-Men Trading Card Game (1996, Fleer/SkyBox International) — dead
- Players: 2
- Turns: full; a turn raises the shared danger-room level gate, then lets the active player build/play cards and launch mission attacks before passing.
- Resources: growing; the danger-room level is a shared counter that rises each turn and gates which (higher-power) cards may be played — it is never spent.
- Life: other; no single life total — each side's team of 2-5 characters carries its own hit points, and a side loses when two of the opponent's chosen characters (or the whole roster) are knocked out.
- Combat: attacker-chooses; a Mission card names an opposing character to attack, and dice are rolled to determine damage dealt and which powers trigger.
- Responses: windows; Lightning and Power-up cards are played as immediate reactions to a declared attack.
- Board: slots; each side's team occupies a fixed roster of chosen-character slots, with no other play zones described.
- Card kinds: units (characters with power/hit points), spells (mission/momentum attack cards, one-shot); no clean fit for the danger-room level gate or for dice-triggered "mutant power" text.
- Hook: a single shared danger-room-level counter gates which cards either side may play, rather than each side managing its own resource.
- Libraries sufficient: mostly; units and common cover characters and mission-as-spell reasonably.
- Missing rules: DiceTriggeredEffect (power triggers keyed to a die roll), DangerRoomLevelGate, TeamKO win condition (two-of-N characters).
- Core gaps: none; a shared gating counter and roll-driven effect resolution both fit the existing counter/random primitives.
- Fit: framework; needs new gating and dice-effect rules, no core change.
- Confidence: low; sources conflict on year/publisher for this exact title (a year-2000 Wizards of the Coast game matches the mechanics found), and no rulebook was read, only summaries.
SUMMARY|X-Men Trading Card Game|2|full|growing|other|attacker-chooses|windows|slots|framework|low

## Star Wars Trading Card Game (2002, Wizards of the Coast) — dead
- Players: 2
- Turns: full; a construction phase deploys units into arenas, then units act before passing the turn.
- Resources: resource-cards; dedicated Resource cards generate Force points spent to build/deploy units and pay activated costs.
- Life: other; no life total — a player wins by controlling two of the three arenas (Space, Ground, Character), or via an alternate win condition printed on a card.
- Combat: lanes; the three arenas are separate battle lanes, each contested independently by the units built into it.
- Responses: windows; Battle cards are played during combat as one-shot tactical boosts.
- Board: lanes; three parallel arenas, each holding units, equipment and a location.
- Card kinds: units (arena units with build cost/speed/power/health), spells (Battle cards), permanents (Location cards), attachments (Equipment cards); Mission cards (built once, ongoing) fit permanents loosely.
- Hook: winning is about seizing arenas, not depleting an opponent's life or deck.
- Libraries sufficient: mostly; combat's Lanes rule and units/attachments/permanents cover units, equipment and locations cleanly.
- Missing rules: ArenaControlWin (own 2 of 3 lanes to win), a Mission-card record distinct from spells/permanents.
- Core gaps: none; arena control is exactly what provide-game-over is for.
- Fit: framework; the win condition and mission-card record are new, nothing else is.
- Confidence: medium; drawn from Wikipedia and fan-wiki summaries, no full rulebook read.
SUMMARY|Star Wars Trading Card Game (2002)|2|full|resource-cards|other|lanes|windows|lanes|framework|medium

## Harry Potter Trading Card Game (2001, Wizards of the Coast) — dead
- Players: 2
- Turns: full; draw, play lesson/creature/spell cards, then pass.
- Resources: resource-cards; Lesson cards of specific shapes/colors must be assembled in play to meet a spell's printed requirement before it can be cast.
- Life: stack; a player's own library doubles as their life — spells and creatures force the opponent to discard cards off the top of their deck, and drawing from an empty deck loses.
- Combat: other; there is no unit-vs-unit stat fight — creatures and spells act directly on the opponent, mostly by forcing top-of-deck discards.
- Responses: none; play appears to proceed without a formal response window (thin sourcing).
- Board: slots; lessons and creatures each occupy their own in-play area.
- Card kinds: spells (Spell cards), units (Creature cards); Lesson cards match no existing record (a resource card with a shape/color that must combine with others to "solve" a spell's requirement).
- Hook: casting a spell is solving a small shape/color puzzle out of the Lesson cards you have in play, not paying a flat cost.
- Libraries sufficient: mostly; life-stack's LoseOnEmptyDraw fits the deck-as-life mechanic exactly.
- Missing rules: ShapePuzzleCost (a Lesson-combination requirement in place of a flat Cost), a Lesson card record.
- Core gaps: none apparent; the puzzle requirement is a new cost-checking rule, not a new object-model concept.
- Fit: framework; the puzzle cost and Lesson record are new, everything else maps to common/life-stack/units/spells.
- Confidence: medium; based on Wikipedia and fan-wiki summaries, no rulebook read.
SUMMARY|Harry Potter Trading Card Game|2|full|resource-cards|stack|other|none|slots|framework|medium

## World of Warcraft Trading Card Game (2006, Upper Deck Entertainment) — dead
- Players: 2
- Turns: full; resource, draw, main, combat and end phases each turn, Magic-like.
- Resources: resource-cards; once per turn a player may play any card from hand face down as a resource to pay for allies and hero powers.
- Life: counter; each hero has a health total, reduced by combat damage, that ends the game at zero.
- Combat: defender-blocks; an attacker targets a specific hero or ally, and the defending player may block with a ready ally.
- Responses: windows; instants and abilities are playable at specific defined points rather than a fully open stack.
- Board: row; each player's allies sit in a party row alongside their hero.
- Card kinds: units (allies), heroes (the Hero card, one face, fixed starting health), attachments (equipment/items), permanents (quests, locations); no clean fit for a quest's multi-step objective tracking.
- Hook: a faction-locked hero fixes which allies a deck may run (Horde/Alliance/neutral), like a commander-style identity restriction.
- Libraries sufficient: mostly; heroes, units, attachments, combat and resources all map cleanly.
- Missing rules: PowerOncePerGame (the hero power is once per game, unlike heroes.alex's PowerOncePerRound), a Quest record with step tracking, FactionLock deck rule.
- Core gaps: none; all of the above are new rule/record types over existing areas.
- Fit: framework; a strong match to units/heroes/combat/resources with a few new rule types.
- Confidence: high; corroborated by Wikipedia, BoardGameGeek and the official rulebook link.
SUMMARY|World of Warcraft Trading Card Game|2|full|resource-cards|counter|defender-blocks|windows|row|framework|high

## Buffy the Vampire Slayer CCG (2001, Score Entertainment) — dead
- Players: asym; a Hero & Companion deck (attempting good Challenges) faces a Villain & Minion deck (attempting evil Challenges), each built under different deck rules.
- Turns: full; each side takes a full turn moving characters between locations and attempting challenges.
- Resources: none; cards appear to be played directly from hand, with deck-composition limits (7 Challenges, 4-8 Locations, a half-deck cap on actions/characters) standing in for a cost curve.
- Life: race; the first side to 10 Destiny Points (earned by winning fights and completing challenges) wins outright.
- Combat: other; fights are resolved between assigned characters at a location using Skill/Item bonuses, not a unit-stat block system.
- Responses: windows; Skills & Items are added during a fight or challenge resolution.
- Board: grid; two linked playmats of named Sunnydale locations with a shared central Park contested by both sides.
- Card kinds: units (characters, both Hero/Companion and Villain/Minion), attachments (Skills & Items); Location and Challenge cards fit no existing kind cleanly.
- Hook: winning is a race between an escalating Destiny-point score and a location-control clock (holding the shared Park for 6 turns).
- Libraries sufficient: mostly; a WinAtCounter-style race and a shared contested zone are within reach of life and turns.
- Missing rules: SharedLocationControl (own a zone n turns straight to win), Location/Challenge card records.
- Core gaps: none identified from available sourcing.
- Fit: framework; needs new location-control and challenge records, no core change apparent.
- Confidence: low; assembled from Wikipedia and fan summaries only; the resource system and exact fight resolution were not confirmed against a rulebook.
SUMMARY|Buffy the Vampire Slayer CCG|asym|full|none|race|other|windows|grid|framework|low

## The Lord of the Rings Trading Card Game (2001, Decipher) — dead
- Players: asym; whoever's turn it is plays the Free Peoples side advancing the Fellowship, while every other player plays Shadow cards against them — one seat can hold both card pools and switch roles by whose turn it is.
- Turns: other; the acting player is Free Peoples this turn and everyone else is Shadow, so which rule set a seat plays under changes turn to turn.
- Resources: other; a single shared "twilight pool" counter is pushed up by the Free Peoples player's costs and drawn down by Shadow's costs — an adversarial shared resource, not a per-player one.
- Life: race; Free Peoples wins by advancing the Fellowship down a fixed 9-site path to the last site; Shadow wins by killing or corrupting the ring-bearer or halting the Fellowship first.
- Combat: defender-blocks; Shadow characters may be assigned to skirmish Free Peoples characters at the current site, comparing strength to vitality.
- Responses: windows; Event cards are played at defined response points around a skirmish or site phase.
- Board: row; a single ordered track of 9 sites the Fellowship advances along, each also holding characters in play.
- Card kinds: units (Companion/Minion characters), spells (Event cards), attachments (Possession/item cards); the Site itself (a progress-track record with per-site effects) fits no existing kind.
- Hook: one shared counter (the twilight pool) is both sides' resource, and a single seat alternates between two entirely different rulebooks depending on whose turn it is.
- Libraries sufficient: no; the turn-role swap and the adversarial shared resource are both outside what any current library assumes (each expects a resource and a rule set that belong to one fixed player).
- Missing rules: SharedAdversarialResource (a resources.alex variant), SitePath (a race-style progress record), RoleSwapsByTurn (a turns.alex variant).
- Core gaps: possibly; a resource or rule set keyed to "whoever's turn it is" rather than to a fixed player may need core support if no combination of hooks (provide-actor, filter-rules) already expresses it.
- Fit: framework; borderline core only for the turn-keyed role swap, everything else is new framework rules.
- Confidence: medium; based on Wikipedia, Tolkien Gateway and fan-wiki summaries, no rulebook read in full.
SUMMARY|The Lord of the Rings Trading Card Game|asym|other|other|race|defender-blocks|windows|row|framework|medium

## WWE Raw Deal (2000, Comic Images) — dead
- Players: 2
- Turns: full; a Main segment where the active player plays one Maneuver or Action, plus other fixed steps.
- Resources: other; a player's Fortitude Rating equals the total Damage cards accumulated in their own Ring area and gates which cards they may play (by printed Fortitude value) — it is checked, never spent.
- Life: race; there is no life total — a player wins by pinning or submitting the opponent's Superstar once game-specific conditions (often built on accumulated Damage) are met.
- Combat: other; each player is a single Superstar, and playing a Maneuver targets the opponent's Superstar directly, who may negate it with a Reversal from hand or by "overturning" one while taking damage.
- Responses: windows; Reversals are played on the opponent's turn in direct reaction to a Maneuver or Action.
- Board: none; play is limited to hand, deck (Arsenal) and the face-up Ring pile of played Damage cards, with no unit board.
- Card kinds: heroes (the single always-in-play Superstar card); Maneuver/Reversal/Action cards act like one-shot spells but also feed the player's own resource pile, a double duty no existing record captures.
- Hook: the same pile of cards you've taken damage from is also the resource that lets you play bigger cards — victim and economy are the same zone.
- Libraries sufficient: no; no library models a zone that is simultaneously a damage/life record and a resource generator.
- Missing rules: DamageAsResource (a combined life+resource rule), Reversal-as-negate-verb, PinSubmission win condition.
- Core gaps: none; the double-duty zone is one zone read by two different rule areas, which the core already allows.
- Fit: framework; the resource/life fusion and pin win condition are new rule types over an otherwise ordinary two-zone duel.
- Confidence: medium; based on an archived rulebook and FAQ summaries, not a full rules read.
SUMMARY|WWE Raw Deal|2|full|other|race|other|windows|none|framework|medium

## Marvel OverPower (1995 / 2024 relaunch, Fleer / Marvel Interactive) — live
- Players: 2
- Turns: alternating; each turn is exactly one action (attack, play a card, or pass), strictly alternating between players.
- Resources: none; Power, Universe, Tactic and Special cards are played straight from hand with no separate cost resource.
- Life: counter; each character is knocked out after a fixed number of unblocked hits (a small hit counter, not a numeric health pool); the game also ends by completing a 7-card Mission or KO'ing the whole opposing team.
- Combat: compare-stat; the attacker plays a Power card (plus an optional Universe bonus) against a target, and the defender may block with a Power/Tactic/Special card of equal or higher value to cancel the hit.
- Responses: windows; the defender gets one immediate Defensive Action after an attack is declared.
- Board: slots; each side fields a small roster of characters (plus a shared Battlesite that can itself be attacked).
- Card kinds: units (characters as hit-counter targets); Power/Universe/Tactic/Special cards act as raw combat-value cards played from hand rather than persistent units, spells or attachments, and fit no existing record cleanly.
- Hook: combat is a duel of raw value cards played live from hand each time, not a comparison of a unit's own fixed printed stats.
- Libraries sufficient: no; nothing in units/spells models an attack resolved by comparing two ad-hoc hand cards' values rather than a card's own printed power/health.
- Missing rules: CompareCardValue (dynamic per-play value duel), HitCounterKO, MissionCompletionWin, multi-attack Teamwork/Tactic verbs.
- Core gaps: none; a per-play value comparison is an ordinary verb/effect over the existing operations.
- Fit: framework; the value-duel combat model is new, but expressible without touching core.
- Confidence: medium; drawn from the game's own published rules page.
SUMMARY|Marvel OverPower|2|alternating|none|counter|compare-stat|windows|slots|framework|medium

## VS System (2004, Upper Deck Entertainment) — dead
- Players: 2
- Turns: full; draw, resource, main, attack and recovery phases each turn.
- Resources: cards; each turn a player may play one card face down from hand as a resource point.
- Life: counter; each player has an Endurance total reduced by unblocked damage, ending the game at zero.
- Combat: defender-blocks; Front Row characters attack (or Back Row with ranged/flying), and the defender may block with a ready character before damage and stun are applied.
- Responses: stack; Plot Twist cards can be played in response to nearly anything, resolving in a last-in-first-out chain.
- Board: row; each player has a Front Row and Back Row of character slots plus a Location slot.
- Card kinds: units (characters, with stunned/ready states), spells (Plot Twist cards), attachments (Equipment), permanents (Locations).
- Hook: a character's row (front for melee, back for ranged/flying) decides who it can fight and be fought by, on top of the usual block decision.
- Libraries sufficient: mostly; units, combat, spells, attachments and permanents cover nearly everything.
- Missing rules: RowRestrictedTargeting (front/back row eligibility for melee vs. ranged/flying), a Stun state distinct from exhausted (can't ready next turn either).
- Core gaps: none; row eligibility is a targeting filter, and Stun is one more named object state.
- Fit: framework; a close match overall, with a couple of new combat-targeting and state rules.
- Confidence: medium; based on Wikipedia, fan-wiki and archived comprehensive-rules summaries, not a full rules read.
SUMMARY|VS System|2|full|cards|counter|defender-blocks|stack|row|framework|medium

## Dice Masters (2014, WizKids) — dead
- Players: 2
- Turns: full; Roll, Main (buy dice, field characters, attack) and End phases each turn.
- Resources: other; each turn's already-rolled dice (in the Reserve Pool) are re-rolled fresh for energy symbols spent that same turn, never banked, and dice themselves are also the units — bought into a bag, then drawn at random to be fielded.
- Life: counter; each player has Life points, reduced by unblocked attacks, ending the game at zero.
- Combat: defender-blocks; an attacking character targets the opponent directly unless blocked by a fielded character the defender chooses.
- Responses: windows; Action cards and abilities have defined usable moments rather than a fully open stack (best available reading; sourced from a general rules overview, not the comprehensive rules).
- Board: slots; a Field with a fixed number of character slots per player.
- Card kinds: units (characters, as dice with cost/power/abilities on a reference card); Basic Action cards fit spells; the dice themselves, a shared purchasable pool players buy into their own bag from, and a bag as a random-draw zone match no existing record or zone shape.
- Hook: a character's card is only a reference sheet — the actual object in play is a physical die randomly drawn from your own bag and rolled for its face each time it matters.
- Libraries sufficient: no; there is no library concept of a shared market players buy components into, nor of an object whose relevant stats are re-randomized by a roll each time it is used.
- Missing rules: SharedMarketPurchase, BagZone (random draw, not sequential), RerollForFace (a unit's printed side determined at read-time by a roll).
- Core gaps: possibly; core already anticipates `die` as a RandomSource and a per-object `face`, but a zone shaped as a random-draw bag and a shared cross-player purchase pool may need new Shape/zone or query support beyond what a library alone can add.
- Fit: framework; core's die/face primitives cover the randomness, but the market and bag mechanics need new framework support, verging on a Shape addition.
- Confidence: medium; based on the official rules overview and comprehensive-rules index, not a full read of the comprehensive rules.
SUMMARY|Dice Masters|2|full|other|counter|defender-blocks|windows|slots|framework|medium
