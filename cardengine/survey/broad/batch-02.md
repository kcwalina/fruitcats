# Broad survey batch 02: Netrunner, Rage, BattleTech CCG, Babylon 5 CCG, Shadowfist, Highlander, Star Trek: The Card Game, Doomtown, Dune CCG, 7th Sea CCG

## Netrunner (1996, Wizards of the Coast) — dead
- Players: asym; Corp and Runner use entirely different card pools and win conditions.
- Turns: full; each side takes a complete turn (draw, play/install, act) in strict alternation.
- Resources: other; a per-turn credit ("bits") allowance from a basic action, topped up by playing
  permanent "economy" cards that pay out more credits when used; no dedicated resource-card zone.
- Life: race+counter; Corp wins at 7 agenda points or the Runner deck-outs (race); either side can
  also "flatline" the other (a hand/brain-damage deficit), an alternate counter-based loss.
- Combat: compare-stat; the Runner's icebreaker strength must meet/exceed each ice's strength,
  encountered one at a time in a fixed order, to break it and bypass its subroutines.
- Responses: windows; traps and tricks fire at fixed moments (on access, on approach), not a full
  interrupt stack.
- Board: lanes; each Corp server (HQ, R&D, Archives, any number of remotes) is its own lane with an
  ordered line of ice the Runner must break through front-to-back.
- Card kinds: permanents (ice, assets, upgrades, installed programs, agendas awaiting score),
  spells (Corp operations, Runner events); no clean unit/attachment/hero fit.
- Hook: two players build and play completely different decks under completely different rules,
  racing along asymmetric win conditions (agenda points vs. stolen agenda points).
- Libraries sufficient: mostly; permanents/spells/life cover most of it cleanly.
- Missing rules: ordered-obstacle traversal per zone (breaking ice one at a time before reaching
  the server), install-face-down-then-advance (agendas advance in secret before scoring), a
  credit-allowance-plus-economy-card resource rule.
- Core gaps: none; ordered per-zone obstacles and face-down advancing objects are expressible with
  existing zones, `under`/ordering, and hooks.
- Fit: framework; needs new resource, ice-traversal, and hidden-advancement rules, no core change.
- Confidence: medium; general knowledge of the 1996 game plus Wikipedia/fan summaries, not the
  original rulebook itself.
SUMMARY|Netrunner|asym|full|other|race+counter|compare-stat|windows|lanes|framework|medium

## Rage (1995, White Wolf Publishing) — dead
- Players: 2; head-to-head packs of Garou, though multiplayer chronicles existed.
- Turns: full; each player's turn gains Rage/Gnosis, draws, plays cards, then fights.
- Resources: resource-cards; played Garou/spirit characters generate Gnosis and Rage pools each
  turn, spent like lands/energy to fund gifts, rites, and fetishes.
- Life: none; no player life total — a player loses when their pack and Caern (home turf) are
  destroyed, while individual characters track their own wound levels separately.
- Combat: defender-blocks; a declared attacker is met by a defending character the opponent
  chooses, with Gifts and Rage spends modifying the exchange.
- Responses: stack; cards played "at any time" (Gifts, rites) can answer an opponent's play before
  it resolves, era-typical of post-Magic CCGs.
- Board: other; a physical/Caern zone runs in parallel with a mirrored Umbra (spirit world) zone,
  crossed by paying a Gauntlet cost.
- Card kinds: units (Garou characters with a wound track instead of a single health number),
  attachments (Gifts/fetishes on a character), permanents (Caerns/locations), spells (rites).
- Hook: a parallel spirit-world zone (the Umbra) that cards can cross into and out of by paying the
  Gauntlet, doubling the effective board.
- Libraries sufficient: mostly; units/attachments/permanents cover characters and gear.
- Missing rules: a mirrored second zone reachable by a paid crossing (Umbra/Gauntlet), a per-unit
  multi-box wound track finer than a single damage counter, a Caern-destruction loss condition.
- Core gaps: none; a second zone plus a crossing cost and a multi-step counter are library-level.
- Fit: framework; the parallel-zone and wound-track rules do not exist in any current library.
- Confidence: low; the official rules PDF was unreachable, so this rests on general knowledge of
  the Werewolf: The Apocalypse setting and a partial fan rules index.
SUMMARY|Rage|2|full|resource-cards|none|defender-blocks|stack|other|framework|low

## BattleTech (CCG) (1996, Wizards of the Coast) — dead
- Players: 2.
- Turns: full; Untap, Draw (2 cards), Repair/Reload, Deploy, Mission, End of Turn, Magic-like.
- Resources: resource-cards; dedicated Resource cards (of five types) are played and tapped during
  Deploy to fund 'Mechs, vehicles, pilots, and command/support cards.
- Life: stack; each player's draw deck ("stockpile") is their life total, drawn down two per turn
  and further depleted by direct attacks on it; running out loses the game.
- Combat: attacker-chooses; a 'Mech or unit may attack any legal target freely — an opposing unit,
  a site/resource, or the stockpile itself — with Mission "instant" cards giving an edge.
- Responses: windows; Mission cards playable at instant speed answer an attack or deployment.
- Board: slots; each player's sites/resources and deployed units sit in an open permanents area,
  with no lanes or grid.
- Card kinds: units ('Mech/vehicle/battle-armor chassis with power stats), attachments (weapon
  cards attach to a chassis to grant its attack values, per the source hook), permanents (sites,
  resources, pilots), spells (Mission instants).
- Hook: a chassis card has no attack of its own until a separate weapon card is attached to it,
  so deckbuilding is picking loadouts, not just picking units.
- Libraries sufficient: yes; units+attachments model chassis/weapons directly, resources.alex's
  `ResourceCards` covers the five resource types, and life-as-a-stack plus `LifeDamage` on a
  `life` CombatTarget covers attacking the stockpile.
- Missing rules: none found beyond what units/attachments/resources/life already name.
- Core gaps: none.
- Fit: libraries; every distinguishing mechanic maps onto an existing library rule type.
- Confidence: medium; Sarna and fan-history sources confirm structure and the chassis+weapon hook,
  but exact resource-type names and dice details were not independently verified.
SUMMARY|BattleTech|2|full|resource-cards|stack|attacker-chooses|windows|slots|libraries|medium

## Babylon 5 Collectible Card Game (1997, Precedence Entertainment) — dead
- Players: 2+; explicitly designed for more than two, 4-5 called ideal.
- Turns: full; turn order runs by ascending influence, each player taking a complete turn before
  the next.
- Resources: growing; Influence is a persistent counter built up over the game and spent to play
  cards, acquire favors, and raise Power.
- Life: none; no life total or elimination by damage — the game is decided by agenda fulfillment
  and accumulated Power/Influence dominance among all players.
- Combat: compare-stat; a declared conflict totals support versus opposition freely committed by
  any player's characters/fleets that rotate in, and the higher total wins.
- Responses: windows; any player may rotate cards to support or oppose once a conflict is open.
- Board: none; characters, fleets, and the agenda sit in each player's own area with no shared
  positional zones or adjacency.
- Card kinds: units (characters and fleets with support/oppose values), permanents (the agenda,
  holdings), spells (events); no attachment/hero record fits the "promote to inner circle" step.
- Hook: any player at the table, not just the two sides of a declared conflict, may pledge support
  or opposition to it, turning combat into an open multiplayer vote.
- Libraries sufficient: no; combat assumes a single attacker and a chosen/blocking defender, not
  an open pledge from the whole table.
- Missing rules: an open multi-party tally CombatRule (anyone may add to either side of a
  conflict), an agenda-fulfillment win condition distinct from any life/counter rule on file.
- Core gaps: none required; `all` already yields every player, so an open-pledge tally is a new
  CombatRule and win-condition hook, not a change to the object model.
- Fit: framework; needs a genuinely new multiplayer conflict-tally rule and an agenda win rule.
- Confidence: low; fandom rules pages were unreachable, so this rests on the Wikipedia summary and
  general knowledge of political multiplayer CCGs of the era.
SUMMARY|Babylon5|2+|full|growing|none|compare-stat|windows|none|framework|low

## Shadowfist (1995, Daedalus Entertainment; now Z-Man Games) — live
- Players: 2+; wins at 6 controlled Feng Shui sites in a 2-player game, 5 with more players.
- Turns: full; each turn generates Power from controlled sites, then plays cards and attacks.
- Resources: resource-cards; controlled Feng Shui sites generate Power each turn like lands, and
  characters in play separately provide the Tech/Magic/Chi talent a card's cost may also require.
- Life: race; first to control 5 (or 6, two-player) Feng Shui sites wins; a player reduced to no
  sites and no way to take one is out.
- Combat: attacker-chooses; an attacking character targets any character or site, and combat
  resolves through characters and event cards committed in response.
- Responses: stack; Shadowfist resolves everything LIFO, so any card can answer any other in
  progress, a full stack rather than fixed windows.
- Board: slots; sites are the contested slots that change owner as the game's core objective.
- Card kinds: units (characters), permanents (Feng Shui sites, other resources), spells (events);
  no attachment record is prominent in the base game.
- Hook: winning is capturing a fixed number of site permanents from opponents, not reducing a life
  total, so combat's purpose is territory capture.
- Libraries sufficient: mostly; `Stack` (responses.alex) and `WinAtCounter` (life.alex) cover the
  LIFO resolution and the race-to-n-sites win condition directly.
- Missing rules: a CaptureSite verb that changes a permanent's controller on a won attack — owning
  and controller-changing a site by combat isn't modeled by any current verb.
- Core gaps: none; controller is already a first-class object field core-operations.alex tracks.
- Fit: framework; only the capture-by-combat verb is missing, everything else already fits.
- Confidence: medium; official errata/FAQ pages and general familiarity with the game confirm the
  Power/site-race structure and LIFO resolution.
SUMMARY|Shadowfist|2+|full|resource-cards|race|attacker-chooses|stack|slots|framework|medium

## Highlander: The Card Game (1995, Thunder Castle Games) — dead
- Players: 2; a direct duel between two Immortals, each represented by the player, not a card.
- Turns: alternating; players trade attacker/defender roles card by card rather than full turns.
- Resources: none; cards are played straight from hand with no separate cost, limited only by hand
  size (capped at current Ability).
- Life: counter; 15 starting Ability points double as life and hand-size cap; 0 or below is a loss,
  as is being hit by an unblocked Head Shot.
- Combat: other; the attacker picks one of nine grid cells to strike, the defender must play a
  block/dodge card covering that cell or take fixed damage (2, or 4 for a Power Blow).
- Responses: windows; the defender answers each attack with a block/dodge in a fixed window before
  damage applies.
- Board: none; no board of permanents — this is a direct player-vs-player duel using hand cards.
- Card kinds: spells only; every attack/block/event resolves straight against the opposing player,
  with no unit, permanent, attachment, or hero record needed since the Immortal is the player.
- Hook: "there can be only one" becomes literal — a single named card (Head Shot), unblocked, wins
  the game outright regardless of remaining Ability.
- Libraries sufficient: no; there is no unit/permanent layer at all, only player-targeted spells.
- Missing rules: a grid-cell attack/block matching CombatRule (nothing in combat.alex models a
  positional matching puzzle between named zones), an instant-win single-card win rule.
- Core gaps: none; cell-matching is a Filter/predicate concern, not an object-model limitation.
- Fit: framework; needs a new CombatRule type and an instant-win life rule, no core change.
- Confidence: low; based on a single fan-hosted "Movie Edition" rules page rather than an official
  tournament rulebook.
SUMMARY|Highlander|2|alternating|none|counter|other|windows|none|framework|low

## Star Trek: The Card Game (1996, Fleer/SkyBox International) — dead
- Players: 2; a Current Player running an episode against a Challenging Player.
- Turns: full; the Current Player plays a Mission, then a Plot, then a Discovery, each answered by
  the Challenger's Challenge cards, before the episode phase ends and roles/scoring settle.
- Resources: none; cards are played in a fixed Mission/Plot/Discovery sequence gated by which crew
  are on the bridge, not by a spent cost.
- Life: race; first player to accumulate 25+ XC (competence points awarded onto specific crew
  cards after each episode) wins.
- Combat: attacker-chooses; the Challenger picks Challenge cards (Attack, Capture, Negotiate,
  Ambush, and others) the Current Player's crew must resolve or suffer for.
- Responses: windows; Challenges form a fixed reaction window after each Mission/Plot/Discovery.
- Board: none; crew and the ship sit in each player's own area, not a shared zone layout.
- Card kinds: units (crew members with stats), permanents (ship, active Mission/Plot/Discovery),
  spells (Challenges); bridge/core crew resemble a privileged unit tier, not a distinct record.
- Hook: an episode is assembled turn by turn from Mission/Plot/Discovery cards the opponent tries
  to defeat with matched Challenges, scored directly onto individual crew cards.
- Libraries sufficient: no; the win total lives on specific unit objects, not a player counter.
- Missing rules: a Mission/Plot/Discovery "episode" phase sequence (turns.alex's Phases/Steps can
  model the segments, but each needs its own opposed-challenge sub-resolution); a life/win rule
  that sums a counter across chosen unit objects rather than tracking one player-level counter.
- Core gaps: possible; game-over currently is a query hook a rule answers, and summing counters
  across a set of objects to produce that answer is not an documented Property pattern, though it
  is not explicitly disallowed either.
- Fit: framework; the episode-phase structure and per-unit scoring both need new rule types.
- Confidence: low; only a card checklist, a forum thread, and secondary summaries were available,
  not the original rulebook.
SUMMARY|StarTrekTCG|2|full|none|race|attacker-chooses|windows|none|framework|low

## Doomtown (original) (1998, Pinnacle Entertainment/AEG) — dead
- Players: 2+; built with three-or-more-player multiplayer explicitly in mind.
- Turns: full; a day runs Gambling (lowball poker sets initiative and payout), High Noon (players
  act or pass in turn until all pass), and Nightfall (upkeep, control scored).
- Resources: resource-cards; Deeds with production generate Ghost Rock at upkeep, spent to recruit
  Dudes, buy Goods, and cast spells.
- Life: other; no player life total — each Nightfall compares a player's Control plus Victory
  Points against the highest single opponent's Influence to check for a win.
- Combat: other; a gunfight has each side draw cards equal to their Dude's bullet rating and build
  the best poker hand; the loser takes casualties equal to the hand-strength difference.
- Responses: windows; Action cards, including "Cheatin'" cards that manipulate the gunfight draw,
  answer plays during the main phase or a gunfight.
- Board: grid; Deeds sit in a spatial town layout, with chess-like movement and adjacency mattering
  for who can be drawn into a fight or claim control.
- Card kinds: units (Dudes, with influence/bullet ratings), permanents (Deeds), attachments
  (Goods), spells (Actions, Events, spells cast by specific Dudes).
- Hook: gunfights are decided by an actual poker hand drawn from your own stacked deck, so
  deckbuilding skill and mid-game "cheatin'" cards both bear directly on combat.
- Libraries sufficient: mostly; units/permanents/attachments/spells and a grid board all fit.
- Missing rules: a poker-hand-draw-and-rank combat resolution (nothing like it exists; it needs a
  library verb that draws n cards and ranks the best 5-card hand); grid movement/adjacency; a
  recurring Nightfall win-check comparing two different aggregate stats instead of one counter.
- Core gaps: ranking a drawn set of cards as a poker hand stretches the Property/Filter model (a
  Property that scores a *set* of card values isn't a documented pattern), worth flagging even
  though a library could implement it as a bespoke verb over existing draw/reveal operations.
- Fit: framework; the poker-gunfight resolution is the one piece that goes beyond ordinary rules.
- Confidence: medium; secondary summaries (fandom via search, gambiter) agree closely and match
  Doomtown's well-known poker-gunfight identity.
SUMMARY|Doomtown|2+|full|resource-cards|other|other|windows|grid|framework|medium

## Dune (CCG) (1997, Five Rings Publishing Group) — dead
- Players: 2+; sources cite 2-8, built for multiplayer political play among the Great Houses.
- Turns: full; each round mixes normal House Deck play with an auction phase for unique Imperial
  Deck cards (Allies, Holdings, Homeworld).
- Resources: resource-cards; solaris pays for House Deck cards and Imperial Deck auction bids;
  spice is tracked separately as part of the win condition, not spent like a currency.
- Life: race; first player to reach 10+ spice and 10+ Favor (two counters, both required) wins.
- Combat: compare-stat; one of four named Rites (Battle, Intrigue, Arbitration, Dueling) resolves
  by comparing the Talent totals each side commits, and only cards with the matching Talent may
  take part.
- Responses: windows; Tactic cards let a player interfere in someone else's declared Rite without
  committing their own forces, played as a reaction.
- Board: none; Homeworld/holdings/allies sit in each player's own area; a Rite is declared against
  a target house directly, with no shared positional zones.
- Card kinds: units (Aides/Personnel with Talent stats), permanents (Allies, Holdings, Homeworld),
  attachments (Equipment), spells (Events, Plans, Tactics).
- Hook: a hidden-traitor multiplayer political game where defeated cards go face-down and can
  later be resurrected, and the rarest cards are won at auction instead of drawn.
- Libraries sufficient: no; several mechanics have no matching rule type on file.
- Missing rules: a bidding/auction ActionKind and Verb (common.alex only has play/draw/search, not
  bid); a revivable face-down-defeated object state; four distinct Talent-gated Rite types as
  CombatRule variants; a dual-counter (spice AND favor) race win rule (WinAtCounter names one).
- Core gaps: none strictly required; all four gaps above are new library rule types over the
  existing object/operations model.
- Fit: framework; several new rule types are needed, but nothing forces a core change.
- Confidence: low; Wikipedia/fandom gave the win condition and faction list but not full turn
  sequencing, and general knowledge of this specific CCG is thin.
SUMMARY|Dune|2+|full|resource-cards|race|compare-stat|windows|none|framework|low

## 7th Sea (CCG) (1999, Alderac Entertainment Group) — dead
- Players: 2; ship-vs-ship, though the five-Sea board can extend to more players.
- Turns: alternating; each player acts or passes in clockwise order until all pass in a row.
- Resources: resource-cards; crew cards are "tacked" (tapped) to produce Cannon/Sailing/Influence/
  Adventuring/Swashbuckling points that pay for hiring, moving, and playing cards.
- Life: counter; a ship takes "hits," absorbed by tacking crew (the captain absorbs last); a
  captain forced to absorb a hit loses — the crew pool itself is the life buffer, no separate total.
- Combat: attacker-chooses; cannon combat lets any ship in the same Sea inflict hits on any other
  ship there by producing Cannon points with one crew card; boarding is a separately initiated act.
- Responses: chain; boarding is an alternating attack/matching-defend card exchange that escalates
  (each side draws 3 more cards on a mutual attack) until one side can't respond.
- Board: lanes; five ordered Sea cards form a track, and ships move between adjacent Seas by
  producing Sailing points.
- Card kinds: units (crew, six stats each), permanents (ship, captain — always in play like a
  leader card), spells (Actions, Chanteys, Adventures attached to a Sea); no attachment record.
- Hook: crew cards do triple duty as the resource base (tacked for points), the combat force
  (cannon/boarding), and the life buffer (absorb hits), so one card pool covers three systems.
- Libraries sufficient: no; no current ResourceRule lets one tapped card choose among several
  output resource types, and units.alex assumes power/health on the unit, not "also absorbs a
  player-level hit when tapped."
- Missing rules: a multi-output "tack for any one of N stats" resource rule; a crew-as-life-buffer
  rule; a symbol-matching boarding duel as its own ResponseRule distinct from Chain/Stack; a
  Sea-lane movement rule paid for by spending a resource.
- Core gaps: zone adjacency with a movement cost is not an explicit core-operations primitive
  (zones have no declared adjacency or a "move costs X" hook), though it is buildable as a library
  hook on `move` that checks adjacency and consumes a resource.
- Fit: framework; crew's triple duty and the boarding duel both need genuinely new rule types.
- Confidence: medium; a detailed secondary summary (gambiter) covered most systems mechanically,
  though exact card numbers were not independently verified.
SUMMARY|7thSeaCCG|2|alternating|resource-cards|counter|attacker-chooses|chain|lanes|framework|medium
