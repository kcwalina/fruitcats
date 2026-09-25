# Fruitcats — Design Notes

Why the rules are the way they are, what we borrowed, and what the playtest engine should try to break first. Companion to [rulebook.md](rulebook.md) and [starter-box-cards.md](starter-box-cards.md).

## Goals

1. **Easy to start** — teachable in 5 minutes, ≤ 2 lines of text per card, ~10 keywords.
2. **Scales to esports** — skill-rewarding, low feel-bad variance, readable for spectators, bounded match length (~10 min, Bo3 ≈ 30 min).
3. **Paper-playable, digital-first** — no hidden counters, no generated cards, no output randomness.
4. **Machine-playtestable** — deterministic effects, enumerable legal actions, every balance number isolated as data.

## What we borrowed, and why

| Mechanic | From | Problem it solves |
|---|---|---|
| Any card can be planted as a Treat, 1/round | Star Wars Unlimited, Lorcana, Flesh and Blood | Mana screw/flood — the #1 complaint about MTG. Every card has two uses, and *what to plant* is a real decision. |
| Alternating single actions | Star Wars Unlimited, Legends of Runeterra | Dead time and solitaire combo turns (Yu-Gi-Oh, Pokémon, Hearthstone). Both players are always engaged; great for streaming. |
| Yarn Ball: initiative you can *take*, otherwise alternates | SWU initiative + LoR attack token | First-player advantage. SWU's token stays put if untaken (snowballs); LoR's strictly alternates (no agency). We do both. |
| Pounce: exactly one reaction, no chains | LoR spell speeds, Yu-Gi-Oh hand traps, One Piece counters | MTG's stack is the deepest interaction system but the biggest new-player barrier; Hearthstone/Lorcana have none. Depth-1 reactions give bluffing and defence at near-zero rules cost. |
| Nine Lives → lost Life goes to hand; Lucky plays free | One Piece life/trigger, TES: Legends runes/prophecy | Snowballing (Pokémon prizes, Lorcana lore races). The most-loved comeback mechanic in the genre, and a visible score track for spectators. |
| Hero Cat always in play; Kitten → Big Cat | Flesh and Blood heroes, SWU leaders, LoR champion level-ups | LoR's own post-mortem blames weak champion identity. A guaranteed hero gives every deck a face, a per-round agency floor (Hearthstone hero power), and a mid-game arc to root for. |
| Exhaust Hero to attack *or* use ability | FAB / SWU | A small meaningful choice every round. |
| Cats as 1-copy champion units (max 6) | LoR champions, Hearthstone legendaries | Keeps cats special and the most powerful cards, caps cost-of-entry, increases game-to-game variety. |
| Attacker chooses target; Guardian redirects | Hearthstone, SWU | No blocker-declaration step; faster and simpler than MTG combat. |
| Input randomness only | Keith Burgun; Legends of Code and Magic; Artifact's failure | Output RNG makes wins and losses feel unearned, and adds noise to bot statistics. |
| Hall of Fame hero retirement | FAB Living Legend | Freshens the meta without invalidating collections (rotation) or runaway power creep (Yu-Gi-Oh). |
| Open decklists, chess clock, ladder rules = tournament rules | Lessons from Hearthstone Conquest & Snap Conquest | Pro play should be the game everyone plays. |

## Classes and signature mechanics (added after playtest feedback: "we need classes")

The fruit families were always classes (they gate deckbuilding), but players didn't *feel* them, because
all families shared the same keywords in different amounts. Each family now has one mechanic of its own,
chosen to express its personality — the Hearthstone lesson that a class should have things nobody else does:

| Family | Mechanic | Rule | Why it fits |
|---|---|---|---|
| Citrus | **Zest** | Bonus if you've already played another card this round | Fast and flashy: rewards chaining, and pairs with cheap Zoomies openers |
| Orchard | **Ripen** | +1/+1 at each Start Phase, up to +2/+2 | Patient: fruit that grows on the tree; rewards protecting units with Guardians and heals |
| Tropical | **Sprout N** / **Lush** | Put N deck cards into the Pantry as Treats / bonus at 7+ Treats | Ramp: grow the resource pile, then cash in |
| Berry *(planned)* | **Bunch** | e.g. +1 Power for each other Berry Critter you control | Swarm |
| Melon *(planned)* | **Rind X** | e.g. prevent the first X damage dealt to this unit each round | Tough control |

Simulation notes (100 games per pairing, AI vs AI): the AI initially played Zest cards as the *first* card
of a round 54% of the time, wasting the bonus; it now opens with a cheaper card when it can afford both
(31%), raising Zest triggers from 1.6 to 2.5 per game. First-pass Ripen on Pear Hedgehog (a Guardian)
pushed Orchard Guard to 73% overall, so Ripen moved off Guardians and Plum Mole went from 3/4 to 2/3.
Zest Rush then won only ~26% overall and 14% vs Orchard Guard, and a playtester found the matchup
unwinnable. Guardian-only fixes (Sneaky on Sunny's Kitten ability, Hiss! at cost 2) moved it by 2–3 points:
Zest was also losing to Mango (37%), ending games with ~11 cards it couldn't afford, and even 9-Power Zest
units didn't help while the Guardians stayed as tough. What moved it: Grapefruit Ferret gains Sneaky, Lime
Gecko costs 1, Apple Badger is 4/3 instead of 4/4, and Orchard Guard plays a third Quince Tortoise, Fig Bear
and Nap Time instead of three Garden Snails. At 500 games per pairing: Zest vs Orchard 14% → 39%; overall
Zest 26% → 41%, Orchard 66% → 52%, Mango 58% → 57%.

Mango Tango was then the strongest deck. Mango won 77% of the games in which it played Jackfruit Elephant
and 63% of those in which Mochi Grew Up (34% when she didn't). Every Mango nerf also lifts Orchard, which
Mango had been keeping in check; Mochi Growing Up at 9 Treats or a single Elephant overshot (Orchard 57–58%).
Jackfruit Elephant now costs 8 (was 7) and Coconut, Island Guardian is 4/5 (was 4/6). At 600 games per
pairing: Zest 40% → 44%, Orchard 52% → 53%, Mango 58% → 53%. **Open issue:** Zest is still the weakest deck.

2026-09-25, from the nightly playtest: Zest 44%, Orchard 58%, and Zest won only 37% against Orchard (the LLM
players lost all 54 of their Zest-vs-Orchard games). Cheap Guardian walls were the reason, not Falling Apple
(at 0 damage Orchard still won 63% of that matchup). Pear Hedgehog is now 2/2 (was 2/3) and Sour Spray
costs 1 (was 2). At 400 games per pairing: Zest 45% → 50%, Orchard 58% → 53%, Mango 48% → 48%; Zest vs
Orchard 35% → 45%. Tried and dropped: Jackfruit Elephant at cost 9 or without Fierce (it carries Mango Tango
against Orchard: uncastable, Mango fell to 24% in that matchup), Mango Smoothie without its Treat, Sanguine at
cost 4 (barely moves Zest; she wants a new ability, not a lower cost).

## What we deliberately left out

- **Lanes/arenas** (SWU, TES:L, Artifact): extra depth, but hurts readability and onboarding. Revisit as a set mechanic.
- **Stakes doubling** (Marvel Snap cube): brilliant for ladder, produces non-binary results that don't fit brackets. Possible optional ladder mode later.
- **Deck-as-life / pitch-to-bottom** (FAB): elegant but heavy for beginners.
- **Blocking from hand** (One Piece counters): Pounce + Guardian already cover defence; two defensive systems is one too many.

## Known risks — first hypotheses for the playtest engine

1. **Nine Lives may over-feed the defender.** One Piece uses 4–5 life cards; we give 9 extra cards. Watch: average hand size of the losing player, comeback rate, whether aggro is viable. Knobs: Lives count, or only odd-numbered Lives go to hand.
2. **Every hit is worth 1 Life regardless of Power**, so cheap units are the most efficient face damage. Natural brakes: planting + cheap units drains the hand, every hit gives the opponent a card, Yard cap of 6, Guardians. Watch: Berry/Citrus swarm win rates, average cost of units that deal hits. Knobs: Fierce availability, Yard cap, a "Power ≥ N to hit" rule.
3. **Big Cat attacks are risk-free** (no damage back). Watch: share of Lives removed by Hero attacks; games decided purely by who Grows Up first.
4. **Hiss! / cheap Pounce cancels** might make attacking feel bad. Watch: attacks cancelled per game, LLM-tester sentiment.
5. **Taking the Yarn early** then still Pouncing could be too cheap. Watch: how often the Yarn is taken, first-actor win rate per round. Knob: no Pounce after Taking the Yarn.
6. **First-actor advantage in round 1.** Target: 48–52% win rate for the starting Yarn holder. Knob: non-holder plants a 3rd Treat, or draws 1 extra.
7. **Grow Up conditions that may never fire** (Pippin vs. a passive opponent). Watch: % of games in which each Hero Grows Up, and the round it happens (target: 80%+, rounds 4–6).
8. **Game length.** Target: 6–9 rounds, ≤ 60 total actions, ~10 minutes human time.
9. **Stat budget** (`2×cost + 1`, keyword prices) is a guess. Use win-rate-when-drawn / when-played deltas per card to correct it.

## Metrics the harness should report

Win rate per deck and matchup matrix · starting-Yarn-holder win rate · game length (rounds, actions) · per-card win rate when drawn / played / planted · plant rate per card (cards that are *always* planted are dead designs) · Lucky trigger frequency and swing · comeback rate (winner was behind on Lives at round 4) · Grow Up rate and timing · Pounce usage and "Treats left ready" bluff rate · decisions per action and branching factor · skill differentiation (strong bot vs. weak bot margin) · LLM-persona qualitative reports (confusing rules, unfun moments, dominant lines).

Built in `playtest/` (see its README): the matchup matrix, starting-Yarn rate, game length, per-card win
rate when played, Grow Up rate and timing, cards left in hand, the strong-vs-weak bot margin, random and
mutated decks against the starters, LLM-persona reports and LLM-designed decks. Still to do: per-card
drawn/planted rates, Lucky swing, comeback rate, Pounce and bluff rates, branching factor.

The same work replaced the bot's fixed planting rule (plant to 5 Treats, or 8 for Mochi) with a general
one: plant to the priciest card, plus one spare when that costs 6 or more, plus whatever the Hero Cat's
Grow Up counts in Treats. In bot-vs-bot duels the spare Treat was worth +8 points to Orchard Guard and
nothing to the others, so with a better bot Orchard Guard measures about 58% overall rather than 53%.

## Research sources

- Mark Rosewater, *Twenty Years, Twenty Lessons* and *Lenticular Design* (magic.wizards.com)
- Keith Burgun, *Randomness and Game Design* (input vs. output randomness)
- Ben Brode, *Designing MARVEL SNAP* (GDC 2023)
- *Why Artifact Failed* (gamedeveloper.com)
- TheGamer: Riftbound producer on why Legends of Runeterra struggled (champion identity)
- FABREC, *The Genius of Flesh and Blood's Pitch System*; TCGplayer on Living Legend
- TCGplayer, *The Inkwell: Evaluating the Resource System of Disney Lorcana*
- The Fifth Trooper, *Star Wars Unlimited: Initiative and Actions*
- Kowalski & Miernik, *Summarizing Strategy Card Game AI Competition* (arXiv:2305.11814)
- de Mesentier Silva et al., *Evolving the Hearthstone Meta* (arXiv:1907.01623)
- *Can Large Language Models Master Complex Card Games?* (arXiv:2509.01328); Cardiverse (arXiv:2502.07128); RuleSmith (arXiv:2602.06232)
