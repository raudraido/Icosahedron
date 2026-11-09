# iOS app

A native SwiftUI app (iOS 26.1+, iPhone and iPad) for your Navidrome library, optionally synced through the web engine.

- Install, features, limits, building: [docs/ios.md](../../docs/ios.md)
- Sync and engine API: [docs/sync-protocol.md](../../docs/sync-protocol.md)

```bash
brew install xcodegen
cd apps/ios && xcodegen generate && open Icosahedron.xcodeproj
```

CI (`.github/workflows/ios.yml`) builds an unsigned `.ipa` on a macOS runner; you do not need a Mac to build it.
