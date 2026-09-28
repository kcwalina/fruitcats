# Broad survey batch 15: Shadowverse, Eternal Card Game, Faeria, Artifact, Mythgard, Skyweaver, Gods Unchained, Splinterlands, Parallel TCG, The Elder Scrolls: Legends

## Shadowverse (2016, Cygames) — digital-live
- Players: 2
- Turns: full; alternating full turns with draw/refill/main, ends when the active player ends it
- Resources: growing; Play Points refill and rise by 1 each of your turns (cap 10); a second growing
  counter, Evolution Points, is spent separately to Evolve
- Life: counter; a leader life total (20), reaching 0 loses
- Combat: attacker-chooses; a follower attacks any enemy follower or the leader directly, no block
  declaration; Ward followers must be attacked first
- Responses: windows; "Fast" cards may be played on the opponent's turn, otherwise sorcery-speed only
- Board: row; one shared row of up to 5 followers per side, Amulets sit in a separate permanent zone
- Card kinds: units (followers), spells, permanents (Amulets, some with a countdown)
- Hook: Evolve — spending a second, separate growing resource once (twice, later) per match to
  permanently buff a follower and grant it a keyword mid-combat
- Libraries sufficient: mostly; units/common/resources/combat cover stats, Ward=Guardian, the row
- Missing rules: EvolveAction (an activated, once-per-turn-per-follower stat/keyword grant paid from
  a second growing counter, not a per-card Cost)
- Core gaps: none
- Fit: framework; one clean addition (an activated grant paid from a non-cost counter) away from fit
- Confidence: high; well-known game, broad knowledge
SUMMARY|Shadowverse|2|full|growing|counter|attacker-chooses|windows|row|framework|high

## Eternal Card Game (2016, Dire Wolf Digital) — digital-live
- Players: 2
- Turns: full; alternating full turns with a main/attack/block structure, Magic-like
- Resources: resource-cards; Power cards played from hand once per turn, tapped to pay costs
- Life: counter; 25 life, reaching 0 loses
- Combat: defender-blocks; attackers declared, defender assigns any number of blockers
- Responses: stack; Flash-speed spells/units and triggered abilities may be played or respond before
  things resolve
- Board: row; one shared battlefield row per side, no lanes
- Card kinds: units, spells (fast/slow), attachments (Weapons), permanents (Relics, Sigils)
- Hook: the Market — five cards set aside face up that specific "Merchant"-keyworded plays let you
  buy straight into hand for their printed cost
- Libraries sufficient: mostly; resources/combat/responses/attachments cover everything else cleanly
- Missing rules: BuyFromMarket (a search-like verb that reveals and refills a small owner-visible
  pool instead of searching the deck itself)
- Core gaps: none
- Fit: framework; one new verb over a revealed pool covers the one outstanding mechanic
- Confidence: high; well-known game, broad knowledge
SUMMARY|Eternal Card Game|2|full|resource-cards|counter|defender-blocks|stack|row|framework|high

## Faeria (2017, Abrakam) — digital-dead
- Players: 2
- Turns: full; alternating full turns, one Power Wheel choice per turn (gain Faeria, draw, or place
  land tiles) plus plays, ends on pass
- Resources: growing; 3 Faeria per turn plus more from owned Faeria Wells, unspent Faeria accumulates
  uncapped rather than resetting
- Life: counter; each player's orb/Sanctuary life total, reduced by combat, 0 loses
- Combat: attacker-chooses; a creature moves onto an adjacent hex and trades damage with whatever (or
  whoever) is there, or simply advances if the hex is empty
- Responses: none; no instant-speed play outside your own turn
- Board: grid; a hex board that starts nearly empty and both players build up tile by tile as the
  match goes on
- Card kinds: units (creatures), spells (events), permanents (structures placed on owned land)
- Hook: the board itself is a shared resource the players construct hex by hex during the match, and
  combat is movement onto a hex rather than a declared attack on a chosen target
- Libraries sufficient: no
- Missing rules: PlaceLandTile (extends the board during play), pick-one-of-three-actions-per-turn
  (the Power Wheel), move-to-adjacent-hex as a verb distinct from attack
- Core gaps: zones are declared once in Game.zones; Faeria needs grid cells created and to change
  ownership during play, which core-operations' state model and `move` operation have no room for
- Fit: core; the growing, player-built board is outside what a library can add on its own
- Confidence: medium; shape confirmed via wiki/guide search, not firsthand play
SUMMARY|Faeria|2|full|growing|counter|attacker-chooses|none|grid|core|medium

## Artifact (2018, Valve) — digital-dead
- Players: 2
- Turns: alternating; players alternate placing one card at a time within a lane (lane 1, then 2,
  then 3) until both pass, then combat and a buy phase run without further input
- Resources: growing+other; each lane has its own mana pool rising by 1 per round, plus a separate
  gold currency earned from kills and spent on items in a shop phase
- Life: other; each of three lanes has a 40-HP tower (replaced by an 80-HP Ancient once destroyed);
  winning needs two dead towers, or one tower plus its Ancient
- Combat: lanes; combat is never declared — once both players pass, units automatically clash with
  whatever faces them by position, spilling over to the tower/Ancient if the lane is empty
- Responses: windows; instant-speed cards can be played in a short window before combat resolves
- Board: lanes; three separate lane rows, each its own near-independent mini-board with its own tower
  and deployment order
- Card kinds: heroes (respawn after dying instead of leaving play for good), units (creeps and
  summons), spells, attachments (items bought with gold)
- Hook: three simultaneous, almost independent lane battles, each with its own mana and automatic
  position-based combat, tied together by a shared hero/item economy
- Libraries sufficient: no
- Missing rules: HeroRespawns, a shop/gold-purchase system distinct from Cost, automatic
  (non-declared) positional combat resolution
- Core gaps: three lanes with their own local deployment order and life pool, resolved concurrently
  every round, stretch the core's single next-actor/round-over/game-over loop built around one board
- Fit: core; concurrent independent lanes are the kind of thing the loop skeleton assumes away
- Confidence: medium; well-known shape, phase/priority specifics from summary sources
SUMMARY|Artifact|2|alternating|growing+other|other|lanes|windows|lanes|core|medium

## Mythgard (2019, Rhino Games) — digital-dead
- Players: 2
- Turns: full; alternating full turns, a Magic-like main/attack structure
- Resources: other; "burning" a card from hand shuffles it back into the deck and permanently adds a
  mana crystal of its color, rather than discarding it as a cost or drawing dedicated resource cards
- Life: counter; a life total, 0 loses
- Combat: lanes; seven lanes; a creature attacks an enemy in one of the (up to three) lanes across
  from it, or may move to an adjacent lane instead
- Responses: windows; some cards are playable at instant speed
- Board: lanes; seven parallel lanes; a lane-enhancement card buffs whichever creature occupies that
  lane, and the bonus persists there after the creature dies
- Card kinds: units (creatures), spells, permanents (lane enhancements, which attach to a lane, not a
  card or player)
- Hook: dual-faction deckbuilding (a deck blends two of five factions, changing its own mana base)
  plus lane-enhancement cards whose bonus belongs to the lane itself
- Libraries sufficient: mostly
- Missing rules: BurnForMana (spend a card from hand for a permanent mana crystal, returning the card
  to the deck), a move-between-lanes verb, a zone-targeted (not object- or player-targeted) buff
- Core gaps: none certain; a persistent buff owned by a zone is arguably a framework gap (extend Zone
  with a Grant), not something the object model forecloses
- Fit: framework
- Confidence: medium; turn/response details are from a summary, not firsthand play
SUMMARY|Mythgard|2|full|other|counter|lanes|windows|lanes|framework|medium

## Skyweaver (2021, Horizon Blockchain Games) — digital-live
- Players: 2
- Turns: full; alternating full turns; mana rises by 1 and refills at the start of each of your turns
- Resources: growing; max mana rises by 1/turn, the player going second starts one ahead
- Life: counter; Hero life starts at 32, 0 loses
- Combat: attacker-chooses; ready units and the Hero itself may attack any enemy unit or the enemy
  Hero, no declared blocks
- Responses: none; no evidence of opponent's-turn interaction beyond attached spells firing at cast
- Board: row; up to 6 units plus the Hero per side in a shared row
- Card kinds: units, spells, heroes (the Hero is itself a combatant with attack/health, always in
  play, and can attack or be attacked like a unit)
- Hook: the Hero is a fighting piece on the board, not just a life total or a passive power source
- Libraries sufficient: mostly; HeroCard would need power/health/combat participation, which the
  library's record does not carry today (only Face.power, no health or attack eligibility)
- Missing rules: HeroCard power/health/attacks-like-a-unit, ZoneCapacity(6) on the row, a "conjure a
  card at 1 life cost instead of losing to an empty deck" rule
- Core gaps: none
- Fit: framework
- Confidence: medium; official how-to-play page fetched, some keyword specifics summarized only
SUMMARY|Skyweaver|2|full|growing|counter|attacker-chooses|none|row|framework|medium

## Gods Unchained (2018, Immutable) — digital-live
- Players: 2
- Turns: full; alternating full turns, mana grows by 1/turn, Hearthstone-like
- Resources: growing; mana crystals rise by 1 each of your turns and refill fully, cap 9
- Life: counter; a God (hero) has 30 health, 0 loses
- Combat: attacker-chooses; a ready creature attacks any enemy creature or the enemy God directly, no
  block declaration; Guard creatures must be attacked first
- Responses: none; no opponent's-turn interaction outside a few reactive keyworded triggers
- Board: row; one shared row of creatures per side
- Card kinds: units (creatures), spells, heroes (Gods, each with a repeatable activated God Power),
  permanents (Relics)
- Hook: none especially novel beyond the standard mana-curve/no-block shared row shape; the on-chain
  ownership layer doesn't touch the rules
- Libraries sufficient: yes
- Missing rules: none
- Core gaps: none
- Fit: libraries
- Confidence: high; well-known game, broad knowledge
SUMMARY|Gods Unchained|2|full|growing|counter|attacker-chooses|none|row|libraries|high

## Splinterlands (2018, Steemmonsters / Splinterlands) — digital-live
- Players: 2
- Turns: other; both players privately assemble a Summoner plus up to 6 Monsters within a mana cap
  and ruleset, then the whole battle resolves automatically with no further player input
- Resources: other; a one-time mana cap governs the pre-battle lineup; nothing is paid turn by turn
  since no player acts once the battle starts
- Life: other; each Monster has its own Health, with Armor absorbing damage first; there is no shared
  player life total, the match ends when one side's whole lineup is defeated
- Combat: compare-stat; Monsters act in Speed order and attack automatically by a fixed position rule
  (Melee from the front, Ranged/Magic from range or anywhere), no attacker or defender choice
- Responses: none; nothing is playable once the battle starts
- Board: slots; an ordered lineup of up to 6 positions per side, locked in before the battle
- Card kinds: units (Monsters, with power/health), heroes (Summoners, an always-in-play card that
  buffs the whole team rather than acting itself)
- Hook: the "battle" itself has no legal actions at all — it is a deterministic simulation over a
  lineup both players locked in beforehand, driven by Speed and each Monster's attack-position rule
- Libraries sufficient: no
- Missing rules: TeamSelect-then-autoresolve turn shape, Speed-based initiative ordering, per-unit
  Armor as a shield ahead of Health (LifeShield today is player-level, not per-object)
- Core gaps: the loop always asks next-actor/legal-actions every step; a phase with categorically no
  legal actions (pure simulation replay) fits awkwardly, even though it is technically expressible as
  a string of no-choice bot moves
- Fit: framework
- Confidence: medium; wiki/guide sources, not firsthand play
SUMMARY|Splinterlands|2|other|other|other|compare-stat|none|slots|framework|medium

## Parallel TCG (2023, Parallel Studios) — digital-live
- Players: 2
- Turns: full; alternating full turns with Draw/Bank/Play/Activate/Attack/End steps
- Resources: growing+pitch; Energy grows by 1/turn and refills like Hearthstone mana, but a player
  may also "bank" one card per turn face down to permanently raise max Energy by 1 and draw a card
- Life: counter; a player life total, reaching 0 loses
- Combat: defender-blocks; an attacker targets a unit or player, but only units with a Blocker
  (Intercept) ability may declare as blockers, and some units carry Defender (cannot be blocked by
  named types)
- Responses: windows; an Activate step suggests activated abilities have their own timing (medium
  confidence on exact reactive-play rules)
- Board: row; a shared row of units per side
- Card kinds: units, spells (Effects), attachments (Upgrades), permanents (Relics)
- Hook: Banking — discarding a card face down once per turn to permanently raise your energy cap and
  draw a card, a resource-acceleration option built into every card rather than a separate land type
- Libraries sufficient: mostly; PitchFromHand covers discard-for-value but not a discard that grows a
  GrowingCounter permanently and also draws a card
- Missing rules: BankCard (a hybrid of PitchFromHand and GrowsAt, plus a draw), Blocker/Intercept and
  Defender keyword semantics, the five factions' distinct signature mechanics (family/mechanic style)
- Core gaps: none
- Fit: framework
- Confidence: medium; game manual and guides summarized, not firsthand play
SUMMARY|Parallel TCG|2|full|growing+pitch|counter|defender-blocks|windows|row|framework|medium

## The Elder Scrolls: Legends (2017, Bethesda / Dire Wolf Digital) — digital-dead
- Players: 2
- Turns: full; alternating full turns, Magicka (mana) grows by 1/turn, Hearthstone-style
- Resources: growing; Magicka rises by 1/turn and refills, cap 12
- Life: counter; a 30-health avatar life total, but every 5 damage taken shatters one of six Runes,
  drawing a free card (and playing a held Prophecy card free)
- Combat: defender-blocks; Magic-style declared attackers/blockers, but only within the same lane
- Responses: windows; Prophecy cards may be played free off a rune break; otherwise little to no
  instant-speed play outside your own turn (medium confidence)
- Board: lanes; two lanes (the open Field Lane and the Shadow Lane, where arriving creatures gain a
  turn of Cover/untargetability), each holding several creatures
- Card kinds: units (creatures), spells (Actions); no attachments or distinct permanents
- Hook: the two-lane board plus Rune-shattering life, which turns taking damage into a card-advantage
  engine rather than a pure clock
- Libraries sufficient: mostly; combat's Lanes plus life's LifeShield-like thresholds cover the
  shape, though runes triggering a card draw (not just absorbing damage) is new
- Missing rules: RuneShatterDrawsCard (a life-loss threshold that draws a card), FreePlayOnRuneReveal
  (Prophecy)
- Core gaps: none
- Fit: framework
- Confidence: medium; rules drawn from wiki summaries, not firsthand play
SUMMARY|The Elder Scrolls: Legends|2|full|growing|counter|defender-blocks|windows|lanes|framework|medium
