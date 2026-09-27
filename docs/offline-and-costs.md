# Playing without our servers

Folkborn should cost close to nothing for each extra player, and it should keep working when our servers have a bad
day or a player has no connection. This page explains how the game does that today: what runs on the player's
device, what still needs the Fruitcats API, and what happens when the API doesn't answer.

Last updated 2026-09-27.

## The rule

**The server is a convenience, never a gate.** Our servers introduce players, keep records and sign things. They are
never needed to play. Each screen works in one of three situations, and the player barely notices which:

| | Solo, decks, Collection | A game with a friend already going | Starting a game with a friend | Store |
|---|---|---|---|---|
| **Everything answers** | works | works | works | works |
| **Our API doesn't answer** | works | carries on | waits until it's back | shows what you own; no buying |
| **No internet at all** | works (see [offline.md](offline.md)) | stops until the connection returns | not possible | shows what you own |

Settings → Gameplay says in one line which of these the game is in, and what still works, so nobody has to wonder
whether something is broken.

## Friend games are played directly between the two devices

Before, every Friend game ran on the Fruitcats API over a WebSocket held for the whole game. App Service's B1 plan
allows about 350 of those at once, so online play had a fixed ceiling (`LIVE_MAX_PLAYERS`, 300) and a waiting line.
Raising the ceiling meant paying for a bigger plan.

Now a Friend game is played directly between the two players' devices whenever both can:

- **The friend who asked runs the game.** Their device (seat 0) runs the same match code the API runs
  (`packages/match/src/match.ts`): the rules check, the clock, teaching games, take-backs and rematches. The other
  device sends and receives exactly the messages it would exchange with the API. The screens can't tell the
  difference.
- **The devices talk over WebRTC.** They use a data channel, found with the help of public STUN servers (Google's and
  Cloudflare's). STUN only tells each device its own address. No game data passes through them.
- **The API only introduces them.** Each device makes a few small requests to swap connection details (an offer and an
  answer). No connection to the API is held while they play, so a game costs the API a handful of requests, not an
  open socket.
- **The API keeps a checked copy.** After each move, the host's device sends the API the game's record. The API plays
  the record through the engine, refuses any move against the rules, and stores it as it stores its own games. The
  host's device also keeps its own copy, so a reload, or the API not answering, loses nothing. Copies the API missed
  are sent again when it answers.
- **The API records the result**, as before: the record between two friends, and the replay kept 30 days.
- **When the devices can't reach each other, the API takes over.** Some networks block direct connections. If both
  devices have been trying to connect for 20 seconds and the API's copy has every move, the API takes the game over
  from its copy. From then on it plays through the connection like any other online game. Players see a short
  "connection dropped" moment, then carry on.

Everything else stays as it was: presence, friend codes and requests to play all go through the API. A game where
either device runs an older version of the game is played on the API.

### What each situation looks like

| What happens | What the players see |
|---|---|
| The game starts | The asker sees the board at once, with "Waiting for Pippin to join." The friend who joined sees "Connecting to your friend…", then the board, usually within a few seconds. |
| Either player reloads or reopens the game | They land back in the game. The devices reconnect by themselves. |
| A phone puts the game in the background | The clock stops for both, as it does when a connection drops. It carries on when the phone comes back. |
| Our API stops answering mid-game | Nothing changes while the devices stay connected. Copies of the record wait on the host's device. |
| The host's device is gone for good | After the usual 3 minutes, the other player can take the win or call the game off. That request goes to the API, since the host can't answer. |
| The devices can't connect at all | After 20 seconds the API takes the game over, and it plays like before. |

### What it doesn't protect against

In a game played directly, the host's device holds the whole game, including the other player's hand. A player who
modifies their game could peek, or play the other seat's moves. The API still refuses anything against the rules.
Between friends that's acceptable. **Ranked will always be played on the API**, where nobody's device holds the other
player's cards.

## What it costs now

- **Solo, decks, the Collection:** nothing. They run on the device.
- **A game open but not playing online:** one small "I'm here" request every 20 seconds.
- **A Friend game played directly:** about a dozen small requests to connect, one small request per move for the copy,
  and one for the result. No held connection, so it doesn't count toward `LIVE_MAX_PLAYERS`.
- **A Friend game the API took over:** as before, one held connection per player, counted in `LIVE_MAX_PLAYERS`.
- **Play a friend itself** (looking at who's online, waiting for an answer) still holds a connection, but only for the
  minute or two before a game starts.

So the ceiling of about 300 players now applies to people choosing a friend, plus the few games that couldn't connect
directly. That's a much smaller group than everyone playing.

## Switches

- `LIVE_PEER=off` on `fruitcats-api`: every Friend game is played on the API again, as before. Games already being
  played directly carry on. Use it if direct play causes trouble ([emergency-stop.md](emergency-stop.md)).
- `LIVE=off` still turns online play off altogether.
- For trying things out in a browser: `?nopeer` makes this game say it can't play directly, and `?peerfail` makes it
  say it can but never connect, so the API takes the game over after 20 seconds.

## Steam and Android

The match code doesn't know how the two devices are connected. `PeerHost` in `packages/match/src/peer.ts` takes text
from the other device and a function to send text back. The web build connects them with WebRTC
(`apps/web/src/peer.ts`). Steam can connect them through Steam's own networking and relays, and Android phones in the
same room through Nearby Connections. Neither needs a server of ours. The Steam and Android sessions have the details.

## Not done yet

More ideas, including Ranked, are in [optimizing-cost.md](optimizing-cost.md).

- **Starting a game with no server at all.** Two phones in the same room, swapping connection details by QR code.
  This needs two more pieces: a signed record of which cards each account owns, so each device can check the other's
  deck without asking the API, and the QR screens. Games already going don't need either.
- **A relay (TURN) for networks that block direct connections.** Today those games move to the API, which works, and
  costs what online play cost before. A relay would cost bandwidth instead, so it's only worth it if many games end up
  on the API.
