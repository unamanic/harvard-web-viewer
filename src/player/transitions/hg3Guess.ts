/**
 * The ONLY place that reads Harvard Graphics 3 transition values.
 *
 * GUESS, NOT CONFIRMED. SPEC §4.5 says how a slide entry (record 702)
 * encodes its transition is not known. This applies the earlier [I] reading
 * to offset 12 alone (the more likely field per §4.2), with offset 5 as the
 * speed: one number per effect and direction in Projector menu order,
 * starting at 0. The samples' most common chart-slide value (9) then reads as
 * Scroll Down, which is one reason to doubt it. Used only by the "Guessed"
 * transitions setting. The HG3 parser keeps the raw values as
 * { speed, transitionA (offset 11), transitionB (offset 12) }.
 */
import { SPEED_MS, type Transition, type TransitionDirection, type TransitionEffect } from "./types";

/** §4.5 menu order. Open, Close and Blinds have two unnamed variants: guessed as horizontal, then vertical. */
const MENU_ORDER: readonly [TransitionEffect, TransitionDirection?][] = [
  ["replace"],
  ["overlay"],
  ["wipe", "left"],
  ["wipe", "right"],
  ["wipe", "up"],
  ["wipe", "down"],
  ["scroll", "left"],
  ["scroll", "right"],
  ["scroll", "up"],
  ["scroll", "down"],
  ["fade"],
  ["open", "up"],
  ["open", "left"],
  ["close", "up"],
  ["close", "left"],
  ["blinds", "up"],
  ["blinds", "left"],
  ["iris", "in"],
  ["iris", "out"],
];

/** Offset 5 read as 0 Slow, 1 Medium, 2 Fast [I]; other values: Medium. */
const SPEEDS = [SPEED_MS.slow, SPEED_MS.medium, SPEED_MS.fast];

/** The guessed transition for an HG3 slide's raw `transition` value, or null if it is not one. */
export function guessHg3Transition(raw: unknown): Transition | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { speed, transitionB } = raw as { speed?: unknown; transitionB?: unknown };
  if (typeof transitionB !== "number") return null;
  const entry = MENU_ORDER[transitionB];
  if (!entry) return null;
  const durationMs = (typeof speed === "number" ? SPEEDS[speed] : undefined) ?? SPEED_MS.medium;
  const [effect, direction] = entry;
  return direction ? { effect, direction, durationMs } : { effect, durationMs };
}
