# The runtime, on paper

This is the design of the Kardix runtime: the part of the core that plays a game from its Alex source. It is a
proposal for the owner to review before any code is written, the way Folkborn was written on paper first
(`docs/tcg/folkborn-playable/`). The plan's Stage 6 builds it: Hello TCG first, then Folkborn.

It covers:
- what the runtime is and how a host talks to it;
- the one big decision: whether the library rules are written in Alex or built into the engine;
- how a routine runs, and how it waits for a player's choice;
- randomness, replays, the log and hidden information;
- the order it is built in, each step with how we know it is done.

## What the runtime is

The runtime is part of the core, `kardix.wasm`, written in Rust. It is pure: no files, no clock, no network. It takes
a loaded game (the project the loader already builds), the players' decks and a seed, and then:

- says which player must act and what they may do (the legal actions);
- takes one action at a time and applies it;
- writes what happened to a log, and shows each player only what that player may see.

Everything else is a **driver** that picks actions for a seat: a person at a table, a bot, an LLM, a recorded game.
The runtime never asks anyone anything; it says a decision is needed and waits for the next action.

Today's Folkborn engine (`packages/engine`) already works this way: the game state is plain data, a game is a
fold over actions, and a seed plus the action list replays a game. The runtime keeps that shape. What changes is
that the engine knows no game: Folkborn's rules come from its Alex files, not from TypeScript.

### How a host uses it

A few new exports of the module, beside the loader's:

| Export | What it does |
|---|---|
| `game_new(project, setup, seed)` | Starts a game: the seats, each seat's deck, the seed. Returns the game. |
| `game_decision(game)` | Who must act, and their legal actions, each with an id and a plain description. |
| `game_apply(game, seat, action)` | Applies an action. An illegal one is refused and logged, and the game waits. |
| `game_view(game, seat)` | What that seat can see: the table, their hand, counts of hidden zones. |
| `game_log(game, seat, from)` | The log since an entry, as that seat may see it. |
| `game_clone(game)` | A copy, for a bot to try moves on. |
| `game_save(game)`, `game_load(bytes)` | The whole state as bytes, to store an online game or resume one. |

`kardix sim`, Studio's Play tab, the online match host and the nightly playtests are all hosts of these few calls.

## The big decision: library rules in Alex

A game lists rules from the libraries: `GuardiansFirst { keyword = @Guardian }`, `LifeStack { ... }`,
`AlternatingActions { ... }`. Something has to make each of them work. There are two ways.

**A. Built into the engine.** Each library rule is Rust code in the core. That is what the plan said until now.

**B. Written in Alex.** Each library rule is a routine in its library file, attached to one of the core's hooks
(`core-operations.alex`: provide, filter, before, after, replace). The engine knows only the core: objects, zones,
players, the operations, the scheduler, the hooks, and how to run routines. The owner recorded this as the
intended direction (`cardengine/decisions.md`, "Routines").

To see whether B works, here are five of Folkborn's library rules written as B would write them (six routines:
one rule answers two hooks). `rule` is the rule
as the game lists it, so `rule.keyword` is the game's `@Guardian`.

```
// units: a unit enters play exhausted.
routine units-enter-exhausted(rule: UnitsEnterExhausted) after moved {
  if event.to.role == board and event.object.is-unit { event.object.exhaust() }
}

// units: a unit with the keyword enters ready. Listed after the rule above, so it runs after it.
routine enters-ready(rule: EntersReady) after moved {
  if event.to.role == board and event.object.has(rule.keyword) { event.object.ready() }
}

// combat: while the defender controls a unit with the keyword, only those units may be attacked.
routine guardians-first(rule: GuardiansFirst) filter legal-actions {
  each attack in actions(attack) {
    if units(attack.target.controller, has(rule.keyword)).any and not attack.target.has(rule.keyword) {
      remove(attack)
    }
  }
}

// turns: players take one action each in turn; the round ends when every player has passed in a row.
routine alternating-actions(rule: AlternatingActions) provide next-actor { answer(game.actor.next) }
routine all-passed(rule: AlternatingActions) provide round-over { answer(game.passes-in-a-row >= all.count) }

// life-stack: a player whose stack is empty loses.
routine lose-when-empty(rule: LoseWhenEmpty) provide game-over {
  each player in all { if player.life.count == 0 { player.lose() } }
}
```

What that needs beyond today's routines, all small:

- **A routine attached to a hook**: `after moved`, `filter legal-actions`, `provide next-actor`. The hook says what the
  routine receives (`event`, `actions`) and what it answers.
- **`rule`**: the rule record the game listed, so one routine serves every game that lists the rule with its own
  values.
- **`each` over a selection**, which the plan already allows (no other loops, so every routine still finishes).
- **Actions as values** the routine can look at and remove (`attack.target`), and `answer(...)` for a hook that
  provides one value.

**Decided: B** (the owner, 2026-09-29). It is fewer concepts in total:
- The engine knows no game at all. Nobody reads Rust to learn what Guardian does; it is five lines in
  `combat.alex`, in the same language as the cards.
- A game can add a rule no library has without an engine change, written the way library rules are.
- About a hundred library rules would otherwise each be Rust code to write, test and keep identical everywhere.

The cost is speed. A bot plays thousands of games, and a hook like `filter legal-actions` runs on every decision.
The core would compile each routine once when the game loads (into a compact tree the interpreter walks), not
read text while playing. If a measured rule is too slow, it may get a Rust version that must behave identically,
checked by running both. That is an escape hatch, not the plan.

## How a routine runs

- **Routines run inside the engine's state, not on Rust's call stack.** When a routine calls `choose(...)`, the game
  needs a player's answer. The routine's place (which statement, what `target` holds) is saved in the game state,
  the runtime reports the decision, and the next action resumes it. The saved state is plain data, so a paused
  game can be cloned by a bot, saved by the online host, or replayed.
- **Effects are scheduled, not run on the spot** (the core's scheduler, part 5 of `core-operations.alex`). A
  "Hello:" queues its routine; the engine drains the queue by the game's rules, with a state check between items
  (defeats, Awaken, losses: Folkborn's §800).
- **Statics are recomputed, not run.** "Your units have Pearl Tears" holds while its card is in play. The runtime
  works out each unit's Power, Health and keywords from the printed card, the statics in play and the "this
  round" buffs, when asked, and keeps a cache that any change clears.

### When targets are chosen

Folkborn's rulebook says a card's targets are chosen when it is played, before the opponent's Ambush window
(§400.1, §500.4: the ambusher knows the targets). A handler, though, asks inside its body:
`@a-domowiks-temper.on-play = choose(all).damage(card.damage)`.

The runtime reconciles them the way the rules read. When a card is played, its on-play routine is run up to its
first change of state, answering only the `choose` calls it meets. Those answers are stored with the play. The
Ambush window opens. The routine then runs for real, using the stored answers. A stored target that has gone
does nothing (§400.2). Which games choose targets on play is a library rule (`TargetsChosenOnPlay`), not a fixed
behaviour, since some games choose on resolution.

## Randomness and replays

- One seeded random generator lives in the game state. Shuffling and the first Lantern holder draw from it, and
  every draw is logged.
- A game is its setup, its seed and its actions. Feeding the same actions to the same game gives the same log,
  byte for byte, on every host.
- The first test of the runtime is a replay: a recorded Hello TCG game, replayed, must give the same log.

## The log, and what each player sees

The log is the runtime's only output, as `core-operations.alex` part 7 says. Every entry says what happened, which
rule caused it and its rulebook citation (the answer to "why did that happen?"), and who may see it. A player's
view is their log folded up. A card drawn into an opponent's hand shows as "a card was drawn".

A bot sees what its seat sees. To search, it fills in what it can't see (the opponent's hand, the deck order) with
guesses, as today's Folkborn bot does (`determinize` in `packages/engine/src/ai.ts`).

## Building it, in order

Each step ends with its *done when* shown working.

1. **The table.** Game state, the core's operations, the log with visibility, the seeded shuffle. *Done when* a
   test sets up Hello TCG's table (decks shuffled, hands drawn, the Hero in its zone) the same way from the same
   seed.
   *Done 2026-09-29,* in `cardengine/engine/src/runtime/`:
   - **What a game starts from.** The catalog (zones, cards and decks read from the loaded project once) and the
     state (players, each seat's zones, objects).
   - **The operations.** Every operation of the contract but the two grid ones (`turn`, `create-zone`), which come
     with the first game on a grid. Each logs one event, with the rule that caused it.
   - **Randomness.** xoshiro256\*\* seeded from the game's seed, in the state.
   - **What each seat sees.** A seat sees a card's identity where its zone shows it: an Offering to its owner, the
     top of a `top-card` pile, and what `reveal` showed until the card moves. The log leaves out the id of an object
     a seat can't see, since an id seen once would follow the card. A seat's view of a pile it can't see into is
     only the pile's count.
   - **The exports.** `game_new`, `game_view`, `game_log`, `game_clone` and `game_free`, wrapped in
     `host/core.ts` (`project.startGame('42 hearth threshold')`).
   - **Tests.** `tests/runtime.rs` sets up Hello TCG with the operations as its setup rules will: the same seed
     gives the same table and log, other seeds deal other hands, a player's log hides the opponent's draws, and a
     clone is independent.
   - **Two things decided on the way.** A game starts with each deck, its Hero included, in the deck zone: setup
     rules move the Hero out, as Hello TCG's and Folkborn's list `StartsInZone` first. A moved card is no longer
     revealed.
2. **Routines run.** The interpreter, pausing on `choose`, and the scheduler. *Done when* Hello TCG's card
   handlers run in scenario-sized tests: Kłobuk draws a card, the Temper defeats a Creature.
3. **Rules on hooks.** The hook machinery, and Hello TCG's library rules written in Alex. *Done when* two random
   bots play whole Hello TCG games to a winner, and a recorded game replays to the same log.
4. **`kardix sim`.** Plays games with random bots and prints the log. *Done when* it plays 1,000 Hello TCG games
   without an error, and says how long they took.
5. **Folkborn plays.** After Folkborn's draft moves into `games/folkborn/`. *Done when* bots play Folkborn's decks
   against each other, and win rates and game lengths match today's engine (`packages/engine`) statistically.

Scenarios (the tests in rules files) run from step 2 on, since they are small games.

## Decided with the owner (2026-09-29)

1. **Library rules are written in Alex (B).** The plan's section "Rules: from libraries, written in Alex" says so.
2. **Folkborn's round limit is a rule.** After round 40 the game ends: more Candles wins, then more Health left on
   the units in play, and a draw if both are equal (rulebook §300.7). The library's `MaxRounds` gains its tiebreaks
   in order (`winner = [most-life, most-unit-health]`); gap 14 of the Folkborn draft.
