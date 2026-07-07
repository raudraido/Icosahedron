import { useEffect, useLayoutEffect, useRef, useState } from "react";

// System-wide themed tooltip — ports the old app's window.py _TooltipFilter/
// _TooltipLabel (a QApplication-level event filter that intercepted every
// widget's native Qt tooltip and repainted it with the live theme instead of
// the OS default). The browser equivalent of "every widget's tooltip" is
// every element's native `title` attribute, so this listens app-wide and
// swaps in a themed popup instead of suppressing hover-to-reveal tooltips
// project-wide — existing `title={...}` props across the app get themed for
// free, no call-site changes needed.
//
// Positioning matches show_at exactly: centered horizontally on the target,
// shown above it by default, flipped below only if there's no room above,
// clamped so it never runs off either screen edge.
const GAP = 4;

type Anchor = { text: string; cx: number; aboveY: number; belowY: number };

export function GlobalTooltip() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function restore(el: HTMLElement) {
      const saved = el.getAttribute("data-tooltip-restore");
      if (saved !== null) {
        el.setAttribute("title", saved);
        el.removeAttribute("data-tooltip-restore");
      }
    }

    function hide() {
      if (targetRef.current) restore(targetRef.current);
      targetRef.current = null;
      setAnchor(null);
    }

    function onOver(e: MouseEvent) {
      const el = (e.target as Element | null)?.closest("[title]");
      if (!el || !(el instanceof HTMLElement) || !el.title) return;
      if (targetRef.current === el) return;
      if (targetRef.current) restore(targetRef.current);
      targetRef.current = el;
      const rect = el.getBoundingClientRect();
      const text = el.title;
      // Suppress the native browser tooltip for this element while ours is
      // shown — stash the value instead of just deleting it so it comes back
      // once the pointer leaves (own attribute name, not a plain flag, so a
      // rapid re-hover before restore can't lose the original text).
      el.setAttribute("data-tooltip-restore", text);
      el.removeAttribute("title");
      setAnchor({
        text,
        cx: rect.left + rect.width / 2,
        aboveY: rect.top - GAP,
        belowY: rect.bottom + GAP,
      });
    }

    function onOut(e: MouseEvent) {
      const el = targetRef.current;
      if (!el) return;
      const related = e.relatedTarget as Node | null;
      if (related && el.contains(related)) return;
      hide();
    }

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("mousedown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      if (targetRef.current) restore(targetRef.current);
    };
  }, []);

  // Two-pass positioning, matching show_at's "above unless it'd run off the
  // top of the screen, then below instead": the popup's height isn't known
  // until it's painted once, so the first paint sits invisibly at aboveY,
  // then a layout effect measures it and flips to belowY only if needed.
  const [pos, setPos] = useState<{ left: number; top: number; anchor: "above" | "below" } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) {
      setPos(null);
      return;
    }
    const el = popRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const fitsAbove = anchor.aboveY - h >= 4;
    setPos({
      left: anchor.cx,
      top: fitsAbove ? anchor.aboveY : anchor.belowY,
      anchor: fitsAbove ? "above" : "below",
    });
  }, [anchor]);

  return (
    <div
      ref={popRef}
      style={{
        position: "fixed",
        left: Math.max(4, Math.min(pos?.left ?? anchor?.cx ?? 0, window.innerWidth - 4)),
        top: pos?.top ?? anchor?.aboveY ?? 0,
        transform: `translate(-50%, ${pos?.anchor === "below" ? "0" : "-100%"})`,
        visibility: anchor && pos ? "visible" : "hidden",
        zIndex: 9999,
        pointerEvents: "none",
        maxWidth: "min(480px, 90vw)",
        padding: "5px 10px",
        borderRadius: 6,
        background: "var(--panel-bg)",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
        fontSize: "var(--fs-primary)",
        fontFamily: "var(--font-family)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
      }}
    >
      {anchor?.text ?? ""}
    </div>
  );
}
