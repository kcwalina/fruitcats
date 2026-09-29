# Playtesting

Automated playtesting for Fruitcats, so a broken deck is found by a machine before a playtester finds it.
It exists because Zest Rush once shipped winning 14% against Orchard Guard while the simulator already
knew: nothing made anyone look. Now a bad starter deck **blocks the deploy**, a nightly run looks further
than the starter decks, and LLM players look for what the bots can't.

| Command | What it does | Time |
|---|---|---|
| `npm run balance:check` | Starter decks against each other, 300 games a pair. The deploy gate. | ~20 s |
| `npm run balance` | The full bot gauntlet: starters, random decks for every Hero Cat and partner family, starters with cards swapped, bot sanity check, then removal tests for the cards that look strongest (see below). `--scale N` for more games, `--deck DECK` or `--library` to add custom decks (see below). | ~40 min on the laptop (86,000 games; `--scale` multiplies it) |
| `npm run deploy` | Type-check, tests, the balance check, engine check, build, bundle check, upload, live check. `--dry-run` stops before the upload; `--force-balance` deploys past a blocking balance problem (say why). | ~1 min |
| `npm run play -- new` / `do <n>` / `show` | A game against the bot, one decision per command: for a Claude Code session doing a deep playtest, or for you. `--deck`, `--vs` take any deck (see below). | — |
| `npm run llm-playtest` | LLM players (`--persona exploit\|aggro\|newcomer\|all`) against the bot, each game with a transcript and a playtester report. `--deck`, `--vs` take lists of decks. `--bench` times a provider's models first. | 3–4 min a game on PC2024 |
| `npm run deck-hunt` | An LLM designs decks meant to break the game; the bots play each against the starters. | ~2 min |
| `npm run deck-build -- --goal …` | An LLM builds a deck for a goal ("an aggressive Pari deck", "beat the Aluxes", "a fun deck for a beginner"): candidates, bot games, better versions, then its pick. `--hero`, `--vs`, `--save`. | ~2 min |
| `npm run decks -- list` / `show` / `add` / `import` | The deck library: custom decks playtests can name by key. | — |
| `npm run nightly` | All of it, unattended: full gauntlet (with the library decks), deck hunt, LLM games with custom decks and then the starters until the time is up, and what changed since the last run. | a night |

**Which cards playtests use.** Only the sets listed in `playtest.config.json` under `sets.play` are loaded: today
Domowiki, Pari, Aluxes and Jiaoren (DW1, PR1, AL1, JR1). Their decks are the starter decks every gauntlet and the deploy gate test,
and their cards are the only ones random, changed and LLM-built decks may use. The Starter Box (taken out of the game on
2026-09-29) and the older prototypes are retired; a library deck built from their cards can't be played and the next
library night removes it. Add a new set's code to the list when it joins.

Every run writes `reports/<kind>-<date>/summary.json` and `report.md` (git-ignored) and ends **pass**,
**warn** or **block**. The limits are in `balance.config.json`: a starter deck outside 40–60% overall, or
below 30% against another starter, blocks; outside 45–55% warns, as do cards worth more than 10 points of
their deck's win rate (below), and generated decks that beat the starters.

## How strong is a card

A card is too strong when its deck leans on it: take it out and the deck wins much less. The full run measures
exactly that, for the few cards most likely to be too strong:

1. **The screen** (`stats.ts` `cardImpact`) picks the candidates. For every game a deck played a card in, it
   compares the result with the deck's win rate in the games that were still going in the round the card first came
   down. The old measure compared it with the deck's rate over all games, and that rewards late cards: an 8-cost
   card is only played in long games the player was already surviving. It had Elder of the South Sea at +23
   points, Dvorovoi +13, Quanxian +12 and Dragon Silk +10, while taking each out of its deck costs 6–8, 2–6, 5–6
   and 2.5–3.5 points (the removal tests of 2026-09-29 and the first run of this one). The new screen puts them at
   +13, +12, +10 and +7; the report shows both numbers. Some bias remains (affording an 8-cost card early says the game
   is going well), so the screen never warns about a starter's card itself.
2. **The removal test** (`removal.ts`) takes the top `removalCandidates` (4) cards out of their starter deck,
   every copy replaced by the deck's plain 1-cost 2/1 (Hearth Cricket, Ibex Kid, the Alux's Dog, Ice Silkworm,
   Pebble-Thrower), and plays it against the other starters, `removalGamesPerPair` (800) games a pairing, times
   `--scale`. The games use the starters' own seeds and seats, so each is compared with the same game with the
   card and some of the luck cancels. The ± in the report is two standard errors: about 2 points at scale 1, 1.2
   at the nightly's scale 3. The swap is
   made in the deck list, never to the card, so no card changes in any worker.
3. It **warns** when a card is worth more than `cardWorth` (10 points) to its deck. For scale: the strongest
   cards measured so far are Elder of the South Sea (6–8), Quanxian (5–6.5) and The House Snake (6), strong cards
   doing their job that Jiaoren and Domowiki need, and each Hero's ability is worth about 7. Above 10, one card
   carries its deck; a lower line would warn about Elder some nights and not others, from noise alone.

A card no starter deck holds can't be removal-tested; for those the screen warns at 10 points (`cardDelta`).
The tests add about 15% to the full run's games (12,800 at scale 1).

## Custom decks

Playtests aren't limited to the starter decks. Wherever a command takes a deck, it takes any of these:

- a starter's key (`domowiki`) or a prototype set's deck key
- a **library** key: `playtest/decks/library.json` keeps custom decks with a name, where they came from and
  what they're for. `npm run decks -- list` shows them.
- a **deck code**: a whole deck on one line, `FC1.Name.Hero.card…` (for example
  `FC1.Domowiki.DW1-H01.DW1-D01x3.DW1-D02x3…`). The game's deck builder copies one ("Copy deck code") and
  takes one ("Deck from a code"); reports print one for every deck they build or find.
- a DeckList JSON file, or `starters` / `library` for all of either. Lists are written with commas.

Every deck is checked with the deck builder's own rules, so a playtest only plays decks a player could build.

**Building a deck with an LLM.** `npm run deck-build -- --goal "…"` asks for a few decks, has the bots play
each, shows the model the results and asks for better versions, then lets it pick the one that fits the goal.
The model names the Hero Cat and the cards it wants; the builder makes that a legal 50-card deck (unknown cards
out, one partner family, copies capped, trimmed or topped up) and the report says what it changed. A deck the
model chose fewer than 30 of its cards for is turned down. PC2024's gpt-oss is free but poor at this; for a
deck worth keeping use Kimi K3: the dashboard's "Build a deck" runs it on PC2024 with the Fireworks key the API
hands that run, or run `npm run deck-build -- --provider fireworks-k3 --goal "…" --save` in a checkout that has
the key. It stops at `--max-usd` (default $1). The nightly run itself never uses a paid model.

**One new deck a night, and a library that stays playable.** `decks nightly --here` (PC2024 runs it each
evening at 22:00, docs/playtests.md) has Kimi K3 build one deck (about $0.10, never over $0.50), for a goal that rotates
around the Hero Cat the library has fewest decks for; measures every library deck against the starters in bot
games with that night's cards; and applies the retention policy (`decks/retention.ts`, numbers in
`playtest.config.json` under `library`):

- a new deck has 14 days' grace;
- after that, a deck averaging under 35% against the starters goes, however much room there is;
- a deck averaging 60% or more is a keeper and stays indefinitely;
- the library holds at most 40 decks; above that the lowest score goes first: the deck's recent average win
  rate, less 2 points a month of age. Keepers go only when keepers alone fill it; pinned decks
  (`decks pin KEY`; a deck added by hand is pinned) never go.

LLM playtest results are recorded with each deck (`decks list`) but don't decide: the LLM player wins about
one game in five with any deck. `decks prune --dry-run` shows what the policy would do now. The library is
published next to the card packs, and PC2024's runner takes that copy when it starts, so tonight's deck is
played tonight (the nightly always includes the newest library deck).

Decks get into the library three ways: `npm run decks -- add --code FC1.… --name …` for a deck someone made;
`npm run decks -- import [--pc2024 http://192.168.1.74:5280]` for deck-hunt decks that beat the starters 55% of
the time and the picks of deck builds, from this checkout's reports and PC2024's; and
`npm run deck-build -- --goal … --save`. Commit `library.json` and deploy: the runner PC2024 downloads carries
the library. A deck that isn't in the deployed library yet travels as its deck code, which is what the
dashboard passes when a run is started with a custom deck.

The nightly run plays custom decks too: the library decks join the bot gauntlet against the starters, and
`customShare` (in `playtest.config.json`) of the LLM time goes to custom decks: that night's two best hunted
decks, two library decks, a random deck and a starter with 8 cards swapped, each against every starter. Custom
decks never block a deploy: the deploy gate is still the starter decks alone.

**Trying a card change before making it.** `PLAYTEST_CARD_MODS` overrides card fields for one run, in every
worker: `PLAYTEST_CARD_MODS='{"DW1-D05":{"health":2},"DW1-D10":{"cost":3}}' npm run balance:check` measures a
2/2 Ovinnik of the Drying Barn and a cost-3 A Domowik's Temper without touching a set. Never set it for a deploy.

## LLM providers

`playtest.config.json` names them; all speak the OpenAI chat API, and keys come from environment variables.

- `pc2024` / `pc2024-lan`: Ollama on PC2024 (port 11434), gpt-oss:20b. Free. Ollama is not a catsitter GPU tenant, so the image generator must be off the card while it plays.
- `pc2024-jarvis`: JarvisEvo through mochi-jarvis (take its GPU lease first). Answers, but plays poorly: a photo-retouching model.
- `fireworks`: set `FIREWORKS_API_KEY` (or keep it in mworks' secret store as `fireworks`). About $0.03–0.08 a game on gpt-oss-120b or DeepSeek.
- `fireworks-k3`: Kimi K3 on Fireworks, same key. For deck building only (see below): about $0.10–0.40 a build.
- `azure`: Azure Foundry; set `AZURE_FOUNDRY_ENDPOINT` and `AZURE_FOUNDRY_KEY`.
- `fake`: answers at random. Tries the whole pipeline without a model or a bill.

## The nightly run on PC2024

`paw/` is `mochi-playtester`, a catsitter paw deployed to PC2024 like any kitten (`/deploy-kittens` from
the mochi repo, or `paw/package.ps1`; it builds against mochi's paw SDK at `C:\git\mochi`, or `MOCHI_REPO`).
It runs the Node installed on PC2024 (PATH, then `Program Files\nodejs`); `GET /health` says which, or that none
was found (then `package.ps1 -BundleNode` ships one). Every night from midnight it downloads the runner that `npm run deploy`
publishes next to the game (`/playtest/runner.mjs`, so it always tests the live cards) and runs
`nightly` for up to 6 hours. Settings are in `~/.mochi/playtester.json` on PC2024; runs stay in
`%LOCALAPPDATA%\mochi.playtester\runs` and are served through catsitter:

- `GET /health`: running or not, the last run, the next one
- `POST /run {"command": "nightly"}`: start one now
- `GET /runs`, `POST /runs/get {"id"}`: the runs and their reports

## The dashboard

[fruitcats.viamochi.com/portal.html](https://fruitcats.viamochi.com/portal.html) (the owner's account only;
source in `apps/web/portal.html`, data in the Fruitcats API, docs/playtests.md) shows every run: the latest starter win rates against the target band,
issues flagged more than once, the win rates over time, runs in progress, each run's report, and the custom
decks (the library and what recent deck hunts and deck builds found). Its "Start a run" form queues custom runs,
including LLM playtests and bot gauntlets with custom decks and "Build a deck". PC2024's playtester sends its runs
to the API and takes queued runs from it every 30 seconds; the API never calls PC2024, so the page works when it's off.
