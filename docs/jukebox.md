# Jukebox

Turn any screen into a player that you control from your other devices: a tablet on the kitchen wall, a spare computer, a browser on a TV, a phone in a dock. The screen only plays; you pick the music on a device you are holding. It needs the [web engine](deploy-server.md), because the devices find each other through it.

## Start a jukebox in three steps

1. **Open the address on the screen that should play:** `https://<your server>/?player=1`.
   You do not have to remember it: **Settings → Sync Server → Jukebox** (desktop app and web app) shows it with a **Copy address** button and a **QR code** to scan with the screen's camera or to send to it.
2. **Sign in** with your account, then **tap once** when the page asks: browsers only allow sound after the page was touched. With [secure sign-in](secure-sign-in.md) on, a screen it has not seen before shows a number, and you approve it on one of your signed-in devices (or with a recovery code).
3. **Send it music** from another device. Choose the jukebox in the devices list, or right-click a song → **Add to Device Queue** → pick it → *Play Now*, *Play Next* or *Add to Queue*.

The screen shows the cover, the title, the next songs and whether it is connected. It plays what you send and nothing else.

## Name it

A new jukebox is called **Jukebox**. Click **Rename** under the cover on the screen (or rename it in **Settings → Sync Server → Registered players** from any other device) to call it *Kitchen*, *Garage* or *Living room TV*. The server remembers the name, so it stays after the page is reloaded, and you can tell several jukeboxes apart in the devices list.

## Controlling it

| App | How |
|---|---|
| **Desktop and web** | the devices button next to the cast button: choose the jukebox, then use the normal player bar and queue panel. **Add to Device Queue** in the song menu. **Show queue** lists its queue with play and remove buttons. |
| **iOS** | the *Devices* tab or the devices button in the player; **Add to Device Queue** in the song menu. |
| **Android phone** | the *Devices* screen; **Add to Device Queue** in the ⋮ menu. |
| **Android TV** | the TV is a jukebox itself (other apps can queue music on it), but it cannot control other devices yet. |

The apps are jukeboxes too: every app shows up in the devices list and can be controlled the same way. The `?player=1` page is the one made for a screen that should only play.

## Good to know

- **Your devices only.** A jukebox takes commands from devices signed in with the same account. There is no guest access or shared queue for other people.
- **The page has to stay open** and connected (it says *Connected* at the bottom). Closing it makes the jukebox disappear from the list; it comes back when the page is opened again.
- **Sound needs one tap** after the page opens. If the screen restarts, tap again.
- The commands behind this (`enqueue`, `jump`, `remove`, `move`, `shuffle`, `repeat`) are in [sync-protocol.md](sync-protocol.md#commands).
