# Releasing

Every product has its own version, tag, changelog and release. Nothing forces them to move together.

| Product | Version lives in | Tag | Changelog | Release contains |
|---|---|---|---|---|
| **Desktop app** | root `package.json` | `vX.Y.Z` | [CHANGELOG.md](../CHANGELOG.md) | Linux AppImage / `.deb`, Windows installer |
| **Server** (engine + the web app it serves) | `apps/server/package.json` | `server-vX.Y.Z` | [apps/server/CHANGELOG.md](../apps/server/CHANGELOG.md) | the Docker image `ghcr.io/<owner>/icosahedron-server` (`X.Y.Z`, `X.Y`, `latest`) |
| **iOS app** | `apps/ios/VERSION` | `ios-vX.Y.Z` | [apps/ios/CHANGELOG.md](../apps/ios/CHANGELOG.md) | unsigned `.ipa` |
| **Android TV app** | `apps/android-tv/VERSION` | `android-vX.Y.Z` | [apps/android-tv/CHANGELOG.md](../apps/android-tv/CHANGELOG.md) | `.apk` |
| **Android phone app** | `apps/android/VERSION` | `android-phone-vX.Y.Z` | [apps/android/CHANGELOG.md](../apps/android/CHANGELOG.md) | `.apk` |

The web app has no number of its own: it is built into the server image, so it carries the server's version (Settings → System → About shows it). Which versions work together is described by protocol numbers, not version numbers: see [compatibility.md](compatibility.md).

## Branches and pull requests

- **One branch per change**, named `<area>/<short-description>`: `desktop/`, `server/`, `ios/`, `android/` (phone), `android-tv/`, `docs/`, `ci/`. Examples: `android/rail-player`, `ios/carplay`, `docs/releasing`.
- Open a PR to `master`, wait for CI, **squash-merge**. The branch is deleted by GitHub when the PR is merged (*Automatically delete head branches* is on), so there is nothing to clean up. Do not push more commits to a branch after its PR was merged; start a new branch from `master`.
- **A PR does not bump a version and does not tag.** It adds a line about what changed to the product's changelog under `## Unreleased` (create the heading at the top if it is not there). Several PRs can then run side by side without fighting over the version number.
- The text under `## Unreleased` is what the people who read the release will see, so write it for them. Add to the `## Unreleased` heading that is already there; if two PRs each add one, the release joins them into one.

## Releasing (any product)

One button: **Actions → Release → Run workflow** on `master`. Pick the product and the version (`patch`, `minor`, `major` or an exact `X.Y.Z`).

The workflow ([release.yml](../.github/workflows/release.yml)) then:

1. bumps the product's version file(s) (`scripts/bump-version.mjs`),
2. renames `## Unreleased` in the changelog to `## X.Y.Z` (it stops if there is no such section),
3. commits that to `master` and pushes the tag,
4. starts the product's build workflow on the tag, which builds and publishes the release.

Tick **rebuild** to release with no changes (a new build for a store, say): no `Unreleased` section is needed and the release text is "A new build with no changes in the app."

By hand it is the same: `node scripts/bump-version.mjs <product> patch`, commit, `git tag <tag>`, push both.

**How often:** not for every small change. Every merge to `master` already builds the apps (the artifacts are in the Actions run), so a release is for when there is something worth installing: a finished feature, a fix people wait for, or a set of small changes. Versions: `patch` for fixes and small changes, `minor` for a feature, `major` when something stops working with older parts ([compatibility.md](compatibility.md)). The Android phone app stays `0.1.x` (only the last number grows) and its releases are marked **pre-release** until it is on Google Play.

Release checklist: [compatibility.md](compatibility.md) lists the current versions; update it when a release changes which versions work together.

## What a tag does

The Release workflow pushes the tag and starts these itself (a push made with the built-in token does not start other workflows). A tag pushed by hand starts them as usual.

| Tag | Workflow | Result |
|---|---|---|
| `vX.Y.Z` | `build.yml` | Builds the desktop packages on Linux and Windows runners and **publishes the release** that the desktop app's updater offers (it only considers `vX.Y.Z` releases) |
| `server-vX.Y.Z` | `server.yml` | Runs the engine's tests, publishes the Docker image as `X.Y.Z`, `X.Y` and `latest`, and creates the release with the changelog text |
| `ios-vX.Y.Z` | `ios.yml` | Builds the unsigned `.ipa` and publishes it as a release |
| `android-vX.Y.Z` | `android.yml` | Builds the `.apk` and publishes it as a release |
| `android-phone-vX.Y.Z` | `android-phone.yml` | Builds the phone `.apk` and publishes it as a **pre-release** |

## Without releasing

Every build workflow can be started by hand (*Actions → pick the workflow → Run workflow*, `workflow_dispatch`) on any branch. This produces the artifacts without creating a release or pushing `latest`.

- `server.yml` also publishes `edge` from `master`.
- `ios.yml` and `android.yml` build on PRs that touch their app.

## One-time setup

- **Docker image visibility:** the first published package is private by default. In GitHub: *your profile → Packages → icosahedron-server → Package settings → Change visibility → Public*, so that anyone can `docker pull` it.
- **Release permissions:** the workflows use the built-in `GITHUB_TOKEN` with `contents: write` / `packages: write`; no extra secrets are needed. (The Android app uses four signing secrets, set up on 2026-11-10; what they are and how to renew them: [android-tv.md](android-tv.md#updating-and-the-signing-key).)

## After a release

- **Server:** update the deployed engine: `docker compose pull && docker compose up -d`. This also updates the web app.
- **iOS:** re-sign the app on your devices with the new `.ipa` (and every 7 days with a free Apple ID).
- **Android TV:** install the new APK.
