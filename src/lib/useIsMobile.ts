import { useEffect, useState } from "react";
import { platform } from "../platform";

// Phone-sized windows get the mobile shell (src/mobile). ?layout=mobile|desktop
// forces one (remembered; ?layout=auto resets) — handy on a desktop browser and
// as an escape hatch. The desktop app always keeps the desktop layout.
const QUERY = "(max-width: 820px)";

function forced(): "mobile" | "desktop" | null {
  try {
    const q = new URLSearchParams(location.search).get("layout");
    if (q === "mobile" || q === "desktop") localStorage.setItem("ico.layout", q);
    if (q === "auto") localStorage.removeItem("ico.layout");
    const v = localStorage.getItem("ico.layout");
    return v === "mobile" || v === "desktop" ? v : null;
  } catch { return null; }
}

export function useIsMobile(): boolean {
  const decide = () => {
    if (platform.kind === "electron") return false;
    const f = forced();
    return f ? f === "mobile" : window.matchMedia(QUERY).matches;
  };
  const [mobile, setMobile] = useState(decide);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setMobile(decide());
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}
