import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresentationSlide } from "../../formats/types";
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
import { guessHg3Transition } from "./hg3Guess";
import {
  DEFAULT_TRANSITION_MODE,
  DEMO_TRANSITIONS,
  loadTransitionMode,
  saveTransitionMode,
  transitionForSlide,
} from "./mode";
import { INITIAL_RUN, finishRun, interruptRun, isAnimating, shownProgress, startRun } from "./run";
import { REPLACE, SPEED_MS, type Transition, effectiveTransition, isInstant } from "./types";

function slide(transition?: unknown): PresentationSlide {
  return {
    label: "s",
    kind: "picture",
    fileName: null,
    scene: () => null,
    warnings: () => [],
    keys: [],
    buttons: [],
    waitForKey: true,
    transition,
  };
}

const t = (effect: Transition["effect"], direction?: Transition["direction"]): Transition =>
  direction ? { effect, direction, durationMs: 750 } : { effect, durationMs: 750 };

const area = (boxes: Box[]) => boxes.reduce((a, b) => a + b.w * b.h, 0);
const summary = (f: Frame) => f.map((l) => l.which).join(",");

describe("transitionForSlide", () => {
  const hg3 = { speed: 2, transitionA: 1, transitionB: 3 };

  it("off: always replace (and is the default)", () => {
    expect(DEFAULT_TRANSITION_MODE).toBe("off");
    expect(transitionForSlide(slide(hg3), "off")).toEqual(REPLACE);
  });

  it("guessed: reads offset 12 in menu order and offset 5 as speed", () => {
    expect(transitionForSlide(slide(hg3), "guessed")).toEqual({ effect: "wipe", direction: "right", durationMs: SPEED_MS.fast });
    expect(transitionForSlide(slide({ speed: 0, transitionA: 0, transitionB: 9 }), "guessed")).toEqual({
      effect: "scroll",
      direction: "down",
      durationMs: SPEED_MS.slow,
    });
    expect(transitionForSlide(slide({ speed: 7, transitionA: 0, transitionB: 10 }), "guessed")).toEqual({
      effect: "fade",
      durationMs: SPEED_MS.medium,
    });
    expect(guessHg3Transition({ speed: 1, transitionB: 18 })).toMatchObject({ effect: "iris", direction: "out" });
  });

  it("guessed: replace for values outside the table or other formats", () => {
    expect(transitionForSlide(slide({ speed: 0, transitionB: 19 }), "guessed")).toEqual(REPLACE);
    expect(transitionForSlide(slide(undefined), "guessed")).toEqual(REPLACE);
    expect(transitionForSlide(slide("wipe"), "guessed")).toEqual(REPLACE);
  });

  it("demo: cycles through every effect", () => {
    const seen = new Set<string>();
    for (let step = 1; step <= DEMO_TRANSITIONS.length; step++) seen.add(transitionForSlide(slide(), "demo", step).effect);
    expect([...seen].sort()).toEqual(
      ["replace", "overlay", "wipe", "scroll", "fade", "open", "close", "blinds", "iris", "keep"].sort(),
    );
    expect(transitionForSlide(slide(), "demo", 1)).toEqual(DEMO_TRANSITIONS[0]);
    expect(transitionForSlide(slide(), "demo", DEMO_TRANSITIONS.length + 3)).toEqual(DEMO_TRANSITIONS[2]);
  });

  describe("persistence", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("remembers the mode and falls back to the default", () => {
      const store = new Map<string, string>();
      vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
      expect(loadTransitionMode()).toBe("off");
      saveTransitionMode("demo");
      expect(loadTransitionMode()).toBe("demo");
      store.set("hwv.transitions", "bogus");
      expect(loadTransitionMode()).toBe("off");
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
      expect(loadTransitionMode()).toBe("off");
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
    const clip = frameAt(t("blinds", "up"), 0.5)[1].clip!;
    expect(clip).toHaveLength(BLINDS_STRIPES);
    expect(clip[1]).toEqual({ x: 0, y: 0.1, w: 1, h: 0.05 });
    expect(area(clip)).toBeCloseTo(0.5);
    expect(frameAt(t("blinds", "left"), 0.5)[1].clip![0]).toEqual({ x: 0, y: 0, w: 0.05, h: 1 });
    expect(layerCss(frameAt(t("blinds", "up"), 0.5)[1]).clipPath).toMatch(/^polygon\(0 0, 0% 0%, 100% 0%, 100% 5%, 0% 5%, 0% 0%, 0 0, 0% 10%/);
  });

  it("iris out grows a centred rectangle; iris in shrinks the old slide", () => {
    expect(frameAt(t("iris", "out"), 0.5)[1].clip).toEqual([{ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }]);
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
    expect(run).toEqual({ id: 1, finished: false });
    expect(isAnimating(run, wipe, true)).toBe(true);
    expect(isAnimating(run, wipe, false)).toBe(false);
    expect(isAnimating(run, REPLACE, true)).toBe(false);
    expect(finishRun(run, 0)).toBe(run); // stale id
    expect(finishRun(run, 1)).toEqual({ id: 1, finished: true });
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
