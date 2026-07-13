# Icosahedron

A desktop client for Subsonic/Navidrome music servers, built with Electron,
React, and TypeScript.
## Development

```bash
npm install     # also builds native/audio-engine (postinstall)
npm run dev     # electron-vite dev server
```

## Building

```bash
npm run build   # typecheck + electron-vite build
npm run dist    # + electron-builder (AppImage on Linux)
```

The native audio engine can be rebuilt on its own with `npm run build:native`
— requires a Rust toolchain (`cargo`/`rustc`).

## License

GPLv3 — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).
