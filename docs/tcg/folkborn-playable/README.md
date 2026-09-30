# Folkborn as a playable game, on paper

This folder is Folkborn written out completely in Alex: the game's rules and every card's handler, so that the
runtime could play it. It is a draft for review before the runtime is built. Nothing loads it: the site, `kardix`
and the card renderer still read `games/folkborn/`.

Laid over a copy of `games/folkborn/`, it is a whole game the core can check. The core's checker already binds
rules code, so this draft has been through it. Most of what it reports comes from 16 gaps in the core and the
libraries, listed below. Closing them is the work to do before the runtime can play Folkborn.

## The files

| File | What it is |
|---|---|
| `folkborn.alex` | The game. It is today's `games/folkborn/folkborn.alex` (card types, keywords, finishes) plus the rules: zones, setup, rounds, the Lantern, Offerings, Candles, attacks, Ambush, heroes, deck building. Each rule cites its section of [the rulebook](../../rulebook.md), part 13. |
| `folkborn-rules.alex` | Handlers that cards in several families share: draw a card, deal damage to a unit, exhaust an enemy unit, and so on. |
| `domowiki-rules.alex`, `pari-rules.alex`, `aluxes-rules.alex`, `jiaoren-rules.alex`, `hui-hai-rules.alex`, `mochi-rules.alex` | Each set's own handlers (its mechanic, its unusual cards) and the lines that attach a handler to each of its cards. |
| `sets/<set>/<set>.alex` | Today's set files, with the numbers in a card's text as its constants and Aluxes's rain counter (below). Mochi's is unchanged, so it isn't copied here. |

The rules are about 370 lines: 200 in the game file, and 170 in the rules files. The 106 cards (the Dove token
included) need 48 handlers, most of them one line long, and 88 lines attach them. 12 of the handlers are shared by
cards of several families.

## How it reads

A rule in the game file names a library's rule, fills in its numbers from the game's constants, and cites the
rulebook:

```
combat = [
  GuardiansFirst { keyword = @Guardian, cites = '§600.1' }
  HitCostsLife { keyword = @Fierce, n = @candles-per-fierce-hit, cites = '§600.5' }
]
```

A card's handler is one line in its set's rules file, and a second line attaches it to the card:

```
routine damage-a-unit { choose(all).damage(card.damage) }
@a-domowiks-temper.on-play = damage-a-unit
```

`card.damage` is the number printed on the card that the handler is attached to: 5 on A Domowik's Temper, 2 on
Falling Star. One handler serves both.

A family's mechanic is a handler attached to its keyword, so every unit with the keyword has it:

```
routine pearl-tear { ready-resources(one) }
@pearl-tears.on-survives-damage = pearl-tear
```

A Hero has a handler for each labelled line of its text:

```
routine enough-offerings : bool { own.resources.count >= card.offerings }
@dziadzius.exhaust = ready-an-offering
@dziadzius.awaken = enough-offerings
@dziadzius.back.exhaust = ready-two-offerings
```

Cards whose text is only keywords ("Guardian. Fierce.") need no handler: the game's keyword rules cover them.

## What changes in today's files

- **Numbers become constants.** A card's text shows its numbers as `{name}`, and the card lists them:
  `text = 'Lucky. Deal {damage} damage to a unit.'` with `constants = [damage = 5]`. The printed words are
  unchanged. Numbers written as words ("Ready two of your Offerings", "Draw a card") stay words. The names are
  `damage`, `heal`, `boost` (extra Power), `extra-health`, `draw`, `sprout`, `company-damage`, `others`
  (Orange-Peri), and on the Heroes `offerings`, `units`, `candles` and `fallen` (their Awaken conditions). 45
  cards change.
- **Numbers the text spells as words** ("Ready two of your Offerings", Stone for Stone's "deal 1 damage") are
  members of a number-backed enum, `Count` in the `common` library: `ready-resources(two)`. No handler types a
  digit. This needs gap 17.
- **Aluxes declares its rain counter:** `counters = [rain = StatCounter { power = 1, health = 1, max = @rain-fed-max }]`.
- **The game file gains its rules.** An older playable version of it, written for the retired cat cards, is still
  in `cardengine/folkborn/folkborn.alex`; this draft replaces it.
- **The game's constants are the rulebook's tunable parameters** (§900), plus one the rulebook lacks: today's
  engine ends a game after round 40 and the player with more Candles wins. Either the rulebook says so or the
  rule goes.

## What the checker says

Laid over `games/folkborn/`, the draft got 137 errors, all from the first 16 gaps below (gap 17 came later). Many are
repeats: a missing slot is reported on every card that uses it, and the handler it would have run is reported
too, because it can't see that card's constants. "Folkborn" in the Fix column means the fix is in Folkborn's own
files; the other fixes are in the platform.

| # | Gap | Where it shows | Fix |
|---|---|---|---|
| 1 | The libraries declare `Rarity` and `Card.rarity` (common), and `Family` and `Card.family` (families). Folkborn prints its own, so the names clash. Hello TCG has the same error. | 28 errors: 4 here, and each set's `family` fails | Library: rarity and families are what cards print, not rules, so they belong to the game. The libraries drop them or give way to a game's own. |
| 2 | A library Hero has `face1`/`face2` records. Folkborn and Hello TCG print a Hero with a `back`, and put `exhaust`, `awaken` and `static` on the Hero and on its back. | 31 errors, and more in handlers that can't see the Hero's constants | Library: `HeroCards { second-face = back }`, with the slots on the Hero card and on its second face. |
| 3 | A Talisman must carry `attached: Grant` as data, so its `static` slot is never reached. | 14 errors, and more in handlers | Library: `attached` becomes optional. What a Talisman grants is printed text, so it is a static handler reading the card's constants. |
| 4 | Keywords have no handler slots. Feather Coat, Rain-Fed, Pearl Tears and Stone for Stone are behaviour on a keyword. | 4 errors | Core: a keyword takes the slots of the cards that carry it, and a unit with it runs its handlers. |
| 5 | No "damaged and survives" moment. | hidden behind gap 4 | Library (units): an `on-survives-damage` slot. |
| 6 | A keyword word in a handler (`grant(pearl-tears)`) must be one of the game's keywords. A set's own keywords aren't found. | 5 errors | Checker: look in the game's sets too. |
| 7 | "Once per round" can't be said in a handler (Schaibar, The Roadside Alux). | 6 errors | Core: a `once-per-round { ... }` block. The alternative, `abilities = [...]` on the card, can't carry "Fierce." in the printed text. |
| 8 | A rules file is for one set; handlers that several sets share have nowhere to go. | 1 error | Core: `Rules.for` also takes the game. |
| 9 | No way to count cards in a zone ("5 or more Fabled and Creatures are in the Mist"). | 1 error | Library (common): a `cards(zone, players, filters)` selector and a `unit-card` filter. |
| 10 | `summon` takes a `Token` record; Folkborn's Dove is a card of a token type. | 1 error | Library: `summon` takes a card of a token type. |
| 11 | A card whose text is only keywords must have a handler. | 27 errors | Checker: text made only of the card's keywords needs none. |
| 12 | A card's constants share names with the game's: Aluxito's `candles` makes the game's `@candles` ambiguous. | 1 error | Core: a card's constants belong to the card, not the game's namespace. |
| 13 | Mochi's set and its one card are both named `mochi`, so `@mochi.on-enter` names the set. | 3 errors | Folkborn: give the card its own key (`mochi-the-sweet-spirit`). |
| 14 | `MaxRounds` doesn't say who wins at the limit. | not an error | Library: `MaxRounds { n, winner = most-life }`. |
| 15 | Setup order across areas isn't defined: the Candles are dealt (a `life` rule) after the shuffle and before the opening hand (`setup` rules). | not an error | Library: a setup step that deals the life stack, placed in `setup`. |
| 16 | A Whistle in the Dark has Ambush but may only answer an attack. | not an error | Checker: a handler that uses the attack it answers (`event.cancel()`) makes the card playable only in an attack's window. |
| 17 | Alex enums are names only. Handlers want `ready-resources(two)`, with `two` standing for 2. | 6 errors (the owner's request, 2026-09-29) | Alex (both implementations): enums backed by a number or a short fixed-size string (`enum Count : int { one = 1, two = 2 }`), accepted where that number or string is expected, as C# enums are; `Count` in `common`. Being done in its own session. |
| 19 | `effect` (a handler that does something) and `condition` (one that answers yes or no) were two concepts for one thing. | not an error (the owner's decision, 2026-09-29) | Done. Alex (both implementations): `routine`. `routine x { ... }` is an effect and `routine x : bool { ... }` a condition; the slot says which it wants. This draft's handlers are routines. `effect` and `condition` still bind. |

Everything else binds as written: the zones, setup, rounds, the Lantern, Offerings, Candles, combat, Ambush,
scheduling, the keyword rules (Swift, Guardian, Sneaky, Fierce, Tough, Lucky, Ambush), the constants, and
handler words such as `choose(own, exhausted)`, `offer-from-deck(card.sprout, exhausted: true)`,
`units(own, guardian).any`, `own.played-this-round`, `this.cant(attack)` and `event.cancel()`.

## To check it yourself

Copy `games/folkborn/`, lay this folder's `.alex` files over the copy (its `sets` folder too), and run:

```bash
cargo run --release --manifest-path cardengine/engine/Cargo.toml --example check -- <the copy>
```

## Next

Close gaps 1 to 13 and 17 in the core and the libraries, which Hello TCG needs too (gaps 1 and 2 are among its
errors). Then Folkborn checks clean, and this folder moves into `games/folkborn/`. Gaps 14 to 16 are about how
the runtime behaves, so they are settled when it is built. The runtime starts with Hello TCG, then plays Folkborn,
compared game for game with today's engine.
