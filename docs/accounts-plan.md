# Accounts plan: one Via Mochi account

This document covers the **Via Mochi account**: the one account system for Fruitcats (and later other Via Mochi
apps). It comes **before** the Store, because accounts are needed anyway. Today decks, the Showcase and progress
live only in the browser's storage, so a deck built on the iPad isn't there on the web. The Store builds on this;
see [store-plan.md](store-plan.md). Other features still to build are in [future-plans.md](future-plans.md).

Last updated 2026-09-24.

## Decisions

| Topic | Decision |
|---|---|
| **One system** | One Via Mochi account for everything. The mochi suite's invite-only accounts are **not** reused: nothing (code, data, resources) is taken from the suite. The suite may switch to Via Mochi accounts later, as its own project. |
| **Who needs an account** | Nobody, to play **solo**: solo is always open. Collection (and the deck builder), Showcase, wallpapers, PvP, friends and the Store need an account. |
| **Identity** | **An account is an email.** One email = one account, the same on every platform. No guests with collections, no platform profiles, no linking, no merges. |
| **Sign-in** | A 6-digit **email code**, typed inside the game. No passwords, no browser. Passkeys (Face ID, Windows Hello) later. No Steam, Game Center, Apple or Google sign-in at launch. |
| **Engine** | **Microsoft Entra External ID, native authentication**: free up to 50,000 monthly active users, then $0.01625 each. Built so it can be swapped for our own (see [Portability](#portability)); the choice is revisited near 50k users. |
| **Our service** | `viamochi-id` (new repo, ASP.NET Core, written fresh): our user id, profile, avatar, friends, and the exchange of Entra tokens for our own. |
| **Azure** | A new pay-as-you-go subscription, **ViaMochi Production**, in West US 3. Nothing runs on the Visual Studio subscription, which becomes a sandbox. |
| **Sellable** | Fruitcats can be sold by transferring the subscription and the player tenant. Nothing personal comes along (see [Selling Fruitcats](#selling-fruitcats)). |
| **Deploys** | Local scripts under a deploy-only identity. No GitHub Actions. |
| **Observability** | Our own logs and metrics in Blob and Table Storage, a CLI for agents and a small portal. No Application Insights. |
| **Cost** | About **$18–33 a month** at launch. Guardrails instead of a hard cap, which Azure doesn't offer. |

## Done so far (2026-09-24)

- Two-step verification and a passkey on the owner's Microsoft account.
- Subscription **ViaMochi Production** `32564bc0-941d-4aa9-9b15-5b3a85c57693` (pay-as-you-go), in Default Directory.
- Resource group `rg-viamochi-tenant` (West US 3).
- Player tenant **Via Mochi Players**: `viamochiplayers.onmicrosoft.com`, tenant id
  `b795dd5c-aa4f-43e2-ab15-5e0bf0cdcff4`, billed per monthly active user to ViaMochi Production.
- Resource providers registered (Web, Storage, Key Vault, Communication, Insights, cost management, automation, and so on).
- **Agent identity** `claude-agent-viamochi` (app id `b224f78d-5fdb-49fd-9fa0-0e64fccae134`), certificate in
  `~/.azure-viamochi-agent` (readable only by the owner's Windows user, expires 2027-09). Roles on the subscription:
  - custom **Via Mochi Agent**: Contributor without any `Microsoft.Authorization` writes, budget or cost-management
    changes, or subscription cancel/rename
  - **Role Based Access Control Administrator** with a condition: it may grant only Storage Blob/Table Data
    Contributor/Reader, Key Vault Secrets/Crypto User/Officer and Website Contributor, and only to service principals
- **Player-tenant agent** `claude-agent-players` (app id `9ee8cdb9-06d4-4609-9963-7a86f67372c9`) in Via Mochi
  Players, certificate in `~/.azure-viamochi-agent-players`, created with
  [scripts/setup/players-agent.ps1](../scripts/setup/players-agent.ps1). Microsoft Graph application permissions:
  Application.ReadWrite.All, IdentityUserFlow.ReadWrite.All, CustomAuthenticationExtension.ReadWrite.All,
  EventListener.ReadWrite.All, Policy.ReadWrite.AuthenticationMethod, Policy.ReadWrite.AuthenticationFlows,
  User.ReadWrite.All.
- **Azure Policy** on the subscription: deny expensive resource types (VMs, AKS, databases, AI services, firewalls,
  Front Door/CDN, Application Insights, Log Analytics and others); allowed locations West US 3, West US 2, United
  States, global; App Service plans limited to Free/Shared/Basic with at most 2 instances.
- **Budget** `viamochi-monthly`: $200 a month, alerts at $50, $100 and $200 actual, and at a $200 forecast. Each goes
  to the owner by email **and text**, through the action group `ag-owner-alerts` in `rg-viamochi-shared`. What to do
  then: [emergency-stop.md](emergency-stop.md).
- **Deploy identity** `deploy-viamochi` (app id `5ed3e9dc-72f3-4b75-a9ec-797fbe0d0126`), certificate in
  `~/.azure-viamochi-deploy`, created with [scripts/setup/deploy-identity.ps1](../scripts/setup/deploy-identity.ps1).
  Its only rights: Website Contributor on `viamochi-id` and `fruitcats-api`.
- A **$300 emergency-stop** budget alert (150% of the budget) goes to its own action group, `ag-emergency-stop`,
  which texts and emails **and runs the Logic App `la-emergency-stop`, which stops both apps** (its identity may only
  stop those two). Tested: both stopped, then were started again. See [emergency-stop.md](emergency-stop.md).
- The temporary setup sign-ins were deleted. Only the three restricted identities remain.
- **Resources** (compute and data in **West US 2**: West US 3 had no Basic capacity on 2026-09-24):
  - `rg-viamochi-apps`: plan `asp-viamochi` (B1 Linux), apps `viamochi-id` (.NET 10) and `fruitcats-api` (Node 22),
    each with a system-assigned identity, Always On, HTTPS and TLS 1.2 only, FTP and basic-auth publishing off
  - `rg-viamochi-id`: storage `viamochiidstore` (shared keys off, 14-day soft delete) and Key Vault
    `viamochi-id-kv` (RBAC, purge protection) with the RSA key `token-signing`
  - `rg-fruitcats`: storage `fruitcatsdata` (same settings) and the playtest site `fruitcats-playtest` (Static Web
    App, Free, `polite-sea-0773d4b1e.3.azurestaticapps.net`)
  - Each app's identity can use only its own storage; only `viamochi-id` can sign with the key.
  - **Email:** Email Communication Service `viamochi-id-email` with the custom domain `mail.viamochi.com`, verified
    (domain, SPF, DKIM, DKIM2), linked to Communication Services `viamochi-id-comms` (data in the US). Sender
    **"Via Mochi" `<no-reply@mail.viamochi.com>`**.
  - **DNS** (Stage 1, in the old zone, with the owner's login): `TXT mail` (verification and SPF) and two DKIM
    CNAMEs under `mail`. The zone has a `CanNotDelete` lock, `protect-viamochi-dns`.
- **Player tenant configured** (through Graph, as `claude-agent-players`):
  - App **Fruitcats**: app id `1ed2eaf3-3330-4328-9ca3-1519f681b6a2`, public client, native authentication on,
    exposes the scope `api://1ed2eaf3-3330-4328-9ca3-1519f681b6a2/play`.
  - Custom attribute `extension_6758f33d2f4d4c119a640bcbadfe8dc5_BirthYear`.
  - Sign-up flow **Via Mochi email code** (`1e0be588-7313-4903-8b87-746e1f464393`): email one-time code, collecting
    display name and birth year, linked to the Fruitcats app.
  - Native-auth base URL: `https://viamochiplayers.ciamlogin.com/viamochiplayers.onmicrosoft.com`. Entra's codes
    are **8 digits**. `challenge_type` must be sent as `oob%20redirect` (a `+` for the space is rejected).
- **Code emails from `no-reply@mail.viamochi.com`:**
  - Entra's email-OTP custom extension (`b2656d02-…`, listener `63d3ab3c-…`, only for the Fruitcats app) calls
    `viamochi-id` `/otp-email` for each code. The endpoint sends our own email and falls back to Entra's sender on error.
  - It authenticates as the app **Via Mochi code email** (`3837bef9-3f4a-49e0-93cf-c31c879d211d`), which needs the
    Graph permission `CustomAuthenticationExtension.Receive.Payload` with **admin consent (granted by the owner)**.
  - The Communication Services connection string is the Key Vault secret `email-connection-string`, read by the app
    through a Key Vault reference.
- **Playtest build:** `npm run build:playtest` builds `apps/web` with the flags in `src/flags.ts` on (`ACCOUNTS`),
  into `dist-playtest/`. The public `npm run build` compiles them out.
- A separate "Via Mochi" workforce directory was tried and dropped: Microsoft now requires a paid Entra ID P1
  license in the home directory to create one. Isolation comes from the subscription instead.

## The player's experience

The same on web, iPhone, iPad, Android and Steam, always in the game's own screens.

- **First launch:** straight to Home. Solo works immediately with the starter decks.
- **Home tiles:**
  - **Solo:** always open. It plays every deck you have: starter, custom and bought. Before you have an account
    there are only the starter decks, because custom decks are built in the Collection and bought ones come
    from the Store.
  - **Collection, PvP, Friends, Store:** signed out, each shows a small lock. Tapping it opens **"Sign in or create
    account"**, with one line on why: "Your collection, friends and purchases live in your Via Mochi account, on
    every device."
- **Sign in or create account** (one screen, so there's no sign-up versus sign-in to get wrong):
  1. Type your email.
  2. If the email is new, the same window asks for a display name, birth year (13+) and agreement to the Terms.
  3. Type the 8-digit code from the email.
  - Every code email says which account it's for: "Your Fruitcats sign-in code for ann@example.com".
- **After that the device stays signed in.** It asks again only after you sign out or reinstall.
- **Lost or new device:** there's nothing to recover. On any device, the same email and a new code sign you in, and
  everything is there, because it lives in the account, not on the device. There's no password to forget.
- **The email is permanent.** An account's email can't be changed. (If that's ever needed, it gets designed then.)
- **Example: an iPad deck on the web.** On the web, sign in with the same email and code; the iPad's decks appear.
- **Example: years on Steam, then a phone.** On the phone: email and code, and everything is there. Steam is only
  where you paid.
- **Players who already have decks today:** on their first sign-in on that device, the local decks and Showcase are
  uploaded once into the account (a deck with the same id keeps the newer version), then the local copies are
  cleared.
- **Friends:** Home → Friends lists them with avatars. "Add a friend" shows your friend code and QR code, or you
  type theirs.
- **Account screen:** avatar (a cat portrait or your own picture) and display name, the email (shown, not
  changeable), sign out, sign out on all devices, export data, delete account (30-day grace period, then deleted).
- **Sync:** each deck is stored with an `updatedAt`, and the newest wins. Offline edits wait in a queue. Sync runs at
  start, on return to the foreground and after each edit.
- **The one way to be locked out** is losing the email account itself. The email can't be changed, so such an
  account can't be recovered by the player; the Terms tell players to keep their email secure.

### Store rules this satisfies

- **Apple 5.1.1(v)** ("let people use it without a login" unless features are account-based): solo needs no login.
  The locked features are account-based: the collection lives in the account and is shared with web, Android and
  Steam, and custom and bought decks exist only there. Put this in the App Review notes.
- **Apple 4.8** (offer Sign in with Apple if you offer another third-party sign-in): not triggered, because we use
  only our own account system.
- **Purchases** always belong to an email account, on every store.

## `viamochi-id`: the account service

- **New repo** `viamochi-id`, ASP.NET Core, written fresh.
- **Holds who a person is, and who their friends are.** Nothing that belongs to a single app.
  - **Identity:** our user id (a Guid), the mapping to Entra's user id, email (our own copy), display name, age flags,
    Terms version accepted.
  - **Avatar:** in its own Blob Storage, served from `id.viamochi.com/avatars/{id}`.
  - **Friends:** requests, friend codes (15 minutes, single use), unfriending, blocking.
  - **Not held:** decks, purchases, anything app-specific.
- **Small, fixed API:** `/token` (exchange), JWKS, `/me` (get and delete), `/me/avatar`, `/friends`, `/users/{id}`
  (public profile: name and avatar only; email is never shown to friends).
- **Changes rarely:** tests required, a staging slot, releases from git tags.

## Portability

Entra now; our own engine later if it pays off. Players must not notice a switch.

1. **Our own user id everywhere.** Decks, friends, entitlements, the purchase ledger and logs use only our Guid,
   never Entra's id.
2. **Apps trust only `id.viamochi.com`.** The game gets an Entra token, then exchanges it at `id.viamochi.com/token`
   for a short-lived (1 hour) Via Mochi token, signed by a Key Vault key that never leaves the vault. The Fruitcats
   API and every other app check only our keys.
3. **One sign-in module in the game**, `apps/web/src/auth.ts`: `startSignIn(email)`, `submitCode(code)`,
   `getToken()`, `signOut()`. The Entra SDK sits behind it and nothing else uses it.
4. **Our own copy of every email.** There are no passwords, so moving means sending codes to the same addresses.
5. **Review at 40k active users,** before the paid tier starts at 50k.

## Azure layout

| | What |
|---|---|
| Directory | **Default Directory** (the owner's), used only for management identities. |
| Subscription | **ViaMochi Production** `32564bc0-…`, pay-as-you-go, West US 3. |
| `rg-viamochi-tenant` | The **Via Mochi Players** External ID tenant. |
| `rg-viamochi-apps` | **One App Service plan** (B1 Linux) running three apps, each with its own managed identity: `viamochi-id`, `fruitcats-api` and `mochi-ops`. |
| `rg-viamochi-id` | `viamochi-id`'s storage, Key Vault, email service (`mail.viamochi.com`), logs and metrics. |
| `rg-fruitcats` | A new Static Web App for the game, storage for decks, Showcase and progress (later the store tables), the geo-redundant purchase ledger, and a Key Vault. |
| `rg-viamochi-shared` | Later: the `viamochi.com` DNS zone (see [DNS](#dns-in-two-stages)). |

- **Why a new subscription:** the Visual Studio subscription is a dev/test benefit that doesn't allow production use
  and stops when its credit runs out. Paid players can't depend on it.
- **One shared server plan** at launch. Sign-in itself runs at Microsoft, so our server having a bad moment doesn't
  stop anyone signing in. If load grows, `viamochi-id` moves to its own plan (+$12 a month), which is a settings
  change.

### Operating it

- **The owner's own `az` login is never used for the new subscription.**
- **Claude manages Azure as its own identity** ("claude-agent-viamochi"): a service principal with a certificate,
  used through its own CLI folder (`AZURE_CONFIG_DIR=~/.azure-viamochi-agent`). It has the custom "Via Mochi
  Agent" role (Contributor minus permissions, budgets and subscription changes), plus the right to grant only the
  data and deploy roles apps need. It can't change Azure Policy, budgets or its own rights.
  - The Azure CLI can't use the Windows certificate store, so its key is a PEM file in that folder, readable only by
    the owner's Windows user. The certificate expires after a year and is renewed by the owner.
- **Deploys:** `scripts/deploy.ps1 <app>` signs in a deploy-only identity (it can push code to the apps and nothing
  else) in its own CLI folder, builds and uploads. No GitHub Actions.
- **Setup** used a one-time sign-in in a separate, temporary CLI folder, deleted afterwards.

### Selling Fruitcats

The rule: **Fruitcats depends on Default Directory only for replaceable management identities.** Player accounts live
in the player tenant; all data and configuration live in the subscription. To transfer:

1. Transfer billing ownership of the subscription to the buyer. It moves into their directory with every resource.
2. Add the buyer as administrator of the player tenant, then remove yourself.
3. The buyer re-creates the agent and deploy identities, re-enables the apps' managed identities and their roles,
   updates the Key Vault directory id, and switches the ops portal's sign-in.

Your personal-project users never move.

## Email

- **Codes come from `no-reply@mail.viamochi.com`**, display name "Via Mochi", through `viamochi-id`'s own email service
  (Entra's custom email extension). The mochi suite keeps sending from `viamochi.com` through its own service.
- **DNS records:** `TXT mail` (verification and SPF) and two DKIM CNAMEs under `mail`. The root `_dmarc` covers it.
- **Before launch:** new domains start with low sending limits; ask for a quota increase and send real test mail for a
  couple of weeks. Code emails are plain text with the code in the subject.
- **Replies:** `no-reply@` receives nothing. A support inbox is an open question (the Store needs one too).

### DNS in two stages

- **Stage 1 (now):** the `viamochi.com` zone stays in the Visual Studio subscription with a delete lock. Records for
  `fruitcats`, `id`, `ops` and `mail` point at the new resources.
- **Stage 2 (before relying on it for paying players):** recreate the zone in ViaMochi Production with every record,
  switch the nameservers at the registrar, delete the old zone. Resources can't move between directories, so it's a
  copy, not a move. After this, deleting the Visual Studio subscription can't affect Fruitcats.

## Observability

- **Writing:** each service writes JSON-lines events to append blobs in its own storage,
  `logs/<category>/<service>/yyyy/mm/dd/hh-<instance>.jsonl`, flushed every ~10 seconds. Per-minute counters go to a
  monthly table. The game sends batched telemetry to the Fruitcats API.
- **Reading:** `tools/ops`, a CLI for agents (events, tail, metrics, one player's timeline), and **Mochi Ops**, a small
  portal on the shared plan with dashboards, search and a Purchases view, signed in as the owner only.
- **Alerts:** free platform metrics (errors, CPU, restarts), plus the ops app checking counters every 5 minutes and
  emailing the owner.
- **Cost:** under $5 a month.

### Log retention

| Category | What | Kept for |
|---|---|---|
| `debug` | Detailed traces, only while debugging is on | 7 days |
| `ops` | Requests, app events, errors | 30 days |
| `telemetry` | Raw events from players' devices | 30 days |
| `security` | Sign-ins, email changes, account deletion, admin actions, grants and revokes | 1 year, tamper-proof |
| `purchases` | Every purchase, refund, chargeback, grant and revoke | **Forever**, tamper-proof and geo-redundant |
| metrics | Counters, no personal data | per-minute 90 days, hourly 2 years, daily forever |

- **Enforced for free:** blob lifecycle rules per category; one metrics table per month, dropped when expired;
  immutability on `security` (1 year) and a legal hold on `purchases`.
- **Never logged:** emails, names, codes, tokens, text players type (deck names), payment details. Only our random
  account id; IP addresses only in `security`.
- **After an account is deleted** its id points to no one, so remaining lines are anonymous. That is also why the
  purchase ledger can be kept forever.
- **Store records** (orders, entitlements) are kept for the tax period under the store plan.
- **Daily size ceiling:** past it only `security`, `purchases` and errors are written. `purchases` is never dropped.

## Cost

| Where it goes | Low | High |
|---|---|---|
| Server (one App Service plan, three apps) | $12 | $12 |
| Game website (Static Web App, Free or Standard) | $0 | $9 |
| Storage (logs, metrics, decks, ledger) | $2 | $6 |
| Email (codes) | $1 | $3 |
| DNS | $1 | $1 |
| Other (Key Vault, alerts) | $1 | $1 |
| Player accounts (up to 50k active) | $0 | $0 |
| **Total per month** | **~$18** | **~$33** |

What grows it: active users above 50k ($0.01625 each), website bandwidth above 100 GB ($0.20/GB), bigger servers for
PvP.

### Cost safety

Pay-as-you-go Azure has no hard spending cap, so big bills are designed out:

1. **Fixed-price resources only**, autoscale off.
2. **Limits in our code:** codes per email and per IP, requests per user, a daily email ceiling, a daily log ceiling.
3. **Azure Policy** allows only the resource types and small sizes we use, so a hijacked identity can't start
   expensive machines. Only the owner can change it.
4. **Budgets:** alerts at $50, $100 and $200 a month; at about $300, the App Services are stopped automatically.
   What to do by hand when an alert arrives: [emergency-stop.md](emergency-stop.md).
5. **Alerts** on daily sign-ups (bots), bandwidth and 40k active users.

## Phases

| # | Phase | Result |
|---|---|---|
| **A0** | Owner's steps (account security, subscription), player tenant, agent and deploy identities, Policy and budgets, resource groups, DNS records, email domain | Infrastructure ready |
| **A1** | `viamochi-id`: Entra native auth set up with our email sender, token exchange, user mapping, age check, delete and export, avatars, friends | `id.viamochi.com` live |
| **A2** | Fruitcats API (sync for decks, Showcase, progress), `auth.ts`, the sign-in screen, the Account screen, locked tiles, the one-time upload of local decks, Privacy and Terms pages | **iPad ↔ web decks work** |
| **A3** | *(Optional, the suite's own work)* The mochi suite switches to Via Mochi accounts: family members sign up fresh, invites become family membership | One system everywhere |
| **A4** | The same sign-in in the iPhone, Android (Capacitor) and Steam (Electron) apps, with secure token storage | Every platform |

The Store's phases depend on A2.

## Later: "Continue with Apple" and "Continue with Google"

Not at launch; only if sign-ups drop at the email step. They'd be more ways into the **same** account, never separate
identities, and they come together or not at all (offering Google requires offering Apple).

Things that make them expensive:

- **Apple's Hide My Email** gives us a relay address. A player who later types their real email finds an empty new
  account: the biggest source of support tickets.
- Relay addresses only receive our mail if `mail.viamochi.com` is registered with Apple.
- A verified email from Google or Apple that already has an account must join it, never create a second one
  (never for unverified emails).
- Adding a way in to an existing account needs a fresh email code first.
- Apple sends name and email only on the very first sign-in; save them first.
- Apple notifies us of revoked apps and deleted Apple IDs; account deletion must revoke the Apple token.
- Google: match on its user id, not the email; separate client ids per platform; One Tap backs off after dismissals.
- Apple's client secret expires every 6 months and needs a scheduled renewal.
- Google blocks sign-in inside embedded browsers, so probably not on Steam.
- Privacy Policy additions and a larger test matrix.

## Avatars: Pawtraits

- **Pawtraits** are the account's avatar: round portraits of fruit-hooded cats in the Hero Cat plush style, drawn
  with [tools/generate_avatars.py](../tools/generate_avatars.py) into `art/avatars/`.
- **Everyday Pawtraits:** 12 plain cats, two per fruit family, free for everyone.
- **Legend Pawtraits:** each comes with a Legendary card, as a card-plus-Pawtrait combo. There's no separate avatar
  store. Own the card and its Pawtrait is yours. The first three are:
  - **Mochi**, the Mango Bengal (SB1-H03): open to everyone, because Mochi's card is in a starter deck
  - **Nova**, the Starfruit Voyager (HW1-X02)
  - **Reaper**, the Carolina Sphynx (HW1-X03)
  
  Nova and Reaper are from the Heat Wave draft set.
- **Not exclusive:** any number of players can wear the same Pawtrait.
- **Served by `viamochi-id`**, so every Via Mochi app shows the same face from one address:
  - `GET /avatars`: the catalog
  - `/avatars/<id>.webp`: the images, cached for a week
  - `GET /me`: what the player wears and owns
  - `PUT /me/avatar`: choose one
  
  New accounts get an everyday Pawtrait picked from their id. Legend unlocks are stored per player in the
  `avatarunlocks` table; the app that grants the card will grant its Pawtrait at the same time (with the Store).
- **In the game:** Settings → Account → tap your Pawtrait ("Change") → the picker, with filters **All · Everyday ·
  Legend**. Locked Legend Pawtraits show a lock; tapping one says which card brings it.
- **Later:** photo uploads (need moderation first); the Mochi apps' 16 faces can join the same catalog when they move
  over.

## Legal

- **Terms of Use:** draft in [legal/terms-of-use.md](legal/terms-of-use.md), for lawyer review before real sign-ups.
  The sign-up screen records which version each player accepted.
- **Still to write:** the Privacy Policy (required before collecting any emails) and, with the Store, the Refund
  Policy.

## Open questions

- Passkeys: waiting for Entra to support them with email-code accounts. Then test Windows Hello inside the Steam app.
- A support inbox (players' questions; the Terms and the Store need one).
- Google Play: confirm there's no rule like Apple's against requiring an account before a purchase.
- Confirm during setup: codes sent from `mail.viamochi.com` through Entra's custom email extension, and the
  pass-through Entra's native-auth API needs for web and app clients (it doesn't allow cross-site calls).
