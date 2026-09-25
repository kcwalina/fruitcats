# Berry Picnic (BP1): the Picnic Club deck and three single cards

A design draft for the holiday release (December 2026), drawn by Basil Leaf. The art starts now and playtesting
runs while she draws. The data is in [`content/2026/12/berry-picnic/set.json`](../content/2026/12/berry-picnic/set.json)
(status: prototype), with one plugin action in [`plugin.ts`](../content/2026/12/berry-picnic/plugin.ts). Her art
brief is [art-brief-berry-picnic.md](art-brief-berry-picnic.md), generated from
[`art/brief.json`](../content/2026/12/berry-picnic/art/brief.json).

Last updated 2026-09-24. Card rules text is generated from the card data (`npm run write-text -- bp1`); change
the data, not the text.

## What it's for

The goal is **the most interesting and desirable deck in the game**, now and later. Two judges shaped this
version: one for gameplay, one for theme and names.

- **Who it's for:** young adults, mostly young women. The Starter Box is for kids and Heat Wave is for teenage
  boys.
- **The artist:** Basil Leaf (basiilleaf), who draws fruit cats: grey-white cats with three stripes on the
  forehead, dot eyes, a ":3" mouth, pink cheeks and long whiskers, in fruit hoods. Her style is pixel-line
  doodles, washed greys with strawberry red and leaf green, and goofy expressions. The Hero Cats already follow
  this look.
- **The identity:** Picnic Club is the group chat come true. Jam made the plans, everyone brought the wrong
  snacks, Bleu is asleep on the blanket, Razz has the aux, Bramble packed plasters for everyone, the goose was
  not invited, and the ants always show up. Found family, low stakes, a little feral.
- **Holiday timing:** the deck is a picnic; the three single cards are wintry. The announcement's key art joins
  them: the club's blanket on the first snow, ants in tiny scarves.
- **The art is hers.** Names and details the rules don't depend on are open to her suggestions.

## The new family: Berry

The Starter Box reserves Berry (frame colours `#D6336C`, `#8F1D46`, `#FBDDE7`) and previews its Hero Cat, Jam
(SB1-P01). This set makes Berry real.

| Family | Personality | Plays like | Mechanic |
|---|---|---|---|
| **Berry** | Sweet, social, a little chaotic | Nobody leaves hungry: every defeated friend feeds another | **Leftovers** |

> **Leftovers** *(Berry)*: When this unit is defeated, put a Crumb on a unit you control.
>
> **Crumb:** +1 Power and +1 Health. A unit holds up to 3. A unit with 3 Crumbs is **Full**.

Why it's the best mechanic in the game so far:

- **Every trade is a decision, for both players.** Killing a Berry unit feeds another one, so the opponent has
  to ask whether a kill is worth it ("don't feed the ants").
- **Tall or wide, every time.** Crumbs can stack on one champion (a Full unit gets Sneaky from Bleu and Fierce
  from Bramble) or spread across the club. The cap of 3 turns tall back into wide.
- **Sweepers become fuel.** Ring of Fire kills three Ants, and the survivors grow.
- **It's visible.** Crumbs are counters on the board, like Heat and Ripen: nothing to remember.
- **Theme and rules are the same thing.** Ants carry crumbs to their friends; a friend who heads home passes
  their plate on.

It needs no engine change: Leftovers is a keyword mechanic with a `crumb` counter (like Heat), and "Full" is a
counter filter (`crumb` at least 3).

## Hero Cat: Jam, the Strawberry Tabby (BP1-H01, Legendary): the wide plan

| Side | Power | Text |
|---|---|---|
| **Kitten**: *Jam, Sticky Kit* | — | **Exhaust:** Put a Crumb on an exhausted unit you control.<br>**Grow Up:** You control 5 or more units. |
| **Big Cat**: *Jam, Club President* | 2 | **Exhaust:** Your units get +1 Power this round. |

*Made the plans. Made the group chat. Forgot the forks.*

- The Kitten is a sequencing test: attack first, then feed the unit that attacked, or feed one that just arrived.
- The Big Cat's party round competes with attacking with Jam.
- This replaces the Starter Box preview of Jam (SB1-P01). That preview should point to this card, or be removed,
  when BP1 is released.

## Deck: Picnic Club

| ID | Card | Type | Cost | P/H | Text | Qty |
|---|---|---|---|---|---|---|
| BP1-B01 | Lingonberry Ladybug | Critter | 1 | 1/1 | Lucky. Leftovers. | 3 |
| BP1-B02 | Salmonberry Squirrel | Critter | 1 | 1/1 | Hello: Summon an Ant. | 3 |
| BP1-B03 | Cloudberry Lamb | Critter | 2 | 2/2 | Hello: Put a Crumb on another unit you control. | 3 |
| BP1-B04 | Dewberry Possum | Critter | 2 | 1/2 | Guardian. Goodbye: Summon an Ant. | 3 |
| BP1-B05 | Gooseberry Goose | Critter | 3 | 3/2 | Hello: Exhaust an enemy unit. Take a counter from it and put it on the Goose as a Crumb. | 3 |
| BP1-B06 | Mulberry Moose | Critter | 4 | 4/4 | After Mulberry Moose defeats a unit in combat, put a Crumb on it. | 3 |
| BP1-B07 | Bilberry Alpaca | Critter | 5 | 2/4 | Guardian. Hello: Put a Crumb on each other unit you control. | 2 |
| BP1-B08 | Strawberry Milk Cow | Critter | 5 | 3/4 | Hello: Put 2 Crumbs on another unit you control. | 2 |
| BP1-B09 | Ant Parade | Trick | 2 | — | Summon two Ants. | 3 |
| BP1-B10 | Pass the Plate | Trick | 1 | — | Put a Crumb on each unit. (Yours and theirs.) | 2 |
| BP1-B11 | Second Helping | Trick | 1 | — | Pounce. Put a Crumb on a unit you control. It gets +1 Power this round. | 3 |
| BP1-B12 | Friendship Bracelet | Toy | 1 | — | Attached unit gets +1 Power and Leftovers. | 3 |
| BP1-B13 | Bleu, the Blueberry Blanket Hog | Cat | 3 | 2/3 | Hello: Put a Crumb on another unit you control. Your Full units have Sneaky. | 1 |
| BP1-B14 | Razz, the Raspberry DJ | Cat | 4 | 3/3 | Your other units get +1 Power. | 1 |
| BP1-B15 | Bramble, the Blackberry Maine Coon | Cat | 6 | 5/7 | Guardian. Your Full units have Fierce. | 1 |

**Token:** BP1-K01 **Ant**, 1/1 Critter, *Leftovers.* ("It brought friends.")

**Garden cards:** Pocket Hamster ×3, Garden Snail ×3, Mail Duck ×3, Catnip ×3, Nap Time ×2.

**Deck total:** Cats 3 · Critters 22 · Tricks 8 · Toys 3 · Garden 14 = **50**. Lucky cards: 8.

**Why each card is fun, in a line each:**
- **Ladybug** dies early and feeds a friend.
- **Squirrel** is two bodies for 1.
- **Lamb** asks "who gets the snack?" every game.
- **Possum** plays dead, and its Ant carries the crumb on.
- **Goose** steals a snack: Heat, Ripen or a Crumb.
- **Moose** grows by winning fights.
- **Alpaca** is the feast turn.
- **Milk Cow** makes a unit Full in one play.
- **Pass the Plate** is the silly social card, worth it only when you're wider.
- **Second Helping** is a Pounce that makes a unit permanently bigger.
- **Friendship Bracelet** makes your big unit leave a crumb behind.
- **Bleu** gets a Full unit past the Guardians.
- **Razz** lifts the whole club.
- **Bramble** holds the front while Full units take 2 Lives a hit.

**How to play it:** Go wide early (Squirrel, Ant Parade, Possum). Trade freely, because every loss feeds
someone. Then pick your plan for the matchup:
- **Against Guardians and healing:** grow one Full champion and send it past them with Bleu.
- **Against sweepers:** stay wide and let Leftovers rebuild.

## The three single cards

| # | Card | Rarity | Print | Price | Who buys it |
|---|---|---|---|---|---|
| 1 | Ginger, the Gingerbread Baker | Rare Garden Cat | Foil | **$1.49** | anyone: Garden fits every deck |
| 2 | Satsuma, the Snowflake Skater | Legendary Citrus Cat | Gold | **$4.99** | Zest Rush players |
| 3 | Noelle, the Cranberry Forest Cat | Legendary Hero Cat (Berry) | Signature | **$19.99** | Picnic Club players: the tall plan |

- **Ginger** (BP1-X01): cost 2, 2/3. *Lucky. Goodbye: Draw a card.* It's a surprise when it turns up as a lost
  Life, and it leaves a card behind. *Iced every cookie with a :3.*
- **Satsuma** (BP1-X02): cost 4, 4/3. *Zoomies. Hello, Zest: Deal 2 damage to an enemy unit.* A gift for Zest
  Rush, the weakest Starter deck. *Three spins, one landing, zero regrets.* It's renamed from Clementine, which is
  already a Citrus Cat.
- **Noelle** (BP1-X03, Signature):

| Side | Power | Text |
|---|---|---|
| **Kitten**: *Noelle, Snowy Kit* | — | **Exhaust:** Put a Crumb on a unit you control that has a Crumb.<br>**Grow Up:** A unit you control is Full. |
| **Big Cat**: *Noelle, Snow Day* | 2 | **Exhaust:** Ready a Full unit you control. |

*First snow. First to the party.* Jam is the whole party; Noelle is the favourite guest. One pampered champion
attacks twice a round.

## Rules notes

- **Leftovers** triggers on "defeated", not when a unit is sent back to its owner's hand. With no other unit to
  feed, the Crumb is lost.
- **Crumbs past 3** are lost. Put them on another unit instead.
- **The Goose takes 1 from the target's biggest counter** (a Crumb, Ripen or Heat). Taking a Crumb or a Ripen
  point lowers the unit's Health, so it can defeat a damaged unit. Ripen regrows at the next round start, and Heat
  the next time the unit survives damage; a stolen Crumb stays stolen. If the target has no counters, the Goose
  just exhausts it.
- **Pass the Plate** feeds the opponent's units too, including Leftovers they don't have.

## Balance so far (bots, 60 games against each Starter deck)

| Deck | Overall | vs Zest Rush | vs Orchard Guard | vs Mango Tango |
|---|---|---|---|---|
| Picnic Club (Jam) | 63% | 65% | 60% | 65% |
| Picnic Club (Noelle) | 53% | 57% | 42% | 62% |

The first draft (Picnic, a bonus with 3+ units) won 50% but lost Orchard 36% to 64%, and it had only one plan.
This version has two plans and no lopsided matchup. A 40-game smoke run had no errors: 390 Crumbs, 88 Full units
and 7 Goose steals.

**Knobs for playtesting, in order:**
1. **If Jam stays above 56%:** Razz becomes "Your units with a Crumb get +1 Power."
2. **Crumb cap:** 3 becomes 2.
3. **Feasts:** the Alpaca feeds only units with no Crumbs, or costs 6.
4. **Noelle:** Grow Up needs a Full unit *and* 4 units, or the Cow puts 1 Crumb.

## What it needs built

**Wait until the cards are final with Basil.** She may change cards (for example, the Goose may not steal), and an
engine feature built for a card that changes would never be used.

- **Done:** the Goose's `stealCounter` action (plugin, about 20 lines). Delete it if the Goose changes.
- **Later, once the cards are final**, small engine additions that would make it feel better:
  - an `emit` on `PluginContext`, so the Goose's steal animates
  - place a Leftovers Crumb automatically when there's only one legal target
  - a "Full!" moment when a unit reaches 3 Crumbs
  - a check in `check-set` that a card face has at most one `exhaust` ability. Only the first one runs, which an
    earlier draft of Jam tripped over.
- **Bot:** teach it to place Crumbs well (a unit at 2 when Bleu or Bramble is out, otherwise the best ready
  attacker), in the plugin's `refineAction`. Otherwise the win rates undersell or oversell the deck.

## Art

22 card pictures (including the Ant token), 3 Pawtraits (Jam, Satsuma, Noelle) and one announcement key art:
see [the art brief](art-brief-berry-picnic.md). The order: the three singles one at a time, then Jam's two
signed main pictures, the rest of the deck in batches, Pawtraits, and the key art.

## Open questions

- **Existing characters:** the cards are new characters drawn in Basil's style. If any card should use one of
  her existing characters, agree that with her in her contract.
- **Names:** most names are placeholders she can change (see the brief). "Ant", "Leftovers", "Crumb" and "Full"
  are fixed by the rules text.
- **Jam's preview** in the Starter Box needs updating once this ships.
