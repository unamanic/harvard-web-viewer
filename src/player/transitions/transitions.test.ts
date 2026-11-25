import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresentationSlide, SlideEffects } from "../../formats/types";
import {
  BLINDS_STRIPES,
  FADE_COLUMNS,
  FADE_ROWS,
  clipPathCss,
  fadeBoxes,
  frameAt,
  layerCss,
  type Box,
  type Frame,
} from "./frames";
import {
  DEFAULT_TRANSITION_MODE,
  DEMO_TRANSITIONS,
  REPLACE_PLAN,
  TRANSITION_MODES,
  effectTransition,
  loadTransitionMode,
  saveTransitionMode,
  transitionPlan,
} from "./mode";
import {
  INITIAL_RUN,
  endRun,
  finishRun,
  finishStage,
  hasErasePhase,
  interruptRun,
  isAnimating,
  phaseTransition,
  runPhase,
  shownProgress,
  stageRunId,
  startRun,
} from "./run";
import { REPLACE, SPEED_MS, type Transition, effectiveTransition, isInstant } from "./types";

function slide(effects?: SlideEffects): PresentationSlide {
  const out: PresentationSlide = {
    label: "s",
    kind: "picture",
    fileName: null,
    scene: () => null,
    warnings: () => [],
    keys: [],
    buttons: [],
    waitForKey: true,
  };
  if (effects) out.effects = effects;
  return out;
}

const t = (effect: Transition["effect"], direction?: Transition["direction"]): Transition =>
  direction ? { effect, direction, durationMs: 750 } : { effect, durationMs: 750 };

const area = (boxes: Box[]) => boxes.reduce((a, b) => a + b.w * b.h, 0);
const summary = (f: Frame) => f.map((l) => l.which).join(",");

describe("transitionPlan", () => {
  const from = slide({ draw: { effect: "replace" }, erase: { effect: "fade", speed: "slow" } });
  const to = slide({ draw: { effect: "iris", direction: "out", speed: "fast" } });

  it("file: the old slide's erase, then the new slide's draw (and is the default)", () => {
    expect(DEFAULT_TRANSITION_MODE).toBe("file");
    expect(TRANSITION_MODES.map((m) => m.mode)).toEqual(["file", "off", "demo"]);
    expect(TRANSITION_MODES[0].label).toBe("From the file");
    expect(transitionPlan(from, to, "file")).toEqual({
      erase: { effect: "fade", durationMs: SPEED_MS.slow },
      draw: { effect: "iris", direction: "out", durationMs: SPEED_MS.fast },
    });
  });

  it("file: speeds map to durations, a blank speed is Medium", () => {
    expect(effectTransition({ effect: "wipe", direction: "left" })).toEqual({ effect: "wipe", direction: "left", durationMs: SPEED_MS.medium });
    expect(effectTransition({ effect: "wipe", speed: "slow" }).durationMs).toBe(1500);
    expect(effectTransition({ effect: "wipe", speed: "fast" }).durationMs).toBe(300);
  });

  it("file: no erase at the start, without an erase effect, or for Keep; Overlay erases at once", () => {
    expect(transitionPlan(null, to, "file").erase).toBeNull();
    expect(transitionPlan(slide({ draw: { effect: "replace" } }), to, "file").erase).toBeNull();
    expect(transitionPlan(slide({ draw: { effect: "replace" }, erase: { effect: "keep", direction: "out" } }), to, "file").erase).toBeNull();
    expect(transitionPlan(slide({ draw: { effect: "replace" }, erase: { effect: "overlay" } }), to, "file").erase).toEqual(REPLACE);
    expect(transitionPlan(slide({ draw: { effect: "replace" }, erase: { effect: "replace" } }), to, "file").erase).toEqual({
      effect: "replace",
      durationMs: SPEED_MS.medium,
    });
  });

  it("file: a slide without effects is drawn with Replace", () => {
    expect(transitionPlan(slide(), slide(), "file")).toEqual(REPLACE_PLAN);
  });

  it("off: always replace", () => {
    expect(transitionPlan(from, to, "off")).toEqual(REPLACE_PLAN);
  });

  it("demo: cycles through every effect (draw only)", () => {
    const seen = new Set<string>();
    for (let step = 1; step <= DEMO_TRANSITIONS.length; step++) seen.add(transitionPlan(from, slide(), "demo", step).draw.effect);
    expect([...seen].sort()).toEqual(
      ["replace", "overlay", "wipe", "scroll", "fade", "open", "close", "blinds", "iris", "keep"].sort(),
    );
    expect(transitionPlan(from, slide(), "demo", 1)).toEqual({ erase: null, draw: DEMO_TRANSITIONS[0] });
    expect(transitionPlan(from, slide(), "demo", DEMO_TRANSITIONS.length + 3).draw).toEqual(DEMO_TRANSITIONS[2]);
  });

  describe("persistence", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("remembers the mode and falls back to the default", () => {
      const store = new Map<string, string>();
      vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
      expect(loadTransitionMode()).toBe("file");
      saveTransitionMode("demo");
      expect(loadTransitionMode()).toBe("demo");
      saveTransitionMode("off");
      expect(loadTransitionMode()).toBe("off");
      store.set("hwv.transitions", "bogus");
      expect(loadTransitionMode()).toBe("file");
    });

    it("migrates the old \"guessed\" setting to \"From the file\"", () => {
      const store = new Map<string, string>([["hwv.transitions", "guessed"]]);
      vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
      expect(loadTransitionMode()).toBe("file");
      expect(store.get("hwv.transitions")).toBe("file");
    });

    it("survives blocked storage", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      });
      expect(() => saveTransitionMode("demo")).not.toThrow();
      expect(loadTransitionMode()).toBe("file");
    });
  });
});

describe("frameAt", () => {
  it("every animated effect ends as the new slide alone, unclipped", () => {
    for (const tr of DEMO_TRANSITIONS.filter((x) => !isInstant(x))) {
      expect(frameAt(tr, 1)).toEqual([{ which: "current", clip: null, dx: 0, dy: 0, transparent: false }]);
    }
  });

  it("draws the new slide alone when there is no previous one", () => {
    expect(summary(frameAt(t("wipe", "left"), 0.5, false))).toBe("current");
  });

  it("replace, overlay, keep", () => {
    expect(summary(frameAt(REPLACE, 0))).toBe("current");
    for (const e of ["overlay", "keep"] as const) {
      const f = frameAt({ effect: e, durationMs: 0 }, 1);
      expect(summary(f)).toBe("previous,current");
      expect(f[1].transparent).toBe(true);
      expect(f[1].clip).toBeNull();
    }
  });

  it("wipe reveals the new slide from the side opposite the direction", () => {
    expect(frameAt(t("wipe", "left"), 0)[1].clip).toEqual([{ x: 1, y: 0, w: 0, h: 1 }]);
    expect(frameAt(t("wipe", "left"), 0.25)[1].clip).toEqual([{ x: 0.75, y: 0, w: 0.25, h: 1 }]);
    expect(frameAt(t("wipe", "right"), 0.25)[1].clip).toEqual([{ x: 0, y: 0, w: 0.25, h: 1 }]);
    expect(frameAt(t("wipe", "up"), 0.25)[1].clip).toEqual([{ x: 0, y: 0.75, w: 1, h: 0.25 }]);
    expect(frameAt(t("wipe", "down"), 0.25)[1].clip).toEqual([{ x: 0, y: 0, w: 1, h: 0.25 }]);
    expect(layerCss(frameAt(t("wipe", "left"), 0)[1])).toEqual({ clipPath: "inset(0% 0% 0% 100%)" });
  });

  it("wipe out grows from the vertical centre line; wipe in closes from both sides", () => {
    expect(frameAt(t("wipe", "out"), 0.5)[1].clip).toEqual([{ x: 0.25, y: 0, w: 0.5, h: 1 }]);
    expect(frameAt(t("wipe", "in"), 0.5)[1].clip).toEqual([
      { x: 0, y: 0, w: 0.25, h: 1 },
      { x: 0.75, y: 0, w: 0.25, h: 1 },
    ]);
    expect(area(frameAt(t("wipe", "in"), 0.3)[1].clip!)).toBeCloseTo(0.3);
  });

  it("scroll pushes the old slide out as the new one comes in", () => {
    const [a, b] = frameAt(t("scroll", "left"), 0.25);
    expect([a.dx, b.dx]).toEqual([-0.25, 0.75]);
    expect(layerCss(b)).toEqual({ transform: "translate(75%, 0%)" });
    const [c, d] = frameAt(t("scroll", "down"), 0);
    expect([c.dy, d.dy]).toEqual([0, -1]);
    const [e, f] = frameAt(t("scroll", "right"), 0.5);
    expect([e.dx, f.dx]).toEqual([0.5, -0.5]);
  });

  it("fade reveals small pieces in a fixed random order", () => {
    const at = (p: number) => frameAt({ effect: "fade", durationMs: 1500 }, p)[1].clip!;
    expect(at(0)).toEqual([]);
    expect(area(at(0.5))).toBeCloseTo(0.5, 2);
    expect(area(at(0.999))).toBeGreaterThan(0.99);
    // Pieces revealed earlier stay revealed.
    const early = fadeBoxes(100);
    const later = fadeBoxes(400);
    const covered = (b: Box, set: Box[]) => set.some((c) => c.y === b.y && c.x <= b.x + 1e-9 && b.x + b.w <= c.x + c.w + 1e-9);
    expect(early.every((b) => covered(b, later))).toBe(true);
    // Not simply top-to-bottom.
    expect(new Set(early.map((b) => b.y)).size).toBeGreaterThan(FADE_ROWS / 2);
    expect(fadeBoxes(FADE_COLUMNS * FADE_ROWS)).toHaveLength(FADE_ROWS);
  });

  it("open grows from the centre line, close shrinks the old slide to it", () => {
    expect(frameAt(t("open", "up"), 0.5)[1].clip).toEqual([{ x: 0, y: 0.25, w: 1, h: 0.5 }]);
    expect(frameAt(t("open", "left"), 0)[1].clip).toEqual([{ x: 0.5, y: 0, w: 0, h: 1 }]);
    const close = frameAt(t("close", "up"), 0.5);
    expect(summary(close)).toBe("current,previous");
    expect(close[1].clip).toEqual([{ x: 0, y: 0.25, w: 1, h: 0.5 }]);
    expect(frameAt(t("close", "left"), 0)[1].clip).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);
  });

  it("blinds opens every stripe at once", () => {
    const clip = frameAt(t("blinds"), 0.5)[1].clip!;
    expect(clip).toHaveLength(BLINDS_STRIPES);
    expect(clip[1]).toEqual({ x: 0, y: 0.1, w: 1, h: 0.05 });
    expect(area(clip)).toBeCloseTo(0.5);
    expect(frameAt(t("blinds", "down"), 0.5)[1].clip![1]).toEqual(clip[1]);
    expect(frameAt(t("blinds", "right"), 0.5)[1].clip![0]).toEqual({ x: 0, y: 0, w: 0.05, h: 1 });
    // Up / left: each stripe grows from its far edge back.
    expect(frameAt(t("blinds", "up"), 0.5)[1].clip![1]).toEqual({ x: 0, y: 0.15, w: 1, h: 0.05 });
    expect(frameAt(t("blinds", "left"), 0.5)[1].clip![0]).toEqual({ x: 0.05, y: 0, w: 0.05, h: 1 });
    expect(layerCss(frameAt(t("blinds"), 0.5)[1]).clipPath).toMatch(/^polygon\(0 0, 0% 0%, 100% 0%, 100% 5%, 0% 5%, 0% 0%, 0 0, 0% 10%/);
  });

  it("iris out grows a centred rectangle; iris in shrinks the old slide", () => {
    expect(frameAt(t("iris", "out"), 0.5)[1].clip).toEqual([{ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }]);
    for (const d of [undefined, "left", "right", "up", "down"] as const) expect(frameAt(t("iris", d), 0.5)).toEqual(frameAt(t("iris", "out"), 0.5));
    const iin = frameAt(t("iris", "in"), 0.5);
    expect(summary(iin)).toBe("current,previous");
    expect(iin[1].clip).toEqual([{ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }]);
    expect(layerCss(iin[1])).toEqual({ clipPath: "inset(25% 25% 25% 25%)" });
  });
});

describe("clipPathCss", () => {
  it("uses an empty polygon for nothing and inset for one box", () => {
    expect(clipPathCss([])).toBe("polygon(0 0, 0 0, 0 0)");
    expect(clipPathCss([{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }])).toBe("inset(20% 60% 40% 10%)");
  });
});

describe("reduced motion", () => {
  it("animated effects become replace; overlay and keep stay", () => {
    expect(effectiveTransition(t("wipe", "left"), true)).toEqual(REPLACE);
    expect(effectiveTransition(t("fade"), true)).toEqual(REPLACE);
    expect(effectiveTransition(t("overlay"), true)).toEqual(t("overlay"));
    expect(effectiveTransition(t("wipe", "left"), false)).toEqual(t("wipe", "left"));
  });
});

describe("transition run", () => {
  const wipe = t("wipe", "left");

  it("starts on each slide change and finishes when the stage says so", () => {
    expect(isAnimating(INITIAL_RUN, wipe, true)).toBe(false);
    const run = startRun(INITIAL_RUN);
    expect(run).toEqual({ id: 1, phase: "erase", finished: false });
    expect(isAnimating(run, wipe, true)).toBe(true);
    expect(isAnimating(run, wipe, false)).toBe(false);
    expect(isAnimating(run, REPLACE, true)).toBe(false);
    expect(finishRun(run, 0)).toBe(run); // stale id
    expect(finishRun(run, 1)).toEqual({ id: 1, phase: "draw", finished: true });
  });

  it("erases the old slide, then draws the new one", () => {
    const plan = { erase: t("fade"), draw: t("iris", "out") };
    let run = startRun(INITIAL_RUN);
    expect(hasErasePhase(plan, true)).toBe(true);
    expect(runPhase(run, plan, true)).toBe("erase");
    expect(phaseTransition(run, plan, true)).toEqual(plan.erase);
    // The stage reports the end of each phase by its id.
    const eraseId = stageRunId(run, "erase");
    expect(finishStage(run, stageRunId(run, "draw") - 2)).toBe(run); // the previous run's draw: stale
    run = finishStage(run, eraseId);
    expect(run).toEqual({ id: 1, phase: "draw", finished: false });
    expect(runPhase(run, plan, true)).toBe("draw");
    expect(phaseTransition(run, plan, true)).toEqual(plan.draw);
    expect(finishStage(run, eraseId)).toBe(run); // repeated: ignored
    run = finishStage(run, stageRunId(run, "draw"));
    expect(run.finished).toBe(true);
  });

  it("skips the erase phase without an animated erase or an old picture", () => {
    const run = startRun(INITIAL_RUN);
    for (const plan of [
      { erase: null, draw: t("wipe", "left") },
      { erase: REPLACE, draw: t("wipe", "left") },
    ]) {
      expect(runPhase(run, plan, true)).toBe("draw");
      expect(phaseTransition(run, plan, true)).toEqual(plan.draw);
    }
    expect(runPhase(run, { erase: t("fade"), draw: REPLACE }, false)).toBe("draw");
    // The draw phase ending finishes the run even though the erase was skipped.
    expect(finishStage(run, stageRunId(run, "draw")).finished).toBe(true);
  });

  it("a key during the erase ends the whole run", () => {
    const plan = { erase: t("wipe", "down"), draw: t("fade") };
    const run = startRun(INITIAL_RUN);
    const { run: after, consumed } = interruptRun(run, phaseTransition(run, plan, true), true);
    expect(consumed).toBe(true);
    expect(after).toEqual({ id: 1, phase: "draw", finished: true });
    expect(endRun(after)).toBe(after);
    expect(runPhase(after, plan, true)).toBe("draw");
  });

  it("a key mid-transition jumps to the end state and is consumed", () => {
    const run = startRun(INITIAL_RUN);
    const { run: after, consumed } = interruptRun(run, wipe, true);
    expect(consumed).toBe(true);
    expect(after.finished).toBe(true);
    expect(shownProgress(after, 0.3)).toBe(1);
    expect(frameAt(wipe, shownProgress(after, 0.3))).toEqual(frameAt(wipe, 1));
    // Once finished, keys go to the player.
    expect(interruptRun(after, wipe, true)).toEqual({ run: after, consumed: false });
    expect(interruptRun(run, REPLACE, true).consumed).toBe(false);
  });
});
