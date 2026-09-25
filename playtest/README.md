# Playtesting

Automated playtesting for Fruitcats, so a broken deck is found by a machine before a playtester finds it.
It exists because Zest Rush once shipped winning 14% against Orchard Guard while the simulator already
knew: nothing made anyone look. Now a bad starter deck **blocks the deploy**, a nightly run looks further
than the starter decks, and LLM players look for what the bots can't.

| Command | What it does | Time |
|---|---|---|
| `npm run balance:check` | Starter decks against each other, 300 games a pair. The deploy gate. | ~20 s |
| `npm run balance` | The full bot gauntlet: starters, random decks for every Hero Cat and partner family, starters with cards swapped, per-card impact, bot sanity check. `--scale N` for more games, `--deck DECK` or `--library` to add custom decks (see below). | ~5 min |
| `npm run deploy` | Type-check, tests, the balance check, engine check, build, bundle check, upload, live check. `--dry-run` stops before the upload; `--force-balance` deploys past a blocking balance problem (say why). | ~1 min |
| `npm run play -- new` / `do <n>` / `show` | A game against the bot, one decision per command: for a Claude Code session doing a deep playtest, or for you. `--deck`, `--vs` take any deck (see below). | — |
| `npm run llm-playtest` | LLM players (`--persona exploit\|aggro\|newcomer\|all`) against the bot, each game with a transcript and a playtester report. `--deck`, `--vs` take lists of decks. `--bench` times a provider's models first. | 3–4 min a game on PC2024 |
| `npm run deck-hunt` | An LLM designs decks meant to break the game; the bots play each against the starters. | ~2 min |
| `npm run deck-build -- --goal …` | An LLM builds a deck for a goal ("an aggressive Pepper deck", "beat Orchard Guard", "a fun deck for a beginner"): candidates, bot games, better versions, then its pick. `--hero`, `--vs`, `--save`. | ~2 min |
| `npm run decks -- list` / `show` / `add` / `import` | The deck library: custom decks playtests can name by key. | — |
| `npm run nightly` | All of it, unattended: full gauntlet (with the library decks), deck hunt, LLM games with custom decks and then the starters until the time is up, and what changed since the last run. | a night |
| `npm run reports -- pending` / `mark` | Gets finished runs ready for the dashboard, then marks them uploaded. | — |

Every run writes `reports/<kind>-<date>/summary.json` and `report.md` (git-ignored) and ends **pass**,
**warn** or **block**. The limits are in `balance.config.json`: a starter deck outside 40–60% overall, or
below 30% against another starter, blocks; outside 45–55% warns, as do cards whose decks win 10+ points
more often when they are played, and generated decks that beat the starters.

## Custom decks

Playtests aren't limited to the starter decks. Wherever a command takes a deck, it takes any of these:

- a starter's key (`zest-rush`) or a prototype set's deck key (`five-alarm`)
- a **library** key: `playtest/decks/library.json` keeps custom decks with a name, where they came from and
  what they're for. `npm run decks -- list` shows them.
- a **deck code**: a whole deck on one line, `FC1.Name.Hero.card…` (for example
  `FC1.Zest-Rush.SB1-H01.SB1-C01x3.SB1-C02x3…`). The game's deck builder copies one ("Copy deck code") and
  takes one ("Deck from a code"); reports print one for every deck they build or find.
- a DeckList JSON file, or `starters` / `library` for all of either. Lists are written with commas.

Every deck is checked with the deck builder's own rules, so a playtest only plays decks a player could build.

**Building a deck with an LLM.** `npm run deck-build -- --goal "…"` asks for a few decks, has the bots play
each, shows the model the results and asks for better versions, then lets it pick the one that fits the goal.
The model names the Hero Cat and the cards it wants; the builder makes that a legal 50-card deck (unknown cards
out, one partner family, copies capped, trimmed or topped up) and the report says what it changed. A deck the
model chose fewer than 30 of its cards for is turned down. PC2024's gpt-oss is free but poor at this; for a
deck worth keeping use Kimi K3: `npm run deck-build -- --provider fireworks-k3 --goal "…" --save`, run from
the laptop (the key is there). It stops at `--max-usd` (default $1). The nightly and the dashboard never use
a paid model.

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

[Fruitcats Playtests](https://claude.ai/artifact/JhFnXFgWz3UA3PQDGUytvG) (private; source in
`dashboard/playtests.html`) shows every uploaded run: the latest starter win rates against the target band,
issues flagged more than once, the win rates over time, runs in progress, each run's report, and the custom
decks (the library and what recent deck hunts and deck builds found). Its "Start a run" form queues custom runs,
including LLM playtests and bot gauntlets with custom decks and "Build a deck". The page can't reach PC2024 and only its owner's Claude session writes to it, so
a scheduled Claude Code task on the laptop relays both ways every 10 minutes, following `dashboard/RELAY.md`.
