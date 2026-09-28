# Broad survey batch 04: Hercules CCG, Spycraft CCG, Match Attax, NBA Adrenalyn XL, Cricket Attax, AGoT CCG/LCG, Call of Cthulhu LCG, Android: Netrunner, The Lord of the Rings LCG

## Hercules: The Legendary Journeys (1998, Wizards of the Coast) — dead
- Players: 2
- Turns: full; a "simplified Deckmaster system" (the same engine WotC used for Xena and C-23), so
  likely untap/draw/main/combat/end, one player active per turn.
- Resources: resource-cards; dedicated Resource cards played like Magic land, tapped for cost.
- Life: counter; a life/health total reaches zero, by analogy with the Deckmaster template.
- Combat: attacker-chooses+defender-blocks; tapped Character cards attack, opponent blocks — the
  Deckmaster-standard pattern; not confirmed for this specific game.
- Responses: windows; Action cards likely play at instant speed, but no rulebook text found.
- Board: slots; Character and Combat (equipment) cards sit in a tapped/untapped play area.
- Card kinds: units (Character), spells (Action), attachments (Combat cards); Resource cards fit
  no existing record (plain `Card` + resources library's `ResourceCards` rule, no dedicated type).
- Hook: licensed reskin of a generic Deckmaster engine around completing mythic "labor" quest
  objectives — the labor/quest win condition itself could not be confirmed from any source.
- Libraries sufficient: mostly; common + units + resources + combat cover the inferred Magic-like
  core cleanly if the inference holds.
- Missing rules: an objective/quest-completion win condition (labors) — no library has one; would
  sit beside `WinAtCounter` as a new `LifeRule` or `Rule` if the labor mechanic is confirmed.
- Core gaps: none apparent.
- Fit: framework; nothing here needs core, but the central "labor" hook is unverified.
- Confidence: low; only a Wikipedia stub found (card types, tapping, "simplified Deckmaster"); no
  rulebook or card scans; turn structure, combat, win condition and the labor mechanic are all
  inferred from the Deckmaster-clone description, not sourced directly.
SUMMARY|Hercules: The Legendary Journeys|2|full|resource-cards|counter|attacker-chooses+defender-blocks|windows|slots|framework|low

## Spycraft Collectible Card Game (2004, Alderac Entertainment Group) — dead
- Players: 2
- Turns: alternating; Intel Phase has players alternate single actions (recruit, requisition,
  play an Action, brief a leader, run a mission) until both pass, then a shared Debrief Phase.
- Resources: none; no mana/currency — Agents/Gear are recruited directly as one of a turn's
  limited actions, gated by the acting player's skill totals (charisma/combat/transport/craft).
- Life: race; first to 20+ Victory Points, earned by completing or blocking Missions.
- Combat: compare-stat; a Mission pits declared teams' skill totals against each other, both
  sides alternate Mission actions that modify the totals, higher total left standing wins.
- Responses: windows; "Reacts" are playable outside normal sequence in reply to a named trigger,
  limited to once per turn (Intel) or once per Mission.
- Board: slots; a leader pool, an agent/gear play area, and a shared face-up mission queue.
- Card kinds: units (Agents/Leaders, though they never fight directly), spells (Actions),
  attachments (Gear); Missions fit no existing record — a shared objective card resolved by
  skill-total contest, not a unit, spell, attachment or permanent.
- Hook: agents, gear, most missions and leaders enter play face-down with a declared (possibly
  false) card type, revealed only later — bluffing is load-bearing, not flavor.
- Libraries sufficient: mostly; common + the VP-race `WinAtCounter` (life.alex) cover the shell.
- Missing rules: a Mission record and its skill-total contest resolution, and a "declared,
  possibly-false face-down type" rule for the bluffing mechanic.
- Core gaps: none; the bluff can be modeled with the existing face-down/`reveal` operation plus a
  new public "declared type" field the object carries until revealed.
- Fit: framework; two new record/rule areas (Missions, declared-type bluffing), no core change.
- Confidence: high; official rulebook text and a detailed BGG page were both available.
SUMMARY|Spycraft Collectible Card Game|2|alternating|none|race|compare-stat|windows|slots|framework|high

## Match Attax (2007, Topps) — live
- Players: 2
- Turns: simultaneous; each round an attacker and defender (roles alternate) each pick one card
  from their fixed line-up and reveal; the stat comparison decides the round, then the next pair.
- Resources: none; a card is picked from a pre-built formation, never bought or paid for.
- Life: counter; goals scored each round tally in a counter, compared after the line-up is used
  up — a scoreline, not a life total to protect or a fixed race threshold.
- Combat: compare-stat; higher printed Attack stat vs. the defender's Defence stat wins the round
  (tie-break direction is inconsistent across sources).
- Responses: none.
- Board: slots; a fixed formation (manager, keeper, defenders, midfielders, forwards, subs), one
  card per position slot, not a shared or contested play area.
- Card kinds: none of units/spells/attachments/permanents/heroes fit well — cards never enter
  play, take damage, or persist; they are one-shot two-stat comparison cards. Needs a new,
  lightweight "StatCard" kind with no cost/health/combat-damage concept.
- Hook: deckbuilding is squad selection into fixed formation slots (a legal lineup), not a sized
  deck with copy limits; the "match" is a sequence of single-card stat duels, no board state.
- Libraries sufficient: no; units/combat assume persistent, damageable objects this game lacks.
- Missing rules: a StatCard record (two comparable stats, no persistence), formation-based squad
  construction (position-slot deckbuilding, not `DeckSize`/`CopyLimit`).
- Core gaps: none; this is squarely new records and a new deck-construction rule.
- Fit: framework; needs a new card kind and squad-construction rule, but nothing core-level.
- Confidence: medium; several "how to play" pages agree on the shape; the tie-break rule and
  exact round sequencing are not fully consistent across sources.
SUMMARY|Match Attax|2|simultaneous|none|counter|compare-stat|none|slots|framework|medium

## NBA Adrenalyn XL (2010, Panini) — dead
- Players: 2
- Turns: simultaneous; same stat-duel shape as Match Attax — no phases, just round-by-round card
  picks from a pre-built line-up, revealed and compared.
- Resources: none; no cost to field a card.
- Life: counter; a match-score tally (points), not a life total to defend.
- Combat: compare-stat; Attack/Control/Defence-type values compared card vs. card; ties fall to a
  secondary total-value comparison.
- Responses: none.
- Board: slots; a starting line-up plus substitutes, position-limited like a fantasy roster.
- Card kinds: same gap as Match Attax — no existing kind fits a one-shot two-stat comparison
  card; also needs a "Combo" concept for cards that score a bonus when fielded together.
- Hook: designated "combo" cards pair for a scoring bonus on top of the base stat duel — the one
  mechanic beyond plain Match-Attax-style comparison.
- Libraries sufficient: no; same reasons as Match Attax.
- Missing rules: StatCard record, roster/line-up construction rule, a paired-card "Combo" bonus
  rule (no library has cross-card scoring bonuses tied to fielding two specific cards together).
- Core gaps: none.
- Fit: framework.
- Confidence: low; the NBA-specific rules page was blocked; this is inferred from Panini's shared
  cross-sport Adrenalyn XL engine (verified via the football version) by strong analogy, with
  exact roster size and combo bonus values unconfirmed.
SUMMARY|NBA Adrenalyn XL|2|simultaneous|none|counter|compare-stat|none|slots|framework|low

## Cricket Attax (2017, Topps) — live
- Players: 2
- Turns: simultaneous; the same Topps ATTAX stat-duel engine as Match Attax, cricket-themed.
- Resources: none.
- Life: counter; runs/score tally compared after the line-up is used, not a defended life total.
- Combat: compare-stat; batting stat vs. bowling stat (or similar paired stats) decides each
  round, standing in for Attack/Defence.
- Responses: none.
- Board: slots; a lineup of batsmen, bowlers, all-rounders and a wicket-keeper in fixed slots.
- Card kinds: same gap as Match Attax — a StatCard kind, not units/spells/attachments/permanents.
- Hook: identical structural hook to Match Attax, reskinned for cricket batting/bowling lineups.
- Libraries sufficient: no; same reasons as Match Attax.
- Missing rules: StatCard record, lineup-slot squad construction.
- Core gaps: none.
- Fit: framework.
- Confidence: low; no cricket-specific rules text was found; this is inferred from the confirmed
  Match Attax engine by strong analogy (same publisher, explicitly the same format adapted).
SUMMARY|Cricket Attax|2|simultaneous|none|counter|compare-stat|none|slots|framework|low

## A Game of Thrones CCG (1st Edition) (2002, Fantasy Flight Games) — dead
- Players: 2
- Turns: full; Draw, Marshalling (play cards, gain gold), Challenges (Military/Intrigue/Power),
  Dominance, Standing — one player active per round in a fixed phase order; no Plot phase (that
  is a 2008 LCG addition).
- Resources: resource-cards; gold comes from Location cards played into play, spent only in your
  own Marshalling phase and not carried to later rounds.
- Life: race; first to 15 Power tokens (on the House card and characters) wins.
- Combat: attacker-chooses+defender-blocks; attacker kneels characters with a matching icon to
  declare a challenge type, defender kneels characters to oppose, higher total STR wins; losing a
  Military challenge kills characters, Intrigue forces discards, Power transfers Power tokens.
- Responses: windows; some cards can cancel or interrupt an effect, exact terminology unconfirmed.
- Board: none; no lanes or grid — characters and Locations sit in each player's own play area.
- Card kinds: units (Character), permanents (Location), attachments (Attachment), spells (Event);
  all four record kinds map cleanly. House cards fit no existing kind (a fixed per-player card
  that starts in play and holds the Power counter).
- Hook: three parallel challenge types each round (Military/Intrigue/Power) let the same
  characters be used for different attacks with different consequences, not just damage.
- Libraries sufficient: mostly; the four card kinds and `resources.ResourceCards`/`life.WinAtCounter`
  cover the shell cleanly.
- Missing rules: distinct per-challenge-type consequences (kill vs. discard vs. steal-a-counter)
  beyond `combat.alex`'s single damage-based resolution; a House-card kind holding shared Power.
- Core gaps: none; three challenge types are three `CombatRule` variants, not a core change.
- Fit: framework.
- Confidence: medium; general knowledge of the CCG/LCG design plus a Wikipedia check; not
  rulebook-verified for 1st-edition-specific wording (e.g. the response/interrupt system).
SUMMARY|A Game of Thrones CCG (1st Edition)|2|full|resource-cards|race|attacker-chooses+defender-blocks|windows|none|framework|medium

## A Game of Thrones: The Card Game (LCG) (2008, Fantasy Flight Games) — dead
- Players: 2
- Turns: full; Plot, Draw, Marshalling, Challenges (Military/Intrigue/Power), Dominance,
  Standing, Taxation — adds a Plot phase and Taxation on top of the 1st-edition CCG's shell.
- Resources: other; each of the 7 cards in a player's Plot deck is revealed face-up
  simultaneously each round and sets that round's gold pool and initiative/claim — a resource
  amount set by a hidden card revealed once per round, not paid from hand or drawn from a
  dedicated resource-card pool.
- Life: race; first to 15 Power tokens, same as 1st edition.
- Combat: attacker-chooses+defender-blocks; the same Challenge system carries over unchanged.
- Responses: windows; a defined priority/interrupt-and-reaction system around triggered abilities.
- Board: none; no lanes or grid, same as 1st edition.
- Card kinds: units (Character), permanents (Location), attachments (Attachment), spells (Event);
  Plot cards fit no existing kind — a hidden, simultaneously-revealed per-round card that sets
  economy and triggers a one-time effect, unlike anything in the libraries.
- Hook: the simultaneous Plot-card reveal each round is the signature addition over the CCG — a
  small, fixed pool of pre-built resource/effect cards each player cycles through the whole game.
- Libraries sufficient: mostly; same as 1st edition for the four ordinary card kinds.
- Missing rules: a PlotCard record and a "simultaneous reveal sets this round's parameters" rule;
  the same per-challenge-type consequences gap as 1st edition.
- Core gaps: none; simultaneous reveal is expressible with the existing `reveal` operation plus a
  round-start moment; a new record type is framework work, not a core change.
- Fit: framework.
- Confidence: medium-high; well-known LCG from general knowledge, cross-checked against a
  Wikipedia summary of the CCG-to-LCG phase differences.
SUMMARY|A Game of Thrones: The Card Game|2|full|other|race|attacker-chooses+defender-blocks|windows|none|framework|medium

## Call of Cthulhu: The Card Game (2004, Fantasy Flight Games) — dead
- Players: 2
- Turns: full; a round of readying, drawing, and resolving several shared Story cards in turn.
- Resources: other; each player attaches resource cards from hand onto blank "Domain" cards, then
  drains a Domain to spend it on a card of the matching faction (neutral cards pay from any
  Domain) — a dual typed-pool resource, not a single resource-card or growing-counter pattern.
- Life: race; a player wins by taking 3 of the shared Story cards (each won by accumulating 5
  success tokens in a struggle); an alternate loss is decking out (drawing with an empty deck).
- Combat: compare-stat; characters committed to a Story struggle by icon totals, higher total
  wins the struggle rather than any unit-vs-unit blocking exchange.
- Responses: windows; triggered abilities with fixed interrupt/reaction timing, typical of FFG's
  early LCG template.
- Board: row; a shared row of Story cards both players commit characters to each round.
- Card kinds: units (Character), permanents (Support), spells (Event); Story cards fit no
  existing kind — a shared, unowned objective card contested by icon totals from both sides.
- Hook: two separate typed resource Domains per player, both spent into the same shared row of
  Story cards that are struggled over by icon totals, not owned or attacked directly.
- Libraries sufficient: mostly for Character/Support/Event; the Story-card struggle needs a new
  area entirely.
- Missing rules: a StoryCard record, a dual-Domain typed-resource rule, an icon-total struggle
  resolution (distinct from `combat.alex`'s unit/hero/life damage model).
- Core gaps: a genuinely open question — Story cards belong to neither player, but
  `core-operations.object-fields` requires every object to have an `owner: player` and a
  `controller: player`; a shared, player-less objective object may need a "the game" pseudo-owner
  the core does not currently define. Worth a core discussion, not just a new library rule.
- Fit: framework; the owner-field question above is the one thing that could push this to `core`.
- Confidence: medium; the Story/struggle/win-condition shape is confirmed (Wikipedia), but the
  exact Domain-count and per-turn Domain-resolution mechanics could not be verified this session
  (fan wikis with the fuller rules text were unreachable).
SUMMARY|Call of Cthulhu: The Card Game|2|full|other|race|compare-stat|windows|row|framework|medium

## Android: Netrunner (2012, Fantasy Flight Games) — dead
- Players: asym; Corp and Runner have different card pools, zones, and legal actions.
- Turns: full; each side's turn is spent on a fixed number of "clicks" (Corp usually 3, Runner 4)
  on actions like install, advance, play, draw, or gain a credit, ending when clicks run out.
- Resources: other; credits are a counter spent to install or play cards, gained by spending a
  click (an explicit action), not an automatic per-turn growth and not from dedicated resource
  cards.
- Life: race; first to 7 Agenda points wins; a Runner can also be eliminated by unpreventable
  damage ("flatlined") and a Corp can lose by decking out — two extra loss conditions past a
  simple counter.
- Combat: defender-blocks; the Runner "runs" a server and encounters the Corp's ICE programs in
  order like ordered blockers, resolving subroutines rather than comparing a stat or trading
  damage between two cards.
- Responses: windows; a fixed sequence of steps within a run (approach, encounter each ICE,
  access) is where each side may use abilities, rather than a LIFO stack.
- Board: lanes; each Corp server (HQ, R&D, Archives, or any number of remote servers) is a lane
  of ordered ICE the Runner must pass through to reach what is installed in or behind it.
- Card kinds: permanents (installed Corp/Runner cards with static or activated abilities), spells
  (Operations/Events); no unit-vs-unit combat exists, so `units`/`combat` barely apply. Agenda
  cards (stolen for victory points) and ICE (encountered in an ordered lane with subroutines) fit
  no existing kind.
- Hook: the Corp secretly installs cards face-down (unrezzed) and the Runner spends the whole
  game deciding whether a run is worth the risk of an unknown, possibly-devastating ICE or trap.
- Libraries sufficient: no; the entire run/ICE-encounter loop, the click-based action economy,
  and the fully asymmetric card pools have no equivalent in any current library.
- Missing rules: a Run/ICE-encounter mechanic (approach, encounter, break-subroutine), an Agenda
  record and scoring rule, a click-based action-economy rule (distinct from `resources.alex`'s
  currency model), face-down "installed, later rezzed" reveal, and asymmetric per-side action
  sets.
- Core gaps: none required — `filter-actions` can restrict each side to its own action set and
  `before`/`after-operation` hooks can drive the ordered-ICE encounter — but this is the largest
  and most novel framework build of the ten games surveyed.
- Fit: framework; core's object model, operations and hooks look sufficient, though this is the
  most speculative "no core change needed" call in this batch given how little overlaps existing
  libraries.
- Confidence: high on the rules (well-known game); medium on the fit judgment, since so little of
  it maps onto existing library vocabulary.
SUMMARY|Android: Netrunner|asym|full|other|race|defender-blocks|windows|lanes|framework|high

## The Lord of the Rings: The Card Game (LCG, cooperative) (2011, Fantasy Flight Games) — live
- Players: 2+ (rules support 1-4; solo play is the same rules with one player running a full
  hand); no vocabulary entry covers 1, so 2+ is the closest fit.
- Turns: full; all players share one round of fixed phases (Resource, Planning, Quest, Travel,
  Encounter, Combat, Refresh) that they resolve together; the "opponent" (the Encounter deck)
  never takes a turn, it only reacts through printed, automatic rules at fixed points.
- Resources: growing; each hero generates 1 resource of its icon every Resource phase, unspent
  resources carry over, spent later to pay for allies, attachments and events.
- Life: counter; each hero has health (damage defeating a hero; all heroes defeated loses for
  that player); separately, a shared threat counter rises every round and a loss occurs at 50 —
  a second loss condition on top of hero health.
- Combat: attacker-chooses+defender-blocks; in the Combat phase enemies (from the Encounter deck)
  attack and a player chooses a defender or takes it unopposed, and players may also declare
  attacks against engaged enemies.
- Responses: windows; abilities resolve at defined interrupt/response points, not a full stack.
- Board: slots; a staging area holds one slot per revealed enemy/location card; each player has
  their own area for heroes, allies and attachments.
- Card kinds: heroes (Hero cards, with an activated "Exhaust" ability matching `heroes.alex`'s
  `PowerOncePerRound` pattern), units (Ally), attachments (Attachment), spells (Event); the
  Encounter deck's Enemy/Location/Treachery cards and the Quest cards defining the scenario fit
  no existing kind — they belong to no player and act only via scripted, automatic rules.
- Hook: the "opponent" is a fully automated Encounter deck with no agency of its own — enemies
  engage and attack, locations must be explored, and treacheries fire, all by printed, scripted
  rules rather than a second player's choices.
- Libraries sufficient: mostly for the player side (heroes/units/attachments/spells fit well);
  the automated-adversary side (staging, engagement, quest progress, threat) has no equivalent.
- Missing rules: Encounter/Quest card records, an automated-opponent behavior rule (enemies act
  by fixed rule at fixed phases, not player choice), a shared rising ThreatCounter causing loss,
  and a quest-progress counter (willpower committed vs. points needed to advance the quest).
- Core gaps: none needed to host the cooperative shape — the core's `state-check` query and
  `before`/`after-operation` hooks can drive "automatic" enemy behavior without treating the
  Encounter deck as an acting player, so `next-actor`/`legal-actions` never need to name it. This
  is a large new library area, not a change to what the core can express.
- Fit: framework; explicitly not `out` — the two-or-more-players loop hosts real players
  cooperating, and the "opponent" is realized as rule-triggered automatic behavior rather than an
  actor, which the existing hook points already support.
- Confidence: high; well-known game, phase structure and core loop confirmed from general
  knowledge.
SUMMARY|The Lord of the Rings: The Card Game|2+|full|growing|counter|attacker-chooses+defender-blocks|windows|slots|framework|high
