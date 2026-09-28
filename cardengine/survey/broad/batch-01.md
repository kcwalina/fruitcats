# Broad survey batch 01: Magic, VTES, Star Trek CCG, MECCG, Spellfire, Illuminati, On the Edge, Doomtrooper, L5R (original), Star Wars CCG

## Magic: The Gathering (1993, Wizards of the Coast) — live
- Players: 2+; standard play is 2, but multiplayer (Commander etc.) is core-supported, not a variant bolted on
- Turns: full; a player runs untap/upkeep/draw/main/combat/main/end, then passes the whole turn
- Resources: resource-cards; lands are played from hand and tapped to pay mana costs
- Life: counter; 20 life (or format-specific), 0 or less loses, plus alternate loss conditions
- Combat: defender-blocks; attacker declares attackers, defender assigns blockers, damage compared
- Responses: stack; priority passes between players, instants/abilities resolve LIFO once both pass
- Board: none; the battlefield is an unordered set of permanents, no lanes or slots
- Card kinds: units (creatures), spells (instants/sorceries), attachments (auras/equipment),
  permanents (artifacts/enchantments/lands); planeswalkers (loyalty + once-per-turn activated
  ability) fit none of ours cleanly
- Hook: priority on the stack lets either player respond to almost anything before it resolves
- Libraries sufficient: mostly; units + combat + life + resources(ResourceCards) +
  responses(Stack) + turns(FullTurns, Phases) cover the loop cleanly
- Missing rules: PlaneswalkerLoyalty, ColorIdentity (deck-construction color restriction),
  StateBasedActions (batch of simultaneous checks each priority pass, broader than DefeatAtHealth)
- Core gaps: other: multi-record cards (split cards, modal double-faced cards, Adventure)
- Fit: framework; only the multi-record card shapes push past a straight library fit
- Confidence: high; long-standing general knowledge of the rules
SUMMARY|Magic: The Gathering|2+|full|resource-cards|counter|defender-blocks|stack|none|framework|high

## Vampire: The Eternal Struggle (Jyhad) (1994, Black Chantry Productions) — live
- Players: 2+; designed and best played with 4-5 in a fixed predator-prey seating chain
- Turns: full; unlock, master (one card), minion (act), influence, discard, then the next seat left
- Resources: other; Blood counters live on each vampire object, not a player pool, and pay for
  that vampire's own actions and disciplines
- Life: counter; each player's Pool of blood, reaching 0 ousts them and their predator inherits
  their prey (a multiplayer elimination chain, not a simple two-player loss)
- Combat: defender-blocks; a bleed/action may be blocked by a ready vampire, a successful block
  becomes a fight resolved with strike/dodge cards
- Responses: stack; actions, action modifiers, reactions and combat cards all play in response, LIFO
- Board: none; vampires and equipment sit ready or in torpor in a player's area, no lanes
- Card kinds: units (vampires, though Blood-as-per-object-counter is unusual for a stat block),
  spells (actions/reactions/combat cards), attachments (equipment, retainers), permanents
  (master cards such as locations)
- Hook: a fixed predator-prey seating order turns bleeding into a chain of ousts instead of a
  free-for-all, and Blood is simultaneously each vampire's cost pool and the player's life
- Libraries sufficient: mostly; the per-object cost pool is the one real gap, the rest maps to
  units/spells/attachments/responses(Stack)
- Missing rules: PerObjectCounterResource (a cost paid from the acting unit's own counter, not
  the player's), OustedPlayerPassesPreyToPredator
- Core gaps: none confirmed; a per-object spendable counter likely fits as a new resource rule
- Fit: framework
- Confidence: medium; general knowledge plus a fetched rules summary, no full rulebook read
SUMMARY|Vampire: The Eternal Struggle|2+|full|other|counter|defender-blocks|stack|none|framework|medium

## Star Trek Customizable Card Game (1994, Decipher) — dead
- Players: 2+
- Turns: full; a player's turn works through named phases (seed once at setup, then per-turn play), then passes
- Resources: none; cards are played from hand as the phase allows, with no separate cost-paying pool
- Life: race; first to 100 mission points (scored by completing seeded missions) wins outright
- Combat: other; the core loop is an away team's skill totals overcoming a mission's hidden,
  seeded Dilemma cards, not an attacker/defender fight; an optional ship-to-ship Battle exists
- Responses: windows; Interrupt cards play at specific triggered points, not an open stack
- Board: row; the Spaceline is a line of location cards both players seed alternately at setup
- Card kinds: units (personnel, ships), permanents (missions/locations on the spaceline,
  equipment), spells (events/interrupts), attachments (equipment on personnel/ships)
- Hook: a shared spaceline of locations, each secretly seeded with a Dilemma the opposing away
  team must beat with a skill-total check before the mission can be completed
- Libraries sufficient: no; nothing models a shared seeded row of location objects with a hidden
  attached challenge resolved by stat totals
- Missing rules: Spaceline (a row-shaped shared board both players seed), Dilemma (a hidden
  challenge attached to a location, beaten by a skill-total check), MissionPoints (a race-type
  win counter)
- Core gaps: other: a challenge card attached to a zone/location rather than to a unit
- Fit: framework
- Confidence: medium; rulebook and wiki summaries fetched, not deeply played
SUMMARY|Star Trek Customizable Card Game|2+|full|none|race|other|windows|row|framework|medium

## Middle-earth Collectible Card Game (1995, Iron Crown Enterprises) — dead
- Players: asym; in 2-player play one side may build an all-Minion (hazard-only, no companies)
  deck against the other's Fellowship deck; multiplayer has everyone run companies and hazards
- Turns: full; a player moves one company across the shared map one region/site at a time, resolves
  encounters, then passes
- Resources: none; no separate cost-paying pool is confirmed in the summaries used
- Life: other; no single life total — individual characters accumulate Corruption and can be
  killed or corrupted at a threshold; the game is won on victory/marshalling points from quests
- Combat: other; hazard creatures attack via dice-modified strike rolls against a character's
  body/prowess, not a symmetric attacker/blocker exchange
- Responses: windows; hazard cards ambush at defined encounter moments during movement, not an
  open stack
- Board: other: a graph of connected regions and sites (the printed map), not a row or grid
- Card kinds: units (characters, though Prowess/Body/Mind stats don't map to power/health),
  permanents (sites), attachments (items on characters), spells (events)
- Hook: a shared physical map of interconnected regions that companies actually traverse,
  seeded along the way with hazards other players attach
- Libraries sufficient: no; there is no shared, adjacency-based movable board in the libraries
- Missing rules: RegionMap (a graph-shaped shared board with adjacency and movement), Corruption
  (a per-character counter that kills/corrupts at a threshold), DiceResolvedEncounter,
  AsymmetricMinionDeck
- Core gaps: zone adjacency
- Fit: framework; leaning core if the engine must natively support graph movement between zones
- Confidence: medium; wiki summaries fetched, no rulebook read in full
SUMMARY|Middle-earth Collectible Card Game|asym|full|none|other|other|windows|other|framework|medium

## Spellfire (1994, TSR) — dead
- Players: 2+; the rules place no limit on player count
- Turns: full; a player draws, plays at most one Realm, plays other cards, attacks, then passes
- Resources: none; cards are played straight from hand with no resource-cards or growing pool
  (confirmed: Spellfire deliberately has no land-like resource system)
- Life: other; a player's life is a fixed pyramid of 6 Realm cards (1-2-3), attacked and razed
  (flipped face down) one at a time; losing all six loses the game
- Combat: attacker-chooses; a Realm (or its defenders) is attacked, the defending Holding/units
  resist, and a failed defense razes the Realm
- Responses: none; no defined interrupt/response window is confirmed in the summaries used
- Board: slots; each player has a fixed 6-slot pyramid that must be filled front-to-back
- Card kinds: permanents (Realms, Holdings), units (Heroes/Wizards/Clerics/Monsters), spells
  (Spells/Events), attachments (Magic Items on Heroes)
- Hook: your life total is a face-up pyramid of Realms filled front-to-back, so front Realms
  physically shield the rear ones until they fall
- Libraries sufficient: no; nothing models a fixed-shape, positionally-ordered life zone whose
  front slots shield the rear
- Missing rules: RealmPyramid (a slots-shaped life zone with positional shielding), Razed (a
  life-slot flipped face-down as a loss state), HoldingDefends
- Core gaps: none confirmed
- Fit: framework
- Confidence: low; summaries only, thin/conflicting detail on responses and exact combat math
SUMMARY|Spellfire|2+|full|none|other|attacker-chooses|none|slots|framework|low

## Illuminati: New World Order (1994, Steve Jackson Games) — dead
- Players: 2+; multiplayer free-for-all with heavy negotiation is the norm
- Turns: full; a player spends a fixed per-turn action allowance (draw, plays, Attacks to Control),
  then passes left
- Resources: other; a fixed action allowance per turn plus Money counters earned from controlled
  groups, not a card-based mana pool
- Life: other; no player life total — a player is out if their own Illuminati is destroyed;
  winning is controlling a set number (about 12) of Groups
- Combat: compare-stat; an Attack to Control/Destroy compares the acting Group's Power against
  the target's Resistance plus a die roll; other players may aid or hinder
- Responses: windows; other players may intervene at the defined Attack step, and some cards are
  playable reactively, but it is not an open stack
- Board: none; controlled and uncontrolled Groups sit in a shared tableau linked by directional
  Control Arrows, not lanes
- Card kinds: permanents (Groups, Places), spells (Plot/event cards); the Illuminati itself is an
  always-in-play identity card, close to heroes; Groups have two stats but are captured, not
  defeated, so units is a loose fit at best
- Hook: Groups are captured into a directed network of Control Arrows rather than destroyed, so
  power is a growing web of influence, not attrition
- Libraries sufficient: no; nothing models "contest a stat + die roll to gain control of an
  object without destroying it" or the resulting cross-player ownership graph
- Missing rules: ControlAttempt (compare-stat plus a die roll that transfers control instead of
  destroying), ControlArrowGraph, IlluminatiIdentityCard (heroes-like), FixedActionsPerTurn
- Core gaps: other: a directed graph of control over objects that can sit in another player's
  area, which same-owner attach/stack-under cannot express
- Fit: framework; leaning core for the cross-player control graph
- Confidence: low; one primary source was inaccessible (paywalled), turn/action specifics are
  from general knowledge, not a freshly read rulebook
SUMMARY|Illuminati: New World Order|2+|full|other|other|compare-stat|windows|none|framework|low

## On the Edge (1994, Atlas Games) — dead
- Players: 2
- Turns: full; on your turn you play Resources and Characters, generate Pull/Influence, and may attack
- Resources: growing; Characters/Resources in play generate Pull each turn, spent to bring more
  cards into play
- Life: race; Influence generated by characters accumulates toward a win threshold rather than a
  depleting life total
- Combat: attacker-chooses; characters attack other characters directly, the defender may answer
  with Whammies or Gear
- Responses: other: any card printed with the Edge trait can interrupt at almost any point in the
  sequence regardless of whose turn it is, a per-card trait rather than a fixed window or a
  universal stack that every card can join
- Board: none; Characters and Resources sit in each player's tableau, no lanes
- Card kinds: units (Characters, with Body/Mind stats rather than power/health), permanents
  (Resources, Gear, face-down Secrets), attachments (Gear on Characters), spells (Whammies)
- Hook: Edge is a card-level keyword that grants interrupt timing to that card alone, so
  "instant speed" is a trait of specific cards rather than a card type or phase
- Libraries sufficient: mostly; permanents' hidden OnEvent ability covers face-down Secrets well;
  the Edge trait itself is the gap
- Missing rules: EdgeInterrupt (a keyword letting a card respond outside any defined window),
  Pull (a per-turn spendable income counter), InfluenceRace
- Core gaps: none confirmed; Edge likely models as a new ResponseRule beside Stack and Chain
- Fit: framework
- Confidence: low; only a short secondary summary was retrievable, the rulebook PDF fetch failed
SUMMARY|On the Edge|2|full|growing|race|attacker-chooses|other|none|framework|low

## Doomtrooper (1995, Target Games) — dead
- Players: 2+
- Turns: full; a player plays warriors/equipment, attacks with available warriors, gains Destiny
  and Promotion points, then passes
- Resources: growing; Destiny Points are earned from combat and spent to play more warriors and
  equipment, functioning as the game's mana-equivalent
- Life: race; first to a target number of Promotion Points wins; running out of warriors is an
  alternate loss
- Combat: defender-blocks; the attacker names a warrior, the defender may assign one of their own
  to block, and the clash is decided by dice-modified Strength/Courage comparison
- Responses: windows; Art (spell) and Equipment cards play at defined points around combat, not
  an open stack
- Board: none; warriors sit in a player's Squad/Kohort area, no lanes
- Card kinds: units (Warriors), attachments (Equipment on Warriors), permanents (Fortifications),
  spells (Art cards)
- Hook: two counters split scoring from spending — Destiny Points bought new warriors while
  Promotion Points, earned from the same fights, are the separate race to win
- Libraries sufficient: mostly; units/combat/attachments/permanents/spells/resources(GrowingCounter)
  cover the shape
- Missing rules: DualCounterEconomy (two player counters filled by the same trigger, one spent
  and one raced to a win threshold), FactionAttackRestriction
- Core gaps: none confirmed
- Fit: framework
- Confidence: low; primary rulebook fetches failed (certificate/access errors), so combat and
  response detail rest on partial community summaries
SUMMARY|Doomtrooper|2+|full|growing|race|defender-blocks|windows|none|framework|low

## Legend of the Five Rings (original CCG) (1995, AEG / Five Rings Publishing Group) — dead
- Players: 2
- Turns: full; Straighten, Events (Dynasty reveal), Action (buy attachments), Attack (assault
  provinces), Dynasty (buy Personalities/Holdings, draw Fate), then the opponent's turn
- Resources: resource-cards; Gold is produced by Holding cards in play and spent to bring
  Personalities and attachments into play
- Life: other; a fixed row of Province cards is destroyed one by one by successful attacks; all
  destroyed is a military loss, and a separate Honor counter can independently win or lose the game
- Combat: attacker-chooses; the attacker assigns Personalities against a Province, the defender
  assigns Personalities to defend, higher total Force wins, losing-side cards may be destroyed
- Responses: alternating; players use card abilities in turn during a phase until both pass,
  rather than a full LIFO stack
- Board: row; a player's Provinces form a defended row
- Card kinds: units (Personalities, with Force/Chi and Honor rather than power/health),
  permanents (Holdings), attachments (Items, Followers, Spells attach to Personalities)
- Hook: four or five structurally different simultaneous win conditions (military, honor,
  dishonor, enlightenment via the five Rings) mean a single game can end several different ways
- Libraries sufficient: mostly; combat(AttackerChooses) + resources(ResourceCards) +
  attachments + units map well; the Province row and second stat pair need new rule types
- Missing rules: ProvinceRow (a row-shaped life zone of individually destroyed cards),
  HonorCounter (a bidirectional win/lose counter beside life), RingEnlightenment (collect n
  special cards to win), ForceChiStats (a second combat stat pair)
- Core gaps: none confirmed; multiple win conditions and a second stat pair look like new
  library types layered on units/life, not core changes
- Fit: framework
- Confidence: medium; a rules summary was fetched, no full rulebook read
SUMMARY|Legend of the Five Rings (original CCG)|2|full|resource-cards|other|attacker-chooses|alternating|row|framework|medium

## Star Wars Customizable Card Game (1995, Decipher) — dead
- Players: asym; Light Side and Dark Side decks are built from different card pools and play by
  rules unique to each side
- Turns: full; the Dark Side player runs all six phases, then the Light Side player does the same
- Resources: none; there is no separate cost-paying pool — the deck itself doubles as life force
- Life: stack; the 60-card deck is a player's Life Force, and drawing it out (rather than being
  reduced to zero on a counter) is the primary loss condition
- Combat: other; Force drain passively depletes life force via icon totals at controlled
  locations with no opposing unit needed, while separate Battles pit characters/starships'
  power against each other modified by a random Destiny draw; neither is a plain
  attacker-declares/defender-blocks pattern
- Responses: windows; Interrupts play only at specific, named triggered points, not an open stack
- Board: other: systems/locations connect into a printed map of sectors that units occupy and
  move between, not a plain row or grid
- Card kinds: units (Characters, Starships, Vehicles, with Power/Ability/Defense rather than
  power/health), permanents (Locations/Systems, Devices, Effects), attachments (weapons/devices
  on characters or vehicles), spells (Interrupts/Effects)
- Hook: a player's own deck is simultaneously their card supply and their life total, so every
  card drawn to do something is a card that can no longer be lost
- Libraries sufficient: no; a location-graph board, passive icon-based life drain, and a
  Destiny-draw randomizer on most resolutions are not covered
- Missing rules: LocationGraph (a system/sector map board), ForceDrain (passive, icon-based
  life-stack depletion with no attacker), DestinyDraw (a random top-of-deck modifier used on
  most resolutions), AsymmetricSideDecks
- Core gaps: zone adjacency (shared with Middle-earth CCG: both need a movable graph of zones)
- Fit: framework; leaning core for the location-graph/adjacency piece
- Confidence: medium; rulebook location found and summaries fetched, not deeply read
SUMMARY|Star Wars Customizable Card Game|asym|full|none|stack|other|windows|other|framework|medium
