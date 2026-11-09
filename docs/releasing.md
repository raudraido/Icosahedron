# Releasing

One version for every part: desktop, web engine, web app and iOS app share the number in the root `package.json`.

## Steps

1. Create a branch, make the changes, and open a PR to `master`.
2. Bump the version everywhere in one go:

   ```bash
   node scripts/bump-version.mjs 0.15.4
   ```

   It updates the root and `apps/server` `package.json` and lock files. The iOS app reads the root version at build time.
3. Add a section to [CHANGELOG.md](../CHANGELOG.md) (`## 0.15.4`).
4. Merge the PR.
5. Tag the merge commit and push the tag:

   ```bash
   git tag v0.15.4 && git push origin v0.15.4
   ```

## What a `v*` tag does

| Workflow | Result |
|---|---|
| `build.yml` | Builds the Linux AppImage / `.deb` and the Windows installer and **publishes the GitHub Release** (the desktop app's updater offers it to everyone) |
| `ios.yml` | Builds the unsigned iOS `.ipa` and attaches `Icosahedron-<version>-unsigned.ipa` to the same release |
| `server.yml` | Runs the engine's tests and publishes the Docker image `ghcr.io/<owner>/icosahedron-server` as `X.Y.Z`, `X.Y` and `latest` |

## Without releasing

Every build workflow can be started by hand (*Actions → pick the workflow → Run workflow*, `workflow_dispatch`) on any branch. This produces the artifacts without creating a release or pushing `latest`.

- `server.yml` also publishes `edge` from `master`.
- `ios.yml` builds on PRs that touch `apps/ios/**`.

## One-time setup

- **Docker image visibility:** the first published package is private by default. In GitHub: *your profile → Packages → icosahedron-server → Package settings → Change visibility → Public*, so that anyone can `docker pull` it.
- **Release permissions:** the workflows use the built-in `GITHUB_TOKEN` with `contents: write` / `packages: write`; no extra secrets are needed.

## After a release

- Update the deployed engine: `docker compose pull && docker compose up -d`.
- Re-sign the iOS app on your devices with the new `.ipa` (and every 7 days with a free Apple ID).
