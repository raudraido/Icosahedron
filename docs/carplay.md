# CarPlay (skeleton, not shipped)

Status: **a skeleton that compiles, never run.** It cannot be tried on a phone and a car until the app has Apple's CarPlay Audio entitlement, which needs a paid Apple Developer account and Apple's approval. Until then the car's own *Now Playing* screen (Bluetooth or USB) already shows the song and the controls ([ios.md](ios.md)).

## What it does

When the phone is connected to a CarPlay car, the app shows (like the Android Auto tree in [android.md](android.md)):

- **Home:** Random mix and the recently played albums.
- **Albums**, **Playlists** and **Artists**; an album, a playlist or an artist opens its songs (or albums), with Play and Shuffle first.
- A tap on a song plays the list from there and the car's own Now Playing screen opens. The player, the queue, the playing-from-the-car restore and the controls are the app's own (`AppModel.shared`, `PlayerModel`); the CarPlay code only browses and starts playing.

The code is in [`apps/ios/CarPlay/`](../apps/ios/CarPlay): `CarPlaySceneDelegate.swift` (the scene the car starts) and `CarPlayBrowser.swift` (the lists).

## Why a separate target

`project.yml` has a second target, **IcosahedronCarPlay**: the same sources plus the `CarPlay` folder, the CarPlay scene in its Info.plist and the entitlement `com.apple.developer.carplay-audio`. The normal target (**Icosahedron**, the `.ipa` for SideStore, AltStore and the like) has none of this, because an app signed with a free Apple ID cannot carry an entitlement Apple has not given: it would not install. The CI compiles the CarPlay target for the simulator on every change, so the code does not rot, but it does not ship it.

## What is needed to run it

1. **A Mac with Xcode** (rented in the cloud or owned): `cd apps/ios && xcodegen generate`, open `Icosahedron.xcodeproj`, scheme **IcosahedronCarPlay**.
2. **The simulator:** run it on an iPhone simulator, then in the Simulator menu *I/O → External Displays → CarPlay*. A CarPlay window opens next to the phone. The simulator does not check the entitlement the way a real car does (not verified here).
3. **A paid Apple Developer account** (99 USD a year), which App Store publishing needs anyway.
4. **The CarPlay Audio entitlement:** ask Apple at <https://developer.apple.com/contact/carplay/> (App category: Audio, the app plays music from the user's own server). Approval takes days to weeks. With it, make the App ID have *CarPlay Audio*, and sign the **IcosahedronCarPlay** target with that profile.

## A session on a rented Mac (no admin rights)

A pay-as-you-go Mac (for example MacinCloud, about 1 USD an hour or 4 USD a day) is enough to see the CarPlay screens in the simulator. Have these ready, so that the paid time is not spent on looking things up:

1. **Check first:** the Mac needs **Xcode 26 or newer** (the app targets iOS 26.1; macOS 15.6 or newer). Ask the provider or look at the server's description before buying.
2. Connect with a remote desktop (RDP from Linux: `xfreerdp` or Remmina).
3. Open Terminal and get the code (the repository is public):
   ```
   git clone https://github.com/raudraido/Icosahedron.git && cd Icosahedron/apps/ios
   ```
4. **XcodeGen without installing it** (no `brew`, no admin): download the latest `xcodegen.zip` from <https://github.com/yonaskolb/XcodeGen/releases>, unzip it in your home folder and run `./xcodegen/bin/xcodegen generate` in `apps/ios`. If Homebrew is already there: `brew install xcodegen`.
5. `open Icosahedron.xcodeproj`. In Xcode pick the scheme **IcosahedronCarPlay** and an iPhone simulator (iOS 26), then **Product → Run**. The simulator needs no signing; if Xcode asks for a team, choose *None* / turn *Automatically manage signing* off for the run.
6. In the **Simulator** menu: **I/O → External Displays → CarPlay**. A CarPlay window opens: look at Home, Albums, Playlists and Artists, open an album, tap a song.
7. On the simulated phone sign in to the server (the car shows "Sign in on the phone" until you do), then reopen the CarPlay window.
8. Write down what looks or behaves wrong (screenshots: **File → Save Screen** in the Simulator), and stop the rental.

## Not known yet

- Whether the manifest with only the CarPlay scene keeps SwiftUI's main window working on the phone (the plan is that it does; this must be tried).
- How the lists look and behave in a real car: the car limits the rows (`CPListTemplate.maximumItemCount`), and images load late.
- Search by voice (Siri) is not done; CarPlay audio apps do not get a keyboard.
