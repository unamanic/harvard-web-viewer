import { describe, expect, it } from "vitest";
import { LANDSCAPE_VIEW_BOX, PORTRAIT_VIEW_BOX } from "../../types";
import type { PageSetup } from "../chart";
import { areaToRect, pageGeometry, toScene } from "./page";

const setup = (orientation: PageSetup["orientation"], orientationCode: number): PageSetup => ({
  orientation,
  orientationCode,
  paperSize: 1,
  widthIn: 10,
  heightIn: 7.5,
});

describe("pageGeometry", () => {
  it("is landscape by default, with or without 816", () => {
    expect(pageGeometry({ pageSetup: null }).viewBox).toEqual(LANDSCAPE_VIEW_BOX);
    expect(pageGeometry({ pageSetup: setup("landscape", 1) }).orientation).toBe("landscape");
    expect(pageGeometry({ pageSetup: setup("unknown", 7) }).orientation).toBe("landscape");
  });

  it("is portrait for 816 orientation 2", () => {
    const g = pageGeometry({ pageSetup: setup("portrait", 2) });
    expect(g.orientation).toBe("portrait");
    expect(g.viewBox).toEqual(PORTRAIT_VIEW_BOX);
    expect(g.shortSide).toBe(24576);
  });
});

describe("toScene / areaToRect", () => {
  it("flips y", () => {
    expect(toScene(100, 2000)).toEqual({ x: 100, y: -2000 });
    expect(toScene(-5, -7)).toEqual({ x: -5, y: 7 });
  });

  it("puts the top-left corner (largest page y) at x/y, whatever the corner order", () => {
    const expected = { x: -1000, y: -5600, width: 11000, height: 4600 };
    expect(areaToRect({ x1: -1000, y1: 1000, x2: 10000, y2: 5600 })).toEqual(expected);
    expect(areaToRect({ x1: 10000, y1: 5600, x2: -1000, y2: 1000 })).toEqual(expected);
  });

  it("maps the full landscape page onto the landscape viewBox", () => {
    const r = areaToRect({ x1: -16384, y1: -12288, x2: 16384, y2: 12288 });
    expect(r).toEqual({ x: LANDSCAPE_VIEW_BOX.minX, y: LANDSCAPE_VIEW_BOX.minY, width: 32768, height: 24576 });
  });
});
