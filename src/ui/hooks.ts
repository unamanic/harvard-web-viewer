/** Small React hooks shared by the presentation views and the slide strip. */
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { CONTROLS_HIDE_MS, type IdleTimer, createIdleTimer } from "./idleTimer";

/**
 * Controls that hide after `delayMs` without activity while `active`.
 * Returns whether they are visible and `poke` to call on mouse movement or
 * focus. Always visible when not active.
 */
export function useAutoHide(active: boolean, delayMs = CONTROLS_HIDE_MS): { visible: boolean; poke: () => void } {
  const [visible, setVisible] = useState(true);
  const timer = useRef<IdleTimer | null>(null);
  useEffect(() => {
    if (!active) return;
    const t = createIdleTimer({ delayMs, onChange: setVisible });
    timer.current = t;
    return () => {
      t.dispose();
      timer.current = null;
      setVisible(true);
    };
  }, [active, delayMs]);
  const poke = useCallback(() => timer.current?.poke(), []);
  return { visible: !active || visible, poke };
}

/**
 * While `active`, put the element in full screen (where the browser allows;
 * the page's own fixed overlay covers the window otherwise) and focus it.
 * Leaving full screen by the browser's own means (Esc, F11) calls `onExit`.
 */
export function useFullscreenWhile(ref: RefObject<HTMLElement | null>, active: boolean, onExit: () => void): void {
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  });
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement === el) entered = true;
      else if (entered) {
        entered = false;
        onExitRef.current();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    try {
      const request = el.requestFullscreen?.();
      request?.catch(() => {});
    } catch {
      // Not allowed here: the fixed overlay is enough.
    }
    el.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement === el) void document.exitFullscreen?.().catch(() => {});
    };
  }, [ref, active]);
}

/**
 * True once the element has come near the viewport (IntersectionObserver),
 * and stays true. Where IntersectionObserver is missing it is true at once.
 */
export function useSeenOnce(ref: RefObject<Element | null>, rootMargin = "200px"): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, seen, rootMargin]);
  return seen;
}
