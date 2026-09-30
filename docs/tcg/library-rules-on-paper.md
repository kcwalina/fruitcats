# Library rules in Alex, on paper

The runtime's step 3 (docs/tcg/runtime-design.md) makes games playable end to end: a round, playing a card, paying for
it, attacking, defeating, awakening, winning. The owner decided that every library rule is a routine in Alex, not Rust
in the engine. This page writes out, before any code, every library rule Hello TCG lists, as those routines, so the
language they need can be reviewed first. Folkborn's rules follow the same patterns; its extra ones (the Lantern,
Ambush, Candles) come after Hello TCG plays.

Nothing here runs yet. Each block is a routine a library's `.alex` file would hold, beside the rule's record.

*Revised 2026-09-30 at the owner's review:* the first draft attached routines to hooks with new words (`after move`,
`provide legal-actions`, `on play`). There are none now. What the core raises is an **event**, a record type, and a
routine handles an event by taking it as a parameter.

## How a library rule reads

A library rule is a record the game lists, and routines that take it and the event they handle:

```
type UnitsEnterExhausted : UnitRule {}

// A unit enters play exhausted.
routine units-enter-exhausted(rule: UnitsEnterExhausted, event: Moved) {
  if event.to.role == board and event.object.is-unit { event.object.exhaust() }
}
```

- `Moved` is an event type. The core raises one after every move, and this routine runs then, because it takes one.
  Its fields (`object`, `from`, `to`) are what the routine reads.
- `rule` is the rule as the game lists it. One routine serves every game that lists the rule, with that game's values
  (`rule.keyword` is Hello TCG's `@Guardian`).
- A routine runs only in games that list its rule, and routines for one event run in the order the game lists their
  rules. So `EntersReady` (listed after `UnitsEnterExhausted`) readies a Swift unit after it was exhausted.

## Events

Every event is a record type, declared once in the core (`core-operations.alex`) or a library, beside the operation or
moment that raises it. There are four kinds, all handled the same way:

- **Something happened:** one per operation (`Moved`, `Shuffled`, `Flipped`, `Damaged`…) and one per moment of the loop
  (`GameSetUp`, `RoundStarted`, `RoundEnded`, `TurnStarted`, `TurnEnded`).
- **Something is about to happen:** `Damaging`, `Moving`… A routine may change its fields (`event.amount -= 1` for
  Tough) or cancel it (`event.cancel()`), before the operation runs. Hello TCG needs none of these; Folkborn's Tough
  and its Ambush do.
- **A question the core asks:** `LegalActions` (what may this player do: routines `offer` and `remove` actions),
  `RoundOver` (routines `answer` yes), `StateCheck` (what must happen now: defeats, awakening, losing).
- **An action a player took:** `Play`, `Attack`, `UseAbility`, `Pass`. A routine that takes one carries it out.

The action kinds the libraries already declare (`@common.actions.play`) become these event types.

## The game loop the core runs

The core runs the same loop for every game (`core-operations.alex`, part 6), raising events for the rules:

1. **Setup:** `GameSetUp`.
2. **A round:** `RoundStarted`, then actions until `RoundOver` is answered yes, then `RoundEnded`.
3. **An action:** the actor chooses from `LegalActions`. The action is raised as its event (`Play`, `Attack`…). The
   queued routines then run, with a `StateCheck` between them.
4. **The game is over** when a routine calls `win(player)` or `draw-game()`.

Turns are a library concept: `start-turn(player)` and `end-turn()` are core operations that raise `TurnStarted` and
`TurnEnded`.

## Hello TCG's rules

### Setup (`setup.alex`)

```
// A card of this type starts in this zone, not in the deck.
routine starts-in-zone(rule: StartsInZone, event: GameSetUp) {
  each player in all {
    each card in cards(player.deck, of-type(rule.type)) { card.move(to: rule.zone) }
  }
}

routine shuffle-deck(rule: ShuffleDeck, event: GameSetUp) {
  each player in all { shuffle(player.deck) }
}

routine opening-hand(rule: OpeningHand, event: GameSetUp) {
  each player in all { player.draw(rule.n) }
}
```

### Turns (`turns.alex`)

```
// A player's turn lasts until they pass; then the next player's starts. A round is every player's turn once.
routine full-turns-first(rule: FullTurns, event: GameSetUp) {
  if rule.first == random { game.set-first(pick(all)) }
}
routine full-turns-start(rule: FullTurns, event: RoundStarted) {
  start-turn(game.first)
}
routine full-turns-pass(rule: FullTurns, action: Pass) {
  end-turn()
  if game.turns-this-round < all.count { start-turn(game.actor.next) }
}
routine full-turns-over(rule: FullTurns, question: RoundOver) {
  question.answer(game.turns-this-round == all.count and not game.in-turn)
}

// Each phase's steps, in order, at the start of a turn.
routine phases(rule: Phases, event: TurnStarted) {
  each phase in rule.phases {
    each step in phase.steps { run(step) }
  }
}
routine ready-all(step: ReadyAll) {
  each object in controlled(game.actor) { object.ready() }
}
routine draw-step(step: Draw) {
  if not (step.skip-very-first-turn and game.turn == 1) { game.actor.draw(step.count) }
}

// Only the listed kinds of action may be taken.
routine only-allowed(rule: Actions, question: LegalActions) {
  each action in question.actions {
    if not rule.allowed.has(action.kind) { question.remove(action) }
  }
}
```

A step's routine takes only the step: it runs when `run(step)` runs that step.

### Resources (`resources.alex`)

```
// A number that rises to a cap (mana crystals): a capacity that grows, and what is left of it this turn.
routine growing-counter-start(rule: GrowingCounter, event: GameSetUp) {
  each player in all { player.set(rule, rule.start) }
}
routine grows-at(rule: GrowsAt, event: TurnStarted) {
  game.actor.grow(rule.resource, rule.by)
}
routine refills-at(rule: RefillsAt, event: TurnStarted) {
  game.actor.refill(rule.resource)
}
```

Hello TCG's `GrowsAt { moment = @turn-start }` becomes the event it takes: a moment names an event type, so a rule
that works at the game's chosen moment reads it as `rule.moment`, and the core raises the routine at that event. (The
simpler way, shown here, fixes the event in the routine; which one to use is question 3.)

`grow` raises the capacity to at most the resource's `max`; `refill` sets what is left to the capacity; `pay` (used by
playing a card, below) spends from it. They are routines of the resources library, with parameters:

```
routine grow(player: player, resource: GrowingCounter, by: int) {
  player.set-capacity(resource, min(player.capacity(resource) + by, resource.max))
}
```

### Units and spells (`units.alex`, `spells.alex`, `common.alex`)

```
// A unit card in hand may be played when its player can pay for it.
routine play-units(rule: UnitCards, question: LegalActions) {
  each card in cards(question.player.hand, of-type(rule.types)) {
    if question.player.can-pay(card.cost) { question.offer(play, object: card) }
  }
}
routine play-a-unit(rule: UnitCards, action: Play) {
  if action.object.is(rule.types) {
    action.player.pay(action.object.cost)
    action.object.move(to: action.player.board)
    action.object.trigger(on-enter)
  }
}

routine units-enter-exhausted(rule: UnitsEnterExhausted, event: Moved) {
  if event.to.role == board and event.object.is-unit { event.object.exhaust() }
}
routine enters-ready(rule: EntersReady, event: Moved) {
  if event.to.role == board and event.object.has(rule.keyword) { event.object.ready() }
}

// Damage equal to or more than a unit's Health defeats it.
routine defeat-at-health(rule: DefeatAtHealth, question: StateCheck) {
  each unit in units(all) {
    if unit.damage >= unit.health { unit.defeat() }
  }
}

// A spell is played, does what it says, and goes to its owner's discard.
routine play-spells(rule: SpellCards, question: LegalActions) {
  each card in cards(question.player.hand, of-type(rule.types)) {
    if question.player.can-pay(card.cost) { question.offer(play, object: card) }
  }
}
routine play-a-spell(rule: SpellCards, action: Play) {
  if action.object.is(rule.types) {
    action.player.pay(action.object.cost)
    action.object.move(to: action.player.discard)
    action.object.trigger(on-play)
  }
}
```

`defeat()` is `common`'s: it moves the unit to its owner's discard and fires its `on-defeated`.

### Heroes (`heroes.alex`)

```
// A Hero flips to its second face as soon as its Awaken condition holds, and never back.
routine awaken(rule: AwakenOnStateCheck, question: StateCheck) {
  each hero in heroes(all) {
    if hero.face == 1 and hero.ask(awaken) { hero.flip(2) }
  }
}

// A Hero's Exhaust: its ability, once a round, by exhausting it.
routine hero-power(rule: PowerOncePerRound, question: LegalActions) {
  each hero in heroes(question.player) {
    if hero.ready and hero.has-slot(exhaust) { question.offer(ability, object: hero) }
  }
}
routine use-hero-power(rule: PowerOncePerRound, action: UseAbility) {
  if action.object.is-hero {
    action.object.exhaust()
    action.object.trigger(exhaust)
  }
}

// An Awakened Hero may attack, like a unit.
routine awakened-heroes-attack(rule: HeroAttacksWhenAwakened, question: LegalActions) {
  each hero in heroes(question.player) {
    if hero.face == 2 { offer-attacks(question, from: hero, targets: game.rule(AttackerChooses).targets) }
  }
}
```

`TwoFaces` and `AwakenedNeverReverts` need no routine: nothing flips a Hero back. `HeroAttacksWhenAwakened`'s
`takes-no-damage` is read by the combat rule that deals damage (below).

### Combat (`combat.alex`)

```
// The attacker chooses its target: an enemy unit, or the defending player's life.
routine attacker-chooses(rule: AttackerChooses, question: LegalActions) {
  each unit in units(question.player) { offer-attacks(question, from: unit, targets: rule.targets) }
}
routine offer-attacks(question: LegalActions, from: object, targets: [CombatTarget]) {
  each target in units(opponents) { question.offer(attack, object: from, target: target) }
  if targets.has(life) {
    each player in opponents { question.offer(attack, object: from, target: player) }
  }
}

routine attacker-must-be-ready(rule: AttackerMustBeReady, question: LegalActions) {
  each action in question.actions(attack) {
    if action.object.exhausted { question.remove(action) }
  }
}

// While the defender has a unit with the keyword, only such units may be attacked.
routine guardians-first(rule: GuardiansFirst, question: LegalActions) {
  each action in question.actions(attack) {
    defender = action.target.controller
    if units(defender, has(rule.keyword)).any and not action.target.has(rule.keyword) { question.remove(action) }
  }
}

// An attack exhausts the attacker; a unit it attacks and the attacker deal their Power to each other at once.
routine attack(rule: CombatDamageEqualsPower, action: Attack) {
  action.object.exhaust()
  if action.target.is-unit {
    dealt = action.object.power
    taken = action.target.power
    action.target.damage(dealt)
    if not (action.object.is-hero and game.rule(HeroAttacksWhenAwakened).takes-no-damage) { action.object.damage(taken) }
  }
}
routine life-damage(rule: LifeDamageEqualsPower, action: Attack) {
  if action.target.is-player { action.target.lose-life(action.object.power) }
}

routine damage-clears(rule: DamageClearsAt, event: TurnEnded) {
  each unit in units(all) { unit.heal(unit.damage) }
}
```

`SimultaneousDamage` is the order written in `attack`: both amounts are read before either is dealt.
`game.rule(HeroAttacksWhenAwakened)` is that rule as the game lists it, or nothing when it doesn't (question 2).

### Life (`life.alex`)

```
routine life-counter-start(rule: LifeCounter, event: GameSetUp) {
  each player in all { player.set(rule.name, rule.start) }
}
routine lose-at(rule: LifeCounter, question: StateCheck) {
  each player in all {
    if player.counter(rule.name) <= rule.lose-at { player.lose() }
  }
  if players-left.count == 1 { win(players-left.first) }
}
```

## What the language gains

No new keywords. The routines above use these on top of what Alex has today:

1. **Events are record types**, declared in the core and the libraries (`type Moved : Event { object, from, to }`). A
   routine handles an event by taking it as a parameter; the parameter's type says when it runs.
2. **`rule` is a parameter too**: the record the game listed. A routine whose first parameter is a rule type runs only
   in games that list that rule; one whose only parameter is a step type is that step's behaviour.
3. **`each x in selection { ... }`**: the one loop. It goes over a selection (units, cards, players, actions, a rule's
   list), so every routine still finishes.
4. **Any name in a binding**: `defender = action.target.controller`. Today only `target` may be bound; the same
   statement takes any name.
5. **A question's words:** `question.offer(kind, object: …, target: …)`, `question.actions`, `question.remove(action)`
   and `question.answer(value)`: methods of the question events, declared with them like any verb.
6. **`game.rule(RuleType)`**: another rule as the game lists it, or nothing (question 2).
7. **Routines with parameters called like words** (`grow(player, resource, by)`, `offer-attacks(question, from: unit)`):
   the libraries' vocabulary written in Alex, instead of Rust, as far as it can be.

## Questions for the owner

1. **Is this how library rules should read?** A routine taking the rule and the event it handles, `each`, and
   bindings with any name.
2. **Reading another rule's values.** `CombatDamageEqualsPower` needs `HeroAttacksWhenAwakened`'s `takes-no-damage`.
   The proposal is `game.rule(HeroAttacksWhenAwakened).takes-no-damage`, which is nothing when the game doesn't list
   that rule. Another option is for the two rules to be one.
3. **Rules that work at a moment the game chooses.** Hello TCG writes `GrowsAt { moment = @turn-start }`. Either the
   routine fixes its event (`event: TurnStarted`, as above) and a game that grows at another moment lists another
   rule, or the moment becomes an event type the game names (`GrowsAt { at = TurnStarted }`) and the core raises the
   routine at that event. The first is simpler; the second keeps one rule for every moment.
4. **What stays in Rust.** The core's operations (`move`, `shuffle`, `flip`…), the loop, the scheduler, randomness and
   the few words that read the game's state (`units`, `cards`, `game.actor`) stay in the engine. Everything that is a
   rule of some game is Alex. Is that the line?

Once this is agreed, the language changes are made in both Alex implementations, the routines go into the libraries,
and the runtime runs them, until two random bots play whole Hello TCG games.
