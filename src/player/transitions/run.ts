/**
 * Transition run state, kept by the player component. Each slide change
 * starts a run of up to two phases: "erase" (the old picture goes, when the
 * plan has an animated Erase effect) and then "draw" (the new slide comes
 * in). The stage reports when each phase's animation ends; a key pressed
 * while a run is animating ends the whole run at once (and does nothing else).
 */
import type { TransitionPlan } from "./mode";
import { isInstant, type Transition } from "./types";

export type RunPhase = "erase" | "draw";

export interface TransitionRun {
  /** Counts slide changes since the show started (0 = the first slide, no transition). */
  readonly id: number;
  /** "erase" until the erase phase ends (it is skipped when the plan has no animated erase). */
  readonly phase: RunPhase;
  readonly finished: boolean;
}

export const INITIAL_RUN: TransitionRun = { id: 0, phase: "draw", finished: true };

/** A slide change. */
export function startRun(run: TransitionRun): TransitionRun {
  return { id: run.id + 1, phase: "erase", finished: false };
}

/** Whether the plan erases the old picture with an animation (only when there is one). */
export function hasErasePhase(plan: TransitionPlan, hasPrevious: boolean): boolean {
  return hasPrevious && plan.erase !== null && !isInstant(plan.erase);
}

/** The phase to draw now: "erase" only while an animated erase is still running. */
export function runPhase(run: TransitionRun, plan: TransitionPlan, hasPrevious: boolean): RunPhase {
  return !run.finished && run.phase === "erase" && hasErasePhase(plan, hasPrevious) ? "erase" : "draw";
}

/** The transition of the phase drawn now. */
export function phaseTransition(run: TransitionRun, plan: TransitionPlan, hasPrevious: boolean): Transition {
  return runPhase(run, plan, hasPrevious) === "erase" ? plan.erase! : plan.draw;
}

/** The phase `phase` of run `id` reached its end (stale ids are ignored): erase moves on to draw, draw finishes. */
export function finishRun(run: TransitionRun, id: number, phase: RunPhase = "draw"): TransitionRun {
  if (run.id !== id || run.finished) return run;
  if (phase === "erase") return run.phase === "erase" ? { ...run, phase: "draw" } : run;
  return { ...run, phase: "draw", finished: true };
}

/** The whole run jumps to its end state. */
export function endRun(run: TransitionRun): TransitionRun {
  return run.finished ? run : { ...run, phase: "draw", finished: true };
}

/** Identifies one phase of one run for the stage (it restarts its animation when this changes). */
export function stageRunId(run: TransitionRun, phase: RunPhase): number {
  return run.id * 2 + (phase === "draw" ? 1 : 0);
}

/** The stage says the phase `stageId` (from `stageRunId`) reached its end. */
export function finishStage(run: TransitionRun, stageId: number): TransitionRun {
  return finishRun(run, Math.floor(stageId / 2), stageId % 2 === 1 ? "draw" : "erase");
}

/** Whether the run is animating: unfinished, with an animated effect and something to animate from. */
export function isAnimating(run: TransitionRun, t: Transition, hasPrevious: boolean): boolean {
  return !run.finished && hasPrevious && !isInstant(t);
}

/**
 * A key or click arrives. While animating (`t` is the transition of the
 * phase drawn now), the run jumps to its end state and the input is
 * consumed; otherwise the run is unchanged and the input goes on to the player.
 */
export function interruptRun(
  run: TransitionRun,
  t: Transition,
  hasPrevious: boolean,
): { run: TransitionRun; consumed: boolean } {
  if (!isAnimating(run, t, hasPrevious)) return { run, consumed: false };
  return { run: endRun(run), consumed: true };
}

/** Progress to draw: the end state once finished. */
export function shownProgress(run: TransitionRun, animated: number): number {
  return run.finished ? 1 : animated;
}
