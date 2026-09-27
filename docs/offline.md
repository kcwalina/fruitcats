# Playing offline

Folkborn is a web game, served by Azure Static Web Apps at fruitcats.viamochi.com. Without help, a browser can only
open it while that site answers: with no connection, or while the site is down, the game wouldn't load at all. A
service worker fixes that. It is a small script the browser keeps for the site, which can answer the game's requests
from files stored on the device. With it, Folkborn behaves like an app installed from a store.

## What works offline

After the game has been opened once with a connection:

- The game starts, with no connection or with the site down.
- Solo games play fully, against the AI.
- The deck builder and the Collection work.
- Card pictures show for every card the device has seen. When a Solo game starts, the pictures of both decks in it are
  fetched in the background, so the next game with those decks shows all of its cards, not only the ones drawn.

What needs a connection: signing in, Play a friend, the Store, and anything else that talks to the Fruitcats API or the
sign-in service. Those are never stored and always go to the network, so they fail the way they always have when
offline. A card seen for the first time while offline shows no picture.

## How it works

The worker is `apps/web/src/sw.ts`. Every decision it makes is in `apps/web/src/sw-rules.ts`, so it can be tested
without a browser. Each request gets one of four answers:

| Kind | What | Where it comes from |
|---|---|---|
| Shell | The game page, its scripts and styles, interface art, sounds, icons, the manifest | Stored when the version installs. Always read from the device. |
| Packs | Card pack lists and set data (`packs/index.json`, `set.json`), here and in the pack storage | The network first, for up to 1 second, then the last stored copy. |
| Runtime | Card art from the pack storage, Google Fonts | Stored the first time. Read from the device after that, and refreshed in the background once a day. At most 500 files (about 60 MB at most). |
| Network | The API, sign-in, Paddle, WebSockets, any other page of the site (Studio, Portal, docs), anything that isn't a GET | Not touched by the worker. |

The list of shell files is made at the end of each build (`offlineWorker` in `apps/web/vite.config.ts`). It is about
3.7 MB (58 files) today. The build fails if the list lacks the page, its entry script or the pack list, or if it grows
past 15 MB. `npm run deploy` checks the list again after building. The build also writes the version (a hash of those
files) into `index.html`, so the page knows its own version.

The worker is registered only in a production build. `vite dev` never registers it, so a stored copy never hides a
change you are making.

## Updates

The game's page comes from the site whenever the site answers within 3 seconds, so opening or reloading the game
brings the newest version, as it did before there was a worker. The stored page is used only when the site doesn't
answer (offline, or the site down), and for the last-good fallback below.

The stored copy is updated separately. At each launch the page asks for the worker's script again. When a new version
has been deployed, the browser downloads its files in the background into a store of their own. The new worker takes
over once every window of the game has closed, never during a game in progress: a page running one version while
another serves its files can fail to load its next script. Until then, an offline launch gets the version stored
before.

## The last-good fallback

If a new version is broken, players could be stuck with a game that doesn't start. So:

1. When the game starts, the page tells the worker that this version started. That version is now the "good" one. The
   worker then deletes the stored files of older versions.
2. If the game doesn't start (its script throws while loading, or it draws nothing), the page tells the worker it
   failed, logs the error to the console, and keeps a note on the device: `localStorage['folkborn-boot-log']` holds the
   last ten failures, and `localStorage['folkborn-good-version']` holds the last version that started. There is no
   telemetry service yet.
3. The page reloads once. If the new version fails again, which is two failures in a row, the worker serves the last
   good version instead, and the page reloads once more to get it.
4. The fallback lasts 24 hours after the last failure. After that, the new version is tried again, in case the failure
   was the device's rather than the version's. A version that starts even once becomes the good one at once, and a newer
   deploy always gets its own chance. So nobody is held on an old version for good.

## How to check it

In Chrome, with a production build:

1. `npm run build -w @fruitcats/web`, then `npx vite preview apps/web --port 4173`.
2. Open `http://localhost:4173/?mute`. In DevTools, Application, Service workers, the worker is "activated and running".
   Or in the console: `navigator.serviceWorker.controller` is not null, and `await caches.keys()` lists
   `folkborn-shell-<version>`.
3. Start a Solo game, so the cards' pictures are stored.
4. Stop the preview server (or tick "Offline" in DevTools, Network), and reload. The game loads, a Solo game starts,
   and its cards show.

To try the fallback, add a line that throws to the end of `apps/web/src/main.ts`, build, and open the page, then close
the tab and open it again so the broken version takes over. The page reloads twice and ends up on the previous version.
`folkborn-boot-log` in localStorage shows the two failures. Remove the line afterwards.

The worker's rules have unit tests in `apps/web/test/sw-rules.test.ts`, which run with `npm test` on every deploy.
