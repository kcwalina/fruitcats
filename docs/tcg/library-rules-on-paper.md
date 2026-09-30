# Library rules in Alex, on paper

The runtime's step 3 (docs/tcg/runtime-design.md) makes games playable end to end: a round, playing a card, paying for
it, attacking, defeating, awakening, winning. The owner decided that every library rule is a routine in Alex on the
core's hooks, not Rust in the engine. This page writes out, before any code, every library rule Hello TCG lists, as
those routines, so the language they need can be reviewed first. Folkborn's rules follow the same patterns; its extra
ones (the Lantern, Ambush, Candles) come after Hello TCG plays.

Nothing here runs yet. Each block is a routine a library's `.alex` file would hold, beside the rule's record.

## How a library rule reads

A library rule is a record the game lists, and one or more routines attached to the core's hooks:

```
type UnitsEnterExhausted : UnitRule {}

// A unit enters play exhausted.
routine units-enter-exhausted(rule: UnitsEnterExhausted) after move {
  if event.to.role == board and event.object.is-unit { event.object.exhaust() }
}
```

- `after move` is the hook: this runs after every `move` operation. The hooks are the ones `core-operations.alex` lists.
- `rule` is the rule as the game lists it. One routine serves every game that lists the rule, with that game's values
  (`rule.keyword` is Hello TCG's `@Guardian`).
- A routine runs only in games that list its rule, and hooks run in the order the game lists its rules. So
  `EntersReady` (listed after `UnitsEnterExhausted`) readies a Swift unit after it was exhausted.

## The game loop the core runs

The core runs the same loop for every game (`core-operations.alex`, part 6), and the rules fill its hooks:

1. **Setup:** every `after setup` routine, in the order the game lists its rules.
2. **A round:** `after round-start`, then actions until the round is over, then `after round-end`.
3. **An action:** the actor (`provide next-actor`) is asked to choose from the legal actions (`provide legal-actions`,
   then `filter legal-actions`). The action is carried out by the routines `on` its kind. The queued routines then
   run, with the state check (`on state-check`) between them.
4. **The round is over** when a `provide round-over` routine answers yes. **The game is over** when a routine calls
   `win(player)` or `draw-game()`.

Turns are a library concept, not the core's: `start-turn(player)` and `end-turn()` are core operations that emit the
`turn-start` and `turn-end` moments, which rules hang on (`after turn-start`).

## Hello TCG's rules

### Setup (`setup.alex`)

```
// A card of this type starts in this zone, not in the deck.
routine starts-in-zone(rule: StartsInZone) after setup {
  each player in all {
    each card in cards(player.deck, of-type(rule.type)) { card.move(to: rule.zone) }
  }
}

routine shuffle-deck(rule: ShuffleDeck) after setup {
  each player in all { shuffle(player.deck) }
}

routine opening-hand(rule: OpeningHand) after setup {
  each player in all { player.draw(rule.n) }
}
```

### Turns (`turns.alex`)

```
// A player's turn lasts until they pass; then the next player's starts. A round is every player's turn once.
routine full-turns-first(rule: FullTurns) after setup {
  if rule.first == random { game.set-first(pick(all)) }
}
routine full-turns-start(rule: FullTurns) after round-start { start-turn(game.first) }
routine full-turns-pass(rule: FullTurns) on pass {
  end-turn()
  if game.turns-this-round < all.count { start-turn(game.actor.next) }
}
routine full-turns-over(rule: FullTurns) provide round-over {
  answer(game.turns-this-round == all.count and not game.in-turn)
}

// Each phase's steps, in order, at the start of a turn.
routine phases(rule: Phases) after turn-start {
  each phase in rule.phases {
    each step in phase.steps { run(step) }
  }
}
routine ready-all(step: ReadyAll) on run {
  each object in controlled(game.actor) { object.ready() }
}
routine draw-step(step: Draw) on run {
  if not (step.skip-very-first-turn and game.turn == 1) { game.actor.draw(step.count) }
}

// Only the listed kinds of action may be taken.
routine only-allowed(rule: Actions) filter legal-actions {
  each action in actions {
    if not rule.allowed.has(action.kind) { remove(action) }
  }
}
```

### Resources (`resources.alex`)

```
// A number that rises to a cap (mana crystals): a capacity that grows, and what is left of it this turn.
routine growing-counter-start(rule: GrowingCounter) after setup {
  each player in all { player.set(rule, rule.start) }
}
routine grows-at(rule: GrowsAt) after moment {
  if event.moment == rule.moment { game.actor.grow(rule.resource, rule.by) }
}
routine refills-at(rule: RefillsAt) after moment {
  if event.moment == rule.moment { game.actor.refill(rule.resource) }
}
```

`grow` raises the capacity to at most the resource's `max`; `refill` sets what is left to the capacity; `pay` (used by
playing a card, below) spends from it. They are routines of the resources library too, with parameters:

```
routine grow(player: player, resource: GrowingCounter, by: int) {
  player.set-capacity(resource, min(player.capacity(resource) + by, resource.max))
}
```

### Units and spells (`units.alex`, `spells.alex`, `common.alex`)

```
// A unit card in hand may be played when its player can pay for it.
routine play-units(rule: UnitCards) provide legal-actions {
  each card in cards(game.actor.hand, of-type(rule.types)) {
    if game.actor.can-pay(card.cost) { offer(play, object: card) }
  }
}
routine play-a-unit(rule: UnitCards) on play {
  if action.object.is(rule.types) {
    game.actor.pay(action.object.cost)
    action.object.move(to: game.actor.board)
    action.object.trigger(on-enter)
  }
}

routine units-enter-exhausted(rule: UnitsEnterExhausted) after move {
  if event.to.role == board and event.object.is-unit { event.object.exhaust() }
}
routine enters-ready(rule: EntersReady) after move {
  if event.to.role == board and event.object.has(rule.keyword) { event.object.ready() }
}

// Damage equal to or more than a unit's Health defeats it.
routine defeat-at-health(rule: DefeatAtHealth) on state-check {
  each unit in units(all) {
    if unit.damage >= unit.health { unit.defeat() }
  }
}

// A spell is played, does what it says, and goes to its owner's discard.
routine play-spells(rule: SpellCards) provide legal-actions {
  each card in cards(game.actor.hand, of-type(rule.types)) {
    if game.actor.can-pay(card.cost) { offer(play, object: card) }
  }
}
routine play-a-spell(rule: SpellCards) on play {
  if action.object.is(rule.types) {
    game.actor.pay(action.object.cost)
    action.object.move(to: game.actor.discard)
    action.object.trigger(on-play)
  }
}
```

`defeat()` is `common`'s: it moves the unit to its owner's discard and fires its `on-defeated`.

### Heroes (`heroes.alex`)

```
// A Hero flips to its second face as soon as its Awaken condition holds, and never back.
routine awaken(rule: AwakenOnStateCheck) on state-check {
  each hero in heroes(all) {
    if hero.face == 1 and hero.ask(awaken) { hero.flip(2) }
  }
}

// A Hero's Exhaust: its ability, once a round, by exhausting it.
routine hero-power(rule: PowerOncePerRound) provide legal-actions {
  each hero in heroes(game.actor) {
    if hero.ready and hero.has-slot(exhaust) { offer(ability, object: hero) }
  }
}
routine use-hero-power(rule: PowerOncePerRound) on ability {
  if action.object.is-hero {
    action.object.exhaust()
    action.object.trigger(exhaust)
  }
}

// An Awakened Hero may attack, like a unit.
routine awakened-heroes-attack(rule: HeroAttacksWhenAwakened) provide legal-actions {
  each hero in heroes(game.actor) {
    if hero.face == 2 { offer-attacks(from: hero, targets: game.rule(AttackerChooses).targets) }
  }
}
```

`TwoFaces` and `AwakenedNeverReverts` need no routine: nothing flips a Hero back. `HeroAttacksWhenAwakened`'s
`takes-no-damage` is read by the combat rule that deals damage (below).

### Combat (`combat.alex`)

```
// The attacker chooses its target: an enemy unit, or the defending player's life.
routine attacker-chooses(rule: AttackerChooses) provide legal-actions {
  each unit in units(game.actor) { offer-attacks(from: unit, targets: rule.targets) }
}
routine offer-attacks(from: object, targets: [CombatTarget]) {
  each target in units(opponents) { offer(attack, object: from, target: target) }
  if targets.has(life) {
    each player in opponents { offer(attack, object: from, target: player) }
  }
}

routine attacker-must-be-ready(rule: AttackerMustBeReady) filter legal-actions {
  each action in actions(attack) {
    if action.object.exhausted { remove(action) }
  }
}

// While the defender has a unit with the keyword, only such units may be attacked.
routine guardians-first(rule: GuardiansFirst) filter legal-actions {
  each action in actions(attack) {
    defender = action.target.controller
    if units(defender, has(rule.keyword)).any and not action.target.has(rule.keyword) { remove(action) }
  }
}

// An attack exhausts the attacker; a unit it attacks and the attacker deal their Power to each other at once.
routine attack(rule: CombatDamageEqualsPower) on attack {
  action.object.exhaust()
  if action.target.is-unit {
    dealt = action.object.power
    taken = action.target.power
    action.target.damage(dealt)
    if not (action.object.is-hero and game.rule(HeroAttacksWhenAwakened).takes-no-damage) { action.object.damage(taken) }
  }
}
routine life-damage(rule: LifeDamageEqualsPower) on attack {
  if action.target.is-player { action.target.lose-life(action.object.power) }
}

routine damage-clears(rule: DamageClearsAt) after moment {
  if event.moment == rule.moment {
    each unit in units(all) { unit.heal(unit.damage) }
  }
}
```

`SimultaneousDamage` is the order written in `attack`: both amounts are read before either is dealt.
`game.rule(HeroAttacksWhenAwakened)` is that rule as the game lists it, or nothing when it doesn't (see question 2).

### Life (`life.alex`)

```
routine life-counter-start(rule: LifeCounter) after setup {
  each player in all { player.set(rule.name, rule.start) }
}
routine lose-at(rule: LifeCounter) provide game-over {
  each player in all {
    if player.counter(rule.name) <= rule.lose-at { player.lose() }
  }
  if players-left.count == 1 { win(players-left.first) }
}
```

## What the language gains

The routines above use these on top of what Alex has today. Each is small, and each is written the way the rest
of Alex is.

1. **A routine in a library, attached to a hook:** `routine name(rule: RuleType) after move { ... }`. The hooks are the
   core's: `after`, `before` and `replace` an operation or moment; `provide` and `filter` a query; `on` an action's
   kind; `on state-check`; `on run` for a step of a phase.
2. **`rule` (or `step`)**: the record the game listed, as the routine's parameter.
3. **`each x in selection { ... }`**: the one loop. It goes over a selection (units, cards, players, actions,
   a rule's list), so every routine still finishes.
4. **Any name in a binding**: `defender = action.target.controller`. Today only `target` may be bound; the same
   statement takes any name, so there is no new keyword.
5. **Actions as values:** `offer(kind, object: …, target: …)` in `provide legal-actions`; `actions`, `actions(kind)`
   and `remove(action)` in `filter legal-actions`; `action` in `on <kind>`.
6. **`answer(value)`**: what a `provide` routine for a one-value query answers (`next-actor`, `round-over`).
7. **`game.rule(RuleType)`**: another rule as the game lists it, or nothing (question 2).
8. **Routines with parameters called like words** (`grow(player, resource, by)`, `offer-attacks(from: unit)`): the
   libraries' vocabulary written in Alex, instead of Rust, as far as it can be.

## Questions for the owner

1. **Is this how library rules should read?** In particular, the hook after the parameters (`after move`,
   `provide legal-actions`, `on play`), `each`, and bindings with any name.
2. **Reading another rule's values.** `CombatDamageEqualsPower` needs `HeroAttacksWhenAwakened`'s `takes-no-damage`.
   The proposal is `game.rule(HeroAttacksWhenAwakened).takes-no-damage`, which is nothing when the game doesn't list
   that rule. Another option is for the two rules to be one.
3. **What stays in Rust.** The core's operations (`move`, `shuffle`, `flip`…), the loop, the scheduler, randomness and
   the few words that read the game's state (`units`, `cards`, `game.actor`) stay in the engine. Everything that is a
   rule of some game is Alex. Is that the line?

Once this is agreed, the language changes are made in both Alex implementations, the routines go into the libraries,
and the runtime runs them, until two random bots play whole Hello TCG games.
