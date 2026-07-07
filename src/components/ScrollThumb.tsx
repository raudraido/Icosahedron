import { useEffect, useRef, RefObject } from "react";

// Overlay scrollbar thumb for any `.scroll-clean` scroll container — pure
// paint, zero layout impact. `.scroll-clean` itself keeps its native
// scrollbar permanently zero-width (index.css) specifically so appearing/
// disappearing never reflows the content or throws off symmetric padding;
// this renders a separate absolutely-positioned track+thumb instead,
// matching react-window's native scrollbar behavior used on the Albums/
// Artists grids (hover the track to reveal it, drag the thumb to scroll) —
// just implemented by hand since there's no real scrollbar box to hook into
// here, and a native scrollbar has no way to set a custom minimum thumb size
// the way this one does.
//
// Usage: wrap the existing scrollable div in a `position: relative` parent
// (same size as the scrollable div — e.g. give the wrapper the old
// `flex-1`/`h-full` sizing classes and leave the inner div's own className/
// style/ref untouched) and render `<ScrollThumb scrollRef={ref} />` as its
// sibling.
const MIN_THUMB_PX = 48;
const HIDE_DELAY_MS = 500;
const TRACK_WIDTH = 12;

export function ScrollThumb({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveringRef = useRef(false);
  const draggingRef = useRef(false);
  const metricsRef = useRef({ trackH: 0, thumbH: 0, maxScroll: 0 });
  const dragStartRef = useRef({ y: 0, scrollTop: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;

    function update() {
      const { scrollTop, scrollHeight, clientHeight } = el!;
      if (scrollHeight <= clientHeight + 1) {
        thumb!.style.display = "none";
        metricsRef.current = { trackH: clientHeight, thumbH: 0, maxScroll: 0 };
        return;
      }
      thumb!.style.display = "block";
      const trackH = clientHeight;
      const thumbH = Math.max(MIN_THUMB_PX, (clientHeight / scrollHeight) * trackH);
      const maxScroll = scrollHeight - clientHeight;
      const maxTop = trackH - thumbH;
      const ratio = maxScroll > 0 ? scrollTop / maxScroll : 0;
      thumb!.style.height = `${thumbH}px`;
      thumb!.style.top = `${maxTop * ratio}px`;
      metricsRef.current = { trackH, thumbH, maxScroll };
    }

    function show() {
      update();
      thumb!.style.opacity = "1";
      if (hideTimer.current) clearTimeout(hideTimer.current);
    }
    function scheduleHide() {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        if (!hoveringRef.current && !draggingRef.current) thumb!.style.opacity = "0";
      }, HIDE_DELAY_MS);
    }

    function onScroll() { show(); scheduleHide(); }
    function onTrackEnter() { hoveringRef.current = true; show(); }
    function onTrackLeave() { hoveringRef.current = false; if (!draggingRef.current) scheduleHide(); }

    function onDragMove(e: MouseEvent) {
      const { trackH, thumbH, maxScroll } = metricsRef.current;
      const maxTop = trackH - thumbH;
      if (maxTop <= 0) return;
      const deltaY = e.clientY - dragStartRef.current.y;
      el!.scrollTop = Math.max(0, Math.min(maxScroll, dragStartRef.current.scrollTop + (deltaY / maxTop) * maxScroll));
    }
    function onDragEnd() {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
      if (!hoveringRef.current) scheduleHide();
    }
    function onThumbMouseDown(e: MouseEvent) {
      e.preventDefault();
      draggingRef.current = true;
      dragStartRef.current = { y: e.clientY, scrollTop: el!.scrollTop };
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragEnd);
    }

    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    track.addEventListener("mouseenter", onTrackEnter);
    track.addEventListener("mouseleave", onTrackLeave);
    thumb.addEventListener("mousedown", onThumbMouseDown);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      track.removeEventListener("mouseenter", onTrackEnter);
      track.removeEventListener("mouseleave", onTrackLeave);
      thumb.removeEventListener("mousedown", onThumbMouseDown);
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [scrollRef]);

  return (
    <div ref={trackRef} style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: TRACK_WIDTH }}>
      <div
        ref={thumbRef}
        className="overlay-thumb"
        style={{
          position: "absolute", top: 0, right: 2, width: 5, borderRadius: 3,
          background: "color-mix(in srgb, var(--accent) 55%, transparent)",
          opacity: 0, cursor: "pointer",
        }}
      />
    </div>
  );
}
