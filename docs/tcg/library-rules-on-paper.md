# Library rules in Alex, on paper

The runtime's step 3 (docs/tcg/runtime-design.md) makes games playable end to end: a round, playing a card, paying for
it, attacking, defeating, awakening, winning. The owner decided that every library rule is written in Alex, not Rust
in the engine. This page writes out, before any code, every library rule Hello TCG lists, so the language they need
can be reviewed first. Folkborn's rules follow the same patterns; its extra ones (the Lantern, Ambush, Candles) come
after Hello TCG plays.

Nothing here runs yet. Each block is what a library's `.alex` file would hold, beside the rule's record.

*Revised at the owner's review (2026-09-30).* Earlier drafts attached routines to engine hooks (`after move`), then to
engine events (`@UnitsEnterExhausted.on-moved = ...`). Both read like configuration: the behaviour was written in one
place and attached in another, names like `rule` and `event` appeared from nowhere, and a rule about a unit had to dig
the unit out of a generic "something moved" event. Now a rule is written from the point of view of what it is about,
the way a game script is: a unit, a spell, a Hero, a player, or the game.

## How a library rule reads

```
// A unit enters play exhausted.
UnitsEnterExhausted.unit.on-enter() {
  this.exhaust()
}
```

Read it as: *the rule UnitsEnterExhausted: when a unit enters play, exhaust it.*

- `UnitsEnterExhausted` is the rule. The handler runs only in games that list it.
- `.unit` says what the handler is about: every unit. `this` is that unit, as `this` is the card in a card's handler.
- `.on-enter()` is the moment: the same moment a card's own handler uses (`klobuk.on-enter`).
- When the rule has settings, the handler reads them as `rule`:

```
// A unit with the keyword (Swift) enters ready.
EntersReady.unit.on-enter() {
  if this.has(rule.keyword) {
    this.ready()
  }
}
```

Handlers of one moment run in the order the game lists its rules, so a Swift unit is exhausted, then readied.

Some questions have an answer rather than an effect. Their handlers return it:

```
// While the defender has a Guardian, only Guardians may be attacked.
GuardiansFirst.card.can-attack(target) {
  if target.controller.has-unit-with(rule.keyword) {
    return target.has(rule.keyword)
  }
  return true
}
```

An action is allowed when every rule's handler of the question says yes. The engine asks `can-play()` of each card in
the acting player's hand, `can-attack(target)` of each attacker and target, and so on, and offers the player what is
allowed. No handler ever builds a list of actions.

## What a handler can be about, and when it runs

What a handler is about decides what `this` is:

| Written as | `this` is |
|---|---|
| `Rule.unit.…`, `Rule.spell.…`, `Rule.hero.…` | a card of that kind (the game's types mapped onto units, spells, heroes) |
| `Rule.card.…` | any card |
| `Rule.player.…` | a player |
| `Rule.…` | nothing: the handler is about the game |

The moments (`on-…`) and the questions (`can-…`, `is-…`, `…-targets`) each belong to what they are about:

- **A card's moments:** `on-enter`, `on-leave`, `on-played`, `on-damaged`, `on-defeated`, `on-attack(target)`, `on-used`,
  `on-turn-start`, `on-turn-end`, `on-check`.
- **A card's questions:** `can-play()`, `can-attack(target)`, `attack-targets()`, `can-use()`.
- **A player's moments:** `on-game-start`, `on-turn-start`, `on-turn-end`, `on-pass`, `on-check`.
- **A player's questions:** `can-act(kind)`.
- **The game's moments and questions:** `on-game-start`, `on-round-start`, `on-round-end`, `is-round-over()`.

`on-check` is the state check: the engine runs it after every action and effect, for whatever must happen at once
(a unit with too much damage is defeated, a Hero awakens, a player out of life loses).

Moving a card raises its moments: a card moved onto the board has `on-enter`, one moved off it `on-leave`.

## Hello TCG's rules

### Setup (`setup.alex`)

```
// A card of this type starts in this zone, not in the deck.
StartsInZone.player.on-game-start() {
  for card in this.deck.cards-of-type(rule.type) {
    card.move-to(this.zone(rule.zone))
  }
}

ShuffleDeck.player.on-game-start() {
  this.deck.shuffle()
}

OpeningHand.player.on-game-start() {
  this.draw(rule.n)
}
```

### Turns (`turns.alex`)

```
// A player's turn lasts until they pass; then the next player's starts. A round is every player's turn once.
FullTurns.on-game-start() {
  game.first = random(game.players)
}

FullTurns.on-round-start() {
  game.start-turn(game.first)
}

FullTurns.player.on-pass() {
  game.end-turn()
  if game.turns-this-round < game.players.count {
    game.start-turn(this.next)
  }
}

FullTurns.is-round-over() {
  return game.turns-this-round == game.players.count and not game.in-turn
}

// Each phase's steps, in order, at the start of a player's turn.
Phases.player.on-turn-start() {
  for phase in rule.phases {
    for step in phase.steps {
      step.run(this)
    }
  }
}

ReadyAll.on-run(player) {
  for card in player.cards-in-play {
    card.ready()
  }
}

Draw.on-run(player) {
  if not (rule.skip-very-first-turn and game.turn == 1) {
    player.draw(rule.count)
  }
}

// Only the kinds of action the game lists may be taken.
Actions.player.can-act(kind) {
  return rule.allowed.has(kind)
}
```

A step is a record like a rule: `step.run(player)` runs its `on-run`, and in it `rule` is the step (`rule.count`).

### Resources (`resources.alex`)

```
// A number that rises to a cap (mana crystals): a capacity that grows, and what is left of it this turn.
GrowingCounter.player.on-game-start() {
  this.set(rule.name, rule.start)
}

GrowsAt.player.on-turn-start() {
  this.grow(rule.resource, rule.by)
}

RefillsAt.player.on-turn-start() {
  this.refill(rule.resource)
}
```

`grow`, `refill` and `pay` are the resources library's own routines, with parameters:

```
routine grow(player: player, resource: GrowingCounter, by: int) {
  player.set-capacity(resource, min(player.capacity(resource) + by, resource.max))
}
```

Hello TCG's `GrowsAt { moment = @turn-start }` names its moment; the handlers above fix it to `on-turn-start`
(question 3).

### Units (`units.alex`)

```
// A unit card may be played from hand when its player can pay for it.
UnitCards.unit.can-play() {
  return this.in-hand and this.owner.can-pay(this.cost)
}

UnitCards.unit.on-played() {
  this.owner.pay(this.cost)
  this.move-to(this.owner.board)
}

UnitsEnterExhausted.unit.on-enter() {
  this.exhaust()
}

EntersReady.unit.on-enter() {
  if this.has(rule.keyword) {
    this.ready()
  }
}

// Damage equal to or more than a unit's Health defeats it.
DefeatAtHealth.unit.on-check() {
  if this.damage >= this.health {
    this.defeat()
  }
}
```

A unit's `on-played` moves it onto the board, which raises its `on-enter`: the rules' (exhaust it, ready it if Swift)
and the card's own (Kłobuk draws a card). `defeat()` moves a unit to its owner's discard, which raises its
`on-defeated`.

### Spells (`spells.alex`)

```
// A spell may be played from hand when its player can pay for it. It does what it says, then goes to the discard.
SpellCards.spell.can-play() {
  return this.in-hand and this.owner.can-pay(this.cost)
}

SpellCards.spell.on-played() {
  this.owner.pay(this.cost)
  this.move-to(this.owner.discard)
  this.do-what-it-says()
}
```

`do-what-it-says()` runs the card's own `on-play` (A Domowik's Temper deals its damage).

### Heroes (`heroes.alex`)

```
// A Hero flips to its second face as soon as its Awaken condition holds, and never back.
AwakenOnStateCheck.hero.on-check() {
  if this.face == 1 and this.can-awaken() {
    this.flip()
  }
}

// A Hero's Exhaust ability, used by exhausting it: at most once a round.
PowerOncePerRound.hero.can-use() {
  return this.ready
}

PowerOncePerRound.hero.on-used() {
  this.exhaust()
  this.use-ability()
}

// An Awakened Hero may attack, like a unit.
HeroAttacksWhenAwakened.hero.attack-targets() {
  if this.face == 2 {
    return this.enemy-units + this.enemy-players
  }
  return nothing
}
```

`TwoFaces` and `AwakenedNeverReverts` need no handler: nothing flips a Hero back.

### Combat (`combat.alex`)

```
// The attacker chooses its target: an enemy unit, or the defending player's life.
AttackerChooses.unit.attack-targets() {
  if rule.targets.has(life) {
    return this.enemy-units + this.enemy-players
  }
  return this.enemy-units
}

AttackerMustBeReady.card.can-attack(target) {
  return this.ready
}

// While the defender has a Guardian, only Guardians may be attacked.
GuardiansFirst.card.can-attack(target) {
  if target.controller.has-unit-with(rule.keyword) {
    return target.has(rule.keyword)
  }
  return true
}

// An attack exhausts the attacker. A unit it attacks and the attacker deal their Power to each other at once.
CombatDamageEqualsPower.card.on-attack(target) {
  this.exhaust()
  if target.is-unit {
    dealt = this.power
    taken = target.power
    target.damage(dealt)
    if not (this.is-hero and game.rule(HeroAttacksWhenAwakened).takes-no-damage) {
      this.damage(taken)
    }
  }
}

// A hit on a player costs them life equal to the attacker's Power.
LifeDamageEqualsPower.card.on-attack(target) {
  if target.is-player {
    target.lose-life(this.power)
  }
}

// Damage stays on a unit until the end of the turn.
DamageClearsAt.unit.on-turn-end() {
  this.heal(this.damage)
}
```

`SimultaneousDamage` is the order written in `on-attack`: both amounts are read before either is dealt.

### Life (`life.alex`)

```
LifeCounter.player.on-game-start() {
  this.set(rule.name, rule.start)
}

// A player whose life falls to the limit loses. The core ends the game when one player is left: they win.
LifeCounter.player.on-check() {
  if this.counter(rule.name) <= rule.lose-at {
    this.lose()
  }
}
```

## What the language gains

1. **A handler written in place:** `Rule.unit.on-enter() { ... }`: the rule, what the handler is about, and the moment
   or question, with the moment's parameters (`on-attack(target)`). `this` is what it is about; `rule` is the rule's
   settings.
2. **`return`**, for a handler that answers a question (`can-play()`, `is-round-over()`).
3. **`for x in list { ... }`**: the one loop. It goes over a finite list (cards, players, a rule's list), so every
   handler still finishes.
4. **Any name in a binding**: `dealt = this.power`. Today only `target` may be bound.
5. **`game.rule(RuleType)`**: another rule as the game lists it, or nothing (question 2).

The words handlers call (`move-to`, `exhaust`, `draw`, `enemy-units`, `can-pay`…) are the libraries' and the core's
vocabulary, each declared once.

A card's handler could take the same form (`klobuk.on-enter() { draw() }`), with the one-line
`@klobuk.on-enter = draw()` kept for one-statement handlers. That would be one form for cards and rules (question 4).

## Questions for the owner

1. **Does this read like code you would want to write?**
2. **Reading another rule's values.** `CombatDamageEqualsPower` needs `HeroAttacksWhenAwakened`'s `takes-no-damage`.
   The proposal is `game.rule(HeroAttacksWhenAwakened).takes-no-damage`, which is nothing when the game doesn't list
   that rule. Another option is for the two rules to be one.
3. **Rules that work at a moment the game chooses.** Hello TCG writes `GrowsAt { moment = @turn-start }`. Either the
   handler fixes its moment (`GrowsAt.player.on-turn-start()`, as above) and a game that grows at another moment lists
   another rule, or the rule names its moment and the engine runs it then. The first is simpler.
4. **Cards in the same form.** Should a game's rules files also write `klobuk.on-enter() { draw() }`, keeping
   `@klobuk.on-enter = draw()` for one statement?
5. **What stays in Rust.** The core's operations, the loop, the scheduler, randomness and the words that read the
   game's state stay in the engine. Everything that is a rule of some game is Alex. Is that the line?

Once this is agreed, the language changes are made in both Alex implementations, the handlers go into the libraries,
and the runtime runs them, until two random bots play whole Hello TCG games.
