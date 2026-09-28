# Broad survey batch 09: games 81-90 (My Little Pony CCG through Riftbound)

## My Little Pony Collectible Card Game (2013, Enterplay) — dead
- Players: 2
- Turns: full; a player's full turn spends an action-token budget on any mix of plays and moves.
- Resources: growing; action tokens each turn, sized off the higher of the two players' scores.
- Life: race; first to 15 points, scored by facing and winning Problems uncontested or in a face-off.
- Combat: compare-stat; both sides flip the top card of their draw deck and add its power to their committed Friends' total to decide a contested Problem.
- Responses: none; no source found describes an opponent's-turn response window.
- Board: lanes; shared Problem cards form a row both players commit Friends/Troublemakers to.
- Card kinds: units (Friends: power stat, no health/exhaust — closest fit); heroes (Mane character: two-sided flip card matches TwoFaces exactly); no record fits Problem or Troublemaker cards.
- Hook: a friendship-point race runs alongside ordinary card-vs-card combat, both scored off the same shared Problem cards.
- Libraries sufficient: no; Problem cards (a shared, two-sided, contested objective carrying its own score value) and the face-off compare-and-add resolution have no analogue in any library.
- Missing rules: ObjectiveCard (Problem), FaceOff (compare-stat resolution with a random top-deck add), score-scaled resource grant.
- Core gaps: none identified; the score-scaled action budget looks expressible as a hook on top of GrowingCounter, not a core change.
- Fit: framework; needs a new record and a new combat-resolution rule, no core change apparent.
- Confidence: medium; no rulebook found, built from several independent secondary summaries (Kotaku, gambiter.com) that agree on the shape of the game.
SUMMARY|My Little Pony Collectible Card Game|2|full|growing|race|compare-stat|none|lanes|framework|medium

## Transformers Trading Card Game (1995, Fleer) — dead
- Players: 2
- Turns: alternating; each side plays one character card per exchange and compares (best guess, per era-typical stat battlers).
- Resources: none; no dedicated resource system could be confirmed in any source found.
- Life: counter; likely a per-character damage/defeat counter (unconfirmed).
- Combat: compare-stat; the hook is choosing which face (alt-mode or robot-mode, each with different printed stats) to present before stats are compared.
- Responses: none; no source describes a reaction window.
- Board: none; likely hand-versus-hand, with no shared board.
- Card kinds: units (a character with two stat-bearing faces is closest, but UnitCard has no second face the way HeroCard's Face does).
- Hook: cards physically flip between an alt-mode side and a robot-mode side with different stats, and choosing which to show is itself the decision.
- Libraries sufficient: unknown; too little of the actual ruleset survives online to say.
- Missing rules: unknown, pending a primary source.
- Core gaps: unknown, pending a primary source.
- Fit: framework; best guess, since a two-faced stat-comparison game is plausible with units plus a compare-stat combat rule, but this is not verified against real rules text.
- Confidence: low; no rulebook, wiki, or contemporary review describing actual play was found (searches returned only the unrelated 2018 relaunch); this record rests on the games.md hook plus general knowledge of mid-1990s licensed stat-battler CCGs, and should be redone if a primary source turns up.
SUMMARY|Transformers Trading Card Game (1995)|2|alternating|none|counter|compare-stat|none|none|framework|low

## Transformers Trading Card Game (2018, Wizards of the Coast / Hasbro) — dead
- Players: 2
- Turns: full; one player's whole turn (untap, then a small fixed number of actions: play a card, flip a character between alt-/bot-mode, or attack) before passing.
- Resources: none; sources disagree (one summary claims an "Energon" cost) but the consistently-repeated mechanic is a fixed action count per turn, not a spent resource; treated as none at medium confidence.
- Life: counter; no shared player life total — each Character has its own health/defense stat, and a side loses when all its Characters are KO'd.
- Combat: defender-blocks; the attacker declares an attack, the defender chooses a ready Character to block (or takes it), and two Battle Cards are flipped to modify Attack/Defense.
- Responses: windows; some Action cards are usable "in response" to an attack, per secondary sources.
- Board: slots; a team of up to 25 "stars" worth of unique Characters, each independently ready/exhausted, no row/lane order.
- Card kinds: units (Character, needing a two-faced alt-/bot-mode stat record UnitCard doesn't have); spells (Action); attachments (Upgrade).
- Hook: characters flip between alt-mode and bot-mode sides, and Battle Cards chain flips into combo attacks that modify a resolving attack's numbers.
- Libraries sufficient: no; no card record supports a second stat-bearing face on a non-hero unit.
- Missing rules: a Face-like second side for UnitCard (mirrors heroes.alex's Face/TwoFaces, but on units), BattleCardFlip (a random two-card modifier draw resolving an attack).
- Core gaps: none beyond the framework gap above.
- Fit: framework; one clear new record (two-faced units) and one new combat rule.
- Confidence: medium; official Hasbro basic-rules PDF partially fetched plus wiki/review corroboration, but the resource-system detail is contested between sources.
SUMMARY|Transformers Trading Card Game (2018)|2|full|none|counter|defender-blocks|windows|slots|framework|medium

## Universal Fighting System (UFS) (2006, Jasco Games / UDE) — dead
- Players: 2
- Turns: full; Ready, Combat, and End phases each turn, one player's whole turn before passing.
- Resources: none; cards are played straight from hand at printed cost, reduced when a player holds fewer cards than their opponent — no separate resource pool or face-down resource cards.
- Life: counter; a character's starting vitality is reduced to 0 to lose.
- Combat: defender-blocks; an attack names a zone (high/mid/low) and a speed, the defender may block with a matching (full) or adjacent (half) zone card, and unblocked damage reduces vitality directly.
- Responses: chain; enhancements and further responses may be added to an attack/block in progress, resolving in reverse order.
- Board: none; just each player's hand, discard, and a momentum/damage pile built from cards taken as damage.
- Card kinds: heroes (the character card fixes starting vitality and hand size, matching HeroCard's life/hand-size fields); spells (attacks, blocks, and actions are all one-shot, matching SpellCard).
- Hook: any two "compatible" licensed fighting-game characters can be teamed in a single deck, a deckbuilding rule rather than an in-match mechanic.
- Libraries sufficient: mostly; heroes + spells + responses.Chain cover the shape, but nothing models zone-matched partial blocking or a hand-size-driven cost discount.
- Missing rules: ZoneMatchedBlock (full-zone stops all, adjacent-zone halves), HandSizeCostDiscount (a ResourcePolicy keyed to relative hand size), a damage-becomes-resource pile (life-stack's LifeStack is the closest analogue, inverted).
- Core gaps: none identified.
- Fit: framework; the pieces exist, but zone-matched blocking and the hand-size cost rule are new.
- Confidence: medium; fandom wiki summary and Wikipedia corroborate turn/attack/block shape; exact response-chain depth is not independently confirmed.
SUMMARY|Universal Fighting System (UFS)|2|full|none|counter|defender-blocks|chain|none|framework|medium

## UniVersus (2019, UVS Games) — live
- Players: 2
- Turns: full; Start, Combat, and End phases each turn.
- Resources: other; cards are played by passing a difficulty check (flip the top deck card, meet a rising threshold), optionally boosted by committing a Foundation, rather than by spending a discrete resource pool.
- Life: counter; a character's health is reduced to 0 to lose.
- Combat: defender-blocks; attacks target a high/mid/low zone with speed and damage, a same-zone block stops it, an adjacent-zone block halves it.
- Responses: alternating; starting with the attacker, players trade enhance-ability uses on cards already in play before the attack resolves.
- Board: slots; Foundations sit in a stage area, Backup characters (with their own stamina) sit alongside the main character, no row/lane order.
- Card kinds: heroes (character card fixes hand size/health); spells (attacks/actions); permanents (Foundations: stay in play, no combat stats, matches PermanentCard well); units (Backups, loosely — a stat, no combat role of their own).
- Hook: a rebooted UFS engine meant to unify many separately-licensed fighting-IP card lines under one shared rule set.
- Libraries sufficient: no; the check-to-play resolution (random draw against a rising threshold, optionally boosted) has no analogue — every existing verb assumes a flat paid cost, not a probabilistic gate.
- Missing rules: DifficultyCheckPlay (a verb replacing pay-cost with draw-and-compare, boostable by committing a Permanent), ZoneMatchedBlock (as UFS).
- Core gaps: the check-to-play mechanic may need a core-level query (a randomized legality gate before an action is taken), not just a library verb, since it changes whether an action is legal, not just what it costs.
- Fit: framework; borderline core over the check-to-play resolution.
- Confidence: medium; an official UVS Games rules-reference PDF exists but was not fully fetched — this is built from a third-party beginner's guide.
SUMMARY|UniVersus|2|full|other|counter|defender-blocks|alternating|slots|framework|medium

## Chrono Clash System (2019, UVS Games) — live
- Players: 2; a 2-4 multiplayer variant is reported.
- Turns: shared-gauge; playing a card moves a shared initiative-track marker toward the opponent, and the turn passes the moment the marker sits on their side.
- Resources: other; the shared initiative marker is itself the cost mechanism — playing a card spends "time" by moving the marker, rather than drawing on a separate pool.
- Life: counter; likely a starting-vitality character stat reduced to 0, per the shared UFS/UniVersus lineage (not independently confirmed for this ruleset).
- Combat: defender-blocks; zone-based attack/block matching UFS/UniVersus (not independently confirmed for this ruleset).
- Responses: alternating; both players may react and play cards in response to each other around the marker's movement.
- Board: none; hand/discard/stage as in UFS, no shared row or lane.
- Card kinds: heroes (character fixes vitality/hand size); spells (attacks/actions).
- Hook: the same shared initiative-marker turn-passing device as Digimon's memory gauge, but doubling as the in-game cost for playing a card.
- Libraries sufficient: mostly, for turn structure; turns.MemoryGauge already models a shared signed counter deciding whose turn it is, matching the initiative track closely.
- Missing rules: using the same gauge as a per-card cost (not just a turn-passer) has no library analogue; ZoneMatchedBlock (as UFS) if the combat guess holds.
- Core gaps: none identified.
- Fit: framework; the turn engine fits an existing rule almost exactly, the rest needs new rules.
- Confidence: low; found no primary rulebook and only thin secondary coverage (a Steam Workshop listing, a YouTube how-to-play, a tcgbridge summary); life/combat specifics are inferred from its shared design lineage with UFS/UniVersus, not confirmed for this ruleset specifically.
SUMMARY|Chrono Clash System|2|shared-gauge|other|counter|defender-blocks|alternating|none|framework|low

## Star Wars: Destiny (2016, Fantasy Flight Games) — dead
- Players: 2
- Turns: alternating; one action per turn, passing back and forth until both pass.
- Resources: other; resources are die faces (a resolved die showing a resource symbol), not cards, a growing counter, or resource cards.
- Life: counter; each character has health, and a side loses when all its characters are defeated.
- Combat: attacker-chooses; activating a character rolls its dice, then resolving a damage die lets the controller choose which enemy character or the shared Battlefield to hit, with no formal block step.
- Responses: none; a player's single action per turn, plus a few "free" card-triggered abilities, is the whole of it — no separate response window.
- Board: slots; each side's own characters (with attached upgrade dice) plus one shared Battlefield card, no row/lane order.
- Card kinds: units (characters, though stats are rolled dice rather than fixed power/health — a partial fit); attachments (Upgrades bring their own dice); spells (one-shot Support/Event cards).
- Hook: physical dice, rolled and re-rolled, are both the game's randomizer and its resource system — a card's ability only fires when its die shows the matching face.
- Libraries sufficient: no; nothing in any library models a resource or a combat outcome that comes from rolling and re-rolling a physical die rather than a card or counter.
- Missing rules: DiePool (an object's rollable faces as its own record), ResolveDie (a verb consuming one die result), a resource type built on die faces rather than cards/counters.
- Core gaps: core randomness (random.roll) is a single-die, single-purpose operation; Destiny needs pools of differently-sided dice per object, re-rolled and resolved individually, close to but not quite what exists.
- Fit: framework; possibly touches core randomness, but the object model otherwise fits units/attachments/combat cleanly.
- Confidence: medium; well-documented via SWDestinyDB's rules and UltraBoardGames, though no primary FFG rulebook text was fetched directly.
SUMMARY|Star Wars: Destiny|2|alternating|other|counter|attacker-chooses|none|slots|framework|medium

## Disney Lorcana (2023, Ravensburger) — live
- Players: 2
- Turns: full; one player's whole turn (ready, draw, then a free-form main phase: ink at most one card, quest/challenge/play/sing in any order).
- Resources: cards; any inkable card is played face-down to the Inkwell and exhausted to pay for later cards.
- Life: race; first to 20 lore wins; a separate rule ends the game outright if a player must draw from an empty deck.
- Combat: attacker-chooses; a ready Character challenges any one eligible enemy Character (Bodyguard-like Guardians must be challenged first, Evasive/Ward narrow eligibility further), damage is simultaneous.
- Responses: none; nothing is played on the opponent's turn — abilities resolve immediately, acting player's triggers first.
- Board: other; each zone (Play, Hand, Inkwell, Discard) is an unordered set, not a row, slot, lane, or grid.
- Card kinds: units (Character maps to UnitCard, but needs added lore/inkable fields UnitCard can't gain by subtyping); spells (Action/Song map to SpellCard); no record fits Item or Location (a stat-less permanent), forcing them onto bare Card.
- Hook: any card can be inked face-down for a resource, the way Force of Will and Star Wars: Unlimited play resource cards from the main deck.
- Libraries sufficient: no; confirmed in the prior deep survey (survey/lorcana.md): subtypes can only fix inherited fields, never add new ones (blocks lore/inkable), and no card record fits a stat-less permanent (blocks Item/Location).
- Missing rules: InkableOnly (resource-eligibility filter), EntersDrying (a third enter-play status, distinct from ready/exhausted), WinAtCounter-style immediate-win state check, LocationYieldsLoreEachTurn, MoveToLocation.
- Core gaps: a card subtype cannot add a new field to its parent record (only fix an existing one to a constant), which blocks per-card lore/inkable values entirely.
- Fit: framework; one real core-adjacent gap (subtypes adding fields), otherwise framework-level.
- Confidence: high; built on the prior deep survey plus the Comprehensive Rules.
SUMMARY|Disney Lorcana|2|full|cards|race|attacker-chooses|none|other|framework|high

## Star Wars: Unlimited (2024, Fantasy Flight Games) — live
- Players: 2
- Turns: alternating; the Action Phase has players alternate single actions until both pass, before a shared Regroup Phase.
- Resources: cards; any card may be played face-down as a resource and exhausted to pay costs.
- Life: counter; each side's Base has hit points, and a side loses at 0.
- Combat: attacker-chooses; an attacking unit (ground or space) hits an enemy unit, the enemy Base, or the enemy Leader, with no formal block step (Sentinel forces attacks its way, like Guardian).
- Responses: none; almost all cards play only on the acting player's own turn, at sorcery speed, with no general stack.
- Board: lanes; two parallel, independent arenas (Ground and Space) that a unit belongs to and mostly cannot cross.
- Card kinds: units (ground/space Unit cards); spells (Event cards); attachments (Upgrade cards); heroes (Leader: two-sided, deployed from a fixed pregame zone into play, matching HeroCard/Face/TwoFaces closely); the Base (a stat-bearing permanent fixed per deck) fits no record (PermanentCard has no health).
- Hook: combat is split across two linked arenas (Ground and Space) that share a win condition (the Base) but are otherwise separate battles.
- Libraries sufficient: mostly; heroes.TwoFaces fits the Leader closely, but the two-arena split and the Base's stats need new pieces.
- Missing rules: TwoArenaCombat (a CombatRule restricting targeting/movement to same-arena units), a stat-bearing permanent for the Base (PermanentCard extended with health), LeaderDeploy (moving a Leader from a fixed pregame zone into play as a unit).
- Core gaps: none beyond the same "permanent record has no stats" gap noted for Lorcana's Locations.
- Fit: framework; well-covered by existing libraries plus a couple of new rules.
- Confidence: high; well-documented rules, current live game.
SUMMARY|Star Wars: Unlimited|2|alternating|cards|counter|attacker-chooses|none|lanes|framework|high

## Riftbound: League of Legends TCG (2025, Riot Games / UVS Games) — live
- Players: 2; a team variant scoring to 11 exists.
- Turns: full; Awaken/Beginning/Channel/Draw sub-phases then an Action Phase and End of Turn, one player's whole turn before passing.
- Resources: resource-cards; Runes are drawn from a separate 12-card deck each turn and either exhausted for colorless Energy or recycled to the deck's bottom for colored Power.
- Life: race; first to 8 victory points (11 in team play), scored by controlling Battlefields uncontested at the start of a turn.
- Combat: lanes; units move onto a shared Battlefield, and any Battlefield holding units from both sides triggers a Showdown where each side's total Might is compared and dealt as damage.
- Responses: chain; Reaction-speed cards can be played on any player's turn during a Showdown's chain, resembling instant-speed play; Action-speed cards are limited to Showdowns.
- Board: lanes; several shared Battlefield zones sit between the players' own Base/Legend/Champion/Rune zones, and control of them (not player life) is the win condition.
- Card kinds: heroes (Champion plus a separate permanent Legend zone; Champions reportedly level up mid-game, matching heroes.TwoFaces conceptually, though the exact trigger wasn't confirmed); units (board units with Might/health); spells (Action/Reaction cards); attachments (Gear).
- Hook: Champion cards level up mid-match the way a MOBA hero levels up, changing their printed stats/abilities partway through a game.
- Libraries sufficient: no; a multi-Battlefield board where control (not life) scores points each turn, and where combat is triggered by movement into a contested shared zone, has no existing analogue (combat.alex assumes units attack each other or a life total, not a race to hold shared zones).
- Missing rules: BattlefieldControl (a state-check-driven scoring rule, not a win-at-counter), Showdown (movement-triggered simultaneous-Might combat in a shared zone), ChampionLevelUp (a HeroRule beyond TwoFaces if the trigger is a running counter rather than a one-time condition).
- Core gaps: none identified, though BattlefieldControl scoring may need active-rules-style querying of multiple shared zones each round.
- Fit: framework; the shared, scored Battlefield-lane structure is the real gap.
- Confidence: medium; the game shipped in 2025, past this survey's easy reach — built from the official quick-start guide and a third-party how-to-play, not the full rules reference; champion-leveling specifics are unconfirmed.
SUMMARY|Riftbound: League of Legends TCG|2|full|resource-cards|race|lanes|chain|lanes|framework|medium
