# Contributing

## Layout

```
README.md              overview and quick start
docs/                  architecture, protocol, deployment, per-part guides
src/                   React UI (desktop and web app)
  platform/            layer between the UI and Electron / browser
  lib/subsonic/        Subsonic client (shared)
electron/              Electron main + preload
native/audio-engine/   Rust audio engine (desktop)
apps/server/           web engine (Node, Docker)
apps/ios/              iOS app (SwiftUI, XcodeGen)
.github/workflows/     build.yml (desktop), ios.yml, server.yml
scripts/               bump-version.mjs, AppStream generation
```

## Working on each part

| Part | Run | Test |
|---|---|---|
| Desktop | `npm install && npm run dev` | `npx tsc --noEmit` |
| Web app | `npm run build:web` (serve `dist-web/` with the engine) | `npx tsc --noEmit` |
| Engine | `cd apps/server && npm install && NAVIDROME_URL=… DATA_DIR=./data node src/index.mjs` | `npm test` |
| iOS | CI, or XcodeGen + Xcode on a Mac | CI build |

The renderer type check (`npx tsc --noEmit`) must pass for the desktop and web app. The engine has automated tests for the sync hub, proxy, BPM store and Last.fm.

## Conventions

- Anything the UI needs from the host goes through `src/platform/` — do not call `window.electronAPI` from UI code.
- The wire formats in [sync-protocol.md](sync-protocol.md) are shared by three clients: change them compatibly (add fields, keep old ones) and update the document and the tests together.
- Shared settings are replaced as a whole blob: a client must keep the keys it does not know.
- Keep the repository free of personal addresses, hostnames and credentials; examples use `example.com`.
- Commit messages: short imperative subject, a body that says why.
