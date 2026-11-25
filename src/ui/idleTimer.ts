/**
 * Auto-hide logic for presentation controls (pure apart from the injected
 * timer functions): `poke` on activity makes the controls visible and
 * restarts the countdown; after `delayMs` without activity they hide.
 */

export const CONTROLS_HIDE_MS = 3000;

export interface IdleTimerOptions {
  delayMs?: number;
  onChange: (visible: boolean) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface IdleTimer {
  readonly visible: boolean;
  /** Activity: show and restart the countdown. */
  poke(): void;
  /** Keep visible until the next poke (e.g. while the pointer is over the controls). */
  hold(): void;
  dispose(): void;
}

export function createIdleTimer({
  delayMs = CONTROLS_HIDE_MS,
  onChange,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}: IdleTimerOptions): IdleTimer {
  let visible = true;
  let handle: unknown = null;
  let disposed = false;

  const set = (v: boolean) => {
    if (v === visible) return;
    visible = v;
    onChange(v);
  };
  const cancel = () => {
    if (handle !== null) clearTimer(handle);
    handle = null;
  };

  const timer: IdleTimer = {
    get visible() {
      return visible;
    },
    poke() {
      if (disposed) return;
      cancel();
      set(true);
      handle = setTimer(() => {
        handle = null;
        if (!disposed) set(false);
      }, delayMs);
    },
    hold() {
      if (disposed) return;
      cancel();
      set(true);
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
  timer.poke();
  return timer;
}
