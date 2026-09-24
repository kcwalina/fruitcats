# Playtesting

Automated playtesting for Fruitcats, so a broken deck is found by a machine before a playtester finds it.
It exists because Zest Rush once shipped winning 14% against Orchard Guard while the simulator already
knew: nothing made anyone look. Now a bad starter deck **blocks the deploy**, a nightly run looks further
than the starter decks, and LLM players look for what the bots can't.

| Command | What it does | Time |
|---|---|---|
| `npm run balance:check` | Starter decks against each other, 300 games a pair. The deploy gate. | ~20 s |
| `npm run balance` | The full bot gauntlet: starters, random decks for every Hero Cat and partner family, starters with cards swapped, per-card impact, bot sanity check. `--scale N` for more games, `--deck file.json` to add your own deck. | ~5 min |
| `npm run deploy` | Type-check, tests, the balance check, engine check, build, bundle check, upload, live check. `--dry-run` stops before the upload; `--force-balance` deploys past a blocking balance problem (say why). | ~1 min |
| `npm run play -- new` / `do <n>` / `show` | A game against the bot, one decision per command: for a Claude Code session doing a deep playtest, or for you. `--deck`, `--vs` take a starter key or a deck file. | — |
| `npm run llm-playtest` | LLM players (`--persona exploit\|aggro\|newcomer\|all`) against the bot, each game with a transcript and a playtester report. `--bench` times a provider's models first. | 3–4 min a game on PC2024 |
| `npm run deck-hunt` | An LLM designs decks meant to break the game; the bots play each against the starters. | ~2 min |
| `npm run nightly` | All of it, unattended: full gauntlet, deck hunt, LLM games until the time is up, and what changed since the last run. | a night |
| `npm run reports -- pending` / `mark` | Gets finished runs ready for the dashboard, then marks them uploaded. | — |

Every run writes `reports/<kind>-<date>/summary.json` and `report.md` (git-ignored) and ends **pass**,
**warn** or **block**. The limits are in `balance.config.json`: a starter deck outside 40–60% overall, or
below 30% against another starter, blocks; outside 45–55% warns, as do cards whose decks win 10+ points
more often when they are played, and generated decks that beat the starters.

## LLM providers

`playtest.config.json` names them; all speak the OpenAI chat API, and keys come from environment variables.

- `pc2024` / `pc2024-lan`: Ollama on PC2024 (port 11434), gpt-oss:20b. Free. Ollama is not a catsitter GPU tenant, so the image generator must be off the card while it plays.
- `pc2024-jarvis`: JarvisEvo through mochi-jarvis (take its GPU lease first). Answers, but plays poorly: a photo-retouching model.
- `fireworks`: set `FIREWORKS_API_KEY`. About $0.03–0.08 a game on gpt-oss-120b or DeepSeek.
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
issues flagged more than once, the win rates over time, runs in progress, and each run's report. Its "Start a
run" form queues custom runs. The page can't reach PC2024 and only its owner's Claude session writes to it, so
a scheduled Claude Code task on the laptop relays both ways every 10 minutes, following `dashboard/RELAY.md`.
