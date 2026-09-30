# Folkborn as a playable game: how it was written

Folkborn was written out completely in Alex on 2026-09-29 (the game's rules and every card's handler), first as a
draft here for the owner to review before the runtime was built, then moved into `games/folkborn/` the same day once
the core's checker accepted it. **The source is `games/folkborn/`**; this page is the record of how it got there: what
the files hold, how they read, and the 19 gaps the draft found in the core and the libraries, with how each was closed.

## The files

In `games/folkborn/`:

| File | What it is |
|---|---|
| `folkborn.alex` | The game. It is today's `games/folkborn/folkborn.alex` (card types, keywords, finishes) plus the rules: zones, setup, rounds, the Lantern, Offerings, Candles, attacks, Ambush, heroes, deck building. Each rule cites its section of [the rulebook](../../rulebook.md), part 13. |
| `folkborn-rules.alex` | The named handlers cards in several families share: a boost that also readies an Offering, and the Mist condition Zhu'er and Pebble awaken on. |
| `domowiki-rules.alex`, `pari-rules.alex`, `aluxes-rules.alex`, `jiaoren-rules.alex`, `hui-hai-rules.alex`, `mochi-rules.alex` | Each set's lines that give each of its cards its handler, and the few handlers it names. |
| `sets/<set>/<set>.alex` | The set files, with the numbers in a card's text as its constants, and Aluxes's rain counter (below). |

The rules are about 380 lines: 200 in the game file, and 176 in the rules files. The 106 cards (the Dove token
included) need 88 lines that give a card's slot its handler. In 76 of them the handler is written right there, one
statement (gap 18). 8 handlers have names: those of several statements, the conditions other handlers read
(`@is-well-fed`, `@has-company`), and a set's mechanic that three cards share (`sprout`).

## How it reads

A rule in the game file names a library's rule, fills in its numbers from the game's constants, and cites the
rulebook:

```
combat = [
  GuardiansFirst { keyword = @Guardian, cites = '§600.1' }
  HitCostsLife { keyword = @Fierce, n = @candles-per-fierce-hit, cites = '§600.5' }
]
```

A card's handler is usually one line in its set's rules file, written where it is attached to the card's slot:

```
@a-domowiks-temper.on-play = choose(all).damage(card.damage)
```

`card.damage` is the number printed on the card that the handler is attached to: 5 on A Domowik's Temper, 2 on
Falling Star, which has the same line.

A family's mechanic is a handler attached to its keyword, so every unit with the keyword has it:

```
@pearl-tears.on-survives-damage = ready-resources(one)
```

A Hero has a handler for each labelled line of its text:

```
@dziadzius.exhaust = ready-resources(one)
@dziadzius.awaken = own.resources.count >= card.offerings
@dziadzius.back.exhaust = ready-resources(two)
```

A handler of several statements, or one that other handlers read, has a name, and a card's slot names it:

```
routine sprout { offer-from-deck(card.sprout, exhausted: true) }
@moving-day-domowik.on-enter = sprout
```

Cards whose text is only keywords ("Guardian. Fierce.") need no handler: the game's keyword rules cover them.

"Once per round" is a condition in the handler:

```
@schaibar.on-defeats-in-combat = if once-per-round { this.ready() }
```

## What changes in today's files

- **Numbers become constants.** A card's text shows its numbers as `{name}`, and the card lists them:
  `text = 'Lucky. Deal {damage} damage to a unit.'` with `constants = [damage = 5]`. The printed words are
  unchanged. Numbers written as words ("Ready two of your Offerings", "Draw a card") stay words. The names are
  `damage`, `heal`, `boost` (extra Power), `extra-health`, `draw`, `sprout`, `company-damage`, `others`
  (Orange-Peri), and on the Heroes `offerings`, `units`, `candles` and `fallen` (their Awaken conditions). 45
  cards change.
- **Numbers the text spells as words** ("Ready two of your Offerings", Stone for Stone's "deal 1 damage") are
  members of a number-backed enum, `Count` in the `common` library: `ready-resources(two)`. No handler types a
  digit (gap 17, done).
- **Aluxes declares its rain counter:** `counters = [rain = StatCounter { power = 1, health = 1, max = @rain-fed-max }]`.
- **The game file gains its rules.** An older playable version of it, written for the retired cat cards, is still
  in `cardengine/folkborn/folkborn.alex`; this draft replaces it.
- **The game's constants are the rulebook's tunable parameters** (§900), including the round limit: the game ends
  after round 40 (§300.7, added to the rulebook on 2026-09-29 at the owner's decision).

## What the checker says

Laid over `games/folkborn/`, the draft gets 4 errors (2026-09-29, after gaps 1 to 12 and 17 to 19): 3 from gap 13
(Mochi's key) and 1 from gap 14 (`MaxRounds` has no `winner` yet). It got 115 before gaps 1 to 12 were closed, and 49
with only the libraries' gaps closed. The check also reports 6 errors in the Flower Souls prototype
(`games/folkborn/prototypes/`), whose rules aren't written yet; they aren't counted here. Before its handlers were
written inline it got 147: a named handler whose slot is missing is also reported on its own, since, attached to nothing,
it can't see any card's constants. Written inline, it isn't checked until its slot exists. "Folkborn" in the Fix column
means the fix is in Folkborn's own files; the other fixes are in the platform.

| # | Gap | Where it shows | Fix |
|---|---|---|---|
| 1 | The libraries declare `Rarity` and `Card.rarity` (common), and `Family` and `Card.family` (families). Folkborn prints its own, so the names clash. Hello TCG has the same error. | 28 errors: 4 here, and each set's `family` fails | Done. Alex (both implementations, C# Alex 0.11.0): a game's own type hides a library's of the same name for the game's documents, and a field its type declares hides the member a library's extension gives the base; the libraries keep meaning theirs. The libraries still declare `Rarity`, `Family`, `Card.rarity` and `Card.family` for games that want them. |
| 2 | A library Hero has `face1`/`face2` records. Folkborn and Hello TCG print a Hero with a `back`, and put `exhaust`, `awaken` and `static` on the Hero and on its back. | 31 errors, and more in handlers that can't see the Hero's constants | Done, differently from the proposal: `HeroCards { types = [@Hero], second-face = @Awakened }` names the back's type, not the field (`second-face = back`), since a field's name isn't a value Alex has. `face1` is optional; the Hero card and the `HeroFaceCard` its back is mapped onto have `exhaust`, `awaken` and `static`, and a handler on the back reads the back's constants. |
| 3 | A Talisman must carry `attached: Grant` as data, so its `static` slot is never reached. | 14 errors, and more in handlers | Done. Library: `attached: Grant?`. A Talisman's grant is a static handler reading the card's constants. |
| 4 | Keywords have no handler slots. Feather Coat, Rain-Fed, Pearl Tears and Stone for Stone are behaviour on a keyword. | 4 errors | Done, in the libraries rather than the core: a keyword has all of a unit's slots (`on-enter`, `on-defeated`, `on-round-start`, `on-attack`, `on-defeats-in-combat`, `static`…), since the unit that has it, printed or granted, runs its handlers, with `this` that unit. Each library that gives `UnitCard` a slot declares the same one on `Keyword`, beside it (`extension Keyword { ... }`), so no language change was needed. With gap 5, `on-survives-damage` is one of them. |
| 5 | No "damaged and survives" moment. | hidden behind gap 4 | Done. Library (units): `on-survives-damage` on units, with the ability kind `OnSurvivesDamage`. On keywords with gap 4. |
| 6 | A keyword word in a handler (`grant(pearl-tears)`) must be one of the game's keywords. A set's own keywords aren't found. | 5 errors | Done: the checker looks in the game's sets too. The Heroes' and Talismans' `grant`s are still behind gaps 2 and 3. |
| 7 | "Once per round" can't be said in a handler (Schaibar, The Roadside Alux). | 6 errors | Done, differently from the proposal: no block and no language change. The core has a condition, `once-per-round`, true the first time in a round that the card's handler asks: `@schaibar.on-defeats-in-combat = if once-per-round { this.ready() }`. It is the word for what `Ability.once-per-round` says as data, used with the `if` handlers already have. Both handlers are now one line. |
| 8 | A rules file is for one set; handlers that several sets share have nowhere to go. | done | Core: rules documents no longer say `for = @set` (the owner, 2026-09-29): a rules file is part of the game by being in its folder, like a cards file, and its handlers name the cards they attach to. `for` stays as a deprecated field with no effect. |
| 9 | No way to count cards in a zone ("5 or more Fabled and Creatures are in the Mist"). | hidden behind gap 2: the count is written on the Heroes' Awaken slots | Done. `cards(zone, players, filters)` in `common`, and the `unit-card` filter in `units`, since it is about `UnitCard`. |
| 10 | `summon` takes a `Token` record; Folkborn's Dove is a card of a token type. | 1 error | Done. `summon` takes a card: a `Token`, or a card of the game's own token type (`summon(@dove)`). A reference to a card or a zone now stands where a handler's `card` or `zone` parameter is. |
| 11 | A card whose text is only keywords must have a handler. | 27 errors | Done: text whose every sentence is one of the card's keywords as printed ("Guardian. Fierce.", "Tough 1" from `Applied`) needs none. Text with anything more still does. |
| 12 | A card's constants share names with the game's: Aluxito's `candles` makes the game's `@candles` ambiguous. | 1 error | Done, as an Alex rule (both implementations, Alex 0.10.0): in a map inside another map's entry, a plain value (a number, a text) belongs to the entry and is reached through it, so a card's constants are `card.candles` in its handlers and never `@candles`. Records there are still named, since art briefs name their pictures. |
| 13 | Mochi's set and its one card are both named `mochi`, so `@mochi.on-enter` names the set. | 3 errors | Done. The card's key is `mochi-the-sweet-spirit` (its printed name is still Mochi); the Artist Studio's brief refers to it by that key. |
| 14 | `MaxRounds` doesn't say who wins at the limit. | not an error yet | Decided by the owner (2026-09-29, now rulebook §300.7): after round 40, more Candles wins, then more Health left on units in play, else a draw. Library: `MaxRounds { n, winner = [most-life, most-unit-health] }`, the tiebreaks in order, a draw when all are equal; built with the runtime. The library part is done: `MaxRounds { winner: [Tiebreak] }`, with `most-life` and `most-unit-health`. |
| 15 | Setup order across areas isn't defined: the Candles are dealt (a `life` rule) after the shuffle and before the opening hand (`setup` rules). | not an error | Library: a setup step that deals the life stack, placed in `setup`. |
| 16 | A Whistle in the Dark has Ambush but may only answer an attack. | not an error | Checker: a handler that uses the attack it answers (`event.cancel()`) makes the card playable only in an attack's window. |
| 17 | Alex enums are names only. Handlers want `ready-resources(two)`, with `two` standing for 2. | 6 errors (the owner's request, 2026-09-29) | Done. Alex (both implementations): enums backed by a number or a short fixed-size string (`enum Count : int { one = 1, two = 2 }`, `enum Code : text(3) { ... }`), a member standing for its value wherever that value's type is expected, as C# enums are; `Count` in `common`. |
| 18 | Every handler had to be named, even one call: `routine draw-a-card { draw() }` and `@klobuk.on-enter = draw-a-card`. | not an error (the owner's request, 2026-09-29) | Done. Alex (both implementations): the right side of `@card.slot = ...` is a named handler or one statement, bound as a handler of the slot's kind: `@klobuk.on-enter = draw()`. This draft writes its one-statement handlers that way. |
| 19 | `effect` (a handler that does something) and `condition` (one that answers yes or no) were two concepts for one thing. | not an error (the owner's decision, 2026-09-29) | Done. Alex (both implementations): `routine`. `routine x { ... }` is an effect and `routine x : bool { ... }` a condition; the slot says which it wants. This draft's handlers are routines. `effect` and `condition` still bind. |

Everything else binds as written: the zones, setup, rounds, the Lantern, Offerings, Candles, combat, Ambush,
scheduling, the keyword rules (Swift, Guardian, Sneaky, Fierce, Tough, Lucky, Ambush), the constants, and
handler words such as `choose(own, exhausted)`, `offer-from-deck(card.sprout, exhausted: true)`,
`units(own, guardian).any`, `own.played-this-round`, `this.cant(attack)` and `event.cancel()`.

## To check it

```bash
cargo run --release --manifest-path cardengine/engine/Cargo.toml --example check -- games/folkborn
```

Folkborn checks clean: 0 problems. The Flower Souls prototype (`games/folkborn/prototypes/`) isn't in the game's
`sets`, so its cards aren't required to have handlers yet; its rules are written once its cards are final with the
artist. Everything else about it is still checked.

## Next

Gaps 1 to 13 are closed, and gap 14's `winner` is in the library. Gaps 14 to 16 are about how the runtime behaves, so
they are settled as it is built (docs/tcg/runtime-design.md). The runtime starts with Hello TCG, which checks with no
errors, then plays Folkborn, compared game for game with today's engine.
