# Library rules in Alex, on paper

The runtime's step 3 (docs/tcg/runtime-design.md) makes games playable end to end: a round, playing a card, paying for
it, attacking, defeating, awakening, winning. The owner decided that every library rule is written in Alex, not Rust
in the engine. This page writes out, before any code, every library rule Hello TCG lists, so the language they need
can be reviewed first. Folkborn's rules follow the same patterns; its extra ones (the Lantern, Ambush, Candles) come
after Hello TCG plays.

Nothing here runs yet. Each block is what a library's `.alex` file would hold, beside the rule's record.

*Revised twice at the owner's review (2026-09-30):* the first draft attached routines to hooks with new words
(`after move`, `on play`). Now what the core raises is an **event**, and a library attaches a handler to a rule's
event the way a rules file attaches one to a card's slot: `@UnitsEnterExhausted.on-moved = ...`. Cards and rules get
their behaviour the same way, and there are no new keywords.

## How a library rule reads

A library rule is a record the game lists, and handlers attached to its events:

```
type UnitsEnterExhausted : UnitRule {}

// A unit enters play exhausted.
@UnitsEnterExhausted.on-moved = if event.to.role == board and event.object.is-unit { event.object.exhaust() }
```

- `@UnitsEnterExhausted` names the rule's type, so the handler serves every game that lists the rule. A card's handler
  names a card (`@klobuk.on-enter`); a rule's names its type.
- `on-moved` is the slot of the `Moved` event: the core raises one after every move. Each event gives every rule type
  a slot named after it.
- Inside the handler, `rule` is the rule as the game lists it (`rule.keyword` is Hello TCG's `@Guardian`) and `event`
  is the event, with its fields (`object`, `from`, `to`). They are in scope the way `card` and `this` are in a card's.
- A handler runs only in games that list its rule, and handlers of one event run in the order the game lists their
  rules. So `EntersReady` (listed after `UnitsEnterExhausted`) readies a Swift unit after it was exhausted.
- A handler of one statement is written on its wiring line; a longer one is a named `routine` just above the line that
  uses it, as in the games' rules files.

## Events

Every event is a record type, declared once in the core (`core-operations.alex`) or a library, beside the operation or
moment that raises it. Its slot is `on-` and its name in kebab case. There are four kinds, all handled the same way:

- **Something happened:** one per operation (`Moved`, `Shuffled`, `Flipped`, `Damaged`…) and one per moment of the loop
  (`GameSetUp`, `RoundStarted`, `RoundEnded`, `TurnStarted`, `TurnEnded`).
- **Something is about to happen:** `Damaging`, `Moving`… A handler may change the event's fields
  (`event.amount -= 1` for Tough) or cancel it (`event.cancel()`) before the operation runs. Hello TCG needs none of
  these; Folkborn's Tough and its Ambush do.
- **A question the core asks:** `LegalActions` (what may this player do: handlers `offer` and `remove` actions),
  `RoundOver` (handlers `answer` yes), `StateCheck` (what must happen now: defeats, awakening, losing).
- **An action a player took:** `Play`, `Attack`, `UseAbility`, `Pass`. A handler carries it out.

A card's own slots stay as they are (`on-enter`, `on-play`, `on-defeated`): they are that card's events.

## The game loop the core runs

The core runs the same loop for every game (`core-operations.alex`, part 6), raising events for the rules:

1. **Setup:** `GameSetUp`.
2. **A round:** `RoundStarted`, then actions until `RoundOver` is answered yes, then `RoundEnded`.
3. **An action:** the actor chooses from `LegalActions`. The action is raised as its event (`Play`, `Attack`…). The
   queued handlers then run, with a `StateCheck` between them.
4. **The game is over** when a handler calls `win(player)` or `draw-game()`.

Turns are a library concept: `start-turn(player)` and `end-turn()` are core operations that raise `TurnStarted` and
`TurnEnded`.

## Hello TCG's rules

### Setup (`setup.alex`)

```
// A card of this type starts in this zone, not in the deck.
routine starts-in-zone {
  each player in all {
    each card in cards(player.deck, of-type(rule.type)) { card.move(to: rule.zone) }
  }
}
@StartsInZone.on-game-set-up = starts-in-zone

@ShuffleDeck.on-game-set-up = each player in all { shuffle(player.deck) }

@OpeningHand.on-game-set-up = each player in all { player.draw(rule.n) }
```

### Turns (`turns.alex`)

```
// A player's turn lasts until they pass; then the next player's starts. A round is every player's turn once.
@FullTurns.on-game-set-up = if rule.first == random { game.set-first(pick(all)) }
@FullTurns.on-round-started = start-turn(game.first)
routine next-turn {
  end-turn()
  if game.turns-this-round < all.count { start-turn(game.actor.next) }
}
@FullTurns.on-pass = next-turn
@FullTurns.on-round-over = event.answer(game.turns-this-round == all.count and not game.in-turn)

// Each phase's steps, in order, at the start of a turn.
routine run-phases {
  each phase in rule.phases {
    each step in phase.steps { run(step) }
  }
}
@Phases.on-turn-started = run-phases
@ReadyAll.on-run = each object in controlled(game.actor) { object.ready() }
@Draw.on-run = if not (rule.skip-very-first-turn and game.turn == 1) { game.actor.draw(rule.count) }

// Only the listed kinds of action may be taken.
routine only-allowed {
  each action in event.actions {
    if not rule.allowed.has(action.kind) { event.remove(action) }
  }
}
@Actions.on-legal-actions = only-allowed
```

A step is a record like a rule: `run(step)` raises its `on-run`, and in its handler `rule` is the step
(`rule.count`).

### Resources (`resources.alex`)

```
// A number that rises to a cap (mana crystals): a capacity that grows, and what is left of it this turn.
@GrowingCounter.on-game-set-up = each player in all { player.set(rule, rule.start) }
@GrowsAt.on-turn-started = game.actor.grow(rule.resource, rule.by)
@RefillsAt.on-turn-started = game.actor.refill(rule.resource)
```

`grow` raises the capacity to at most the resource's `max`; `refill` sets what is left to the capacity; `pay` (used by
playing a card, below) spends from it. They are routines of the resources library, with parameters, called like the
core's words:

```
routine grow(player: player, resource: GrowingCounter, by: int) {
  player.set-capacity(resource, min(player.capacity(resource) + by, resource.max))
}
```

Hello TCG's `GrowsAt { moment = @turn-start }` names its moment; the handlers above fix it to `TurnStarted`
(question 3).

### Units and spells (`units.alex`, `spells.alex`, `common.alex`)

```
// A unit card in hand may be played when its player can pay for it.
routine offer-unit-plays {
  each card in cards(event.player.hand, of-type(rule.types)) {
    if event.player.can-pay(card.cost) { event.offer(play, object: card) }
  }
}
@UnitCards.on-legal-actions = offer-unit-plays
routine play-a-unit {
  if event.object.is(rule.types) {
    event.player.pay(event.object.cost)
    event.object.move(to: event.player.board)
    event.object.trigger(on-enter)
  }
}
@UnitCards.on-play = play-a-unit

@UnitsEnterExhausted.on-moved = if event.to.role == board and event.object.is-unit { event.object.exhaust() }
@EntersReady.on-moved = if event.to.role == board and event.object.has(rule.keyword) { event.object.ready() }

// Damage equal to or more than a unit's Health defeats it.
@DefeatAtHealth.on-state-check = each unit in units(all) { if unit.damage >= unit.health { unit.defeat() } }

// A spell is played, does what it says, and goes to its owner's discard.
routine offer-spell-plays {
  each card in cards(event.player.hand, of-type(rule.types)) {
    if event.player.can-pay(card.cost) { event.offer(play, object: card) }
  }
}
@SpellCards.on-legal-actions = offer-spell-plays
routine play-a-spell {
  if event.object.is(rule.types) {
    event.player.pay(event.object.cost)
    event.object.move(to: event.player.discard)
    event.object.trigger(on-play)
  }
}
@SpellCards.on-play = play-a-spell
```

`defeat()` is `common`'s: it moves the unit to its owner's discard and fires its `on-defeated`.

### Heroes (`heroes.alex`)

```
// A Hero flips to its second face as soon as its Awaken condition holds, and never back.
@AwakenOnStateCheck.on-state-check = each hero in heroes(all) { if hero.face == 1 and hero.ask(awaken) { hero.flip(2) } }

// A Hero's Exhaust: its ability, once a round, by exhausting it.
routine offer-hero-power {
  each hero in heroes(event.player) {
    if hero.ready and hero.has-slot(exhaust) { event.offer(ability, object: hero) }
  }
}
@PowerOncePerRound.on-legal-actions = offer-hero-power
routine use-hero-power {
  if event.object.is-hero {
    event.object.exhaust()
    event.object.trigger(exhaust)
  }
}
@PowerOncePerRound.on-use-ability = use-hero-power

// An Awakened Hero may attack, like a unit.
routine offer-hero-attacks {
  each hero in heroes(event.player) {
    if hero.face == 2 { offer-attacks(event, from: hero, targets: game.rule(AttackerChooses).targets) }
  }
}
@HeroAttacksWhenAwakened.on-legal-actions = offer-hero-attacks
```

`TwoFaces` and `AwakenedNeverReverts` need no handler: nothing flips a Hero back. `HeroAttacksWhenAwakened`'s
`takes-no-damage` is read by the combat rule that deals damage (below).

### Combat (`combat.alex`)

```
// Offers an attack from one unit or Hero at each target the game allows.
routine offer-attacks(question: LegalActions, from: object, targets: [CombatTarget]) {
  each target in units(opponents) { question.offer(attack, object: from, target: target) }
  if targets.has(life) {
    each player in opponents { question.offer(attack, object: from, target: player) }
  }
}

// The attacker chooses its target: an enemy unit, or the defending player's life.
@AttackerChooses.on-legal-actions = each unit in units(event.player) { offer-attacks(event, from: unit, targets: rule.targets) }

@AttackerMustBeReady.on-legal-actions = each action in event.actions(attack) { if action.object.exhausted { event.remove(action) } }

// While the defender has a unit with the keyword, only such units may be attacked.
routine guardians-first {
  each action in event.actions(attack) {
    defender = action.target.controller
    if units(defender, has(rule.keyword)).any and not action.target.has(rule.keyword) { event.remove(action) }
  }
}
@GuardiansFirst.on-legal-actions = guardians-first

// An attack exhausts the attacker; a unit it attacks and the attacker deal their Power to each other at once.
routine fight {
  event.object.exhaust()
  if event.target.is-unit {
    dealt = event.object.power
    taken = event.target.power
    event.target.damage(dealt)
    if not (event.object.is-hero and game.rule(HeroAttacksWhenAwakened).takes-no-damage) { event.object.damage(taken) }
  }
}
@CombatDamageEqualsPower.on-attack = fight
@LifeDamageEqualsPower.on-attack = if event.target.is-player { event.target.lose-life(event.object.power) }

@DamageClearsAt.on-turn-ended = each unit in units(all) { unit.heal(unit.damage) }
```

`SimultaneousDamage` is the order written in `fight`: both amounts are read before either is dealt.
`game.rule(HeroAttacksWhenAwakened)` is that rule as the game lists it, or nothing when it doesn't (question 2).
`offer-attacks` is a routine with parameters, shared by the two rules that offer attacks.

### Life (`life.alex`)

```
@LifeCounter.on-game-set-up = each player in all { player.set(rule.name, rule.start) }
routine lose-at-zero {
  each player in all {
    if player.counter(rule.name) <= rule.lose-at { player.lose() }
  }
  if players-left.count == 1 { win(players-left.first) }
}
@LifeCounter.on-state-check = lose-at-zero
```

## What the language gains

No new keywords. The handlers above use these on top of what Alex has today:

1. **`@` may name a type**, so a handler attaches to a rule's type: `@GuardiansFirst.on-legal-actions = ...`. It serves
   every game that lists the rule.
2. **Events are record types** declared in the core and the libraries (`type Moved : Event { object, from, to }`),
   and each gives every rule type a slot: `on-moved`.
3. **`rule` and `event` are in scope** in a rule's handler, as `card` and `this` are in a card's.
4. **`each x in selection { ... }`**: the one loop. It goes over a selection (units, cards, players, actions, a rule's
   list), so every handler still finishes.
5. **Any name in a binding**: `defender = action.target.controller`. Today only `target` may be bound; the same
   statement takes any name.
6. **The question events' words:** `event.offer(kind, object: …, target: …)`, `event.actions`, `event.remove(action)`
   and `event.answer(value)`, declared with those events like any verb.
7. **`game.rule(RuleType)`**: another rule as the game lists it, or nothing (question 2).

Routines with parameters (`grow`, `offer-attacks`), called like words, already exist.

## Questions for the owner

1. **Does this read right?** `@RuleType.on-<event> = ...` with `rule` and `event` in scope, `each`, and bindings with
   any name.
2. **Reading another rule's values.** `CombatDamageEqualsPower` needs `HeroAttacksWhenAwakened`'s `takes-no-damage`.
   The proposal is `game.rule(HeroAttacksWhenAwakened).takes-no-damage`, which is nothing when the game doesn't list
   that rule. Another option is for the two rules to be one.
3. **Rules that work at a moment the game chooses.** Hello TCG writes `GrowsAt { moment = @turn-start }`. Either the
   handler fixes its event (`@GrowsAt.on-turn-started`, as above) and a game that grows at another moment lists another
   rule, or the handler is attached to every moment and checks the game's (`if event is rule.moment`). The first is
   simpler; the second keeps one rule for every moment.
4. **What stays in Rust.** The core's operations (`move`, `shuffle`, `flip`…), the loop, the scheduler, randomness and
   the few words that read the game's state (`units`, `cards`, `game.actor`) stay in the engine. Everything that is a
   rule of some game is Alex. Is that the line?

Once this is agreed, the language changes are made in both Alex implementations, the handlers go into the libraries,
and the runtime runs them, until two random bots play whole Hello TCG games.
