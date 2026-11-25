/**
 * Transition run state, kept by the player component. Each slide change
 * starts a run; the stage reports when its animation ends; a key pressed
 * while a run is animating ends it at once (and does nothing else).
 */
import { isInstant, type Transition } from "./types";

export interface TransitionRun {
  /** Counts slide changes since the show started (0 = the first slide, no transition). */
  readonly id: number;
  readonly finished: boolean;
}

export const INITIAL_RUN: TransitionRun = { id: 0, finished: true };

/** A slide change. */
export function startRun(run: TransitionRun): TransitionRun {
  return { id: run.id + 1, finished: false };
}

/** The stage says run `id` reached its end (stale ids are ignored). */
export function finishRun(run: TransitionRun, id: number): TransitionRun {
  return run.id === id && !run.finished ? { ...run, finished: true } : run;
}

/** Whether the run is animating: unfinished, with an animated effect and something to animate from. */
export function isAnimating(run: TransitionRun, t: Transition, hasPrevious: boolean): boolean {
  return !run.finished && hasPrevious && !isInstant(t);
}

/**
 * A key or click arrives. While animating, the transition jumps to its end
 * state and the input is consumed; otherwise the run is unchanged and the
 * input goes on to the player.
 */
export function interruptRun(
  run: TransitionRun,
  t: Transition,
  hasPrevious: boolean,
): { run: TransitionRun; consumed: boolean } {
  if (!isAnimating(run, t, hasPrevious)) return { run, consumed: false };
  return { run: { ...run, finished: true }, consumed: true };
}

/** Progress to draw: the end state once finished. */
export function shownProgress(run: TransitionRun, animated: number): number {
  return run.finished ? 1 : animated;
}
