# Broad survey batch 10: KeyForge, Flesh and Blood, Grand Archive, MetaZoo, Elestrals, Alpha Clash, Sorcery: Contested Realm, Altered, Genesis: Battle of Champions, Akora

## KeyForge (2018, Fantasy Flight Games / Ghost Galaxy) — dead
- Players: 2
- Turns: full; the active player picks one of their deck's three houses and may only play/reap/fight/activate with that house's cards until they end the turn
- Resources: none; cards are free to play — Æmber is a separate growing counter spent only to forge Keys, never to pay for cards
- Life: keys; first to forge 3 Keys (paid for with 6 Æmber each) wins; no player ever takes damage
- Combat: attacker-chooses; only the declared creature deals damage (one-way) — the target doesn't automatically hit back
- Responses: none; no instant-speed interaction beyond a handful of Omni-keyword cards
- Board: row; each player's Battleline is a row of creature bays, plus a shared-shape row of Artifacts
- Card kinds: units (Creatures), spells (Actions), attachments (Upgrades), permanents (Artifacts, via PermanentCard); no heroes
- Hook: the acting player must choose one of three houses each turn, and every action that turn must come from that house's cards alone.
- Libraries sufficient: mostly; ChooseGroupPerTurn (turns) is the house choice itself; AttackerOnlyDamage, GuardiansFirst, Elusive, adjacent (combat); capture, discard, hand (common); WinAtCounter, LoseOnEmptyDraw (life); PermanentCard for Artifacts; abilities.alex's generic activate for an Artifact's "Action:" ability.
- Missing rules: OnReap (a trigger for "when this creature reaps" — no such moment exists on UnitCard), GroupCount/CardsPerGroup (a deck must be exactly 3 disjoint 12-card house groups)
- Core gaps: none
- Fit: framework; the reap trigger and house-count deckbuilding rule are catalog additions, not core changes
- Confidence: high; comprehensive rules were read for an earlier deep survey of this game (survey/keyforge.md), re-checked line by line against the current framework/lib files, which have since closed most of that survey's gaps
SUMMARY|KeyForge|2|full|none|keys|attacker-chooses|none|row|framework|high

## Flesh and Blood (2019, Legend Story Studios) — live
- Players: 2
- Turns: full; the active player keeps acting (playing, attacking) until they choose to stop, then passes
- Resources: pitch; any card may be discarded face down for a resource value equal to its own printed pitch number, spent only that turn
- Life: counter; hero Life (20-40, printed per hero) reaching 0 loses
- Combat: attacker-chooses; the defender pays cards from hand as one-shot blockers, each contributing its own printed defense stat, then discards them
- Responses: alternating; a combat chain where priority flips to whoever was just hit, chain links resolve most-recent-first, until two passes in a row
- Board: none; heroes fight directly — no persistent creature row in the base (Classic Constructed) format
- Card kinds: spells (attack/instant actions carrying power/defense/pitch as game-declared subtype fields), attachments (weapons/equipment), heroes (with life and hand-size fields)
- Hook: every card is also a resource — pitching it face down to pay for another card is the only way to "spend" mana, so hand management is one continuous play-it-or-burn-it trade-off.
- Libraries sufficient: mostly; PitchFromHand (now has zone/from), heroes' life/hand-size fields, the built-in hero-hit event plus AlternatingPriority and Ambush(only=event) for reactions and the chain, damage-life/reduce for life-loss and prevention, GoAgainContinues, RefillHandTo, StartsInZone, ZoneMinimum, CopyLimitByRarity, and Card.activate (abilities.alex) for hero/equipment activated abilities all line up cleanly.
- Missing rules: BlockWithHandCard (a CombatRule for defending by paying a card from hand as a one-off blocker with its own stat, distinct from DefenderBlocks' permanent-creature model)
- Core gaps: none
- Fit: framework; one real remaining gap (hand-card blocking) — everything else maps onto current libraries
- Confidence: high; comprehensive rules were read for an earlier deep survey (survey/flesh-and-blood.md), re-checked against the current framework/lib files, which closed nearly every gap that survey found (life/hand-size on HeroCard, the hero-hit event, AlternatingPriority, damage-life, reduce, GoAgainContinues, RefillHandTo, ZoneMinimum, CopyLimitByRarity, PitchFromHand's zone/from)
SUMMARY|Flesh and Blood|2|full|pitch|counter|attacker-chooses|alternating|none|framework|high

## Grand Archive (2021, Weebs of the Shore LLC) — live
- Players: 2
- Turns: full; seven phases each turn (Wake Up, Materialize, Recollection, Draw, Main, Combat, End)
- Resources: pitch; cards sent from hand to the Memory zone pay costs during the turn and return to hand at next turn's Recollection Phase — a self-replenishing pitch
- Life: counter; the Champion has a life stat, reduced by unblocked damage, defeated at 0
- Combat: defender-blocks; the defender may rest any awake ally with positive power to retaliate against an attacker, dealing/taking damage in the following Damage Step
- Responses: stack; an Effects Stack resolves (both players passing) before each Damage Step
- Board: row; allies sit in a row per player, alongside the Champion/Materialize slot
- Card kinds: units (Allies), spells (Attack/Action cards), heroes (Champion, leveled up rather than flipped), permanents likely (Regalia)
- Hook: a separate Material Deck holds a Champion's higher levels and its Regalia; materializing one per turn is how the Champion grows mid-game, closer to Digimon's digivolution than a Hero-face flip.
- Libraries sufficient: mostly; life, combat (defender-blocks/retaliate), responses (Stack), and resources (PitchFromHand) cover the base loop; the Champion's level-up plays like objects.alex's stack-onto/InheritedEffects/StackPreservesState (built for Digimon-style evolution), reusable for Materialize.
- Missing rules: a rule for "may put a card from a separate Material Deck into play as a level-up" each turn — StartsInZone only covers the opening board, not an ongoing per-turn option to introduce a second deck's cards
- Core gaps: none
- Fit: framework; Materialize is a small new framework rule alongside the existing evolution-style objects rules
- Confidence: medium; combat (retaliation) and the seven turn phases were confirmed from the official comprehensive rules site (rules.gatcg.com); resource and Materialize details come from secondary guides (TCGplayer, Neokyo), not a full read of the rulebook
SUMMARY|Grand Archive|2|full|pitch|counter|defender-blocks|stack|row|framework|medium

## MetaZoo (2020, MetaZoo Games; 2025 relaunch by GameQbator Labs) — live
- Players: 2
- Turns: full+alternating; Draw and Aura phases resolve simultaneously, then an Action Phase alternates single actions across four lanes until all are resolved
- Resources: resource-cards; a dedicated 10-card Aura deck (one primary type) is drawn one card per round, tradeable for an allied secondary type
- Life: race; first to 30 Mission Points wins — there is no life total to reduce
- Combat: compare-stat; each of four lanes compares the two sides' total Influence, the higher side scores 1-2 Mission Points, no creatures are destroyed by this comparison itself
- Responses: none; no interrupt/stack system was found for the relaunched format
- Board: lanes; four lanes, each with a Terra slot and room for up to five cards per side
- Card kinds: units (creatures), permanents (Terra, equipment); attachments possibly (enhanced Aura)
- Hook: four simultaneous lane "missions" each score points by comparing total board Influence, replacing life loss entirely with a race to 30 Mission Points.
- Libraries sufficient: no; the Lanes/CompareStatDeletes/BattleDamageByStatDifference CombatRules assume creature-vs-creature stat comparisons that destroy or damage, not an aggregate-influence-scores-points-toward-a-counter mechanic
- Missing rules: a CombatRule/StateCheckRule for "compare aggregate lane stat totals and award a player/game counter" (Mission Points) — WinAtCounter checks a threshold but nothing computes or awards that counter from a lane comparison
- Core gaps: none; the scoring mechanic is buildable from existing adjust/query operations, just uncatalogued
- Fit: framework
- Confidence: low; sourced from one third-party how-to-play article (ihc.cards) describing the 2025 "lane-battler" relaunch; the original 2020 version (1000 life, hidden bluffing spell-card back, no lanes) is a substantially different game and this record does not cover it
SUMMARY|MetaZoo|2|full+alternating|resource-cards|race|compare-stat|none|lanes|framework|low

## Elestrals (2022, Elestrals LLC) — live
- Players: 2
- Turns: full; a standard draw/main/battle/end turn shape, alternating between players
- Resources: resource-cards; a separate 20-card Spirit Deck is spent ("invoked") to cast Elestrals and Runes
- Life: stack; the same Spirit Deck also serves as life — losing spirits (by damage or cost) depletes it, and reaching 0 spirits loses
- Combat: defender-blocks; Elestrals are cast in Attack or Defense Position — attacking creatures always deal damage, defending creatures deal damage back only from Attack Position
- Responses: none; no confirmed instant-speed window (low confidence, see below)
- Board: slots; a small field of Elestral slots per player, exact capacity unconfirmed
- Card kinds: units (Elestrals), spells (Runes); resource cards (Spirits) fit none of unit/spell/attachment/permanent/hero and are instead covered by the resources library
- Hook: the same deck that pays your costs is your life total, so every Spirit spent to cast something is a card of life you can no longer afford to lose.
- Libraries sufficient: mostly; life-stack (LifeStack/LoseWhenEmpty) fits the Spirit-deck-as-life exactly, resources (ResourceCards) fits Spirits, and combat.alex's WeaknessResistance fits the elemental type-advantage wheel.
- Missing rules: AttackDefensePosition (a UnitRule for "a unit chooses Attack or Defense position, which side deals damage in combat depends on it") — a Yu-Gi-Oh-shaped rule not in the current combat/units libraries
- Core gaps: none
- Fit: framework; one clear missing UnitRule, otherwise a clean fit
- Confidence: low; the official rulebook PDF could not be read (corrupted fetch), and no clean secondary source covered turn phases or responses in detail; combat/resource/life claims are cross-confirmed by two independent search snippets each, but position and keyword specifics rely on general familiarity with similarly-shaped games
SUMMARY|Elestrals|2|full|resource-cards|stack|defender-blocks|none|slots|framework|low

## Alpha Clash (2023, Rising Empire Studios) — live
- Players: 2
- Turns: full; Start, Untap, Draw, Resource, Main, Clash, Main 2, End phases
- Resources: cards; any card may be played face down as a resource, matching CardsAsResources directly
- Life: counter; the Contender's health reaching 0 loses, and many Contenders' own printed abilities switch on only while health is at or below a printed threshold
- Combat: attacker-chooses; Clash cards attack Clash cards or the Contender directly, and excess ("Breakthrough") damage past a blocker carries through to the Contender like Trample
- Responses: windows (low confidence); ten named zones including a dedicated Clash Zone suggest some reactive play, but no confirmed stack/window mechanic was found
- Board: slots; ten distinct named zones (Deck, Hand, Contender, Portal, Clashground, Clash Zone, Accessory Zone, Resources, Oblivion, Banished)
- Card kinds: units (Clash cards), attachments (Accessory/gear cards), heroes (Contender, with life and gated abilities); permanents (Portal cards, unconfirmed)
- Hook: a Contender's text box carries several abilities that switch on only while its current health is at or below a printed number, turning the health total into a continuously re-evaluated dial rather than just a countdown.
- Libraries sufficient: mostly; CardsAsResources, Trample (for Breakthrough), heroes' life field, and AttachmentCard all fit cleanly.
- Missing rules: HealthThresholdAbility (a static ability gated on the holder's own current health being at/below N, re-checked continuously) — no HeroRule or UnitRule does this today, only Awaken-style one-time flips exist
- Core gaps: none
- Fit: framework; the threshold-gated ability is the standout gap
- Confidence: low; drawn from rulebook search snippets (phase names, zone list, Breakthrough and threshold-ability wording) rather than a full read of the comprehensive rulebook
SUMMARY|Alpha Clash|2|full|cards|counter|attacker-chooses|windows|slots|framework|low

## Sorcery: Contested Realm (2023, Erik's Curiosa Ltd.) — live
- Players: 2
- Turns: full; Starting, Standard (Main), and Ending phases each turn
- Resources: resource-cards; Site cards are placed to tap for elemental mana (Air/Earth/Fire/Water) and simultaneously build the physical map
- Life: counter; the Avatar's life (20) reaching 0 loses
- Combat: lanes; Minions occupy and move between grid squares, engaging whatever occupies an adjacent square, with Airborne/Ranged bypassing melee-only blockers
- Responses: windows; a small set of instant-speed Magic cards playable at set moments, not a full stack
- Board: grid; the board is assembled turn by turn from played Site cards into a connected grid of squares that the Avatar and Minions move across
- Card kinds: units (Minions), spells (Magics), attachments (Artifacts, equip a Minion), permanents (Sites, resource + geography), heroes (the Avatar — a movable, life-bearing token, not quite a HeroCard)
- Hook: the board does not exist until players build it — each Site card played extends a shared physical grid that Minions must move across to reach each other or the enemy Avatar.
- Libraries sufficient: no; there is no mobile-Avatar-as-token record, and the grid itself is dynamic (built from played cards) rather than a fixed zone list
- Missing rules: Movement (a verb for changing a unit's 2D position and checking adjacency by direction), a HeroCard-like record for a movable, damageable Avatar not tied to a single Face
- Core gaps: 2D grid coordinates and dynamic zone construction — object-fields.position is a single int for an ordered zone, and Game.zones is a fixed list set once at game-definition time; Sorcery needs positions on a plane that grows as cards are played, which neither the state model nor the zone model expresses today
- Fit: core; a dynamically-built grid and 2D movement are beyond what an ordered 1D zone and a fixed zone list can represent
- Confidence: high; the official beta comprehensive rules and the site-built-map mechanic are well documented and match general knowledge of the game
SUMMARY|Sorcery: Contested Realm|2|full|resource-cards|counter|lanes|windows|grid|core|high

## Altered (2024, Equinox) — live
- Players: 2
- Turns: full (best available guess); a Day/Night cycle changes available actions each round
- Resources: resource-cards; a dedicated Mana deck reveals cards each turn to fund plays, distinct from the main deck
- Life: race; no life total — players race a Hero across three parallel board regions ("Expeditions"), winning by completing them rather than reducing an opponent's life
- Combat: none (low confidence); cards play into whichever region the Hero currently occupies and can be played "boosted" (tapped sideways) for a smaller effect, but this may be a euro-style game with no direct card-vs-card fighting at all
- Responses: none (low confidence)
- Board: lanes; three parallel regions per player that the Hero token moves between, each its own mini-zone
- Card kinds: heroes (a permanent Hero card fixing stats); unclear which record fits the region-scoped cards — possibly a new region-scoped permanent
- Hook: the board is split into three parallel regions your Hero must travel between, and winning is a race to complete all three "Expeditions," not a fight to zero life.
- Libraries sufficient: unknown; a multi-region hero-movement race resembles nothing in life.alex/life-stack.alex (both assume losing, not reaching a goal, besides WinAtCounter), so it likely needs new framework rules for regions and a movable hero-as-token
- Missing rules: unknown in detail — likely a HeroCard extension for per-region position, and a progress-based win-condition rule across three parallel tracks
- Core gaps: unknown; possibly a "unit that is also the player's own controllable, movable token" gap, similar to Sorcery's Avatar
- Fit: framework (tentative)
- Confidence: low; official rules pages, Wikipedia, and fan wikis were all unreachable this session (404s, a paywall, and an exhausted search budget); this record reflects partial pre-existing familiarity with the game rather than a read rulebook, and should be re-verified before being relied on
SUMMARY|Altered|2|full|resource-cards|race|none|none|lanes|framework|low

## Genesis: Battle of Champions (2018, Genesis Games) — live
- Players: 2
- Turns: alternating; players alternate activating one Combatant (Champion or Summon) at a time, each with its own start/main/end sub-steps, rather than fixed full turns
- Resources: other; a mix of aura (a per-champion counter pool), HP, and discarding cards from the top of the deck all serve as alternative ways to pay for actions
- Life: counter; each Champion has its own HP — losing all Champions, or decking out, loses the game
- Combat: lanes; there is no attacker/blocker pairing — a card's own printed "awareness" grid defines which squares it can affect from its current position and facing
- Responses: windows; a Combatant with a Swift ability may respond to an active or triggered ability outside the normal round structure
- Board: grid; a 5x6-space arena — Champions start on the edge in the middle column and move or rotate each turn
- Card kinds: units (Summons), heroes (Champions — mobile tokens with their own HP and awareness pattern); other printed card types (Timeline, Aura) not yet mapped to a record
- Hook: every card's threat area is a printed grid pattern relative to its own facing, so positioning and rotation, not stat comparison, decide what can be hit each turn.
- Libraries sufficient: no; nothing in the current libraries models a printed per-card area-of-effect pattern on a movable grid position, or paying costs from three heterogeneous pools (aura/HP/deck) at the player's choice
- Missing rules: Movement/rotation as a first-class action, an "awareness pattern" property read off a card to compute legal targets; resources.alex's AlternateCost covers paying another way "when a condition holds," not "any of three named pools, freely, every time"
- Core gaps: 2D grid coordinates, facing/rotation, and pattern-based adjacency — the same gap family as Sorcery's dynamic grid, but here the grid is fixed-size and the missing piece is facing/rotation plus shape-based targeting rather than dynamic construction
- Fit: core; positional facing and pattern-based targeting on a 2D grid go beyond the 1D `position` field core-operations defines
- Confidence: medium; the full rulebook PDF was too large to fetch, but phase structure, arena size, and the HP/aura/awareness mechanics were confirmed via the official rules site, a card-gamer review, and Escapist Magazine coverage
SUMMARY|Genesis: Battle of Champions|2|alternating|other|counter|lanes|windows|grid|core|medium

## Akora (2022, Akora TCG) — kickstarter
- Players: 2
- Turns: full; Start, Draw, Preparation, Attack, and End phases each turn
- Resources: resource-cards; Relic Shard cards are played to level up an Akora's stage and stats, while the Alchemy Deck supplies the hand/spell pool
- Life: counter; each player starts at 6000 Alchemist Essence, reduced by damage that exceeds an Akora's Soul Points (a defense stat)
- Combat: compare-stat; an Attack's power above the defending Akora's Soul Points deals the difference as direct damage to the opposing Alchemist's Essence
- Responses: none (low confidence)
- Board: slots; each player fields one Akora (creature) plus a Relic Shard and a Battlezone slot
- Card kinds: units (Akora, leveling up through stages via Relic Shards), spells (Alchemy cards), permanents (Battlezone cards)
- Hook: your single Akora levels up in stages by spending Relic Shard cards, and only the amount of an attack that exceeds its Soul Points ever reaches your life total, so defense scales the creature itself instead of a separate block step.
- Libraries sufficient: mostly; objects.alex's stack-onto/InheritedEffects/StackPreservesState fit Akora's staged leveling (like Digimon digivolution), combat.alex's BattleDamageByStatDifference fits the excess-damage-to-life math, and life.alex's LifeCounter fits Essence.
- Missing rules: a rule tying one specific permanent creature's own stat (Soul Points) directly into the life-damage calculation as a standing, recalculated-every-attack shield — LifeShield exists but is a separate counter, not a value read off a card's own stat
- Core gaps: none
- Fit: framework; the Soul-Points-as-living-shield mechanic needs one small new CombatRule, everything else maps onto existing evolution/life/combat rules
- Confidence: low; only secondary articles (ICv2, dotesports) and a partial rules-page fetch (menu only, no rule text) were reachable this session; the official Codex/Rules PDF could not be read
SUMMARY|Akora|2|full|resource-cards|counter|compare-stat|none|slots|framework|low
