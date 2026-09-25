# Mochi (MC1-X01): playtest notes

Mochi, the Sweet Spirit is a Garden Cat meant to fit any deck. To test that, each deck gives up one Pocket Hamster
(SB1-G01) for Mochi, and the bots play the changed deck and the unchanged deck against the three starter decks.

    npm run balance -- --quick --scale 4 --deck <every file in this folder, comma-separated>

The `orig-*.json` files are the decks as they are; the `mochi-*.json` files swap one Pocket Hamster for Mochi.

## 2026-09-25

Win rate against the starter decks:

| Deck | Unchanged | Mochi, 3/5 (scale 2) | Mochi, 3/4 (scale 4) |
|---|---|---|---|
| Zest Rush (Sunny) | 48–49% | 53% | 52% |
| Orchard Guard (Pippin) | 48–49% | 59% | 55% |
| Mango Tango (Tango) | 50% | 53% | 52% |
| Five Alarm (Heat Wave) | 48–51% | 53% | 49% |
| Picnic Club (Berry Picnic) | 60–61% | 67% | 66% |

With Health 5, Guardian and Orchard's healing made it too strong there (+11). Health 4 keeps it a card every deck
wants (+1 to +6) without taking over. Kept: cost 4, 3/4, Guardian, Lucky, Hello: draw a card, Goodbye: ready two
of your Treats.
