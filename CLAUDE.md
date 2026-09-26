# fruitcats

Many sessions work on this repo at once, each in its own worktree, and all of them push to `main` and deploy.
Features, and once possibly a security fix, went missing from the live site because one session's deploy or merge
replaced another's. The scripts below enforce the rules that prevent it. Follow them, and never work around a refusal.

## Shipping a change (the site)

1. Commit your work.
2. `npm run deploy`. It merges origin/main in, checks, pushes to main, and only then uploads. What goes live is
   always exactly origin/main.
3. If it stops, fix what it says and run it again. Never deploy by hand (swa-cli, `az`), and never
   `--no-verify`, force-push, or reset main.

## Merging origin/main

- Merge (`git merge origin/main`); don't rebase onto it. The checks can read a merge and see what it dropped.
- In a conflict, the other side is work that is already on main and may be live. Keep both sides. Never resolve a
  whole file with "ours" or "mine".
- If you really mean to remove or change code another session wrote, do it in a separate commit after the merge,
  with a message that says why.

The pre-push hook (`.githooks/pre-push`) and `npm run deploy` both run `scripts/git/lost-work.mjs`. It refuses a
merge that drops lines the other side added, or brings back lines the other side deleted. To check by hand:
`node scripts/git/lost-work.mjs origin/main..HEAD`.

## fruitcats-api

`npm run deploy -w @fruitcats/api` deploys only origin/main (push first), one deploy at a time, and refuses if the
live API runs a commit this checkout lacks (`/version`). Tell the accounts session before deploying it.

## Security fixes

Every security fix gets a test that fails without the fix. Tests run on every deploy, so a fix that goes missing
stops the next deploy, instead of silently reopening the hole.
