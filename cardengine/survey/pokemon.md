# Survey: Pokémon Trading Card Game (current Standard: 60-card, 6 prizes)

Simplifications are called out inline. I did not chase exact numbers for rarer effects (e.g. the
Confused self-damage amount, which has varied by era) — those spots say so rather than guess.

## 1. Game document

```
pokemon = Game

name = 'Pokémon Trading Card Game'
rulebook = 'Pokémon TCG Rules Handbook (current Standard/2023+ rules)'
core = '1'
players = Players { min = 2, max = 2 }
sets = [@survey-set]

// Card types. Unlike a UnitCard, a Pokémon has no single play cost and no single "power": it is
// free to play and has several independently-costed attacks. See the Attacks note under `turns`
// and the gap list for how much this strains UnitCard's shape.
type Pokemon : UnitCard {}          // cost/power fields go unused; real data lives in `attacks`
type Supporter : SpellCard {}
type Item : SpellCard {}
type StadiumCard : SpellCard {}     // MISSING: a Stadium sits in play and persists; it is not a
                                     // one-shot resolve-and-discard SpellCard at all
type ToolCard : AttachmentCard {}
type BasicEnergy : Card {}          // MISSING: no link from a resource-typed Card to ResourceCards
type SpecialEnergy : Card {}        // (energy is drawn from the deck as ordinary cards, unlike
                                     // Folkborn's Offerings, which are any card played face down)

types = [
  Pokemon = CardType { name = nameof(Pokemon) }
  Supporter = CardType { name = nameof(Supporter) }
  Item = CardType { name = nameof(Item) }
  StadiumCard = CardType { name = 'Stadium' }
  ToolCard = CardType { name = 'Tool' }
  BasicEnergy = CardType { name = 'Basic Energy' }
  SpecialEnergy = CardType { name = 'Special Energy' }
]

// Zones. Active/Bench map cleanly onto `slot`/`slots`; Stadium's `shared = true` is exactly what
// "one Stadium in play, for both players" needs, with no framework help at all.
zones = [
  Deck = Zone { name = nameof(Deck), shape = pile, visible = none, count-public = true }
  Hand = Zone { name = nameof(Hand), shape = set, visible = owner }
  Discard = Zone { name = nameof(Discard), shape = row, visible = all }
  Prize = Zone { name = nameof(Prize), shape = pile, visible = none }
  Active = Zone { name = nameof(Active), shape = slot, visible = all }
  Bench = Zone { name = nameof(Bench), shape = slots, visible = all }
  // MISSING: Zone has no capacity; the Bench holds at most 5. Cheapest fix is framework-level,
  // not core: a new ObjectRule parameterised with the zone and the limit (see gap list) rather
  // than a field on every Zone.
  LostZone = Zone { name = 'Lost Zone', shape = pile, visible = all }
  Stadium = Zone { name = nameof(Stadium), shape = slot, visible = all, shared = true }
]

keywords = empty   // Special Conditions (Poisoned, Asleep, Paralyzed, Confused, Burned) are
                    // inflicted at runtime, not printed deck-building tags; modelled under
                    // `objects`/`state-check` below via the core's own `states` field instead.
event-names = [on-enter = 'Play', on-defeated = 'Knock Out']
randomness = [shuffle, coin]        // coin flips resolve attack effects and special conditions

// Deckbuilding.
deck-rules = [
  DeckSize { n = 60 }
  CopiesMax { n = 4 }     // MISSING: Basic Energy is exempt from the 4-copy cap; CopyLimit can
                           // only make a *stricter* per-type limit, never carve out an exemption
]

// Setup.
setup = [
  RandomInitiative { cites = 'coin flip' }
  // MISSING: the flip's winner *chooses* who goes first, rather than the flip itself deciding;
  // `First` has only initiative-holder | random | loser-of-last, no "winner picks".
  OpeningHand { n = 7 }
  // MISSING: the real mulligan is forced, not optional: no Basic Pokémon in the opening 7 means
  // reveal the hand, shuffle it back, redraw 7, and the *opponent* may then draw one extra card
  // per mulligan taken. `Mulligan{times, up-to}` models a voluntary partial redraw and has no
  // room for "forced", "reveal", or "opponent gets bonus draws".
  MulliganUntilBasic { opponent-bonus-draw = true }               // MISSING rule type
  // MISSING: choosing a Basic Pokémon from hand for Active, then up to 5 more face-down onto
  // the Bench, revealed together. No SetupRule expresses "player chooses N cards from hand
  // matching a filter into a zone"; `HeroTo` only ever moves one already-known card.
  ChooseToZone { zone = @Active, filter = basic, count = 1 }      // MISSING rule type
  ChooseToZone { zone = @Bench, filter = basic, count = 'up to 5' }   // MISSING rule type
]

// Life. The Prize stack looks exactly like Folkborn's Candles (a face-down LifeStack the owner
// may not look through) until you ask what happens when it hits zero.
life = [
  LifeStack { name = nameof(Prize), zone = @Prize, size = 6, from = @Deck }
  LostCardGoesTo { zone = @Hand }
  // MISSING: taking your last prize is a WIN, not a loss; the catalog only has `LoseWhenEmpty`.
  WinWhenEmpty {}                                                 // MISSING rule type
  // MISSING: the number of prizes taken per knockout depends on the *defeated* card (1 normally,
  // 2 or 3 for marked rarities/mechanics), not a fixed amount tied to the hit like `LifeDamage`.
  PrizesOnKnockout { property = 'prize-value' }                   // MISSING rule type
  // MISSING: failing to draw for your turn (empty deck) is an immediate loss, not a life cost
  // like `EmptyDeckDrawCosts`.
  LoseOnEmptyDeckDraw {}                                          // MISSING rule type
]

// Resources. Energy cards attaching to Pokémon is a clean `ResourceCards` fit. What does not fit
// is *spending* them: see the note under `turns`.
resources = [
  Energy = ResourceCards { name = nameof(Energy), attaches-to-units = true }
]
resource-rules = [
  // MISSING: no ResourcePolicy caps how many attachments happen per turn; `NoIdentityWhileResource`
  // is about a different game's semantics entirely.
  AttachLimitPerTurn { resource = @resources.Energy, n = 1 }      // MISSING rule type
]
// `cost-resource` is deliberately omitted. Pokémon and Trainer cards are free to play; nothing in
// this game is paid for out of a resource pool at play time. Only attacks have a cost, and that
// cost is a standing *requirement* against Energy already attached — never spent to pay for
// anything. See "Attacks" below and the gap list; this is the framework's biggest mismatch here.

// Turns.
turns = [
  FullTurns { first = random }      // MISSING: should be "coin-flip winner chooses", see setup
  RoundStart {
    // CORE-adjacent note, not a blocker: `skip-round` skips an entire round; Pokémon skips only
    // the *first* player's very first draw step, and the second player still draws normally on
    // their first turn. No SetupRule/TurnRule targets "this step, for this one player, once".
    steps = [Triggers { of = round-start }, Draw { count = 1 }]
  }
  // MISSING: `Action` has play/attack/ability/take-initiative/pass — no distinct member for
  // attaching Energy, evolving, or retreating, so none of the following per-turn caps have
  // anything to attach to without first growing the enum.
  Actions { allowed = [play, attack, ability, pass] }
  ActionLimit { action = play, applies-to = @Supporter, n = 1 }   // MISSING rule type; Action has
                                                                   // no per-card-type granularity
                                                                   // to tell Supporter from Item
  ActionLimit { action = @attach-energy, n = 1 }                  // MISSING Action member + rule
  ActionLimit { action = @evolve, n = 1, per = unit }             // MISSING Action member + rule;
                                                                   // "per unit, not per turn" is
                                                                   // also new (once-per-round on
                                                                   // UnitCard is per *card*, not
                                                                   // per action-kind-per-target)
  ActionLimit { action = @retreat, n = 1 }                        // MISSING Action member + rule
  RoundEnd {
    steps = [
      Triggers { of = round-end }
      ResolveSpecialConditions {}   // MISSING Step: Poisoned/Burned damage, Asleep/Paralyzed
                                     // coin-flip or automatic recovery, between every turn
    ]
  }
]
// Attacks: the hardest part. A Pokémon lists 1-4 named attacks, each with its own Energy cost,
// damage number, and text/effect, used one at a time as that Pokémon's entire turn-ending action.
// Modelled here as a new named, addressable record (see the MISSING `Set.attacks` catalog in
// section 2) rather than squeezing multiple costs onto one UnitCard. The cost itself reuses the
// existing `Cost = int | [text: int]` shape (`[fire = 2, colorless = 1]`) — only *checking* it
// against attached, unconsumed Energy is new; nothing pays it out of a pool.

initiative = empty   // no ongoing initiative token; after setup, turns simply alternate, which
                      // `FullTurns` already gives for free

// Combat. One Pokémon (Active) can attack, and it always attacks the opponent's Active — there is
// no attacker choice among several targets the way Folkborn's Guardian/Sneaky pair assumes.
combat = [
  AttackerChooses { targets = [unit] }    // in practice: filtered down to the single legal target
  AttackerMustBeReady {}                  // plus Asleep/Paralyzed/Confused locks -- see objects
  // MISSING: Pokémon combat is one-directional; only the attacker deals damage. The catalog's
  // `SimultaneousDamage` implies the alternative is mutual trading, but there is no explicit
  // "attacker only" entry either.
  AttackerOnlyDamage {}                                           // MISSING rule type
  DamagePersists {}                       // damage stays on a Pokémon even across retreats
  // MISSING: Weakness (usually double damage) and Resistance (usually -30) by elemental Type;
  // needs a `type` field per Pokémon plus a damage-recomputation step, neither of which exists.
  WeaknessResistance {}                                           // MISSING rule type
  // MISSING: retreating — pay an Energy-discard cost to swap Active with a Bench Pokémon, once
  // per turn — has nowhere in the catalog at all; it is not attacking, so it does not belong
  // under any existing CombatRule, but there is no other area for it either.
  Retreat { pay = @resources.Energy, once-per-turn = true }       // MISSING rule type
]

responses = empty   // no instant-speed play of any kind; everything happens on your own turn

triggers = [ActingPlayerFirst {}, TriggersImmediately {}]

state-check = [
  DefeatAtHealth {}    // damage >= HP -> Knocked Out; the same "accumulated damage vs a health
                        // total" shape as Folkborn, direct fit
  // MISSING: "a player has no Pokémon left in Active or on the Bench" is an immediate loss,
  // unrelated to any life-stack rule.
  LoseWithEmptyZones { zones = [@Active, @Bench] }                // MISSING rule type
]

hero = empty   // no Hero card type in this game

objects = [
  // Evolving stacks the new card on the old one, in place, keeping damage and attached Energy —
  // this reuses the core's existing `stack-under`/`under` primitive and needs no core change, but
  // it is real orchestration (see the gap list) rather than a single flag.
  EvolveStacksPreservingState {}                                  // MISSING rule type
  // CORE: there is no operation that changes an object's `card` identity in place, or that moves
  // an object's own counters/attachments onto a *different* object. The workaround above (stack,
  // then re-attach/re-count onto the new top object with existing ops) works, but a dedicated
  // "succeed" operation would make evolution, and any other game with upgrading permanents, a
  // single step instead of several chained ones.
  ZoneChangeResets { what = [] }   // MISSING: `Reset` needs a `special-conditions` member; a
                                    // retreat clears status but keeps damage, a combination the
                                    // enum's other members already show is possible, just not
                                    // for status specifically
]
```

## 2. Five representative cards

A basic with two attacks, an evolution, a Supporter, an Item, and a Stadium.

```
survey-set = Set
id = 'PKMN-SAMPLE'
name = 'Pokémon Survey Sample'
core = '1'
version = '0.1.0'
status = prototype

// MISSING: Set has no `attacks` catalog. `cards`/`tokens`/`counters`/`keywords`/`decks` are the
// only named maps a Set carries today; attacks need the same treatment so effects can be wired
// to one attack instead of to the whole card.
attacks = [                                                       // MISSING: new Set field
  scratch = Attack { name = 'Scratch', cost = [colorless = 1], damage = 10 }
  ember = Attack {
    name = 'Ember', cost = [fire = 1, colorless = 1], damage = 30
    text = 'Discard an Energy attached to this Pokémon.'
  }
  flamethrower = Attack {
    name = 'Flamethrower', cost = [fire = 2, colorless = 1], damage = 70
    text = 'Discard an Energy attached to this Pokémon.'
  }
]
// MISSING: `Attack` itself is a new record `{ name, cost: Cost, damage: int, text: text? }` with
// nowhere in core.alex/framework.alex to declare it; shown here as if it already existed.

cards = [
  // Basic Pokémon, two attacks.
  charmander = Pokemon {
    name = 'Charmander', rarity = common
    cost = 0, power = 0, health = 60          // MISSING: cost/power are dead UnitCard fields here
    type = fire, retreat = [colorless = 1]    // MISSING: `type` and `retreat` fields on Pokemon
    attacks = [@scratch, @ember]              // MISSING: `attacks` field on Pokemon
    prize-value = 1                           // MISSING: `prize-value` field on Pokemon
  }
  // Evolution.
  charmeleon = Pokemon {
    name = 'Charmeleon', rarity = uncommon
    cost = 0, power = 0, health = 90
    type = fire, retreat = [colorless = 2]
    evolves-from = @charmander                // MISSING: `evolves-from` field on Pokemon
    attacks = [@flamethrower]
    prize-value = 1
  }
  // Supporter.
  professors-research = Supporter {
    name = 'Professor''s Research', rarity = uncommon
    cost = 0   // free to play; see cost-resource note in section 1
  }
  // Item.
  ultra-ball = Item {
    name = 'Ultra Ball', rarity = uncommon
    cost = 0
  }
  // Stadium (illustrative text -- not a verbatim reprint of a specific real card).
  training-camp = StadiumCard {
    name = 'Training Camp (illustrative)', rarity = uncommon
    cost = 0
  }
]
```

```
survey-set-rules = Rules
for = @survey-set

// Ember / Flamethrower: "Discard an Energy attached to this Pokémon."
effect discard-attached-energy {
  discard-attached(this, kind = @resources.Energy, count = 1)   // MISSING verb: nothing lets an
}                                                                // effect discard from among an
@ember.effect = discard-attached-energy       // MISSING: attacks aren't wireable targets today --
@flamethrower.effect = discard-attached-energy // there is no `@name.field = effect` path onto a
                                                // record living inside a list on a card

// Professor's Research: "Discard your hand, then draw 7 cards."
effect professors-research-effect {
  discard-hand(own)          // MISSING verb: nothing empties a player's hand in one call
  draw(7)
}
@professors-research.on-play = professors-research-effect

// Ultra Ball: "You may discard 2 cards from your hand. If you do, search your deck for a
// Pokémon, reveal it, and put it into your hand. Then shuffle your deck."
effect ultra-ball-effect {
  discard-from-hand(own, count = 2, optional)        // MISSING verb: discarding *from hand* as a
                                                       // cost, distinct from discarding a chosen
                                                       // unit already in play
  found = search(own.deck, filter = pokemon-type, optional)   // MISSING selector: nothing looks
                                                                // through a hidden zone by filter
  if found { found.reveal(own); found.move(to = own.hand) }   // MISSING: `move`/`reveal` are core
                                                                // operations, not rules-layer verbs
  shuffle(own.deck)          // MISSING: `shuffle` is a core operation only; no rules-layer verb
}
@ultra-ball.on-play = ultra-ball-effect

// Training Camp (illustrative): a Stadium's effect applies to both players for as long as it
// stays in play, not to "this" card the way a UnitCard's `static` does.
static training-camp-rule {
  units(all).cant(retreat)    // illustrative text; `retreat` MISSING from the Action enum, and
}                              // `static` is only an extension of UnitCard, not of SpellCard
@training-camp.static = training-camp-rule    // MISSING: SpellCard (Stadium's base) has no
                                               // `static` extension point at all
```

## 3. Gap list

| Gap | Layer | How common | Suggested addition |
|---|---|---|---|
| Attack costs check already-attached, unconsumed resources instead of spending a pool | framework (`Cost`/`PayBy`) | every game with attached-resource costs | New `ResourcePolicy RequiresAttachedResources { resource, consumes: bool = false }`, checked in `filter-actions`/`before-operation` instead of paid |
| A card needs several independently-costed, independently-triggered named attacks | framework card record + Set schema | every game | Add `attacks: [text: Attack]` to `extension Set` (beside `cards`/`tokens`), a new `Attack { name, cost: Cost, damage: int, text: text? }` record, and `extension UnitCard { attacks: [Attack] = empty }` |
| Evolution: replace a permanent in place while keeping its damage/attachments | framework rule (core's `stack-under`/`under` already suffices) | most games with upgrading permanents | `ObjectRule EvolveStacksPreservingState {}`; optionally a core convenience operation `transform(object, to-card)` so it is one step, not several |
| Weakness/Resistance (Type-based damage multiplier) | framework rule + card field | most games with elemental typing | `type: text` + `weakness`/`resistance: [text:int]` fields; `CombatRule WeaknessResistance {}` recomputing `damage` before it applies |
| Special Conditions (Poisoned, Burned, Asleep, Paralyzed, Confused) with periodic, sometimes coin-flip resolution | framework rule catalog | most games with status effects | `ObjectRule SpecialCondition { name, prevents: [Action], cure: text }` (cure = coin-flip, automatic, or never); `Step ResolveSpecialConditions {}` for the between-turns check |
| Prize count varies per knocked-out card, not a fixed amount per hit | framework rule | rare (mostly this game's shape) | `LifeRule PrizesOnKnockout { property: text }` reading a per-card `prize-value` |
| Emptying your own life-stack is a WIN, not a loss | framework rule | rare | `LifeRule WinWhenEmpty {}` beside the existing `LoseWhenEmpty` |
| Forced mulligan with an opponent bonus draw | framework rule | rare | `SetupRule MulliganUntilBasic { filter, opponent-bonus-draw: bool }` |
| Setup requires choosing N cards from hand, by filter, into a zone | framework rule | most games | `SetupRule ChooseToZone { zone, filter, count }` (`count` as exact or "up to") |
| Per-action-kind once-per-turn caps (Supporter, Energy attach, retreat) distinct from per-card limits | framework rule + `Action` enum | most games | New `Action` members (`attach-resource`, `evolve`, `retreat`); `TurnRule ActionLimit { action, applies-to: CardType?, n, per: text }` (per = turn or unit) |
| Bench-style zone with a fixed capacity | framework rule | most games with a bench/row limit | `ObjectRule ZoneCapacity { zone, n }`, enforced in `filter-actions` — no core field needed |
| One-directional combat damage (attacker only, no return trade) | framework rule | most games without mutual combat | `CombatRule AttackerOnlyDamage {}` beside `SimultaneousDamage` |
| Retreat/switch: swap Active with a Bench unit, paying a cost, once per turn | framework rule | most games with a bench | `CombatRule Retreat { pay: Cost, once-per-turn: bool }` |
| Search a hidden zone by filter and take one card privately | framework verb (`require-action`'s existing acting-player-only visibility already covers the hard part) | every game with tutor effects | `Verb search { on = player, params = [zone, filters], yields = unit }` |
| Discarding from an object's own attachments, or from a player's hand, as an effect or cost | framework verbs | most games | `discard-attached(unit, kind, count)`, `discard-from-hand(player, count, optional)`, `discard-hand(player)` |
| A shared, persistent, replace-on-play card type whose static affects both players | framework card record | rare (Stadium-style games) | `StadiumCard : Card { cost: Cost }` with `extension StadiumCard { static: static? }` scoped to `units(all)`, not `this` |
| Immediate loss when a player has zero objects across a set of zones | framework rule | rare | `StateCheckRule LoseWithEmptyZones { zones: [Zone] }` |
| Immediate loss on failing to draw for turn (empty deck) | framework rule | rare | `LifeRule LoseOnEmptyDeckDraw {}` |

## 4. Verdict

Framework additions look sufficient — I did not find a case that needs a new core operation, query,
hook, or field; even evolution's "replace a permanent while keeping its state" is buildable from the
existing `stack-under`/`under`/`attach`/`add-counter` primitives, just clumsily. The single largest
obstacle is that attacks are card-level, multi-costed, and *checked* against standing Energy rather
than *paid* from a spent pool: that cuts against both `UnitCard`'s one-cost-one-power shape and the
`Cost`/`PayBy` resource model everywhere they are used, so it is not one catalog entry away like most
of the other gaps. Rough estimate: maybe 20-25% of the real card pool — plain vanilla attackers with
no attack text, and Item/Supporter cards that only draw, heal, or search — would already fit the
`effect`/`static`/`condition` machinery in `starter-box-rules.alex` once the attacks-as-data and
non-consumed-cost gaps are closed at the framework level; most of the rest leans on Abilities,
Weakness/Resistance math, and Special Conditions, which need the additional catalog entries above.
