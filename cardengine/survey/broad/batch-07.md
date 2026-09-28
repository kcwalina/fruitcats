# Broad survey: batch 07 (games 61–70 in games.md)

## Aquarian Age (2000, Broccoli) — dead
- Players: 2
- Turns: full; a Mindbreaker takes a whole turn (draw, deploy/activate characters, resolve conflicts) then passes
- Resources: other; no confirmed dedicated resource-card or counter mechanic surfaced in available sources
- Life: other; players are eliminated when "stripped of their powers" (lose control of all characters), not a stated numeric total
- Combat: other; the conflict-resolution method (stat compare, dice) could not be confirmed
- Responses: none; no evidence of a stack or reaction window in available material
- Board: other; characters are "controlled" by a Mindbreaker but the zone shape is unconfirmed
- Card kinds: units (characters) plausible; nothing else confirmable
- Hook: two rival factions each push a single shared "Aquarian Age" track toward their own goal, a tug-of-war win condition rather than a solo counter
- Libraries sufficient: no; too little of the actual ruleset is documented to say
- Missing rules: unknown pending rulebook; provisionally a bidirectional shared-track win condition beyond life's WinAtCounter (which is one-directional, first to n)
- Core gaps: none confirmed; a two-directional shared meter reads as a framework-level rule, not a core change
- Fit: framework; best guess given the shared-track hook, but genuinely underdetermined
- Confidence: low; this is a 25-year-old out-of-print game with no archived rulebook found online (Wikipedia, gambiter.com and BoardGameGeek describe only setting/theme, not mechanics); record rests on the games.md hook and genre convention
SUMMARY|Aquarian Age|2|full|other|other|other|none|other|framework|low

## Force of Will (2012, Force of Will Ltd.) — dead
- Players: 2
- Turns: full; standard phase turn (draw, main, battle, main, end) with priority passing between phases
- Resources: resource-cards; Magic Stones (a dedicated card type) are played and tapped for Will, one per turn
- Life: counter; life points start at 4000, reduced by unblocked Resonator/J-Ruler damage, loss at 0
- Combat: defender-blocks; the defending player may block an attacker with a Recovered Resonator
- Responses: stack; the Chase Area holds spells/abilities and resolves last-in-first-out, and a Ruler flips to its stronger "J-Ruler" side ("Judgment") once the Chase Area is empty
- Board: row; Resonators and J-Rulers sit in a shared field
- Card kinds: units (Resonators), spells, attachments (Additions), heroes (Ruler/J-Ruler fits HeroCard's two-faces model)
- Hook: a Ruler card starts face down as a limited avatar and flips permanently into a stronger "J-Ruler" once its cost is paid, joining combat itself
- Libraries sufficient: mostly; heroes' TwoFaces, resources' ResourceCards, responses' Stack, and combat's DefenderBlocks cover the shape
- Missing rules: Judgment's one-way, cost-gated flip is close to TwoFaces but paid as a cost rather than reached by a condition (AwakenOnStateCheck) — worth a PayToFlip-style HeroRule
- Core gaps: none
- Fit: libraries; heroes + resources + responses + combat compose it without a new library
- Confidence: medium; the game's rules wiki and comprehensive-rules index were fetched for combat, resource and Judgment mechanics, not the full PDF text
SUMMARY|Force of Will|2|full|resource-cards|counter|defender-blocks|stack|row|libraries|medium

## The Caster Chronicles (2017, Force of Will Ltd.) — dead
- Players: 2
- Turns: full; a phase turn similar to its parent game, simplified
- Resources: other; Caster cards already in play generate aether directly — no dedicated face-down resource card and no simple per-turn growth counter
- Life: stack; seven face-down Orbs are lost to unblocked damage; after the last Orb, one further successful attack wins the game
- Combat: defender-blocks; a Servant may block an attacking Servant
- Responses: none; marketed as rules-light versus Force of Will, and no chase/stack mechanic surfaced in available sources
- Board: row
- Card kinds: units (Servants), permanents (Barriers), spells (Conjures); Casters resemble a resource-producing permanent with no clean library match
- Hook: drops Force of Will's separate face-down resource-card layer — aether comes from Caster cards already on the field instead
- Libraries sufficient: mostly; life-stack's LifeStack/LoseWhenEmpty covers Orbs, but "an in-play unit produces the resource" is missing from resources.alex, whose rule types are all about face-down cards, a growing counter, or dedicated resource cards
- Missing rules: a UnitProducesResource-style ResourceRule
- Core gaps: none
- Fit: framework; the resource-from-unit mechanic needs a new rule beside CardsAsResources/GrowingCounter/ResourceCards
- Confidence: low; only search-engine summaries were available, not the comprehensive rulebook text
SUMMARY|The Caster Chronicles|2|full|other|stack|defender-blocks|none|row|framework|low

## Final Fantasy Trading Card Game (2011, Square Enix) — live
- Players: 2
- Turns: full; Active, Draw, Main 1, Attack, Main 2, End
- Resources: resource-cards; a Backup is "Dulled" (tapped) for 1 CP of its element, or a hand card is discarded for 2 CP
- Life: stack; damage puts that many cards face up from the deck's top into the Damage Zone; 7 cards there, or drawing from an empty deck, loses the game
- Combat: defender-blocks; a Forward may block an attacking Forward, and the side taking damage ≥ its own power "Breaks"
- Responses: windows; some abilities are usable outside the normal turn structure at fixed timing points, short of a full stack
- Board: row; Forwards and Backups share one field
- Card kinds: units (Forwards fit UnitCard); Backups only ever generate resources and never fight, closer to PermanentCard than UnitCard; Monsters are a third summon-only subtype
- Hook: a "Job Crystal" card lets an in-play Forward retrain into a different job mid-game, swapping its abilities without leaving play
- Libraries sufficient: mostly; life-stack, combat's DefenderBlocks, and resources' ResourceCards cover most of it
- Missing rules: a damage amount proportional to the attacker's stat (several life cards per hit) isn't quite any life-stack rule; and an in-place card-identity swap (Job Crystal) isn't any current Ability kind
- Core gaps: none
- Fit: libraries; the two gaps are new small rules, not core changes
- Confidence: medium; Wikipedia and the game's own wiki were fetched for damage/CP/breaking rules
SUMMARY|Final Fantasy Trading Card Game|2|full|resource-cards|stack|defender-blocks|windows|row|libraries|medium

## Dragon Ball Super Card Game (Masters) (2017, Bandai) — dead
- Players: 2
- Turns: full; Draw, Charge (add up to 1 card to Energy), Main, Battle, End
- Resources: growing; the Energy Area gains at most one card per turn, rested to pay costs and Combo costs
- Life: stack; 8 cards from the top of the deck form the Life Area, lost one at a time when the Leader is hit
- Combat: attacker-chooses; the attacker targets the opponent's Leader or a Battle Card directly, with no formal block step
- Responses: windows; once an attack is declared, either player may add Battle cards from hand into the Combo Area (paid by resting Energy) to raise a fighting card's power before damage
- Board: row; Battle Area holds Battle Cards, with separate small Energy and Combo areas
- Card kinds: units (Battle Cards); Leader is a HeroCard-like always-in-play fixture
- Hook: a mid-battle "Combo" window lets both players spend from a shared energy pool to add power cards into an already-declared attack before damage
- Libraries sufficient: mostly; life-stack and units cover the base, but the Combo window — both players spending a resource to add power mid-combat from hand — is not any CombatRule/ResponseRule as written
- Missing rules: a ComboWindow-style rule combining pay-to-pump with attack timing
- Core gaps: none; it is an ordinary before-damage hook plus a resource spend
- Fit: framework; the Combo mechanic needs a new rule beside AttackerChooses and ResponseWindows
- Confidence: medium; the official site and BGG were consulted for areas, life, energy and combo mechanics
SUMMARY|Dragon Ball Super Card Game (Masters)|2|full|growing|stack|attacker-chooses|windows|row|framework|medium

## Dragon Ball Super Card Game: Fusion World (2024, Bandai) — live
- Players: 2
- Turns: full; same phase shape as Masters (Draw, Energy, Main, Battle, End)
- Resources: growing; one Energy card added per turn, as in Masters
- Life: stack; an 8-card Life Area, as in Masters
- Combat: attacker-chooses; targets the Leader or a Battle Card directly
- Responses: windows; the Combo Area mechanic from Masters persists
- Board: row
- Card kinds: units (Battle Cards); Leader as a HeroCard-like fixture; Fusion cards are a distinct kind fitting no library record cleanly
- Hook: Fusion cards are played face down as a second, hidden resource used only to perform a "Fusion" — merging two named cards in play into one stronger Fusion card, not to pay ordinary costs
- Libraries sufficient: mostly; the base areas match Masters, but the Fusion mechanic is new
- Missing rules: a face-down hidden-resource-for-one-special-action rule (distinct from CardsAsResources, which pays ordinary costs), and a merge-two-objects-into-a-replacement verb — objects.alex's stack-onto/InheritedEffects preserves both cards, one under the other, where Fusion replaces two with a new named card
- Core gaps: none; the merge is expressible as destroy-two/create-one plus copied state, but no single verb does that
- Fit: framework; Fusion's hidden second resource and merge-into-one action are the gaps
- Confidence: medium; official rule-manual PDFs and secondary articles confirmed areas and Energy/Life; the Fusion procedure itself came from secondary summaries
SUMMARY|Dragon Ball Super Card Game: Fusion World|2|full|growing|stack|attacker-chooses|windows|row|framework|medium

## One Piece Collectible Card Game (2003, Bandai) — dead
- Players: 2
- Turns: full; each turn allows draws, adding a card to the "log" (resource), playing comrades, and attacking
- Resources: resource-cards; cards are put face down into a "log" (6 at setup) that funds summoning comrades, land-like
- Life: other; no loss condition beyond deck-out could be confirmed from available sources
- Combat: other; comrades fight with "abilities and tricks" but the resolution method (stat compare vs. dice) is not confirmed
- Responses: none; no evidence found of a reaction/stack system
- Board: row; comrades are put "on the field"
- Card kinds: units (comrades) plausible; nothing else confirmable
- Hook: the original licensed One Piece CCG (Japan 2002, English 2003), predating and unrelated in ruleset to the 2022 relaunch
- Libraries sufficient: unknown; too little of the ruleset survives online to judge confidently
- Missing rules: unknown pending rulebook
- Core gaps: none confirmed
- Fit: framework; provisional, based on the log-as-resource-cards pattern, which is otherwise well covered by common.alex/resources.alex
- Confidence: low; only a short collector blog (totalcards.net) and a fan-wiki stub were found, no rulebook text; redo this record if the original rulebook surfaces
SUMMARY|One Piece Collectible Card Game|2|full|resource-cards|other|other|none|row|framework|low

## One Piece Card Game (2022, Bandai) — live
- Players: 2
- Turns: full; Refresh, Draw, DON!!, Main, End
- Resources: resource-cards; a separate DON!! deck adds cards to the DON!! area each turn, rested to pay costs
- Life: stack; the Leader's printed Life value sets how many cards start face down as Life; an unblocked hit on the Leader moves one to the attacker's hand, and the game ends when Life is empty and the Leader is hit again
- Combat: defender-blocks; a Character with [Blocker] may block, then the defender may play [Counter] cards from hand before damage
- Responses: windows; the Counter Step is a fixed reaction window for cards/abilities marked [Counter]
- Board: row; Character area plus a Stage slot
- Card kinds: units (Characters), permanents (Stages), heroes (Leader, always in play, fixed stats)
- Hook: DON!! cards are simultaneously the cost resource (rested to pay) and a stat-boosting attachment (rested onto a Leader or Character for +1000 power) — one resource plays two roles
- Libraries sufficient: yes; resources' ResourceCards plus RequiresAttachedResources (consumes = false) together model DON!!'s dual role; combat's DefenderBlocks and responses' Ambush/ResponseWindows cover Blocker/Counter
- Missing rules: none
- Core gaps: none
- Fit: libraries; a straightforward composition of existing rule types
- Confidence: high; the official comprehensive rules and Q&A pages were consulted for Life, DON!!, Block and Counter
SUMMARY|One Piece Card Game|2|full|resource-cards|stack|defender-blocks|windows|row|libraries|high

## Union Arena (2023, Bandai) — live
- Players: 2
- Turns: full; Draw, Move, Main, Battle, End
- Resources: resource-cards+growing; 3 fixed AP cards are rested for generic AP, which is spent to build an Energy Line whose cards are then rested to fund front-line characters
- Life: stack; 7 face-down Life cards, flipped by unblocked direct damage
- Combat: defender-blocks; the defender may rest a front-line character as a blocker; BP is compared and the lower side is "sidelined"
- Responses: none; no stack/chase mechanic found beyond the block step itself
- Board: row; separate front-line and energy-line zones
- Card kinds: units (front-line characters fit UnitCard); Energy Line "support" cards that only ever sit rested for resources fit no current record cleanly, closer to ResourceCards than any card type
- Hook: one shared, unified ruleset runs many unrelated anime/manga franchises' card pools instead of one setting per rule set
- Libraries sufficient: mostly; resources' GrowingCounter (AP) plus ResourceCards (Energy Line), and life-stack, cover it
- Missing rules: none beyond ordinary composition
- Core gaps: none
- Fit: libraries; stacking two resource rules is exactly what a game listing multiple ResourceRules already allows
- Confidence: medium; the official rule manual PDF and secondary rules-explainer sites were consulted for AP/Energy/Life/blocking
SUMMARY|Union Arena|2|full|resource-cards+growing|stack|defender-blocks|none|row|libraries|medium

## Gundam Card Game (2025, Bandai) — live
- Players: 2
- Turns: full; Start (draw + add 1 resource), Main, End
- Resources: resource-cards; a separate 10-card resource deck supplies one resource card per turn to the resource area
- Life: stack; the Shield Area holds several face-down Shields, plus a shared 0-power/3-HP "EX Base" token that absorbs damage first; a destroyed Shield with [Burst] triggers its effect
- Combat: defender-blocks; a Unit with [Blocker] may intercept; [High-Maneuver] ignores Blockers and [Breach X] pushes X damage through to the Shield Area on a kill
- Responses: windows; the defender gets an Action Step to respond after an attack is declared, before blocks and damage
- Board: row
- Card kinds: units (mobile-suit Units), attachments (Pilot cards, which "pair" onto a Unit for a stat/keyword Grant and, once "linked," add an enters-ready-to-attack effect like Swift)
- Hook: a Pilot card pairs with a specific Unit card to grant it bonuses, and meeting a link condition turns the pairing into a stronger "Link Unit" that can attack the turn it deploys
- Libraries sufficient: mostly; attachments' AttachmentCard/Grant fits Pilots, and combat's DefenderBlocks/Guardian-Sneaky pattern is close to Blocker/High-Maneuver
- Missing rules: blocking gated behind a keyword at all (DefenderBlocks lets any targeted object block today; Gundam requires [Blocker] specifically), and a Base with its own HP guarding the Shield stack (a LifeShield-like buffer with health, not a simple counter)
- Core gaps: none; both are expressible as new rule types over existing operations
- Fit: framework; two rule types are missing, one from combat.alex and one from life-stack.alex
- Confidence: high; the official comprehensive rules PDF, play sheet and FAQ pages were consulted for Pair/Link, Blocker/High-Maneuver/Breach, and EX Base/Shields
SUMMARY|Gundam Card Game|2|full|resource-cards|stack|defender-blocks|windows|row|framework|high
