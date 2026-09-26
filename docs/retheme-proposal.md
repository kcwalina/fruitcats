# Re-theming the game: from fruit cats to folk creatures (proposal)

The game is moving from fruit-hooded cats to creatures of folk mythology from around the world, one family per deck
(Domowiki first, docs/domowiki-set.md). Many rules words and screens are still about cats. This is a proposal for
what each one becomes. Nothing here is built yet.

Written 2026-09-26. For the owner to decide.

## The picture behind the words

Each player is a household in a folk tale, and the creatures of their culture come to help. You set out
**Offerings** for them, a **Patron** spirit leads them, the one holding the **Lantern** acts first, and you lose when
your last **Candle** goes out. Offerings, lanterns and candles appear in folk belief almost everywhere, so they fit
any culture a later deck comes from.

## Proposed words

**Resources and places**

| Now | Proposed | Why |
|---|---|---|
| Treats | **Offerings** | Folk spirits are fed with offerings (bread, milk, rice, sake) all over the world. |
| Plant (a card as a Treat) | **Offer** | "Offer a card" reads naturally. |
| Pantry | **Offerings** (the row) | No separate zone name needed. |
| Lives (9, drawn as hearts) | **Candles** (still 9) | Each hit blows out a candle; the last one out loses. Keeps the rule, drops the "nine lives" cat pun. |
| Yard | Yard (keep) | Not cat-specific, and yard spirits are folklore too. |
| Den (where the Hero Cat sits) | **Hearth** | Where a patron spirit lives. |
| Compost (discard) | **the Mist** | Creatures fade into the mist; gentle for kids. |

**Who acts first**

| Now | Proposed | Why |
|---|---|---|
| Yarn Ball / Take the Yarn / the Yarn rolls | **the Lantern** / **Take the Lantern** / the Lantern passes | Whoever holds the lantern leads the way through the night. |

**Card types**

| Now | Proposed | Why |
|---|---|---|
| Hero Cat | **Patron** | The spirit who leads your deck (Dziadek for the Domowiki). |
| Kitten side / Big Cat side | **Young** / **Elder** | Folk spirits grow old and wise. |
| Grow Up | **Come of Age** | Same rule, new words. |
| Cat (the unique, strongest units) | **Hero** | The named figures of a folk tale: Kikimora, the Bannik. |
| Critter | **Creature** | |
| Trick | **Charm** | Folk magic, in one word. |
| Toy | **Talisman** | Something a creature carries: an old bast shoe, an amulet. |
| Garden (the neutral family) | **Wildfolk** | Hedgehogs, crickets, owls: small creatures found in every land. |

**Keywords.** Only the cat-flavoured ones change.

| Now | Proposed |
|---|---|
| Zoomies | **Swift** |
| Pounce (the reaction window) | **Ambush** |
| Hello: / Goodbye: | keep (friendly, not cat-specific) |
| Guardian, Sneaky, Fierce, Tough, Lucky | keep |

**Screens and extras**

| Now | Proposed |
|---|---|
| Difficulty Kitten / Cat / Tiger | **Young / Wise / Ancient** |
| Pawtraits (fruit-cat avatars) | **Portraits**, redrawn as folk creatures over time |
| Paw icon for Power | a **claw** mark (heart for Health stays) |
| Emotes Meow! / Purr… / Hiss! | **Hello!** / **Well played** / **Boo!** |
| Meows in the hit sounds | new sounds without meows |
| Home screen cats, Tutorial and Documentation art, card back, playmat | redrawn in the Domowiki style |
| Tutorial "it's having a nap" | "it's getting its bearings" |

**The name.** "Fruitcats" and its tagline ("a cozy card game of fruit-hooded cats") no longer fit. The name is the
owner's call. Only the player-facing name has to change: the web address and the code names can stay.

## How to build it without breaking anything

- **Change only what players read:** rules text, the rulebook, the tutorial, buttons, captions and card frames.
  Keep the code's names (`treats`, `pantry`, `yarn`, `kitten`, `bigCat`, `'Hero Cat'`) as they are. Those names
  are in saved games, the online protocol, the golden games and every hero's art files, so renaming them would break
  games in progress for no gain to players.
- **Two things read text** and must change together with it. The sounds and the tutorial find events by matching the
  engine's log lines ("POUNCES with", "Hit!"), so rewording those lines means updating those matches in the same
  change.
- **In three steps**, each shippable on its own:
  1. Rules words and the rulebook.
  2. Screens, the tutorial and card frames.
  3. The art: home screen, avatars, card back, sounds.
- **The old Starter Box cards** keep their fruit-cat art. They're in the Store, free, for as long as they're offered.
