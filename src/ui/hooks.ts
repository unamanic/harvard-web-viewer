/** Small React hooks shared by the views: presentation controls, the slide strip, menus and dialogs. */
import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
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

/**
 * A <details> used as a menu closes when the user clicks or focuses outside
 * it, or presses Escape inside it (focus goes back to its summary).
 */
export function useDismissableDetails(ref: RefObject<HTMLDetailsElement | null>): void {
  useEffect(() => {
    const onOutside = (e: Event) => {
      const el = ref.current;
      if (el?.open && e.target instanceof Node && !el.contains(e.target)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (e.key !== "Escape" || !el?.open || !(e.target instanceof Node) || !el.contains(e.target)) return;
      el.open = false;
      el.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref]);
}

/** What a dialog's keyboard handling treats as focusable. */
const DIALOG_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard and focus handling of a modal dialog (`ref`): its first control
 * takes the focus when it opens, and the focus goes back when it closes
 * (to `restoreFocus(before)` when given, else to what had it before);
 * Escape calls `onEscape`, and Tab and Shift+Tab stay inside the dialog.
 * Returns the dialog element's keydown handler.
 */
export function useDialogKeys(
  ref: RefObject<HTMLElement | null>,
  onEscape: () => void,
  restoreFocus?: (before: HTMLElement | null) => HTMLElement | null | undefined,
): (e: ReactKeyboardEvent<HTMLElement>) => void {
  const restore = useRef(restoreFocus);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>(DIALOG_FOCUSABLE)?.focus();
    return () => {
      const target = restore.current ? restore.current(before) : before;
      target?.focus?.();
    };
    // Once per dialog.
  }, []);
  return (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
}

/** The first focusable control in `root` (a dialog), or null. */
export function firstFocusable(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>(DIALOG_FOCUSABLE) ?? null;
}
