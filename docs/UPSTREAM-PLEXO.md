# Upstream: Plexo (anmolkapil/plexo)

Lightning is a fork of Plexo. Plexo is the parent repository on GitHub
(`gh repo view alisinaee/Lightning --json parent` shows it). Plexo keeps shipping core and bug
fixes, and we pull the safe ones into Lightning. This file is the job description for that work,
so any agent or person doing it follows the same steps.

## Remotes

- `origin` = `https://github.com/alisinaee/Lightning.git` (ours)
- `upstream` = `https://github.com/anmolkapil/plexo.git` (Plexo)

If `upstream` is missing: `git remote add upstream https://github.com/anmolkapil/plexo.git`

## Fetch

Fetch the branch only. Do not fetch Plexo's tags: its `v1.0.0-rc.*` tags clash with ours and
git refuses to overwrite them.

```bash
git fetch upstream main --no-tags
```

## Find what is new

Plexo's latest release tags are listed with `git ls-remote --tags upstream`. The unported work is
the commits on `upstream/main` that our history does not contain:

```bash
git log --since=<date of last sync> --no-merges --format='%h %ad %s' --date=short upstream/main
```

Use the date of the last port we made from Plexo (the newest "Port upstream" commit on `main`,
`git log --grep=upstream -i`). Plexo's merge commits are not ported directly: their commits are.

## Decide: safe to take

Take a Plexo commit only when all of these hold:

1. It is a fix, a performance change or a small core change. Skip features that Plexo builds
   for its own product direction (Usenet, Telegram, landing page, website, funding, CNAME, extension
   store listings, privacy page), unless the user asks for them.
2. It applies cleanly: `git merge-tree --write-tree --merge-base=<sha>^ HEAD <sha>` exits 0.
3. It does not touch files with uncommitted work on `main` (compare `git status --short`).
4. Typecheck and the e2e specs that cover the area pass (see below).

Commits that conflict are not taken blindly. Port them by hand, keeping our code, and mention it
in the commit message. Report conflicts to the user rather than guessing.

## Rebrand rules when porting

Lightning renamed Plexo. When a ported commit uses Plexo names, rename them to our names:

- The e2e fixture is `lightning`, not `plexo` (`e2e/fixtures.ts`).
- The app is `Lightning`; keep our bundle ids, product names and URLs.
- Do not bring Plexo's website, landing page or release URLs (`getplexo.app`).

## Apply

Cherry-pick in the upstream order, with `-x` so the source is recorded:

```bash
git rev-list --reverse --no-merges upstream/main | grep -E '^(<sha1>|<sha2>)' | xargs git cherry-pick -x
```

Cherry-pick needs no uncommitted changes in the files it touches. Keep the user's uncommitted work
out of these commits.

## Verify

```bash
npm run typecheck:node && npm run typecheck:web
npx eslint <changed files>
npx playwright test <specs for the touched area>
```

The e2e specs run the built app; they take a few minutes. Run the ones named after the touched
code (download, probe, torrent, format, youtube).

## Record

After a sync, update the status below with the upstream commit reached and the date, and list
the commits that were skipped on purpose with the reason.

## Status

- Last upstream commit reviewed: `2e44a2f` (Plexo `main`, 2026-11-06)
- Ported from Plexo in the last sync (all clean, all verified with the e2e specs above):
  `fd22a88`, `3eba463`, `481e529`, `022ef29`, `3f4c908`, `6c72334`, `899d99b`, `da179d6`
  (landed as `033536f`, `f509663`, `35da209`, `464066e`, `d743b11`, `19dccbf`, `1a1fa86`, `c32c8b7`)
- Ported by hand in the sync after that (2026-11-07): `4397c76` (ranges after a redirect),
  `2d2132f` (range-reporting hosts), `7cc640e` (translated refusals during a transfer), `a101497`
  (NFC home path, smaller than upstream: no separator rewrite), and `b6b263a` (E2E count, cherry-picked).
- Already in our code, nothing to port: `884683f`, `7a9b1b4`, `7795d03`, `b258555`, `1b805b8`,
  `4995e05`, `c2e8a39`, `3947503`, `96e7ef1`, `e65fc4c`, `f928dac`, `7a06ad1`, `2ffd681`, `9ce20c7`,
  `e184f75`, `8cc15e4`, `f140129`, `5366a8c`, `84752c3`, `873cef9`.
- Skipped on purpose: `f060843` (new empty-network message is UI, not ported), `3f1133b`
  (tray and reveal features we never took), `ef81b53` (`calendar.tsx` deleted in our tree),
  `131c143` and `3272d6b` and `aac0b97` (test-only), `d4d3168` and `e8b84b6` rest and `746ccd5`
  (need the user's decision).
- Plexo features since the last sync, not taken: Usenet, Telegram Saved Messages, NZB, landing and
  website work.
