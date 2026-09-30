# Library rules in Alex, on paper

The runtime's step 3 (docs/tcg/runtime-design.md) makes games playable end to end: a round, playing a card, paying for
it, attacking, defeating, awakening, winning. The owner decided that every library rule is written in Alex, not Rust
in the engine. This page writes out, before any code, every library rule Hello TCG lists, so the language they need
can be reviewed first. Folkborn's rules follow the same patterns; its extra ones (the Lantern, Ambush, Candles) come
after Hello TCG plays.

Nothing here runs yet. Each block is a rule's type as a library's `.alex` file would declare it.

*Revised at the owner's review (2026-09-30).* Earlier drafts attached behaviour to engine hooks and events from
outside the rule, and read like configuration. The owner's proposal: a rule is a type, and its behaviour is members
of that type, next to its settings, like a class with methods.

## How a library rule reads

```
// A unit enters play exhausted.
type UnitsEnterExhausted : UnitRule {
  on-unit-enter = unit.exhaust()
}
```

Read it as: *the rule UnitsEnterExhausted: when a unit enters play, exhaust it.*

- The rule is a type, as it is today. A game lists it (`units = [UnitsEnterExhausted {}]`), and its behaviour runs only
  in games that list it.
- `on-unit-enter` is a moment: a member every rule has, declared once on the core's `Rule` type. Setting it to code,
  as a type already sets a member's value (`type TokenCreature : Creature { finishes = [standard] }`), gives the rule
  that behaviour.
- The moment's parameters are named where it is declared: `on-unit-enter(unit)`. So the handler says `unit`.
- `this` is the rule, so its settings are `this.n`, `this.lose-at`.

A handler of more than one statement is written like a method:

```
// A player's turn lasts until they pass; then the next player's starts.
type FullTurns : TurnRule {
  first: First
  on-player-pass(player) {
    game.end-turn()
    if game.turns-this-round < game.players.count {
      game.start-turn(player.next)
    }
  }
}
```

Handlers of one moment run in the order the game lists its rules.

## Abilities carry their own behaviour

An ability (Swift, Guardian) is a type too, and its behaviour is its members, the same way. *Ability* is the engine's
word for what cards and rulebooks call a keyword (the owner's choice, 2026-09-30): a named behaviour a card can have,
gain or lose.

```
// A unit with this ability enters ready.
type EntersReady : Ability {
  on-unit-enter = unit.ready()
}

// While the defender has a unit with this ability, only such units may be attacked.
type AttackedFirst : Ability {
  can-attack(attacker, target) {
    if target.controller.has-unit-with(this) {
      return target.has(this)
    }
    return true
  }
}
```

The game gives each its own name when it declares its abilities, and a card lists the ones it has:

```
abilities = [
  Swift = EntersReady {}
  Guardian = AttackedFirst {}
]

keeper-of-the-door = Creature {
  name = 'Keeper of the Door', cost = 3, power = 2, health = 5
  abilities = [@Guardian]
}
```

- An ability's unit moments run only for units that have it, so `EntersReady` needs no "if the unit has it".
- An ability's questions run in every game that declares it, and `this` is the ability (`has-unit-with(this)`).
- An ability a game declares as plain `Ability {}` has no behaviour: it is a word printed on its cards. A printable-only
  game declares all its abilities that way.
- An ability's moments run after the rules' for the same moment, so a Swift unit is exhausted (`UnitsEnterExhausted`),
  then readied.
- A card gains and loses abilities (`unit.gain(sneaky, until: this-round)`), and has them by name (`unit.has(@Swift)`).

This replaces the rules that only gave a game's keyword its meaning (`EntersReady { keyword = @Swift }`,
`GuardiansFirst { keyword = @Guardian }`, `HitCostsLife`, `PlayFreeWhenLost`…), and it is how Folkborn's family
abilities already work (Feather Coat, Rain-Fed and Pearl Tears carry their own handlers).

**What the rename touches.** Today's files say `Keyword`: the core's type, `keywords` on a game, a set and a card, the
libraries' keyword types, and the card layout's `{keywords}`. They become `Ability` and `abilities`, with the old names
kept as deprecated forms so every existing file still means the same (the core's rule: nothing is removed or renamed
outright). Today's `Ability` records (`OnEnter { text = ... }`, the old way a card declared that it has a handler)
merge into the new meaning: a card's `abilities` lists what it has, and a handler slot says what one does.
Descriptive tags that cards filter on (a creature type, a tribe) are not abilities; a game that needs them gets its own
small concept, as Folkborn has families.

## Kinds of card carry their own behaviour

A unit, a spell and a Hero are types in the libraries (`UnitCard`, `SpellCard`, `HeroCard`), and what every card of
that kind does is their members. In a card type's members, `this` is the card:

```
// A unit: played from hand by paying its cost, it enters the board.
type UnitCard : Card {
  cost: Cost?
  power: int
  health: int?
  can-play() {
    return this.in-hand and this.owner.can-pay(this.cost)
  }
  on-played() {
    this.owner.pay(this.cost)
    this.move-to(this.owner.board)
  }
}
```

A game's card types take these as bases. A printable-only game's types are plain cards; making the game playable
changes each type's base, one word, as an ability goes from `Ability {}` to `EntersReady {}`:

```
// Printable only: a Creature is a card.
type Creature : Printed { cost: int, power: int, health: int }

// Playable: a Creature is also a unit, and gets everything a unit does.
type Creature : Printed, UnitCard { cost: int, power: int, health: int }
```

A type may have more than one base (`Printed` for what Folkborn and Hello TCG print on every card, `UnitCard` for what
a unit does). Two bases that declare the same member must agree on its type. This replaces the rules that mapped a
game's types onto a library's (`UnitCards { types = [@Creature] }`) and the `[type UnitCard]` they needed.

## Moments and questions

The core's `Rule` declares every moment and question once, so any rule may handle any of them. The area base types
(`UnitRule`, `CombatRule`, `HeroRule`…) stay as they are: they say which list of the game a rule goes in.

**Moments** are when something happens; a handler does something:

| Moment | When |
|---|---|
| `on-game-start()`, `on-round-start()`, `on-round-end()` | the game starts; a round starts or ends |
| `on-player-game-start(player)` | the game starts, once for each player |
| `on-player-turn-start(player)`, `on-player-turn-end(player)` | a player's turn starts or ends |
| `on-player-pass(player)` | a player passes |
| `on-unit-enter(unit)`, `on-unit-leave(unit)` | a unit enters or leaves play (moving it onto or off the board) |
| `on-played()` | a player plays the card (a card type's member, `this` the card) |
| `on-unit-damaged(unit)`, `on-unit-turn-end(unit)` | a unit is dealt damage; a turn ends, for each unit in play |
| `on-attack(attacker, target)` | an attack is declared |
| `on-hero-used(hero)` | a player uses a Hero's ability |
| `on-player-check(player)`, `on-unit-check(unit)`, `on-hero-check(hero)` | the state check, after every action and effect: what must happen at once |

**Questions** have an answer; a handler returns it:

| Question | Asked of |
|---|---|
| `can-play()` | each card in the acting player's hand (a card type's member, `this` the card) |
| `attack-targets(attacker)` | each unit or Hero the acting player controls: what it may attack |
| `can-attack(attacker, target)` | each of those targets |
| `can-use(hero)` | the acting player's Hero |
| `can-act(player, kind)` | the acting player, for each kind of action |
| `is-round-over()` | the game, after each action |

A handler answers yes, no, or `nothing`: this rule has no say. An action is allowed when some rule says yes and none
says no. The engine asks the questions and offers the player what is allowed; no handler builds a list of actions.

## Hello TCG's rules

### Setup (`setup.alex`)

```
// A card of this type starts in this zone, not in the deck.
type StartsInZone : SetupRule {
  type: CardType | text
  zone: Zone
  face: int = 1
  on-player-game-start(player) {
    for card in player.deck.cards-of-type(this.type) {
      card.move-to(player.zone(this.zone))
    }
  }
}

type ShuffleDeck : SetupRule {
  zone: Zone?
  on-player-game-start = player.deck.shuffle()
}

type OpeningHand : SetupRule {
  n: int
  on-player-game-start = player.draw(this.n)
}
```

### Turns (`turns.alex`)

```
// A player's turn lasts until they pass; then the next player's starts. A round is every player's turn once.
type FullTurns : TurnRule {
  first: First
  on-game-start() {
    game.set-first(random(game.players))
  }
  on-round-start = game.start-turn(game.first)
  on-player-pass(player) {
    game.end-turn()
    if game.turns-this-round < game.players.count {
      game.start-turn(player.next)
    }
  }
  is-round-over() {
    return game.turns-this-round == game.players.count and not game.in-turn
  }
}

// Each phase's steps, in order, at the start of a player's turn.
type Phases : TurnRule {
  phases: [Phase]
  on-player-turn-start(player) {
    for phase in this.phases {
      for step in phase.steps {
        step.run(player)
      }
    }
  }
}

type ReadyAll : Step {
  run(player) {
    for card in player.cards-in-play {
      card.ready()
    }
  }
}

type Draw : Step {
  count: int
  skip-very-first-turn: bool = false
  run(player) {
    if not (this.skip-very-first-turn and game.turn == 1) {
      player.draw(this.count)
    }
  }
}

// Only the kinds of action the game lists may be taken.
type Actions : TurnRule {
  allowed: [ActionKind]
  can-act(player, kind) {
    return this.allowed.has(kind)
  }
}
```

A step is a type too: `run(player)` is its one member, and `step.run(player)` calls it.

### Resources (`resources.alex`)

```
// A number that rises to a cap (mana crystals): a capacity that grows, and what is left of it this turn.
type GrowingCounter : ResourceRule {
  name: text?
  start: int
  max: int
  pay-by: PayBy
  on-player-game-start = player.set(this.name, this.start)
}

type GrowsAt : ResourcePolicy {
  resource: ResourceRule
  moment: Moment
  by: int
  on-player-turn-start = player.grow(this.resource, this.by)
}

type RefillsAt : ResourcePolicy {
  resource: ResourceRule
  moment: Moment
  on-player-turn-start = player.refill(this.resource)
}
```

`grow`, `refill` and `pay` are the resources library's own routines, with parameters:

```
routine grow(player: player, resource: GrowingCounter, by: int) {
  player.set-capacity(resource, min(player.capacity(resource) + by, resource.max))
}
```

Hello TCG's `GrowsAt { moment = @turn-start }` names its moment; the members above fix it to the start of a turn
(question 3).

### Units (`units.alex`)

```
// A unit: played from hand by paying its cost, it enters the board.
type UnitCard : Card {
  cost: Cost?
  power: int
  health: int?
  can-play() {
    return this.in-hand and this.owner.can-pay(this.cost)
  }
  on-played() {
    this.owner.pay(this.cost)
    this.move-to(this.owner.board)
  }
}

type UnitsEnterExhausted : UnitRule {
  on-unit-enter = unit.exhaust()
}

// A unit with this ability enters ready (Hello TCG: Swift = EntersReady {}).
type EntersReady : Ability {
  on-unit-enter = unit.ready()
}

// Damage equal to or more than a unit's Health defeats it.
type DefeatAtHealth : UnitRule {
  on-unit-check = if unit.damage >= unit.health { unit.defeat() }
}
```

Playing a unit moves it onto the board, which is its `on-unit-enter`: the rules' (exhaust it, ready it if Swift) and
the card's own `on-enter` (Kłobuk draws a card). `defeat()` moves a unit to its owner's discard, which runs its
`on-defeated`.

### Spells (`spells.alex`)

```
// A spell: played from hand by paying its cost, it does what it says, then goes to the discard.
type SpellCard : Card {
  cost: Cost?
  can-play() {
    return this.in-hand and this.owner.can-pay(this.cost)
  }
  on-played() {
    this.owner.pay(this.cost)
    this.move-to(this.owner.discard)
    this.do-what-it-says()
  }
}
```

`do-what-it-says()` runs the card's own `on-play` (A Domowik's Temper deals its damage).

### Heroes (`heroes.alex`)

```
// A Hero: always in play, with a second face it may flip to (Folkborn's and Hello TCG's Awakened side).
type HeroCard : Card {
  back: Card?
}

// A Hero flips to its second face as soon as its Awaken condition holds, and never back.
type AwakenOnStateCheck : HeroRule {
  on-hero-check = if hero.face == 1 and hero.can-awaken() { hero.flip() }
}

// A Hero's Exhaust ability, used by exhausting it: at most once a round.
type PowerOncePerRound : HeroRule {
  can-use(hero) {
    return hero.ready
  }
  on-hero-used(hero) {
    hero.exhaust()
    hero.use-ability()
  }
}

// An Awakened Hero may attack, like a unit, and takes no damage doing so when the game says.
type HeroAttacksWhenAwakened : HeroRule {
  takes-no-damage: bool
  attack-targets(attacker) {
    if attacker.is-hero and attacker.face == 2 {
      return attacker.enemy-units + attacker.enemy-players
    }
    return nothing
  }
}
```

`TwoFaces` and `AwakenedNeverReverts` have no members to set: nothing flips a Hero back.

### Combat (`combat.alex`)

```
// The attacker chooses its target: an enemy unit, or the defending player's life.
type AttackerChooses : CombatRule {
  targets: [CombatTarget]
  attack-targets(attacker) {
    if not attacker.is-unit {
      return nothing
    }
    if this.targets.has(life) {
      return attacker.enemy-units + attacker.enemy-players
    }
    return attacker.enemy-units
  }
}

type AttackerMustBeReady : CombatRule {
  can-attack(attacker, target) {
    return attacker.ready
  }
}

// While the defender has a unit with this ability, only such units may be attacked (Hello TCG: Guardian =
// AttackedFirst {}).
type AttackedFirst : Ability {
  can-attack(attacker, target) {
    if target.controller.has-unit-with(this) {
      return target.has(this)
    }
    return true
  }
}

// An attack exhausts the attacker. A unit it attacks and the attacker deal their Power to each other at once.
type CombatDamageEqualsPower : CombatRule {
  on-attack(attacker, target) {
    attacker.exhaust()
    if target.is-unit {
      dealt = attacker.power
      taken = target.power
      target.damage(dealt)
      if not (attacker.is-hero and game.rule(HeroAttacksWhenAwakened).takes-no-damage) {
        attacker.damage(taken)
      }
    }
  }
}

// A hit on a player costs them life equal to the attacker's Power.
type LifeDamageEqualsPower : CombatRule {
  on-attack = if target.is-player { target.lose-life(attacker.power) }
}

// Damage stays on a unit until the end of the turn.
type DamageClearsAt : CombatRule {
  moment: Moment
  on-unit-turn-end = unit.heal(unit.damage)
}
```

`SimultaneousDamage` is the order written in `on-attack`: both amounts are read before either is dealt.

### Life (`life.alex`)

```
// A player's life as a number. A player whose life falls to the limit loses; the core ends the game when one player is
// left, and they win.
type LifeCounter : LifeRule {
  name: text
  start: int
  lose-at: int
  on-player-game-start = player.set(this.name, this.start)
  on-player-check = if player.counter(this.name) <= this.lose-at { player.lose() }
}
```

## What the language gains

1. **Members whose value is code.** A type sets a moment or question to one statement (`on-unit-enter = unit.exhaust()`)
   or to a body (`can-attack(attacker, target) { ... }`). In it, `this` is the rule, the ability or the card, and the
   member's parameters are named where the core declares it.
2. **More than one base type:** `type Creature : Printed, UnitCard { ... }`. It replaces the type-mapping rules and
   `[type UnitCard]`, which stay as deprecated forms.
3. **`return`**, for a question's answer, with `nothing` for "no say".
4. **`for x in list { ... }`**: the one loop. It goes over a finite list (cards, players, a rule's list), so every
   handler still finishes.
5. **Any name in a binding**: `dealt = attacker.power`. Today only `target` may be bound.
6. **`game.rule(RuleType)`**: another rule as the game lists it, or nothing (question 2).

The words handlers call (`move-to`, `exhaust`, `draw`, `enemy-units`, `can-pay`…) are the libraries' and the core's
vocabulary, each declared once.

A card could take the same form: a card's slots (`on-enter`) are members of its type, so a rules file's
`@klobuk.on-enter = draw()` sets a member of one card, as a rule's type sets a member of every instance of the rule
(question 4).

## Questions for the owner

1. **Does this read like code you would want to write?**
2. **Reading another rule's values.** `CombatDamageEqualsPower` needs `HeroAttacksWhenAwakened`'s `takes-no-damage`.
   The proposal is `game.rule(HeroAttacksWhenAwakened).takes-no-damage`, which is nothing when the game doesn't list
   that rule. Another option is for the two rules to be one.
3. **Rules that work at a moment the game chooses.** Hello TCG writes `GrowsAt { moment = @turn-start }`. Either the
   rule fixes its moment (`on-player-turn-start`, as above) and a game that grows at another moment lists another
   rule, or the rule names its moment and the engine runs it then. The first is simpler.
4. **Cards.** A card's handlers stay in the game's rules files (`@klobuk.on-enter = draw()`), since a set's file is
   data and its rules file code. Is that still right, now that rules put code in their types?
5. **What stays in Rust.** The core's operations, the loop, the scheduler, randomness and the words that read the
   game's state stay in the engine. Everything that is a rule of some game is Alex. Is that the line?

Once this is agreed, the language changes are made in both Alex implementations, the rules' members go into the
libraries, and the runtime runs them, until two random bots play whole Hello TCG games.
