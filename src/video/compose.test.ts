import { describe, expect, it } from "vitest";
import { FADE_COLUMNS, FADE_ROWS, frameAt } from "../player/transitions/frames";
import type { Transition } from "../player/transitions/types";
import { type FrameContext, drawFrame, drawOps, fitRect, pixelRect } from "./compose";
import type { FrameLayer, Source } from "./timeline";

const W = 640;
const H = 480;
const layersOf = (t: Transition, p: number, previous: Source = { picture: 0 }, current: Source = { picture: 1 }): FrameLayer[] =>
  frameAt(t, p).map((l) => ({ ...l, source: l.which === "previous" ? previous : current }));
const area = (rects: { w: number; h: number }[]) => rects.reduce((n, r) => n + r.w * r.h, 0);

describe("pixelRect", () => {
  it("rounds edges, not sizes, and stays inside the frame", () => {
    expect(pixelRect({ x: 0, y: 0, w: 1, h: 1 }, W, H)).toEqual({ x: 0, y: 0, w: W, h: H });
    expect(pixelRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, W, H)).toEqual({ x: 160, y: 240, w: 320, h: 120 });
    expect(pixelRect({ x: -0.1, y: 0.9, w: 0.2, h: 0.5 }, W, H)).toEqual({ x: 0, y: 432, w: 64, h: 48 });
  });
});

describe("drawOps", () => {
  it("wipes right: the new slide clipped to the left part", () => {
    const ops = drawOps(layersOf({ effect: "wipe", direction: "right", durationMs: 750 }, 0.25), W, H);
    expect(ops).toEqual([
      { source: { picture: 0 }, transparent: false, clip: null, dx: 0, dy: 0 },
      { source: { picture: 1 }, transparent: false, clip: [{ x: 0, y: 0, w: 160, h: 480 }], dx: 0, dy: 0 },
    ]);
  });

  it("drops a layer with nothing visible yet", () => {
    const ops = drawOps(layersOf({ effect: "iris", direction: "out", durationMs: 750 }, 0), W, H);
    expect(ops.map((o) => o.source)).toEqual([{ picture: 0 }]);
  });

  it("shifts both pictures for Scroll", () => {
    const ops = drawOps(layersOf({ effect: "scroll", direction: "left", durationMs: 750 }, 0.5), W, H);
    expect(ops.map((o) => [o.dx, o.dy])).toEqual([
      [-320, 0],
      [320, 0],
    ]);
  });

  it("covers the new slide's share of the frame in Fade, without overlaps", () => {
    for (const p of [0.1, 0.5, 0.9]) {
      const ops = drawOps(layersOf({ effect: "fade", durationMs: 1500 }, p), W, H);
      const cells = Math.round(p * FADE_COLUMNS * FADE_ROWS);
      expect(area(ops[1].clip!)).toBe(cells * (W / FADE_COLUMNS) * (H / FADE_ROWS));
    }
  });

  it("grows Blinds stripes that meet at the end", () => {
    const t: Transition = { effect: "blinds", direction: "down", durationMs: 750 };
    expect(area(drawOps(layersOf(t, 0.5), W, H)[1].clip!)).toBe((W * H) / 2);
    // At 1 the animation is over: the new slide alone, unclipped.
    expect(drawOps(layersOf(t, 1), W, H)).toEqual([{ source: { picture: 1 }, transparent: false, clip: null, dx: 0, dy: 0 }]);
  });

  it("keeps the erase phase's black and Overlay's transparency", () => {
    const erase = drawOps(layersOf({ effect: "close", durationMs: 750 }, 0.5, { picture: 3 }, "blank"), W, H);
    expect(erase.map((o) => o.source)).toEqual(["blank", { picture: 3 }]);
    expect(erase[1].clip).toEqual([{ x: 0, y: 120, w: 640, h: 240 }]);
    const overlay = drawOps(layersOf({ effect: "overlay", durationMs: 0 }, 1), W, H);
    expect(overlay.map((o) => o.transparent)).toEqual([false, true]);
  });
});

describe("drawFrame", () => {
  it("clears to black, then draws each picture inside its clip", () => {
    const calls: string[] = [];
    const ctx: FrameContext = {
      fillStyle: "",
      fillRect: (x, y, w, h) => calls.push(`fill ${String(ctx.fillStyle)} ${x},${y},${w},${h}`),
      save: () => calls.push("save"),
      restore: () => calls.push("restore"),
      beginPath: () => calls.push("begin"),
      rect: (x, y, w, h) => calls.push(`rect ${x},${y},${w},${h}`),
      clip: () => calls.push("clip"),
      drawImage: (img, dx, dy) => calls.push(`draw ${(img as unknown as { name: string }).name} ${dx},${dy}`),
    };
    const ops = drawOps(layersOf({ effect: "wipe", direction: "in", durationMs: 750 }, 0.5, "blank"), W, H);
    drawFrame(ctx, ops, W, H, (p, t) => ({ name: `p${p}${t ? "t" : ""}` }) as unknown as CanvasImageSource);
    expect(calls).toEqual([
      "fill #000000 0,0,640,480",
      "save",
      "fill #000000 0,0,640,480",
      "restore",
      "save",
      "begin",
      "rect 0,0,160,480",
      "rect 480,0,160,480",
      "clip",
      "draw p1 0,0",
      "restore",
    ]);
  });
});

describe("fitRect", () => {
  it("letterboxes a portrait page in a landscape frame", () => {
    expect(fitRect(24576, 32768, 640, 480)).toEqual({ x: 140, y: 0, w: 360, h: 480 });
    expect(fitRect(4, 3, 640, 480)).toEqual({ x: 0, y: 0, w: 640, h: 480 });
  });
});
