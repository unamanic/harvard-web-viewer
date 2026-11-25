/**
 * Format-independent slide transitions (SPEC §4.5). A parser keeps whatever
 * its file stores in `PresentationSlide.transition`; `transitionForSlide`
 * turns that into a `Transition`, and the stage draws it.
 */

export type TransitionEffect =
  | "replace"
  | "overlay"
  | "wipe"
  | "scroll"
  | "fade"
  | "open"
  | "close"
  | "blinds"
  | "iris"
  | "keep";

/**
 * - wipe, scroll: the direction the edge / the pictures move.
 * - open, close, blinds: "up"/"down" (or none) = horizontal centre line or
 *   stripes; "left"/"right" = vertical ones.
 * - iris: "out" = growing rectangle (default), "in" = shrinking.
 */
export type TransitionDirection = "left" | "right" | "up" | "down" | "in" | "out";

export interface Transition {
  effect: TransitionEffect;
  direction?: TransitionDirection;
  /** Overall duration; ignored by the instant effects (replace, overlay, keep). */
  durationMs: number;
}

/** Slow, Medium, Fast (§4.5: "about 1.5 s, 0.75 s and 0.3 s") [I]. */
export const SPEED_MS = { slow: 1500, medium: 750, fast: 300 } as const;

export const REPLACE: Transition = { effect: "replace", durationMs: 0 };

/** Effects drawn at once, with no animation. */
export function isInstant(t: Transition): boolean {
  return t.effect === "replace" || t.effect === "overlay" || t.effect === "keep" || t.durationMs <= 0;
}

/**
 * With reduced motion requested, animated effects become Replace. Overlay
 * and Keep do not move, so they stay (they change what ends up on screen).
 */
export function effectiveTransition(t: Transition, reducedMotion: boolean): Transition {
  if (!reducedMotion || t.effect === "overlay" || t.effect === "keep") return t;
  return REPLACE;
}

/** True when the browser asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}
