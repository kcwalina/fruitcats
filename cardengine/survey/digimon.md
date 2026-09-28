# Survey: the Digimon Card Game (2020 rules) on this engine

Scope: the 2020-2021 base rule set (BT01-era) — 50-card main deck, 5-card Digi-Egg deck, the
shared Memory Gauge, digivolution stacks with inherited effects, a 5-card Security stack, Tamers,
Option cards, DP battles, Blockers, When-Digivolving/When-Attacking timings. Simplifications are
called out inline; card text below is paraphrased/invented to illustrate vocabulary, not quoted
from any printed card.

## 1. Game document

```
digimon = Game

name = 'Digimon Card Game'
rulebook = nic                       // survey only, no rulebook file
core = '1'
players = Players { min = 2, max = 2 }
sets = [@bt01]

// "Level" (In-Training/Rookie/.../Mega) is modeled as the card type itself, not a field, the same
// way Folkborn tells Fabled apart from Creature.
type InTraining : UnitCard {}
type Rookie : UnitCard {}
type Champion : UnitCard {}
type Ultimate : UnitCard {}
type Mega : UnitCard {}
type Option : SpellCard {}
// MISSING: no card record for a permanent that neither fights nor attaches to a unit. Tamer
// borrows bare Card plus its own cost; framework.alex has no such base (see gap list).
type Tamer : Card { cost: Cost }

types = [
  InTraining = CardType { name = nameof(InTraining) }
  Rookie = CardType { name = nameof(Rookie) }
  Champion = CardType { name = nameof(Champion) }
  Ultimate = CardType { name = nameof(Ultimate) }
  Mega = CardType { name = nameof(Mega) }
  Option = CardType { name = nameof(Option) }
  Tamer = CardType { name = nameof(Tamer) }
]

// The battle area holds independent digivolution stacks and Tamers side by side, unordered, like
// a hand rather than a display row.
zones = [
  Deck = Zone { name = nameof(Deck), shape = pile, visible = none, count-public = true }
  DigiEggDeck = Zone { name = nameof(DigiEggDeck), shape = pile, visible = none }
  Hand = Zone { name = nameof(Hand), shape = set, visible = owner }
  BreedingArea = Zone { name = nameof(BreedingArea), shape = slot, visible = all }
  BattleArea = Zone { name = nameof(BattleArea), shape = set, visible = all }
  Security = Zone { name = nameof(Security), shape = pile, visible = none, face-down = true }
  Trash = Zone { name = nameof(Trash), shape = row, visible = all }
]

keywords = [
  Rush = BuiltinKeyword { name = nameof(Rush), is = enters-ready }            // same builtin as Swift
  Blocker = BuiltinKeyword { name = nameof(Blocker), is = diverts-attack }    // MISSING: no such Builtin
  SecurityAttack = BuiltinKeyword {                                           // MISSING: no such Builtin
    name = nameof(SecurityAttack), is = extra-security-checks, value = 1
  }
]
event-names = [on-enter = 'On Play', on-defeated = 'Trashed']
randomness = [shuffle, coin]                        // a coin flip decides who goes first

deck-rules = [
  DeckSize { n = 50 }
  CopiesMax { n = 4 }
  DeckSize { n = 5 }   // MISSING: DeckSize has no `zone`; this can't target the Digi-Egg deck
]

// Setup also needs a per-turn breeding step and "no draw, turn 1, player 1" (see `turns` below);
// the Security stack's own setup is declared under `life`, per the Folkborn LifeStack precedent.
setup = [
  OpeningHand { n = 5 }
  RandomInitiative {}
]

life = [
  LifeStack { name = nameof(Security), zone = @Security, size = 5, from = @Deck }
  LostCardGoesTo { zone = @Trash }
  LoseOneAtATime {}
  LoseWhenEmpty {}
  // MISSING: a revealed Security card's own [Security] effect must resolve before it is
  // discarded; LifeRule has no such hook (Folkborn's Candles never read the lost card's text).
]

resources = empty            // memory is not a per-player pool; see `turns`
cost-resource = nic          // paid from the shared gauge below, not a ResourceRule

turns = [
  FullTurns { first = random }             // one player's whole turn, then the other's
  MemoryGauge { min = -10, max = 10, start = 0, voluntary-pass = 3 }   // MISSING new TurnRule
  RoundStart {
    steps = [
      ReadyAll {}
      HatchOrEvolveEgg {}                  // MISSING new Step: breeding-area action
      Draw { count = 1 }                   // MISSING: no per-step "skip, turn 1, first player"
      Triggers { of = turn-start }
    ]
  }
  Actions { allowed = [play, attack, ability, pass] }   // MISSING: Action has no `digivolve` member
  RoundEnd { steps = [Triggers { of = turn-end }] }
]

initiative = empty          // turn order is entirely decided by MemoryGauge; no separate token

combat = [
  AttackerChooses { targets = [unit, life] }    // life = attacking the player, i.e. a Security check
  AttackerMustBeReady {}
  UnitsEnterExhausted {}                        // summoning sickness; Rush lifts it
  DefenderBlocks { targets = [unit] }           // a Blocker may redirect the attack to itself
  // MISSING: battles compare a single DP stat and delete the loser; there is no damage/health
  // pool at all, so DamagePersists/LifeDamage/SimultaneousDamage don't apply here.
  DPCompareDeletes {}                           // MISSING new CombatRule
  TieDeletesBoth {}                             // MISSING new CombatRule
]

responses = empty      // no separate instant-speed layer outside the declared trigger timings

triggers = [TriggersImmediately {}, ActingPlayerFirst {}]   // simplified: real rules have more
state-check = [LossOnStateCheck {}]             // loses when Security and deck are both empty

hero = empty            // no two-faced hero card in this game

objects = [
  ZoneChangeResets { what = [attachments] }
  // CORE: no hook evaluates a card's own static/trigger while it sits inside another object's
  // `under` list. Digivolution buries cards there on purpose (inherited effects), so this is the
  // one thing framework rules alone cannot fix; see the Verdict.
]
```

## 2. Five representative cards

The memory gauge and the digivolution stack are the two structural stress points, so both get a
short model before the cards.

**Memory gauge.** `game-fields.counters` already anticipates it ("a memory gauge"), so the value
itself needs no new field. Paying a cost calls the existing `adjust-game(counter, delta)`
operation; the new `MemoryGauge` TurnRule (flagged above) hooks `provide-round-over` (the turn
ends the instant the counter crosses to the non-active player's side — checked, like everything
else, after every single action, which the core's per-action loop already supports) and
`provide-actor` (whoever the counter currently favors). No core change is needed for this part;
the gap is a framework `TurnRule`/verb pair, not a hook or operation.

**Digivolution stack.** `stack-under` (core operation) and `object-fields.under` are exactly the
primitive: playing Greymon onto Agumon is `stack-under(greymon, beneath: agumon)` after paying its
own cost. The unsolved part is *inherited* effects: Agumon's own static effect must keep applying
even after Greymon is stacked on top of it, i.e. even though Agumon is no longer the zone's
top-level object. That needs the `under`-list evaluation the Verdict calls out as a core gap.

```
bt01 = Set
id = 'BT01', name = 'New Evolution', core = '1', version = '0.1.0', status = prototype

// MISSING: no digivolve-cost field on UnitCard (only a play `cost`). Shown as if it existed.
extension UnitCard { digivolve: [DigivolveCost] = empty }
type DigivolveCost { from: CardType | text, cost: Cost }

cards = [
  agumon = Rookie {
    name = 'Agumon', cost = 3, power = 2000, health = 2000
    flavor = 'Small, stubborn, and always ready to fight above its size.'
  }
  greymon = Champion {
    name = 'Greymon', cost = 4, power = 5000, health = 5000
    digivolve = [DigivolveCost { from = @Rookie, cost = 4 }]
    flavor = 'What Agumon becomes when the fight gets serious.'
  }
  taichi = Tamer {
    name = 'Taichi Yagami', cost = 2
    flavor = 'Never gives up on his partner.'
  }
  power-charge = Option {
    name = 'Power Charge', cost = 2
    flavor = 'A quick jolt when it matters most.'
  }
  devimon = Champion {
    name = 'Devimon', cost = 4, power = 4000, health = 4000
    flavor = 'Master of the Dark Network.'
  }
]
```

```
bt01-rules = Rules
for = @bt01

// Agumon: inherited effect. Stays active for as long as Agumon is anywhere in a digivolution
// stack, buried or not.
// CORE: modelled here as if `static` could be attached to a card that isn't the zone's top
// object; the engine has no hook that would ever evaluate this once Greymon is stacked on it.
static agumon-grit { this.buff(power: +1000, until: permanent) }
@agumon.static = agumon-grit

// Greymon: when-digivolving effect, reading its own stack for the source card's name.
// MISSING: no `on-digivolve` Trigger; no way to read `under` from the rules language; no `named`
// filter; no framework verb for the shared gauge (using the core operation name directly here).
effect greymon-boost {
  if this.under.any(named: 'Agumon') { adjust-game(memory, +1) }
}
@greymon.on-digivolve = greymon-boost

// Taichi: a passive team-wide bonus plus a self-trashing activated ability.
// MISSING: `units(...)` only selects `from = players` today, not "these card types"; `trash` verb
// (wrapping the core `destroy` operation) doesn't exist; `on-use` (an activated ability the
// player chooses to pay for) isn't a Trigger kind.
static taichi-lord { units(own, [@Rookie, @Champion]).buff(power: +1000, until: permanent) }
effect taichi-draw { trash(this); draw(2) }
@taichi.static = taichi-lord
@taichi.on-use = taichi-draw

// Power Charge: a buff with a conditional memory refund.
// MISSING: no `type` property on a unit and no `in` test against a list of card types.
effect power-charge {
  target = choose(own)
  target.buff(power: +2000, until: this-round)
  if target.type in [@Rookie, @Champion] { adjust-game(memory, +1) }
}
@power-charge.on-play = power-charge

// Devimon: security effect. Fires when this card is the one revealed by a Security check, before
// it is discarded to the Trash.
// MISSING: `on-security` Trigger; a `hand` property; a `cost-at-most` filter parameter; a
// `play-free` verb (put a card into play bypassing its printed cost).
effect devimon-security {
  if own.hand.any(cost-at-most: 3) {
    target = choose(own, in-hand, cost-at-most: 3)
    play-free(target)
  }
}
@devimon.on-security = devimon-security
```

## 3. Gap list

| Gap | Layer | How common | Suggested addition |
|---|---|---|---|
| Shared signed counter that decides whose turn it is (memory gauge) | framework rule (turns) | rare (this game is the clear case; a few others hand off priority mid-turn) | `MemoryGauge : TurnRule { min: int, max: int, start: int, voluntary-pass: int }`, hooking `provide-actor` + `provide-round-over` off a `game-fields.counters` entry |
| Two independently-sized constructed decks (main + Digi-Egg) | framework rule (deck-rules) | rare | add `zone: Zone` to `DeckSize`, or `AuxiliaryDeck : DeckRule { name: text, zone: Zone, size: int, copies-max: int? }` |
| Card record for a persistent, non-fighting, non-attaching permanent (Tamer) | framework rule (card records) | most games (sagas, quests, auras-without-a-target, tamers) | `PermanentCard : Card { cost: Cost }` beside `UnitCard`/`SpellCard`/`AttachmentCard` |
| Stacking a new card onto an existing unit, at its own printed cost, gated by what's already under it (digivolution) | framework rule + card field | rare, but any "upgrade in place" mechanic wants it | `digivolve: [DigivolveCost]` on `UnitCard`; `digivolve = Verb { on = player, params = [card = token, onto = unit] }` wrapping `stack-under` + cost payment |
| Reading a static/trigger off a card that is inside another object's `under` list, not the top object (inherited effects) | core hook | most games with any stack/attach-and-keep-effect mechanic | new hook point, e.g. `provide-statics` that also walks `under` recursively, not just the zone's own objects |
| Numeric-threshold filters (DP ≤ n, cost ≤ n) | language (filters) | every game | let `Filter` carry a predicate: `Filter { on: Verb?, property: Property, compare: text, value: int }`, not only named boolean tags |
| Deleting a unit directly from an effect, outside combat/health | framework verb | every game | `trash = Verb { on = units }` wrapping the core `destroy` operation |
| Changing a shared game counter from an effect body | framework verb | most games (day/night trackers, shared pools, and this game's memory) | `adjust-game = Verb { params = [counter = text, delta = int] }` wrapping the identically-named core operation |
| Putting a card into play without paying its cost | framework verb | most games (alt-cost/free-cast/security-triggered plays) | `play-free = Verb { on = player, params = [card = card] }` |
| A reveal-triggered effect on the life/security stack's own lost card, before it's discarded | framework rule (life) | most games with a shield-trigger/last-stand card pattern | `RevealedCardEffectFires : LifeRule {}` + a matching Trigger (`on-security`) on the card records it applies to |
| Single-stat "power beats power" combat with no damage pool, ties destroy both | framework rule (combat) | most non-Magic-shaped fighters | `CompareStatDeletes : CombatRule { stat: Property }` + `TieDeletesBoth : CombatRule {}` |
| `digivolve` as a legal action kind | framework enum | rare | add `digivolve` to `enum Action` |
| Attacking a permanent that isn't a unit or the player (a Tamer) | framework enum | rare | add a member to `enum CombatTarget` |
| Skipping one step for one player on turn 1 only (no draw, first turn) | framework rule (Step) | rare | optional `skip-when: condition` on `Step`, or a dedicated `skip-round`/`skip-first` flag on `Draw` |
| Selecting units by card type, not just by owner/state (`units(own, [@Rookie, @Champion])`) | language (selectors) | most games with tribal/type-scoped effects | let `units`' `from` accept a filter on `CardType`, not only `players` |

## 4. Verdict

Nearly everything here is a framework addition on top of hooks and operations the core already
exposes — `stack-under`/`under` for digivolution, `adjust-game` and `game-fields.counters` for the
memory gauge, `provide-actor`/`provide-round-over` for the gauge deciding turns, `LifeStack` for
Security — so most of this game could be built without touching core.alex or core-operations.alex.
The one real exception is the single largest obstacle: an inherited effect must keep working once
its card is buried inside another object's `under` list, and nothing in the core ever evaluates a
rule for an object that isn't a zone's own occupant. Rough estimate: **roughly half the published
card pool** (plain stat-line Digimon, single-target on-play/security/when-attacking effects,
straightforward Options) is expressible with just the framework additions listed above; the other
half leans on inherited-effect payoffs across a digivolution line, richer numeric/type-scoped
selection than `condition`/named filters currently allow, or effects that manipulate the
opponent's hand or security in ways this survey didn't attempt to model, and those need the core
hook as well.
