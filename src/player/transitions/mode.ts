/**
 * The viewer's "Transitions" setting and the mapping from a slide change to
 * the effects drawn (SPEC §4.5).
 *
 * "From the file" (the default) draws what the show sets: the parser's
 * `PresentationSlide.effects`, with the show's defaults already filled in.
 * Leaving a slide erases it with its Erase effect, then the next slide is
 * drawn with its Draw effect. The player reads no format's raw values.
 */
import type { PresentationSlide, SlideEffect, SlideTransitionSpeed } from "../../model/presentation";
import { REPLACE, SPEED_MS, type Transition } from "./types";

export type TransitionMode = "file" | "off" | "demo";

export const DEFAULT_TRANSITION_MODE: TransitionMode = "file";

/** Modes in selector order, with their labels. */
export const TRANSITION_MODES: readonly { mode: TransitionMode; label: string }[] = [
  { mode: "file", label: "From the file" },
  { mode: "off", label: "Off (new slide replaces the old)" },
  { mode: "demo", label: "Demo (cycle through every effect)" },
];

export function isTransitionMode(value: unknown): value is TransitionMode {
  return TRANSITION_MODES.some((m) => m.mode === value);
}

/** Every effect and direction, in §4.5 menu order, then Keep: the "demo" cycle (Draw only). */
export const DEMO_TRANSITIONS: readonly Transition[] = [
  { effect: "replace", durationMs: 0 },
  { effect: "overlay", durationMs: 0 },
  ...(["left", "right", "up", "down", "in", "out"] as const).map((direction) => ({ effect: "wipe" as const, direction, durationMs: SPEED_MS.medium })),
  ...(["left", "right", "up", "down"] as const).map((direction) => ({ effect: "scroll" as const, direction, durationMs: SPEED_MS.medium })),
  { effect: "fade", durationMs: SPEED_MS.slow },
  { effect: "open", direction: "up", durationMs: SPEED_MS.medium },
  { effect: "open", direction: "left", durationMs: SPEED_MS.medium },
  { effect: "close", direction: "up", durationMs: SPEED_MS.medium },
  { effect: "close", direction: "left", durationMs: SPEED_MS.medium },
  ...(["down", "up", "right", "left"] as const).map((direction) => ({ effect: "blinds" as const, direction, durationMs: SPEED_MS.medium })),
  { effect: "iris", direction: "in", durationMs: SPEED_MS.medium },
  { effect: "iris", direction: "out", durationMs: SPEED_MS.medium },
  { effect: "keep", durationMs: 0 },
];

/** A blank speed is drawn as Medium. */
export const DEFAULT_SPEED: SlideTransitionSpeed = "medium";

/** A slide's Draw or Erase effect as the player draws it. */
export function effectTransition(e: SlideEffect): Transition {
  const t: Transition = { effect: e.effect, durationMs: SPEED_MS[e.speed ?? DEFAULT_SPEED] };
  if (e.direction) t.direction = e.direction;
  return t;
}

/**
 * What a slide change draws:
 * - `erase`: null = the next slide is drawn over the old picture (no Erase
 *   effect, or Keep); otherwise the old picture is first taken off the
 *   screen with this effect, down to black (instant for Replace; Overlay,
 *   which has nothing to erase with, also clears at once).
 * - `draw`: how the next slide comes in, over the old picture or the black.
 */
export interface TransitionPlan {
  erase: Transition | null;
  draw: Transition;
}

export const REPLACE_PLAN: TransitionPlan = { erase: null, draw: REPLACE };

function eraseTransition(e: SlideEffect | undefined): Transition | null {
  if (!e || e.effect === "keep") return null;
  if (e.effect === "overlay") return REPLACE;
  return effectTransition(e);
}

/**
 * The change from `from` (the slide whose picture is shown, or null at the
 * start) to `to`. `step` counts slide changes since the show started (1 for
 * the first change); "demo" uses it to pick the next effect.
 */
export function transitionPlan(from: PresentationSlide | null, to: PresentationSlide, mode: TransitionMode, step = 1): TransitionPlan {
  switch (mode) {
    case "off":
      return REPLACE_PLAN;
    case "file":
      return {
        erase: eraseTransition(from?.effects?.erase),
        draw: to.effects ? effectTransition(to.effects.draw) : REPLACE,
      };
    case "demo": {
      const n = DEMO_TRANSITIONS.length;
      return { erase: null, draw: DEMO_TRANSITIONS[(((step - 1) % n) + n) % n] };
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence (per browser)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "hwv.transitions";

/** Stored values of earlier versions → the mode that replaces them. */
const MIGRATED: Readonly<Record<string, TransitionMode>> = {
  // "Guessed from the file" read a guessed byte layout; the file is now decoded.
  guessed: "file",
};

/** The remembered mode, or the default if none (or storage is unavailable). */
export function loadTransitionMode(): TransitionMode {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isTransitionMode(v)) return v;
    if (v != null && Object.hasOwn(MIGRATED, v)) {
      saveTransitionMode(MIGRATED[v]);
      return MIGRATED[v];
    }
  } catch {
    // Storage blocked: fall through to the default.
  }
  return DEFAULT_TRANSITION_MODE;
}

export function saveTransitionMode(mode: TransitionMode): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, mode);
  } catch {
    // Not remembered; the choice still applies for this session.
  }
}
