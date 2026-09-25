# Emergency stop: when a cost alert says spending is too high

For when a budget alert (email or text) shows **ViaMochi Production** spending more than you're comfortable with.
Pick the smallest step that stops the cost. Every step can be undone.

Subscription: **ViaMochi Production**, `32564bc0-941d-4aa9-9b15-5b3a85c57693`. Budget: `viamochi-monthly`.

## 0. What already happens automatically

At **$300 in a month** (150% of the $200 budget) the alert group `ag-emergency-stop` texts and emails you **and**
runs the Logic App `la-emergency-stop` (in `rg-viamochi-shared`), which **stops both apps** (`viamochi-id` and
`fruitcats-api`). That halts everything billed per use: sign-in emails, storage traffic, API traffic. Sign-in, sync
and account screens stop working; solo play still works. The server plan itself is a flat ~$12 a month and can't run
away. To bring the apps back once you know the cause: **App Services → each app → Start**. (Tested 2026-09-24.)

## 1. Find what's costing money (2 minutes)

1. [portal.azure.com](https://portal.azure.com) → **Subscriptions** → **ViaMochi Production** → **Cost analysis**.
2. Change the view to **"Daily costs"** and group by **Resource** (or **Meter**).
3. The tallest bar shows the culprit. Then jump to the matching step below.

Or ask Claude: *"Fruitcats cost alert: find what's costing money and stop it"*. Claude can look at the costs with its
own agent identity.

## 2. Stop just the culprit

| What's expensive | Stop it | Effect on players | Undo |
|---|---|---|---|
| **The servers** (App Service plan `rg-viamochi-apps`) | Open the **App Service plan** → **Scale up** → choose **Free (F1)** → Apply. **Stopping the apps alone does not stop this bill; the plan is charged either way.** | Sign-in, sync and the Store stop working. Solo play still works. | Scale back up to **Basic B1**. If Azure refuses to go down to Free (custom domains or Always On aren't allowed there), use step 3. |
| **Website bandwidth** (Static Web App in `rg-fruitcats`) | Static Web App → **Hosting plan** → switch to **Free**. The Free plan has a bandwidth quota instead of paid overage. | The site may stop serving once the quota is used up. | Switch back to Standard. |
| **Email** (Communication Services in `rg-viamochi-id`) | Communication Services resource → **Email → Domains** → **Disconnect** the `mail.viamochi.com` domain. | No sign-in codes are sent, so no new sign-ins. | Connect the domain again. |
| **Player accounts** (Entra External ID above 50,000 active users) | This grows only with real sign-ins. If it's bots: in the player tenant's Entra admin center, turn off **sign-up** in the user flow, and ask Claude to tighten the rate limits. | New players can't create accounts. | Turn sign-up back on. |
| **Storage** (logs, data) | Usually cents. If logs are exploding, ask Claude to lower the daily log ceiling. **Don't delete storage accounts**: they hold the players' decks and the purchase ledger. | None. | — |

## 3. Stop everything at once (the big red button)

If you don't know what's wrong, or it's the middle of the night:

1. **Subscriptions** → **ViaMochi Production** → **Cancel subscription**.
2. Confirm. Everything stops running and **billing stops**.
3. Nothing is deleted immediately. Microsoft keeps the resources and data for **90 days**, during which you can
   **Reactivate** the subscription from the same page and everything comes back.

Effect on players: the whole online side is down (sign-in, sync, the Store). The website may also go down. Solo play
in already-installed apps keeps working.

Use this only when the smaller steps above aren't clear. Reactivating takes a few minutes, and you have to check
afterwards that everything came back.

## 4. Afterwards

- Tell Claude what happened; it can read the logs (`tools/ops`) and find the cause.
- If someone else caused it (a stolen key, abuse), rotate the agent and deploy certificates and review the
  subscription's **Access control (IAM)** list.
- Adjust the budget or alerts if the threshold was wrong. Only you (Owner) can change budgets.
