# Friend games and Ranked

How two people play each other online. **Friend** games are built: two friends, each on their own device. **Ranked**
(a queue that pairs you with someone near your rating) comes next, on the same match code: Friend and Ranked are
only two ways into one match. The background (hidden information, why the server holds the game) is in
[future-plans.md](future-plans.md#1-pvp); accounts and friends are in [accounts.md](accounts.md).

Friend games are on in the **playtest build** (`npm run build:playtest`) and in dev with `?online=1`. The public
build keeps the Friend tile as "Coming soon" until they've been tried out (`ONLINE` in `apps/web/src/flags.ts`).

Last updated 2026-09-25.

## Decisions

| Topic | Decision |
|---|---|
| **Who holds the game** | The Fruitcats API. It runs the same engine, keeps the full `GameState`, and sends each player only `viewFor(state, seat)`: never the other player's hand, the deck order or the seed. A move is checked against the rules on the server before it's applied. Nothing a client says about the game is trusted. |
| **One match code for both modes** | Friend games and Ranked run on the same code once two players are paired and each has picked a deck: the match, clock, reconnecting, conceding, emotes, the result, replays. What differs is in one `MatchRules` object; the match never asks which mode it's in. This is about not writing the code twice; it has nothing to do with what players own. |
| **Each player plays their own deck** | Nothing a player owns is ever shared with, lent to or seen by another player: not cards, not decks, not purchases. Each player picks one of their own decks, built from cards their own account owns (the starter decks count, as everyone has them). The server checks every card against that account's ownership in the Store. |
| **Transport** | A game holds a connection (one WebSocket, `/v1/live`) only while it's playing online: on Play a friend, waiting for an answer, in a game. The rest of the time, a signed-in game says "I'm here" with a small request every 20 seconds (`/v1/live/here`): that's how friends see it online, and how a challenge reaches it. |
| **A fixed ceiling on cost** | No autoscaling. Online play has room for a fixed number of connected players (`LIVE_MAX_PLAYERS`, 300 by default). When it's full, players wait in line (`/v1/live/enter`), and **players who have bought cards go first**. The bill can't grow by itself: the worst case is a waiting line. `LIVE=off` switches online play off. The Terms of Use (section 7) say buying doesn't buy online play or a waiting time. |
| **Where friends live** | Inside the Friend game mode, not in a place of their own. The Home screen keeps its six tiles: the **Friend** tile opens **Play a friend**, where you pick who to play from your friends, or add one. Settings → Account → Friends is gone. |
| **Adding a friend** | A code, never a link. Together: one phone shows its code as a QR code, the other scans it inside the game, sees whose code it is and taps **Add**. Or type the code. Codes are viamochi-id's: 6 characters, 15 minutes, one use. |
| **Challenges** | Only to friends who are online now (connected, or said "I'm here" in the last 50 seconds). A challenge keeps a place for the friend, so answering never puts them in the waiting line. Nobody answering: withdrawn after 2 minutes. |
| **Friendly, not cutthroat** | In a Friend game, running out of time never makes a move for you: the other player decides (give more time, nudge, or, after a while, take the win or call it off). Ranked is the strict one. |
| **Teaching games** | One switch when challenging, for a friend who is new: no timer, hints, take-backs, open hands, slower replays, a kinder end, and it doesn't count. |
| **Handicap** | Each player may choose to start with fewer Lives (9 down to 3), for themselves only. Both players see it. |
| **Talking** | Seven emotes (Meow, Purr, Hiss, Nice play, Good try, Want a hint?, Good game; the two kindest only in teaching games), no typed chat. One tap mutes the other player's. |
| **Pounce and Lucky** | Online, the defender is always asked about a Pounce, and a player who loses a Life about Lucky, whether or not they have anything to play (the engine's `alwaysAsk`). The question is let go after the same short wait either way, so the wait tells the other player nothing. |

## The player's experience

### The flow, the same in both modes

```
 Friend:  Play a friend → pick friend → deck and options → Waiting for Pippin… ─┐
                                                                                ├→ Versus → Game → Result
 Ranked:  Ranked        → pick deck   → Find a match     → Looking for a player… ─┘   (Ranked: to come)
```

### Play a friend (Home → Friend)

The Friend tile starts a game, like Solo, so the screen it opens asks one thing: **who do you want to play?** Signed
out, the tile says "Sign in to open". Signed in, its line says "Online", "2 challenges waiting" (with a badge), or
"Rejoin · Pippin" when a game is still going.

1. **Challenges for you**, at the top when there are some: "Sam wants to play", with the pace, and "they start with 7
   Lives" if Sam gave themselves a handicap. **Pick a deck** or **Not now**.
2. **Your game is still going · Rejoin**, after a reload or on another device.
3. **Who do you want to play?** Your friends, online first, then in a game, then offline. Each row: Pawtrait with a
   status dot, name, a status line ("Online", "In a game", "Last seen 3 days ago") and your record against them
   ("You 3 – 2"). An online friend has a **Play** pill; tapping an offline friend says they aren't online. Remove and
   Block are in the ⋯ menu beside the row, each with a confirmation.
4. **+ Add a friend**, the last row of the same list. With no friends yet, it's the only row.

A friend's challenge while you're anywhere else (Home, the Store, a Solo game) shows as a small banner at the top
within 20 seconds: "Sam wants to play", **See** or ×. It doesn't pause or cover the game.

### When online play is full

Opening Play a friend first asks to be let in. When online play is full, the screen says "You're number 3 in line",
"Lots of cats are playing online right now. You'll be let in as soon as there's room: keep this screen open", and
"Players who have bought cards go first" (with ", and that includes you" for a buyer). The Friend tile says "In line ·
3". The game asks again every 10 seconds; leaving the screen gives up the place. Coming back to a game already going
never waits.

A connection that isn't in a game and does nothing for 10 minutes is closed to make room: "Paused to make room", with
**Play online again**. Opening online play in a second tab or on another device moves it there: the first one says
"Playing on another device", with **Play here instead**. When online play is switched off: "Online games are paused.
They'll be back soon. Solo is always open."

### Adding a friend

**+ Add a friend** opens a sheet: **Show my code**, **Scan a code** (only where there's a camera), or a box to type
the code.

- **Show my code**: a QR code, and the code under it (`K7M-4Q2`) for reading out. The screen stays awake while it's
  showing, and the code quietly renews itself before it runs out. When a friend adds you, the sheet changes by itself
  to "You and Pippin are now friends!", with **Play Pippin** and **Done**.
- **Scan a code**: the camera opens inside the game. The moment it reads a code, it closes and asks "Add Sam as a
  friend?", with Sam's Pawtrait and name, **Add** and **Cancel**. Nothing happens until Add.
- **Typing**: the box formats as you type and, at the sixth character, goes to the same confirmation. If the code
  isn't on anyone's screen at that moment (they read it out and closed the sheet), the confirmation says so and shows
  the code instead of a name.
- After **Add**: "You and Sam are now friends!", with **Play Sam** (when Sam is online) and **Done**.

The QR code holds `FRUITCATS FRIEND K7M4Q2`: the code, and nothing a phone's camera app would open. Scanning uses the
browser's own reader where there is one (Chrome on Android) and jsQR otherwise (iPhone), loaded only when the camera
opens (`apps/web/src/qr.ts`).

### Challenging a friend

Tapping a friend opens the challenge:

- **Deck**: the Solo carousel. Only your finished decks can be played.
- **Teaching game** (a switch): "For a friend who's new: no timer, hints, take-backs, open hands. It doesn't count."
- **Pace**, unless it's a teaching game: **Relaxed** (2 minutes a move, the default), **Quick** (45 seconds) or **No
  timer**.
- **Starter decks only** (a switch): both players play a starter deck, so an experienced player can't bring a tuned
  one.
- **Your Lives**: 9, or fewer as a handicap (down to 3).

**Challenge Pippin** leads to the waiting screen: both Pawtraits, "Waiting for Pippin…", a 2-minute ring and
**Cancel**. If Pippin says Not now: "Pippin can't play right now." If the ring runs out: "No answer from Pippin."

Answering a challenge shows what it is (pace, teaching, starter decks, their handicap), the deck carousel (starter
decks only when the challenge says so), **Your Lives**, and **Not now** or **Play**. Someone who has never finished a
game is told they can ask for a teaching game instead.

### Versus

Three seconds (a tap skips it): both Pawtraits and names, both Hero Cats, anyone starting with fewer Lives, who takes
the Yarn Ball first, and the pace.

### In the game

The game screen as in Solo, drawn from the view the server sent, with:

- **The other player's Pawtrait** where the computer's face is, and their name everywhere Solo says "Opponent".
- **The clock**: a chip under the Pawtrait of whoever is deciding ("1:32", "Reserve 0:40", "Out of time", "Paused"),
  red in the last 10 seconds.
- **Hold on** (Relaxed and Quick): two per game, each adds time to the move in front of you. The other player sees
  "Pippin needs a moment."
- **Pounce and Lucky**: "Pippin plays Pocket Hamster. Pounce?" or "Nothing to Pounce with: it happens in a moment",
  with **Wait (2)** to keep the question open and **Let it happen**.
- **When the other player runs out of time** (Friend games): "Pippin is out of time." **Give more time** or **Nudge**
  (their phone vibrates and says "Sam nudged you: your move!"). After 3 more minutes, also **Take the win** or **Call it
  off**. Nothing is ever played for them.
- **If a connection drops**: "Pippin's connection dropped. Waiting 2:59 for them to come back." The clock stops;
  you can still make your own move. After that, **Take the win** or **Call it off** (or just keep waiting). They come
  back by opening the app on any device: the Friend tile says **Rejoin**.
- **Emotes**: 🐾 beside your Pawtrait opens them; the other player's appear as a bubble over their Pawtrait.
  **Mute their emotes** is in the same menu.
- **Concede** beside Rules and Home, with a confirmation. **Home** leaves the screen but not the game: it goes on,
  and the Friend tile rejoins it.

### Teaching games

- **No timer**, and the Pounce and Lucky questions stay open 8 seconds instead of 2.5.
- **What should I do?** suggests a move, in words ("Play Cherry Robin on Pear Hedgehog.") and by lighting it up. It's
  the Solo AI at full strength, which never looks at hidden cards: it blanks out the other hand before it thinks.
- **Take back**: undoes your last move if the other player hasn't moved since and it showed you nothing new (no card
  drawn, no Life turned over, not a mulligan). The game is rebuilt from its seed and the moves before it.
- **Show my hand**: either player can show their hand to the other, face up above their Pawtrait.
- **The other player's moves play 1.5 times slower**, so someone new can follow them.
- **A kinder end**: "Good game!" instead of "You lose!", and what you managed ("You took 5 of Sam's Lives").
- **It doesn't count** in your record against each other.

### Result

"You win!", "You lose!", "A draw!" or "Called off", how it ended ("Pippin conceded.", "Pippin ran out of time.",
"Pippin was away."), the number of rounds, and your record against them ("You 3 – 2 Pippin"). **Rematch** and
**Home**. When one player taps Rematch, the other's button says "Sam wants a rematch: Play!". A rematch keeps both
decks, the pace and the handicaps, and the other player takes the Yarn Ball first.

## The clock

The same code in every mode (`Match` in `apps/api/src/live/match.ts`); only the numbers (`PACES`, `RANKED_CLOCK` in
`packages/match/src/index.ts`) and what happens when time runs out differ.

| | Relaxed | Quick | No timer (and teaching) | Ranked |
|---|---|---|---|---|
| Each move | 2 min | 45 s | none | 30 s |
| Reserve for the game | none | none | none | 2 min |
| Hold on | 2 × 2 min | 2 × 1 min | none | none |
| Out of time | the other player decides | the other player decides | never | the plainest move is made for you |
| Pounce / Lucky question | 2.5 s (8 s in teaching games) | 2.5 s | 8 s | 2.5 s |

The plainest move: pass, keep the hand, let the Pounce go, keep the Lucky card, the first choice offered. In Ranked,
three timeouts in a row lose the game. The clock stops while either player's connection is down.

## Connection drops

A player whose connection drops has **3 minutes** (Friend) or **60 seconds** (Ranked) to come back. Ranked then
counts it as a loss; a Friend game lets the one still there take the win or call it off, or keep waiting. A game with
both players gone for 30 minutes is called off. A game going when the API restarts is rebuilt from its record and
waits for both players to come back.

## How it's built

### Code used by both modes, and not

| Piece | Both modes | Friend only | Ranked only (to come) |
|---|---|---|---|
| Socket, sign-in on it, reconnecting (`socket.ts`, `live.ts`) | ✓ | | |
| Presence (`hub.ts`) | ✓ | shown to friends | |
| Finding the other player | | challenges (`hub.ts`) | the queue |
| Deck check: finished, every card owned by that account (`server.ts`) | ✓ | starter decks only, if asked | |
| The match: engine, views, clock, drops, concede, emotes, rematch (`match.ts`) | ✓ | | |
| The record: seed, decks, moves, result (`records.ts`) | ✓ | | |
| After the game | | the record between you | the rating |
| The game screen, Versus, Result (`main.ts`, `online.ts`) | ✓ | | |

### Shared (`packages/match`)

What the game and the API both need, written once: every message each way (`ClientMessage`, `ServerMessage`), the
rules (`MatchRules`, `ClockRules`, `PACES`, `friendRules`, `rankedRules`), the emotes, and friend-code helpers.

### Server (`apps/api/src/live/`)

| File | Job |
|---|---|
| `socket.ts` | The WebSocket at `/v1/live` (the `ws` package). The token comes in the first message, never in the address, so it isn't logged. Messages are compressed (about five times smaller), keeping no compression memory between them. Pings every 25 s; a socket that stops answering is closed. |
| `hub.ts` | Letting players in and the waiting line (`enter`), "I'm here" (`here`), one connection per account (the newest wins), presence, friend codes (whose code is this, and "they added you"), challenges, and starting, restoring and forgetting matches. Closes connections idle for 10 minutes outside a game. Knows nothing about sockets, so its tests use plain functions. |
| `match.ts` | **The core, used by both modes.** One class, `Match`: rebuilds the game from its record, checks and applies moves, sends each player their view (with only the new events), runs the clock, handles drops, concedes, emotes, hints, take-backs, open hands and rematch requests. |
| `records.ts` | The `matches` table (games going, and finished ones by month: the replays), `rivals` (the record between two friends) and `seen` (last seen). Export my data includes a player's records and last seen; Delete account erases them. Finished replays keep only account ids and cards, no names. |

**Who is friends with whom is viamochi-id's.** When a game connects, the API asks viamochi-id's `/friends` with the
player's own token, and asks again when the player says their friends changed. A challenge only goes between two
people on each other's lists; blocking in viamochi-id removes the friendship, so a blocked player can't challenge.
No change to viamochi-id was needed.

**Friend codes and the API.** The game still gets and redeems codes at viamochi-id, as the old Friends page did. The
game showing a code also tells the API ("this is my code"), so a friend who scans it can be shown whose it is before
adding. After adding, the game tells the API, which tells the friend's phone to look again at its friends. The API
never adds anyone: that's only viamochi-id's.

**One instance.** Games live in the memory of one API instance, with their records written at most once a second.
App Service needs **Web Sockets switched on** (Configuration → General settings) and must stay at one instance. When
that's not enough, the socket moves to Azure Web PubSub; `socket.ts` is the only file that knows about the transport.

**Same rules on both sides.** The game sends its `PROTOCOL` and the engine's `RULES_VERSION` when it connects; if they
aren't the server's, it's told a new version is ready and offered a reload before it can play online.

`seq` in a move is the number of moves applied so far (`GameState.actions`): a move sent for an older state (a
double tap, a message that crossed another) is never applied twice; the player is sent the game again.

### Game (`apps/web/src/`)

| File | Job |
|---|---|
| `live.ts` | "I'm here" every 20 seconds while the game is open and signed in; the connection only while playing online (asking to be let in first, and waiting in line when it's full); reconnecting with backoff; what the server last said (presence, challenges, the match you're in). |
| `friends.ts` | Play a friend: the list, the challenge, waiting, answering, the Add a friend sheet, the challenge banner. |
| `qr.ts` | A friend code as a QR code (qrcode-generator, MIT), and scanning one (the browser's reader, or jsQR, Apache-2.0). |
| `online.ts` | An online game's own parts of the game screen: the clock, Hold on, out-of-time and dropped-connection choices, emotes, teaching helps, Versus and the result. |
| `main.ts` | The board, for Solo and online alike. `mySeat` and `theirSeat` replace the old fixed seats. Online, the board is the view the server sent and a move goes to the server; its events play as animations before the new view is drawn, as a Solo move's do. |

### Engine

- **`GameOptions.lives`**: each player's starting Lives (the handicap). The Lives given up stay in the deck, and
  `PlayerState.handicap` says how many, so both players see it.
- **`GameOptions.alwaysAsk`**: always ask about Pounce and Lucky. `legalActions` then offers only "let it happen" (or
  "keep it") when there's nothing to play.
- `packages/engine/test/view.test.ts` already checks that a player's view never depends on hidden information;
  `online.test.ts` checks the two options.

## What online play costs, and its ceiling

The aim: players who never buy anything should cost next to nothing, and the bill should never grow by itself.

- **Solo costs nothing**: it runs on the player's device. No account needed.
- **A game that's open but not playing online** says "I'm here" every 20 seconds: a tiny request, with the token's
  check remembered (no signature check each time). No connection is held.
- **An online game** costs about **1/100 of a cent**. Measured with 500 games at once through the real hub and match
  code (a development machine; App Service's B1 is likely somewhat slower):

| | Measured |
|---|---|
| Memory per game | ~25 KB at the start, ~105 KB after 120 moves (1,000 games ≈ 100 MB) |
| CPU per move (check, apply, both views, send) | ~0.65 ms: one core at half load plays roughly 1,000–2,000 games at once |
| Sent per move, both players | ~7 KB of messages (only the new story lines and events), about five times less on the wire once compressed (~1.5 KB) |
| Table writes | at most one per game per second |

- **The ceiling.** `LIVE_MAX_PLAYERS` (300 by default) is how many players may be connected at once: the server never
  takes more, so its cost is the plan's flat price. When it's full, players wait in line, buyers first. On the
  current **B1** plan (shared with viamochi-id and mochi-ops), App Service allows 350 WebSockets per instance, which
  is why the default is 300. Since only players actually playing online are connected, 300 is a lot of players.
- **Raising it** is a decision, never automatic: `fruitcats-api` on its own plan (Premium v3 has no fixed WebSocket
  limit) and a higher `LIVE_MAX_PLAYERS`, to about 2,000 per instance. Past that: the connections to Azure Web
  PubSub and several instances, each owning some matches (a lease in a table says which; any match can be rebuilt
  from its record on another instance). `socket.ts` is the only file that knows about the transport.
- **Stopping it**: `LIVE=off` (docs/emergency-stop.md). The subscription's budget alert already stops the apps at
  $300 in a month.

What grows with non-paying players outside online play: accounts (Entra is free up to 50,000 active users a month,
then about 1.6¢ each) and card art bandwidth.

## How long things are kept

In the API's memory:

- **A game going**: until it ends. Nobody moving for **24 hours**, whoever is still connected, calls it off; both
  players gone for **30 minutes** calls it off.
- **A finished game**: until both players leave its result, or **10 minutes** after it ended.
- **A challenge**: 2 minutes. **A friend code on a screen**: until the code is used, replaced, or its phone disconnects.
- **A connection**: until its socket closes, stops answering pings (25 s), or, outside a game, does nothing for 10
  minutes.
- **"I'm here"**: 50 seconds after the last one. **A place in the waiting line**: 30 seconds after it was last asked
  for. **A place kept for a player let in**: 1 minute (a challenged friend's: until the challenge ends).

In the tables: a game going is in `matches/live` until it ends, then moves to its month (`done-YYYY-MM`) as a replay,
with account ids and cards only. **Replays are kept for good for now: a retention period (and a job that deletes
older months) is to decide**; the privacy policy has a placeholder for it. The record between two friends (`rivals`) and last
seen (`seen`) are kept while the account exists; Delete account erases them.

## Trying it

Two browsers as two friends, on your own computer, with no email codes:

```bash
npm run api:local -- --fake-sign-in     # the API on http://localhost:8790; everyone who connects is everyone's friend
npm run dev                             # the game on http://localhost:5173
```

Open `http://localhost:5173/?online=1&api=http://localhost:8790` in two browser profiles. In each, set a session in
the console, with a different 32-hex-digit id and name:

```js
localStorage.setItem('viamochi-session', JSON.stringify({ userId: 'a'.repeat(32), displayName: 'Sam', email: 'sam@example.com',
  refreshToken: 'x', token: 'dev-' + 'a'.repeat(32), expires: Date.now() + 864e6, signedInAt: Date.now(), avatar: 'orange',
  terms: '2026-09-draft-1', birthYear: 1990 })); location.reload();
```

Adding friends needs the real viamochi-id (codes are made and redeemed there), so try that on the playtest site.
`apps/api/test/live.test.ts` plays whole games through the hub, with the clock, drops, teaching helps, handicaps,
friend codes and a restart.

## What's left

- **Ranked**: the queue (pairs players whose ratings are close, widening the gap the longer someone waits), Glicko-2
  ratings and the ladder, a Ranked screen, and the rating on Versus and the result. The match, the clock
  (`rankedRules`) and the screens are already there. To decide first:
  - **Names in front of strangers.** Display names so far are only seen by friends. Ranked shows them to anyone: they
    need checking, or Ranked shows a Pawtrait and a made-up name.
  - **Not meeting someone again**: a "don't match me with this player" list, kept by the queue.
  - **Released cards only**: prototype sets are allowed in Friend games, not in Ranked.
- **Offer the tutorial to a first-timer** who's been challenged. Today they're told they can ask for a teaching game.
- **Notifications** for a challenge while the app is closed (web push, later the app stores'). Until then a challenge
  only reaches a friend who has the game open.
- **Before the public build turns it on**: Web Sockets on for `fruitcats-api` (and one instance); the lawyer's review
  of the Terms' online play section (7) and the privacy policy's online play lines; a replay retention period; a
  playtest with real phones (the camera scanning a QR code on another phone's screen). When the Terms are published,
  `TERMS_VERSION` (apps/web/src/auth.ts) moves to the published version, so everyone agrees to them again.
