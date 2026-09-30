# Rules as data, on paper

*The owner's decision (2026-09-30): Alex is a purely data modelling language.* Its program layer (statements run in
order, variables, `if` statements, routine bodies) goes. What a card or a rule does is written as **data**: effects are
records, choices are records, order is a list, and conditions and amounts are **formulas**, pure expressions like a
spreadsheet's that read the game without changing it. Nothing here runs yet: this page is for review before the
language, the runtime and the games' files change.

It covers:
- the four ideas (effects, formulas, choices, effect types defined from others);
- the core's own effects, the only behaviour written in Rust;
- Folkborn's rules files and Hello TCG's, rewritten as data;
- the library rules the runtime's step 3 needs (`docs/tcg/runtime-design.md`), rewritten as data;
- what changes in Alex, and questions for the owner.

## The four ideas

**1. An effect is a record.** What a card does is the effects it lists, in order:

```
@klobuk.on-enter = Draw()
@a-domowiks-temper.on-play = Damage(card.damage, target: Choose(all))
```

`Damage(card.damage, target: Choose(all))` is the record `Damage { amount = card.damage, target = Choose { from = all } }`
written on one line, as a constructor call (the owner's choice). Arguments without a name fill the type's fields in the
order it declares them; the rest are named. Types declare their main field first (`Damage(amount, target)`,
`Choose(from, filter)`, `Draw(count, player)`), and handlers name everything after it. A long record, such as a card or
a scenario, keeps the block form; the two are the same record.

A list is data too, and its order is the order the effects happen:

```
@saucer-of-milk.on-play = [
  Gain(Choose(own), power: card.boost, until: this-round)
  ReadyResources(one)
]
```

**2. A formula is a value computed from the game.** Amounts, conditions and targets may be formulas: `card.damage`,
`units(own).count >= card.units`, `if @has-company then card.company-damage else card.damage`. A formula reads the
game and never changes it, like a cell in a spreadsheet. A condition on an effect is its `only-if`:

```
@kikimora.on-enter = Draw(card.draw, only-if: @is-well-fed)
```

**3. A choice is a value.** `Choose(own)` stands for the unit its player will choose. The engine asks when
the effect runs (or, for a card that is played, when it is played, before the opponent may answer), and every effect
that names it applies to that one unit. Several effects share one target through `Effect(target, do: [...])`:

```
// Ready an exhausted unit you control. Heal 2 from it.
@choicest-odours.on-play = Effect(Choose(own, filter: exhausted), do: [
  Ready()
  Heal(card.heal)
])
```

**4. An effect type may be defined from others.** A library writes what `Draw` means as the core effects it is made
of, with its own fields as parameters:

```
type Draw : Effect {
  player: Formula = own
  count: Formula = one
  do = Move(this.player.deck.top(this.count), to: this.player.hand)
}
```

So a library's whole vocabulary (`Draw`, `Heal`, `Sprout`, `Pay`) is data made of a few core effects, and a game can
define its own the same way.

**What an effect acts on.** An effect about a unit acts on `this` (the card whose handler it is) unless it names a
`target`; one about a player acts on `own` unless it names a `player`. A target may be a set (`units(own)`): the
effect happens to each. That is what replaces loops.

## The core's effects

These are the only behaviour the engine implements; everything else is defined from them. Each is one of the core's
operations (`core-operations.alex`) as a record:

| Effect | What it does |
|---|---|
| `Move(target, to:, at:)` | moves cards to a zone (their owner's zone of that name) |
| `Shuffle(zone)` | shuffles zones |
| `Flip(target, face:)` | turns a card to a face |
| `Exhaust(target)`, `Ready(target)` | sets or clears a card's exhausted state |
| `SetState(target, state:, on:)` | any other state |
| `AddCounter(counter, by:, target:)`, `SetCounter(counter, value:, target:)` | a card's or a player's number |
| `Create(card, zone:)` | makes a token |
| `Destroy(target)` | removes a token from the game |
| `Reveal(target, to:)`, `Conceal(target)` | shows cards |
| `StartTurn(player)`, `EndTurn()`, `SetFirstPlayer(player)` | the turn |
| `Lose(player)`, `Win(player)`, `DrawGame()` | the game's end |
| `Effect(target, do:)` | several effects sharing a target |

Every effect also takes `only-if` (a condition formula) and `once-per-round` (at most once a round for the card whose
handler it is).

## Folkborn, rewritten as data

Each set's rules file, as it would read. Nothing in the sets' card files changes.

### `folkborn-rules.alex` (shared)

```
boost-own-and-ready-an-offering = [
  Gain(Choose(own), power: card.boost, until: this-round)
  ReadyResources(one)
]
```

### `domowiki-rules.alex`

```
@dziadzius.exhaust = ReadyResources(one)
@dziadzius.awaken = own.resources.count >= card.offerings
@dziadzius.back.exhaust = ReadyResources(two)

@stove-keeper.on-enter = ReadyResources(one)

// §850.1 If the deck runs out, the rest does nothing; it never costs a Candle.
sprout = OfferFromDeck(card.sprout, exhausted: true)
@moving-day-domowik.on-enter = @sprout

// §850.2 Ready or exhausted Offerings both count.
is-well-fed = own.resources.count >= @well-fed-at
@ovinnik-of-the-drying-barn.static = CantAttack(only-if: not @is-well-fed)

@bread-and-salt-greeter.on-enter = Heal(card.heal, target: units(own))
@kikimora.on-enter = Draw(card.draw, only-if: @is-well-fed)
@bowl-of-kasha.on-play = @sprout
@a-domowiks-temper.on-play = Damage(card.damage, target: Choose(all))
@saucer-of-milk.on-play = @boost-own-and-ready-an-offering
@old-bast-shoe.static = Grant(attached, power: card.boost, health: card.extra-health)
@domowik-in-a-cats-shape.on-enter = @sprout
@babunia.on-enter = ReadyResources(one)
@klobuk.on-enter = Draw()
@warm-hand-in-the-night.on-play = Gain(Choose(own), power: card.boost, until: this-round)
@knotted-mane.on-play = Exhaust(Choose(opponents))
```

### `pari-rules.alex`

```
// §850.4 Feather Coat is a Goodbye.
@feather-coat.on-defeated = Summon(@dove)

@parijan.exhaust = Gain(Choose(own), abilities: [@Sneaky], until: this-round)
@parijan.awaken = units(own).count >= card.units
@parijan.back.exhaust = Gain(Choose(own), power: card.boost, abilities: [@Sneaky], until: this-round)

// §850.0 Orange-Peri is one of the cards played this round, so "2 other cards" means 3 in all.
@orange-peri.on-enter = Damage(card.damage, only-if: own.played-this-round <= card.others)

// §850.3 Counted when the effect is checked; a unit that just entered counts itself.
has-company = units(own).count >= @company-at
@pari-at-the-pool.on-enter = Ready(only-if: @has-company)

// Súči of the Hunt and Mountain Gale: "Deal {damage} damage to a unit. Company: deal {company-damage} instead."
company-damage = Damage(if @has-company then card.company-damage else card.damage, target: Choose(all))
@suci-of-the-hunt.on-enter = @company-damage

@khangi.on-enter = Draw()
@falling-star.on-play = Damage(card.damage, target: Choose(all))
@mountain-gale.on-play = @company-damage
@choicest-odours.on-play = Effect(Choose(own, filter: exhausted), do: [
  Ready()
  Heal(card.heal)
])
@zangwar.on-play = Gain(Choose(own), power: card.boost, until: this-round)
@carried-off-asleep.on-play = Exhaust(Choose(opponents))
@pari-banus-pocket-tent.static = Grant(attached, health: card.extra-health)
@manar-al-sana.on-enter = Ready(Choose(own, filter: other))
@asman-pari.on-enter = Damage(card.damage, target: units(opponents))
@schaibar.on-defeats-in-combat = Ready(once-per-round: true)
```

### `aluxes-rules.alex`

```
// §850.5 The rain counter's `max` stops it at +2/+2.
@rain-fed.on-round-start = AddCounter(@rain, by: one)

@aluxito.exhaust = Heal(card.heal, target: Choose(own))
@aluxito.awaken = own.life.count <= card.candles
@aluxito.back.exhaust = Effect(Choose(own), do: [
  Heal(card.heal)
  Gain(abilities: [@Guardian], until: this-round)
])

@saka-bearing-alux.on-enter = Heal(card.heal, target: Choose(all))
@corn-tending-alux.on-enter = Draw(only-if: units(own, @Guardian).any)
@tool-hiding-alux.on-enter = Exhaust(Choose(opponents))
// §600.3 The attacker stays exhausted.
@a-whistle-in-the-dark.on-play = CancelAttack()
@honey-and-tortillas.on-play = [
  Heal(card.heal, target: Choose(own))
  Draw()
]
@pots-and-pans-flung.on-play = Damage(card.damage, target: Choose(all, filter: exhausted))
@kahtal-alux.static = Grant(attached, health: card.extra-health, abilities: [@Guardian])
@the-roadside-alux.on-you-heal = Draw(once-per-round: true)
@the-alux-of-the-sacred-cenote.on-round-start = Heal(card.heal, target: units(own))
@toh.on-enter = Draw()
@a-sweet-on-the-doorstep.on-play = Gain(Choose(own), power: card.boost, until: this-round)
@lost-in-the-monte.on-play = Exhaust(Choose(opponents))
```

### `jiaoren-rules.alex`

```
// §850.6
@pearl-tears.on-survives-damage = ReadyResources(one)

@zhu-er.static = Grant(units(own), abilities: [@pearl-tears])
@zhu-er.exhaust = Heal(card.heal, target: Choose(own))
// Both players' Mists count, as today's engine counts them.
@zhu-er.awaken = cards(@Mist, all, unit-card).count >= card.fallen
@zhu-er.back.static = Grant(units(own), health: card.extra-health, abilities: [@pearl-tears])
@zhu-er.back.exhaust = ReadyResources(two)

@the-spring-guest.on-defeated = ReadyResources(two)
@weaver-of-the-sea-hall.on-enter = Draw()
@dragon-silk.static = Grant(attached, health: card.extra-health, abilities: [@Guardian])
@pearl-oyster.on-enter = ReadyResources(one)
@jiaoren-pearl-healer.on-enter = Heal(card.heal, target: units(own))
@muke.on-enter = Draw()
@a-plate-of-pearls.on-play = @boost-own-and-ready-an-offering
@the-sea-turns-rough.on-play = Damage(card.damage, target: Choose(all))
@moonlit-sea.on-play = Exhaust(Choose(opponents))
@frost-white-silk.static = Grant(attached, health: card.extra-health, abilities: [@pearl-tears])
@quanxian.on-enter = ReadyResources(two)
@the-muke-poet.on-defeated = Draw(card.draw)
@tears-of-gratitude.on-play = Gain(Choose(own), power: card.boost, until: this-round)
```

### `hui-hai-rules.alex`

```
// §850.7 Its owner picks the enemy unit.
@stone-for-stone.on-survives-damage = Damage(one, target: Choose(opponents))

@pebble.exhaust = Gain(Choose(own), power: card.boost, until: this-round)
// Both players' Mists count, as today's engine counts them.
@pebble.awaken = cards(@Mist, all, unit-card).count >= card.fallen
@pebble.back.static = Grant(units(own), health: card.extra-health, abilities: [@stone-for-stone])
@pebble.back.exhaust = Damage(card.damage, target: Choose(opponents))

@hui-hai-of-the-stream.on-enter = Damage(card.damage, target: Choose(opponents))
@ya-hui-hai.on-enter = Damage(card.damage, target: Choose(opponents))
@a-pebble-at-your-feet.on-play = Damage(card.damage, target: Choose(opponents))
@gohlou.on-enter = Draw()
@moss-mender-ya-hui-hai.on-enter = Heal(card.heal, target: units(own))
@stones-from-nowhere.on-play = Damage(card.damage, target: units(opponents))
@the-forest-remembers.on-play = Damage(card.damage, target: Choose(all))
@nobody-threw-it.on-play = Exhaust(Choose(opponents))
@a-pouch-of-river-pebbles.static = Grant(attached, power: card.boost, abilities: [@stone-for-stone])
@grandfather-hui-hai.on-enter = Damage(card.damage, target: Choose(opponents))
@the-hidden-village.on-enter = Damage(card.damage, target: units(opponents))
@small-but-strong.on-play = Gain(Choose(own), power: card.boost, until: this-round)
```

### `mochi-rules.alex`

```
@mochi-the-sweet-spirit.on-enter = Draw()
@mochi-the-sweet-spirit.on-defeated = ReadyResources(two)
```

Every one of Folkborn's handlers fits. They use 14 effect types (`Draw`, `Damage`, `Heal`, `Ready`, `Exhaust`,
`Gain` for this round, `Grant` for while the card is in play, `CantAttack`, `ReadyResources`, `OfferFromDeck`,
`Summon`, `AddCounter`, `CancelAttack`, `Effect`), each defined in a library from the core's effects.

## Hello TCG, rewritten as data

```
@dziadzius.exhaust = Gain(resource: @Energy, amount: card.energy)
@dziadzius.back.exhaust = Gain(resource: @Energy, amount: card.energy)
@dziadzius.awaken = units(own).count >= card.creatures
@klobuk.on-enter = Draw()
@bread-and-salt-greeter.on-enter = Heal(card.heal, target: units(own))
@domowiks-temper.on-play = Damage(card.damage, target: Choose(all))
```

Its scenarios become records too:

```
klobuk-draws = Scenario {
  title = 'Kłobuk draws a card when it enters'
  given = [
    Hand(me, cards: [@klobuk])
    Deck(me, cards: [@hearth-cricket])
    CounterIs(me, counter: @Energy, value: 3)
  ]
  when = Play(me, card: @klobuk)
  then = [InZone(@hearth-cricket, zone: @Hand)]
}
```

## The library rules, rewritten as data

What the runtime's step 3 needs: every library rule Hello TCG lists. A rule is a type as today; its behaviour is its
members, set to effects (for a moment) or formulas (for a question), as the earlier drafts of this page decided. The
moments and questions are declared once on the core's `Rule`, each with the names it gives its formulas (`unit`,
`player`, `attacker`, `target`); `this` is the rule, the ability or the card.

### Setup

```
type StartsInZone : SetupRule {
  type: CardType | text
  zone: Zone
  on-game-start = Move(all.deck.cards-of-type(this.type), to: this.zone)
}
type ShuffleDeck : SetupRule {
  on-game-start = Shuffle(all.deck)
}
type OpeningHand : SetupRule {
  n: int
  on-game-start = Draw(player: all, count: this.n)
}
```

### Turns

```
enum FirstPlayer(random: , initiative-holder: , loser-of-last-game: )

// A player's turn lasts until they pass; then the next player's starts. A round is every player's turn once.
type FullTurns : TurnRule {
  first-player: FirstPlayer
  on-game-start = SetFirstPlayer(random(game.players), only-if: this.first-player == random)
  on-round-start = StartTurn(game.first-player)
  on-player-pass = [
    EndTurn()
    StartTurn(player.next, only-if: game.turns-this-round < game.players.count)
  ]
  is-round-over = game.turns-this-round == game.players.count and not game.in-turn
}

// Each phase's steps, in order, at the start of a player's turn. A step is an effect.
type Phases : TurnRule {
  phases: [Phase]
  on-player-turn-start = this.phases.steps
}

type ReadyAll : Effect {
  do = Ready(player.cards-in-play)
}

// Only the kinds of action the game lists may be taken.
type Actions : TurnRule {
  allowed: [ActionKind]
  can-act = this.allowed.has(kind)
}
```

Hello TCG's phase becomes `steps = [ReadyAll(), Draw(1, only-if: game.turn > 1)]`: its own
`skip-very-first-turn` is the formula `game.turn > 1`.

### Resources

```
type GrowingCounter : ResourceRule {
  start: int
  max: int
  on-player-game-start = SetCounter(this.name, value: this.start)
}
type GrowsAt : ResourcePolicy {
  resource: ResourceRule
  by: int
  on-player-turn-start = SetCapacity(this.resource, value: min(player.capacity(this.resource) + this.by, this.resource.max))
}
type RefillsAt : ResourcePolicy {
  resource: ResourceRule
  on-player-turn-start = SetCounter(this.resource.name, value: player.capacity(this.resource))
}
```

### Units, spells and Heroes

```
// A unit: played from hand by paying its cost, it enters the board.
type UnitCard : Card {
  can-play = this.in-hand and this.owner.can-pay(this.cost)
  on-played = [
    Pay(this.cost)
    Move(this, to: this.owner.board)
  ]
}
type UnitsEnterExhausted : UnitRule {
  on-unit-enter = Exhaust(unit)
}
type DefeatAtHealth : UnitRule {
  on-unit-check = Defeat(unit, only-if: unit.damage >= unit.health)
}

// A spell: played from hand by paying its cost, it does what it says, then goes to the discard.
type SpellCard : Card {
  can-play = this.in-hand and this.owner.can-pay(this.cost)
  on-played = [
    Pay(this.cost)
    Move(this, to: this.owner.discard)
    this.on-play
  ]
}

type AwakenOnStateCheck : HeroRule {
  on-hero-check = Flip(hero, face: 2, only-if: hero.face == 1 and hero.awaken)
}
type PowerOncePerRound : HeroRule {
  can-use = hero.ready
  on-hero-used = [
    Exhaust(hero)
    hero.exhaust
  ]
}
type HeroAttacksWhenAwakened : HeroRule {
  takes-no-damage: bool
  attack-targets = if attacker.is-hero and attacker.face == 2 then attacker.enemy-units + attacker.enemy-players else nothing
}
```

`this.on-play` and `hero.exhaust` are the card's own handler, which is data: listing it runs it.

### Abilities and combat

```
type EntersReady : Ability {
  on-unit-enter = Ready(unit)
}
type AttackedFirst : Ability {
  can-attack = not target.controller.has-unit-with(this) or target.has(this)
}

type AttackerChooses : CombatRule {
  targets: [CombatTarget]
  attack-targets = if not attacker.is-unit then nothing
    else if this.targets.has(life) then attacker.enemy-units + attacker.enemy-players
    else attacker.enemy-units
}
type AttackerMustBeReady : CombatRule {
  can-attack = attacker.ready
}

// An attack exhausts the attacker. A unit it attacks and the attacker deal their Power to each other.
type CombatDamageEqualsPower : CombatRule {
  on-attack = [
    Exhaust(attacker)
    Damage(attacker.power, target: target, only-if: target.is-unit)
    Damage(
      target.power
      target: attacker
      only-if: target.is-unit and not (attacker.is-hero and game.rule(HeroAttacksWhenAwakened).takes-no-damage)
    )
  ]
}
type LifeDamageEqualsPower : CombatRule {
  on-attack = LoseLife(player: target, amount: attacker.power, only-if: target.is-player)
}
type DamageClearsAt : CombatRule {
  on-unit-turn-end = Heal(unit.damage, target: unit)
}
```

Damage doesn't change Power, and defeat waits for the state check, so the two `Damage` effects are simultaneous in
effect: the second still reads the defender's Power.

### Life

```
type LifeCounter : LifeRule {
  name: text
  start: int
  lose-at: int
  on-player-game-start = SetCounter(this.name, value: this.start)
  on-player-check = Lose(player, only-if: player.counter(this.name) <= this.lose-at)
}
```

## What changes in Alex

**Goes (kept only as deprecated forms that still read, until the files that use them are rewritten):**

- routine bodies and every statement: a sequence of statements, `target = …` bindings, `if … { } else { }`, `+=`;
- program mode, the parse mode rules files use today: a rules file becomes a data document;
- the proposals of earlier drafts of this page that never shipped: `for`, `return`, bindings with any name, members
  written as method bodies.

**Stays:** everything Alex's data layer is today, and `@card.slot = value`, which sets a member of another document's
value: data pointing at data.

**Comes:**

1. **A record written as a constructor call:** `Damage(card.damage, target: Choose(all))` is `Damage { ... }` on one
   line. Unnamed arguments fill fields in declaration order, then named ones follow. A capital letter says a call is
   a record (`Damage(...)`); a lowercase one is a formula's query (`units(own)`).
2. **Formulas as values:** a field whose type allows it may hold a pure expression: names in scope (`this`, `card`,
   `own`, `unit`, `target`…), member access, calls to the vocabulary's queries (`units(own)`, `target.has(this)`),
   comparisons, `and`/`or`/`not`, arithmetic, and `if … then … else …` as a value. A formula never changes the game.
3. **Several base types:** `type Creature : Printed, UnitCard`, approved.
4. **A type's member set to a value that is an effect or a formula**, which types already do for data
   (`type TokenCreature : Creature(finishes: [standard])`).

## Settled (2026-09-30)

The owner approved building this ("let's go for it"), with the recommendations taken where a question was open:

1. **Formulas are data enough:** pure expressions that read the game and never change it.
2. **A field holds a formula only when its type says so** (`amount: Formula`, `only-if: Formula?`), so ordinary data
   stays free of them.
3. **`only-if`** is an effect's condition.
4. **`game.rule(RuleType)`** reads another rule as the game lists it, or nothing.

The order of the work: the core's Rust Alex and the runtime first, then the C# Alex made to match, checked by the
conformance tool, then every rules file rewritten.
