# Survey: Flesh and Blood (Classic Constructed, two-player)

Simplifications, called out again inline: Classic Constructed only (not Blitz, which uses a flat
20 life and a 40-card deck); ignores Constructs/Companions (a minority of cards that behave like
persistent attacking/blocking units, closer to Folkborn's own model, and would reuse `UnitCard`
rather than stress anything new); ignores the Banished zone, dual-wielding a second weapon, and
the four equipment slots are collapsed into one zone. Hero Life (20-40) and hand size/Intellect
(commonly 3-5) are both printed per hero card; below they are fixed constants where the framework
has no field to hold a per-card value, flagged CORE where that happens.

## 1. Game document

```
flesh-and-blood = Game

name = 'Flesh and Blood'
rulebook = 'Comprehensive Rules (Classic Constructed format)'
core = '1'
players = Players { min = 2, max = 2 }          // singular `opponent` is legal in this game
sets = [@survey-fragment]

// Card types. Nearly every non-hero, non-equipment card prints a power/defense pair and a pitch
// value; no existing card record has any of that.
// MISSING: SpellCard has no combat stats or pitch value. ActionCard adds what covering FaB would
// need added to SpellCard itself (or a new sibling record next to it).
type ActionCard : SpellCard {
  power: int?                  // MISSING: attack power; nic on cards that don't attack
  defense: int = 0             // MISSING: value contributed when discarded to block
  pitch: int                   // MISSING: printed resource value when pitched face down
  go-again: bool = false       // MISSING: playing this does not end the turn's action
  once-per-turn: bool = false  // MISSING: SpellCard has no once-per-round-style field at all
}
type AttackAction : ActionCard {}
type InstantCard : ActionCard {}
// MISSING: no ResponseRule ties a card *type* to its own window; Defense/Attack Reaction need two
// different windows each, which Ambush-by-keyword (Folkborn's approach) cannot express, since a
// keyword only ever points at one `WindowAfter` list.
type DefenseReaction : ActionCard {}
type AttackReaction : ActionCard {}
type Weapon : AttachmentCard {}              // attaches to the hero; grants power to attacks
type Equipment : AttachmentCard {}           // Head, Chest, Arms, Legs, collapsed to one type
type Hero : HeroCard {}
// CORE: HeroCard's only numeric field lives on `Face.power`; a hero's own Life total and hand
// size (Intellect) are per-card stats with no field anywhere to hold them.

types = [
  Hero = CardType { name = nameof(Hero) }
  AttackAction = CardType { name = nameof(AttackAction) }
  InstantCard = CardType { name = 'Instant' }
  DefenseReaction = CardType { name = nameof(DefenseReaction) }
  AttackReaction = CardType { name = nameof(AttackReaction) }
  Weapon = CardType { name = nameof(Weapon) }
  Equipment = CardType { name = nameof(Equipment) }
]

// Zones. Simplified: no Banished zone, one Equipment zone instead of four named slots.
zones = [
  Deck = Zone { name = nameof(Deck), shape = pile, visible = none, count-public = true }
  Hand = Zone { name = nameof(Hand), shape = set, visible = owner }
  Graveyard = Zone { name = nameof(Graveyard), shape = row, visible = all }
  Arsenal = Zone { name = nameof(Arsenal), shape = slot, visible = owner, face-down = true }
  Pitch = Zone { name = nameof(Pitch), shape = pile, visible = owner, face-down = true }
  HeroZone = Zone { name = 'Hero', shape = slot, visible = all }
  WeaponZone = Zone { name = 'Weapon', shape = slot, visible = all }
  Equipped = Zone { name = 'Equipment', shape = slots, visible = all }
  Chain = Zone { name = nameof(Chain), shape = row, visible = all }
  // CORE: bookkeeping only. The real combat chain is not a place cards sit; it is an ordered,
  // public, repeatedly-extendable structure with per-link roles that flip after each hit. See the
  // note under `combat` below.
]

keywords = []
// None of the framework's `Builtin` meanings (enters-ready, must-be-attacked-first, ignores-
// guardian, life-damage, damage-reduction, play-free-when-lost-as-life, playable-in-response-
// window) match a real FaB keyword closely enough to reuse for the five sample cards below. Go
// Again is modelled as an `ActionCard` field instead of a keyword because it changes turn
// structure, not combat math. Real keywords (Piercing, Dominate, Reload...) are out of scope.
randomness = [shuffle, coin]                      // a coin flip decides who goes first

// Deckbuilding.
deck-rules = [
  DeckSize { n = 60 }          // simplified to exact; the real rule is "60 or more"
  CopiesMax { n = 3 }
  HeroesPerDeck { n = 1 }
  // MISSING: Legendary and Fabled-rarity cards are capped at 1 copy, not 3; `CopyLimit` keys its
  // stricter cap off a `CardType`, but this restriction is keyed off `Rarity` instead.
  // MISSING: no rule for "exactly one card in the Weapon zone, up to 4 in Equipment" -- a
  // minimum/maximum for a specific zone's starting contents, not a card-type cap over the deck.
]

setup = [
  HeroTo { zone = @zones.HeroZone, face = 1 }
  OpeningHand { n = 4 }        // MISSING: should read `own.hero.hand-size`, a per-card stat (see
                                // the CORE note on Hero above), not a set-wide constant
  RandomInitiative {}
  // MISSING: no SetupRule places a deck's Weapon/Equipment cards into their zones before turn 1;
  // `HeroTo` is the only "starts in play, not drawn" rule, and it is hard-wired to `HeroCard`.
]

life = [
  LifeCounter { name = 'Life', start = 20, lose-at = 0 }
  // simplified: real Life is printed per hero, roughly 20-40; see the CORE note above.
]

resources = [
  Pitch = PitchFromHand {
    name = nameof(Pitch)
    zone = @zones.Pitch            // MISSING: `PitchFromHand` has no `zone`/`from`, unlike its
    from = @zones.Hand             // sibling `CardsAsResources`, which has both
    worth = per-card                // MISSING: `worth` is a plain `int`, one fixed value for
                                     // every card (Folkborn's Offerings are always worth 1); FaB's
                                     // pitch value is printed per card (the `pitch` field above)
    pay-by = discard
  }
]
resource-rules = []
cost-resource = @resources.Pitch
// CORE: nothing models "one action per turn, extended only by a played card's own `go-again`
// flag." The resource types (`GrowingCounter`, `CardsAsResources`, `ResourceCards`,
// `PitchFromHand`) are all pools spent from; a turn's single action slot, kept open by a card
// property rather than paid for from a pool, has no equivalent in the resource or turn catalogs.
// This is on top of, not instead of, paying the Pitch resource for a card's own cost.

turns = [
  FullTurns { first = random }
  RoundStart {
    steps = [
      ReadyAll {}                  // clears weapon/equipment exhaustion, if any is tracked
      Triggers { of = round-start }
      // MISSING: no "refill hand to N" step. `Draw { count }` draws a fixed number; `DiscardTo`
      // only discards down to a limit. FaB draws up to the hero's Intellect every turn (also a
      // CORE gap, see above), which is neither shape.
    ]
  }
  Actions { allowed = [play, attack, ability, pass] }
  RoundEnd {
    steps = [
      ExpireThisRound {}
      // MISSING: no step moves a zone's cards to the bottom of another zone in arrival order.
      // Expressible by repeating the core's `move` operation once per card (oldest first), but
      // not as a named, reusable Step the way `DiscardTo` is.
    ]
  }
]
// MISSING: no TurnRule for "keep taking actions, without passing, as long as the card just played
// had `go-again`; otherwise the turn ends." `AlternatingActions` assumes every card ends the
// active player's turn; `FullTurns` assumes the active player keeps going until they choose to
// stop, with no per-card override either way.

initiative = []    // no persistent initiative token; the active player for a turn is simply
                    // whoever's turn it is, which `FullTurns` already expresses

combat = [
  AttackerChooses { targets = [hero] }    // simplified: ignores Constructs/Companions
  NoRetarget {}
  BlockWithHandCard {}
  // MISSING: no CombatRule lets the defending player pay any card from hand as a block, each
  // contributing its own `defense` stat, with the card then going to the graveyard -- a resource
  // payment made *during* another player's attack, not a normal turn action.
  SimultaneousDamage {}
  LifeDamage { n = 0 }
  // MISSING: `LifeDamage.n` is a fixed constant (Folkborn: every hit costs exactly 1 Candle); real
  // FaB damage equals the attacking card's own `power` (+ weapon/hero power, + chain buffs) minus
  // whatever the defense side prevents. No CombatRule expresses "the hit amount is computed."
  // CORE: the combat chain itself. `ResponseWindows` (below) opens once to a fixed defender after
  // one event; FaB needs a repeating window where priority passes between players after every
  // link (attack, reaction, or instant) until both pass in a row, and where the player who must
  // respond flips to whichever hero was just hit, not fixed to the original defender. The hooks
  // (`provide-actor`, `filter-actions`) are general enough that the *looping, role-flipping* part
  // is buildable as a new framework rule, not a core change -- flagged CORE only because the
  // event an attack raises (`attacker=unit, target=unit`) has no player-vs-player, numeric-amount
  // shape to loop over in the first place (see `hero-attack` in section 2).
]

responses = [
  ResponseWindows { name = 'DefenseReaction', after = [attack-declared] }
  ResponseWindows { name = 'AttackReaction', after = [hero-hit] }
  // MISSING: `WindowAfter` has no `hero-hit` member; Attack Reaction cards trigger once a hero has
  // actually been hit by an attack (after damage), not after the attack is declared.
  Stack {}       // chain links resolve as each is played, most-recent-first once nobody adds
                  // another -- closest existing fit to the chain; see the CORE note above
  NotAnAction {}  // reactions and blocks don't spend the turn's one action
]

triggers = [ActingPlayerFirst {}]
state-check = [LossOnStateCheck {}]      // a hero at 0 life loses
hero = []           // FaB heroes are single-faced; none of the Folkborn `hero` rules apply
objects = []         // no persistent board of units in the base game (see combat simplification)
```

## 2. Five representative cards

```
survey-fragment = Set
id = 'FAB-SAMPLE'
name = 'Survey Fragment'
core = '1'

cards = [
  // Attack action with Go Again.
  twin-strike = AttackAction {
    name = 'Twin Strike', cost = 1, pitch = 2, power = 3, go-again = true
    flavor = 'One blade opens the guard; the second finds the gap.'
  }

  // Defense reaction.
  sturdy-parry = DefenseReaction {
    name = 'Sturdy Parry', cost = 0, pitch = 1, defense = 2
    flavor = 'A half-step and a turned wrist is all it costs her.'
  }

  // Attack reaction, once per turn.
  retaliate = AttackReaction {
    name = 'Retaliate', cost = 1, pitch = 1, power = 2, go-again = true, once-per-turn = true
    flavor = 'Every strike taken is a strike owed.'
  }

  // Equipment with a once-per-turn activated ability.
  gauntlet-of-embers = Equipment {
    name = 'Gauntlet of Embers', cost = 1
    attached = Grant { power = 1 }
    flavor = 'Warm to the touch; hot when it needs to be.'
  }

  // Hero.
  ashen = Hero {
    name = 'Ashen, the Kindled Blade'
    face1 = Face { name = 'Ashen, the Kindled Blade' }
    flavor = 'Life 24, Intellect 4 -- printed on the card, not modelled (see the CORE note).'
  }
]
```

```
survey-fragment-rules = Rules
for = @survey-fragment

// Twin Strike needs no on-play effect at all: base combat damage equal to the card's own `power`
// is resolved by the `combat` area (see the LifeDamage/CORE note in section 1), and Go Again is
// read directly off the card by the still-missing turn rule, not by an effect. Listed here to
// show a "plain" attack action is nearly free once those two catalog entries exist.

// Sturdy Parry: "When you defend with this, prevent 2 additional damage from this attack."
// MISSING: `on-defend` trigger -- no Trigger fires when a card is played specifically as a block;
// the closest, `on-play`, is scoped to "played" in general, not "played as this attack's block".
// MISSING: `prevent` verb -- `cancel` exists on an event (all-or-nothing), but nothing reduces a
// pending numeric field. The engine's own `replace-operation` hook could rewrite the eventual
// `adjust` (life-loss) call with a smaller delta, but no verb exposes that from the program layer;
// only cancellation is reachable from an effect body today.
effect parry-prevent-2 { event.prevent(2) }               // MISSING: see above
@sturdy-parry.on-defend = parry-prevent-2                 // MISSING: see above

// Retaliate: "Once per Turn: when you are hit by an attack, you may pitch a card to play this,
// attacking whoever just attacked you."
// MISSING: `hero-hit` event -- the framework's only combat events (`combat`, `attack`) are typed
// `unit`, not `player`.
event hero-hit = Event { fields = [attacker = player, defender = player, amount = int] }  // MISSING
// MISSING: `attacking-player` selector, reading the event's `attacker` field back as a choosable
// actor for this card's own attack.
// MISSING: `damage-life` verb, targeting a player directly (the framework's `damage` verb is
// `on = units` only; life is a player counter, already reachable at the core level through
// `adjust`, but no framework verb wraps it for a player target).
effect retaliate-back { attacking-player(event).damage-life(2) }                          // MISSING
@retaliate.on-hero-hit = retaliate-back                                                    // MISSING

// Gauntlet of Embers: "Once per Turn Action, {pitch a card}: deal 1 damage to the defending
// hero." An activated ability with its own cost, usable as one of the turn's `ability` actions
// (already in the framework's `Action` enum).
// MISSING: `AttachmentCard` has no `extension` block at all (unlike `UnitCard`, `SpellCard`,
// `Face` and `Mechanic`, each of which gets at least one effect hook); an Equipment or Weapon
// card cannot carry any effect today, triggered or activated.
// MISSING: no shape anywhere for "an ability with its own activation cost" -- every existing
// trigger (`on-enter`, `exhaust`...) fires for free; nothing lets an effect declare what it costs.
extension Equipment { activate: effect? }                                                 // MISSING
effect gauntlet-ping { pay(@resources.Pitch, 1); choose(opponents).damage-life(1) }        // MISSING
@gauntlet-of-embers.activate = gauntlet-ping                                               // MISSING

// Ashen, the Kindled Blade: "Once per Turn Action, {pitch a card}: Ashen gets +1 power until end
// of turn." Same activated-ability shape as the equipment above, now on the Hero. `exhaust`
// (Folkborn's hero-ability trigger) is the wrong fit: it models tapping the Hero card, and FaB
// heroes are never tapped for their abilities, only their own printed cost is paid.
extension HeroCard { activate: effect? }                                                   // MISSING
effect ashen-ping { pay(@resources.Pitch, 1); this.buff(power: +1, until: this-round) }
@ashen.activate = ashen-ping                                                                // MISSING
```

## 3. Gap list

| Gap | Layer | How common | Suggested addition |
|---|---|---|---|
| No per-card Hero stats (Life total, hand-size/Intellect) | framework rule (`HeroCard` fields) | most games with a hero/avatar card | Add `life: int` and `hand-size: int` to `HeroCard`; a `LifeFromHero`/`HandSizeFromHero` variant of `LifeCounter`/`OpeningHand` that reads them |
| No combat stats or pitch value on a non-permanent card | framework rule (card records) | most games with attack-spells, or a discard-for-resource mechanic | The `ActionCard` fields in section 1 (`power`, `defense`, `pitch`, `go-again`, `once-per-turn`), folded into `SpellCard` or a new sibling record |
| `PitchFromHand` has no `zone`/`from`, and `worth` cannot vary per card | framework rule (ResourceRule) | rare as printed, but "value read off the card itself" recurs anywhere resource value isn't uniform | Add `zone`/`from` to match `CardsAsResources`; let `worth` be `int \| 'per-card'` |
| No turn rule for "keep acting while the last card played grants another action" | framework rule (TurnRule) | most games with combo/extra-action mechanics | `TurnRule GoAgainContinues {}`: after an action resolves, if it was flagged as extending the turn, re-open the action window instead of ending the turn |
| No "refill hand to N" turn step | framework rule (Step) | most games with a fixed or stat-based hand size | `Step RefillHandTo { hand: int }`, alongside the existing `Draw`/`DiscardTo` |
| Fixed defender, single-shot response window; no repeating priority pass with a flipping responder | framework rule (ResponseRule + hook wiring) | rare among catalogued games so far, common to any reaction-heavy TCG | `ResponseRule AlternatingPriority {}`: reuse `provide-actor`/`filter-actions` to hand priority to "whoever was just targeted", looping until two passes in a row |
| No event for a direct player-vs-player attack with a numeric amount | framework rule (Event) | most games where a hit can land on a player, not only a unit | `hero-attack = Event { fields = [attacker=player, defender=player, amount=int], cancellable=true }` beside the existing `attack`/`combat` events |
| No verb to damage a player's life directly | framework verb | most games with life-as-a-number | `damage-life = Verb { on = player, params = [amount=int] }`, a thin wrapper over the core's existing `adjust` operation |
| No verb to reduce (only cancel) a pending event's numeric field | framework verb / language | every game with a "prevent N damage" effect | A `prevent`/`reduce` verb usable inside an effect body, backed by the engine's existing `replace-operation` hook, reachable today only from a framework's own TypeScript |
| `AttachmentCard` has no `extension` block for any effect | framework rule (extension points) | most games where equipment/auras do more than grant a static stat | `extension AttachmentCard { on-attach: effect?, activate: effect?, static: static? }` |
| No shape for "an ability with its own activation cost," on any card | framework rule / language | most games with activated abilities | A `cost` parameter on `Trigger`, paid from a named resource before the effect body runs, instead of every trigger firing for free |
| No rule for "N cards start in a specific non-Hand, non-Deck zone" beyond the Hero | framework rule (SetupRule) | rare | `SetupRule StartsInZone { type: CardType, zone: Zone }` |
| No DeckRule for "at least one card required in a given zone" (a Weapon) | framework rule (DeckRule) | rare | `DeckRule ZoneMinimum { zone: Zone, n: int }` |

## 4. Verdict

Framework additions get most of the way there: nearly every gap above is a new catalog entry (a
Step, an Event, a verb, an extension point) buildable on the existing hooks (`provide-actor`,
`filter-actions`, `replace-operation`), not a change to `core.alex` itself; only the missing
player-vs-player attack event brushes the core, and even that only needs a new `Event`/field
combination the core's `Event.fields` shape already supports. The single largest obstacle is the
combat chain: an ordered, public, repeatedly-extendable sequence where the responding role flips
to whoever was just hit, versus the framework's current model of one fixed defender getting one
response window -- that gap alone blocks every Defense Reaction, Attack Reaction, and blocking
interaction in the game. Roughly 35-45% of a Classic Constructed pool -- plain attack actions and
single-effect instants, plus equipment that only grants a static bonus -- maps onto the existing
verbs and card records once `ActionCard`'s fields exist; the rest (all reactions, all activated
abilities, anything that prevents rather than deals damage) routes through the still-missing
extension points, verbs, and chain/priority model above.
