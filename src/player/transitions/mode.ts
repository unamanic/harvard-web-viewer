/**
 * The viewer's "Transitions" setting and the mapping from a slide to the
 * transition drawn when it comes in.
 *
 * How HG3 stores a slide's transition is not known (SPEC §4.5), so the
 * default draws none: faithful to the unknown is safer than inventing.
 * "Guessed" draws the parser's `PresentationSlide.transitionGuess` (for HG3
 * built from src/formats/hg3/assumptions.ts); the player reads no format's
 * raw values.
 */
import type { PresentationSlide } from "../../formats/types";
import { REPLACE, SPEED_MS, type Transition } from "./types";

export type TransitionMode = "off" | "guessed" | "demo";

export const DEFAULT_TRANSITION_MODE: TransitionMode = "off";

/** Modes in selector order, with their labels. */
export const TRANSITION_MODES: readonly { mode: TransitionMode; label: string }[] = [
  { mode: "off", label: "Off (new slide replaces the old)" },
  { mode: "guessed", label: "Guessed from the file (experimental)" },
  { mode: "demo", label: "Demo (cycle through every effect)" },
];

export function isTransitionMode(value: unknown): value is TransitionMode {
  return TRANSITION_MODES.some((m) => m.mode === value);
}

/** Every effect and direction, in §4.5 menu order, then Keep: the "demo" cycle. */
export const DEMO_TRANSITIONS: readonly Transition[] = [
  { effect: "replace", durationMs: 0 },
  { effect: "overlay", durationMs: 0 },
  ...(["left", "right", "up", "down"] as const).map((direction) => ({ effect: "wipe" as const, direction, durationMs: SPEED_MS.medium })),
  ...(["left", "right", "up", "down"] as const).map((direction) => ({ effect: "scroll" as const, direction, durationMs: SPEED_MS.medium })),
  { effect: "fade", durationMs: SPEED_MS.slow },
  { effect: "open", direction: "up", durationMs: SPEED_MS.medium },
  { effect: "open", direction: "left", durationMs: SPEED_MS.medium },
  { effect: "close", direction: "up", durationMs: SPEED_MS.medium },
  { effect: "close", direction: "left", durationMs: SPEED_MS.medium },
  { effect: "blinds", direction: "up", durationMs: SPEED_MS.medium },
  { effect: "blinds", direction: "left", durationMs: SPEED_MS.medium },
  { effect: "iris", direction: "in", durationMs: SPEED_MS.medium },
  { effect: "iris", direction: "out", durationMs: SPEED_MS.medium },
  { effect: "keep", durationMs: 0 },
];

/**
 * The transition into `slide`. `step` counts slide changes since the show
 * started (1 for the first change); "demo" uses it to pick the next effect.
 */
export function transitionForSlide(slide: PresentationSlide, mode: TransitionMode, step = 1): Transition {
  switch (mode) {
    case "off":
      return REPLACE;
    case "guessed":
      return slide.transitionGuess ?? REPLACE;
    case "demo": {
      const n = DEMO_TRANSITIONS.length;
      return DEMO_TRANSITIONS[(((step - 1) % n) + n) % n];
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence (per browser)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "hwv.transitions";

/** The remembered mode, or the default if none (or storage is unavailable). */
export function loadTransitionMode(): TransitionMode {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isTransitionMode(v)) return v;
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
