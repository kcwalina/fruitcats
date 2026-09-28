# Survey: Disney Lorcana (two-player constructed)

Simplifications are called out inline. This covers the core two-player constructed game as
commonly played through the Into the Inklands / Reign of Jafar era: 60-card decks, up to two ink
colors, characters/actions/items/locations, questing to 20 lore. Tournament-only procedures (deck
checks, extra mulligan formats for multiplayer), and later variants (Enchanted-rarity alternate
rules text, "Ursula's Return" one-off mechanics) are out of scope.

## 1. Game document

```
lorcana = Game

name = 'Disney Lorcana'
rulebook = 'Comprehensive Rules (disneylorcana.com)'
core = '1'
players = Players { min = 2, max = 2 }
sets = [@survey-set]

// Card types. A Character's printed lore value (what it gives when it quests) and whether a
// card is inkable are both per-card data that varies card to card, the same way cost/power/
// health already do on UnitCard -- but the language only lets a game's subtype *fix* an
// inherited field to a constant (`type Fabled : UnitCard { unique = true }`), never add a new
// one. Both fields below are written as if that were allowed.
// MISSING: subtypes can only fix inherited fields, not add new per-card fields; see gap list.
type Character : UnitCard { lore: int, inkable: bool = true }
type Action : SpellCard {}
type Song : SpellCard {}          // sung by exerting a Character instead of paying ink; see below
// MISSING: no framework card record fits a persistent, stat-less, no-single-host permanent.
// Item is forced to subtype the bare `Card`, so it gets none of UnitCard/SpellCard's ready-made
// extension points (on-enter, on-play, static) -- there is nowhere to hang "exert: remove 1
// damage" at all. See gap list, "card record for permanents".
type Item : Card { cost: Cost, inkable: bool = true }
// Same gap as Item, plus fields of its own: characters attach TO a Location (the reverse of
// AttachmentCard, where the attaching card is the host) and it hands out lore passively.
type Location : Card { cost: Cost, move-cost: Cost, willpower: int, lore: int }

types = [
  Character = CardType { name = nameof(Character) }
  Action = CardType { name = nameof(Action) }
  Song = CardType { name = nameof(Song) }
  Item = CardType { name = nameof(Item) }
  Location = CardType { name = nameof(Location) }
]

// Zones, one instance of each per player.
zones = [
  Deck = Zone { name = nameof(Deck), shape = pile, visible = none, count-public = true }
  Hand = Zone { name = nameof(Hand), shape = set, visible = owner }
  Inkwell = Zone { name = nameof(Inkwell), shape = set, visible = owner, face-down = true }
  Play = Zone { name = nameof(Play), shape = set, visible = all }
  Discard = Zone { name = nameof(Discard), shape = row, visible = all, count-public = true }
]

// Keywords: framework built-ins under Lorcana's names where one exists; several have no match.
keywords = [
  Rush = BuiltinKeyword { name = nameof(Rush), is = enters-ready }   // MISSING: too generous; see
                                                                      // "drying" gap below
  Bodyguard = BuiltinKeyword { name = nameof(Bodyguard), is = must-be-attacked-first }
  // MISSING: Bodyguard also lets its controller choose to put it into play already exhausted;
  // no Builtin or verb models an ETB choice like this.
  Evasive = BuiltinKeyword { name = nameof(Evasive), is = evasive-only }            // MISSING
  Ward = BuiltinKeyword { name = nameof(Ward), is = cant-be-chosen-by-opponent }    // MISSING
  Reckless = BuiltinKeyword { name = nameof(Reckless), is = must-challenge }        // MISSING
  Support = BuiltinKeyword { name = nameof(Support), is = support-lends-strength }  // MISSING
  Singer = BuiltinKeyword { name = nameof(Singer), is = sings-as-cost }             // MISSING
  Shift = BuiltinKeyword { name = nameof(Shift), is = shift-onto-namesake }         // MISSING
  Challenger = BuiltinKeyword { name = nameof(Challenger), is = challenger-bonus }  // MISSING
  Resist = BuiltinKeyword { name = nameof(Resist), is = damage-reduction }          // good fit
]
event-names = [on-enter = 'enters play', on-defeated = 'is banished']
randomness = [shuffle, initiative]        // coin/die pick who goes first in casual play

win = first-to     // CORE: also need last-standing at the same time (decking out is a second,
                    // independent way to win/lose); `win` is one enum value, not a set of
                    // simultaneously-active win conditions. See gap list.

// Deck construction.
deck-rules = [
  DeckSize { n = 60 }           // MISSING: this is a minimum; decks may run larger than 60
  CopiesMax { n = 4 }
  ColorLimit { n = 2 }          // MISSING: at most 2 of the game's 6 ink colors per deck; no
                                 // DeckRule restricts which of a game's own color tags a deck
                                 // may mix, only how many copies of a card it may run
]

// Setup.
setup = [
  OpeningHand { n = 7 }
  Mulligan { times = 1, up-to = 7 }     // shuffle back any number of cards once, draw that many
  RandomInitiative {}                   // die roll / coin flip in tournament play
]

// Lorcana has no life total or life zone at all: the only "you lose" condition tied to a card
// resource is decking out, and it ends the game outright rather than costing anything.
life = [
  LoseOnEmptyDraw {}    // MISSING: lose immediately on a required draw with an empty Deck; every
                         // existing LifeRule assumes a life-pool exists somewhere (a stack, a
                         // counter, or at least a cost charged against one) which Lorcana has none
                         // of. See gap list.
]

resources = [
  Inkwell = CardsAsResources {
    name = nameof(Inkwell), zone = @zones.Inkwell, from = @Hand
    start = 0, per-round = 1, worth = 1, pay-by = exhaust
  }
]
resource-rules = [
  NoIdentityWhileResource { resource = @resources.Inkwell }
  InkableOnly { resource = @resources.Inkwell }   // MISSING: only cards with the inkwell icon
                                                    // may be inked; CardsAsResources has no
                                                    // eligibility filter, and (as noted above) no
                                                    // card field marks a card inkable or not
]
cost-resource = @resources.Inkwell

// Turns: one player's whole turn at a time, not Folkborn's alternating single actions.
turns = [
  FullTurns { first = random }
  RoundStart {
    steps = [ReadyAll {}, Triggers { of = turn-start }, Draw { count = 1 }]
    // MISSING: the very first player's very first turn skips this Draw step; Folkborn's
    // `skip-round` on RoundStart skips the whole step list for a whole round, not one step for
    // one specific turn.
  }
  Actions { allowed = [play, attack, ability, pass] }
  // MISSING: `Action` has no `quest`, `sing`, `ink`, or `move-to-location` member. In practice a
  // Lorcana turn plays any number of cards, quests and challenges with any number of different
  // ready characters, inks at most one card, and sings any number of songs, all freely ordered --
  // closer to "the whole main phase is one long free-form window" than a single named action.
  RoundEnd { steps = [Triggers { of = turn-end }, ExpireThisRound {}] }
]

initiative = []    // no shared initiative token; FullTurns.first plus strict alternation between
                    // exactly two players is the whole of it

combat = [
  AttackerChooses { targets = [unit] }   // challenges never target a player directly
  AttackerMustBeReady {}
  EntersDrying {}    // MISSING: characters enter READY, not exhausted, and can be exerted for
                      // other costs immediately; they just can't quest or challenge until their
                      // controller's next turn. That is a third object status, distinct from
                      // exhausted/ready, that `UnitsEnterExhausted` cannot express. See gap list.
  GuardiansFirst {}   // Bodyguard
  SimultaneousDamage {}
  DamagePersists {}
  StackBanishedTogether {}   // MISSING: banishing a Shifted character banishes the whole stack
                              // of cards beneath it at once, not just the top one
]

responses = []   // Lorcana has no response-window or stack system: nothing may be played on the
                  // opponent's turn (as of the sets this survey covers). An item's activated
                  // ability is just the `ability` action, usable on your own turn like any other.

triggers = [TriggersImmediately {}, ActingPlayerFirst {}, TriggersOpenNoWindow {}]

state-check = [
  DefeatAtHealth {}   // a Character or Location is banished once damage marked on it meets its
                       // health/willpower -- good fit, modulo the field-name note below
  WinAtCounter { counter = 'lore', n = 20 }   // MISSING: no StateCheckRule ties a named player
                       // counter and a threshold to an immediate win; the catalog's state-check
                       // rules (DefeatAtHealth, AwakenOnStateCheck, LossOnStateCheck) only model
                       // losing, never racing to a positive target. See gap list.
]

hero = []   // Lorcana has no Hero-type card

objects = [
  TokensVanishOffBoard {}
  ZoneChangeResets { what = [damage, attachments, this-round] }
  MoveToLocation {}               // MISSING: a character may pay a cost to attach itself to a
                                   // Location at any time on its controller's turn; no such
                                   // player-initiated, costed "move" action exists in the catalog
  LocationYieldsLoreEachTurn {}   // MISSING: at the start of each turn, a Location's controller
                                   // gains lore equal to its printed lore value
]
```

## 2. Five representative cards

```
survey-set = Set
id = 'SURVEY'
name = 'Survey Set'
core = '1'
version = '0.1.0'

cards = [
  // Vanilla character with a lore value: no ability at all, just a body and a printed lore value.
  dalmatian-puppy = Character {
    name = 'Dalmatian Puppy - Tail Wagger', rarity = common
    cost = 1, power = 2, health = 3, lore = 1
    // Real text also raises its own CopiesMax to 99. MISSING: no per-card override of a global
    // DeckRule; see gap list.
  }

  // Character with a quest-triggered ability ("Dark Knowledge").
  maleficent = Character {
    name = 'Maleficent, Mistress of All Evil', rarity = legendary
    cost = 5, power = 2, health = 3, lore = 2
  }

  // Song: sung by exerting a character instead of paying ink.
  be-our-guest = Song { name = 'Be Our Guest', cost = 2 }

  // Item: a permanent with a paid, repeatable, player-activated ability.
  dinglehopper = Item { name = 'Dinglehopper', cost = 1, rarity = common }

  // Location: units move onto it, it has willpower/lore, and it gives lore every turn.
  beasts-castle = Location {
    name = 'Beast''s Castle - Winter Gardens', cost = 1, move-cost = 1, willpower = 6, lore = 0
  }
]
```

```
survey-set-rules = Rules
for = @survey-set

// Dalmatian Puppy - Tail Wagger: vanilla. No effect, no wiring line -- nothing to attach.

// Maleficent, Mistress of All Evil: "Dark Knowledge - Whenever this character quests, you may
// draw a card." (Her second ability, Divination, is left out of this survey for space.)
// MISSING: no Trigger fires "when this character quests" -- the catalog only has on-enter,
// on-defeated, on-play, on-defeats-in-combat, on-round-start, on-you-heal, exhaust and awaken.
// MISSING: no verb wraps a whole effect in a yes/no player choice ("you may..."); the `optional`
// filter only makes a single `choose()` target optional, not an entire following effect.
effect draw-one-optional { draw(1) }          // written as if forced; see MISSING above
@maleficent.on-quest = draw-one-optional      // MISSING: on-quest does not exist as a Trigger

// Be Our Guest: "(A character with cost 2 or more can exert to sing this song for free.) Look at
// the top 4 cards of your deck. You may reveal a character card and put it into your hand. Put
// the rest on the bottom of your deck in any order."
// MISSING: no selector for "the top N cards of a zone", and no verb family for "look privately,
// keep some, return the rest to the bottom in a player-chosen order" -- `draw` only moves a fixed
// count straight to hand, with no look-then-decide step.
// MISSING: singing itself -- paying a Song's cost by exerting a character whose own cost is high
// enough, instead of paying with ink -- has no representation in `Cost`/`PayBy`/`ResourceRule` at
// all. This is one of the two biggest single gaps for this game; see gap list.
effect dig-four {
  found = look-top(own, 4)                          // MISSING selector: look-top(player, n)
  target = choose(found, filters: character, optional)
  if target { target.move(to: @Hand) }              // MISSING: `move` has no rules-layer verb
  rest = found.without(target)                       // MISSING: no set-difference operation
  rest.move(to: @Deck, at: bottom, order: chosen)     // MISSING: player-ordered placement
}
@be-our-guest.on-play = dig-four

// Dinglehopper: "Straighten Hair -- {exert}: Remove up to 1 damage from chosen character." A
// player-activated, cost-gated ability, not one that fires off an event.
// MISSING: no `activate` Trigger/BlockKind kind: cost-gated, player-initiated, usable any time
// it's legal to act, as opposed to every existing Trigger, which fires off a named Event.
// MISSING: `heal` has no "up to N" (optional amount) form.
// MISSING (repeat of the type-declaration note): Item has no extension point at all -- on-enter/
// static/on-play are declared on UnitCard/SpellCard only, and Item is neither.
effect straighten-hair {
  target = choose(all, filters: character)
  target.heal(1)                       // MISSING: no "may heal up to n" variant
}
@dinglehopper.activate = straighten-hair    // MISSING: neither `activate` nor this extension exist

// Beast's Castle - Winter Gardens: "Snowball Standoff -- Whenever a character here challenges
// another character, gain 1 lore."
// MISSING: no selector for "the characters currently at this Location" (`here`), no Trigger for
// "a character here challenges", and (as above) Location has no extension point to hang either on.
effect gain-one-lore { own.gain(counter: @lore, amount: 1) }
// MISSING verb: no rules-layer verb adjusts a player's own named counter; the core's `adjust`
// operation exists underneath but is never exposed to the program layer as a callable verb.
@beasts-castle.on-challenge-from-here = gain-one-lore   // MISSING: trigger + extension, see above
```

## 3. Gap list

| Gap | Layer | How common | Suggested addition |
|---|---|---|---|
| A game can only fix an inherited field's value, never add a new per-card field (lore value, inkable flag) | language | every game | Let a card-type subtype declare genuinely new fields, with real per-card values, alongside fixed ones |
| No card record fits a persistent, stat-less permanent with no single host (Item, Location) | framework rule (card record) | most games | `type PermanentCard : Card { cost: Cost }` in framework.alex, plus a `HubCard : PermanentCard {}` that other objects can `attach` onto |
| Extension points (`on-enter`, `static`, `on-play`) are hard-wired to UnitCard/SpellCard only | framework rule / language | most games | Ship the new `PermanentCard` (above) with its own `on-enter`/`activate`/`static` extensions, or let any data type opt into the existing Trigger machinery |
| `Game.win` is a single enum value; can't express two live win conditions (race to a lore threshold, and win-by-elimination on deck-out) at once | core (`Game.win`) | most games with more than one loss condition | Make `win` a list, or add a composite `Win` value combining a threshold race with an elimination fallback |
| No LifeRule for "there is no life pool; lose outright on a required draw from an empty deck" | framework rule (life area) | common (any race-to-a-goal game with no health stat) | `LoseOnEmptyDraw : LifeRule {}` |
| No StateCheckRule for "first player whose named counter reaches N wins immediately" | framework rule (state-check) | most games with a race-to-N objective (lore, honor, chains) | `WinAtCounter : StateCheckRule { counter: text, n: int }` |
| `DefeatAtHealth` implicitly assumes the relevant field is literally named `health` | framework rule / language | rare (matters once a second card record uses a different field name, e.g. `willpower`) | Parameterize it: `DefeatAtHealth { field: text = 'health' }` |
| No object status between exhausted/ready for "can be exerted for other costs, just can't do its two signature actions yet" (drying ink) | framework rule (combat/object) | most games with a summoning-sickness style restriction that isn't literal exhaustion | Generalize `UnitsEnterExhausted` into `EntersWithStatus { status: text, blocks: [Action], clears: TriggerTime }` |
| No defender-side targeting/challengeability restriction (Evasive, Ward) | framework rule (`Builtin`) | common across TCGs (evasion, hexproof/stealth keywords) | `Builtin` members `only-matching-quality-may-challenge` and `cant-be-chosen-by-opponent`, plus a filter hook on `choose`'s legality |
| No forced-action verb (the dual of `cant`), and `Action` has no `quest`/`sing`/`ink`/`move-to-location` members | framework rule (enum + verb) | most games with keyword-forced behavior and a richer per-turn action palette | Extend `enum Action`; add `must = Verb { on = units, params = [action = action], only-in = static }` |
| No alternate-cost mechanism keyed to board state (sing a song by exerting an eligible character instead of paying ink) | framework rule (`Cost`/`ResourceRule`) | rare as written, but structurally close to convoke/delve-style alternate costs elsewhere | `AlternateCost : ResourceRule { pays: PayBy, eligibility: condition }`; widen `Cost` to `int | [text: int] | AlternateCost` |
| Shift's alternate cost + stacking has no catalog keyword tying alt-cost, `stack-under`, skipped drying, and banish-together into one entry | framework rule | rare (Lorcana-specific, but similar to "evolve"/"transform" mechanics elsewhere) | `ShiftKeyword : ObjectRule {}` plus `StackBanishedTogether : ObjectRule {}` (both used in the game document above) |
| No per-card override of a global DeckRule (Dalmatian Puppy raises its own copy limit to 99) | framework rule (deck-rules) | rare (a handful of cards per game, usually) | A `copies-max: int?` field directly on `Card`, read in place of the game-wide `CopiesMax` when set |
| No deck-building restriction on which of a game's color/faction tags may be mixed | framework rule (deck-rules) | most games with a color or faction pie | `ColorLimit : DeckRule { n: int }` |
| No Trigger for a game's own signature repeatable action (here, questing) | framework rule (Trigger) | most games (attacking, tapping for mana, questing all want this) | A per-game `on-quest`-style Trigger + Event, alongside the existing fixed set |
| No "you may" wrapper gating a whole effect on a yes/no decision | framework rule (verb) | every game (this is near-universal card text) | A `may` verb/block form, distinct from `choose(..., optional)` which only makes a target optional |
| No "look at top N, keep some, reorder/bury the rest" verb family | framework rule (verb/selector) | most games (scrying, tutoring, mill-and-choose effects) | `look-top = Selector { yields = units, params = [from = player, n = int] }` plus verbs to place a subset to hand/bottom/discard in a chosen order |
| No player-counter adjustment verb exposed at the rules layer | framework rule (verb) | most games with any player-facing counter beyond life/resources | `gain = Verb { on = player, params = [counter = counter, amount = int] }`, wrapping the existing `adjust` core operation |
| No selector for "the objects attached to/stationed at a specific object" | framework rule (selector) | common with hub-like permanents (locations, vehicles, auras' "enchanted creature") | `here = Selector { yields = units, params = [of = unit] }`, built on the existing `attachments` object field |
| No activated-ability Trigger kind (cost-gated, player-initiated, not fired by an Event) | framework rule (Trigger/BlockKind) | most games with tap-abilities on non-creature permanents | An `activate` BlockKind alongside `effect`/`condition`/`static`, with its own cost |
| Skipping a single Step (not a whole RoundStart/RoundEnd list) for one specific turn only (first player's first draw) | framework rule (Step) | rare (most asymmetric-first-turn rules are coarser than this) | `Draw { count: int, skip-very-first-turn: bool = false }` |

## 4. Verdict

Almost entirely buildable with framework additions alone: nearly every gap above is a missing
catalog entry (a card record, a Builtin, a verb, a Trigger), which is exactly the kind of change
the framework is designed to absorb; only the `Game.win` field genuinely needs a core change, to
let a game have two live win conditions (a lore race and a deck-out loss) at once. The single
largest obstacle is that Items and Locations have no home at all in the current three-record
catalog (UnitCard/SpellCard/AttachmentCard) and the language gives a game no way to add a new
per-card field even if it did (a Character's own lore value hits the same wall) -- that blocks two
whole card types outright, not just a handful of abilities. Roughly 35-45% of the published pool
maps cleanly today: vanilla and simply-keyworded Characters, plain on-enter triggers, and
single-target damage/heal/buff effects already fit the existing card records and verb catalog: the
rest -- every Item, every Location, every Song, and any Character ability that searches, reorders,
sings, or forces a choice -- routes through the gaps listed above.
