# Friend games and Ranked: the plan

How two people play each other online: first **Friend** games, then **Ranked** (a queue that pairs you with someone
near your rating). Both are built on one shared **match** system; Friend and Ranked are only two ways into it. The
background (hidden information, why the server holds the game) is in [future-plans.md](future-plans.md#1-pvp);
accounts and friends are in [accounts.md](accounts.md).

Last updated 2026-09-25.

## Decisions

| Topic | Decision |
|---|---|
| **Who holds the game** | The Fruitcats API. It runs the same engine, keeps the full `GameState`, and sends each player only `viewFor(state, seat)`. Clients send actions; the server checks them with `legalActions` and applies them. Nothing a client says about the game is trusted. |
| **One match system** | Friend games and Ranked share everything from "two players and two decks are known" onwards: the match, clock, reconnecting, conceding, emotes, the result, replays. They differ only in how the two players are found and what happens after (head-to-head record, or a rating change). |
| **Transport** | One WebSocket per signed-in app, opened at sign-in and kept while the app is open. It carries presence, challenges, the Ranked queue and the match. Not one socket per feature. |
| **Where Friends lives** | On the Home screen's **Friend** tile, as a full screen like Solo. It comes out of Settings → Account. The Account panel keeps one row that opens the same screen. |
| **Challenges** | Only to friends who are online now. No challenges to offline friends in the first version (no push notifications yet). |
| **Decks** | Same rule for Friend and Ranked: a finished 50-card deck made of cards you own. The server checks it with the Store's ownership, the check Ranked needs anyway. One rule, one check. |
| **Clock** | Every online game has a clock, with the same code for both modes; only the numbers differ (see [The clock](#the-clock)). Without one, a player who walks away holds the other hostage. |
| **Talking** | A few cat emotes (Meow, Purr, Hiss, Good game), no typed chat. Players are 13 and up and meet strangers in Ranked. One tap mutes the other player's emotes. |
| **Pounce and Lucky** | Online, the defender is always asked, whether or not they hold a Pounce. The engine gets an option for it. |
| **Client** | The game screen draws a `PlayerView` for "my seat", whether the game is Solo or online. Solo moves to the same path, so there is one game screen, not two. |

## What's there now, and what changes

The Friends prototype (`apps/web/src/account.ts`, `renderFriends`) works (list, codes, remove, block), but:

- **It's hard to find.** Settings gear → Account → Friends. The Home screen's Friend tile, which is where people will
  look, says "Coming soon".
- **A friend can't be played.** Tapping a friend opens only Remove and Block. The main thing you'd want to do with a
  friend is missing, and the only things there are destructive.
- **Adding a friend needs both people there at once.** The code lasts 15 minutes and works once, and the Home tile
  promises "send them a link", but there is no link.
- **No presence.** You can't tell who is around to play.
- **It looks like a settings page:** a list capped at 30% of the screen height, one status line shared by every
  message, small type.

The new Friends screen replaces it. The calls to viamochi-id (`listFriends`, `newFriendCode`, `redeemFriendCode`,
`removeFriend` in `auth.ts`) stay as they are.

## The player's experience

### The flow, shared by both modes

```
 Friend:  Friends screen → Play (friend) → pick deck → Waiting for Pippin… ─┐
                                                                            ├→ Versus → Game → Result
 Ranked:  Ranked screen  → pick deck → Find a match → Looking for a player… ─┘
```

Deck picker, waiting screen, Versus splash, game and Result are the **same screens**. Friend and Ranked change a few
words on them and the buttons at the end.

### Friends screen (Home → Friend)

Signed out, the tile shows "Sign in to open", like Collection. Signed in, it opens a full screen:

1. **Challenges for you** (only when there are some), at the top: Pippin's Pawtrait, "Pippin wants to play",
   **Pick a deck** and **Not now**.
2. **Your game with Pippin · Round 4 · Rejoin**, when an online game is still going (after a refresh, or on another
   device).
3. **Your friends**, sorted online first, then in a game, then offline. Each row: Pawtrait with a status dot, name,
   one status line ("Online", "In a game", "Last seen 3 days ago") and your record against them ("You 3 – 2"). Online
   friends have a **Play** button on the row. Remove and Block move into a quiet ⋯ menu, each with a confirmation, as
   now.
4. **Add a friend**, a button at the bottom that opens a sheet:
   - **Invite link**, `fruitcats.viamochi.com/f/K7M4Q2`, with **Share** (the phone's share sheet) or **Copy**.
     Opening the link signs you in if needed and adds the friend.
   - The same code, large, for reading out, and a QR code for someone standing next to you.
   - **Have a code?** A box that formats as you type (`K7M-4Q2`) and adds as soon as the sixth character is in.
     Errors show under the box, not in a shared status line.

With no friends yet, the screen is one picture of cats and **Invite a friend**; the list isn't shown empty.

The Home tile shows a small badge with the number of challenges waiting.

### Challenging a friend

1. **Play** on Pippin's row opens the deck picker: the Solo carousel, showing only decks you can play online.
2. **Challenge Pippin** leads to the waiting screen: your Pawtrait and Pippin's facing each other, "Waiting for
   Pippin…", a 60-second ring and **Cancel**.
3. Pippin gets a banner wherever they are in the app ("Pippin wants to play", **See**). In a Solo game it's a small
   banner that doesn't pause or cover anything. Pippin picks a deck and the game starts.
4. If Pippin says **Not now**, you see "Pippin can't play right now." If the ring runs out, "No answer from
   Pippin." Either way you go back to the Friends screen.

Neither player sees the other's deck before the game. The Hero Cats are shown on the Versus splash, as they would be
on the table.

### Versus splash (shared)

Two or three seconds: both Pawtraits, names and Hero Cats, and who takes the Yarn Ball first. Ranked adds each
player's rating.

### In the game (shared)

The game screen as in Solo, with:

- **The other player's Pawtrait and name** where the computer's face is now.
- **The clock** as a ring around the Pawtrait of whoever is deciding, and their reserve in small numbers under it.
- **Emotes**: a small button beside your Pawtrait opens four cat emotes; the other player's appear as a bubble over
  their Pawtrait. A mute button is next to them.
- **Concede** in the game menu, with a confirmation.
- **Pounce and Lucky**: "Pounce? (skips in 2 s)" is always shown to the defender, with nothing to play when they
  hold no Pounce, so waiting tells the attacker nothing.
- **If someone's connection drops**: "Pippin's connection dropped. Waiting 0:47". Their clock doesn't run while they
  are gone. If they aren't back in time, they lose (see [Connection drops](#connection-drops)).

### Result (shared)

Win or lose art as in Solo, the number of rounds, and:

- **Friend:** your record against them ("You 3 – 2 Pippin"), **Rematch** and **Home**. When one player taps Rematch,
  the other sees "Pippin wants a rematch". When both tap it, a new game starts with the same decks and the other
  player takes the Yarn Ball first.
- **Ranked:** the rating change ("1,240 → 1,256 (+16)"), **Play again** (back into the queue with the same deck)
  and **Home**.

## How it's built

### Shared, and not

| Piece | Shared | Friend only | Ranked only |
|---|---|---|---|
| Socket, sign-in on the socket, reconnecting | ✓ | | |
| Presence (online, in a game, in the queue) | ✓ (Ranked uses it to show "in the queue") | shown to friends | |
| Finding the other player | | challenge and accept | queue and matchmaker |
| Deck check (finished, cards owned) | ✓ | | |
| Match: engine, views, clock, drops, concede, emotes | ✓ | | |
| Match record: seed, decks, actions, winner | ✓ | | |
| After the game | | head-to-head, rematch | rating, play again |
| Screens: deck picker, waiting, Versus, game, Result | ✓ | wording and buttons | wording and buttons |

Everything that differs between the modes sits in one small **rules** object that the match is created with. The
match code never asks which mode it's in:

```ts
interface MatchRules {
  kind: 'friend' | 'ranked';     // only for the record and the Result screen's wording
  clock: ClockRules;             // see "The clock"
  dropGraceSeconds: number;      // how long a dropped player has to come back
  rematch: boolean;              // Friend: true. Ranked: false (Play again re-queues)
}
```

### Server (`apps/api/src/live/`)

The API is already Node on App Service and imports the engine and card data, so it holds the games. New files, each
with one job:

| File | Job |
|---|---|
| `socket.ts` | The WebSocket (the small `ws` package): signs in with the same Via Mochi token the API checks now, heartbeats, and hands each message to the file below that handles it. |
| `presence.ts` | Who is connected and what they're doing. Tells each player's online friends when that changes. |
| `match.ts` | **The shared core.** `startMatch(seats, decks, rules)`: makes the game with a fresh seed, applies actions, sends each seat its view, runs the clock, handles drops, concedes and emotes, and when the game ends calls `rules.kind`'s finish (below). |
| `matches.ts` | Keeps each match's record in a `matches` table: seed, engine and content version, decks, the actions so far, and the result. The game is always rebuilt as seed + actions, so an API restart loses nothing. The same record is the replay. |
| `decks.ts` | `checkDeck(account, deck)`: 50 cards, legal, all owned (the Store's ownership code). Used by both modes. |
| `challenges.ts` | **Friend's way in.** Send, accept, decline, cancel, expire after 60 s; checks the two are friends. Ends in `startMatch`. After the game: the head-to-head record, and rematches. |
| `queue.ts` | **Ranked's way in, later.** Pairs players whose ratings are close, allowing a wider gap the longer someone waits. Ends in `startMatch`. |
| `ratings.ts` | **Ranked, later.** Glicko-2 from match results, and the ladder. |

**Checking friendship without changing viamochi-id.** When a socket signs in, the API asks viamochi-id's `/friends`
with that player's own token and keeps the list for the connection. A challenge is only accepted between two people
on each other's lists. Blocking in viamochi-id already removes the friendship, so a blocked player can't challenge.

**One instance for now.** Games live in the memory of one API instance, with the record written after every action.
App Service needs Web Sockets switched on and must stay at one instance. When there are too many players for that,
the socket moves to Azure Web PubSub; `socket.ts` is the only file that knows about the transport.

**Same version on both sides.** The client sends its build when it connects. If it isn't the build the server runs,
it's told "A new version of Fruitcats is ready" and reloads before it can play online, so both engines always agree.

### Messages

Plain JSON, one type per message.

| Client → server | Server → client |
|---|---|
| `hello { token, build }` | `welcome { you, friends: presence[] }` / `update-needed` |
| `challenge { friend, deck }`, `accept { challenge, deck }`, `decline`, `cancel` | `presence { account, status }`, `challenge { from, id }`, `challenge-ended { id, why }` |
| `queue-join { deck }`, `queue-leave` (Ranked) | `queue { waitedSeconds, range }` (Ranked) |
| `act { match, seq, action }` | `match-start { match, seat, opponent, view, clock }` |
| `emote { match, emote }`, `concede { match }`, `rejoin { match }`, `rematch { match }` | `match-view { match, seq, view, events, clock }`, `emote`, `opponent-away { back-by }`, `match-end { result }` |

`seq` is the number of actions applied so far (`GameState.actions`). An action sent for an older `seq` is refused,
so a double tap or a late message can't be applied twice.

### Client (`apps/web/src/`)

The main change is that the game screen stops knowing who the other player is.

- **`session.ts`**: one interface for "a game I'm in":
  `{ seat; view(): PlayerView; act(action): void; opponent: { name; pawtrait } }`.
  - `LocalSession` for Solo and the tutorial: holds the full `GameState` and runs the AI, as `main.ts` does now,
    and gives the screen `viewFor(state, seat)`.
  - `RemoteSession` for online games: its view comes from the server, and `act` sends to it.
- **`main.ts`**: `HUMAN` and `AI` become `session.seat` and the other seat. The screen draws only the view, so
  Solo checks the hidden-information rules every time anyone plays, well before anyone plays online.
- **`live.ts`**: the socket, kept open while signed in, reconnects with backoff, passes messages on.
- **`friends.ts`**: the Friends screen and the Add a friend sheet (out of `account.ts`).
- **`match-screens.ts`**: waiting, Versus and Result, used by both modes.
- **`ranked.ts`**, later: the Ranked screen and queue.

### Engine

- **`pounceAlways`** game option: the defender is always prompted, and `legalActions` offers only "skip" when
  there's nothing to play. The same for Lucky. Solo leaves it off.
- **A test that no view gives anything away**: play many simulated games and check that no player's view, log line or
  event names a card that player can't see. Card abilities can write their own log lines
  (`ability.log`, the log in a card's code), so this has to be a test, not a rule someone remembers.

## The clock

The same code for both modes; only the numbers change.

| | Friend | Ranked |
|---|---|---|
| Each decision | 60 s | 45 s |
| Reserve, used once the decision's time runs out | 3 min per game | 2 min per game |
| Mulligan and first Treats | 30 s | 30 s |
| Pounce / Lucky prompt | 2 s, then skipped (the defender can hold it by tapping) | same |

When both run out, the server makes the plainest legal move: pass, keep the hand, skip the Pounce, the first choice
offered. Three timeouts in a row lose the game.

## Connection drops

A player whose connection drops has **60 seconds** to come back (Ranked) or **3 minutes** (Friend); their clock
stops meanwhile. They come back by reopening the app on any device, signed in: the Home tile offers **Rejoin**. After
that, Ranked counts it as a loss. Friend asks the one still there: **Keep waiting** or **Take the win**.

## Ranked, on top of this

When the Friend version works, Ranked adds only:

- a **Ranked** screen: your rating, the deck picker, **Find a match**;
- `queue.ts` and `ratings.ts` on the server;
- the ladder;
- the rating on the Versus and Result screens.

Things Ranked needs that Friend games don't, to decide before it's built:

- **Names in front of strangers.** Display names so far are only seen by friends. Ranked shows them to anyone:
  they need the same checks as other text players write, or Ranked shows a Pawtrait and a made-up name instead.
- **Not meeting someone again.** A "don't match me with this player" list, kept by the queue.
- **Released cards only.** Prototype sets are allowed in Friend games but not in Ranked.

## Build order

Each step can be tested and shipped by itself.

1. **The client stops assuming who's who.** `session.ts`, `LocalSession`, `main.ts` drawing `PlayerView`, the
   engine's `pounceAlways` option and the no-leak test. Solo plays exactly as before. No server.
2. **The match on the server.** `socket.ts`, `match.ts`, `matches.ts`, `decks.ts`, `RemoteSession`, and the shared
   waiting, Versus and Result screens. Tried by starting a match between two browser tabs signed in as two dev
   accounts (`npm run api:local -- --fake-sign-in`).
3. **Friends.** `presence.ts`, `challenges.ts`, the Friends screen, invite links, rematch and head-to-head. The Home
   tile opens. Friends come out of Settings → Account.
4. **Ranked.** `queue.ts`, `ratings.ts`, the Ranked screen and the ladder.

## Questions for the owner

1. **Invite links.** Links are much easier to pass on than a 15-minute code. A link that works for 7 days, or until
   it's used, needs a change in viamochi-id. Worth it now, or ship with today's codes and add links later?
2. **Friend games without a clock.** The plan gives them a relaxed clock. Should friends be able to choose "No
   clock" when challenging?
3. **Decks you don't own in Friend games.** The plan uses one rule (only cards you own) for both modes. A looser
   rule for friends ("try my deck") would be fun, but means a second check.
4. **Emotes.** Four emotes, no chat: agreed?
