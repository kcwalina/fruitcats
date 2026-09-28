# Android support

This plan covers putting Fruitcats on Google Play as a real Android game: free to download, with the Store's decks
and cards sold through Google Play Billing. It covers what hardware we need for testing, how the app is built, and
the work in order.

It adds detail to phase 7 of the [Store plan](store-plan.md#phases), which already decided on one Capacitor app for
iPhone and Android and an Electron app for Steam. The Steam port is planned in a separate session. The decisions
both ports share are listed in [Shared with Steam](#shared-with-steam).

## Summary

| Question | Answer |
|---|---|
| **Rewrite the game?** | No. The Android app is the same web game in a native shell (Capacitor). Every fix and new card set reaches the web, Android and Steam at once. |
| **Is the emulator enough?** | For most daily work, yes. Before the first release to testers, buy **one inexpensive, recent Android phone** (about $150–200). A tablet is optional. See [Hardware](#hardware). |
| **Accounts and sign-in** | The same email and 6-digit code, in the game's own screens. This already works inside an app, so no Google sign-in is needed. |
| **Buying** | Google Play Billing, required by Google for digital items. Purchases go into the same ledger as web purchases, so "a purchase anywhere is owned everywhere" still holds. Buying stays off until you open the Store. |
| **Costs** | $25 once for a Google Play developer account (personal, in your name). Google keeps 15% of sales. |
| **Longest wait** | Google requires a new personal account to run a **closed test with at least 12 testers for 14 days** before the game can go public. Start that test early, before buying is ready. |

## Hardware

### What the emulator does well

Android Studio's emulator runs on this Windows PC for free. It can imitate any phone or tablet size, any Android
version, portrait and landscape, notches and the gesture bar. With a "Google Play" system image, it can even test
Play Billing with test accounts. Most of the day-to-day work (layouts, screens, the back button, billing flows) can
be done and checked there, and an agent can drive it.

### What only a real device shows

- **Speed.** The emulator runs on the PC's fast processor. A real mid-range phone shows whether card animations,
  the wallpaper and the Store stay smooth. Most Android players have mid-range phones, and this is the main reason
  to own one.
- **Touch feel.** Dragging cards with a finger, the size of tap targets, accidental swipes from the screen edges.
- **Sound.** Delay between a tap and its sound, and the sound stopping when the phone is locked or a call comes in.
- **Camera.** Scanning a friend's QR code.
- **Sharing and saving pictures.** The share sheet and saving a wallpaper to the phone's gallery.
- **Samsung.** Samsung phones are the most common Android phones, and they change parts of Android (the system
  browser engine settings, battery saving that closes apps). Bugs that only happen on Samsung are common.

### Recommendation

1. **Now: nothing to buy.** Start in the emulator.
2. **Before the closed test: one phone.** A current **Samsung Galaxy A-series** phone (for example the A16 or the
   newest A1x model), about $150–200. It is cheap, it is the kind of phone many players own, and it is Samsung. An
   unlocked phone does not need a SIM card or a phone plan; Wi-Fi is enough.
3. **Optional: a tablet.** The emulator shows tablet layouts well. Buy one (for example a Samsung Galaxy Tab A-series,
   about $150) only if tablet players turn out to matter, or if the closed test shows tablet-only bugs.

A flagship phone (Pixel, Galaxy S) is not needed. If the game is smooth on a cheap phone, it is smooth on an
expensive one.

This PC needs virtualization turned on for the emulator (Windows Hypervisor Platform). The setup step checks this.

## How the app is built

```
  apps/web  (the game, unchanged)
      │  vite build (the "app" build)
      ▼
  apps/android  (Capacitor project)
      ├─ the built game, bundled inside the app, including card art
      ├─ native pieces: Play Billing, secure token storage, share, save to gallery, haptics
      └─ Android Studio project → signed app bundle (.aab) → Google Play
```

- **Capacitor** runs the game in the phone's built-in web engine (Android System WebView, the same engine as
  Chrome). The game is plain TypeScript with relative paths already, which suits this well.
- **Card art is inside the app** (about 50 MB), so the game starts fast and works offline against the computer.
  New card sets that are data only still arrive from the pack store, as on the web. Sets that need new game code
  need an app update.
- **One seam for the platform.** The Store plan names a `platform.ts` module: the one place where the game asks
  "how do I buy, save a picture, share, keep my token safe, vibrate" on the current platform. The web, Android and
  Steam each provide their own version. The rest of the game never checks which platform it is on.

### What "first-class" means here

These are the things that make it feel like an Android game, not a website in a box:

- The phone's **back** gesture closes the open screen or dialog, and on Home asks before leaving the game.
- **Edge to edge**: the game draws behind the status bar and gesture bar and keeps buttons out of them. Android 15
  and later require this. The game's existing `safe-area-inset` CSS covers most of it.
- A proper **app icon** (Android's adaptive icon) and a **splash screen** that matches the game.
- **Sound pauses** when the app goes to the background and resumes when it comes back. Online matches handle being
  paused (a phone call, switching apps) and reconnect.
- **No browser traces**: no text selection on long-press, no pull-to-refresh, no blue tap highlight, and links to
  the Rules, Terms or Privacy open inside the app or in a browser tab above it, never replacing the game.
- **Haptics** on card plays, through the native vibration API.
- **The sign-in token** lives in Android's secure storage (Keystore), as the accounts plan requires, not in the web
  engine's localStorage.
- **Speed** on a mid-range phone: 60 frames per second in matches. If animations are too heavy, the game already
  has a reduced-motion setting to build on.

## Buying on Android

- **Google Play Billing** is required for the game's digital items. Each deck and card on sale becomes a Play
  "in-app product" with the same price as on the web, per the pricing rules (same price on every store, sales in sync).
- **The server stays the only record of what's owned.** After a purchase on the phone, the game sends Google's
  purchase token to `fruitcats-api`. The API checks it with Google's Play Developer API (a Google Cloud service
  account), records it in the ledger, and grants the items to the signed-in Via Mochi account. Refunds come from
  Google's list of voided purchases, which the API checks on a schedule.
- **The Play Billing library** is called through a small Capacitor plugin. Choosing between writing our own (a few
  hundred lines of Kotlin, no new service) and an existing free open-source plugin is part of step 5 below. A paid
  service such as RevenueCat is not needed, since our server already keeps the ledger.
- **Buying stays off** (`BUYING` in `flags.ts`) until you say the Store opens. The Android app can ship to testers
  and even to the public with buying off.

## Google Play requirements

- **Developer account:** personal, in your name, $25 once, with ID verification. Google shows the developer's name,
  and for a game that sells items in the EU, a contact address and email, on the store page. We should check exactly
  what is shown before signing up, and use a Via Mochi email and, if possible, a business address.
- **Closed test:** at least 12 testers opted in for 14 days in a row before you can apply for public release.
  Friends, family and the playtest group are enough. Each needs an Android phone and a Google account.
- **Target Android version:** Google requires new apps and updates to target a recent Android version (currently
  Android 15, API 35, moving to Android 16). Capacitor keeps up with this.
- **Content rating** (IARC questionnaire): "in-game purchases, no random items".
- **Data safety form:** what we collect (email, age confirmation, game data), matching the Privacy policy.
- **Account deletion:** Google requires a way to delete an account both in the app and on a web page. The game
  already has in-game account deletion; we need to confirm there is also a web link.
- **Store listing:** icon, feature graphic, at least 2 screenshots per device type, a short and a full description.

## Shared with Steam

These decisions affect both ports. The Steam port should follow them, or change them here for both:

1. **Same game, thin shells.** Capacitor for phones, Electron for Steam. No platform forks of the game code.
2. **`platform.ts`** as the single seam, with one interface both shells implement.
3. **An "app" build** of `apps/web` for both shells: art bundled, no web-only parts (install prompts, the Paddle
   checkout, links to the website's Store).
4. **The API and viamochi-id must accept the apps.** Capacitor's origin is `https://localhost`; Electron's will be
   its own. Both need to be added to the allowed origins of `fruitcats-api` and viamochi-id in one batch, told to
   the accounts session first, per the shared services rule.
5. **One receipt endpoint** in `fruitcats-api` for every store (web through Paddle, Google Play, Steam, later Apple),
   all writing to the same ledger.
6. **Sign-in:** the email code everywhere. Steam's own sign-in and Google's are not needed for launch.

## Work in order

| # | Step | What gets done | Needs from you |
|---|---|---|---|
| **1** | **Setup** | Android Studio, the SDK and an emulator on this PC; check virtualization is on | Approve installing Android Studio (about 3 GB) |
| **2** | **Shell** | `apps/android` Capacitor project; the "app" build; the game runs in the emulator, plays a match against the computer, signs in | — |
| **3** | **First-class** | Back button, edge to edge, icon, splash, sound on pause, haptics, share and save to gallery, QR camera, secure token storage, links; the allowed origins added to the API and viamochi-id | Nothing, but the origins change is a shared services deploy |
| **4** | **Real phone and closed test** | Test on the phone; signed release build; Play Console listing; closed test with buying off; the 14-day clock starts | Buy the phone; create the Play developer account; invite 12+ testers |
| **5** | **Play Billing** | Play products that mirror the catalog; the billing plugin; receipt check and refunds in the API; test purchases with license testers | A Google Cloud service account linked to Play Console |
| **6** | **Public release** | Apply for production after the closed test; content rating, data safety, listing; release with buying off or on | Your go on buying |

Step 4 can start before the web Store launches, because the closed test runs with buying off. That takes the
14-day wait off the critical path.

## Open questions

- What Google shows publicly about a personal developer (address) when the game sells items, and whether a
  business address can be used.
- Whether Android tablets and Chromebooks should be supported at launch. Supporting them costs little, since the
  game already adapts to screen size.
- Whether to build the iPhone app at the same time. Capacitor makes it the same project, but building for iPhone
  needs a Mac and an Apple developer account ($99 per year).
