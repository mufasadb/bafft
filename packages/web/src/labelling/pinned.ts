// Keeps a popover pinned just under (or, near the bottom, just over) the
// element it's about, following it as the transcript scrolls. Shared by the
// word fixer (wg1.11) and the speaker picker (wg1.12).
import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

export function usePinnedTo(selector: string, popover: RefObject<HTMLElement | null>, width: number): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    const place = () => {
      const anchor = document.querySelector(selector);
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const height = popover.current?.offsetHeight ?? 0;
      const below = r.bottom + 6;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 6) : below;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      setPosition({ top, left, width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [selector, popover, width]);
  return position;
}

/** Escape, or a click anywhere outside the popover, closes it (unsaved). */
export function useDismiss(popover: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => !popover.current?.contains(e.target as Node) && onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [popover, onClose]);
}
