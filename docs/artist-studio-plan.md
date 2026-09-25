# Artist Studio

A website where the artists who draw Fruitcats cards do their work with us. It shows them what to draw next,
takes each picture they upload, shows it on the real card straight away, and keeps track of what's done.

Status, 2026-09-24: built (phases S1 to S3 below). The helper chat (S4) is still to come.

The Studio is at **https://playtest.fruitcats.viamochi.com/studio.html**. It lives on the playtest site because
that is where Via Mochi sign-in is allowed.

## Why

Artists today would get a long guide ([artist-guide.md](artist-guide.md)) and an art brief per set, then
imagine how each picture will look on a card and email files back. The Studio replaces the reading and the
imagining with a guided flow: one step at a time, their own picture on the real card, and a progress bar.
The guide stays, as the reference behind the Studio's short in-page tips.

## What the artist sees

- **Home: the set they're working on.** A progress bar and the next step. The artist starts with the
  set's cards sold on their own, not the deck, because each one stands alone and the deck is a much
  bigger job:
  1. the Foil single, then the Gold single, then the Signature card (a Hero Cat, so two pictures), one at
     a time. Each is sketched, commented on, finished and approved before the next one opens, so the
     artist learns what we like on a few cards first.
  2. then the deck: its Hero Cat's two pictures first, then the rest in small batches.
  3. then Pawtraits.

  The order comes from the set's `brief.json`, so it can differ from set to set.
- **A card page for each picture.** It shows:
  - the brief for that card: what to draw, what must not change, the style (painted or sticker), the tier
    (deck card, Foil, Gold or Signature)
  - an upload box
  - their picture on the real card, in every finish the card is sold in
  - their picture small, as the game shows it on the board and as a hero portrait (these crop the sides)
  - their picture as a wallpaper on a phone, a tablet and a computer, with the lock-screen clock drawn on
  - automatic checks: size (1536 × 1024, or 512 × 512 for a Pawtrait), shape and format
  - the picture's status: *with us*, *changes asked*, *sketch approved* or *approved*
  - comments (see below)
  - every earlier version, so nothing they've sent is ever gone
- **Comments.** Each picture has a comment thread, and each comment belongs to one version of the
  picture. A comment can point at a spot on the picture (a pin), for example "the star is cut off here".
  Every comment shows who wrote it, and comments written by an AI agent are clearly labelled as AI, apart
  from comments by the owner. The artist can reply and mark a comment as done. The Studio shows new
  comments on the home page, so the artist sees them without searching.
- **Suggestions.** On fields the game doesn't depend on (most names and flavour text), the artist can
  propose a change, and we accept or decline it. The brief marks which fields are open.
- **Later: a helper chat** beside the work, which answers questions from the guide and the brief.

Desktop browsers only. It's not in the iPad app.

## What we see

The same site, with an owner role: every artist's uploads as they arrive, comments, a button to approve a
picture or ask for changes, and the name suggestions.

**Agents too.** A Claude session on the owner's computer can follow the work with a local command:

- `npm run studio -- status <set>`: what's new since last time (uploads, replies)
- `npm run studio -- get <set> <picture>`: download a version to look at it
- `npm run studio -- comment <set> <picture> "<text>" [--at x,y]`: post a comment, labelled as AI

The command signs in with an agent key kept on the owner's computer (like the deploy certificate), which
may read everything and write comments, but can't approve pictures. Only the owner approves. Approved pictures come into the repo with a
local script, `npm run studio -- pull <set>`, which copies the approved version of each picture into
`content/<yyyy>/<mm>/<set>/art/illustrations/` and runs `tools/compose_cards.py`. Nothing deploys itself.

## Keeping the artist's work safe

- Artists keep working in their own folders. The Studio holds copies, so a bug on our side can always be
  fixed by uploading again.
- Uploads are never overwritten or deleted. Each upload is stored under a new name
  (`<set>/<card>/<time>-<hash>.webp`), and the card shows the latest.
- An upload counts as done only after the server has stored it and read its hash back. The preview shows
  the stored file, not the one in the browser.
- The pictures are in a storage account that keeps deleted blobs for 14 days, separate from the site's code,
  so a bad deploy can't touch them.
- If uploads ever misbehave, the card previews still work on a file the artist picks from their own
  computer, without uploading it. They can keep working and email us the files.

## How it's built

**Card previews without a second renderer.** Cards are drawn by `tools/compose_cards.py`, not in the
browser. It gets a `--frames` option that draws each card with a see-through window where the picture goes
(`ART_BOX`, 666 × 444) and saves it with transparency, for every finish. The site publishes them next to
the finished cards (`/cards/<set>/frames/<id>.webp`). The Studio puts the artist's picture behind the frame,
so the border, rounded corners and Lucky clover sit on top exactly as on the real card. The board, hero and
wallpaper views copy the few size rules the game uses (`apps/web/src/style.css` `.unit`, `.hero`;
`apps/web/src/wallpaper.ts`).

**Brief as data.** Each set gets `content/<yyyy>/<mm>/<set>/art/brief.json`: for each picture, the file
name, what to draw, what must stay, style, tier, milestone, Pawtrait, and which fields are open to
suggestions. The Markdown brief (`docs/art-brief-<set>.md`) can be generated from it. `npm run check-set`
checks that every card has a brief entry.

**The site.** A new page in `apps/web` (`studio.html`, its own entry in `vite.config.ts`), styled like the
game. It's published with the rest of the site; the page itself holds nothing private.

**Sign-in.** Via Mochi accounts (`apps/web/src/auth.ts`): the artist signs up as a player does, with an
emailed code. An invite link from the owner adds their account to a set.

**Server.** New routes in the game's API (`apps/api`, the `fruitcats-api` App Service), which already checks
Via Mochi tokens:

| Route | What it does |
|---|---|
| `GET /v1/studio/me` | who you are: your role (owner, artist or agent) and your sets |
| `POST /v1/studio/invites/<code>` | accept an invite link |
| `GET /v1/studio/<set>` | each picture's state and versions, the comments and suggestions |
| `POST /v1/studio/<set>/pictures/<picture>` | upload a new version (format and size read on the server) |
| `GET /v1/studio/<set>/pictures/<picture>/<version>` | a stored version |
| `POST /v1/studio/<set>/pictures/<picture>/comments` | add a comment or reply; the server labels it owner, artist or AI from the sign-in |
| `POST /v1/studio/<set>/pictures/<picture>/review` | owner only: sketch approved, approved, or ask for changes |
| `GET /v1/studio/<set>/changes?since=<time>` | what's new, for agents |
| `POST /v1/studio/<set>/suggestions` | propose a new name or flavour text; the owner accepts or declines |
| `GET`, `POST`, `DELETE /v1/studio/<set>/artists`, `/invites` | owner only: the set's artists and invite links |

The full list is at the top of `apps/api/src/studio/studio.ts`. Storage: one table and one blob container, both
called `studio`, in the `fruitcatsdata` account, reached with the API's managed identity.

## Phases

| # | Phase | Result | Depends on |
|---|---|---|---|
| S1 | Preview studio | Frames with a see-through window; `brief.json` for Berry Picnic; the Studio page with the guided steps, card previews and checks, working on files the artist picks (no sign-in, no upload) | nothing |
| S2 | Sign-in and uploads | Via Mochi sign-in, artist list, uploads kept as versions, previews from stored files | the accounts branch merged and deployed |
| S3 | Comments and review | Comment threads with pins and AI labels, the agent command (`status`, `get`, `comment`), approve / ask for changes, progress, suggestions, `npm run studio -- pull` | S2 |
| S4 | Helper chat | A chat beside the work that answers from the guide and brief | S3 |

S1 is useful by itself: an artist can already follow the steps and see their pictures on cards, and email
the files as the guide says today.

## Working with the other sessions

- **Artist guide:** owns the guide and the briefs. The Studio needs the brief as `brief.json`; the guide
  gets a short section pointing to the Studio.
- **Accounts:** owns sign-in and `apps/api`. S2 adds routes there after the accounts work is merged.

## Running it

**On this computer.** Start the Studio's API with its data in `.studio-dev/`, and the site:

```bash
npm run studio:dev -w @fruitcats/api
```

```bash
npm run dev
```

Then open `http://localhost:5173/studio.html?dev`. With `?dev`, sign-in is a list of pretend accounts: an owner, an
artist and someone not invited. The agent command works against it with `--dev` (its key is `dev-agent`).

**Setting up the real one.** The API needs three app settings on `fruitcats-api`:

| Setting | What it is |
|---|---|
| `STUDIO_OWNERS` | The owner's Via Mochi account id (32 hex characters). The Studio shows it to a signed-in account that isn't invited yet. |
| `STUDIO_AGENTS` | One `Name:sha256` per agent, comma-separated. `npm run studio -- key Claude` makes a key, keeps it in `~/.fruitcats-studio/agent.key` and prints the line. |
| `STUDIO_URL` | Where invite links point. Default: `https://playtest.fruitcats.viamochi.com/studio.html`. |

The API makes its table (`studio`) and blob container (`studio`) in `fruitcatsdata` when it starts. The storage
account keeps deleted blobs for 14 days, and the Studio never deletes or overwrites a picture.

**Inviting an artist.** Sign in as the owner, open the set, choose **Artists**, and make an invite link. Send it to
the artist. They open it, create their Via Mochi account (or sign in), and see the set. A link works once and lasts
30 days.

**Adding a set.** A set appears in the Studio when its folder has `art/brief.json`. Then draw its frames:
`python tools/compose_cards.py --set <code> --frames`. `npm run check-set` checks the brief.

**When pictures are approved.** `npm run studio -- pull <set>` copies each approved picture into the set's folder
(Pawtraits into `art/avatars/`, key art into `announcement/`) and composes the cards. Review the result with `git
diff`, then commit and deploy as usual.

**Studio Practice (SP1)** is a pretend set for trying the Studio. It isn't in `content/index.ts`, so the game, the
bots and `check-set` never load it.
