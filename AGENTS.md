# AGENTS.md

Conventions for any agent (or human) making changes in this repo. Read before shipping.

## Branches

- **`release`** — the deployed branch. Railway watches this branch and redeploys
  on every push to it (target: <https://floripa-surfer.ghostdubber.com>).
  **All user-visible changes must land here to ship.**
- **`main`** — in-progress / unreleased work. Pushing to `main` does NOT deploy.
  Treat `main` as a staging trunk; nothing here reaches users until it's brought
  over to `release`.

The two branches have diverged historically (different `index.html` metadata,
different deploy config). Do not blindly fast-forward `release` to `main` —
cherry-pick or copy specific files instead.

## Shipping a change

1. Make the change on a feature branch off `release` (or directly on `release`
   for small, low-risk edits).
2. Verify locally with `npm run dev` / `npm test`.
3. Commit using the existing style: short imperative subject, descriptive body
   if the "why" isn't obvious. Co-author trailer is fine.
4. `git push origin release` — Railway picks it up automatically.
5. After the deploy settles, verify the live URL.

If a change lives only on `main`, it is **not shipped**. Bring it over to
`release` (cherry-pick, manual copy, or merge — whichever keeps `release`
clean) before considering it done.

## Deploy config

- `railway.json` — Railway build/start/healthcheck. The branch-to-watch is
  configured in the Railway dashboard, not in the repo.
- `package.json` — `build` and `start` scripts referenced by Railway.

## Asset notes

- Social preview image lives at `public/og-image.png` (1200×630). Generator
  source is in `design/_make_og.py` — re-run that script to regenerate the PNG.
  Update the `og:image:alt` / `twitter:image:alt` strings in `index.html`
  whenever the image content changes.
- Favicon: `public/favicon.svg`.
- 3D model attribution: `public/assets/models/ATTRIBUTION.md`.
