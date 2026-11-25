/**
 * Format-independent slide transitions (SPEC §4.5). A parser keeps whatever
 * its file stores in `PresentationSlide.transition` and may offer a reading
 * of it as `PresentationSlide.transitionGuess`; `transitionForSlide` picks
 * the `Transition` to draw by the viewer's setting, and the stage draws it.
 */
import type { SlideTransition, SlideTransitionDirection, SlideTransitionEffect } from "../../formats/types";

/** The shapes are defined beside `PresentationSlide.transitionGuess`. */
export type TransitionEffect = SlideTransitionEffect;
export type TransitionDirection = SlideTransitionDirection;
export type Transition = SlideTransition;

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
