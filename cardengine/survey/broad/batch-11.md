# Broad survey batch 11: Argent Saga, Kryptik, Void Academy, Ragnarok: Dawn of the Heavens' Massacre, Zombie World Order TCG, Alternate Souls, WONDRLND, Cyberpunk TCG, Flawed Trading Card Game, Eikonic TCG

## Argent Saga (2022, Argent Saga Games) — live
- Players: 2
- Turns: full; one player's turn runs through phases while a priority system lets either player play
  instant-speed ("Instacast") cards and activated abilities in response
- Resources: other; a Champion leads an army of Units and casts Spells, but no source describes what
  pays for them (no confirmed mana/land/resource-card mechanic)
- Life: other; each player has five Tower cards as life; destroying one triggers an effect, and once
  all five fall the attacker may take the neutral sixth "Argent Tower" to win
- Combat: attacker-chooses; Units attack (Argent Saga's comprehensive rules cover this in a
  dedicated section not read directly); no blocking mechanic was confirmed
- Responses: stack; a numbered "Priority" rule section governs passing priority until both players
  pass, then the most recently added card/ability resolves first (LIFO)
- Board: slots; a Champion Zone (one Champion, always in play) and an Augment Zone are named
  explicitly; Units and Towers presumably occupy their own areas, not confirmed
- Card kinds: heroes (Champion, always in play with its own abilities), units, spells (to discard
  once resolved), attachments/permanents (Augments, sit in the Augment Zone)
- Hook: life is five separate, individually destructible Tower cards, each firing its own effect
  when destroyed, and the win condition is capturing a sixth, neutral tower once they are gone
- Libraries sufficient: mostly; heroes.HeroCard, units, spells, attachments/permanents (Augments),
  and responses.Stack cover most of the shape that could be confirmed
- Missing rules: TowerLife (several destructible life-counter objects, each with an on-destroyed
  trigger, replaced at zero by a capturable neutral objective) — life.alex and life-stack.alex have
  nothing like a multi-object life pool with per-object triggers and a win-by-capture finish
- Core gaps: none
- Fit: framework; the tower-based life model needs a new life-rule type, nothing else does
- Confidence: low; the official "How to Play" and "Comprehensive Rules" pages exist (cited by
  search results down to specific rule numbers) but returned only fragments when fetched — resource
  payment and blocking could not be confirmed from any source
SUMMARY|Argent Saga|2|full|other|other|attacker-chooses|stack|slots|framework|low

## Kryptik (2021, Kryptik Studios) — kickstarter
- Players: 2
- Turns: full; unconfirmed, assumed from genre convention
- Resources: other; marketing copy says "resource management" and "unique gameplay" but no mechanic
  is named anywhere found
- Life: counter; unconfirmed, assumed from genre convention
- Combat: attacker-chooses; unconfirmed, assumed from genre convention
- Responses: none; unconfirmed
- Board: other; unconfirmed
- Card kinds: units ("cryptids" with abilities), spells, permanents/attachments ("artifacts")
- Hook: the games.md survey entry claims cards "permanently mutate once played, altering the deck
  for future draws," but this could not be confirmed from any fetched source — kryptiktcg.com's
  Quick Start and Comprehensive Rulebook pages loaded with no rule text in reach (JS-rendered PDF
  viewers), the Kickstarter and Kicktraq pages cover only campaign/stretch-goal content, and no
  review or transcript mentioning a mutation mechanic was found
- Libraries sufficient: unknown
- Missing rules: unknown; if the claimed mutate mechanic is real it would need a verb that
  permanently rewrites a card's own printed record after it resolves, which none of the libraries
  offer (Grant/buff only add temporary or counter-based changes, they don't rewrite the card)
- Core gaps: unknown; a card permanently changing what it is (not just its stats) may need the core
  to support in-place mutation of a Card's own type/fields, which nothing currently does
- Fit: framework; best guess only, pending confirmation of the actual rules
- Confidence: low; only marketing blurbs were reachable, no rulebook text
SUMMARY|Kryptik|2|full|other|counter|attacker-chooses|none|other|framework|low

## Void Academy (2020, Indie (print-on-demand)) — kickstarter
- Players: 2
- Turns: full; unconfirmed, assumed from genre convention
- Resources: other; unconfirmed
- Life: counter; unconfirmed
- Combat: attacker-chooses; unconfirmed
- Responses: none; unconfirmed
- Board: other; unconfirmed
- Card kinds: unknown
- Hook: unknown; games.md's row for this game only documents its distribution model (sold as
  singles/boosters via DriveThruCards' print-on-demand service), not a gameplay hook
- Libraries sufficient: unknown
- Missing rules: unknown
- Core gaps: unknown
- Fit: out; provisional — with no rules found there is no basis to place it in scope
- Confidence: low; extensive searching (web search, DriveThruCards, BoardGameGeek, Wikipedia) found
  no page, rulebook, review or video for a card game of this name; it may be out of print, renamed,
  or too obscure to be indexed. All fields above are unverified defaults, not findings.
SUMMARY|Void Academy|2|full|other|counter|attacker-chooses|none|other|out|low

## Ragnarok: Dawn of the Heavens' Massacre (2020, Indie (print-on-demand)) — kickstarter
- Players: 2
- Turns: full; unconfirmed, assumed from genre convention
- Resources: other; unconfirmed
- Life: counter; unconfirmed
- Combat: attacker-chooses; unconfirmed
- Responses: none; unconfirmed
- Board: other; unconfirmed
- Card kinds: unknown, beyond that the setting spans "8 realities" and the game ships in expansions
  (Rise of the Buran Clan, Witness A Divine Comedy, Gathar's Welcoming) sold on DriveThruCards
- Hook: unknown; publisher copy only promises "critical thinking" and "the perfect strategy," which
  is marketing language, not a mechanic
- Libraries sufficient: unknown
- Missing rules: unknown
- Core gaps: unknown
- Fit: out; provisional, pending real rules
- Confidence: low; the official site (rdhm.info) could not be reached (DNS failure) and its
  BoardGameGeek page returned 403; only DriveThruCards/DriveThruRPG product-listing blurbs and a
  wiki mirror of the marketing copy were readable, with no rules content in any of them
SUMMARY|Ragnarok: Dawn of the Heavens' Massacre|2|full|other|counter|attacker-chooses|none|other|out|low

## Zombie World Order TCG (2020s, Zombie World Order LLC) — live
- Players: 2
- Turns: full; a six-phase turn (Standby, Draw, Magic, Main, Battle, End) per active player, then
  passes to the opponent
- Resources: resource-cards; Magic cards are placed face up and "switched" (rested) to pay a
  summon/revival cost, which must include at least one Magic card of each of the played card's colors
- Life: counter; 10 life (capped at 10 even when healed), 0 life loses
- Combat: defender-blocks; the attacker rests active Zombies to attack, the defender may block with
  their own active Zombies, and both sides deal damage equal to power simultaneously
- Responses: stack; "Free" abilities may be activated by either player in response to anything, are
  placed on a stack, and resolve in reverse order of declaration once both players decline further
  responses
- Board: row; Deck, Magic, and three creature-zone rows a Zombie moves through as it takes damage —
  Undead (undamaged/active), Splattered (damaged), and Dead (defeated, discard-like)
- Card kinds: units (Zombie cards, with power, revival cost and abilities), spells (Event cards,
  one-time paid effects)
- Hook: a Zombie's damage is tracked by which of three zones it physically sits in (Undead →
  Splattered → Dead) rather than a health counter, and defeated Zombies can be paid to revive
  straight back into play from the Dead zone
- Libraries sufficient: mostly; units, spells, resources.CardsAsResources (with a colour-matching
  twist), responses.Stack, and life.LifeCounter cover almost everything found
- Missing rules: a damage-driven zone-change rule (move a unit between named zones as its damage
  crosses thresholds, rather than just comparing a damage counter to health — objects.alex's
  ZoneChangeResets is the wrong direction, this needs the reverse: damage causing a zone change),
  and a Revive verb that returns a unit from a discard-like zone to play for a paid cost
- Core gaps: none; both are expressible as new framework rules over existing operations (move,
  add-counter)
- Fit: framework; the three-state damage zone and revival-from-discard are the only real gaps
- Confidence: medium; a full transcription of the official rules document was read (via idoc.pub),
  though it could not be cross-checked against the original PDF
SUMMARY|Zombie World Order TCG|2|full|resource-cards|counter|defender-blocks|stack|row|framework|medium

## Alternate Souls (2020s, Alternate Souls) — kickstarter
- Players: 2
- Turns: full; each turn a player spends gained energy to move, attack or defend units already
  placed as acrylic standees on a shared physical arena map, while their Ruler separately advances
  along a personal score-track toward joining the fight
- Resources: growing; players "gain energy" each turn to spend on their army's actions
- Life: race; the game is won by scoring points, not by a life total — reaching the opponent's end
  of the arena scores a point, and forcing the opponent to deck out is a separate win condition
- Combat: other; units (three "Linker" standees per deck, plus a Ruler once it enters) fight by
  physical position on a printed arena map, not by declared attacker/blocker roles or fixed lanes
- Responses: none; not confirmed either way, but nothing in any summary suggests an interrupt system
- Board: grid; a printed arena/map board that standees physically occupy and move across, plus a
  separate personal "Score Tracker" track for each player's Ruler
- Card kinds: units (Linkers and the Ruler, each represented on the board by a standee, built from a
  20-card deck of 5 cards per character)
- Hook: characters are physical acrylic standees moved across a shared printed arena map, and each
  player's leader (the Ruler) sits out on a separate score-track, only joining the board once that
  track counts down to zero
- Libraries sufficient: no; movement of positioned pieces across an arbitrary 2D map, and a
  leader that enters play only after a side-track counts down, have no equivalent in any library
- Missing rules: spatial movement/positioning on a map (distinct from a row or named lanes),
  a countdown-track-then-enters-play mechanic for the Ruler, capture/scoring by reaching a zone
- Core gaps: the core's `position` field is a single int for ordering inside one zone; a piece's
  location on an open 2D map with adjacency in any direction is not something the state model or
  queries expose
- Fit: out; the game is closer to a card-driven miniatures skirmish on a printed board than to
  zone-vs-zone card combat, which the design brief calls out of scope
- Confidence: medium; BoardGameGeek and the publisher's Kickstarter-announcement coverage describe
  the core loop consistently, but turn-by-turn combat resolution details were not found
SUMMARY|Alternate Souls|2|full|growing|race|other|none|grid|out|medium

## WONDRLND (2023, BARIWH Enterprises) — kickstarter
- Players: 2
- Turns: full; unconfirmed beyond "two players engage in Duels"
- Resources: other; unconfirmed
- Life: counter; players reduce each other's Life Points to 0 to win
- Combat: attacker-chooses; unconfirmed, default assumption
- Responses: none; unconfirmed
- Board: slots; unconfirmed
- Card kinds: heroes/units (Champions), spells (Spell Cards and a separate Dark Spell Cards
  subtype), and a fourth type — Handler Cards — whose mechanical role could not be established
- Hook: a distinct "Handler" card type sits alongside Champions and two flavors of spells (Spell vs.
  Dark Spell); what a Handler actually does in play was not found in any reachable source
- Libraries sufficient: unknown
- Missing rules: unknown; Handler Cards may need a new record type if they turn out not to be a
  spell, unit, or permanent variant
- Core gaps: none confirmed
- Fit: framework; provisional
- Confidence: low; the publisher's own rulebook page (wondrlnd.com/rule-book/) exists and names the
  four card types and the win condition, but its actual rule text is behind a PDF/interactive
  viewer that returned no readable content; the Kickstarter page was not separately checked
SUMMARY|WONDRLND|2|full|other|counter|attacker-chooses|none|slots|framework|low

## Cyberpunk TCG (2026, WeirdCo) — kickstarter
- Players: 2
- Turns: full; a two-phase turn (Start: draw and Eddie income; Main: play cards and attack, with
  attacks repeatable rather than confined to one declared step)
- Resources: pitch; a card in hand can instead be sold directly for its Eddie value — there is no
  separate land/energy card type, so every card in hand is a potential resource
- Life: race; there is no life total — the shared goal is controlling 7 physical "Gig Dice"; a
  player's only way to gain more is an active steal, attacking the rival's Gig Area to take dice
  from them
- Combat: defender-blocks; a BLOCKER-keyworded unit may redirect an attack onto itself, and a
  "REACT WINDOW" lets the defender play Quick-speed cards before the attack fully resolves
- Responses: windows; the React Window is a fixed reaction moment tied to attacks, not an open stack
- Board: other; units, Programs and Gear are played into a normal play area, plus each player has a
  separate "Gig Area" holding their share of the contested die pool
- Card kinds: units, spells (Programs, one-time or ongoing effects), attachments (Gear, equips a
  unit and modifies its stats), heroes (Legends — exactly 3 per deck, start face down and are
  "Called" into play for 1 Eddie; a RAM system tied to Legends gates which colours a deck may run)
- Hook: the win condition is a shared, physically stealable pool of 7 dice split between the two
  players' Gig Areas, taken from the opponent through combat instead of damaging a life total
- Libraries sufficient: mostly; common.capture (take up to n of a counter from another player) and
  life.WinAtCounter map directly onto the Gig Dice steal-and-race win condition; units/attachments/
  spells/heroes cover the rest
- Missing rules: a face-down-until-Called activation for Legends (close to abilities.Activate, but
  the card itself is hidden until then, closer to setup's StartsInZone with a flip), and Eddies as
  an any-card-can-be-sold resource (resources.PitchFromHand is close but assumes a fixed pitch
  value per card, not a chosen "sell instead of play" toggle on every card)
- Core gaps: none
- Fit: framework; the die-pool win condition and sell-from-hand resource are the only real gaps
- Confidence: medium; a fan-authored beta "how to play" guide gave detailed, internally consistent
  procedural rules, but the official comprehensive rules were not directly read
SUMMARY|Cyberpunk TCG|2|full|pitch|race|defender-blocks|windows|other|framework|medium

## Flawed Trading Card Game (2023, Best Man Gaming) — kickstarter
- Players: 2
- Turns: alternating; players share a turn and alternate one action at a time (e.g. play a card,
  then the opponent attacks, then play passes back) rather than each taking a full turn
- Resources: pitch; any card in hand may be played as itself or flipped face down as a resource, a
  free choice each time rather than a fixed pitch value
- Life: counter; each of the six factions defends a Shrine card, and destroying the opponent's
  Shrine wins — functionally a life total carried by one specific card instead of a player counter
- Combat: compare-stat; Units carry a "speed" stat, and when two units in combat share the same
  speed they deal damage simultaneously (implying speed otherwise orders who deals damage first)
- Responses: none; no interrupt or response system was found in any source, though this is the
  weakest-sourced field
- Board: slots; unconfirmed beyond that units are placed to defend/attack toward each faction's Shrine
- Card kinds: units; permanents (the Shrine); the "essence" overlays are a deckbuilding-time
  physical modifier, not an in-play card type
- Hook: at deckbuilding time, every printed card is paired with one of 80 clear plastic "essence"
  overlays chosen from a matching set, which changes that card's stat line, adds keywords and
  subtypes, and sets its resource value — nearly 7,000 possible base-plus-essence combinations from
  one set, fixed once chosen and then played as an ordinary card
- Libraries sufficient: no; every library assumes a card's printed stats are fixed at design time,
  not composed from two physical components chosen by the deckbuilder before the card ever enters a
  game
- Missing rules: a deckbuilding-time card-composition rule (combine a base card record and a chosen
  modifier record into one effective card before the game starts) — closest to decks.alex, but
  nothing there lets deck construction alter a card's own stats/keywords rather than just count it
- Core gaps: the core's `Card` is a single named printed data record; a card that is actually the
  combination of two independently chosen components, fixed only at deckbuilding time, doesn't fit
  that model without a deckbuilding-stage transform step the core doesn't define
- Fit: framework; only the essence-overlay system is the gap — combat, resources and the Shrine life
  total are all ordinary framework rules
- Confidence: medium; the Kickstarter campaign page gave clear, specific detail on the essence
  system, resource choice, alternating turns and combat speed rule; the full rulebook wasn't read
SUMMARY|Flawed Trading Card Game|2|alternating|pitch|counter|compare-stat|none|slots|framework|medium

## Eikonic TCG (2026, 4th Order Studios / Eikonic Games) — kickstarter
- Players: 2
- Turns: full; unconfirmed beyond "two players... wage war"
- Resources: other; unconfirmed
- Life: other; unconfirmed — possibly tied to controlling/destroying "Base" permanents rather than a
  simple counter, but not established
- Combat: other; each unit carries a printed "Combat Compass" that fixes which surrounding tiles or
  directions it may attack into or support on a grid battlefield — a directional/positional targeting
  rule with no equivalent in the vocabulary's attacker-chooses/defender-blocks/lanes/compare-stat set
- Responses: none; unconfirmed
- Board: grid; explicitly a grid-based tactical battlefield
- Card kinds: heroes (Eikon, the player's chosen leader), units (organized into "Parties"), spells
  (Skills), permanents (Bases), and a fifth type, Tactics, whose mechanical role (instant-speed
  maneuver? one-time effect?) could not be confirmed; six mythologically-themed, colour-coded
  factions can be combined when deckbuilding
- Hook: combat is resolved by each unit's own fixed "Combat Compass," a printed diagram of which
  grid directions/tiles it threatens, rather than by declaring attackers/blockers or picking lanes
- Libraries sufficient: no; positional, direction-based targeting on a 2D grid is not expressible by
  any combat rule in combat.alex, all of which assume a row, lane list, or simple attacker/defender
  choice, not per-unit geometric facing
- Missing rules: a directional/geometric targeting rule and selector (adjacency by compass direction
  on a grid, not just "adjacent" within a row)
- Core gaps: core.alex's `Shape` enum already includes `grid`, but core-operations.alex's object
  model gives each object only a single linear `position: int` — there is no x/y coordinate or
  facing, so a unit's Combat Compass (which tiles/directions it threatens) cannot be computed from
  the state the engine tracks today
- Fit: core; genuine 2D position and facing on a grid is needed for the signature mechanic, and nothing
  short of extending the object model provides it
- Confidence: low; only the existence of the grid battlefield, the Combat Compass concept, the five
  card-type names and six factions were confirmed (Kickstarter/publisher site); the Combat Compass's
  actual geometry, turn structure, resource system and life rules were not found in any accessible
  source
SUMMARY|Eikonic TCG|2|full|other|other|other|none|grid|core|low
