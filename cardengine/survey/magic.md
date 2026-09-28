# Survey: Magic: The Gathering (standard two-player 60-card constructed)

Simplifications are called out inline. Ignored per the brief: Commander, planechase, and other
non-constructed variants; this covers the 1v1 constructed game only.

## 1. Game document

```
magic = Game

name = 'Magic: The Gathering'
rulebook = 'Comprehensive Rules (magic.wizards.com)'
core = '1'
players = Players { min = 2, max = 2 }
sets = [@sample-set]

// Card types. MTG permanents routinely carry more than one of these at once (an artifact
// creature, an enchantment creature, a legendary sorceria "Saga"). The language has no way to
// compose two card records onto one card, so each needed combination is declared as its own
// subtype below and a keyword tag stands in for "is also an Artifact" queries.
// CORE: no multiple-type composition for cards; a card is exactly one declared subtype of
// exactly one framework card record. This is the single biggest tax on writing real sets.
type Land : Card {}                        // MISSING: no PermanentCard base; Land has no cost,
                                            // power or health, so it reuses bare Card
type Creature : UnitCard {}
type ArtifactCreature : UnitCard {}         // MISSING: composition workaround, see above
type Artifact : Card { cost: Cost }
type Enchantment : Card { cost: Cost }
type Instant : SpellCard {}
type Sorcery : SpellCard {}                 // MISSING: no "sorcery-speed only" restriction exists;
                                            // see responses/triggers gap below
type Aura : AttachmentCard {}
type Equipment : AttachmentCard {}          // MISSING: attaching is a paid activated ability
                                            // ("equip {2}"), not AttachmentCard's implicit static
type Planeswalker : Card {                  // CORE: no PlaneswalkerCard record anywhere
  cost: Cost
  loyalty: int                              // MISSING: no per-object "life" counter like this
}

types = [
  Land = CardType { name = nameof(Land) }
  Creature = CardType { name = nameof(Creature) }
  ArtifactCreature = CardType { name = nameof(ArtifactCreature) }
  Artifact = CardType { name = nameof(Artifact) }
  Enchantment = CardType { name = nameof(Enchantment) }
  Instant = CardType { name = nameof(Instant) }
  Sorcery = CardType { name = nameof(Sorcery) }
  Aura = CardType { name = nameof(Aura) }
  Equipment = CardType { name = nameof(Equipment) }
  Planeswalker = CardType { name = nameof(Planeswalker) }
]

// Zones. Owner and controller are already separate object fields in the core, which is exactly
// what "gain control of target creature" needs with no further work.
zones = [
  Library = Zone { name = nameof(Library), shape = pile, visible = none, count-public = true }
  Hand = Zone { name = nameof(Hand), shape = set, visible = owner }
  Battlefield = Zone { name = nameof(Battlefield), shape = row, visible = all }
  Graveyard = Zone { name = nameof(Graveyard), shape = pile, visible = all, count-public = true }
  Exile = Zone { name = nameof(Exile), shape = pile, visible = all }   // per-object visible-to
                                                                        // already covers face-down
                                                                        // exile (foretell, impulse)
  Stack = Zone { name = nameof(Stack), shape = row, visible = all }
  // CORE: no selector or ParamType yields "an object on the stack" -- only unit/units/player(s)/
  // event exist (core.alex's ParamType and Arg enums), so nothing in the language can target or
  // counter a spell. Counterspells, one of the game's defining card types, cannot be written.
]

// Keywords: a sample of ~130. Several need Builtin meanings the framework has not defined yet.
keywords = [
  Flying = Keyword { name = nameof(Flying) }         // MISSING: needs "only flying/reach may
                                                      // block this", not a Builtin that exists
  FirstStrike = Keyword { name = nameof(FirstStrike) }        // MISSING: no Builtin
  DoubleStrike = Keyword { name = nameof(DoubleStrike) }      // MISSING
  Deathtouch = Keyword { name = nameof(Deathtouch) }          // MISSING: "any damage is lethal"
  Trample = Keyword { name = nameof(Trample) }                // MISSING: excess-damage assignment
  Vigilance = Keyword { name = nameof(Vigilance) }            // MISSING: "attacks without exhausting"
  Haste = BuiltinKeyword { name = nameof(Haste), is = enters-ready }
  Menace = Keyword { name = nameof(Menace) }                  // MISSING: "needs 2+ blockers"
  Lifelink = Keyword { name = nameof(Lifelink) }              // MISSING: damage also heals controller
  Hexproof = Keyword { name = nameof(Hexproof) }              // MISSING: a targeting restriction by
                                                               // controller -- see filters gap
  Flash = BuiltinKeyword { name = nameof(Flash), is = playable-in-response-window }
  Defender = Keyword { name = nameof(Defender) }              // fits: static `cant(attack)`
]
event-names = [on-enter = 'enters the battlefield', on-defeated = 'dies']
randomness = [shuffle]     // coin/die exist for a handful of cards only, not core to the game

// §deck construction.
deck-rules = [
  DeckSize { n = 60 }             // MISSING: this is a minimum, not an exact count; DeckSize has
                                   // no at-least/exactly flag
  CopiesMax { n = 4 }             // MISSING: basic Lands are exempt from this cap; CopyLimit can
                                   // only make a *stricter* limit for one type, never an exemption
]

// §mulligans, starting hand.
setup = [
  OpeningHand { n = 7 }
  Mulligan { times = 99 }         // MISSING: the London mulligan (draw a new 7 each time, then put
                                   // N cards on the bottom, N = mulligans taken) does not fit
                                   // Mulligan's "times, up-to" shape (draw progressively fewer)
  RandomInitiative {}             // who plays first (die roll / coin flip)
]
// MISSING: no rule for "the player going first skips their first draw step" -- that is a rule
// about one specific step of turn one, not RoundStart.skip-round, which skips a whole round.

life = [
  LifeCounter { name = 'Life', start = 20, lose-at = 0 }
  // MISSING: drawing from an empty library is a loss condition, not a cost; every LifeRule for
  // "empty deck" (EmptyDeckDrawCosts) charges life instead of ending the game.
  // MISSING: poison counters (10 = loss) are a second, independent loss condition with its own
  // counter and threshold; the `life` area assumes one shared life total, not several.
]

resources = [
  Mana = ResourceCards { name = nameof(Mana), attaches-to-units = false }   // lands
]
resource-rules = []
// MISSING: no ResourcePolicy for "this resource empties on a fixed schedule" -- mana empties at
// the end of every step and phase; Folkborn's Offerings only ever grow, never auto-drain.
cost-resource = @resources.Mana
// MISSING: `PayBy` has no `life` member for Phyrexian mana ("pay 2 life instead").
// CORE: `Cost = int | [text: int]` sums its map entries; hybrid mana ("W or U") is a *choice*
// between entries, not a sum, and there is no way for an X in a cost to be read back inside the
// spell's own effect body (`draw(X)` where X was chosen when the cost was paid).

turns = [
  FullTurns { first = random }
  Phases {
    phases = [
      Phase { name = 'Untap', steps = [ReadyAll {}] }                     // no priority here
      Phase { name = 'Upkeep', steps = [Triggers { of = turn-start }, PriorityRound {}] }
      Phase { name = 'Draw', steps = [Draw { count = 1 }, PriorityRound {}] }
      Phase { name = 'Main 1', steps = [PriorityRound {}] }
      Phase { name = 'Combat', steps = [
        PriorityRound {}                            // beginning of combat
        DeclareAttackers {}, PriorityRound {}        // MISSING: no attacker-declaration step
        DeclareBlockers {}, PriorityRound {}         // MISSING: no blocker-declaration step
        CombatDamage {}, PriorityRound {}            // MISSING: no damage step as a Step
      ] }
      Phase { name = 'Main 2', steps = [PriorityRound {}] }
      Phase { name = 'End', steps = [Triggers { of = turn-end }, PriorityRound {}] }
      Phase { name = 'Cleanup', steps = [DiscardTo { hand = 7 }, ExpireThisRound {}] }
    ]
  }
]
// MISSING: `PriorityRound` (used eight times above) does not exist. It is the single most-needed
// new Step: a full pass-priority loop (active player then non-active, either may act, resolves
// the top of the Stack whenever both pass in a row, then reopens until the stack is empty and
// both pass) -- structurally close to Folkborn's own AlternatingActions/all-pass-in-a-row, just
// nested inside every step instead of running once per round.
// MISSING: `Action` enum (play, attack, ability, take-initiative, pass) has no `block` or
// `activate-ability` member, and no `cast-instant` distinct from `play`.

initiative = []   // no shared initiative token; the active player for a turn is simply whoever's
                   // turn it is, which FullTurns already expresses

combat = [
  AttackerChooses { targets = [hero, planeswalker] }   // MISSING: `CombatTarget` has no
                                                        // `planeswalker` member
  DeclareBlockers {}                        // MISSING: the whole rule does not exist. Nothing in
                                             // the combat catalog lets the *defending* player
                                             // choose blockers; Folkborn-style combat only has the
                                             // attacker pick a target and a passive Guardian
                                             // redirect. This is the framework's biggest missing
                                             // piece for any blocking-based TCG.
  MultipleBlockersPerAttacker {}            // MISSING
  AttackerMustBeReady {}
  UnitsEnterExhausted { cites = 'summoning sickness (only blocks attacking/tapping, not blocking)' }
  CombatDamageEqualsPower {}                // MISSING: `LifeDamage { n }` assumes a fixed hit size
                                             // (Folkborn: every attack costs exactly 1 Candle);
                                             // MTG's damage to a player/planeswalker is variable,
                                             // equal to the attacker's power
  DamageClearsAtCleanup {}                  // MISSING: the opposite of `DamagePersists`; no such
                                             // entry exists
  SimultaneousDamage {}                     // true for ordinary combat
  TwoCombatDamageSteps {}                   // MISSING: first strike / double strike
  TrampleAssignsExcessToDefender {}         // MISSING
]

responses = [
  ResponseWindows { name = 'Priority', after = [always] }   // MISSING: `always` is not a
                                                             // `WindowAfter` member; MTG's window
                                                             // opens after *any* stack change or
                                                             // step start, not a fixed named list
  Stack {}          // exists in the catalog for exactly this: unlimited response nesting
]
// Unlike Folkborn: no OnePerWindow, no NoNesting, no NotAnAction, no NoWindowForFreePlays --
// every instant and every activated ability is a normal action on the real Stack zone, and any
// player may respond to a response, including their own.

triggers = [TriggersImmediately {}]
// MISSING: `TriggerTime` (round-start, round-end, turn-start, turn-end) has no member for "start
// of upkeep" vs "start of draw step" vs "start of combat" vs "end step" -- MTG treats these as
// four distinct, commonly-referenced timing points, not one "turn-start".

state-check = [
  DefeatAtHealth {}          // toughness <= 0 -> dies; good fit as-is
  LossOnStateCheck {}        // life <= 0
  LegendRule {}              // MISSING: "two legendary permanents, same controller, same name ->
                             // owner keeps one, sacrifices the rest" has no rule; `unique` on a
                             // card type is close but enforces it per-type, not per-name
]

hero = []   // Magic has no Hero-card mechanic

objects = [
  TokensVanishOffBoard {}                                    // good fit: tokens cease to exist
  ZoneChangeResets { what = [damage, attachments, counters] } // close fit to "a permanent that
                                                               // changes zones becomes a new
                                                               // object"; MTG's version is broader
                                                               // (also resets copy effects, e.g.)
                                                               // but this covers the common case
]
```

## 2. Five representative cards

```
sample-set = Set
id = 'MTG-SAMPLE'
name = 'Sample'
core = '1'

cards = [
  // Vanilla creature.
  grizzly-bears = Creature {
    name = 'Grizzly Bears', cost = [green = 1, any = 1], power = 2, health = 2
  }

  // Triggered ability (ETB).
  elvish-visionary = Creature {
    name = 'Elvish Visionary', cost = [green = 1, any = 1], power = 1, health = 1
  }

  // Instant / fast effect.
  lightning-bolt = Instant { name = 'Lightning Bolt', cost = [red = 1] }

  // Static ability, on a non-creature permanent.
  glorious-anthem = Enchantment { name = 'Glorious Anthem', cost = [white = 1, any = 2] }

  // Hardest common card type: a planeswalker.
  liliana = Planeswalker { name = 'Liliana of the Veil', cost = [black = 1, any = 2], loyalty = 3 }
]
```

```
sample-set-rules = Rules
for = @sample-set

// Elvish Visionary: "When Elvish Visionary enters the battlefield, draw a card."
effect etb-draw { draw(1) }
@elvish-visionary.on-enter = etb-draw

// Lightning Bolt: "Deal 3 damage to any target."
effect bolt {
  target = choose(all)   // MISSING: `choose` only yields a `unit`; "any target" must also be
                          // able to land on a player or a planeswalker. No selector spans all
                          // three, so this line under-implements the card as written.
  target.damage(3)
}
@lightning-bolt.on-play = bolt

// Glorious Anthem: "Creatures you control get +1/+1."
extension Enchantment { static: static? }   // MISSING: `static` is only declared as an extension
                                             // of `UnitCard` in the framework; a non-creature
                                             // permanent has nowhere to hang a continuous effect
static anthem-rule { units(own).grant(power: +1, health: +1) }
@glorious-anthem.static = anthem-rule

// Liliana of the Veil: three loyalty abilities, sorcery-speed, once per turn, cost paid in
// loyalty counters rather than mana.
extension Planeswalker {                 // MISSING: no such extension exists
  ability-plus1: effect?
  ability-minus2: effect?
  ability-minus6: effect?
}
// "+1: Each player discards a card."
effect lili-plus1 { each(players).discard(1) }    // MISSING: no `each` selector-combinator and
                                                   // no `discard` verb (discard is really just
                                                   // `move` to the Graveyard chosen by the owner,
                                                   // so this is a thin framework-verb gap, not
                                                   // a core one)
// "-2: Target player sacrifices a creature."
effect lili-minus2 { choose-player(opponents).sacrifice(creature) }  // MISSING: no `choose-player`
                                                   // selector (only `choose` -> unit exists) and
                                                   // no `sacrifice` verb (destroy limited to the
                                                   // chooser's own side)
// "-6: Separate all permanents target player controls into two piles of your choice. That
// player sacrifices all permanents in the pile of their choice."
effect lili-minus6 {
  // MISSING: no primitive at all for "partition a set of objects into player-chosen groups,
  // then let another player pick a group to destroy". Every selector in the language chooses
  // one object or one player at a time.
}
@liliana.ability-plus1 = lili-plus1
@liliana.ability-minus2 = lili-minus2
@liliana.ability-minus6 = lili-minus6
// MISSING: nothing wires "once per turn, sorcery-speed only" onto these three activations, and
// nothing lets loyalty (rather than mana or exhausting) be the cost.
```

## 3. Gap list

| Gap | Layer | How common | Suggested addition |
|---|---|---|---|
| No full LIFO stack with continuous priority passing (only fixed named response windows) | framework rule (responses) + core loop skeleton | every game | New `Step` kind `PriorityRound {}` (pass-priority loop, resolves top of stack when both pass); pair with existing `Stack {}` `ResponseRule` and drop the fixed `WindowAfter` list in favor of an `always` member |
| No defending-player blocking step | framework rule (combat) | every game | `CombatRule DeclareBlockers { max-per-attacker: int? }`; add `block` to the `Action` enum |
| Cards cannot carry more than one card-record type at once (artifact creature, enchantment creature) | core (`Card` subtype model) | most games | Let a card declare a list of supertypes/records instead of exactly one fixed subtype |
| Filters are a closed tag catalog, not predicates (power ≥ N, by controller, by color, "shares no type with") | core (`Filter` type) | every game | Turn `Filter` into a small predicate expression (property comparison + boolean composition), not only named tags |
| No selector spans creature/player/planeswalker ("any target") | framework selector | every game | New `Selector { yields = any-target }`, backed by a new `ParamType`/`Arg` for a target that may be any of those |
| Nothing can target or counter an object on the stack | core (`ParamType`/`Arg` enums) | most games (counterspells) | Add `spell` to `ParamType`/`Arg`; add a `stack` selector yielding it |
| `Cost` sums its parts; hybrid mana is a choice, Phyrexian mana is paid in life, X costs aren't readable by the effect | framework (`Cost`, `PayBy`) | most games | Add a `HybridCost` alternative-of-costs shape; add `life` to `PayBy`; let a cost's `X` bind a variable the effect body can read |
| No verbs for destroy, discard, sacrifice, counter-a-spell, mill, search, tap-for-mana | framework verbs | every game | Add these; `destroy`/`discard` are thin wrappers over the existing `destroy`/`move` core operations |
| Activated abilities only exist on Hero faces (`exhaust`), not on any other permanent | framework (`Trigger.on`) | every game | Generalize into `activate: Trigger` with a `cost` and a `sorcery-speed: bool`, attachable to any card record |
| No planeswalker card record, loyalty counter, or "attack a permanent" | framework (card records, `CombatTarget`) | most games (every set since 2007) | `type PlaneswalkerCard : Card { loyalty: int }`; add `planeswalker` to `CombatTarget`; `StateCheckRule DefeatAtZeroLoyalty {}` |
| Combat damage is a fixed amount per hit and persists until cleared; MTG's equals the attacker's power and clears every cleanup step | framework combat rules | every game | `CombatRule CombatDamageEqualsPower {}` and `CombatRule DamageClearsAtCleanup {}` beside the existing `LifeDamage`/`DamagePersists` |
| First strike / double strike (two damage sub-steps) | framework combat rule + `Builtin` | most games | `CombatRule TwoCombatDamageSteps {}`; `Builtin` members `first-strike`, `double-strike` |
| Trample (assign excess combat damage past lethal to the defender) | framework combat rule + `Builtin` | most games | `Builtin: assigns-excess-damage`, plus a verb that splits `amount` between a blocker and its controller |
| Evasion is only the fixed pair ignores-guardian/must-be-attacked-first | framework `Builtin` | every game | Generalize to `Builtin: blockable-only-by(quality)` so flying/reach, and future qualities, aren't hard-coded pairs |
| Independent loss conditions with separate counters (life, poison, empty library) | framework (`life` area is one list assuming one total) | most games | Let each life-area rule own its own counter and threshold instead of assuming a single shared life total |
| Legend rule (duplicate legendary permanents force a sacrifice) | framework state-check rule | most games (any constructed deck) | `StateCheckRule LegendRule {}` alongside the existing per-card `unique` field |
| Trigger timing is coarse (`turn-start`/`turn-end` only, no upkeep/draw/combat/end-step) | framework enum `TriggerTime` | most games | Add members, or replace the closed enum with "the name of the step", so any step can host a trigger |
| Partitioning a set of objects into player-chosen groups (pile effects) | language / framework verb | rare | A general "split into groups, then choose a group" primitive; today only single-object `choose` exists |

## 4. Verdict

Not with framework additions alone: a handful of the gaps above sit in the core (a real predicate
language for filters, a `ParamType` for objects on the stack, and multiple simultaneous card types
per card), so this would need core changes as well as a large batch of new framework catalog
entries. The single largest obstacle is the priority/stack system — Folkborn's fixed, named
response windows with `NoNesting` are structurally the opposite of Magic's "any player may respond
to anything, including a response, at any point," and that one difference touches the turn loop,
combat, and every instant-speed card at once, rather than being a single new keyword to catalog.
Roughly 35–45% of a typical constructed card pool — vanilla and French-vanilla creatures, plain
"enters/dies" triggers, and simple single-target damage/pump/draw instants — already maps cleanly
onto the existing card records and verb catalog (`damage`, `heal`, `buff`, `draw`, `on-enter`); the
rest routes through the still-missing stack, blocking, multi-typing, or activated-ability
primitives above.
