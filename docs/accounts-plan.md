# Accounts plan: still to do

What's left for the Via Mochi account system. Everything already built, and how it works, is in
[accounts.md](accounts.md). The Store has its own plan, [store-plan.md](store-plan.md).

Last updated 2026-09-25.

## Waiting for the owner

Each has its own guided session: "Guide owner through the lawyer review", and "Guide owner through launch paperwork" for the email limit. The DNS steps are done (2026-09-25):
`_dmarc.mail` added, domain auto-renew on, and the zone stays where it is (see
[accounts.md](accounts.md#the-domain-and-its-dns)).

- **Privacy Policy and Terms:** a lawyer review of both. The placeholders are filled (2026-09-24): every contact
  route is Contact us (on viamochi.com, no account needed); the documents name "Via Mochi (viamochi.com)", with no
  personal name and no mailing address; no marketing emails at launch. What's left in brackets is for the lawyer.
- **Higher email sending limit:** an Azure support request for the `mail.viamochi.com` domain, before sign-up opens
  to everyone.

## Before sign-up opens to everyone

- Remove the playtest invite codes (the `ViaMochi__Invites__*` settings on `viamochi-id`); the invite step then
  disappears by itself.
- The items under "Waiting for the owner" are done.

## Later, when needed

- **Native apps** (App Store, Google Play, Steam): the same sign-in inside each, with the token in the device's
  secure storage (Keychain, Keystore, Electron safeStorage). The game added to a phone's Home Screen already works.
- **Passkeys** (Face ID, Touch ID, Windows Hello) once Entra supports them for email-code accounts; then test Windows
  Hello inside the Steam app.
- **"Continue with Apple" and "Continue with Google"**, only if sign-up drop-off shows they're needed. The design and
  its pitfalls are in [accounts.md](accounts.md).
- **Photo Pawtraits** (uploads), after moderation exists.
- **The Mochi family apps** moving onto Via Mochi accounts: optional, the suite's own project.
- **Moving `viamochi.com` out of the Visual Studio subscription:** only by transferring the domain to an outside
  registrar where the owner already has an account, then copying the zone into `rg-viamochi-shared`.
- **Google Play:** confirm it has no rule like Apple's against requiring an account before a purchase.

## Dates

- **Before 2027-09-24:** renew the player-directory client secret, and the agent and deploy certificates
  ([accounts.md](accounts.md), What's set up).
