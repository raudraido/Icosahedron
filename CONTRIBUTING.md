# Contributing

Thanks for helping. The short version:

1. **Talk first for anything big.** Open an issue (or a discussion) before a large change, so nobody builds something that does not fit.
2. **One branch per change**, named `<area>/<short-description>` (`desktop/`, `server/`, `ios/`, `android/`, `android-tv/`, `docs/`, `ci/`).
3. **Open a PR to `master`**, wait for CI, squash-merge.
4. **Add a line to the product's changelog** under `## Unreleased`. A PR does not bump a version and does not tag; the maintainer releases ([docs/releasing.md](docs/releasing.md)).
5. **Keep personal data out**: no real hostnames, addresses or credentials in code, docs or screenshots. Examples use `example.com`.

Where things are, how to run and test each part, and the code conventions: [docs/contributing.md](docs/contributing.md). The sync wire formats are shared by every client: change them compatibly and update [docs/sync-protocol.md](docs/sync-protocol.md) and the tests with the code.

**Testing a beta** is a contribution too: install a *Pre-release* (see the [releases](https://github.com/raudraido/Icosahedron/releases)), and report what you found with the product, its version and the server version.
