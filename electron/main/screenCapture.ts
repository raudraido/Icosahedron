import { desktopCapturer, screen } from "electron";

export interface ScreenCaptureSource {
  id: string;
  name: string;
  dataUrl: string;
}

// Full-resolution still capture backing Settings.tsx's ColorDial screen
// color picker on Wayland — Chromium's own EyeDropper API crashes the
// renderer under the native Wayland Ozone backend electron/main/index.ts
// forces on, so instead of a live floating magnifier, this grabs one still
// frame per screen (via desktopCapturer, which goes through
// org.freedesktop.portal.ScreenCast on Wayland rather than Chromium's own
// broken EyeDropper code) for the renderer to show fullscreen and let the
// user click a pixel on. thumbnailSize is the largest connected display's
// real pixel size (scaleFactor-aware) so high-DPI screens aren't
// downsampled before a click gets mapped back to a pixel.
export async function captureScreens(): Promise<ScreenCaptureSource[]> {
  const displays = screen.getAllDisplays();
  const maxDisplay = displays.reduce((a, b) =>
    a.size.width * a.size.height > b.size.width * b.size.height ? a : b);
  const width = Math.round(maxDisplay.size.width * maxDisplay.scaleFactor);
  const height = Math.round(maxDisplay.size.height * maxDisplay.scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });
  return sources.map((s) => ({ id: s.id, name: s.name, dataUrl: s.thumbnail.toDataURL() }));
}
