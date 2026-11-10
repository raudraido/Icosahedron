# Releasing

Every product has its own version, tag, changelog and release. Nothing forces them to move together.

| Product | Version lives in | Tag | Changelog | Release contains |
|---|---|---|---|---|
| **Desktop app** | root `package.json` | `vX.Y.Z` | [CHANGELOG.md](../CHANGELOG.md) | Linux AppImage / `.deb`, Windows installer |
| **Server** (engine + the web app it serves) | `apps/server/package.json` | `server-vX.Y.Z` | [apps/server/CHANGELOG.md](../apps/server/CHANGELOG.md) | the Docker image `ghcr.io/<owner>/icosahedron-server` (`X.Y.Z`, `X.Y`, `latest`) |
| **iOS app** | `apps/ios/VERSION` | `ios-vX.Y.Z` | [apps/ios/CHANGELOG.md](../apps/ios/CHANGELOG.md) | unsigned `.ipa` |
| **Android TV app** | `apps/android-tv/VERSION` | `android-vX.Y.Z` | [apps/android-tv/CHANGELOG.md](../apps/android-tv/CHANGELOG.md) | `.apk` |

The web app has no number of its own: it is built into the server image, so it carries the server's version (Settings → System → About shows it). Which versions work together is described by protocol numbers, not version numbers: see [compatibility.md](compatibility.md).

## Steps (any product)

1. Create a branch, make the changes, and open a PR to `master`.
2. Bump that product's version:

   ```bash
   node scripts/bump-version.mjs <desktop|server|ios|android> X.Y.Z
   ```

   It updates the product's version file(s) and prints the tag to use.
3. Add a `## X.Y.Z` section to the product's changelog. **Its text becomes the text of the GitHub release** (`scripts/release-notes.mjs` cuts it out), so write it for the people who read the release.
4. Merge the PR.
5. Tag the merge commit and push the tag (the tag must equal the version, the workflow checks it):

   ```bash
   git tag server-v0.17.0 && git push origin server-v0.17.0
   ```

## What a tag does

| Tag | Workflow | Result |
|---|---|---|
| `vX.Y.Z` | `build.yml` | Builds the desktop packages on Linux and Windows runners and **publishes the release** that the desktop app's updater offers (it only considers `vX.Y.Z` releases) |
| `server-vX.Y.Z` | `server.yml` | Runs the engine's tests, publishes the Docker image as `X.Y.Z`, `X.Y` and `latest`, and creates the release with the changelog text |
| `ios-vX.Y.Z` | `ios.yml` | Builds the unsigned `.ipa` and publishes it as a release |
| `android-vX.Y.Z` | `android.yml` | Builds the `.apk` and publishes it as a release |

## Without releasing

Every build workflow can be started by hand (*Actions → pick the workflow → Run workflow*, `workflow_dispatch`) on any branch. This produces the artifacts without creating a release or pushing `latest`.

- `server.yml` also publishes `edge` from `master`.
- `ios.yml` and `android.yml` build on PRs that touch their app.

## One-time setup

- **Docker image visibility:** the first published package is private by default. In GitHub: *your profile → Packages → icosahedron-server → Package settings → Change visibility → Public*, so that anyone can `docker pull` it.
- **Release permissions:** the workflows use the built-in `GITHUB_TOKEN` with `contents: write` / `packages: write`; no extra secrets are needed. (The Android app can use signing secrets, see [android-tv.md](android-tv.md#updating).)

## After a release

- **Server:** update the deployed engine: `docker compose pull && docker compose up -d`. This also updates the web app.
- **iOS:** re-sign the app on your devices with the new `.ipa` (and every 7 days with a free Apple ID).
- **Android TV:** install the new APK.
