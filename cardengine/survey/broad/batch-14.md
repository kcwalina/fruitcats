# Broad survey batch 14: Yu-Gi-Oh! Rush Duel, Vs System 2PCG, Codex, Warhammer Underworlds, Sailor Moon CCG, Death Note TCG, Hearthstone, Legends of Runeterra, Marvel Snap, Gwent

## Yu-Gi-Oh! Rush Duel (2020, Konami) — live
- Players: 2
- Turns: full; each player takes a whole turn (Draw, Standby, Main, Battle, End) before passing
- Resources: none; cards are free to Normal Summon, higher-Level monsters cost a tribute of your own board instead of a resource pool
- Life: counter; Life Points reduced by unblocked attacks and effects, game ends at 0
- Combat: attacker-chooses; attacker targets an opponent's monster or, if none, the player directly; no blocking step, only Attack/Defense position set beforehand
- Responses: windows; Traps and effects fire on a fixed triggering action but are never chained to one another — only one effect ever resolves at a time
- Board: slots; 5 Monster Zones and 5 Spell/Trap Zones per player, each a single-card slot
- Card kinds: units (Monsters), spells (Spell cards), permanents (Field/Continuous Spells and Traps), attachments (Equip Spells); no clean fit for a Maximum Monster (three cards fused into one object)
- Hook: unlimited Normal Summons per turn plus removing the chain/stack system entirely (only one effect ever resolves) strip out the two mechanics that make classic Yu-Gi-Oh dense, aiming at a beginner audience
- Libraries sufficient: mostly; units, common, spells, attachments and decks cover most of the pool as-is
- Missing rules: dual ATK/DEF stat on UnitCard (health is one stat, not a separate unused Defense), TributeSummon (sacrifice own units as a summon cost), ExtraDraw-to-hand-size step, OneEffectAtATime scheduling rule
- Core gaps: multi-record cards (Maximum Summon fuses three separate Monster cards into one object with one shared Attack stat)
- Fit: framework; a simplified Yu-Gi-Oh mostly reuses the existing units/spells/combat shape, no core primitive is missing outright
- Confidence: medium; rulebook and wiki summaries fetched, not played personally
SUMMARY|Yu-Gi-Oh! Rush Duel|2|full|none|counter|attacker-chooses|windows|slots|framework|medium

## Vs System 2PCG (2014, Upper Deck Entertainment) — dead
- Players: 2
- Turns: full; Build (play a resource, recruit, rearrange formation), Attack, Recovery, End, alternating whole turns
- Resources: cards; any card in hand may be played face down as a resource for its printed value, a Location may be played face up for the same effect — a direct match to CardsAsResources
- Life: counter; the game ends the instant a player's Main Character is KO'd by damage (wounds against its own Health), not a separate shared life pool
- Combat: attacker-chooses; a Front-row character must be attacked before any Back-row character is legal, solo or as a multi-attacker Team Attack
- Responses: stack; Plot Twist cards can be played at essentially any legal moment by either player, closer to open instant-speed play than a fixed window
- Board: row; each side arranges characters into a Front row and a Back row that determines who can legally be attacked
- Card kinds: units (Characters), spells (Plot Twists), permanents (Locations, matching PermanentCard's `shared` single-in-play field); heroes fits the Main Character loosely via HeroCard.life
- Hook: the whole game turns on one Main Character's Health — everything else exists only to protect it or attack the opponent's, and the moment it is KO'd the game ends outright
- Libraries sufficient: mostly; common, units, spells, permanents and resources (CardsAsResources) cover the bulk of the pool
- Missing rules: front/back positional protection (positional, not keyword-based, so not GuardiansFirst as written), Team Attack (combat.alex's `attack` event carries one `attacker: unit`, not several), stun-vs-wound as two distinct combat outcomes
- Core gaps: none identified; a multi-attacker event is an open library extension, not a core change
- Fit: framework; needs several new combat and event shapes but nothing the core's object model rules out
- Confidence: medium; compiled rulebook fetched and summarized, not played
SUMMARY|Vs System 2PCG|2|full|cards|counter|attacker-chooses|stack|row|framework|medium

## Codex: Card-Time Strategy (2016, Sirlin Games) — live
- Players: 2
- Turns: full; Ready, Upkeep, Main, Discard/Draw, Tech, alternating whole turns
- Resources: resource-cards; Worker cards played from hand generate gold every turn thereafter, like a dedicated resource card rather than an automatic rising counter
- Life: counter; each player's base (Fort) has Health, reduced to 0 ends the game
- Combat: lanes; three lanes connect the two bases, units advance and fight down a lane — a direct match to the `Lanes` CombatRule
- Responses: windows; cards with Channel let their ability be paid for and used at any time, most other spells are sorcery-speed only on your own turn
- Board: lanes; three parallel lanes plus each player's own Patrol Zone of pre-assigned defenders
- Card kinds: units, spells, heroes (level up via XP through 3+ discrete levels rather than HeroCard's two faces), permanents (Tech buildings); a Patrol Zone slot's own passive bonus (draw a card, gain gold, grant resist) fits no existing record
- Hook: cards double as Workers committed to your economy, so a deck grows and a build order unfolds during the game itself, the way a real-time-strategy match's economy does, all resolved across three attackable lanes
- Libraries sufficient: mostly; combat's Lanes rule, units, spells, heroes and permanents cover most of the shape
- Missing rules: multi-level Hero (an XP counter driving 3+ discrete faces), a slot-granted static bonus for the Patrol Zone, pre-declared blockers per lane (close to DefenderBlocks but assigned at the end of the prior turn)
- Core gaps: none identified; zone-position-conditional statics are answerable through the existing active-rules/provide-rules hooks
- Fit: framework; the signature Lanes/patrol shape already has a home in the combat library
- Confidence: medium; design articles and BGG rules summaries used, not played
SUMMARY|Codex: Card-Time Strategy|2|full|resource-cards|counter|lanes|windows|lanes|framework|medium

## Warhammer Underworlds (2017, Games Workshop) — live
- Players: 2
- Turns: alternating; players alternate single fighter activations until all have acted, then alternate playing Power cards in a Power Step
- Resources: other; Glory Tokens earned from kills and objectives fund Power cards, there is no mana-like pool spent to play from hand
- Life: other; no life pool at all — three fixed rounds are played and whoever holds the most Glory Tokens at the end wins
- Combat: other; attacker and defender each roll a dice pool (with support/positioning modifiers) and count successes, not a stat comparison or a block declaration
- Responses: windows; Ploys and Upgrades are played during the alternating Power Step that follows each fighter's action
- Board: grid; fighters occupy real positions on a hex-tiled map, with movement, range and line-of-sight all mattering
- Card kinds: attachments (Upgrades, reasonably), spells (Ploys, one-shot); Fighter cards (physical miniatures with a profile) and Objective cards (scoring conditions) fit no existing record
- Hook: fighters are physical miniatures on a hex board fighting with contested attack/defense dice pools; the card layer of Objectives, Ploys and Upgrades only decides how Glory Tokens are scored on top of that skirmish
- Libraries sufficient: no; only the Power/Objective card layer resembles the framework's cards at all
- Missing rules: n/a — the fighter/board layer this game is built on is not a card-vs-card rules problem
- Core gaps: physical board position, movement, range and line-of-sight, and dice-pool contested combat have no counterpart in the core's zone/object model
- Fit: out; the central mechanic is a physical miniatures skirmish, and the card layer is a scoring add-on rather than the game itself
- Confidence: medium; rules guides fetched and summarized, not played
SUMMARY|Warhammer Underworlds|2|alternating|other|other|other|windows|grid|out|medium

## Sailor Moon Collectible Card Game (2000, Dart Flipcards) — dead
- Players: 2
- Turns: full; draw, play cards, attack (exact phase breakdown unconfirmed)
- Resources: resource-cards; Body/Mind/Soul Power cards attach to a Scout or villain and fuel its attacks, similar to attached energy
- Life: race; a player wins by accumulating monsters/villains worth a target number of Victory Points, with eliminating all of an opponent's Scouts as an alternate loss condition
- Combat: attacker-chooses; Scouts and monsters/villains attack each other directly, and several Scouts may combine into a Team Attack pending a random (coin-flip/rock-paper-scissors) success check
- Responses: other; unknown — no description of interrupt or instant-speed timing was found
- Board: slots; each player fields a small number of active Scout and monster/villain slots
- Card kinds: units (Scouts and Monsters/Villains, leveling up by playing a higher-level card on top, similar to Pokémon evolution), attachments (Power cards), permanents (People cards, persistent ongoing effects), spells (Events/Items, one-shot)
- Hook: Scouts and their foes level up by playing a higher-level card on top of the current one, echoing Pokémon's evolution, while whole teams can combine into a single higher-damage Team Attack
- Libraries sufficient: mostly; units, objects (StackPreservesState for evolution), permanents and resources (as attached Power) cover the described shape
- Missing rules: the Victory-Point race already matches `WinAtCounter` cleanly; Team Attack's random success contest (a coin-flip layered onto a multi-attacker combat action) is not modeled; three separately-typed attached resources (Body/Mind/Soul) needs three ResourceCards entries
- Core gaps: none identified
- Fit: framework; the evolution and VP-race shapes both already exist in the catalogue
- Confidence: low; assembled from wiki and secondary summaries only, no rulebook read in full, several mechanics (turn phases, response timing) unconfirmed
SUMMARY|Sailor Moon Collectible Card Game|2|full|resource-cards|race|attacker-chooses|other|slots|framework|low

## Death Note Trading Card Game (2008, Konami) — dead
- Players: asym; the source's own hook (one side plays Light/Kira, the other L) implies the two sides use different rules, unconfirmed in detail
- Turns: other; unknown — no English-language rulebook or rules summary was found for this Japan-exclusive release
- Resources: other; unknown, same reason
- Life: other; unknown, same reason
- Combat: other; unknown, same reason
- Responses: other; unknown, same reason
- Board: other; unknown, same reason
- Card kinds: unknown; likely unit- and spell/trap-like cards by genre convention, unconfirmed
- Hook: an asymmetric hidden-identity duel, one side playing as Kira and the other as L, per the source's own description; no further structural detail could be established
- Libraries sufficient: no; too little is confirmed to say which libraries would apply
- Missing rules: unknown
- Core gaps: other: no English rules text for this game could be found; the record above is a placeholder pending a source
- Fit: framework; a generic guess only, since it is a standard head-to-head TCG by name — not confirmed by any rules text
- Confidence: low; only secondary marketplace/wiki listings were found, none describing actual play; every field above beyond the name/players is unverified
SUMMARY|Death Note Trading Card Game|asym|other|other|other|other|other|other|framework|low

## Hearthstone (2014, Blizzard Entertainment) — digital-live
- Players: 2
- Turns: full; alternating whole turns, mana refills and a card draw open each one
- Resources: growing; Mana Crystals rise by 1 each turn to a cap of 10 and fully refill every turn
- Life: counter; 30 Health plus an Armor shield that absorbs damage first, game ends at 0
- Combat: attacker-chooses; a Taunt minion must be attacked before any other, no blocking step
- Responses: none; Secrets are hidden, self-consuming triggers that fire unconditionally on a matching event, not a window their owner is offered a choice in
- Board: row; up to 7 minions per side
- Card kinds: units (Minions), spells (Spells, including hidden Secrets), attachments (Weapons — a poor fit, since a Weapon attaches to the Hero, not a unit, with its own power and a durability counter), heroes (Hero + Hero Power)
- Hook: a resource-gated Hero Power usable once a turn and hidden, self-firing Secrets are Hearthstone's two most distinctive mechanics, and neither is a card played by choice in a window
- Libraries sufficient: mostly; units, spells, life, resources and heroes cover most of the pool once the gaps below are filled
- Missing rules: a target type spanning Hero and Minion for damage/removal, hidden self-consuming triggers (Secrets) as their own kind, Weapon as its own card record, Discover (sample N from the printed pool, show one player, they keep one), asymmetric opening hands, a costed once-per-turn Hero Power on Face
- Core gaps: a target type spanning `unit | player` (a "character"), and a maximum-occupancy field on `Zone` (the 7-minion board cap)
- Fit: framework; consistent with the existing deep survey at survey/hearthstone.md
- Confidence: high; played, and backed by the deep survey already on file
SUMMARY|Hearthstone|2|full|growing|counter|attacker-chooses|none|row|framework|high

## Legends of Runeterra (2020, Riot Games) — digital-live
- Players: 2
- Turns: alternating; players alternate playing one card/skill or passing, priority keeps flipping until both pass in a row, then the stack resolves and the round advances
- Resources: growing; Mana rises by 1 each round to a cap of 10, with unused Mana banked as Spell Mana (up to 3) for later rounds — a wrinkle GrowingCounter doesn't model
- Life: counter; 20 Nexus Health per player, game ends at 0
- Combat: defender-blocks; the Attack Token holder declares attackers, the other player then assigns blockers
- Responses: stack; Burst/Fast-speed spells and abilities can be played in response any time either player has priority, Slow/Focus speed only with an empty stack
- Board: row; each side has its own row of units, paired up for combat when attackers and blockers are declared
- Card kinds: units (Champions and Followers, Champions leveling up via a static condition into a new form), spells (Burst/Fast/Slow speed), permanents (Landmarks); no attachments or a separate Hero record
- Hook: the Attack Token, not a shared clock, decides who may declare attacks each round, while either player can otherwise act almost any time via an open priority/stack system
- Libraries sufficient: mostly; units, spells, combat (defender-blocks), initiative (the Attack Token) and responses (Stack) cover most of the shape
- Missing rules: a three-tier spell-speed system layered onto Stack, banked/overflow Mana on GrowingCounter, a Champion level-up condition that swaps a UnitCard's own face/stats/keywords, a Landmark record distinct from PermanentCard
- Core gaps: none identified beyond what Stack/AlternatingPriority already cover
- Fit: framework; the Attack Token maps directly onto the initiative library
- Confidence: high; played, rules well documented by the publisher
SUMMARY|Legends of Runeterra|2|alternating|growing|counter|defender-blocks|stack|row|framework|high

## Marvel Snap (2022, Second Dinner / Nuverse) — digital-live
- Players: 2
- Turns: simultaneous; both players secretly choose their plays each turn and reveal together, for exactly 6 turns
- Resources: growing; Energy rises by 1 each turn to a cap of 6 and fully refills, never banked
- Life: other; no life pool — the match ends after turn 6 and whoever controls more total Power at 2 of 3 Locations wins
- Combat: compare-stat; cards never attack each other, Power totals at each Location are compared once at game end
- Responses: none; plays are simultaneous and secret, so there is no way to react to what the opponent just played within a turn
- Board: lanes; exactly 3 Locations, each an independent Power contest
- Card kinds: units (cards have Cost and Power but no Health/combat stat at all), permanents (Locations, each with a static or on-reveal effect shaping its lane); no spells (nothing resolves and leaves) or attachments
- Hook: both players commit their plays for the turn in secret and reveal simultaneously, and there is no combat at all — six turns in, the winner is decided purely by comparing Power totals at three Locations
- Libraries sufficient: mostly; common and units cover cost/power, and the core's own `require-actions` input already matches secret simultaneous submission
- Missing rules: a UnitCard variant with Power but no Health, a Location record with a lane-wide static/reveal ability, a per-lane Power-comparison verb, the Snap/cube-wagering stakes mechanic (raising the round's stakes mid-game), which has no analog in the catalogue
- Core gaps: a UnitCard subtype cannot drop the inherited, required `health` field — the same "required field a subtype can't shed" gap the deep Yu-Gi-Oh survey found for Link Monsters and their missing Defense
- Fit: framework; small but real gaps (health-less units, per-lane scoring) rather than anything the core rules out
- Confidence: high; played, rules are simple and well documented
SUMMARY|Marvel Snap|2|simultaneous|growing|other|compare-stat|none|lanes|framework|high

## Gwent: The Witcher Card Game (2018, CD Projekt Red) — digital-live
- Players: 2
- Turns: alternating; players alternate playing one card or passing, and once you pass you take no further actions that round while your opponent may keep playing
- Resources: none; there is no in-game cost resource, a card is simply spent from hand (deckbuilding uses a separate "provisions" budget, not a play-time cost)
- Life: race; the match is best of 3 rounds, first to win 2 rounds wins the match
- Combat: compare-stat; cards never attack each other, each row's Power sums into a total board Power compared once all players have passed
- Responses: none; cards resolve immediately when played, Deploy/Order abilities activate once per turn but nothing is played in response to another card
- Board: row; each player has 2-3 rows (by unit type) whose totals add up to that player's board Power for the round
- Card kinds: units, spells (special one-shot cards like Scorch or Weather), permanents (Weather effects persist row-wide across both players), heroes (each deck's single Leader ability, usable once or repeatably)
- Hook: a match is best of 3 short rounds, each its own small game of bluffing when to pass, where cards never fight each other and only Power totals decide the round
- Libraries sufficient: mostly; units, spells, combat (compare-stat family) and turns (MaxRounds is close) cover most of the shape
- Missing rules: "win the majority of N rounds" as a life/win condition (WinAtCounter is the closest existing rule but doesn't model a round ending and the board resetting between rounds), a pass flag that removes a player from the turn order for the rest of the round
- Core gaps: none identified; a match-of-rounds structure is expressible with the existing `round` game field plus RoundStart steps that clear zones between rounds
- Fit: framework; the round-based structure is a new life/turn combination, not a new primitive
- Confidence: high; played, rules well documented
SUMMARY|Gwent: The Witcher Card Game|2|alternating|none|race|compare-stat|none|row|framework|high
