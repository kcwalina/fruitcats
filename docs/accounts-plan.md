# Accounts plan: still to do

What's left for the Via Mochi account system. Everything already built, and how it works, is in
[accounts.md](accounts.md). The Store has its own plan, [store-plan.md](store-plan.md).

Last updated 2026-09-25.

## Next

1. **Daily ceilings** that stop runaway costs: a cap on code emails sent per day, and on log size per service per
   day (past it, only security events and errors are written).

## Waiting for the owner

These have their own guided sessions ("Guide owner through Via Mochi DNS steps" and "Guide owner through launch
paperwork").

- **DMARC record for `mail.viamochi.com`**, to help code emails out of spam folders.
- **Move the `viamochi.com` DNS zone into ViaMochi Production** (Stage 2 in [accounts.md](accounts.md#dns-in-two-stages)):
  copy every record, switch the nameservers at the registrar, delete the old zone. After this, the Visual Studio
  subscription can't affect Fruitcats.
- **Privacy Policy and Terms:** replace the `[support@viamochi.com]` placeholder with "Contact us" in the game, fill in
  the other placeholders (mailing address), and have a lawyer review both.
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
- **Google Play:** confirm it has no rule like Apple's against requiring an account before a purchase.

## Dates

- **Before 2027-09-24:** renew the player-directory client secret, and the agent and deploy certificates
  ([accounts.md](accounts.md), What's set up).
