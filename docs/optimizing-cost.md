# Optimizing cost

Folkborn should cost close to nothing for each extra player, and it should keep working when our servers don't
answer. [offline-and-costs.md](offline-and-costs.md) describes what is built: Friend games played directly between the
two devices, and the web game working offline. This page lists the ideas that aren't built yet, roughly in the order
they would pay off. Each one says what it saves, what it costs to build, and when it's worth doing.

Last updated 2026-09-27.

## Where the money goes today

| What | How it's paid for | Grows with players? |
|---|---|---|
| Solo, decks, the Collection | The player's device | No |
| The site and card art | Static Web Apps and blob storage | Barely: files are cached by browsers and the offline worker |
| "I'm here" (every 20 s while the game is open and signed in) | fruitcats-api requests | Yes, slowly |
| Play a friend (choosing a friend, waiting for an answer) | One WebSocket per player, for a minute or two | Yes, capped at `LIVE_MAX_PLAYERS` |
| Friend games | Played directly between the devices; a few small requests each | Barely |
| Friend games that couldn't connect directly | One WebSocket per player, for the whole game | Yes, capped |
| Accounts, friends lists, the Store | viamochi-id and fruitcats-api, table storage | Slowly |

The only open-ended cost left is the App Service plan's limit on held connections. Everything below either shrinks
what needs a held connection, or moves it somewhere that charges per message instead of per connection.

## 1. Ranked, when it comes

Ranked has to be played on a server: in a ranked game neither device may hold the other player's cards, and the
result has to be trusted. So Ranked is where server cost will come back. Ways to keep it small:

- **Turn-based needs no open socket.** A move is a small request, and the other player needs to hear about it within
  a second or so. Two options:
  - **Short polling while it's the other player's turn**, every second or two. Simple, and works on any host. It costs
    more requests but holds nothing open.
  - **A host that charges per message, not per connection.** Azure Container Apps on the consumption plan scales to
    zero and has no fixed WebSocket limit, and its free monthly grant covers a small game. Only `socket.ts` in the API
    knows about the transport, so moving the live endpoint there is a small job. (Outside Azure, Cloudflare Durable
    Objects with hibernating WebSockets charge nothing for an idle open connection. That breaks the "everything in
    Azure" rule, so it's only a comparison.)
- **The queue holds nothing open either.** "Find a match" can be a request that's answered when a match is found, or
  polled every few seconds, like the waiting line already is.
- **Keep the waiting line.** With a fixed ceiling, the worst case is players waiting, never a surprise bill. Buyers
  first, as now. Never sell a place in line.
- **Don't open Ranked in fixed time windows** to save money: it bunches players together and makes the peak worse.

## 2. Play a friend without a held connection

The Play a friend screen still holds a WebSocket for presence, friend codes and requests to play. Now that games
don't, this is the biggest remaining use of the connection limit. It could all be plain requests:

- Presence: already mostly there. "I'm here" brings friends' requests and games. The friends list could come from a
  request every 20–30 seconds while the screen is open.
- A request to play: a POST. The friend hears about it on their next "I'm here", or at once through a push (below).
- Friend codes: a POST to show a code, a POST to look one up.

With that, the WebSocket is needed only for games the API runs (Ranked, and Friend games that couldn't connect
directly), and `LIVE_MAX_PLAYERS` stops mattering for friends entirely. The cost is a slightly slower "Sam wants to
play" (up to 20 seconds) unless pushes are added.

## 3. Push instead of asking every 20 seconds

"I'm here" every 20 seconds is how a request to play reaches you. Web Push (and APNs or FCM for store builds) is free
and needs no connection of ours. A request to play could wake the friend's game at once, and "I'm here" could slow down
to once a minute. Worth doing together with item 2. It needs the player's permission for notifications, which is also
a nice feature ("Sam wants to play").

## 4. Starting a game with no server at all

Two phones in the same room, with no internet, or while our servers are down:

- **A signed record of what each account owns.** Today the API checks each player's deck when a game starts. For a
  game our servers never see, the API would give each device a small statement of the cards its account owns, signed
  with a private key only the API has (ECDSA P-256, which every browser can check). The game carries the public key.
  Each device shows the other its statement, and each checks the other's deck against it. This also makes Solo deck
  building fully independent of the Store being reachable.
- **Swapping connection details by QR code.** One phone shows its offer as a QR code, the other scans it and shows its
  answer, and the first scans that. The screens can reuse the friend-code scanner (`apps/web/src/qr.ts`). On the same
  Wi-Fi the phones connect without any server.
- **A seed neither side can pick.** Without the API choosing the seed, each device commits to a secret (sends its
  hash), then both reveal, and the seed is made from both secrets.
- **The result goes in the outbox**, and is recorded when either phone is next online.

## 5. Pass and play

Two players on one device, handing it back and forth. No server, no account needed. It needs a "pass the device"
screen that hides the hand, and an answer for Ambush, which happens on the other player's turn
([future-plans.md](future-plans.md#1-pvp)).

## 6. Correspondence games

A Friend game with no clock that lasts days: each move is a request, the other player gets a push, and nothing is held
open. Played directly between devices it doesn't work, since both have to be there at once. So this one would run on
the API, but as requests only, not a socket. For friends in different time zones it's a better game, not a cheaper
compromise.

## 7. Steam and Android

- **Steam** gives peer networking, relays through any network, lobbies, invites and matchmaking for free (Steamworks
  Networking with Steam Datagram Relay). A Steam build's Friend games should use it through `PeerHost`
  (`packages/match/src/peer.ts`), and never fall back to our API. Ranked could even use Steam's matchmaking to find
  opponents, with only the game itself on our server.
- **Android** has no free relay (Google Play Games shut its real-time multiplayer down in 2020). Use the web's WebRTC
  path, Nearby Connections for phones in the same room, and FCM data messages (free) for "Sam wants to play".
- **Ship everything in the package** on both: the game, the card packs, art and sounds. A store build must start and
  play Solo with no network at all.

## 8. A relay for networks that block direct connections

Some networks (some mobile carriers, strict office Wi-Fi) block direct connections. Those Friend games move to the API
today, which works but uses the connection limit. A TURN relay would carry them instead. It costs bandwidth rather than
connections (about 1.5 KB a move, so pennies per thousand games), but it's one more service to run. Worth it only if
the API's logs (`live.peer_served`) show many games moving over. Check that number first.

## 9. Smaller things

- **Keep the API's answers cacheable.** The Store catalog and the pack indexes rarely change: short cache headers,
  or files in blob storage, instead of an API call.
- **Fewer table writes.** A game's copy is written at most once a second. Once a game ends, its moves could be kept
  as one compressed blob rather than table rows split into chunks.
- **Measure before buying anything.** `live.match_started` (with `peer: true`), `live.peer_served` and
  `live.waiting` in the API's logs show how many games are direct, how many move to the API, and whether anyone ever
  waits in line. The next step up (fruitcats-api on its own Premium v3 plan, about 2,000 connections) is roughly
  $60–80 a month. Take it only if the waiting line actually fills.

## What not to do

- Don't put online play behind a purchase. The Terms of Use say buying doesn't buy online play or a place in line.
- Don't turn on autoscaling. A fixed ceiling and a waiting line mean the bill can't grow by itself.
- Don't make anything depend on PC2024 or on Claude at run time.
