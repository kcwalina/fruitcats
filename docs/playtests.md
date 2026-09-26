# The playtest dashboard

The playtest dashboard shows the owner every automated playtest run and the health of the Via Mochi services, and
lets them queue new runs. It is at **https://fruitcats.viamochi.com/playtests.html**. Only the owner's Via Mochi
account can open it: sign in on the site's Account page first.

It runs without any Claude session. Before 2026-09-26 it was a claude.ai artifact, and a Claude Code task on the
laptop copied data in and out of it every 10 minutes. That relay is gone, and so is the Claude health watch that
ran every 20 minutes.

## How it works

Three pieces, and only one of them lives at home:

- **The page** (`apps/web/playtests.html`, `apps/web/src/playtests/`) is part of the game's website. It asks the
  Fruitcats API for everything every 20 seconds while it's open.
- **The Fruitcats API** (`apps/api/src/playtests/`) keeps the runs, the requests, the deck names and the Accounts
  tab's numbers in the `playtests` blob container of `fruitcatsdata`. Every 10 minutes it works out the Accounts tab
  from both services' logs itself (`ops.ts`).
- **PC2024's playtester** (`playtest/paw/DashboardSync.cs`) calls the API every 30 seconds. It sends new runs and the
  progress of running ones, asks for a queued run when it's free and starts it, and once an hour sends the deck,
  persona and library names the page shows.

The API never calls PC2024. When PC2024 is off or asleep, the page still works. The header says when PC2024 last
checked in, and queued runs wait until it's back.

```
fruitcats.viamochi.com/playtests.html  ──(owner's sign-in)──▶  api.fruitcats.viamochi.com/v1/playtests
                                                                    ▲
PC2024 mochi-playtester  ──(runner key, outbound only)──────────────┘
```

## Who may do what

| Caller | How it proves it | What it may do |
|---|---|---|
| The owner | A Via Mochi token for an account in `PLAYTEST_OWNERS` (falls back to `STUDIO_OWNERS`) | Read everything, queue runs, cancel queued runs |
| PC2024 | `Bearer runner-<key>`, where the key's SHA-256 is in `PLAYTEST_RUNNERS` | Send runs and the deck names, take queued runs, send the deck library, get the Fireworks key for a deck build |
| Anyone | Nothing | Read the deck library (`GET /v1/playtests/library`): decks aren't secret, and every runner reads it |

The API checks every request again before it hands it to PC2024. The rules are the same as the old relay's: only
the known commands, plain arguments, and deck builds only with Kimi K3 capped at $1.

PC2024 made its key itself the first time the new playtester started (`~/.mochi/playtester.key` on PC2024). Its
`/health` shows the line to put in `PLAYTEST_RUNNERS`: `PC2024:<sha256>`. The line isn't secret. To replace the key,
delete the file, restart the playtester, and put the new line in the setting.

## The deck library's night

Every evening at 22:00 (`LibraryNightHour` in `~/.mochi/playtester.json`), PC2024 runs `decks nightly --here`:

1. The published library becomes tonight's working copy, and good decks from recent deck builds and hunts join it.
2. Kimi K3 builds one deck. The API supplies the Fireworks key for this run only, and the run stops at $0.50.
3. Every library deck is measured, and the retention policy applies.
4. PC2024 sends the library to the API, which keeps it. Every run reads it from
   `https://api.fruitcats.viamochi.com/v1/playtests/library` when it starts.

That published copy is the library. `playtest/decks/library.json` in the repo is only the fallback bundled into the
runner, for when the API can't be reached. Until PC2024's first library night, the API serves the copy that was
published before (`fruitcatspacks/packs/playtest/decks.json`).

## When something is wrong

- **"PC2024 last checked in … ago"**: PC2024 is off, asleep or can't reach the internet, or the playtester has
  stopped. Check `http://192.168.1.74:5280/api/processes`. The playtester's `/health` (through catsitter's forward
  route) has a `dashboard` section with the last error.
- **The Accounts tab says its data is old**: the API's snapshot failed. Look for `ops.snapshot_failed` with
  `node tools/ops.mjs events --grep snapshot --since 1h`.
- **The Accounts tab says some logs couldn't be read**: the API's identity lacks read access to that service's logs.
  `scripts/setup/playtests-api-access.ps1` grants it (the owner runs it once).
- **A service is down**: Azure emails the owner (see below). You don't need to watch the page for this.

## Health alerts

Azure watches `viamochi-id` and `fruitcats-api` itself; no Claude session is involved:

- Each App Service has a **health check** on `/healthz`, which App Service calls every minute. It replaces an
  instance that keeps failing it.
- An **availability alert** on each service's health-check status emails the owner when a service stops answering,
  and again when it recovers.

The setup is in `scripts/setup/health-alerts.ps1`.
