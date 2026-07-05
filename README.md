# Icosahedron

A desktop client for Subsonic/Navidrome music servers, built with Electron,
React, and TypeScript. A rewrite of the original Python/Qt "Sonar" app.

Playback runs through a native Rust audio engine (`native/audio-engine`, a
napi-rs port of [psysonic](https://github.com/Psychotoxical/psysonic)'s
rodio/Symphonia engine) for true sample-accurate gapless transitions between
tracks — not a browser `<audio>` element.

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

GPLv3 — see [LICENSE](LICENSE). `native/audio-engine` is a port of actual
code from [psysonic](https://github.com/Psychotoxical/psysonic) (also
GPLv3), not an independent implementation that merely uses the same
libraries — see [NOTICE.md](NOTICE.md) for the attribution terms that
carry forward from that project.
